import { describe, expect, it } from 'vitest';
import { createTask, addTodo, addProgress } from '../src/domain';
import { serializeTaskMarkdown, parseTaskMarkdown } from '../src/archive';

function example() {
  let task = createTask({ title: '可编辑任务', groupId: 'dev', groupName: '研发', important: true, urgent: false,
    notes: '独立详情段落\n\n```md\n## 待办\n```\n\n保留换行  \n下一行' }, new Date('2026-10-06T01:00:00Z'), 'editable-1', 'created-1');
  task = addTodo(task, '核对数据', new Date('2026-10-06T01:01:00Z'), 'todo-1', 'todo-event');
  return addProgress(task, '唯一进展正文\n\n第二段内容', new Date('2026-10-06T01:02:00Z'), 'progress-1');
}

describe('editable YAML and Markdown task archives', () => {
  it('stores current details and progress text once and round-trips complete history', () => {
    const task = example(), source = serializeTaskMarkdown(task);
    expect(source).toMatch(/^---\ntracelo: 2\n/);
    expect(source).not.toContain('work-timeline-task:v1');
    expect(source.split('独立详情段落')).toHaveLength(2);
    expect(source.split('唯一进展正文')).toHaveLength(2);
    expect(parseTaskMarkdown(source)).toEqual(task);
  });
  it('accepts edits to title, YAML attributes, notes, checkboxes and progress without a duplicate projection', () => {
    const source = serializeTaskMarkdown(example()).replace('# 可编辑任务', '# 已修改任务')
      .replace('urgent: false', 'urgent: true').replace('独立详情段落', '直接编辑详情')
      .replace('- [ ] 核对数据', '- [x] 核对数据').replace('唯一进展正文', '修改后的进展');
    const task = parseTaskMarkdown(source);
    expect(task.title).toBe('已修改任务'); expect(task.urgent).toBe(true);
    expect(task.notes).toContain('直接编辑详情'); expect(task.todos![0]).toEqual({ id: 'todo-1', text: '核对数据', done: true });
    expect(task.events.at(-1)?.text).toBe('修改后的进展\n\n第二段内容');
  });
  it('accepts new plain checkboxes and dated progress with stable generated identities', () => {
    const source = serializeTaskMarkdown(example()).replace('## 待办\n\n', '## 待办\n\n- [ ] 新待办\n') + '\n### 2026-10-06T03:00:00+08:00 · 进展\n\n手动追加的进展\n';
    const one = parseTaskMarkdown(source), two = parseTaskMarkdown(source);
    expect(one).toEqual(two);
    expect(one.todos![0].text).toBe('新待办');
    expect(one.events.some(e => e.text === '手动追加的进展')).toBe(true);
    expect(parseTaskMarkdown(serializeTaskMarkdown(one))).toEqual(one);
  });
  it('rejects malformed YAML, duplicate properties, invalid dates and incomplete timeline entries', () => {
    const source = serializeTaskMarkdown(example());
    expect(() => parseTaskMarkdown(source.replace('urgent: false', 'urgent: [unfinished'))).toThrow();
    expect(() => parseTaskMarkdown(source.replace('urgent: false', 'urgent: false\nurgent: true'))).toThrow();
    expect(() => parseTaskMarkdown(source.replace('urgent: false', 'urgent: false\ndueDate: 2026-02-30'))).toThrow();
    expect(() => parseTaskMarkdown(source + '\n### 明天 · 进展\n\n尚未补全日期\n')).toThrow();
  });
  it('preserves custom YAML properties and additional detail headings after plugin saves', () => {
    const source = serializeTaskMarkdown(example()).replace('tracelo: 2', 'tracelo: 2\ntags:\n  - example\nowner: me')
      .replace('独立详情段落', '独立详情段落\n\n### 验收标准\n\n不丢失自定义内容');
    const saved = serializeTaskMarkdown(parseTaskMarkdown(source));
    expect(saved).toContain('owner: me'); expect(saved).toContain('- example'); expect(saved).toContain('### 验收标准');
  });
});
