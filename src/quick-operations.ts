import { addProgress, addTodo, toggleTodo, editTodo, removeTodo, restoreTodo, renameTask, setTaskNotes, setDueDate, changeTaskGroup, changeTaskQuadrant, completeTask, closeTask, reopenTask, setTaskIcon, QUADRANTS, UNGROUPED_TASKS, type WorkTask, type WorkGroup, type TaskTodo } from './domain';
import { safeSegment } from './storage-names';
export const QUICK_DIRECTORY = '.tracelo-operations';
export interface QuickOperation {
  version: 1; id: string; taskId: string;
  kind: 'progress' | 'todo_add' | 'todo_toggle' | 'todo_edit' | 'todo_remove' | 'todo_restore' | 'rename' | 'notes' | 'due' | 'group' | 'quadrant' | 'complete' | 'close' | 'reopen' | 'icon';
  text?: string; todoId?: string; done?: boolean; todo?: TaskTodo; index?: number;
  attachments?: { name: string; base64: string; sha256?: string }[];
}
export async function decodeQuickImages(op: QuickOperation) {
  if (!op.attachments) return [];
  if (op.kind !== 'progress' || !Array.isArray(op.attachments) || op.attachments.length > 40) throw Error('图片操作无效');
  let total = 0;
  const names = new Set<string>();
  return Promise.all(op.attachments.map(async image => {
    if (!image || !/^image-[a-zA-Z0-9-]+\.(png|jpg|webp|gif|bmp)$/.test(image.name) || typeof image.base64 !== 'string' || image.base64.length > 14_000_000 || names.has(image.name) || !op.text?.includes(`<${image.name}>`)) throw Error('图片数据或文件名无效');
    names.add(image.name);
    const bytes = Uint8Array.from(atob(image.base64), c => c.charCodeAt(0));
    total += bytes.length;
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 || total > 40 * 1024 * 1024) throw Error('图片超过容量限制');
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
    if (image.sha256 && image.sha256 !== sha256) throw Error('图片校验失败');
    return { name:image.name, bytes, sha256 };
  }));
}
export function applyQuickOperation(task: WorkTask, op: QuickOperation, groups: WorkGroup[], now = new Date()): WorkTask {
  if (!op || op.version !== 1 || typeof op.id !== 'string' || !safeSegment(op.id) || op.taskId !== task.id) throw Error('操作身份无效，未修改任务');
  if (op.text !== undefined && (typeof op.text !== 'string' || op.text.length > 200_000)) throw Error('操作内容无效');
  if (op.attachments?.some(image => !image.sha256 || !/^[a-f0-9]{64}$/.test(image.sha256))) throw Error('图片尚未校验');
  const signature = JSON.stringify(op.attachments ? { ...op, attachments: op.attachments.map(({ name, sha256 }) => ({ name, sha256 })) } : op);
  const existing = task.events.find(event => event.id === op.id);
  if (existing) {
    if (existing.meta?.quickOperation !== signature) throw Error('操作 ID 冲突，未重复写入');
    return task;
  }
  if (task.status !== 'active' && !['reopen', 'rename', 'notes', 'due', 'group', 'quadrant', 'icon'].includes(op.kind)) throw Error('任务已结束，请先重新打开；草稿已保留');
  const at = new Date(Math.max(now.getTime(), new Date(task.events.at(-1)!.at).getTime() + 1));
  const text = op.text ?? '';
  if (['todo_toggle', 'todo_edit', 'todo_remove'].includes(op.kind) && !task.todos?.some(todo => todo.id === op.todoId)) throw Error('待办已删除或不可用');
  let next: WorkTask;
  switch (op.kind) {
    case 'progress': next = addProgress(task, text, at, op.id); break;
    case 'todo_add': next = addTodo(task, text, at, op.id, op.id); break;
    case 'todo_toggle': if (typeof op.done !== 'boolean') throw Error('待办状态无效'); next = toggleTodo(task, op.todoId!, op.done, at, op.id); break;
    case 'todo_edit': next = editTodo(task, op.todoId!, text, at, op.id); break;
    case 'todo_remove': next = removeTodo(task, op.todoId!, at, op.id); break;
    case 'todo_restore': if (!op.todo || !safeSegment(op.todo.id) || typeof op.todo.text !== 'string' || typeof op.todo.done !== 'boolean' || !Number.isInteger(op.index)) throw Error('待办恢复数据无效'); next = restoreTodo(task, op.todo, op.index!, at, op.id); break;
    case 'rename': next = renameTask(task, text, at, op.id); break;
    case 'notes': next = setTaskNotes(task, text, at, op.id); break;
    case 'due': next = setDueDate(task, text || null, at, op.id); break;
    case 'group': { const group = groups.find(group => group.id === text); if (text && !group) throw Error('分组已不存在'); next = changeTaskGroup(task, group?.id ?? null, group?.name ?? UNGROUPED_TASKS, at, op.id); break; }
    case 'quadrant': { const quadrant = QUADRANTS.find(item => item.id === text); if (!quadrant) throw Error('象限无效'); next = changeTaskQuadrant(task, quadrant.important, quadrant.urgent, at, op.id); break; }
    case 'complete': next = completeTask(task, at, op.id); break;
    case 'close': next = closeTask(task, text, at, op.id); break;
    case 'reopen': next = reopenTask(task, at, op.id); break;
    case 'icon': next = setTaskIcon(task, text || null, at, op.id); break;
    default: throw Error('不支持的快捷操作，请同时升级插件和快捷工具');
  }
  if (next !== task) { const event = next.events.at(-1)!; event.meta = { ...event.meta, quickOperation: signature }; }
  return next;
}
