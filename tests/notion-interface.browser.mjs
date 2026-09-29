import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  assert.equal(await page.locator('.wt-timeline-column').isVisible(), false, 'history must not occupy a permanent board column');
  const id = await page.evaluate(() => window.cardFixture.ids.payment);
  const card = page.locator(`[data-task-id="${id}"]`);
  await card.getByRole('button', { name: '继续推进', exact: true }).click();
  await card.locator('.wt-card-composer textarea').fill('历史打开后仍保留的草稿');
  await card.getByRole('button', { name: '详情与历史', exact: true }).click();
  assert.equal(await page.getByRole('dialog', { name: '任务历史', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: '关闭历史', exact: true }).click();
  assert.equal(await card.locator('.wt-card-composer textarea').inputValue(), '历史打开后仍保留的草稿');
  assert.equal(await card.getByRole('button', { name: '详情与历史', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.getByRole('button', { name: '今天截止', exact: true }).click();
  assert.equal(await page.locator('.wt-board .wt-card').count(), 0);
  await page.getByRole('button', { name: '全部任务', exact: true }).click();
  assert.equal(await page.locator('.wt-board .wt-card').count(), 4);
  const plain = page.locator('.wt-card').filter({ hasText: '整理客户反馈' });
  await plain.getByRole('button', { name: '继续推进', exact: true }).click();
  await plain.getByRole('button', { name: '完成任务', exact: true }).click();
  await page.locator('.notice').filter({ hasText: '任务已完成' }).getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForFunction(() => window.cardFixture.plugin.tasks.find(t => t.title === '整理客户反馈').status === 'active');
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const modal = page.locator('.wt-new-task-modal');
  assert.equal(await modal.locator('.wt-quadrant-picker').isVisible(), true, 'all four quadrants are available without opening more fields');
  assert.equal(await modal.locator('.wt-capture-extra').getAttribute('open'), null, 'secondary fields remain folded');
  await modal.locator('.wt-quadrant-option.is-important_urgent').click();
  await modal.locator('#task-title').fill('新的纸白卡片');
  await modal.getByRole('button', { name: '创建任务', exact: true }).click();
  await modal.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.cardFixture.plugin.tasks.find(t => t.title === '新的纸白卡片').important), true);
  for (const width of [430, 720, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    assert.equal(await page.getByRole('searchbox', { name: '搜索任务和进展', exact: true }).isVisible(), true);
    assert.equal(await page.locator('.view-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `no horizontal overflow at ${width}`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS Notion interface: on-demand history, draft/focus retention, filters, progressive creation, responsive search');
} finally { await browser.close(); }
