import { type WorkTask, isValidDay } from "./domain";

export const MATERIALS_DIRECTORY = "工作记录/材料";
export function safeSegment(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 180
    && !/[<>:"/\\|?*\u0000-\u001f]/.test(value) && !/[. ]$/.test(value)
    && value !== "." && value !== ".." && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(value);
}
export function taskBaseName(task: WorkTask): string {
  const created = task.events.find(e => e.kind === "created") ?? task.events[0]!;
  if (!isValidDay(created.day)) throw new Error("任务缺少有效创建日期");
  const title = [...task.title.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim()]
    .slice(0, 60).join("").replace(/[. ]+$/, "") || "未命名任务";
  return `${created.day} ${title}`;
}
export function folderForTask(task: WorkTask): string {
  return task.materialFolder ?? `${MATERIALS_DIRECTORY}/${task.archiveName ?? task.id}`;
}
export function canonicalPath(path: string): string { return path.normalize("NFC").toLowerCase(); }
