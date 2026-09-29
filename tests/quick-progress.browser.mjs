import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = 'desktop/Sources/TraceloCapture/Resources/';
const bundle = await build({ entryPoints: ['src/capture-form.ts'], bundle: true, write: false, format: 'iife', globalName: 'TraceloCreateTask' });
const html = readFileSync(root + 'capture.html', 'utf8').replace('/*PLUGIN_STYLES*/', readFileSync('styles.css', 'utf8')).replace('/*CAPTURE_STYLES*/', readFileSync(root + 'capture.css', 'utf8')).replace('/*CREATE_TASK_SCRIPT*/', bundle.outputFiles[0].text).replace('/*CAPTURE_SCRIPT*/', readFileSync(root + 'capture.js', 'utf8'));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 760 } }); page.setDefaultTimeout(3000);
  await page.addInitScript(() => { window.messages = []; window.webkit = { messageHandlers: { capture: { postMessage: value => window.messages.push(value) } } }; });
  await page.goto('about:blank'); await page.setContent(html);
  await page.evaluate(() => {
    const task = TraceloCreateTask.buildNewTask({ title: '快捷进展测试', groupId: null, groupName: '未分组', important: true, urgent: false, notes: '**完整详情**\n\n- 检查 Markdown\n\n<script>window.bad = true</script>', todos: ['验证共享卡片'], dueDate: '2026-12-01', initialProgress: '原始进展' });
    window.quickTask = task;
    window.capture.update({ configured: true, directory: '工作记录/任务', groupsSource: '', tasks: [{ markdown: TraceloCreateTask.serializeTaskMarkdown(task) }], progressDrafts: {}, receipts: [] });
  });
  await page.getByRole('button', { name: '记录进展', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索已有任务' }).fill('原始进展');
  await page.getByRole('button', { name: '选择任务：快捷进展测试' }).click();
  const card = page.locator('.wt-card');
  assert.match(await card.textContent(), /完整详情/); assert.match(await card.textContent(), /原始进展/);
  assert.equal(await card.locator('.wt-todo-check').count(), 1);
  assert.equal(await card.locator('.wt-notes-preview strong').textContent(), '完整详情');
  assert.equal(await card.locator('.wt-notes-preview script').count(), 0);
  assert.ok(await card.locator('svg').count() > 2);
  assert.equal(await card.locator('.wt-task-icon [data-icon="noto:bookmark-tabs"]').count(), 1);
  await page.evaluate(() => {
    window.quickTask.icon = 'noto:rocket';
    window.capture.update({ tasks: [{ markdown: TraceloCreateTask.serializeTaskMarkdown(window.quickTask) }] });
  });
  assert.equal(await card.locator('.wt-task-icon [data-icon="noto:rocket"]').count(), 1, 'desktop cards share the bundled Noto renderer');
  await page.mouse.move(590, 750);
  for (const dark of [false, true]) {
    await page.evaluate(dark => window.capture.update({ dark }), dark);
    await page.waitForFunction(dark => getComputedStyle(document.querySelector('.wt-card')).backgroundColor === (dark ? 'rgb(35, 44, 58)' : 'rgb(255, 255, 255)'), dark);
    assert.equal(await page.locator('.wt-capture-tabs button').first().evaluate(el => getComputedStyle(el).backgroundColor), dark ? 'rgb(25, 33, 45)' : 'rgb(242, 245, 249)');
    if (process.env.TRACELO_QA_OUTPUT) {
      mkdirSync(process.env.TRACELO_QA_OUTPUT, { recursive: true });
      await page.locator('.wt-quick-body').evaluate(el => el.scrollTop = 0);
      await page.screenshot({ path: process.env.TRACELO_QA_OUTPUT + '/quick-' + (dark ? 'dark' : 'light') + '.png' });
    }
  }
  const input = card.locator('.wt-card-composer textarea');
  await input.fill('正在推进');
  await page.evaluate(() => window.capture.update({ error: '草稿未能保存：测试磁盘失败' }));
  assert.match(await page.locator('.wt-quick-status').textContent(), /草稿未能保存/);
  assert.equal(await input.inputValue(), '正在推进');
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByRole('button', { name: '记录进展', exact: true }).click();
  await page.getByRole('button', { name: '选择任务：快捷进展测试' }).click();
  assert.equal(await input.inputValue(), '正在推进');
  await input.dispatchEvent('compositionstart'); await input.press('Meta+Enter');
  assert.equal(await page.evaluate(() => window.messages.filter(m => m.action === 'operation').length), 0);
  await input.dispatchEvent('compositionend'); await input.press('Meta+Enter');
  const request = await page.evaluate(() => window.messages.filter(m => m.action === 'operation').at(-1).operation);
  assert.equal(request.kind, 'progress'); assert.equal(request.text, '正在推进');
  await page.evaluate(id => window.capture.update({ receipts: [{ id, status: 'queued', message: '已暂存，打开 Obsidian 后写入任务' }] }), request.id);
  assert.match(await page.locator('.wt-quick-status').textContent(), /已暂存/);
  assert.equal(await input.inputValue(), '正在推进');
  await page.evaluate(id => window.capture.update({ receipts: [{ id, status: 'applied', message: '已写入任务' }] }), request.id);
  assert.equal(await page.evaluate(() => window.messages.filter(m => m.action === 'progressDraft').at(-1).text), '');
  console.log('PASS shared quick card: search, full content, task drafts, mode switch, IME, durable queue and applied receipt');
} finally { await browser.close(); }
