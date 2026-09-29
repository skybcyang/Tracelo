import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const output = resolve('docs/validation/task-implementation');
mkdirSync(output, { recursive: true });
const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/'); await page.waitForFunction(() => window.cardFixture);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.body.classList.toggle('theme-dark', theme === 'dark'), theme);
    await page.getByRole('button', { name: '截止日历', exact: true }).click();
    await page.locator('[data-day="2026-09-30"]').click();
    await page.screenshot({ path: output + '/calendar-' + theme + '.png' });
    await page.getByRole('button', { name: '关闭截止日历' }).click();
    await page.getByRole('button', { name: '新建任务', exact: true }).click();
    const modal = page.locator('.wt-new-task-modal');
    await modal.locator('#task-title').fill('整理产品体验验收记录');
    await modal.locator('#task-details').fill('记录主要结论，并附上验收截图。');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
    await modal.locator('input[type=file]').setInputFiles({ name: '验收截图.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => !document.querySelector('#submit').disabled);
    assert.equal(await modal.evaluate(el => getComputedStyle(el).backgroundColor), theme === 'dark' ? 'rgb(35, 44, 58)' : 'rgb(255, 255, 255)');
    await page.screenshot({ path: output + '/creation-' + theme + '.png' });
    await modal.getByRole('button', { name: '清空草稿', exact: true }).click();
    await modal.getByRole('button', { name: '取消', exact: true }).click();
    const id = await page.evaluate(() => window.cardFixture.ids.payment);
    const card = page.locator(`[data-task-id="${id}"]`);
    await card.locator('.wt-card-menu').click();
    await page.getByRole('menuitem', { name: /^(编辑|添加)详情$/ }).click();
    const editor = card.getByRole('textbox', { name: '任务详情', exact: true });
    await editor.fill('整理支付、退款与异常场景的验证结果。');
    assert.equal(await editor.evaluate(el => getComputedStyle(el).fontSize), '13px');
    await card.getByRole('button', { name: '保存详情', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: output + '/notes-' + theme + '.png' });
    await card.getByRole('button', { name: '取消', exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 720 });
  await page.getByRole('button', { name: '截止日历', exact: true }).click();
  assert.equal(await page.locator('.wt-calendar-modal').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
  await page.screenshot({ path: output + '/calendar-narrow.png' });
  console.log('PASS visual artifacts: calendar, image creation and notes editor in both themes; narrow calendar');
} finally { await browser.close(); }
