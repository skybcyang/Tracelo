import {
  AGENT_FILE,
  GROUPS_FILE,
  isTaskFile,
  parseGroupArchive,
  parseTaskMarkdown,
  pickLatestValidBackup,
  serializeGroupArchive,
  serializeTaskMarkdown,
} from "./archive";
import { dayKey, type GroupArchive, type WorkTask } from "./domain";
import { LEGACY_AGENT_RULE } from "./agent-rule";
import { assertTaskFolder, canonicalPath, MATERIALS_DIRECTORY, relocateTaskReferences, safeSegment, taskBaseName } from "./storage-names";

export interface ArchiveAdapter {
  readBinary?(path: string): Promise<ArrayBuffer>;
  writeBinary?(path: string, data: ArrayBuffer): Promise<void>;
  /** Obsidian copy rejects an existing destination, unlike rename. */
  copy?(path: string, next: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, source: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  remove(path: string): Promise<void>;
  rmdir(path: string, recursive: boolean): Promise<void>;
  rename(path: string, next: string): Promise<void>;
  stat(path: string): Promise<{ type: "file" | "folder"; size: number } | null>;
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/");
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

interface SaveJournal {
  version: 1;
  taskId: string;
  oldPath: string;
  path: string;
  oldSource: string | null;
  oldFolder: string;
  nextFolder: string;
  hasFolder: boolean;
  backupPath: string;
  previousBackup: string | null;
  createdFolder?: boolean;
  folderMoved?: boolean;
  targetSource?: string;
  stagedPath?: string;
}

export class ArchiveStore {
  private readonly paths = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private pruningSuspensions = 0;
  constructor(
    private readonly adapter: ArchiveAdapter,
    readonly taskDirectory: string,
    readonly backupDirectory: string,
    private readonly agentSource: string,
    private readonly beforeWrite: (path: string) => void = () => {},
  ) {}

  taskPath(taskId: string): string {
    if (!safeSegment(taskId)) throw new Error("无效任务 ID");
    return this.paths.get(taskId) ?? join(this.taskDirectory, `${taskId}.md`);
  }

  taskIdFromPath(path: string): string | null {
    return [...this.paths].find(([, value]) => value === path)?.[0] ?? null;
  }

  suspendBackupPruning(): () => void {
    this.pruningSuspensions++;
    let resumed = false;
    return () => { if (!resumed) { resumed = true; this.pruningSuspensions--; } };
  }

  taskFolderPath(task: WorkTask): string {
    assertTaskFolder(task, this.taskDirectory);
    return task.materialFolder ?? join(this.taskDirectory, task.archiveName ?? task.id);
  }

  async ensureTaskFolder(task: WorkTask): Promise<WorkTask> {
    const operation = this.queue.then(async () => { await this.writeTask(task, new Date(), true); return task; });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }

  saveNoteAttachment(task: WorkTask, filename: string, data: ArrayBuffer): Promise<{ task: WorkTask; path: string }> {
    const operation = this.queue.then(() => this.writeNoteAttachment(task, filename, data));
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }

  private async writeNoteAttachment(task: WorkTask, filename: string, data: ArrayBuffer): Promise<{ task: WorkTask; path: string }> {
    if (!this.adapter.writeBinary || !this.adapter.readBinary) throw new Error("当前文件系统不支持图片附件");
    const extension = filename.split(".").at(-1)?.toLowerCase();
    if (!extension || !["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"].includes(extension)) throw new Error("不支持的图片格式");
    await this.writeTask(task, new Date(), true);
    const name = `image-${crypto.randomUUID()}.${extension}`;
    const path = join(this.taskFolderPath(task), name);
    await this.adapter.writeBinary(path, data);
    const written = new Uint8Array(await this.adapter.readBinary(path));
    if (written.length !== data.byteLength || written.some((byte, i) => byte !== new Uint8Array(data)[i])) throw new Error("图片写入校验失败");
    await this.backupMaterials(task, join(this.backupDirectory, "daily", dayKey(new Date())));
    return { task, path: name };
  }

  private isCandidate(path: string): boolean {
    if (!path.startsWith(`${this.taskDirectory}/`) || !isTaskFile(path)) return false;
    const parts = path.slice(this.taskDirectory.length + 1).split("/");
    return parts.length === 1 || (parts.length === 2 && parts[1] === `${parts[0]}.md`);
  }

  async ingestTaskFile(path: string, now = new Date()): Promise<WorkTask | null> {
    const operation = this.queue.then(async () => {
      if (!this.isCandidate(path) || this.taskIdFromPath(path)) return null;
      const source = await this.adapter.read(path);
      const task = parseTaskMarkdown(source);
      assertTaskFolder(task, this.taskDirectory);
      if (path.split("/").at(-1) !== `${task.archiveName ?? task.id}.md`) throw new Error("任务文件名与存档身份不匹配");
      if (this.paths.has(task.id)) throw new Error("新增文件使用了已有任务 ID，已忽略且未覆盖原任务");
      const parent = path.slice(0, path.lastIndexOf("/"));
      if (parent !== this.taskDirectory && task.materialFolder !== parent) throw new Error("任务文件夹与存档路径不匹配");
      const daily = join(this.backupDirectory, "daily", dayKey(now));
      await this.ensureFolder(daily);
      await this.adapter.write(join(daily, `${task.id}.md`), source);
      if (await this.adapter.read(join(daily, `${task.id}.md`)) !== source) throw new Error("外部新增任务备份校验失败");
      await this.backupMaterials(task, daily);
      this.paths.set(task.id, path);
      return task;
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }

  async initialize(): Promise<void> {
    await this.ensureFolder(this.taskDirectory);
    await this.recoverPendingSaves();
    const agentPath = join(this.taskDirectory, AGENT_FILE);
    if (!await this.adapter.exists(agentPath) || (await this.adapter.read(agentPath)).trim() === LEGACY_AGENT_RULE.trim()) {
      await this.adapter.write(agentPath, this.agentSource);
    }
    const groupsPath = join(this.taskDirectory, GROUPS_FILE);
    if (!await this.adapter.exists(groupsPath)) {
      await this.adapter.write(groupsPath, serializeGroupArchive({ version: 1, groups: [], events: [] }));
    }
  }

  async loadTasksSafe(now = new Date()): Promise<{
    tasks: WorkTask[];
    errors: Array<{ taskId: string; path: string; error: Error }>;
  }> {
    await this.initialize();
    const listing = await this.adapter.list(this.taskDirectory);
    const backupIds = await this.backupIdentities();
    const tasks: WorkTask[] = [];
    const errors: Array<{ taskId: string; path: string; error: Error }> = [];
    const candidates = [...listing.files];
    for (const folder of listing.folders) {
      const path = join(folder, `${folder.split("/").at(-1)}.md`);
      if (await this.adapter.exists(path)) candidates.push(path);
    }
    for (const path of candidates.filter(path => this.isCandidate(path))) {
      const name = path.split("/").at(-1)!.slice(0, -3);
      let taskId = backupIds.get(name) ?? name;
      const source = await this.adapter.read(path);
      try {
        const task = parseTaskMarkdown(source);
        assertTaskFolder(task, this.taskDirectory);
        if ((task.archiveName ?? task.id) !== name) throw new Error("任务身份不匹配");
        taskId = task.id;
        if (tasks.some(t => t.id === taskId)) throw new Error("重复的任务 ID");
        this.paths.set(taskId, path);
        tasks.push(task);
      } catch {
        try {
          if (tasks.some(t => t.id === taskId)) throw new Error("重复的任务 ID");
          this.paths.set(taskId, path);
          tasks.push(await this.recoverTask(taskId, source, now));
        } catch (reason) {
          errors.push({
            taskId,
            path,
            error: reason instanceof Error ? reason : new Error("任务无法恢复"),
          });
        }
      }
    }
    return { tasks, errors };
  }

  async loadGroups(): Promise<GroupArchive> {
    await this.initialize();
    return parseGroupArchive(await this.adapter.read(join(this.taskDirectory, GROUPS_FILE)));
  }

  saveTask(task: WorkTask, now = new Date()): Promise<void> {
    const operation = this.queue.then(() => this.writeTask(task, now));
    this.queue = operation.catch(() => {});
    return operation;
  }

  private async writeTask(task: WorkTask, now: Date, createFolder = false): Promise<void> {
    assertTaskFolder(task, this.taskDirectory);
    await this.ensureFolder(this.taskDirectory);
    const oldPath = this.taskPath(task.id);
    const oldSource = await this.adapter.exists(oldPath) ? await this.adapter.read(oldPath) : null;
    if (oldSource && parseTaskMarkdown(oldSource).id !== task.id) throw new Error("目标文件属于另一项任务");
    const oldName = oldPath.split("/").at(-1)!.slice(0, -3);
    const base = taskBaseName(task);
    const taskListing = await this.adapter.list(this.taskDirectory);
    const materials = await this.adapter.exists(MATERIALS_DIRECTORY) ? await this.adapter.list(MATERIALS_DIRECTORY) : { files: [], folders: [] };
    const oldFolder = task.materialFolder ?? (oldPath.split("/").length > this.taskDirectory.split("/").length + 1
      ? oldPath.slice(0, oldPath.lastIndexOf("/")) : `${MATERIALS_DIRECTORY}/${task.archiveName ?? oldName}`);
    const hasFolder = Boolean(oldSource || task.materialFolder || task.archiveName) && (await this.adapter.stat(oldFolder))?.type === "folder";
    if (task.materialFolder && !hasFolder && !createFolder) throw new Error("任务文件夹缺失，请恢复目录后重试");
    const occupied = new Set([...taskListing.files, ...taskListing.folders, ...materials.files, ...materials.folders]
      .filter(p => p !== oldPath && !(hasFolder && p === oldFolder)).map(canonicalPath));
    let name = base;
    // Keep a previously allocated suffix when saving unchanged tasks.
    const preferred = task.archiveName ?? oldName;
    if (preferred === base || (preferred.startsWith(`${base}（`) && /^\d+）$/.test(preferred.slice(base.length + 1)))) name = preferred;
    for (let n = 2; occupied.has(canonicalPath(`${this.taskDirectory}/${name}.md`)) || occupied.has(canonicalPath(`${this.taskDirectory}/${name}`)) || occupied.has(canonicalPath(`${MATERIALS_DIRECTORY}/${name}`)); n++) name = `${base}（${n}）`;
    const nextFolder = `${this.taskDirectory}/${name}`;
    const useFolder = hasFolder || createFolder;
    const path = useFolder ? `${nextFolder}/${name}.md` : `${this.taskDirectory}/${name}.md`;
    if (hasFolder && await this.adapter.exists(join(oldFolder, `${name}.md`)) && join(oldFolder, `${name}.md`) !== oldPath) throw new Error("材料中有同名 Markdown，请先改名该材料后再重试");
    const next = { ...task, archiveName: name };
    if (useFolder) next.materialFolder = nextFolder;
    if (next.notes) next.notes = relocateTaskReferences(next.notes, oldFolder, nextFolder);
    const source = serializeTaskMarkdown(next);
    const daily = join(this.backupDirectory, "daily", dayKey(now));
    await this.ensureFolder(daily);
    const backupPath = join(daily, `${task.id}.md`);
    const previousBackup = await this.adapter.exists(backupPath) ? await this.adapter.read(backupPath) : null;
    if (oldSource && path !== oldPath) {
      const snapshot = await this.backupLegacy({ task: parseTaskMarkdown(oldSource), oldPath, path, oldFolder, nextFolder }, now);
      if (hasFolder) await this.copyTree(oldFolder, `${snapshot}.materials`);
    }
    this.beforeWrite(oldPath); this.beforeWrite(path);
    const stagedPath = `${this.backupDirectory}/pending-names/${task.id}.md`;
    const journal: SaveJournal = { version: 1, taskId: task.id, oldPath, path, oldSource, oldFolder, nextFolder, hasFolder, backupPath, previousBackup, createdFolder: useFolder && !hasFolder, targetSource: source, stagedPath };
    const pending = `${this.backupDirectory}/pending-names/${task.id}.json`;
    await this.ensureFolder(`${this.backupDirectory}/pending-names`);
    if (await this.adapter.exists(pending)) throw new Error("存在未恢复的写入，请重新加载插件后重试");
    await this.adapter.write(pending, JSON.stringify(journal));
    if (await this.adapter.read(pending) !== JSON.stringify(journal)) throw new Error("写入恢复记录校验失败");
    try {
      if (hasFolder && oldFolder !== nextFolder) {
        await this.adapter.rename(oldFolder, nextFolder);
        journal.folderMoved = true;
        await this.adapter.write(pending, JSON.stringify(journal));
      }
      if (journal.createdFolder) await this.ensureFolder(nextFolder);
      const movedOldPath = hasFolder && oldPath.startsWith(`${oldFolder}/`) ? nextFolder + oldPath.slice(oldFolder.length) : oldPath;
      if (oldSource && path === movedOldPath) await this.adapter.write(path, source);
      else {
        if (await this.adapter.exists(path)) throw new Error("目标文件已被其他文件占用，未覆盖");
        await this.adapter.write(stagedPath, source);
        if (await this.adapter.read(stagedPath) !== source) throw new Error("任务写入校验失败");
        if (await this.adapter.exists(path)) throw new Error("目标文件已被其他文件占用，未覆盖");
        if (this.adapter.copy) {
          await this.adapter.copy(stagedPath, path);
          await this.adapter.remove(stagedPath);
        } else await this.adapter.rename(stagedPath, path);
      }
      if (await this.adapter.read(path) !== source) throw new Error("任务写入校验失败");
      await this.adapter.write(backupPath, source);
      if (await this.adapter.read(backupPath) !== source) throw new Error("备份校验失败");
      if (oldSource && movedOldPath !== path && await this.adapter.exists(movedOldPath)) await this.adapter.remove(movedOldPath);
      await this.backupMaterials(next, daily);
      await this.adapter.remove(pending);
    } catch (reason) {
      await this.rollbackSave(journal);
      await this.adapter.remove(pending);
      throw reason;
    }
    Object.assign(task, next);
    this.paths.set(task.id, path);
    // Retention failure must not turn a committed task save into a failed operation.
    await this.pruneDailyBackups().catch(() => {});
  }

  private async rollbackSave(journal: SaveJournal): Promise<void> {
    const { oldPath, path, oldSource, oldFolder, nextFolder, hasFolder, backupPath, previousBackup } = journal;
    this.beforeWrite(path); this.beforeWrite(oldPath);
    if (journal.stagedPath && await this.adapter.exists(journal.stagedPath)) await this.adapter.remove(journal.stagedPath);
    const oldFolderExists = hasFolder && await this.adapter.exists(oldFolder);
    if (hasFolder && oldFolder !== nextFolder && oldFolderExists && await this.adapter.exists(nextFolder)) {
      if (journal.folderMoved) throw new Error("恢复时发现同名材料目录，请保留两份目录并检查迁移备份");
      // The directory move never committed. The competing target belongs to somebody else.
      return;
    }
    if (path !== oldPath && await this.adapter.exists(path)
      && (journal.targetSource === undefined || await this.adapter.read(path) === journal.targetSource)) await this.adapter.remove(path);
    if (hasFolder && oldFolder !== nextFolder && await this.adapter.exists(nextFolder)) {
      if (await this.adapter.exists(oldFolder)) throw new Error("恢复时发现同名材料目录，请保留两份目录并检查迁移备份");
      await this.adapter.rename(nextFolder, oldFolder);
    }
    if (oldSource) await this.adapter.write(oldPath, oldSource);
    if (!oldSource && await this.adapter.exists(path)
      && (journal.targetSource === undefined || await this.adapter.read(path) === journal.targetSource)) await this.adapter.remove(path);
    if (journal.createdFolder && await this.adapter.exists(nextFolder)) {
      const contents = await this.adapter.list(nextFolder);
      if (!contents.files.length && !contents.folders.length) await this.adapter.rmdir(nextFolder, true);
    }
    if (previousBackup) await this.adapter.write(backupPath, previousBackup);
    else if (await this.adapter.exists(backupPath)) await this.adapter.remove(backupPath);
  }

  private async recoverPendingSaves(): Promise<void> {
    const directory = `${this.backupDirectory}/pending-names`;
    if (!await this.adapter.exists(directory)) return;
    for (const path of (await this.adapter.list(directory)).files.filter(path => path.endsWith(".json"))) {
      const journal: SaveJournal = JSON.parse(await this.adapter.read(path));
      const inside = (value: unknown, root: string) => typeof value === "string" && value.startsWith(`${root}/`) && value.slice(root.length + 1).split("/").every(safeSegment);
      if (!journal || journal.version !== 1 || !safeSegment(journal.taskId)
        || !inside(journal.oldPath, this.taskDirectory) || !inside(journal.path, this.taskDirectory)
        || !(inside(journal.oldFolder, MATERIALS_DIRECTORY) || inside(journal.oldFolder, this.taskDirectory))
        || !(inside(journal.nextFolder, MATERIALS_DIRECTORY) || inside(journal.nextFolder, this.taskDirectory))
        || !journal.backupPath?.startsWith(`${this.backupDirectory}/daily/`)
        || !/^\d{4}-\d{2}-\d{2}\/$/.test(journal.backupPath.slice(`${this.backupDirectory}/daily/`.length, -`${journal.taskId}.md`.length))
        || !journal.backupPath.endsWith(`/${journal.taskId}.md`)
        || (journal.oldSource !== null && parseTaskMarkdown(journal.oldSource).id !== journal.taskId)
        || (journal.stagedPath !== undefined && journal.stagedPath !== `${directory}/${journal.taskId}.md`)
        || (journal.targetSource !== undefined && parseTaskMarkdown(journal.targetSource).id !== journal.taskId)
        || (journal.previousBackup !== null && typeof journal.previousBackup !== "string")) throw new Error("写入恢复记录无效，请检查迁移备份");
      await this.rollbackSave(journal);
      await this.adapter.remove(path);
    }
  }

  private async backupIdentities(): Promise<Map<string, string>> {
    const identities = new Map<string, string>();
    const daily = join(this.backupDirectory, "daily");
    if (!await this.adapter.exists(daily)) return identities;
    for (const folder of (await this.adapter.list(daily)).folders.sort()) {
      for (const path of (await this.adapter.list(folder)).files.filter(isTaskFile)) {
        try { const task = parseTaskMarkdown(await this.adapter.read(path)); identities.set(task.archiveName ?? task.id, task.id); } catch { /* Ignore invalid backups. */ }
      }
    }
    return identities;
  }

  async migrateTaskNames(tasks: WorkTask[]): Promise<void> {
    const legacy: WorkTask[] = [];
    for (const task of tasks) {
      if (!task.archiveName || task.materialFolder?.startsWith(`${MATERIALS_DIRECTORY}/`)
        || (!task.materialFolder && (await this.adapter.stat(`${MATERIALS_DIRECTORY}/${task.archiveName}`))?.type === "folder")) legacy.push(task);
    }
    if (!legacy.length) return;
    await this.backupLegacy({ tasks, paths: Object.fromEntries(this.paths) });
    for (const task of legacy) await this.saveTask(task);
  }

  async removeImportedTask(task: WorkTask): Promise<void> {
    const path = this.taskPath(task.id);
    this.beforeWrite(path);
    if (await this.adapter.exists(path)) await this.adapter.remove(path);
    this.paths.delete(task.id);
    const daily = join(this.backupDirectory, "daily");
    if (await this.adapter.exists(daily)) for (const folder of (await this.adapter.list(daily)).folders) {
      const backup = join(folder, `${task.id}.md`);
      if (await this.adapter.exists(backup)) await this.adapter.remove(backup);
    }
  }

  async saveGroups(archive: GroupArchive, now = new Date()): Promise<void> {
    await this.ensureFolder(this.taskDirectory);
    const source = serializeGroupArchive(archive);
    this.beforeWrite(join(this.taskDirectory, GROUPS_FILE));
    await this.adapter.write(join(this.taskDirectory, GROUPS_FILE), source);
    const daily = join(this.backupDirectory, "daily", dayKey(now));
    await this.ensureFolder(daily);
    await this.adapter.write(join(daily, GROUPS_FILE), source);
    await this.pruneDailyBackups();
  }

  async backupLegacy(value: unknown, now = new Date()): Promise<string> {
    const directory = join(this.backupDirectory, "migration");
    await this.ensureFolder(directory);
    let path = join(directory, `${stamp(now)}.json`);
    for (let n = 2; await this.adapter.exists(path); n++) path = join(directory, `${stamp(now)}-${n}.json`);
    const source = JSON.stringify(value ?? null, null, 2);
    await this.adapter.write(path, source);
    if (await this.adapter.read(path) !== source) throw new Error("旧数据备份校验失败");
    return path;
  }

  async backupUpgrade(
    tasks: WorkTask[],
    groups: GroupArchive,
    state: unknown,
    version: string,
    now = new Date(),
  ): Promise<string> {
    const directory = join(this.backupDirectory, "upgrade", `${stamp(now)}-${version}`);
    await this.ensureFolder(directory);
    for (const task of tasks) {
      assertTaskFolder(task, this.taskDirectory);
      await this.adapter.write(join(directory, `${task.id}.md`), serializeTaskMarkdown(task));
      await this.backupMaterials(task, directory);
    }
    await this.adapter.write(join(directory, GROUPS_FILE), serializeGroupArchive(groups));
    await this.adapter.write(join(directory, "state.json"), JSON.stringify(state, null, 2));
    await this.adapter.write(join(directory, AGENT_FILE), this.agentSource);
    return directory;
  }

  async recoverTask(taskId: string, externalSource?: string, now = new Date()): Promise<WorkTask> {
    if (externalSource !== undefined) {
      const directory = join(this.backupDirectory, "external", dayKey(now));
      await this.ensureFolder(directory);
      await this.adapter.write(join(directory, `${stamp(now)}-${taskId}.md`), externalSource);
    }
    const dailyPath = join(this.backupDirectory, "daily");
    const candidates: Array<{ path: string; source: string }> = [];
    if (await this.adapter.exists(dailyPath)) {
      const daily = await this.adapter.list(dailyPath);
      for (const folder of daily.folders) {
        const path = join(folder, `${taskId}.md`);
        if (await this.adapter.exists(path)) candidates.push({ path, source: await this.adapter.read(path) });
      }
    }
    const picked = pickLatestValidBackup(taskId, candidates);
    if (!picked) throw new Error(`任务 ${taskId} 没有可用备份，已暂停写入`);
    assertTaskFolder(picked.task, this.taskDirectory);
    await this.ensureFolder(this.taskDirectory);
    const path = this.paths.get(taskId) ?? (picked.task.materialFolder
      ? join(picked.task.materialFolder, `${picked.task.archiveName ?? taskId}.md`)
      : join(this.taskDirectory, `${picked.task.archiveName ?? taskId}.md`));
    await this.ensureFolder(path.slice(0, path.lastIndexOf("/")));
    if (picked.task.materialFolder) await this.copyTree(join(picked.path.slice(0, picked.path.lastIndexOf("/")), "attachments", taskId), picked.task.materialFolder, true);
    await this.adapter.write(path, picked.source);
    this.paths.set(taskId, path);
    return picked.task;
  }

  private async backupMaterials(task: WorkTask, directory: string): Promise<void> {
    if (!task.materialFolder) return;
    await this.copyTree(task.materialFolder, join(directory, "attachments", task.id), false, `${task.archiveName ?? task.id}.md`);
  }

  private async copyTree(from: string, to: string, missingOnly = false, excluded?: string): Promise<void> {
    if (!await this.adapter.exists(from)) return;
    const listing = await this.adapter.list(from);
    await this.ensureFolder(to);
    for (const file of listing.files) {
      const name = file.split("/").at(-1)!;
      if (name === excluded) continue;
      const target = join(to, name);
      if (missingOnly && await this.adapter.exists(target)) continue;
      if (this.adapter.readBinary && this.adapter.writeBinary) {
        const data = await this.adapter.readBinary(file);
        await this.adapter.writeBinary(target, data);
        const verified = new Uint8Array(await this.adapter.readBinary(target));
        const expected = new Uint8Array(data);
        if (verified.length !== expected.length || verified.some((byte, i) => byte !== expected[i])) throw new Error(`附件备份校验失败：${file}`);
      } else await this.adapter.write(target, await this.adapter.read(file));
    }
    for (const folder of listing.folders) await this.copyTree(folder, join(to, folder.split("/").at(-1)!), missingOnly);
  }

  private async pruneDailyBackups(): Promise<void> {
    if (this.pruningSuspensions > 0) return;
    const path = join(this.backupDirectory, "daily");
    const folders = (await this.adapter.list(path)).folders.sort();
    for (const folder of folders.slice(0, Math.max(0, folders.length - 7))) {
      await this.adapter.rmdir(folder, true);
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const part of path.split("/").filter(Boolean)) {
      current = join(current, part);
      if (!await this.adapter.exists(current)) await this.adapter.mkdir(current);
    }
  }
}
