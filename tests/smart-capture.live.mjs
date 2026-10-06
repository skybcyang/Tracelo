// Opt-in only: sends synthetic examples to the configured provider, never vault contents.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/smart-capture.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { readApiKey, extractCapture, applySmartProgress } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const file = process.argv[2];
if (!file) { console.error('Usage: node tests/smart-capture.live.mjs /absolute/path/to/api-key.md'); process.exit(1); }
let key;
try { key = readApiKey(await readFile(file, 'utf8')); }
catch { console.error('Cannot read one API key from the supplied file; contents withheld.'); process.exit(1); }
const config = { baseUrl: process.env.TRACELO_AI_BASE_URL || 'https://api.kimi.com/coding/v1', model: process.env.TRACELO_AI_MODEL || 'kimi-for-coding' };
const transport = async request => {
  const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body, signal: AbortSignal.timeout(60000) });
  return { status: response.status, text: await response.text() };
};
const context = { mode: 'create', groups: [{ id: 'camera', name: '相机项目' }], today: '2026-10-04', timezone: 'Asia/Shanghai' };
const cases = [
  { name: 'create: month rollover', today: '2026-01-31', text: '明天整理相机日志，截止日期就是明天。', check: plan => assert.equal(plan.values.dueDate,'2026-02-01') },
  { name: 'create: year rollover', today: '2026-12-31', text: '明天整理相机日志，截止日期就是明天。', check: plan => assert.equal(plan.values.dueDate,'2027-01-01') },
  { name: 'create: leap day', today: '2028-02-28', text: '明天整理相机日志，截止日期就是明天。', check: plan => assert.equal(plan.values.dueDate,'2028-02-29') },
  { name: 'create: ambiguous date stays empty', text: '下周找一天整理相机资料，日期还没确定。', check: plan => { assert.equal(plan.values.dueDate,null); assert.ok(plan.warnings.length); } },
  { name: 'create: unknown group is not invented', text: '整理会议记录，放到不存在的火星项目分组。', check: plan => { assert.equal(plan.values.groupId,null); assert.ok(plan.warnings.length); } },
  { name: 'create: multiple independent tasks require a warning', text: '帮我记两件独立的事：明天修相机，后天买牛奶。', check: plan => assert.ok(plan.warnings.some(w=>/拆|多|一项|分别|独立/.test(w))) },
  { name: 'create: relative date, group, priority, todos and initial progress', text: '明天前完成相机启动慢的问题排查，放到相机项目，重要且紧急。待办是先抓日志、再分析耗时、最后验证修改。现在已经复现了。', check: plan => {
    assert.equal(plan.mode, 'create'); assert.equal(plan.values.dueDate, '2026-10-05');
    assert.equal(plan.values.groupId, 'camera'); assert.equal(plan.values.important, true); assert.equal(plan.values.urgent, true);
    assert.equal(plan.values.todos.length, 3); assert.match(plan.values.initialProgress, /复现/);
  } },
  { name: 'create: missing facts remain empty', text: '帮我记下整理相机项目资料这件事，没有确定日期和优先级，也还没有任何进展，不用拆待办。', check: plan => {
    assert.equal(plan.mode, 'create'); assert.equal(plan.values.dueDate, null); assert.equal(plan.values.initialProgress, ''); assert.equal(plan.values.todos.length, 0);
  } },
];
let failures = 0;
for (const item of cases) {
  try { item.check(await extractCapture(item.text, { ...context, today: item.today ?? context.today }, config, key, transport)); console.log('PASS ' + item.name); }
  catch (error) { failures++; console.log('FAIL ' + item.name + ': ' + (error?.name === 'AssertionError' ? 'extraction did not meet the expected fields' : String(error.message).replaceAll(key, '[redacted]'))); }
}
try {
  const task = { version: 1, id: 'camera-task', title: '排查相机启动慢', status: 'active', groupId: 'camera', groupName: '相机项目', important: true, urgent: true,
    todos: [{ id: 'logs', text: '抓日志', done: false }, { id: 'analysis', text: '分析耗时', done: false }],
    events: [{ id: 'created', kind: 'created', text: '创建任务', at: '2026-10-04T01:00:00.000Z', day: '2026-10-04', timezone: 'Asia/Shanghai', offsetMinutes: 480, title: '排查相机启动慢', groupName: '相机项目', important: true, urgent: true }] };
  const plan = await extractCapture('日志已经抓完，发现初始化耗时比较高，接下来分析原因。', { ...context, mode: 'progress', task }, config, key, transport);
  assert.equal(plan.mode, 'progress'); assert.deepEqual(plan.completedTodoIds, ['logs']);
  const next = applySmartProgress(task, plan, 'live-test-operation');
  assert.equal(next.todos[0].done, true); assert.equal(next.todos[1].done, false);
  assert.equal(applySmartProgress(next, plan, 'live-test-operation'), next);
  console.log('PASS progress: selected task, completed todo and idempotent save');
  const negative = await extractCapture('日志还没抓完，分析也没开始，这两项都不要勾选完成。', { ...context, mode:'progress',task }, config,key,transport);
  assert.deepEqual(negative.completedTodoIds,[]);
  console.log('PASS progress: negation and future plans never complete todos');
} catch (error) { failures++; console.log('FAIL progress: ' + (error?.name === 'AssertionError' ? 'extraction did not meet the expected fields' : String(error.message).replaceAll(key, '[redacted]'))); }
process.exitCode = failures ? 1 : 0;
