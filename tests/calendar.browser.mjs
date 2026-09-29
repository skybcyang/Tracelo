import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(3000);
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  // Create fixture events on the same clock as later edits; never rewind real history.
  await page.clock.install({ time: new Date(2026, 8, 29, 23, 59, 58) });
  await page.goto('https://tracelo.test/'); await page.waitForFunction(() => window.cardFixture);
  await page.getByRole('button', { name: '截止日历', exact: true }).click();
  const modal = page.locator('.wt-calendar-modal');
  await modal.locator('[data-day="2026-09-30"]').click();
  assert.match(await modal.locator('.wt-calendar-list').textContent(), /完成支付模块/);
  assert.match(await modal.locator('[data-day="2026-09-30"]').textContent(), /完成支付模块/);
  await page.evaluate(async () => { const {plugin, ids} = window.cardFixture; await plugin.setTaskDueDate(ids.payment, '2026-09-29'); });
  await page.clock.runFor(1000);
  assert.doesNotMatch(await modal.locator('[data-day="2026-09-30"]').textContent(), /完成支付模块/);
  await page.clock.runFor(61000);
  assert.equal(await modal.locator('[aria-current="date"]').getAttribute('data-day'), '2026-09-30');
  await modal.getByRole('button', { name: '下个月', exact: true }).click();
  assert.match(await modal.locator('.wt-calendar-month').textContent(), /2026年10月/);
  await modal.getByRole('button', { name: '今天', exact: true }).click();
  assert.equal(await modal.locator('[aria-pressed="true"]').getAttribute('data-day'), '2026-09-30');
  for (const width of [360, 800, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    assert.equal(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  }
  await modal.getByRole('button', { name: '关闭截止日历' }).focus();
  await page.keyboard.press('Escape');
  assert.equal(await modal.count(), 0);
  await page.clock.runFor(50);
  assert.equal(await page.getByRole('button', { name: '截止日历', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.setViewportSize({ width: 390, height: 720 });
  await page.getByRole('button', { name: '截止日历', exact: true }).click();
  await modal.locator('[data-day="2026-09-29"]').click();
  await modal.getByRole('button', { name: '查看任务：完成支付模块', exact: true }).click();
  assert.equal(await page.locator('.wt-shell').getAttribute('data-pane'), 'history');
  assert.equal(await page.locator('.wt-timeline-column').isVisible(), true);
  console.log('PASS deadline calendar: summaries, live reschedule, midnight, months, today, responsive, escape and focus');
} finally { await browser.close(); }
