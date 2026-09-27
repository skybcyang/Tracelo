import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskAdapter } from "./helpers/disk-adapter";
import { ArchiveStore } from "../src/archive-store";
import { createDefaultState, serializeTaskMarkdown } from "../src/archive";
import { createTask, dayKey, renameTask, type GroupArchive } from "../src/domain";
import { exportBundle, importBundle, recoverInterruptedImport, type TransferBundle } from "../src/transfer";

let adapter: DiskAdapter;
let store: ArchiveStore;
const groups: GroupArchive = { version: 1, groups: [], events: [] };
const makeTask = () => createTask({ title: "Original", groupId: null, groupName: "未分组", important: false, urgent: false }, new Date("2026-09-27T00:00:00Z"), "review-task", "created");
beforeEach(async () => {
  adapter = new DiskAdapter(await mkdtemp(join(tmpdir(), "tracelo-storage-review-")));
  store = new ArchiveStore(adapter, "tasks", ".backups", "rules");
  await store.initialize();
});
afterEach(async () => { await rm(adapter.root, { recursive: true, force: true }); });

it("rollback preserves a competing directory when folder rename never committed", async () => {
  const task = makeTask();
  await store.ensureTaskFolder(task);
  const oldPath = store.taskPath(task.id);
  const original = await adapter.read(oldPath);
  const renamed = renameTask(task, "Renamed", new Date("2026-09-27T01:00:00Z"), "renamed");
  const foreignPath = "tasks/2026-09-27 Renamed/2026-09-27 Renamed.md";
  const rename = adapter.rename.bind(adapter);
  adapter.rename = async (from, to) => {
    if (to === "tasks/2026-09-27 Renamed") {
      await adapter.mkdir(to);
      await adapter.write(foreignPath, "external unrelated document");
      throw new Error("destination exists");
    }
    await rename(from, to);
  };
  await expect(store.saveTask(renamed)).rejects.toThrow();
  expect(await adapter.read(oldPath)).toBe(original);
  expect(await adapter.exists(foreignPath)).toBe(true);
  expect(await adapter.read(foreignPath)).toBe("external unrelated document");
});

it("import state commit failure removes its new colocated task and images while preserving originals", async () => {
  const source = new DiskAdapter(await mkdtemp(join(tmpdir(), "tracelo-review-source-")));
  try {
    const original = new ArchiveStore(source, "tasks", ".backups", "rules");
    await original.initialize();
    const task = makeTask();
    const image = await original.saveNoteAttachment(task, "note.png", new Uint8Array([1, 2, 3]).buffer);
    task.notes = `![image](${image.path})`;
    await original.saveTask(task);
    const bundle = await exportBundle(source, [task], groups, createDefaultState(), "tasks");
    let calls = 0;
    await expect(importBundle(adapter, store, bundle, [], groups, createDefaultState(), async () => {
      if (++calls === 1) throw new Error("state save failed");
    })).rejects.toThrow("state save failed");
    expect((await store.loadTasksSafe()).tasks).toEqual([]);
    expect(await adapter.exists("tasks/2026-09-27 Original")).toBe(false);
    expect(await adapter.exists(".backups/pending-import.json")).toBe(false);
    expect(new Uint8Array(await source.readBinary(`${task.materialFolder}/${image.path}`))).toEqual(new Uint8Array([1, 2, 3]));
  } finally { await rm(source.root, { recursive: true, force: true }); }
});

it("failed import preserves pre-existing historical backups for an absent task ID", async () => {
  const task = makeTask();
  const historical = ".backups/daily/2026-09-20/review-task.md";
  const oldSource = serializeTaskMarkdown(task);
  await adapter.mkdir(".backups/daily/2026-09-20");
  await adapter.write(historical, oldSource);
  const bundle = { format: "tracelo" as const, version: 1 as const, exportedAt: new Date().toISOString(), tasks: [task], groups, state: createDefaultState(), materials: [] };
  let calls = 0;
  await expect(importBundle(adapter, store, bundle, [], groups, createDefaultState(), async () => {
    if (++calls === 1) throw new Error("state save failed");
  })).rejects.toThrow("state save failed");
  expect(await adapter.exists(historical)).toBe(true);
  expect(await adapter.read(historical)).toBe(oldSource);
});

it("failed import restores same-day backup bytes and does not prune unrelated history", async () => {
  const task = makeTask();
  const daily = `.backups/daily/${dayKey(new Date())}`;
  const oldSource = serializeTaskMarkdown({ ...task, notes: "before import" });
  await adapter.mkdir(`${daily}/attachments/${task.id}`);
  await adapter.write(`${daily}/${task.id}.md`, oldSource);
  await adapter.writeBinary(`${daily}/attachments/${task.id}/note.png`, new Uint8Array([9, 8, 7]).buffer);
  for (let n = 1; n <= 8; n++) {
    await adapter.mkdir(`.backups/daily/2026-08-0${n}`);
    await adapter.write(`.backups/daily/2026-08-0${n}/keep.md`, "unrelated history");
  }
  const incomingImage = new Uint8Array([1, 2, 3]).buffer;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", incomingImage))].map(b => b.toString(16).padStart(2, "0")).join("");
  const bundle: TransferBundle = { format: "tracelo", version: 1, exportedAt: new Date().toISOString(), tasks: [task], groups, state: createDefaultState(), materials: [
    { taskId: task.id, type: "folder", path: "" },
    { taskId: task.id, type: "file", path: "note.png", data: "AQID", sha256 },
  ] };
  let calls = 0;
  await expect(importBundle(adapter, store, bundle, [], groups, createDefaultState(), async () => {
    if (++calls === 1) {
      expect(new Uint8Array(await adapter.readBinary(`${daily}/attachments/${task.id}/note.png`))).toEqual(new Uint8Array([1, 2, 3]));
      throw new Error("state save failed");
    }
  })).rejects.toThrow("state save failed");
  expect(await adapter.read(`${daily}/${task.id}.md`)).toBe(oldSource);
  expect(new Uint8Array(await adapter.readBinary(`${daily}/attachments/${task.id}/note.png`))).toEqual(new Uint8Array([9, 8, 7]));
  expect(await adapter.read(".backups/daily/2026-08-01/keep.md")).toBe("unrelated history");
});

it("keeps the recovery journal and snapshots if state rollback also fails", async () => {
  const task = makeTask();
  const historical = ".backups/daily/2026-09-20/review-task.md";
  await adapter.mkdir(".backups/daily/2026-09-20");
  await adapter.write(historical, serializeTaskMarkdown(task));
  const bundle = { format: "tracelo" as const, version: 1 as const, exportedAt: new Date().toISOString(), tasks: [task], groups, state: createDefaultState(), materials: [] };
  await expect(importBundle(adapter, store, bundle, [], groups, createDefaultState(), async () => { throw new Error("state unavailable"); })).rejects.toThrow("state unavailable");
  expect(await adapter.exists(".backups/pending-import.json")).toBe(true);
  const journal = JSON.parse(await adapter.read(".backups/pending-import.json"));
  expect(await adapter.exists(`${journal.staging}/previous-daily/2026-09-20/review-task.md`)).toBe(true);
  await recoverInterruptedImport(adapter, new ArchiveStore(adapter, "tasks", ".backups", "rules"), async () => {});
  expect(await adapter.read(historical)).toBe(serializeTaskMarkdown(task));
  expect(await adapter.exists(".backups/pending-import.json")).toBe(false);
});
