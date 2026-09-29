import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(4000);
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  await page.evaluate(async () => { const { plugin, ids } = window.cardFixture; for (let i = 0; i < 25; i++) await plugin.recordProgress(ids.payment, '可滚动历史 ' + i); });
  for (const width of [1280, 800, 390]) {
    await page.setViewportSize({ width, height: 720 });
    if(width<780) await page.getByRole('button',{name:'任务看板',exact:true}).click();
    const tasks = page.locator('.wt-task-column');
    const header = await page.locator('.wt-header').boundingBox();
    await tasks.hover(); await page.mouse.wheel(0, 420);
    await page.waitForFunction(() => document.querySelector('.wt-task-column').scrollTop > 0);
    assert.deepEqual(await page.locator('.wt-header').boundingBox(), header);
    await page.getByRole('button', { name: '全部进展', exact: true }).click();
    const before = await tasks.evaluate(el => el.scrollTop);
    const scroll = page.locator('.wt-timeline-scroll');
    await scroll.evaluate(el => { el.scrollTop = 100; });
    const title = await page.locator('.wt-timeline-header').boundingBox();
    await scroll.hover(); await page.mouse.wheel(0, 300);
    await page.waitForFunction(() => document.querySelector('.wt-timeline-scroll').scrollTop > 100);
    assert.deepEqual(await page.locator('.wt-timeline-header').boundingBox(), title);
    assert.equal(await tasks.evaluate(el => el.scrollTop), before, 'dialog scroll must not move the board');
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.mouse.wheel(0, 800);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    const dialog = await page.locator('.wt-timeline-column').boundingBox();
    assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width && dialog.y >= 0 && dialog.y + dialog.height <= 720);
    if(width<780) await page.getByRole('button', {name:'任务看板',exact:true}).click();
    assert.equal(await page.locator('.wt-timeline-column').isVisible(), width>=780);
    if(width>=780) assert.equal(await tasks.evaluate(el => el.scrollTop), before);
    assert.equal(await page.locator('.view-content').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  }
  console.log('PASS board and dialog scrolling: fixed headings, background isolation, containment, reading position, narrow panes');
} finally { await browser.close(); }
