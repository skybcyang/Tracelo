import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: `<style>${readFileSync('tests/helpers/obsidian-host.css', 'utf8')}\n${readFileSync('styles.css', 'utf8')}</style><script type="module">${bundle.outputFiles[0].text}</script>` }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  const id = await page.evaluate(() => window.cardFixture.ids.payment);
  const card = page.locator(`[data-task-id="${id}"]`);
  assert.equal(await card.locator('.wt-task-icon .wt-color-icon').count(), 1, 'existing/default task icons must render in color');
  await page.evaluate(async id => window.cardFixture.plugin.changeTaskIcon(id, 'lucide-code'), id);
  assert.equal(await card.locator('[data-icon="noto:laptop"]').count(), 1, 'legacy Lucide identifiers map to Noto');
  assert.equal(await page.evaluate(id => window.cardFixture.plugin.tasks.find(t => t.id === id).icon, id), 'lucide-code', 'rendering must not rewrite existing task data');
  const openPicker = async () => {
    await card.locator('.wt-card-menu').click();
    await page.getByRole('menuitem', { name: '更换图标…', exact: true }).click();
  };
  // All assets must remain available without an external network connection.
  await page.context().setOffline(true);
  for (const [query, icon] of [
    ['文档', 'noto:page-facing-up'],
    ['火箭', 'noto:rocket'],
    ['books', 'noto:books'],
  ]) {
    await openPicker();
    await page.getByRole('searchbox', { name: '搜索图标' }).fill(query);
    await page.locator(`.wt-icon-choice[data-icon="${icon}"]`).click();
    await page.waitForFunction(({ id, icon }) => window.cardFixture.plugin.tasks.find(t => t.id === id).icon === icon, { id, icon });
    assert.equal(await card.locator(`.wt-color-icon[data-icon="${icon}"]`).count(), 1);
    const saved = await page.evaluate(async id => {
      const { plugin, app } = window.cardFixture;
      return app.vault.adapter.read(plugin.taskArchivePath(id));
    }, id);
    assert.ok(saved.includes(icon), 'icon selection must persist to the task archive');
    await openPicker();
    assert.equal(await page.locator(`.wt-icon-choice[data-icon="${icon}"]`).getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
  }
  await page.evaluate(async () => {
    const { plugin, ids } = window.cardFixture;
    await plugin.changeGroupIcon(plugin.groups[0].id, 'noto:books');
    await plugin.changeTaskIcon(ids.payment, undefined);
  });
  assert.equal(await card.locator('[data-icon="noto:books"]').count(), 1);
  await openPicker();
  await page.getByRole('button', { name: '隐藏图标', exact: true }).click();
  assert.equal(await card.locator('.wt-task-icon').count(), 0);
  await openPicker();
  await page.getByRole('button', { name: '继承分组图标', exact: true }).click();
  assert.equal(await card.locator('[data-icon="noto:books"]').count(), 1);
  await openPicker();
  const before = await page.locator('.wt-icon-choice').count();
  await page.getByRole('button', { name: '显示更多', exact: true }).click();
  assert.ok(await page.locator('.wt-icon-choice').count() > before);
  await page.getByRole('searchbox', { name: '搜索图标' }).fill('no-such-icon-xyz');
  assert.equal(await page.locator('.wt-icon-choice').count(), 0);
  assert.match(await page.locator('.wt-icon-result-count').textContent(), /没有匹配/);
  await page.getByRole('searchbox', { name: '搜索图标' }).fill('');
  for (const dark of [false, true]) for (const width of [390, 1100]) {
    await page.setViewportSize({ width, height: 820 });
    await page.evaluate(dark => document.body.classList.toggle('theme-dark', dark), dark);
    await page.waitForFunction(dark => getComputedStyle(document.querySelector('.wt-icon-choice')).backgroundColor === (dark ? 'rgb(25, 33, 45)' : 'rgb(242, 245, 249)'), dark);
    const moreColors = await page.locator('.wt-icon-more').evaluate(el => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, expected: s.getPropertyValue('--wt-soft').trim() };
    });
    assert.equal(moreColors.background, dark ? 'rgb(25, 33, 45)' : 'rgb(242, 245, 249)', 'show-more button must use the picker surface, not host button defaults');
    const bounds = await page.locator('.wt-icon-picker').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, right: el.getBoundingClientRect().right }));
    assert.ok(bounds.scroll <= bounds.width + 1 && bounds.right <= width, JSON.stringify(bounds));
    if (process.env.TRACELO_QA_OUTPUT) {
      mkdirSync(process.env.TRACELO_QA_OUTPUT, { recursive: true });
      await page.screenshot({ path: `${process.env.TRACELO_QA_OUTPUT}/icons-${dark ? 'dark' : 'light'}-${width}.png` });
    }
  }
  const svgIds = await page.locator('.wt-color-icon [id]').evaluateAll(elements => elements.map(el => el.id));
  assert.equal(new Set(svgIds).size, svgIds.length, 'gradient/filter IDs must not collide across repeated icons');
  assert.deepEqual(errors, []);
  console.log('PASS Noto icons: offline library, bilingual search, persistence, inheritance, hidden state, pagination, unique gradients, light/dark and narrow layouts');
} finally { await browser.close(); }
