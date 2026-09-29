import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/collection-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
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
  assert.equal(await page.locator('.wt-group-icon [data-icon="noto:books"]').count(), 1, 'group headings render selected Noto icon');
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
  for (const theme of ['evergreen', 'graphite', 'glacier', 'vermilion']) for (const mode of ['light', 'dark']) {
    await page.evaluate(async ({theme, mode}) => {
      document.body.classList.toggle('theme-dark', mode === 'light');
      await window.cardFixture.plugin.setAppearance(theme, mode);
    }, {theme, mode});
    const tokens = await page.evaluate(() => {
      const picker = getComputedStyle(document.querySelector('.wt-icon-picker'));
      const view = getComputedStyle(document.querySelector('.work-timeline-view'));
      return ['--wt-card', '--wt-soft', '--wt-text', '--wt-radius', '--wt-accent'].map(key => [key, picker.getPropertyValue(key).trim(), view.getPropertyValue(key).trim()]);
    });
    for (const [key, actual, expected] of tokens) assert.equal(actual, expected, theme + '/' + mode + ' ' + key);
    // Wait for the production theme transition to finish before checking resolved colors.
    await page.waitForFunction(() => {
      const el = document.querySelector('.wt-icon-picker');
      const probe = document.createElement('span');
      probe.style.backgroundColor = getComputedStyle(el).getPropertyValue('--wt-tint'); el.append(probe);
      const matches = getComputedStyle(el.querySelector('[aria-pressed="true"]')).backgroundColor === getComputedStyle(probe).backgroundColor;
      probe.remove(); return matches;
    });
    const controls = await page.locator('.wt-icon-picker').evaluate(el => {
      const s = getComputedStyle(el);
      const search = getComputedStyle(el.querySelector('input'));
      const selected = getComputedStyle(el.querySelector('[aria-pressed="true"]'));
      const probe = document.createElement('span');
      probe.style.backgroundColor = s.getPropertyValue('--wt-tint'); el.append(probe);
      const tint = getComputedStyle(probe).backgroundColor; probe.remove();
      return {radius:search.borderRadius, expected:s.getPropertyValue('--wt-small-radius').trim(), selected:selected.backgroundColor, tint};
    });
    assert.equal(controls.radius, controls.expected);
    assert.equal(controls.selected, controls.tint);
    const cancelColors = await page.getByRole('button', {name:'取消', exact:true}).evaluate(el => {
      const s = getComputedStyle(el), probe = document.createElement('span');
      probe.style.backgroundColor = s.getPropertyValue('--wt-raised'); el.append(probe);
      const expected = getComputedStyle(probe).backgroundColor; probe.remove();
      return {actual:s.backgroundColor, expected};
    });
    assert.equal(cancelColors.actual, cancelColors.expected, 'host dark mode must not override the explicit picker appearance');
    for (const [width, height] of [[1100,820], [390,640], [720,420]]) {
      await page.setViewportSize({width, height});
      const bounds = await page.locator('.wt-icon-picker').evaluate(el => {
        const r = el.getBoundingClientRect();
        return {width:el.clientWidth, scroll:el.scrollWidth, top:r.top, bottom:r.bottom, right:r.right};
      });
      assert.ok(bounds.scroll <= bounds.width + 1 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= height + 1, JSON.stringify(bounds));
      await page.getByRole('searchbox', {name:'搜索图标'}).focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.querySelector('.wt-icon-picker').contains(document.activeElement)), true);
      if (process.env.TRACELO_QA_OUTPUT && height !== 420) {
        mkdirSync(process.env.TRACELO_QA_OUTPUT, {recursive:true});
        await page.screenshot({path:process.env.TRACELO_QA_OUTPUT + '/icons-' + theme + '-' + mode + '-' + width + '.png'});
      }
    }
  }
  for (const dark of [false, true]) {
    await page.evaluate(async dark => {
      document.body.classList.toggle('theme-dark', dark);
      await window.cardFixture.plugin.setAppearance('evergreen', 'system');
    }, dark);
    assert.equal(await page.locator('.wt-icon-picker').evaluate(el=>getComputedStyle(el).colorScheme), dark ? 'dark' : 'light');
  }
  const svgIds = await page.locator('.wt-color-icon [id]').evaluateAll(elements => elements.map(el => el.id));
  assert.equal(new Set(svgIds).size, svgIds.length, 'gradient/filter IDs must not collide across repeated icons');
  assert.deepEqual(errors, []);
  console.log('PASS Noto icons: offline library, bilingual search, persistence, inheritance, hidden state, pagination, unique gradients, light/dark and narrow layouts');
} finally { await browser.close(); }
