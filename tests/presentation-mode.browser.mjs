import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  const mode = page.getByRole('button', { name: '展示模式', exact: true });
  assert.equal(await mode.count(), 1, 'persistent presentation toolbar toggle');
  assert.equal(await mode.getAttribute('aria-pressed'), 'false');
  assert.equal(await mode.evaluate(el => el.nextElementSibling.classList.contains('wt-due-filter')), true);
  const ids = await page.evaluate(() => window.cardFixture.ids);
  const payment = page.locator(`.wt-card[data-task-id="${ids.payment}"]`);
  await payment.locator('.wt-card-open').click();
  await payment.getByRole('textbox', { name: '记录当前进展' }).fill('切换展示模式仍保留的草稿');
  const before = await page.evaluate(() => {
    window.preservedTimeline = document.querySelector('.wt-timeline-scroll');
    return structuredClone({ tasks: window.cardFixture.plugin.tasks, orders: window.cardFixture.plugin.state.orders });
  });
  await mode.focus(); await page.keyboard.press('Space');
  assert.equal(await mode.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.preservedTimeline === document.querySelector('.wt-timeline-scroll')), true, 'mode switch preserves timeline DOM');
  assert.equal(await payment.getByRole('textbox', { name: '记录当前进展' }).inputValue(), '切换展示模式仍保留的草稿');
  assert.equal(await page.locator('.wt-card-composer').count(), 1);
  assert.equal(await page.locator('.wt-card:not(.is-expanded)').count(), 0);
  await payment.locator('.wt-read-more').click();
  assert.equal(await page.locator('.wt-card-composer').count(), 0);
  assert.equal(await payment.evaluate(el => el.classList.contains('is-expanded')), true);
  assert.equal(await page.locator('.wt-timeline-scroll').getAttribute('data-timeline-key'), `task:${ids.payment}`);
  await mode.click();
  assert.equal(await page.locator('.wt-card.is-expanded').count(), 0);
  assert.deepEqual(await page.evaluate(() => ({ tasks: window.cardFixture.plugin.tasks, orders: window.cardFixture.plugin.state.orders })), before);
  // Preference writes can fail. Keep the old mode and offer an immediate retry.
  await page.evaluate(() => { const plugin = window.cardFixture.plugin; window.originalSaveData = plugin.saveData; plugin.saveData = async () => { throw new Error('偏好写入失败'); }; });
  await mode.click(); await page.getByText('偏好写入失败', { exact: true }).waitFor();
  assert.equal(await mode.getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => { window.cardFixture.plugin.saveData = window.originalSaveData; });
  await mode.click();
  assert.equal(await page.evaluate(() => window.cardFixture.plugin.data.presentationMode), true);
  await payment.locator('.wt-card-open').click();
  assert.equal(await payment.getByRole('textbox', { name: '记录当前进展' }).inputValue(), '切换展示模式仍保留的草稿');
  await mode.click();
  assert.equal(await payment.evaluate(el => el.classList.contains('is-expanded')), true, 'editing card remains expanded when presentation ends');
  await payment.locator('.wt-read-more').click();
  assert.equal(await payment.evaluate(el => el.classList.contains('is-expanded')), false);
  // A mode change above the viewport must keep the first visible card in place.
  await page.evaluate(async () => {
    const { plugin } = window.cardFixture;
    for (let i = 0; i < 24; i++) await plugin.addTask({ title: `阅读锚点 ${i}`, groupId: plugin.groups[0].id,
      groupName: plugin.groups[0].name, important: false, urgent: false, notes: '详细背景。'.repeat(100), todos: [], initialProgress: '完整进展。'.repeat(40) });
    const pane = document.querySelector('.wt-task-column');
    pane.scrollTop = 700;
    const top = pane.getBoundingClientRect().top;
    const card = [...pane.querySelectorAll('.wt-card')].find(el => el.getBoundingClientRect().bottom > top);
    window.readingAnchor = { id: card.dataset.taskId, offset: card.getBoundingClientRect().top - top };
  });
  await mode.click();
  const anchorDelta = await page.evaluate(() => {
    const pane = document.querySelector('.wt-task-column');
    const card = pane.querySelector(`[data-task-id="${window.readingAnchor.id}"]`);
    return card.getBoundingClientRect().top - pane.getBoundingClientRect().top - window.readingAnchor.offset;
  });
  assert.ok(Math.abs(anchorDelta) < 2, `reading anchor shifted ${anchorDelta}px`);
  await page.getByRole('button', { name: '界面与工具设置' }).count().then(async count => {
    if (count) await page.getByRole('button', { name: '界面与工具设置' }).click();
    else await page.locator('.wt-board-options summary').click();
  });
  assert.equal(await page.getByRole('checkbox', { name: '紧凑任务卡片' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS presentation mode: toolbar/keyboard, persistence/failure, single editing, draft/order/task preservation, timeline identity and settings consolidation');
} finally { await browser.close(); }
