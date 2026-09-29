import { expect, test } from 'vitest';
import { applyQuickOperation } from '../src/quick-operations';
import { createTask, addProgress, closeTask, renameTask } from '../src/domain';
import { parseTaskMarkdown, serializeTaskMarkdown } from '../src/archive';
test('queued progress applies to latest history and retries exactly once after rename', () => {
  let task = createTask({ title: '任务', groupId: null, groupName: '未分组', important: false, urgent: false }, new Date('2026-01-01'), 'task', 'created');
  const op = { version: 1 as const, id: 'op-1', taskId: task.id, kind: 'progress' as const, text: '离线进展' };
  task = addProgress(task, '插件新进展', new Date('2026-01-02'), 'new');
  task = renameTask(task, '新名称', new Date('2026-01-03'), 'renamed');
  const result = applyQuickOperation(task, op, [], new Date('2026-01-04'));
  expect(result.title).toBe('新名称');
  expect(result.events.filter(e => e.kind === 'progress').map(e => e.text)).toEqual(['插件新进展', '离线进展']);
  expect(applyQuickOperation(result, op, [], new Date('2026-01-05'))).toBe(result);
  expect(parseTaskMarkdown(serializeTaskMarkdown(result))).toEqual(result);
  expect(() => applyQuickOperation(result, { ...op, text: '不同内容' }, [])).toThrow(/冲突/);
  expect(() => applyQuickOperation(closeTask(task, '结束', new Date('2026-01-04'), 'end'), op, [])).toThrow();
  expect(() => applyQuickOperation(task, { ...op, taskId: 'another' }, [])).toThrow();
});
test('todo operations use stable ids and never replace unrelated changes', () => {
  const task = createTask({ title: '任务', groupId: null, groupName: '未分组', important: false, urgent: false }, new Date('2026-01-01'), 'task', 'created');
  const add = { version: 1 as const, id: 'add', taskId: task.id, kind: 'todo_add' as const, text: '检查' };
  const next = applyQuickOperation(task, add, []);
  expect(next.todos?.[0]?.id).toBe('add');
  expect(applyQuickOperation(next, { ...add, id: 'done', kind: 'todo_toggle', todoId: 'add', done: true }, []).todos?.[0]?.done).toBe(true);
  expect(() => applyQuickOperation(next, { ...add, id: 'edit', kind: 'todo_edit', todoId: 'missing' }, [])).toThrow();
});
