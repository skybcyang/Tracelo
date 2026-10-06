import MarkdownIt from 'markdown-it';
import { parseDocument, stringify } from 'yaml';
import { isValidDay, type WorkTask, type TaskEvent, type TaskEventKind } from './domain';

const markdown = new MarkdownIt();
const fields = ['id', 'status', 'groupId', 'groupName', 'important', 'urgent', 'dueDate', 'icon', 'archiveName', 'materialFolder'] as const;
const escapeInline = (s: string) => s.replace(/\r?\n/g, ' ').replace(/([\\`*_{}[\]<>])/g, '\\$1');
const unescapeInline = (s: string) => s.replace(/\\([\\`*_{}[\]<>])/g, '$1');
const unframe = (s: string) => s.replace(/^\n/, '').replace(/\n$/, '');
function stableId(value: string): string {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return `md-${(hash >>> 0).toString(16)}`;
}
function headings(source: string, tag: string) {
  const tokens = markdown.parse(source, {}), lines = source.split('\n');
  return tokens.flatMap((t, i) => t.type === 'heading_open' && t.tag === tag && t.level === 0 && t.map
    ? [{ line: t.map[0], end: t.map[1], text: tokens[i + 1]!.content, offset: lines.slice(0, t.map[0]).join('\n').length + (t.map[0] ? 1 : 0) }] : []);
}

