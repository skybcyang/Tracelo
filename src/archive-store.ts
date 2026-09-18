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

export interface ArchiveAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, source: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  remove(path: string): Promise<void>;
  rmdir(path: string, recursive: boolean): Promise<void>;
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/");
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

export class ArchiveStore {
  constructor(
    private readonly adapter: ArchiveAdapter,
    readonly taskDirectory: string,
    readonly backupDirectory: string,
    private readonly agentSource: string,
  ) {}

  taskPath(taskId: string): string {
    return join(this.taskDirectory, `${taskId}.md`);
  }

  async initialize(): Promise<void> {
    await this.ensureFolder(this.taskDirectory);
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
    const tasks: WorkTask[] = [];
    const errors: Array<{ taskId: string; path: string; error: Error }> = [];
    for (const path of listing.files.filter(isTaskFile)) {
      const taskId = path.split("/").at(-1)!.slice(0, -3);
      const source = await this.adapter.read(path);
      try {
        const task = parseTaskMarkdown(source);
        if (task.id !== taskId) throw new Error("任务身份不匹配");
        tasks.push(task);
      } catch {
        try {
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

  async saveTask(task: WorkTask, now = new Date()): Promise<void> {
    await this.ensureFolder(this.taskDirectory);
    const source = serializeTaskMarkdown(task);
    await this.adapter.write(this.taskPath(task.id), source);
    const daily = join(this.backupDirectory, "daily", dayKey(now));
    await this.ensureFolder(daily);
    await this.adapter.write(join(daily, `${task.id}.md`), source);
    await this.pruneDailyBackups();
  }

  async saveGroups(archive: GroupArchive, now = new Date()): Promise<void> {
    await this.ensureFolder(this.taskDirectory);
    const source = serializeGroupArchive(archive);
    await this.adapter.write(join(this.taskDirectory, GROUPS_FILE), source);
    const daily = join(this.backupDirectory, "daily", dayKey(now));
    await this.ensureFolder(daily);
    await this.adapter.write(join(daily, GROUPS_FILE), source);
    await this.pruneDailyBackups();
  }

  async backupLegacy(value: unknown, now = new Date()): Promise<string> {
    const directory = join(this.backupDirectory, "migration");
    await this.ensureFolder(directory);
    const path = join(directory, `${stamp(now)}.json`);
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
