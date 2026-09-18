import {
  type GroupArchive,
  type GroupEvent,
  type TaskEvent,
  type TaskEventKind,
  type TaskOrders,
  type TaskStatus,
  type ViewMode,
  type WorkGroup,
  type WorkTask,
} from "./domain";

export const DEFAULT_TASK_DIRECTORY = "工作记录/任务";
export const AGENT_FILE = "agent.md";
export const GROUPS_FILE = "_groups.md";

export interface PluginState {
  version: 1;
  initialized: boolean;
  taskDirectory: string;
  drafts: Record<string, string>;
  orders: TaskOrders;
  viewMode: ViewMode;
  lastDailyBackup: string | null;
  pluginVersion: string | null;
}

export interface BackupCandidate {
  path: string;
  source: string;
}

export function createDefaultState(): PluginState {
  return {
    version: 1,
    initialized: false,
    taskDirectory: DEFAULT_TASK_DIRECTORY,
    drafts: {},
    orders: { group: {}, quadrant: {} },
    viewMode: "group",
    lastDailyBackup: null,
    pluginVersion: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function orderRecord(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, ids]) =>
    Array.isArray(ids) ? [[key, [...new Set(ids.filter((id): id is string => typeof id === "string"))]]] : [],
  ));
}

export function normalizePluginState(value: unknown): PluginState {
  const defaults = createDefaultState();
  if (!isRecord(value)) return defaults;
  const orders = isRecord(value.orders) ? value.orders : {};
  const taskDirectory = typeof value.taskDirectory === "string"
    ? value.taskDirectory.trim().replace(/^\/+|\/+$/g, "")
    : "";
  return {
    version: 1,
    initialized: value.initialized === true,
    taskDirectory: taskDirectory || defaults.taskDirectory,
    drafts: stringRecord(value.drafts),
    orders: {
      group: orderRecord(orders.group),
      quadrant: orderRecord(orders.quadrant),
    },
    viewMode: value.viewMode === "quadrant" ? "quadrant" : "group",
    lastDailyBackup: typeof value.lastDailyBackup === "string" ? value.lastDailyBackup : null,
    pluginVersion: typeof value.pluginVersion === "string" ? value.pluginVersion : null,
  };
}

const EVENT_LABELS: Record<TaskEventKind, string> = {
  created: "创建",
  renamed: "改名",
  progress: "进展",
  completed: "完成",
  closed: "异常关闭",
  reopened: "重新打开",
  group_changed: "分组变更",
  quadrant_changed: "象限变更",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  active: "进行中",
  completed: "已完成",
  closed: "异常关闭",
};