export function serializeEditableTask(task: WorkTask, labels: Record<TaskEventKind, string>): string {
  const properties: Record<string, unknown> = { tracelo: 2 };
  for (const field of fields) if (task[field] !== undefined) properties[field] = task[field];
  Object.assign(properties, Object.fromEntries(Object.entries(task.frontmatter ?? {}).filter(([key]) => !(fields as readonly string[]).includes(key))));
  // Known properties always win over custom metadata imported in a bundle.
  properties.tracelo = 2;
  for (const field of fields) if (task[field] !== undefined) properties[field] = task[field];
  const todos = (task.todos ?? []).map(todo => `- [${todo.done ? 'x' : ' '}] ${escapeInline(todo.text)} <!-- todo:${encodeURIComponent(todo.id)} -->`).join('\n');
  const events = task.events.map(entry => {
    const { at, text, kind, ...metadata } = entry;
    const identity = JSON.stringify({ kind, ...metadata }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    return `### ${at} · ${labels[kind]}\n<!-- tracelo-event ${identity} -->\n\n${text}`;
  }).join('\n\n');
  return `---\n${stringify(properties, { lineWidth: 0, aliasDuplicateObjects: false })}---\n\n# ${escapeInline(task.title)}\n\n## 详情\n\n${task.notes ?? ''}\n\n## 待办\n\n${todos}\n\n## 时间线\n\n${events}\n`;
}

export function parseEditableTask(input: string, labels: Record<TaskEventKind, string>): WorkTask {
  const source = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const front = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (!front) throw Error('任务 YAML 尚未完整，请补全开头和结尾的 ---。');
  const document = parseDocument(front[1]!, { schema: 'core', uniqueKeys: true });
  if (document.errors.length) throw Error('任务 YAML 格式无效，请检查属性缩进和重复字段。');
  const properties = document.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties) || properties.tracelo !== 2) throw Error('不是 Tracelo v2 任务文件。');
  const body = source.slice(front[0].length), lines = body.split('\n');
  const title = headings(body, 'h1')[0];
  if (!title || body.slice(0, title.offset).trim()) throw Error('任务正文需要以 # 任务名称 开始。');
  const sections = headings(body, 'h2').filter(h => ['详情', '备注', '待办', '时间线'].includes(h.text));
  if (sections.length !== 3 || !['详情', '备注'].includes(sections[0]!.text) || sections[1]!.text !== '待办' || sections[2]!.text !== '时间线') {
    throw Error('请保留 ## 详情、## 待办、## 时间线，其他内容放在详情内。');
  }
  if (lines.slice(title.end, sections[0]!.line).join('\n').trim()) throw Error('请将标题后的补充文字放在 ## 详情 中。');
  const sectionText = (i: number) => unframe(lines.slice(sections[i]!.end, sections[i + 1]?.line ?? lines.length).join('\n'));
  const task = { version: 1, title: unescapeInline(title.text), events: [] } as unknown as WorkTask;
  for (const field of fields) if (properties[field] !== undefined && !(properties[field] === null && ['dueDate', 'archiveName', 'materialFolder'].includes(field))) Object.assign(task, { [field]: properties[field] });
  const extras = Object.fromEntries(Object.entries(properties).filter(([key]) => key !== 'tracelo' && !(fields as readonly string[]).includes(key)));
  if (Object.keys(extras).length) task.frontmatter = extras;
  const notes = sectionText(0); if (notes) task.notes = notes;
  const todos = sectionText(1).split('\n').filter(line => line.trim()).map((line, index) => {
    const match = /^\s*[-*] \[([ xX])\] (.*?)(?:\s+<!-- todo:([^\s]+) -->)?\s*$/.exec(line);
    if (!match) throw Error('待办请使用 - [ ] 内容 或 - [x] 内容，每项占一行。');
    const text = unescapeInline(match[2]!);
    return { id: match[3] ? decodeURIComponent(match[3]) : stableId(`${task.id}:todo:${index}:${text}`), text, done: match[1]!.toLowerCase() === 'x' };
  });
  if (todos.length) task.todos = todos;
  const timeline = sectionText(2), timelineLines = timeline.split('\n');
  const entries = headings(timeline, 'h3').filter(h => /^\S+.* \u00b7 /.test(h.text));
  if (!entries.length || timeline.slice(0, entries[0]!.offset).trim()) throw Error('时间线需要至少一条带日期的记录。');
  task.events = entries.map((h, index): TaskEvent => {
    const header = /^(\d{4}-\d{2}-\d{2}(?:T| )\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?) \u00b7 (.+)$/.exec(h.text);
    if (!header || !isValidDay(header[1]!.slice(0, 10)) || Number.isNaN(Date.parse(header[1]!))) throw Error('进展日期无效，请使用 ### 2026-10-06T10:00:00+08:00 · 进展。');
    const at = new Date(header[1]!).toISOString();
    let content = timelineLines.slice(h.end, entries[index + 1]?.line ?? timelineLines.length).join('\n');
    const marker = /^<!-- tracelo-event (\{[^\n]*\}) -->\n/.exec(content);
    let metadata: Partial<TaskEvent> = {};
    if (marker) { metadata = JSON.parse(marker[1]!); content = content.slice(marker[0].length); }
    const kind = metadata.kind ?? (Object.entries(labels).find(([, label]) => label === header[2])?.[0] as TaskEventKind | undefined);
    if (!kind || !labels[kind]) throw Error('无法识别时间线记录类型。');
    const rawText = content.replace(/^\n/, '');
    const text = index === entries.length - 1 ? rawText : rawText.replace(/\n$/, '');
    if (!text.trim()) throw Error('时间线记录内容不能为空。');
    const local = new Date(at);
    const offset = /([+-])(\d{2}):(\d{2})$/.exec(header[1]!);
    const offsetMinutes = metadata.offsetMinutes ?? (offset ? (offset[1] === '+' ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) : header[1]!.endsWith('Z') ? 0 : -local.getTimezoneOffset() || 0);
    return { id: stableId(`${task.id}:event:${at}:${index}`), timezone: offset ? `UTC${offset[0]}` : Intl.DateTimeFormat().resolvedOptions().timeZone,
      title: task.title, groupName: task.groupName, important: task.important, urgent: task.urgent,
      ...metadata, offsetMinutes, day: new Date(local.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10), kind, text, at };
  }).sort((a, b) => a.at.localeCompare(b.at));
  return task;
}
