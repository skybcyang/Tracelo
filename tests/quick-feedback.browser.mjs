import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = 'desktop/Sources/TraceloCapture/Resources/';
const bundle = await build({ entryPoints: ['src/capture-form.ts'], bundle: true, write: false, format: 'iife', globalName: 'TraceloCreateTask' });
const html = readFileSync(root + 'capture.html', 'utf8').replace('/*PLUGIN_STYLES*/', readFileSync('styles.css', 'utf8')).replace('/*CAPTURE_STYLES*/', readFileSync(root + 'capture.css', 'utf8')).replace('/*CREATE_TASK_SCRIPT*/', bundle.outputFiles[0].text).replace('/*CAPTURE_SCRIPT*/', readFileSync(root + 'capture.js', 'utf8'));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
try {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 600, height: 760 }, reducedMotion });
    page.setDefaultTimeout(3000);
    await page.addInitScript(() => { window.messages = []; window.webkit = { messageHandlers: { capture: { postMessage: value => window.messages.push(value) } } }; });
    await page.goto('about:blank'); await page.setContent(html);
    await page.evaluate(() => window.capture.update({ configured: true, groupsSource: '', draft: null }));
    await page.locator('#task-title').fill('真实保存后确认');
    await page.locator('#submit').click();
    assert.equal(await page.locator('.wt-modal-form').getAttribute('data-feedback'), 'saving');
    await page.evaluate(() => document.querySelector('.wt-modal-form').requestSubmit());
    assert.equal(await page.evaluate(() => window.messages.filter(m => m.action === 'submit').length), 1, 'saving cannot enqueue another creation');
    await page.evaluate(() => window.capture.update({ saving: false, error: '磁盘暂时不可写' }));
    assert.equal(await page.locator('.wt-modal-form').getAttribute('data-feedback'), 'failed');
    assert.equal(await page.locator('#task-title').inputValue(), '真实保存后确认');
    assert.equal(await page.evaluate(() => window.messages.filter(m => m.action === 'dismiss').length), 0, 'failure keeps the window open');
    await page.locator('#submit').click();
    await page.evaluate(() => window.capture.update({ saving: false, error: '', draft: null }));
    await page.waitForFunction(() => window.messages.some(m => m.action === 'dismiss'));
    assert.equal(await page.evaluate(() => window.messages.filter(m => m.action === 'dismiss').at(-1).draft), null, 'native macOS requires an explicit null draft when dismissing after a committed creation');
    assert.equal(await page.locator('.wt-modal-form').getAttribute('data-feedback'), 'success');

    await page.evaluate(() => { window.messages = []; window.capture.update({ focus: true, saving: false, draft: { title: '上一条完成' } }); });
    await page.locator('#submit').click();
    await page.evaluate(() => {
      window.capture.update({ saving: false, error: '', draft: null });
      window.capture.update({ focus: true, saving: false, draft: { title: '新打开的草稿' } });
    });
    await page.waitForTimeout(420); // Exceed both the success acknowledgement and exit durations.
    assert.equal(await page.evaluate(() => window.messages.some(m => m.action === 'dismiss')), false, 'a prior success must not close a newly opened session');
    assert.equal(await page.locator('#task-title').inputValue(), '新打开的草稿');
    assert.equal(await page.locator('#submit').isEnabled(), true, 'the previous submission must not overwrite the new draft state');

    await page.evaluate(() => {
      const task = TraceloCreateTask.buildNewTask({ title: '真实回执', groupId: null, groupName: '未分组', important: false, urgent: false, notes: '', todos: ['检查回执'], dueDate: null, initialProgress: '' });
      window.capture.update({ mode: 'progress', tasks: [{ markdown: TraceloCreateTask.serializeTaskMarkdown(task) }], progressDrafts: {}, receipts: [] });
    });
    const input = page.getByRole('textbox', { name: '这次推进了什么？', exact: true });
    await input.fill('保留这份草稿'); await input.press('Meta+Enter');
    const operation = await page.evaluate(() => window.messages.filter(m => m.action === 'operation').at(-1).operation);
    assert.equal(await page.locator('.wt-quick-progress').getAttribute('data-feedback'), 'saving');
    await page.evaluate(id => window.capture.update({ receipts: [{ id, status: 'queued', message: '已暂存，等待 Obsidian 写入' }] }), operation.id);
    assert.equal(await page.locator('.wt-quick-progress').getAttribute('data-feedback'), 'queued');
    assert.equal(await input.inputValue(), '保留这份草稿');
    assert.equal(await page.evaluate(() => window.messages.some(m => m.action === 'progressComplete')), false);
    await page.evaluate(id => window.capture.update({ receipts: [{ id, status: 'failed', message: '存档写入失败' }] }), operation.id);
    assert.equal(await page.locator('.wt-quick-progress').getAttribute('data-feedback'), 'failed');
    assert.equal(await input.inputValue(), '保留这份草稿');
    await page.locator('.wt-quick-extras > summary').click();
    await page.getByRole('button', { name: '更多任务操作', exact: true }).click();
    await page.getByRole('button', { name: '改名', exact: true }).click();
    await page.getByRole('textbox', { name: '改名', exact: true }).fill('失败后保留改名');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const rename = await page.evaluate(() => window.messages.filter(m => m.action === 'operation').at(-1).operation);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.wt-quick-prompt').count(), 1, 'Escape cannot discard a form awaiting an actual write');
    await page.evaluate(id => window.capture.update({ receipts: [{ id, status: 'failed', message: '改名写入失败' }] }), rename.id);
    assert.equal(await page.getByRole('textbox', { name: '改名', exact: true }).inputValue(), '失败后保留改名');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await input.press('Meta+Enter');
    assert.equal(await page.evaluate(() => window.messages.filter(m => m.action === 'operation').at(-1).operation.id), operation.id, 'retry retains durable operation identity');
    await page.evaluate(id => window.capture.update({ receipts: [{ id, status: 'applied', message: '已写入任务' }] }), operation.id);
    assert.equal(await page.locator('.wt-quick-progress').getAttribute('data-feedback'), 'success');
    if (reducedMotion === 'no-preference') assert.equal(await page.locator('.wt-composer-footer button[type=submit]').isDisabled(), true, 'success confirmation cannot resubmit the stale text still painted in the composer');
    await page.waitForFunction(() => window.messages.some(m => m.action === 'progressComplete'));
    assert.equal(await page.evaluate(() => window.messages.filter(m => m.action === 'progressDraft').at(-1).text), '');
    if (reducedMotion === 'reduce') assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length), 0);
    await page.close();
  }
  console.log('PASS quick feedback: saving/queued/applied/failed, retry identity, preserved draft, duplicate prevention and reduced motion');
} finally { await browser.close(); }
