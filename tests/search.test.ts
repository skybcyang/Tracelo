import { describe, expect, it } from 'vitest';
import { addProgress, completeTask, createTask, renameTask, setTaskNotes } from '../src/domain';
import { findTaskMatches, searchExcerpt } from '../src/search';

const time = new Date('2026-09-28T01:00:00Z');
const makeTask = () => createTask({ title: '支付模块', groupId: null, groupName: '未分组', important: true, urgent: false }, time, 'task', 'created');

describe('search evidence', () => {
  it('returns the original progress identity after newer progress and completion', () => {
    let task = addProgress(makeTask(), '接口联调通过', time, 'old');
    task = addProgress(task, '退款验证通过', time, 'new');
    task = completeTask(task, time, 'finished');
    expect(findTaskMatches(task, ' 联调 ')).toEqual([{ source: 'progress', text: '接口联调通过', eventId: 'old', day: task.events[1].day }]);
  });
  it('distinguishes current details and historical names without duplicate title hits', () => {
    let task = setTaskNotes(makeTask(), '验收要求：核对退款', time, 'notes');
    expect(findTaskMatches(task, '支付')).toHaveLength(1);
    expect(findTaskMatches(task, '退款')[0]).toMatchObject({ source: 'notes', text: '验收要求：核对退款' });
    task = renameTask(task, '结算模块', time, 'rename');
    expect(findTaskMatches(task, '支付')[0]).toMatchObject({ source: 'historical-title', eventId: 'created', text: '支付模块' });
    expect(findTaskMatches(task, '不存在')).toEqual([]);
    expect(findTaskMatches(task, '   ')).toEqual([]);
  });
  it('centers a bounded excerpt on the match, preserving literal HTML and case', () => {
    const excerpt = searchExcerpt('前'.repeat(160) + '<Refund>' + '后'.repeat(160), 'refund');
    expect(excerpt.match).toBe('Refund');
    expect(excerpt.before.endsWith('<')).toBe(true);
    expect(excerpt.after.startsWith('>')).toBe(true);
    expect(excerpt.before.length + excerpt.match.length + excerpt.after.length).toBeLessThan(150);
  });
});
