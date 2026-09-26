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
import { canonicalPath, MATERIALS_DIRECTORY, safeSegment, taskBaseName } from "./storage-names";

export interface ArchiveAdapter {
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
}

export class ArchiveStore {
  private readonly paths = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
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

  async initialize(): Promise<void> {
    await this.ensureFolder(this.taskDirectory);
    await this.recoverPendingSaves();
    const agentPath = join(this.taskDirectory, AGENT_FILE);
    if (!await this.adapter.exists(agentPath)) await this.adapter.write(agentPath, this.agentSource);
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
    for (const path of listing.files.filter(isTaskFile)) {
      const name = path.split("/").at(-1)!.slice(0, -3);
      let taskId = backupIds.get(name) ?? name;
      const source = await this.adapter.read(path);
      try {
        const task = parseTaskMarkdown(source);
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

  private async writeTask(task: WorkTask, now: Date): Promise<void> {
    await this.ensureFolder(this.taskDirectory);
    const oldPath = this.taskPath(task.id);
    const oldSource = await this.adapter.exists(oldPath) ? await this.adapter.read(oldPath) : null;
    if (oldSource && parseTaskMarkdown(oldSource).id !== task.id) throw new Error("目标文件属于另一项任务");
    const oldName = oldPath.split("/").at(-1)!.slice(0, -3);
    const base = taskBaseName(task);
    const taskListing = await this.adapter.list(this.taskDirectory);
    const materials = await this.adapter.exists(MATERIALS_DIRECTORY) ? await this.adapter.list(MATERIALS_DIRECTORY) : { files: [], folders: [] };
    const oldFolder = task.materialFolder ?? `${MATERIALS_DIRECTORY}/${task.archiveName ?? oldName}`;
    const hasFolder = Boolean(oldSource || task.materialFolder || task.archiveName) && (await this.adapter.stat(oldFolder))?.type === "folder";
    const occupied = new Set([...taskListing.files, ...taskListing.folders, ...materials.files, ...materials.folders]
      .filter(p => p !== oldPath && !(hasFolder && p === oldFolder)).map(canonicalPath));
    let name = base;
    // Keep a previously allocated suffix when saving unchanged tasks.
    const preferred = task.archiveName ?? oldName;
    if (preferred === base || (preferred.startsWith(`${base}（`) && /^\d+）$/.test(preferred.slice(base.length + 1)))) name = preferred;
    for (let n = 2; occupied.has(canonicalPath(`${this.taskDirectory}/${name}.md`)) || occupied.has(canonicalPath(`${MATERIALS_DIRECTORY}/${name}`)); n++) name = `${base}（${n}）`;
    const path = `${this.taskDirectory}/${name}.md`;
    const nextFolder = `${MATERIALS_DIRECTORY}/${name}`;
    const next = { ...task, archiveName: name };
    if (hasFolder || task.materialFolder) next.materialFolder = nextFolder;
    const source = serializeTaskMarkdown(next);
    const daily = join(this.backupDirectory, "daily", dayKey(now));
    await this.ensureFolder(daily);
    const backupPath = join(daily, `${task.id}.md`);
    const previousBackup = await this.adapter.exists(backupPath) ? await this.adapter.read(backupPath) : null;
    if (oldSource && path !== oldPath) await this.backupLegacy({ task: parseTaskMarkdown(oldSource), oldPath, path, oldFolder, nextFolder }, now);
    this.beforeWrite(oldPath); this.beforeWrite(path);
    const journal: SaveJournal = { version: 1, taskId: task.id, oldPath, path, oldSource, oldFolder, nextFolder, hasFolder, backupPath, previousBackup };
    const pending = `${this.backupDirectory}/pending-names/${task.id}.json`;
    await this.ensureFolder(`${this.backupDirectory}/pending-names`);
    if (await this.adapter.exists(pending)) throw new Error("存在未恢复的写入，请重新加载插件后重试");
    await this.adapter.write(pending, JSON.stringify(journal));
    if (await this.adapter.read(pending) !== JSON.stringify(journal)) throw new Error("写入恢复记录校验失败");
    try {
      if (hasFolder && oldFolder !== nextFolder) await this.adapter.rename(oldFolder, nextFolder);
      await this.adapter.write(path, source);
      if (await this.adapter.read(path) !== source) throw new Error("任务写入校验失败");
      await this.adapter.write(backupPath, source);
      if (await this.adapter.read(backupPath) !== source) throw new Error("备份校验失败");
      if (oldSource && oldPath !== path) await this.adapter.remove(oldPath);
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
    if (hasFolder && oldFolder !== nextFolder && await this.adapter.exists(nextFolder)) {
      if (await this.adapter.exists(oldFolder)) throw new Error("恢复时发现同名材料目录，请保留两份目录并检查迁移备份");
      await this.adapter.rename(nextFolder, oldFolder);
    }
    if (oldSource) await this.adapter.write(oldPath, oldSource);
    if ((path !== oldPath || !oldSource) && await this.adapter.exists(path)) await this.adapter.remove(path);
    if (previousBackup) await this.adapter.write(backupPath, previousBackup);
    else if (await this.adapter.exists(backupPath)) await this.adapter.remove(backupPath);
  }

  private async recoverPendingSaves(): Promise<void> {
    const directory = `${this.backupDirectory}/pending-names`;
    if (!await this.adapter.exists(directory)) return;
    for (const path of (await this.adapter.list(directory)).files) {
      const journal: SaveJournal = JSON.parse(await this.adapter.read(path));
      const inside = (value: unknown, root: string) => typeof value === "string" && value.startsWith(`${root}/`) && safeSegment(value.slice(root.length + 1));
      if (!journal || journal.version !== 1 || !safeSegment(journal.taskId)
        || !inside(journal.oldPath, this.taskDirectory) || !inside(journal.path, this.taskDirectory)
        || !inside(journal.oldFolder, MATERIALS_DIRECTORY) || !inside(journal.nextFolder, MATERIALS_DIRECTORY)
        || !journal.backupPath?.startsWith(`${this.backupDirectory}/daily/`)
        || !/^\d{4}-\d{2}-\d{2}\/$/.test(journal.backupPath.slice(`${this.backupDirectory}/daily/`.length, -`${journal.taskId}.md`.length))
        || !journal.backupPath.endsWith(`/${journal.taskId}.md`)
        || (journal.oldSource !== null && parseTaskMarkdown(journal.oldSource).id !== journal.taskId)
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
    const legacy = tasks.filter(task => !task.archiveName);
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
      await this.adapter.write(join(directory, `${task.id}.md`), serializeTaskMarkdown(task));
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
    await this.ensureFolder(this.taskDirectory);
    await this.adapter.write(this.taskPath(taskId), picked.source);
    return picked.task;
  }

  private async pruneDailyBackups(): Promise<void> {
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
