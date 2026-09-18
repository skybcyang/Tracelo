export type TaskStatus = "active" | "completed" | "closed";
export type TaskEventKind =
  | "created"
  | "renamed"
  | "progress"
  | "completed"
  | "closed"
  | "reopened"
  | "group_changed"
  | "quadrant_changed";
export type ViewMode = "group" | "quadrant";
export type QuadrantId =
  | "important_urgent"
  | "important_not_urgent"
  | "not_important_urgent"
  | "not_important_not_urgent";

export type EventMeta = Record<string, string | boolean | null>;

export interface TaskEvent {
  id: string;
  kind: TaskEventKind;
  text: string;
  at: string;
  day: string;
  timezone: string;
  offsetMinutes: number;
  title: string;
  groupName: string;
  important: boolean;
  urgent: boolean;
  meta?: EventMeta;
}

export interface WorkTask {
  version: 1;
  id: string;
  title: string;
  status: TaskStatus;
  groupId: string | null;
  groupName: string;
  important: boolean;
  urgent: boolean;
  events: TaskEvent[];
}

export interface WorkGroup {
  id: string;
  name: string;
}

export interface GroupEvent {
  id: string;
  kind: "group_created" | "group_renamed" | "group_deleted";
  groupId: string;
  at: string;
  day: string;
  timezone: string;
  offsetMinutes: number;
  meta: EventMeta;
}

export interface GroupArchive {
  version: 1;
  groups: WorkGroup[];
  events: GroupEvent[];
}

export interface TaskOrders {
  group: Record<string, string[]>;
  quadrant: Record<string, string[]>;
}

export interface TimelineEntry {
  taskId: string;
  taskTitle: string;
  event: TaskEvent;
}

export interface TaskGroup {
  id: string | null;
  name: string;
  tasks: WorkTask[];
}

export interface EventDay {
  day: string;
  events: TaskEvent[];
}

export interface CreateTaskInput {
  title: string;
  groupId: string | null;
  groupName: string;
  important?: boolean;
  urgent?: boolean;
}

export const UNGROUPED_TASKS = "未分组";
export const QUADRANTS: ReadonlyArray<{
  id: QuadrantId;
  name: string;
  important: boolean;
  urgent: boolean;
}> = [
  { id: "important_urgent", name: "重要且紧急", important: true, urgent: true },
  { id: "important_not_urgent", name: "重要不紧急", important: true, urgent: false },
  { id: "not_important_urgent", name: "紧急不重要", important: false, urgent: true },
  { id: "not_important_not_urgent", name: "不重要不紧急", important: false, urgent: false },
];

export function dayKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function eventContext(now: Date): Pick<TaskEvent, "at" | "day" | "timezone" | "offsetMinutes"> {
  return {
    at: now.toISOString(),
    day: dayKey(now),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
    // `|| 0` 将 UTC 下的 -0 规范化为 0，避免序列化往返后与 Object.is 比较冲突
    offsetMinutes: -now.getTimezoneOffset() || 0,
  };
}

function event(
  task: Omit<WorkTask, "events" | "version">,
  kind: TaskEventKind,
  text: string,
  now: Date,
  id: string,
  meta?: EventMeta,
): TaskEvent {
  return {
    id,
    kind,
    text,
    ...eventContext(now),
    title: task.title,
    groupName: task.groupName,
    important: task.important,
    urgent: task.urgent,
    ...(meta ? { meta } : {}),
  };
}

function requireTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) throw new Error("任务标题不能为空");
  return normalized;
}

export function createTask(
  input: CreateTaskInput,
  now: Date,
  taskId: string,
  eventId: string,
): WorkTask {
  if (typeof input.important !== "boolean" || typeof input.urgent !== "boolean") {
    throw new Error("必须选择象限");
  }
  const base = {
    id: taskId,
    title: requireTitle(input.title),
    status: "active" as const,
    groupId: input.groupId,
    groupName: input.groupName.trim() || UNGROUPED_TASKS,
    important: input.important,
    urgent: input.urgent,
  };
  return { version: 1, ...base, events: [event(base, "created", "创建任务", now, eventId)] };
}

