import { assertTask, normalizePluginState, serializeGroupArchive, type PluginState } from "./archive";
import { type ArchiveAdapter, ArchiveStore } from "./archive-store";
import { isValidDay, pinTask, type GroupArchive, type WorkTask } from "./domain";
import { canonicalPath, folderForTask, MATERIALS_DIRECTORY, safeSegment } from "./storage-names";

export const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
export interface TransferAdapter extends ArchiveAdapter {
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
}
export interface MaterialEntry {
  taskId: string;
  path: string;
  type: "file" | "folder";
  data?: string;
  sha256?: string;
}
export interface TransferBundle {
  format: "tracelo";
  version: 1;
  exportedAt: string;
  tasks: WorkTask[];
  groups: GroupArchive;
  state: PluginState;
  materials: MaterialEntry[];
}

function encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
function decode(data: string): ArrayBuffer { return Uint8Array.from(atob(data), c => c.charCodeAt(0)).buffer; }
async function digest(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function ensureFolder(adapter: ArchiveAdapter, path: string): Promise<void> {
  let current = "";
  for (const part of path.split("/")) {
    current = current ? `${current}/${part}` : part;
    if (!await adapter.exists(current)) await adapter.mkdir(current);
    else if ((await adapter.stat(current))?.type !== "folder") throw new Error(`目录被同名文件占用：${current}`);
  }
}

export async function exportBundle(adapter: TransferAdapter, tasks: WorkTask[], groups: GroupArchive, state: PluginState): Promise<TransferBundle> {
  const bundle: TransferBundle = { format: "tracelo", version: 1, exportedAt: new Date().toISOString(), tasks: structuredClone(tasks), groups: structuredClone(groups), state: structuredClone(state), materials: [] };
  let size = new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
  for (const task of tasks) {
    const root = folderForTask(task);
    const info = await adapter.stat(root);
    if (!info) {
      if (task.materialFolder) throw new Error(`材料目录缺失：${root}。请先找回目录再导出。`);
      continue;
    }
    if (info.type !== "folder") throw new Error(`材料目录被文件占用：${root}`);
    async function walk(path: string): Promise<void> {
      bundle.materials.push({ taskId: task.id, path: path === root ? "" : path.slice(root.length + 1), type: "folder" });
      const listing = await adapter.list(path);
      for (const file of listing.files.sort()) {
        const stat = await adapter.stat(file);
        size += Math.ceil((stat?.size ?? 0) / 3) * 4;
        if (size > MAX_PACKAGE_BYTES) throw new Error("导出包超过 100 MB，请先将大材料另行复制。");
        const bytes = await adapter.readBinary(file);
        bundle.materials.push({ taskId: task.id, path: file.slice(root.length + 1), type: "file", data: encode(bytes), sha256: await digest(bytes) });
      }
      for (const folder of listing.folders.sort()) await walk(folder);
    }
    await walk(root);
  }
  return parseBundle(JSON.stringify(bundle));
}

export async function parseBundle(source: string): Promise<TransferBundle> {
  if (source.length > MAX_PACKAGE_BYTES || new TextEncoder().encode(source).byteLength > MAX_PACKAGE_BYTES) throw new Error("导入包超过 100 MB");
  let value: TransferBundle;
  try { value = JSON.parse(source); } catch { throw new Error("无法读取导入包，请选择 Tracelo 导出的 .tracelo.json 文件"); }
  if (!value || value.format !== "tracelo" || value.version !== 1 || !Array.isArray(value.tasks) || !Array.isArray(value.materials)
    || !value.groups || !Array.isArray(value.groups.groups) || !Array.isArray(value.groups.events)
    || !value.state || typeof value.state !== "object" || typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt))) throw new Error("不支持的 Tracelo 导入包格式或版本");
  serializeGroupArchive(value.groups);
  const groupIds = new Set<string>(); const groupNames = new Set<string>();
  for (const group of value.groups.groups) {
    if (!safeSegment(group.id) || groupIds.has(group.id) || groupNames.has(group.name)) throw new Error("导入包中有重复或无效分组");
    groupIds.add(group.id); groupNames.add(group.name);
  }
  const ids = new Set<string>();
  for (const task of value.tasks) {
    assertTask(task);
    if (ids.has(task.id) || task.events.some(e => !isValidDay(e.day)) || (task.groupId !== null && !groupIds.has(task.groupId))) throw new Error("导入包中有重复任务、无效日期或缺失分组");
    ids.add(task.id);
  }
  const paths = new Map<string, string>();
  for (const entry of value.materials) {
    if (!entry || !ids.has(entry.taskId) || !["file", "folder"].includes(entry.type) || typeof entry.path !== "string"
      || (entry.path === "" ? entry.type !== "folder" : !entry.path.split("/").every(safeSegment))) throw new Error("材料路径无效，已取消导入");
    const key = `${entry.taskId}/${canonicalPath(entry.path)}`;
    if (paths.has(key)) throw new Error("材料路径重名，已取消导入");
    paths.set(key, entry.type);
    if (entry.type === "file") {
      if (typeof entry.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data)
        || typeof entry.sha256 !== "string" || await digest(decode(entry.data)) !== entry.sha256) throw new Error("材料完整性校验失败，已取消导入");
    }
  }
  for (const entry of value.materials) {
    if (entry.path === "") continue;
    const parts = entry.path.split("/"); parts.pop();
    const parent = `${entry.taskId}/${canonicalPath(parts.join("/"))}`;
    if (paths.get(parent) !== "folder") throw new Error("材料目录结构不完整");
  }
  value.state = normalizePluginState(value.state);
  return value;
}

