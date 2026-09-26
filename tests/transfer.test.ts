import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskAdapter } from "./helpers/disk-adapter";
import { ArchiveStore } from "../src/archive-store";
import { createDefaultState } from "../src/archive";
import { createTask, type GroupArchive } from "../src/domain";
import { exportBundle, parseBundle, planImport, importBundle, recoverInterruptedImport } from "../src/transfer";

let source: DiskAdapter, destination: DiskAdapter, store: ArchiveStore;
const groups: GroupArchive = { version: 1, groups: [{ id: "group-1", name: "研发" }], events: [] };
const makeTask = (id = "task-1") => createTask({ title: "排查问题", groupId: "group-1", groupName: "研发", important: true, urgent: false }, new Date("2026-09-26T03:00:00Z"), id, `event-${id}`);
beforeEach(async () => {
  source = new DiskAdapter(await mkdtemp(join(tmpdir(), "tracelo-export-")));
  destination = new DiskAdapter(await mkdtemp(join(tmpdir(), "tracelo-import-")));
  store = new ArchiveStore(destination, "任务", ".plugin/backups", "规则"); await store.initialize();
});
afterEach(async () => { await Promise.all([source, destination].map(a => rm(a.root, { recursive: true, force: true }))); });

async function example() {
  const task = makeTask();
  const original = new ArchiveStore(source, "任务", ".plugin/backups", "规则"); await original.initialize(); await original.saveTask(task);
  await source.mkdir(`工作记录/材料/${task.archiveName}/空目录`);
  await source.writeBinary(`工作记录/材料/${task.archiveName}/截图.png`, new Uint8Array([0, 255, 128, 1]).buffer);
  const state = createDefaultState(); state.drafts[task.id] = "未提交内容";
  return { task, bundle: await exportBundle(source, [task], groups, state) };
}

it("round-trips full task history, binary materials, empty directories, groups and drafts", async () => {
  const { task, bundle } = await example();
  const parsed = await parseBundle(JSON.stringify(bundle));
  const result = await importBundle(destination, store, parsed, [], { version: 1, groups: [], events: [] }, createDefaultState());
  expect(result.tasks[0]?.events).toEqual(task.events);
  expect(result.groups).toEqual(groups);
  expect(result.state.drafts[task.id]).toBe("未提交内容");
  expect(new Uint8Array(await destination.readBinary(`工作记录/材料/${result.tasks[0]!.archiveName}/截图.png`))).toEqual(new Uint8Array([0, 255, 128, 1]));
  expect(await destination.exists(`工作记录/材料/${result.tasks[0]!.archiveName}/空目录`)).toBe(true);
  expect((await store.loadTasksSafe()).tasks).toHaveLength(1);
});

it("skips existing IDs and their materials; repeated imports are idempotent", async () => {
  const { bundle } = await example();
  const first = await importBundle(destination, store, bundle, [], { version: 1, groups: [], events: [] }, createDefaultState());
  const path = `工作记录/材料/${first.tasks[0]!.archiveName}/截图.png`;
  await destination.writeBinary(path, new Uint8Array([42]).buffer);
  const second = await importBundle(destination, store, bundle, first.tasks, first.groups, first.state);
  expect(second.imported).toBe(0); expect(second.skipped).toBe(1);
  expect(new Uint8Array(await destination.readBinary(path))).toEqual(new Uint8Array([42]));
});

it("previews same-title task creation with suffixes and keeps local group identity on name match", async () => {
  const { bundle } = await example();
  const existing = makeTask("local-task"); existing.groupId = "local-group";
  await store.saveTask(existing);
  const localGroups: GroupArchive = { version: 1, groups: [{ id: "local-group", name: "研发" }], events: [] };
  const preview = planImport(bundle, [existing], localGroups);
  expect(preview.tasks).toHaveLength(1); expect(preview.groups.groups).toHaveLength(1);
  const result = await importBundle(destination, store, bundle, [existing], localGroups, createDefaultState());
  expect(result.tasks[1]!.archiveName).toBe("2026-09-26 排查问题（2）");
  expect(result.tasks[1]!.groupId).toBe("local-group");
});

it("rejects malformed versions, duplicate IDs, traversal, invalid dates and tampered binaries before writing", async () => {
  const { bundle } = await example();
  for (const mutate of [
    (b: any) => { b.version = 999; },
    (b: any) => { b.tasks.push(b.tasks[0]); },
    (b: any) => { b.materials.find((e: any) => e.type === "file").path = "../outside"; },
    (b: any) => { b.materials.find((e: any) => e.type === "file").data = "AAAA"; },
    (b: any) => { b.tasks[0].events[0].day = "2026-02-31"; },
    (b: any) => { b.tasks[0].id = "../../escape"; },
  ]) {
    const copy = structuredClone(bundle); mutate(copy);
    await expect(parseBundle(JSON.stringify(copy))).rejects.toThrow();
  }
  expect((await store.loadTasksSafe()).tasks).toHaveLength(0);
});

it("rolls back imported tasks and folders on material write failure while preserving existing data", async () => {
  const { bundle } = await example();
  const local = makeTask("local-task"); await store.saveTask(local); await store.saveGroups(groups);
  const before = await destination.read(store.taskPath(local.id));
  destination.writeBinary = async () => { throw new Error("disk full"); };
  await expect(importBundle(destination, store, bundle, [local], groups, createDefaultState())).rejects.toThrow("disk full");
  expect(await destination.read(store.taskPath(local.id))).toBe(before);
  expect((await store.loadTasksSafe()).tasks.map(t => t.id)).toEqual([local.id]);
  expect(await destination.exists("工作记录/材料/2026-09-26 排查问题（2）")).toBe(false);
});

it("restores the exported manual ordering when importing into an empty vault", async () => {
  const { bundle } = await example();
  bundle.tasks.push(makeTask("task-2"));
  bundle.state.orders.group["group-1"] = ["task-1", "task-2"];
  const result = await importBundle(destination, store, bundle, [], { version: 1, groups: [], events: [] }, createDefaultState());
  expect(result.state.orders.group["group-1"]).toEqual(["task-1", "task-2"]);
});

it("rolls back a process-interrupted import and restores original settings on startup", async () => {
  const imported = makeTask(); await store.saveTask(imported);
  const staging = ".plugin/backups/import-staging/session-1";
  await destination.mkdir(staging);
  const from = `${staging}/task-1`; const to = `工作记录/材料/${imported.archiveName}`;
  await destination.mkdir(to); await destination.write(`${to}/日志.txt`, "imported data");
  const originalState = createDefaultState(); originalState.drafts.local = "keep draft";
  await destination.write(".plugin/backups/pending-import.json", JSON.stringify({ version: 1, taskIds: ["task-1"], groups: { version: 1, groups: [], events: [] }, state: originalState, staging, moves: [{ from, to }] }));
  const restored = await recoverInterruptedImport(destination, store);
  expect(restored?.drafts.local).toBe("keep draft");
  expect((await store.loadTasksSafe()).tasks).toHaveLength(0);
  expect(await destination.exists(to)).toBe(false);
  expect(await destination.exists(".plugin/backups/pending-import.json")).toBe(false);
});