export function addProgress(task: WorkTask, text: string, now: Date, eventId: string): WorkTask {
  if (task.status !== "active") throw new Error("已结束任务必须先重新打开");
  const normalized = text.trim();
  if (!normalized) throw new Error("进展内容不能为空");
  return { ...task, events: [...task.events, event(task, "progress", normalized, now, eventId)] };
}

export function renameTask(task: WorkTask, title: string, now: Date, eventId: string): WorkTask {
  const normalized = requireTitle(title);
  if (normalized === task.title) return task;
  const renamed = { ...task, title: normalized };
  return {
    ...renamed,
    events: [...task.events, event(renamed, "renamed", `由“${task.title}”改为“${normalized}”`, now, eventId, { from: task.title, to: normalized })],
  };
}

export function changeTaskGroup(
  task: WorkTask,
  groupId: string | null,
  groupName: string,
  now: Date,
  eventId: string,
  reason?: string,
): WorkTask {
  const normalizedName = groupName.trim() || UNGROUPED_TASKS;
  if (task.groupId === groupId && task.groupName === normalizedName) return task;
  const changed = { ...task, groupId, groupName: normalizedName };
  return {
    ...changed,
    events: [...task.events, event(changed, "group_changed", `${task.groupName} → ${normalizedName}`, now, eventId, {
      from: task.groupName,
      to: normalizedName,
      ...(reason ? { reason } : {}),
    })],
  };
}

export function changeTaskQuadrant(
  task: WorkTask,
  important: boolean,
  urgent: boolean,
  now: Date,
  eventId: string,
): WorkTask {
  if (task.important === important && task.urgent === urgent) return task;
  const changed = { ...task, important, urgent };
  return {
    ...changed,
    events: [...task.events, event(changed, "quadrant_changed", `${quadrantName(task)} → ${quadrantName(changed)}`, now, eventId, {
      from: quadrantId(task),
      to: quadrantId(changed),
    })],
  };
}

export function completeTask(task: WorkTask, now: Date, eventId: string): WorkTask {
  if (task.status !== "active") throw new Error("任务已经结束");
  const completed = { ...task, status: "completed" as const };
  return { ...completed, events: [...task.events, event(completed, "completed", "完成任务", now, eventId)] };
}

export function closeTask(task: WorkTask, reason: string, now: Date, eventId: string): WorkTask {
  if (task.status !== "active") throw new Error("任务已经结束");
  const normalized = reason.trim();
  if (!normalized) throw new Error("必须填写异常关闭原因");
  const closed = { ...task, status: "closed" as const };
  return { ...closed, events: [...task.events, event(closed, "closed", normalized, now, eventId)] };
}

export function reopenTask(task: WorkTask, now: Date, eventId: string): WorkTask {
  if (task.status === "active") throw new Error("任务仍在进行中");
  const reopened = { ...task, status: "active" as const };
  return { ...reopened, events: [...task.events, event(reopened, "reopened", "重新打开任务", now, eventId)] };
}

export function isTaskEnded(task: WorkTask): boolean {
  return task.status !== "active";
}

export function quadrantId(task: Pick<WorkTask, "important" | "urgent">): QuadrantId {
  if (task.important) return task.urgent ? "important_urgent" : "important_not_urgent";
  return task.urgent ? "not_important_urgent" : "not_important_not_urgent";
}

export function quadrantName(task: Pick<WorkTask, "important" | "urgent">): string {
  return QUADRANTS.find((quadrant) => quadrant.id === quadrantId(task))!.name;
}

function compareEvents(left: TaskEvent, right: TaskEvent): number {
  return left.at.localeCompare(right.at) || left.id.localeCompare(right.id);
}

export function eventsForDay(tasks: WorkTask[], day: string): TimelineEntry[] {
  return tasks.flatMap((task) => task.events.filter((entry) => entry.day === day).map((entry) => ({
    taskId: task.id,
    taskTitle: entry.title,
    event: entry,
  }))).sort((left, right) => compareEvents(left.event, right.event));
}

export function eventsByDay(events: TaskEvent[]): EventDay[] {
  const groups = new Map<string, TaskEvent[]>();
  for (const entry of [...events].sort(compareEvents)) {
    const entries = groups.get(entry.day) ?? [];
    entries.push(entry);
    groups.set(entry.day, entries);
  }
  return [...groups].map(([day, dayEvents]) => ({ day, events: dayEvents }));
}