function inline(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/([\\`*_{}[\]<>])/g, "\\$1");
}

function taskBody(task: WorkTask): string {
  const properties = [
    `- 状态：${STATUS_LABELS[task.status]}`,
    `- 分组：${inline(task.groupName)}`,
    `- 象限：${task.important ? "重要" : "不重要"} · ${task.urgent ? "紧急" : "不紧急"}`,
  ].join("\n");
  const timeline = task.events.map((entry) =>
    `- ${entry.at} · **${EVENT_LABELS[entry.kind]}** · ${inline(entry.text)}`,
  ).join("\n");
  return `# ${inline(task.title)}\n\n${properties}\n\n## 时间线\n\n${timeline}\n`;
}

export function serializeTaskMarkdown(task: WorkTask): string {
  assertTask(task);
  return `<!-- work-timeline-task:v1\n${JSON.stringify(task, null, 2)}\n-->\n\n${taskBody(task)}`;
}

function isEvent(value: unknown): value is TaskEvent {
  if (!isRecord(value)) return false;
  const kinds: TaskEventKind[] = [
    "created", "renamed", "progress", "completed", "closed", "reopened", "group_changed", "quadrant_changed",
  ];
  return typeof value.id === "string"
    && kinds.includes(value.kind as TaskEventKind)
    && typeof value.text === "string"
    && typeof value.at === "string"
    && !Number.isNaN(Date.parse(value.at))
    && typeof value.day === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value.day)
    && typeof value.timezone === "string"
    && typeof value.offsetMinutes === "number"
    && typeof value.title === "string"
    && typeof value.groupName === "string"
    && typeof value.important === "boolean"
    && typeof value.urgent === "boolean"
    && (value.meta === undefined || isRecord(value.meta));
}

export function assertTask(value: unknown): asserts value is WorkTask {
  if (!isRecord(value)
    || value.version !== 1
    || typeof value.id !== "string"
    || !value.id
    || typeof value.title !== "string"
    || !value.title.trim()
    || !["active", "completed", "closed"].includes(String(value.status))
    || !(typeof value.groupId === "string" || value.groupId === null)
    || typeof value.groupName !== "string"
    || typeof value.important !== "boolean"
    || typeof value.urgent !== "boolean"
    || !Array.isArray(value.events)
    || value.events.length === 0
    || !value.events.every(isEvent)) {
    throw new Error("任务文件格式无效");
  }
  const ids = new Set<string>();
  let previous = "";
  for (const entry of value.events) {
    if (ids.has(entry.id) || entry.at < previous) throw new Error("任务历史顺序无效");
    ids.add(entry.id);
    previous = entry.at;
  }
}

export function parseTaskMarkdown(source: string): WorkTask {
  const match = source.match(/^<!-- work-timeline-task:v1\n([\s\S]*?)\n-->\n\n/);
  if (!match?.[1]) throw new Error("任务文件格式无效");
  let value: unknown;
  try {
    value = JSON.parse(match[1]);
  } catch {
    throw new Error("任务文件格式无效");
  }
  assertTask(value);
  if (serializeTaskMarkdown(value) !== source) throw new Error("任务文件已被外部修改");
  return value;
}

export function isTaskFile(path: string): boolean {
  const name = path.split("/").at(-1) ?? "";
  return name.endsWith(".md") && name !== AGENT_FILE && name !== GROUPS_FILE && name.length > 3;
}

function isGroup(value: unknown): value is WorkGroup {
  return isRecord(value) && typeof value.id === "string" && Boolean(value.id)
    && typeof value.name === "string" && Boolean(value.name.trim());
}

function isGroupEvent(value: unknown): value is GroupEvent {
  return isRecord(value)
    && typeof value.id === "string"
    && ["group_created", "group_renamed", "group_deleted"].includes(String(value.kind))
    && typeof value.groupId === "string"
    && typeof value.at === "string"
    && typeof value.day === "string"
    && typeof value.timezone === "string"
    && typeof value.offsetMinutes === "number"
    && isRecord(value.meta);
}

export function serializeGroupArchive(archive: GroupArchive): string {
  if (archive.version !== 1 || !archive.groups.every(isGroup) || !archive.events.every(isGroupEvent)) {
    throw new Error("分组文件格式无效");
  }
  const groups = archive.groups.length
    ? archive.groups.map((group, index) => `${index + 1}. ${inline(group.name)}`).join("\n")
    : "暂无分组";
  const history = archive.events.length
    ? archive.events.map((entry) => `- ${entry.at} · ${entry.kind} · ${inline(JSON.stringify(entry.meta))}`).join("\n")
    : "暂无记录";
  return `<!-- work-timeline-groups:v1\n${JSON.stringify(archive, null, 2)}\n-->\n\n# 任务分组\n\n${groups}\n\n## 变更记录\n\n${history}\n`;
}

export function parseGroupArchive(source: string): GroupArchive {
  const match = source.match(/^<!-- work-timeline-groups:v1\n([\s\S]*?)\n-->\n\n/);
  if (!match?.[1]) throw new Error("分组文件格式无效");
  let value: unknown;
  try {
    value = JSON.parse(match[1]);
  } catch {
    throw new Error("分组文件格式无效");
  }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.groups)
    || !value.groups.every(isGroup) || !Array.isArray(value.events) || !value.events.every(isGroupEvent)) {
    throw new Error("分组文件格式无效");
  }
  const archive = value as unknown as GroupArchive;
  if (serializeGroupArchive(archive) !== source) throw new Error("分组文件已被外部修改");
  return archive;
}

export function pickLatestValidBackup(
  taskId: string,
  candidates: BackupCandidate[],
): (BackupCandidate & { task: WorkTask }) | null {
  for (const candidate of [...candidates].sort((left, right) => right.path.localeCompare(left.path))) {
    try {
      const task = parseTaskMarkdown(candidate.source);
      if (task.id === taskId) return { ...candidate, task };
    } catch {
      // Continue to older valid backups.
    }
  }
  return null;
}
