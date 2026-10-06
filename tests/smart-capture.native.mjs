// Opt-in macOS QA. Uses a fresh Obsidian profile and test vault; never loads a personal vault.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const keyFile = process.argv[2];
if (!keyFile) { console.error('Usage: node tests/smart-capture.native.mjs /absolute/path/to/api-key.md'); process.exit(1); }
const root = await mkdtemp(join(tmpdir(), 'tracelo-smart-qa-'));
const vault = join(root, 'vault'), profile = join(root, 'profile');
const plugin = join(vault, '.obsidian/plugins/work-timeline');
await mkdir(plugin, { recursive: true }); await mkdir(profile);
for (const name of ['main.js', 'styles.css', 'manifest.json']) await copyFile(resolve(name), join(plugin, name));
await writeFile(join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['work-timeline']));
await writeFile(join(vault, '.obsidian/app.json'), JSON.stringify({ safeMode: false }));
await writeFile(join(profile, 'obsidian.json'), JSON.stringify({ vaults: { '1234567890abcdef': { path: vault, ts: Date.now(), open: true } } }));
await writeFile(join(plugin, 'data.json'), JSON.stringify({ taskDirectory: 'tasks', smartCapture: {
  baseUrl: process.env.TRACELO_AI_BASE_URL || 'https://api.kimi.com/coding/v1', model: process.env.TRACELO_AI_MODEL || 'kimi-for-coding', keyFile: resolve(keyFile),
} }));
const output = resolve('test-results/smart-capture'); await mkdir(output, { recursive: true });
// The packaged app disables Node inspection; connect to Chromium's supported debug endpoint instead.
const child = spawn('/Applications/Obsidian.app/Contents/MacOS/Obsidian', [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], { stdio: ['ignore', 'ignore', 'pipe'] });
let browser, stage = 'launch';
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('debug startup timeout')), 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(Error('app exited')); });
    child.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page'); page.setDefaultTimeout(20000);
  stage = 'load';
  await page.waitForFunction(() => window.app?.vault?.getName?.() === 'vault' && window.app?.workspace?.layoutReady, undefined, { timeout: 30000 });
  await page.getByRole('button', { name: 'Trust author and enable plugins', exact: true }).click();
  await page.waitForFunction(() => !!window.app?.plugins?.plugins?.['work-timeline']);
  await page.locator('.modal').filter({ hasText: 'Restricted mode' }).locator('.modal-close-button').click();
  await page.evaluate(async () => {
    if (!window.app.plugins.plugins['work-timeline']) await window.app.plugins.enablePluginAndSave('work-timeline');
    await window.app.plugins.plugins['work-timeline'].activateView();
  });
  stage = 'create';
  await page.locator('.wt-new-task-button').click();
  await page.getByRole('button', { name: '一句话整理', exact: true }).click();
  const modal = page.locator('.wt-smart-modal');
  stage = 'settings';
  await modal.getByRole('button', { name:'模型设置', exact:true }).click();
  const settings = page.locator('.wt-smart-settings');
  const source = (await readFile(resolve(keyFile), 'utf8')).trim();
  const token = /^[A-Za-z0-9_./+~=-]{16,4096}$/.test(source) ? source : source.match(/\bsk-[A-Za-z0-9_-]{16,}\b/)?.[0];
  if (!token) throw Error('Test credential must contain a single token');
  await settings.getByLabel('API Key', {exact:true}).fill(token);
  assert.equal(await settings.getByLabel('API Key', {exact:true}).getAttribute('type'),'password');
  await settings.getByRole('button', {name:'测试连接',exact:true}).click();
  await settings.getByRole('status').filter({hasText:'连接成功'}).waitFor({timeout:80000});
  await settings.getByRole('button', {name:'保存设置',exact:true}).click();
  stage = 'create';
  await modal.getByRole('textbox', { name: '说说要做的事', exact: true }).fill('明天完成相机启动慢的排查，重要且紧急，先抓日志、再分析耗时。现在已经复现了。');
  await modal.getByRole('button', { name: '整理成任务', exact: true }).click();
  await modal.locator('#task-title').waitFor({ timeout: 80000 });
  await modal.locator('#task-title').fill('AI 实机验收任务');
  await modal.getByRole('button', { name: '创建任务', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'native-create.png') });
  await modal.getByRole('button', { name: '创建任务', exact: true }).click();
  await modal.waitFor({ state: 'detached' });
  const task = await page.evaluate(() => window.app.plugins.plugins['work-timeline'].tasks.find(t => t.title === 'AI 实机验收任务'));
  assert.equal(task.todos.length, 2); assert.equal(task.important, true); assert.equal(task.urgent, true);
  assert.equal(task.events.filter(e => e.kind === 'progress').length, 1);
  stage = 'progress';
  await page.evaluate(id => window.app.plugins.plugins['work-timeline'].openSmartCapture(id), task.id);
  await modal.getByRole('textbox', { name: '说说要做的事', exact: true }).fill('日志抓完了，确认初始化耗时比较高，接下来分析原因。');
  await modal.getByRole('button', { name: '整理进展', exact: true }).click();
  await modal.getByRole('textbox', { name: '整理后的进展', exact: true }).waitFor({ timeout: 80000 });
  await page.screenshot({ path: join(output, 'native-progress.png') });
  await modal.getByRole('button', { name: '保存进展', exact: true }).click();
  await modal.waitFor({ state: 'detached' });
  const saved = await page.evaluate(id => {
    const plugin = window.app.plugins.plugins['work-timeline'];
    return { task: plugin.tasks.find(t => t.id === id), path: plugin.taskArchivePath(id) };
  }, task.id);
  assert.equal(saved.task.todos[0].done, true);
  assert.equal(saved.task.events.filter(e => e.kind === 'progress').length, 2);
  assert.match(await readFile(join(vault, saved.path), 'utf8'), /初始化/);
  assert.equal((await readFile(join(plugin, 'data.json'), 'utf8')).includes('"apiKey"'), false);
  stage = 'queued-progress';
  const operation = {version:1,id:'quick-'+'a'.repeat(32),taskId:task.id,kind:'smart_progress',text:'桌面离线暂存的进展',completedTodoIds:[]};
  const queue = join(vault,'tasks','.tracelo-operations'); await mkdir(queue,{recursive:true});
  await writeFile(join(queue,operation.id+'.request.json'),JSON.stringify(operation));
  await page.evaluate(()=>window.app.plugins.plugins['work-timeline'].processQuickOperations());
  await page.waitForFunction(id=>window.app.plugins.plugins['work-timeline'].tasks.some(t=>t.events.some(e=>e.id===id)),operation.id);
  const receipt=JSON.parse(await readFile(join(queue,operation.id+'.result.json'),'utf8'));
  assert.equal(receipt.status,'applied');
  await page.evaluate(()=>window.app.plugins.plugins['work-timeline'].processQuickOperations());
  assert.equal(await page.evaluate(id=>window.app.plugins.plugins['work-timeline'].tasks.flatMap(t=>t.events).filter(e=>e.id===id).length,operation.id),1);
  console.log('PASS native settings: real file path and connection test; queued smart progress applied exactly once by real plugin');
  console.log('PASS native Obsidian: local key file → real Kimi extraction → confirmed task → progress/todo → Markdown archive');
  console.log('Isolated QA vault: ' + vault);
} catch (error) {
  // Never print runtime objects or request details, which could include credentials.
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: join(output, 'native-failure.png') }).catch(() => {});
  console.error('Native QA failed at ' + stage + ': ' + (stage === 'load' || stage === 'launch' ? String(error.message).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]') : error?.name ?? 'Error') + '. Inspect test-results/smart-capture/native-failure.png.');
  process.exitCode = 1;
} finally { await browser?.close(); child.kill('SIGTERM'); }