export function latestProgressAt(task: WorkTask): string {
  return [...task.events].reverse().find(({ kind }) => kind === "progress")?.at ?? task.events[0]?.at ?? "";
}

function ordered(tasks: WorkTask[], ids: string[] = []): WorkTask[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return [...tasks].sort((left, right) => {
    const leftRank = rank.get(left.id);
    const rightRank = rank.get(right.id);
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      return leftRank - rightRank;
    }
    return latestProgressAt(right).localeCompare(latestProgressAt(left));
  });
}

export function groupTasks(tasks: WorkTask[], groups: WorkGroup[], orders: TaskOrders["group"] = {}): TaskGroup[] {
  const active = tasks.filter(({ status }) => status === "active");
  return [
    ...groups.map((group) => ({
      id: group.id,
      name: group.name,
      tasks: ordered(active.filter(({ groupId }) => groupId === group.id), orders[group.id]),
    })),
    {
      id: null,
      name: UNGROUPED_TASKS,
      tasks: ordered(active.filter(({ groupId }) => groupId === null), orders.ungrouped),
    },
  ];
}

export function quadrantTasks(tasks: WorkTask[], orders: TaskOrders["quadrant"] = {}): TaskGroup[] {
  const active = tasks.filter(({ status }) => status === "active");
  return QUADRANTS.map((quadrant) => ({
    id: quadrant.id,
    name: quadrant.name,
    tasks: ordered(active.filter((task) => quadrantId(task) === quadrant.id), orders[quadrant.id]),
  }));
}

function pin(record: Record<string, string[]>, area: string, taskId: string): Record<string, string[]> {
  const cleaned = Object.fromEntries(Object.entries(record).map(([key, ids]) => [key, ids.filter((id) => id !== taskId)]));
  return { ...cleaned, [area]: [taskId, ...(cleaned[area] ?? [])] };
}

export function pinTask(orders: TaskOrders, task: WorkTask): TaskOrders {
  return {
    group: pin(orders.group, task.groupId ?? "ungrouped", task.id),
    quadrant: pin(orders.quadrant, quadrantId(task), task.id),
  };
}

export function moveTaskOrder(
  orders: TaskOrders,
  mode: ViewMode,
  area: string,
  taskId: string,
  beforeId: string | null,
): TaskOrders {
  const cleaned = Object.fromEntries(Object.entries(orders[mode]).map(([key, ids]) => [key, ids.filter((id) => id !== taskId)]));
  const target = [...(cleaned[area] ?? [])];
  const index = beforeId ? target.indexOf(beforeId) : -1;
  if (index >= 0) target.splice(index, 0, taskId);
  else target.push(taskId);
  return { ...orders, [mode]: { ...cleaned, [area]: target } };
}

export function searchTasks(tasks: WorkTask[], query: string): WorkTask[] {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  if (!needle) return tasks;
  return tasks.filter((task) => task.title.toLocaleLowerCase("zh-CN").includes(needle)
    || task.events.some((entry) => entry.title.toLocaleLowerCase("zh-CN").includes(needle)
      || (entry.kind === "progress" && entry.text.toLocaleLowerCase("zh-CN").includes(needle))));
}

export function createGroup(name: string, id: string, groups: WorkGroup[]): WorkGroup {
  const normalized = name.trim();
  if (!normalized) throw new Error("分组名称不能为空");
  if (groups.some((group) => group.name.localeCompare(normalized, "zh-CN", { sensitivity: "accent" }) === 0)) {
    throw new Error("分组名称已存在");
  }
  return { id, name: normalized };
}

export function groupEvent(
  kind: GroupEvent["kind"],
  groupId: string,
  now: Date,
  eventId: string,
  meta: EventMeta,
): GroupEvent {
  return { id: eventId, kind, groupId, ...eventContext(now), meta };
}

export function applyGroupRename(tasks: WorkTask[], groupId: string, name: string): WorkTask[] {
  return tasks.map((task) => task.groupId === groupId ? { ...task, groupName: name } : task);
}
