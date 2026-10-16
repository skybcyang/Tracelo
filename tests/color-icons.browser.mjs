import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/collection-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const page = await browser.newPage({ viewport: { width: 1728, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/**', route => route.fulfill({ contentType: 'text/html', body: `<meta charset="utf-8"><style>${readFileSync('tests/helpers/obsidian-host.css', 'utf8')}\n${readFileSync('styles.css', 'utf8')}</style><script type="module">${bundle.outputFiles[0].text}</script>` }));
  const iconSlots = '.wt-color-icon, .wt-task-icon, .wt-cover-icon, .wt-quick-task-icon';
  for (const mode of ['light', 'dark']) {
    await page.goto(`https://tracelo.test/?workbench=1&mode=${mode}`);
    await page.waitForFunction(() => window.cardFixture);
    const before = await page.evaluate(() => JSON.stringify(window.cardFixture.plugin.tasks));
    assert.ok(await page.locator('.wt-task-cover').count() > 0);
    assert.equal(await page.locator(iconSlots).count(), 0, 'stage and covers omit emoji without empty slots');
    await page.locator('.wt-task-stage .wt-card-menu').click();
    assert.equal(await page.getByRole('menuitem', { name: '更换图标…', exact: true }).count(), 0);
    assert.ok(await page.getByRole('menuitem', { name: '查看历史', exact: true }).isVisible());
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '全屏总览', exact: true }).click();
    assert.equal(await page.locator(iconSlots).count(), 0);
    await page.getByRole('button', { name: '展开看板', exact: true }).click();
    assert.equal(await page.locator(iconSlots).count(), 0, 'expanded board also omits emoji');
    await page.getByRole('button', { name: '管理分组', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '设置分组图标', exact: true }).count(), 0);
    assert.ok(await page.getByRole('button', { name: '分组改名', exact: true }).count() > 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => JSON.stringify(window.cardFixture.plugin.tasks)), before, 'view changes never rewrite archived icon fields or history');
    // Old icon identifiers remain readable and survive an unrelated saved edit.
    const saved = await page.evaluate(async () => {
      const { plugin, app, ids } = window.cardFixture;
      await plugin.changeTaskIcon(ids.payment, 'noto:laptop');
      const before = plugin.tasks.find(t => t.id === ids.payment);
      await plugin.renameTask(ids.payment, before.title + '（更新）');
      const after = plugin.tasks.find(t => t.id === ids.payment);
      return { icon: after.icon, historyKept: before.events.every(e => after.events.some(next => JSON.stringify(next) === JSON.stringify(e))), source: await app.vault.adapter.read(plugin.taskArchivePath(ids.payment)) };
    });
    assert.equal(saved.icon, 'noto:laptop'); assert.ok(saved.historyKept); assert.ok(saved.source.includes('noto:laptop'));
    assert.equal(await page.locator(iconSlots).count(), 0);
    await page.goto(`https://tracelo.test/?workbench=1&mode=${mode}`);
    await page.waitForFunction(() => window.cardFixture);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    mkdirSync('test-results/no-emoji', { recursive: true });
    await page.screenshot({ path: `test-results/no-emoji/${mode}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('PASS emoji removal: stage, covers, overview, board, task/group menus; legacy fields/history preserved; light/dark screenshots');
} finally { await browser.close(); }
