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
export function folderForTask(task: WorkTask, taskDirectory = "工作记录/任务"): string {
  return task.materialFolder ?? `${taskDirectory}/${task.archiveName ?? task.id}`;
}
export function assertTaskFolder(task: WorkTask, taskDirectory: string): void {
  if (task.materialFolder === undefined) return;
  if (![MATERIALS_DIRECTORY, taskDirectory].some(root => task.materialFolder!.startsWith(`${root}/`)
    && safeSegment(task.materialFolder!.slice(root.length + 1))
    && task.materialFolder!.slice(root.length + 1) === (task.archiveName ?? task.id))) {
    throw new Error("任务文件夹路径与配置的任务目录或存档名称不匹配");
  }
}
export function canonicalPath(path: string): string { return path.normalize("NFC").toLowerCase(); }

/** Change only link destinations owned by this task; prose and unrelated vault links stay intact. */
export function relocateTaskReferences(notes: string | undefined, from: string, to: string): string | undefined {
  if (!notes || from === to) return notes;
  const redirect = (destination: string) => {
    for (const encode of [(value: string) => value, encodeURI, encodeURIComponent]) {
      for (const prefix of ["", "/"]) {
        const old = `${prefix}${encode(from)}/`;
        if (destination.startsWith(old)) return `${prefix}${encode(to)}/${destination.slice(old.length)}`;
      }
    }
    return destination;
  };
  return notes.replace(/(!?\[[^\]\n]*\]\()(<)?([^\n]*?)(>?)\)/g,
    (_whole, opening: string, angle: string | undefined, destination: string, closing: string) => `${opening}${angle ?? ""}${redirect(destination)}${closing})`)
    .replace(/(!?\[\[)([^\]\n|]+)([^\]\n]*\]\])/g,
      (_whole, opening: string, destination: string, ending: string) => `${opening}${redirect(destination)}${ending}`)
    .replace(/^(\s*\[[^\]\n]+\]:\s*<?)([^\n]+)$/gm,
      (_whole, opening: string, destination: string) => `${opening}${redirect(destination)}`);
}
