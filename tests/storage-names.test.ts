import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchiveStore } from "../src/archive-store";
import { parseTaskMarkdown, serializeTaskMarkdown } from "../src/archive";
import { createTask, renameTask } from "../src/domain";
import { DiskAdapter } from "./helpers/disk-adapter";

let adapter: DiskAdapter;
let store: ArchiveStore;
const task = (id = "task-1", title = "完成支付模块") => createTask({ title, groupId: null, groupName: "未分组", important: true, urgent: false }, new Date("2026-09-26T03:00:00Z"), id, `event-${id}`);
beforeEach(async () => { adapter = new DiskAdapter(await mkdtemp(join(tmpdir(), "tracelo-names-"))); store = new ArchiveStore(adapter, "任务", ".plugin/backups", "规则"); await store.initialize(); });
afterEach(async () => { await rm(adapter.root, { recursive: true, force: true }); });

it("uses original local creation day and title, resolving duplicate and case-insensitive names", async () => {
  const a = task(); const b = task("task-2");
  await store.saveTask(a); await store.saveTask(b);
  expect(store.taskPath(a.id)).toBe("任务/2026-09-26 完成支付模块.md");
  expect(store.taskPath(b.id)).toBe("任务/2026-09-26 完成支付模块（2）.md");
  await store.saveTask(b);
  expect((await store.loadTasksSafe()).tasks).toHaveLength(2);
  await store.saveTask(task("task-3", "Report")); await store.saveTask(task("task-4", "report"));
  expect(store.taskPath("task-4")).toContain("report（2）.md");
});

it("migrates a legacy file and material tree, then renames both without changing history", async () => {
  const original = task();
  await adapter.write("任务/task-1.md", serializeTaskMarkdown(original));
  await adapter.mkdir("工作记录/材料/task-1/日志");
  await adapter.write("工作记录/材料/task-1/日志/error.log", "keep me");
  const loaded = await store.loadTasksSafe();
  await store.saveTask(loaded.tasks[0]!);
  expect(await adapter.exists("任务/task-1.md")).toBe(false);
  expect(await adapter.read("工作记录/材料/2026-09-26 完成支付模块/日志/error.log")).toBe("keep me");
  const renamed = renameTask(loaded.tasks[0]!, "支付验收", new Date("2026-10-01T03:00:00Z"), "rename-event");
  await store.saveTask(renamed);
  expect(store.taskPath(original.id)).toBe("任务/2026-09-26 支付验收.md");
  expect(await adapter.read("工作记录/材料/2026-09-26 支付验收/日志/error.log")).toBe("keep me");
  expect(parseTaskMarkdown(await adapter.read(store.taskPath(original.id))).events).toEqual(renamed.events);
});

it("rolls back failed rename without losing source task or material", async () => {
  const original = task(); await store.saveTask(original);
  const oldPath = store.taskPath(original.id);
  await adapter.mkdir("工作记录/材料/2026-09-26 完成支付模块");
  const write = adapter.write.bind(adapter);
  adapter.write = async (path, source) => { if (path === "任务/2026-09-26 新名字.md") throw new Error("disk full"); await write(path, source); };
  await expect(store.saveTask(renameTask(original, "新名字", new Date("2026-10-01T03:00:00Z"), "rename-event"))).rejects.toThrow("disk full");
  expect(await adapter.exists(oldPath)).toBe(true);
  expect(await adapter.exists("工作记录/材料/2026-09-26 完成支付模块")).toBe(true);
  expect(store.taskPath(original.id)).toBe(oldPath);
});

it("recovers a completely corrupted human-named file after restart using its backup identity", async () => {
  await store.saveTask(task()); const path = store.taskPath("task-1");
  await adapter.write(path, "corrupted");
  store = new ArchiveStore(adapter, "任务", ".plugin/backups", "规则");
  const result = await store.loadTasksSafe();
  expect(result.errors).toEqual([]); expect(result.tasks[0]?.id).toBe("task-1");
  expect(parseTaskMarkdown(await adapter.read(path)).id).toBe("task-1");
});

it("sanitizes filesystem characters without changing the card title or overwriting unrelated files", async () => {
  const a = task("task-1", "定位 / 登录:超时?");
  await adapter.write("任务/2026-09-26 定位 - 登录-超时-.md", "unrelated");
  await store.saveTask(a);
  expect(store.taskPath(a.id)).toBe("任务/2026-09-26 定位 - 登录-超时-（2）.md");
  expect(a.title).toBe("定位 / 登录:超时?");
  expect(await adapter.read("任务/2026-09-26 定位 - 登录-超时-.md")).toBe("unrelated");
});

it("recovers an interrupted rename on next initialization, restoring its task and material paths", async () => {
  const original = task(); await store.saveTask(original);
  const oldPath = store.taskPath(original.id); const oldSource = await adapter.read(oldPath);
  const oldFolder = `工作记录/材料/${original.archiveName}`;
  const path = "任务/2026-09-26 新名字.md"; const nextFolder = "工作记录/材料/2026-09-26 新名字";
  await adapter.mkdir(oldFolder); await adapter.write(`${oldFolder}/日志.txt`, "important");
  await adapter.mkdir(".plugin/backups/pending-names");
  await adapter.write(".plugin/backups/pending-names/task-1.json", JSON.stringify({ version: 1, taskId: original.id, oldPath, path, oldSource, oldFolder, nextFolder, hasFolder: true, backupPath: ".plugin/backups/daily/2026-09-26/task-1.md", previousBackup: null }));
  await adapter.rename(oldFolder, nextFolder);
  await adapter.write(path, serializeTaskMarkdown({ ...original, title: "新名字", archiveName: "2026-09-26 新名字", materialFolder: nextFolder }));
  await adapter.remove(oldPath);
  store = new ArchiveStore(adapter, "任务", ".plugin/backups", "规则");
  await store.initialize();
  expect(await adapter.read(oldPath)).toBe(oldSource);
  expect(await adapter.read(`${oldFolder}/日志.txt`)).toBe("important");
  expect(await adapter.exists(path)).toBe(false);
  expect((await store.loadTasksSafe()).tasks).toHaveLength(1);
});

it("does not overwrite snapshots created in the same millisecond", async () => {
  const now = new Date("2026-09-26T03:00:00Z");
  const a = await store.backupLegacy({ first: true }, now);
  const b = await store.backupLegacy({ second: true }, now);
  expect(a).not.toBe(b); expect(JSON.parse(await adapter.read(a))).toEqual({ first: true });
});

it("leaves an orphan ID-named material directory untouched when creating a new task", async () => {
  await adapter.mkdir("工作记录/材料/task-1");
  await adapter.write("工作记录/材料/task-1/保留.txt", "unrelated");
  await store.saveTask(task());
  expect(await adapter.read("工作记录/材料/task-1/保留.txt")).toBe("unrelated");
  expect(await adapter.exists("工作记录/材料/2026-09-26 完成支付模块")).toBe(false);
});
