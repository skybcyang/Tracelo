import type { WorkTask } from './domain';

export type TaskMatch = {
  source: 'title' | 'notes' | 'progress' | 'historical-title';
  text: string;
  eventId?: string;
  day?: string;
};

export function findTaskMatches(task: WorkTask, query: string): TaskMatch[] {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  if (!needle) return [];
  const contains = (text: string) => text.toLocaleLowerCase('zh-CN').includes(needle);
  const matches: TaskMatch[] = [];
  if (contains(task.title)) matches.push({ source: 'title', text: task.title });
  if (task.notes && contains(task.notes)) matches.push({ source: 'notes', text: task.notes });
  const titles = new Set([task.title]);
  for (const event of task.events) {
    if (!titles.has(event.title) && contains(event.title)) {
      matches.push({ source: 'historical-title', text: event.title, eventId: event.id, day: event.day });
      titles.add(event.title);
    }
    if (event.kind === 'progress' && contains(event.text)) {
      matches.push({ source: 'progress', text: event.text, eventId: event.id, day: event.day });
    }
  }
  return matches;
}

export function searchExcerpt(text: string, query: string): { before: string; match: string; after: string } {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  const start = needle ? text.toLocaleLowerCase('zh-CN').indexOf(needle) : -1;
  if (start < 0) return { before: text, match: '', after: '' };
  const end = start + needle.length;
  return {
    before: (start > 45 ? '…' : '') + text.slice(Math.max(0, start - 45), start),
    match: text.slice(start, end),
    after: text.slice(end, end + 65) + (end + 65 < text.length ? '…' : ''),
  };
}
