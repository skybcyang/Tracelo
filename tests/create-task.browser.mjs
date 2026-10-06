import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  const modal = page.locator('.wt-new-task-modal');
  const open = () => page.getByRole('button', { name: '新建任务', exact: true }).click();
  async function check(name, run) {
    await page.goto('https://tracelo.test/');
    await page.waitForFunction(() => window.cardFixture);
    await open();
    await modal.locator('.wt-capture-extra > summary').click();
    await run(); checks++; console.log('PASS ' + name);
  }
  await check('compact default and expanded body keep header and actions visible at desktop, short and narrow sizes', async () => {
    assert.equal(await modal.getByRole('button', { name: '创建任务', exact: true }).isDisabled(), true);
    assert.equal(await modal.getByRole('radio', { name: '不重要不紧急', exact: true }).isChecked(), true);
    assert.equal(await modal.getByRole('textbox', { name: '初始进展', exact: true }).isVisible(), false);
    await modal.locator('.wt-capture-extra > summary').click();
    assert.equal(await modal.locator('.wt-new-task-body').evaluate(el => el.scrollHeight <= el.clientHeight + 1), true, 'compact default needs no scrolling: ' + JSON.stringify(await modal.locator('.wt-new-task-body').evaluate(el=>({content:el.scrollHeight,available:el.clientHeight,modal:el.closest('.modal').getBoundingClientRect().height}))));
    await modal.locator('.wt-capture-extra > summary').click();
    await modal.getByRole('button', { name: '添加待办', exact: true }).click();
    for (let i = 0; i < 10; i++) {
      if (i) await modal.getByRole('button', { name: '再加一条', exact: true }).click();
      await modal.getByRole('textbox', { name: '待办内容', exact: true }).nth(i).fill('待办 ' + i);
    }
    await modal.getByRole('button', { name: '初始进展', exact: true }).click();
    for (const [width, height] of [[1280,720],[1440,900],[800,400],[360,640],[640,360]]) {
      await page.setViewportSize({ width, height });
      const state = await modal.evaluate(el => {
        const body = el.querySelector('.wt-new-task-body'), footer = el.querySelector('.wt-new-task-footer');
        const b = body.getBoundingClientRect(), f = footer.getBoundingClientRect(), m = el.getBoundingClientRect();
        return { visible: f.bottom <= innerHeight && f.top >= 0, separate: b.bottom <= f.top + 1, fits: m.left >= 0 && m.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1, scrolls: body.scrollHeight > body.clientHeight };
      });
      assert.deepEqual(state, { visible: true, separate: true, fits: true, scrolls: true }, `${width}x${height}`);
    }
  });
  await check('cancel restores all fields and collapsed optional values; explicit clear discards draft', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await modal.locator('.wt-modal-title').fill('会话草稿');
    await modal.getByRole('textbox', { name: '任务详情', exact: true }).fill('详情\n第二行');
    await modal.getByRole('combobox', { name: '任务分组', exact: true }).selectOption({ label: '产品研发' });
    await modal.locator('.wt-quadrant-option.is-important_urgent').click();
    await modal.getByRole('button', { name: '添加待办', exact: true }).click();
    await modal.getByRole('textbox', { name: '待办内容', exact: true }).fill('保留待办');
    await modal.getByRole('button', { name: '待办 · 1', exact: true }).click();
    await modal.locator('input[type=date]').fill('2026-12-01');
    await modal.getByRole('button', { name: '初始进展', exact: true }).click();
    await modal.getByRole('textbox', { name: '初始进展', exact: true }).fill('已开始');
    await modal.getByRole('button', { name: '初始进展 · 已填写', exact: true }).click();
    await modal.getByRole('button', { name: '取消', exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.getByRole('button', { name: '新建任务', exact: true }).evaluate(el => el === document.activeElement), true, 'cancel returns focus to the entry');
    await open();
    assert.match(await modal.getByRole('status').textContent(), /已恢复草稿/);
    assert.equal(await modal.locator('.wt-modal-title').inputValue(), '会话草稿');
    assert.equal(await modal.getByRole('textbox', { name: '任务详情', exact: true }).inputValue(), '详情\n第二行');
    assert.equal(await modal.getByRole('radio', { name: '重要且紧急', exact: true }).isChecked(), true);
    await modal.getByRole('button', { name: '待办 · 1', exact: true }).click();
    assert.equal(await modal.getByRole('textbox', { name: '待办内容', exact: true }).inputValue(), '保留待办');
    assert.equal(await modal.locator('input[type=date]').inputValue(), '2026-12-01');
    await modal.getByRole('button', { name: '初始进展 · 已填写', exact: true }).click();
    assert.equal(await modal.getByRole('textbox', { name: '初始进展', exact: true }).inputValue(), '已开始');
    await modal.getByRole('button', { name: '清空草稿', exact: true }).click();
    assert.equal(await modal.locator('.wt-modal-title').inputValue(), '');
    await modal.getByRole('button', { name: '取消', exact: true }).click();
    await open();
    assert.equal(await modal.locator('.wt-modal-title').inputValue(), '');
  });
  await check('IME cannot submit, shortcut creates once, failed write preserves every field for retry', async () => {
    await modal.locator('.wt-modal-title').fill('可靠提交');
    await modal.getByRole('textbox', { name: '任务详情', exact: true }).fill('任务说明');
    await modal.getByRole('combobox', { name: '任务分组', exact: true }).selectOption({ label: '产品研发' });
    await modal.locator('.wt-quadrant-option.is-important_urgent').click();
    await modal.getByRole('button', { name: '添加待办', exact: true }).click();
    await modal.getByRole('textbox', { name: '待办内容', exact: true }).fill('失败仍保留待办');
    await modal.locator('input[type=date]').fill('2026-12-01');
    await modal.getByRole('button', { name: '初始进展', exact: true }).click();
    await modal.getByRole('textbox', { name: '初始进展', exact: true }).fill('初始记录');
    await modal.locator('.wt-modal-title').evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', ctrlKey: true, isComposing: true }));
      el.closest('form').requestSubmit();
    });
    assert.equal(await modal.count(), 1);
    assert.equal(await page.evaluate(() => window.cardFixture.plugin.tasks.filter(t => t.title === '可靠提交').length), 0);
    await modal.locator('.wt-modal-title').dispatchEvent('compositionend');
    await page.evaluate(() => {
      const adapter = window.cardFixture.app.vault.adapter, original = adapter.write;
      window.restoreCreationWrite = () => { adapter.write = original; };
      adapter.write = async () => { throw new Error('创建测试失败'); };
    });
    await modal.locator('.wt-modal-title').press('Control+Enter');
    await modal.getByRole('alert').filter({ hasText: '创建测试失败' }).waitFor();
    assert.equal(await modal.getByRole('textbox', { name: '任务详情', exact: true }).inputValue(), '任务说明');
    assert.equal(await modal.getByRole('textbox', { name: '初始进展', exact: true }).inputValue(), '初始记录');
    assert.equal(await modal.getByRole('textbox', { name: '待办内容', exact: true }).inputValue(), '失败仍保留待办');
    assert.equal(await modal.locator('input[type=date]').inputValue(), '2026-12-01');
    assert.equal(await modal.getByRole('radio', { name: '重要且紧急', exact: true }).isChecked(), true);
    assert.equal(await modal.getByRole('combobox', { name: '任务分组', exact: true }).inputValue(), await page.evaluate(() => window.cardFixture.plugin.groups[0].id));
    await page.evaluate(() => {
      window.restoreCreationWrite();
      const plugin = window.cardFixture.plugin, original = plugin.addTask.bind(plugin);
      window.creationCalls = 0;
      plugin.addTask = async values => { window.creationCalls++; await new Promise(resolve => { window.finishCreation = resolve; }); return original(values); };
    });
    await modal.locator('.wt-modal-title').press('Meta+Enter');
    await modal.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    assert.equal(await page.evaluate(() => window.creationCalls), 1);
    await page.evaluate(() => window.finishCreation());
    await modal.waitFor({ state: 'detached' });
    const saved = await page.evaluate(() => window.cardFixture.plugin.tasks.filter(t => t.title === '可靠提交'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].notes, '任务说明');
    assert.equal(saved[0].events.filter(e => e.kind === 'progress').length, 1);
    await open();
    assert.equal(await modal.locator('.wt-modal-title').inputValue(), '');
  });
  await check('property-only draft retains group and priority', async () => {
    await modal.getByRole('combobox', { name: '任务分组', exact: true }).selectOption({ label: '产品研发' });
    await modal.locator('.wt-quadrant-option.is-important_urgent').click();
    await modal.getByRole('button', { name: '取消', exact: true }).click();
    await open();
    assert.equal(await modal.getByRole('radio', { name: '重要且紧急', exact: true }).isChecked(), true);
    assert.equal(await modal.getByRole('combobox', { name: '任务分组', exact: true }).inputValue(), await page.evaluate(() => window.cardFixture.plugin.groups[0].id));
  });
  await check('state preference failure after task archive commit does not invite duplicate creation', async () => {
    await modal.locator('.wt-modal-title').fill('只创建一次');
    await page.evaluate(() => { window.cardFixture.plugin.saveData = async () => { throw new Error('偏好保存失败'); }; });
    await modal.getByRole('button', { name: '创建任务', exact: true }).click();
    await modal.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.cardFixture.plugin.tasks.filter(t => t.title === '只创建一次').length), 1);
  });
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  assert.equal(await page.evaluate(() => {
    const schedule = window.requestAnimationFrame, pending = [];
    window.requestAnimationFrame = callback => { pending.push(callback); return pending.length; };
    try {
      document.querySelector('.wt-new-task-button').click();
      const details = document.querySelector('.wt-new-task-modal #task-details');
      details.focus();
      for (const callback of pending) callback(performance.now());
      return document.activeElement === details;
    } finally { window.requestAnimationFrame = schedule; }
  }), true, 'deferred initial focus must not steal focus after the user selects details');
  checks++; console.log('PASS deferred initial focus respects the field already selected by the user');
  assert.deepEqual(errors, []);
  console.log(`${checks} compact task creation checks passed.`);
} finally { await browser.close(); }
