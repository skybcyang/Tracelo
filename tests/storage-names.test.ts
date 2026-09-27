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
  expect(await adapter.read("任务/2026-09-26 完成支付模块/日志/error.log")).toBe("keep me");
  const renamed = renameTask(loaded.tasks[0]!, "支付验收", new Date("2026-10-01T03:00:00Z"), "rename-event");
  await store.saveTask(renamed);
  expect(store.taskPath(original.id)).toBe("任务/2026-09-26 支付验收/2026-09-26 支付验收.md");
  expect(await adapter.read("任务/2026-09-26 支付验收/日志/error.log")).toBe("keep me");
  expect(parseTaskMarkdown(await adapter.read(store.taskPath(original.id))).events).toEqual(renamed.events);
});

it("rolls back failed rename without losing source task or material", async () => {
  const original = task(); await store.saveTask(original);
  const oldPath = store.taskPath(original.id);
  await adapter.mkdir("工作记录/材料/2026-09-26 完成支付模块");
  const copy = adapter.copy.bind(adapter);
  adapter.copy = async (path, target) => { if (target === "任务/2026-09-26 新名字/2026-09-26 新名字.md") throw new Error("disk full"); await copy(path, target); };
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

it("lazily colocates the formal task with materials and reloads only the formal Markdown", async () => {
  const original = task(); await store.saveTask(original);
  const oldPath = store.taskPath(original.id);
  await store.ensureTaskFolder(original);
  expect(store.taskPath(original.id)).toBe(`任务/${original.archiveName}/${original.archiveName}.md`);
  expect(await adapter.exists(oldPath)).toBe(false);
  await adapter.write(`${original.materialFolder}/参考.md`, "user material");
  const loaded = await new ArchiveStore(adapter, "任务", ".plugin/backups", "规则").loadTasksSafe();
  expect(loaded.errors).toEqual([]); expect(loaded.tasks).toHaveLength(1);
  await store.saveTask(renameTask(original, "更名", new Date(), "rename"));
  expect(await adapter.read("任务/2026-09-26 更名/参考.md")).toBe("user material");
});

it("backs up actual note image bytes and restores missing attachments", async () => {
  const original = task(); await store.saveTask(original);
  const saved = await store.saveNoteAttachment(original, "截图.png", new Uint8Array([1, 2, 255]).buffer);
  original.notes = `before ![截图](${saved.path}) after`;
  await store.saveTask(original);
  await adapter.remove(`${original.materialFolder}/${saved.path}`);
  await store.recoverTask(original.id);
  expect(new Uint8Array(await adapter.readBinary(`${original.materialFolder}/${saved.path}`))).toEqual(new Uint8Array([1, 2, 255]));
});

it("keeps a damaged task eligible for recovery if attachment restoration fails", async () => {
  const original = task();
  const image = await store.saveNoteAttachment(original, "image.png", new Uint8Array([1, 2]).buffer);
  original.notes = `![image](${image.path})`; await store.saveTask(original);
  await adapter.remove(`${original.materialFolder}/${image.path}`);
  const path = store.taskPath(original.id); await adapter.write(path, "damaged");
  const writeBinary = adapter.writeBinary.bind(adapter);
  adapter.writeBinary = async () => { throw new Error("disk full"); };
  await expect(store.recoverTask(original.id)).rejects.toThrow("disk full");
  expect(await adapter.read(path)).toBe("damaged");
  adapter.writeBinary = writeBinary;
  expect((await store.loadTasksSafe()).errors).toEqual([]);
  expect(new Uint8Array(await adapter.readBinary(`${original.materialFolder}/${image.path}`))).toEqual(new Uint8Array([1, 2]));
});

it("serializes an attachment upload with a concurrent task rename", async () => {
  const original = task(); await store.ensureTaskFolder(original);
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const write = adapter.writeBinary.bind(adapter);
  adapter.writeBinary = async (path, data) => {
    if (path.startsWith(`${original.materialFolder}/image-`)) { started(); await gate; }
    await write(path, data);
  };
  const uploading = store.saveNoteAttachment(original, "image.png", new Uint8Array([5]).buffer);
  await ready;
  const renamed = renameTask(original, "并发改名", new Date(), "rename");
  let finished = false;
  const renaming = store.saveTask(renamed).then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  const completedBeforeUpload = finished;
  release();
  const [image] = await Promise.all([uploading, renaming]);
  expect(completedBeforeUpload).toBe(false);
  expect(new Uint8Array(await adapter.readBinary(`${renamed.materialFolder}/${image.path}`))).toEqual(new Uint8Array([5]));
});

it("ingests valid new external tasks once and backs them up without renaming", async () => {
  const original = task();
  await adapter.write("任务/task-1.md", serializeTaskMarkdown(original));
  expect((await store.ingestTaskFile("任务/task-1.md"))?.id).toBe(original.id);
  expect(await store.ingestTaskFile("任务/task-1.md")).toBeNull();
  await adapter.remove("任务/task-1.md");
  expect((await store.recoverTask(original.id)).id).toBe(original.id);
});

it("migrates registered legacy folders without overwriting an occupied destination", async () => {
  const original = task(); await store.saveTask(original);
  await adapter.mkdir(`工作记录/材料/${original.archiveName}`);
  await adapter.write(`工作记录/材料/${original.archiveName}/keep.txt`, "legacy");
  await adapter.mkdir(`任务/${original.archiveName}`);
  await adapter.write(`任务/${original.archiveName}/unrelated.txt`, "occupied");
  await store.migrateTaskNames([original]);
  expect(original.archiveName).toBe("2026-09-26 完成支付模块（2）");
  expect(await adapter.read(`${original.materialFolder}/keep.txt`)).toBe("legacy");
  expect(await adapter.read("任务/2026-09-26 完成支付模块/unrelated.txt")).toBe("occupied");
});

it("recovers an interrupted unified-folder rename and retains all material Markdown", async () => {
  const original = task(); await store.ensureTaskFolder(original);
  const oldPath = store.taskPath(original.id), oldSource = await adapter.read(oldPath), oldFolder = original.materialFolder!;
  await adapter.write(`${oldFolder}/材料.md`, "user text");
  const nextFolder = "任务/2026-09-26 新名字", path = `${nextFolder}/2026-09-26 新名字.md`;
  await adapter.write(".plugin/backups/pending-names/task-1.json", JSON.stringify({ version: 1, taskId: original.id, oldPath, path, oldSource, oldFolder, nextFolder, hasFolder: true, backupPath: ".plugin/backups/daily/2026-09-26/task-1.md", previousBackup: null }));
  await adapter.rename(oldFolder, nextFolder);
  await adapter.write(path, "partially written");
  store = new ArchiveStore(adapter, "任务", ".plugin/backups", "规则");
  await store.initialize();
  expect(await adapter.read(oldPath)).toBe(oldSource);
  expect(await adapter.read(`${oldFolder}/材料.md`)).toBe("user text");
  expect(await adapter.exists(nextFolder)).toBe(false);
});

it("ignores and cleans an interrupted staged Markdown when recovering its JSON journal", async () => {
  const original = task(); await store.saveTask(original);
  const oldPath = store.taskPath(original.id), oldSource = await adapter.read(oldPath);
  const stagedPath = ".plugin/backups/pending-names/task-1.md";
  await adapter.write(stagedPath, oldSource);
  await adapter.write(".plugin/backups/pending-names/task-1.json", JSON.stringify({ version: 1, taskId: original.id, oldPath, path: "任务/2026-09-26 新名字.md", oldSource, oldFolder: `工作记录/材料/${original.archiveName}`, nextFolder: "任务/2026-09-26 新名字", hasFolder: false, stagedPath, targetSource: oldSource, backupPath: ".plugin/backups/daily/2026-09-26/task-1.md", previousBackup: null }));
  store = new ArchiveStore(adapter, "任务", ".plugin/backups", "规则");
  await store.initialize();
  expect(await adapter.read(oldPath)).toBe(oldSource);
  expect(await adapter.exists(stagedPath)).toBe(false);
});

it("rejects external duplicate identities without replacing their registered path", async () => {
  const original = task(); await store.saveTask(original);
  const oldPath = store.taskPath(original.id);
  const duplicate = { ...original, archiveName: "duplicate" };
  await adapter.write("任务/duplicate.md", serializeTaskMarkdown(duplicate));
  await expect(store.ingestTaskFile("任务/duplicate.md")).rejects.toThrow("已有任务 ID");
  expect(store.taskPath(original.id)).toBe(oldPath);
  expect(await store.ingestTaskFile("任务/材料/参考.md")).toBeNull();
});

it("refuses externally supplied folders outside task and legacy material roots", async () => {
  const original = task(); original.materialFolder = "Private/keep";
  await adapter.mkdir(original.materialFolder); await adapter.write("Private/keep/secret.txt", "untouched");
  await expect(store.saveTask(original)).rejects.toThrow("任务文件夹路径");
  await adapter.write("任务/task-1.md", serializeTaskMarkdown(original));
  await expect(store.ingestTaskFile("任务/task-1.md")).rejects.toThrow("任务文件夹路径");
  expect((await store.loadTasksSafe()).tasks).toHaveLength(0);
  expect(await adapter.read("Private/keep/secret.txt")).toBe("untouched");
});

it("copies legacy material bytes before moving and redirects only task-owned note links", async () => {
  const original = task(); await store.saveTask(original);
  const folder = `工作记录/材料/${original.archiveName}`;
  await adapter.mkdir(folder); await adapter.writeBinary(`${folder}/截图.png`, new Uint8Array([8, 9]).buffer);
  original.notes = `![image](<${folder}/截图.png>) [[${folder}/截图.png|图]] [other](Elsewhere/file.md)`;
  const rename = adapter.rename.bind(adapter);
  adapter.rename = async (from, to) => {
    if (from === folder) {
      const snapshots = (await adapter.list(".plugin/backups/migration")).folders;
      expect(snapshots.length).toBeGreaterThan(0);
      expect(new Uint8Array(await adapter.readBinary(`${snapshots[0]}/截图.png`))).toEqual(new Uint8Array([8, 9]));
    }
    await rename(from, to);
  };
  await store.saveTask(original);
  expect(original.notes).toBe(`![image](<${original.materialFolder}/截图.png>) [[${original.materialFolder}/截图.png|图]] [other](Elsewhere/file.md)`);
});

it("leaves an orphan ID-named material directory untouched when creating a new task", async () => {
  await adapter.mkdir("工作记录/材料/task-1");
  await adapter.write("工作记录/材料/task-1/保留.txt", "unrelated");
  await store.saveTask(task());
  expect(await adapter.read("工作记录/材料/task-1/保留.txt")).toBe("unrelated");
  expect(await adapter.exists("工作记录/材料/2026-09-26 完成支付模块")).toBe(false);
});

it("preserves an unrelated task file created while a first save is being staged", async () => {
  const original = task();
  const destination = "任务/2026-09-26 完成支付模块.md";
  const write = adapter.write.bind(adapter);
  adapter.write = async (path, source) => {
    await write(path, source);
    if (path === ".plugin/backups/pending-names/task-1.md") await write(destination, "foreign document");
  };
  await expect(store.saveTask(original)).rejects.toThrow();
  expect(await adapter.read(destination)).toBe("foreign document");
});

it("publishes new Markdown through the adapter's no-replace copy operation", async () => {
  const destination = "任务/2026-09-26 完成支付模块.md";
  adapter.copy = async (_from, to) => { await adapter.write(to, "foreign at publication"); throw new Error("destination exists"); };
  await expect(store.saveTask(task())).rejects.toThrow("destination exists");
  expect(await adapter.read(destination)).toBe("foreign at publication");
});