export function planImport(bundle: TransferBundle, existing: WorkTask[], current: GroupArchive) {
  const ids = new Set(existing.map(t => t.id));
  const groups = structuredClone(current);
  const mapping = new Map<string, string>();
  for (const group of bundle.groups.groups) {
    const sameName = groups.groups.find(g => g.name === group.name);
    if (sameName) mapping.set(group.id, sameName.id);
    else {
      const id = groups.groups.some(g => g.id === group.id) ? crypto.randomUUID() : group.id;
      groups.groups.push({ id, name: group.name }); mapping.set(group.id, id);
    }
  }
  for (const event of bundle.groups.events) {
    const incoming = { ...event, groupId: mapping.get(event.groupId) ?? event.groupId };
    if (groups.events.some(e => JSON.stringify({ ...e, id: "" }) === JSON.stringify({ ...incoming, id: "" }))) continue;
    const same = groups.events.find(e => e.id === incoming.id);
    if (same && JSON.stringify(same) === JSON.stringify(incoming)) continue;
    if (same) incoming.id = crypto.randomUUID();
    groups.events.push(incoming);
  }
  groups.events.sort((a, b) => a.at.localeCompare(b.at));
  const tasks = bundle.tasks.filter(t => !ids.has(t.id)).map(original => {
    const task = structuredClone(original);
    delete task.archiveName; delete task.materialFolder;
    if (task.groupId) { task.groupId = mapping.get(task.groupId)!; task.groupName = groups.groups.find(g => g.id === task.groupId)!.name; }
    return task;
  });
  const accepted = new Set(tasks.map(t => t.id));
  return { tasks, groups, mapping, skipped: bundle.tasks.length - tasks.length, materials: bundle.materials.filter(e => accepted.has(e.taskId)) };
}

interface ImportJournal {
  version: 1;
  taskIds: string[];
  groups: GroupArchive;
  state: PluginState;
  staging: string;
  moves: Array<{ from: string; to: string }>;
}

export async function recoverInterruptedImport(adapter: TransferAdapter, store: ArchiveStore,
  saveState?: (state: PluginState) => Promise<void>): Promise<PluginState | null> {
  const path = `${store.backupDirectory}/pending-import.json`;
  if (!await adapter.exists(path)) return null;
  const journal: ImportJournal = JSON.parse(await adapter.read(path));
  const prefix = `${store.backupDirectory}/import-staging/`;
  if (!journal || journal.version !== 1 || !Array.isArray(journal.taskIds) || !journal.taskIds.every(safeSegment)
    || typeof journal.staging !== "string" || !journal.staging.startsWith(prefix) || !safeSegment(journal.staging.slice(prefix.length))
    || !Array.isArray(journal.moves) || journal.moves.some(m => typeof m.from !== "string" || !m.from.startsWith(`${journal.staging}/`)
      || !journal.taskIds.includes(m.from.slice(journal.staging.length + 1)) || typeof m.to !== "string"
      || !m.to.startsWith(`${MATERIALS_DIRECTORY}/`) || !safeSegment(m.to.slice(MATERIALS_DIRECTORY.length + 1)))) throw new Error("导入恢复记录无效，请检查迁移备份");
  serializeGroupArchive(journal.groups);
  const state = normalizePluginState(journal.state);
  const loaded = await store.loadTasksSafe();
  if (loaded.errors.some(e => journal.taskIds.includes(e.taskId))) throw new Error("导入中断后存在损坏的任务，已保留恢复记录");
  for (const move of [...journal.moves].reverse()) {
    // Rename is the commit boundary: an absent staging directory means this move completed.
    if (!await adapter.exists(move.from) && await adapter.exists(move.to)) await adapter.rename(move.to, move.from);
  }
  for (const task of loaded.tasks.filter(t => journal.taskIds.includes(t.id))) await store.removeImportedTask(task);
  await store.saveGroups(journal.groups);
  if (saveState) await saveState(state);
  await adapter.remove(path);
  // Staging contains only this import's copies. The original import package remains untouched.
  if (await adapter.exists(journal.staging)) await adapter.rmdir(journal.staging, true);
  return state;
}

