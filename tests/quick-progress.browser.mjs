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
    const second = TraceloCreateTask.buildNewTask({ title: '另一个任务', groupId: null, groupName: '未分组', important: false, urgent: false, notes: '', todos: [], dueDate: null, initialProgress: '' }, new Date('2026-01-01'));
    const more = ['核对退款与异常处理流程，整理联调验收记录并确认上线前的全部检查项', '整理本周客户反馈', '更新组件交互规范', '准备下周版本发布'].map(title => TraceloCreateTask.buildNewTask({ title, groupId: null, groupName: '产品研发', important: false, urgent: false, notes: '', todos: [], dueDate: null, initialProgress: '' }, new Date('2025-12-01')));
    window.quickTask = task;
    window.capture.update({ configured: true, directory: '工作记录/任务', groupsSource: '', tasks: [task, second, ...more].map(item => ({ markdown: TraceloCreateTask.serializeTaskMarkdown(item) })), progressDrafts: {}, receipts: [] });
  });
  await page.getByRole('button', { name: '记录进展', exact: true }).click();
  assert.equal(await page.locator('.wt-quick-target .wt-color-icon').count(), 1, 'quick target uses the same bundled color icons as the board');
  assert.equal(await page.getByRole('textbox', { name: '这次推进了什么？', exact: true }).isVisible(), true, 'open directly in the compact editor, as in the approved mockup');
  assert.equal(await page.getByRole('button', { name: '切换任务', exact: true }).count(), 0, 'the record target is the sole switcher');
  const targetButton = page.getByRole('button', { name: '切换任务：快捷进展测试', exact: true });
  const draftInput = page.getByRole('textbox', { name: '这次推进了什么？', exact: true });
  await draftInput.fill('收起搜索时保留的进展');
  await page.getByRole('button', { name: '切换任务：快捷进展测试', exact: true }).click();
  const picker = page.locator('.wt-inline-picker');
  await page.getByRole('searchbox', { name: '搜索已有任务' }).fill('原始');
  await targetButton.click();
  assert.equal(await picker.count(), 0, 'a second click on the task target collapses search');
  assert.equal(await targetButton.getAttribute('aria-expanded'), 'false');
  assert.equal(await draftInput.inputValue(), '收起搜索时保留的进展');
  assert.equal(await targetButton.evaluate(el => document.activeElement === el), true, 'collapsing restores focus to the task target');
  await targetButton.press('Enter');
  assert.equal(await targetButton.getAttribute('aria-expanded'), 'true', 'keyboard activation can reopen search');
  assert.equal(await page.getByRole('searchbox', { name: '搜索已有任务' }).inputValue(), '');
  const selected = picker.getByRole('button', { name: '选择任务：快捷进展测试', exact: true });
  assert.equal(await selected.locator('.wt-color-icon').count(), 1, 'task chooser uses bundled color icons');
  assert.equal(await selected.getAttribute('aria-current'), 'true', 'the picker identifies the current task beyond color alone');
  await page.getByRole('searchbox', { name: '搜索已有任务' }).pressSequentially('原始');
  assert.equal(await page.getByRole('searchbox', { name: '搜索已有任务' }).inputValue(), '原始', 'typing multiple characters must retain search focus');
  assert.equal(await picker.locator('.wt-quick-task').count(), 1);
  await page.getByRole('searchbox', { name: '搜索已有任务' }).fill('');
  for (const dark of [false, true]) {
    await page.evaluate(dark => window.capture.update({ dark }), dark);
    await page.waitForFunction(dark => {
      const card = getComputedStyle(document.querySelector('.wt-card')).backgroundColor;
      const selected = getComputedStyle(document.querySelector('.wt-quick-task[aria-current]')).backgroundColor;
      return card === (dark ? 'rgb(32, 45, 37)' : 'rgb(252, 253, 252)') && selected === (dark ? 'rgb(48, 75, 57)' : 'rgb(228, 239, 232)');
    }, dark);
    const colors = await picker.evaluate(el => {
      const row = el.querySelector('.wt-quick-task:not([aria-current])');
      return {
        row: getComputedStyle(row).backgroundColor,
        selected: getComputedStyle(el.querySelector('[aria-current]')).backgroundColor,
        input: getComputedStyle(el.querySelector('input')).backgroundColor,
        field: getComputedStyle(document.querySelector('.wt-card-composer textarea')).backgroundColor,
      };
    });
    assert.equal(colors.row, 'rgba(0, 0, 0, 0)', 'unselected rows use the picker surface, never native gray buttons');
    assert.equal(colors.input, colors.field, 'search and progress fields share a surface');
    assert.notEqual(colors.selected, colors.row, 'the current task has a distinct themed surface');
    if (process.env.TRACELO_QA_OUTPUT) {
      mkdirSync(process.env.TRACELO_QA_OUTPUT, { recursive: true });
      await page.screenshot({ path: process.env.TRACELO_QA_OUTPUT + '/picker-' + (dark ? 'dark' : 'light') + '.png' });
    }
  }
  await page.evaluate(() => window.capture.update({ dark: false }));
  await page.getByRole('searchbox', { name: '搜索已有任务' }).fill('没有这个任务');
  assert.equal(await picker.getByRole('status').innerText(), '没有匹配的任务');
  await page.getByRole('searchbox', { name: '搜索已有任务' }).fill('');
  await page.getByRole('searchbox', { name: '搜索已有任务' }).press('ArrowDown');
  assert.equal(await selected.evaluate(el => document.activeElement === el), true, 'keyboard navigation reaches the current task');
  await selected.press('Enter');
  assert.equal(await picker.count(), 0, 'keyboard selection closes the picker');
  await page.getByRole('button', { name: '切换任务：快捷进展测试', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索已有任务' }).fill('原始进展');
  await page.getByRole('button', { name: '选择任务：快捷进展测试' }).click();
  const card = page.locator('.wt-card');
  assert.equal(await card.locator('.wt-card-todos').isVisible(), false);
  assert.equal(await card.locator('.wt-record-target').innerText(), '快捷进展测试\n未分组 · 12月1日截止');
  assert.match(await card.locator('.wt-quick-context').innerText(), /上次进展 \/ .*\n+原始进展/);
  assert.equal(await card.getByRole('button', { name: '关闭进展输入' }).count(), 0);
  assert.match(await card.locator('.wt-composer-footer button[type=submit]').innerText(), /记录进展.*⌘ ↵/s);
  await card.locator('.wt-quick-extras > summary').click();
  assert.match(await card.textContent(), /完整详情/); assert.match(await card.textContent(), /原始进展/);
  assert.equal(await card.locator('.wt-todo-check').count(), 1);
  assert.equal(await card.locator('.wt-notes-preview strong').textContent(), '完整详情');
  assert.equal(await card.locator('.wt-notes-preview script').count(), 0);
  assert.ok(await card.locator('svg').count() > 2);
  await page.mouse.move(590, 750);
  for (const dark of [false, true]) {
    await page.evaluate(dark => window.capture.update({ dark }), dark);
    await page.waitForFunction(dark => getComputedStyle(document.querySelector('.wt-card')).backgroundColor === (dark ? 'rgb(32, 45, 37)' : 'rgb(252, 253, 252)'), dark);
    assert.equal(await page.locator('.wt-capture-tabs button').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    if (process.env.TRACELO_QA_OUTPUT) {
      mkdirSync(process.env.TRACELO_QA_OUTPUT, { recursive: true });
      await page.locator('.wt-quick-body').evaluate(el => el.scrollTop = 0);
      await page.screenshot({ path: process.env.TRACELO_QA_OUTPUT + '/quick-' + (dark ? 'dark' : 'light') + '.png' });
    }
  }
  const input = card.locator('.wt-card-composer textarea');
  await input.fill('正在推进');
  await card.getByRole('button', { name: '切换任务：快捷进展测试', exact: true }).click();
  await page.getByRole('button', { name: '选择任务：另一个任务', exact: true }).click();
  assert.equal(await input.inputValue(), '', 'task drafts are independent');
  await input.fill('另一份草稿');
  await card.getByRole('button', { name: '切换任务：另一个任务', exact: true }).click();
  await page.getByRole('button', { name: '选择任务：快捷进展测试', exact: true }).click();
  assert.equal(await input.inputValue(), '正在推进', 'switching back restores the task draft');
  for (const [width, height] of [[530,640],[360,640]]) {
    await page.setViewportSize({ width, height });
    const bounds = await card.evaluate(el => ({ fits: document.documentElement.scrollWidth <= innerWidth, footer: el.querySelector('.wt-composer-footer').getBoundingClientRect().bottom <= innerHeight + 1 }));
    assert.deepEqual(bounds, { fits: true, footer: true }, JSON.stringify({ width, height, boxes: await page.locator('.capture-modal, .modal-content, .wt-quick-progress, .wt-quick-body, .wt-card-body, .wt-composer-footer').evaluateAll(items => items.map(el => ({ cls: el.className, rect: el.getBoundingClientRect().toJSON(), overflow: getComputedStyle(el).overflow, client: el.clientHeight, scroll: el.scrollHeight }))) }));
  }
  await page.evaluate(() => window.capture.update({ error: '草稿未能保存：测试磁盘失败' }));
  assert.match(await page.locator('.wt-quick-status').textContent(), /草稿未能保存/);
  assert.equal(await input.inputValue(), '正在推进');
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  assert.equal(await page.locator('.wt-quadrant-picker').isVisible(), true, 'four quadrants stay visible for a fresh quick capture');
  await page.getByRole('button', { name: '记录进展', exact: true }).click();
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
  console.log('PASS compact quick editor: direct entry, mockup hierarchy, visible quadrants, task switching, responsive footer, drafts, IME and durable receipts');
} finally { await browser.close(); }
