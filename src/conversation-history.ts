import { isValidDay, type TaskEvent, type WorkTask } from './domain';

export interface ConversationHistoryQuery { query?: string; from?: string; to?: string; automatic?: boolean }
export interface ConversationSource { taskId: string; eventId: string; title: string; day: string; text: string }
export interface ConversationHistoryScope {
  taskId: string; title: string; query: string; from: string; to: string;
  total: number; matched: number; returned: number; recent: number; older: number;
}
const stopWords = new Set(['什么','为什么','怎么','怎样','是否','之前','当时','上次','现在','最近','一下','这个','那个','任务','记录','进展','帮我','我们','已经','还有','继续','下一步']);
const normalize = (s: string) => s.normalize('NFKC').toLocaleLowerCase('zh-CN');
function termsFor(query: ConversationHistoryQuery): string[] {
  const text = normalize(query.query?.trim() ?? '');
  if (!text) return [];
  if (!query.automatic) return text.split(/\s+/).filter(Boolean);
  return [...new Set([...new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text)]
    .filter(s => s.isWordLike && s.segment.length >= 2 && !stopWords.has(s.segment)).map(s => s.segment))].slice(0,16);
}
export function selectConversationHistory(task: WorkTask, query: ConversationHistoryQuery = {}) {
  if ((query.query?.length ?? 0) > 6000) throw Error('历史查找内容过长。');
  for (const day of [query.from,query.to]) if (day && !isValidDay(day)) throw Error('历史查找日期无效。');
  if (query.from && query.to && query.from > query.to) throw Error('历史开始日期不能晚于结束日期。');
  const terms = termsFor(query), filtering = !!(terms.length || query.from || query.to);
  const ranked = filtering ? task.events.map((event,index) => {
    if ((query.from && event.day < query.from) || (query.to && event.day > query.to)) return {event,index,score:0};
    const text = normalize(event.title + '\n' + event.text);
    const matches = terms.filter(term => text.includes(term)).length;
    const score = terms.length ? (query.automatic || matches === terms.length ? matches : 0) : 1;
    return {event,index,score};
  }).filter(e => e.score > 0).sort((a,b) => b.score-a.score || b.index-a.index) : [];
  const recent = task.events.slice(-30), recentIds = new Set(recent.map(e => e.id));
  const older = ranked.filter(e => !recentIds.has(e.event.id)).slice(0,12);
  const ids = new Set([...recentIds,...older.map(e => e.event.id)]);
  const history = task.events.filter(e => ids.has(e.id));
  const scope: ConversationHistoryScope = {
    taskId:task.id,title:task.title,query:query.query?.trim()??'',from:query.from??'',to:query.to??'',
    total:task.events.length,matched:ranked.length,returned:ranked.filter(e=>ids.has(e.event.id)).length,recent:recent.length,older:older.length,
  };
  return { history, scope };
}

// Preserve the match when a long event is excerpted; the original remains in the task archive.
export function conversationHistoryText(event: TaskEvent, query: ConversationHistoryQuery = {}): string {
  if (event.text.length <= 2000) return event.text;
  const text=normalize(event.text), terms=termsFor(query);
  const at=terms.map(term=>text.indexOf(term)).filter(i=>i>=0).sort((a,b)=>a-b)[0]??0;
  const start=Math.max(0,at-200);
  return (start?'…':'')+event.text.slice(start,start+1998)+(start+1998<event.text.length?'…':'');
}