export async function importBundle(adapter: TransferAdapter, store: ArchiveStore, input: TransferBundle, existing: WorkTask[], groups: GroupArchive, state: PluginState,
  saveState?: (state: PluginState) => Promise<void>) {
  // Revalidate at commit, even if the UI already showed a preview.
  const bundle = await parseBundle(JSON.stringify(input));
  const plan = planImport(bundle, existing, groups);
  await store.backupLegacy({ tasks: existing, groups, state });
  const journalPath = `${store.backupDirectory}/pending-import.json`;
  if (await adapter.exists(journalPath)) throw new Error("上一次导入尚未恢复，请重新加载插件");
  const journal: ImportJournal = { version: 1, taskIds: plan.tasks.map(t => t.id), groups, state, staging: `${store.backupDirectory}/import-staging/${crypto.randomUUID()}`, moves: [] };
  await ensureFolder(adapter, journal.staging);
  const persistJournal = async () => {
    const text = JSON.stringify(journal);
    await adapter.write(journalPath, text);
    if (await adapter.read(journalPath) !== text) throw new Error("导入恢复记录校验失败");
  };
  await persistJournal();
  const nextState = structuredClone(state);
  try {
    for (const task of plan.tasks) {
      const entries = plan.materials.filter(e => e.taskId === task.id);
      if (entries.length) {
        const staging = `${journal.staging}/${task.id}`;
        await ensureFolder(adapter, staging);
        for (const entry of [...entries].sort((a, b) => a.path.split("/").length - b.path.split("/").length)) {
          const path = entry.path ? `${staging}/${entry.path}` : staging;
          if (entry.type === "folder") await ensureFolder(adapter, path);
          else {
            await adapter.writeBinary(path, decode(entry.data!));
            if (await digest(await adapter.readBinary(path)) !== entry.sha256) throw new Error(`材料写入校验失败：${entry.path}`);
          }
        }
      }
      await store.saveTask(task);
      if (entries.length) {
        const root = folderForTask(task);
        if (await adapter.exists(root)) throw new Error(`材料目标已存在：${root}`);
        await ensureFolder(adapter, MATERIALS_DIRECTORY);
        const move = { from: `${journal.staging}/${task.id}`, to: root };
        journal.moves.push(move); await persistJournal();
        await adapter.rename(move.from, move.to);
        task.materialFolder = root; await store.saveTask(task);
      }
      if (Object.hasOwn(bundle.state.drafts, task.id)) nextState.drafts[task.id] = bundle.state.drafts[task.id]!;
      nextState.orders = pinTask(nextState.orders, task);
    }
    if (!existing.length) nextState.viewMode = bundle.state.viewMode;
    const importedIds = new Set(plan.tasks.map(t => t.id));
    for (const mode of ["group", "quadrant"] as const) {
      for (const [area, order] of Object.entries(bundle.state.orders[mode])) {
        const target = mode === "group" ? plan.mapping.get(area) ?? area : area;
        const imported = order.filter(id => importedIds.has(id));
        const local = state.orders[mode][target] ?? [];
        const fallback = nextState.orders[mode][target] ?? [];
        nextState.orders[mode][target] = [...new Set([...local, ...imported, ...fallback])];
      }
    }
    await store.saveGroups(plan.groups);
    if (saveState) await saveState(nextState);
    await adapter.remove(journalPath);
  } catch (reason) {
    await recoverInterruptedImport(adapter, store, saveState);
    throw reason;
  }
  await adapter.rmdir(journal.staging, true).catch(() => {});
  return { tasks: [...existing, ...plan.tasks], groups: plan.groups, state: nextState, imported: plan.tasks.length, skipped: plan.skipped };
}
