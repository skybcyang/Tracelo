import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
let checks = 0;
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(2500);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  const ids = await page.evaluate(() => window.cardFixture.ids);
  const payment = page.locator(`[data-task-id="${ids.payment}"]`);
  const long = page.locator(`[data-task-id="${ids.long}"]`);
  async function check(name, run) { try { await run(); checks++; } catch (error) { failures.push(name + ': ' + error.message.split('Call log:')[0]); } finally { await page.locator('.modal-container').evaluateAll(els => els.forEach(el => el.remove())); } }
  await check('clickable task icon offers searchable previews and saves only this task', async () => {
    await payment.getByRole('button', { name: '更换图标：完成支付模块', exact: true }).click();
    const picker = page.locator('.wt-icon-picker');
    assert.ok(await picker.locator('.wt-icon-choice svg').count() >= 5);
    await picker.getByRole('searchbox', { name: '搜索图标', exact: true }).fill('代码');
    await picker.getByRole('button', { name: '代码 · code', exact: true }).click();
    await page.waitForFunction(id => window.cardFixture.plugin.tasks.find(t => t.id === id).icon === 'code', ids.payment);
    assert.equal(await payment.locator('.wt-task-icon svg.code').count(), 1);
    assert.equal(await payment.locator('.wt-card-composer').count(), 0);
    const saved = await page.evaluate(async id => {
      const { plugin, app } = window.cardFixture;
      return { source: await app.vault.adapter.read(plugin.taskArchivePath(id)), changed: plugin.tasks.filter(t => t.icon === 'code').length };
    }, ids.payment);
    assert.ok(saved.source.includes('"icon": "code"'));
    assert.equal(saved.changed, 1);
  });
  await check('picker cancellation and empty search do not change task data', async () => {
    const before = await page.evaluate(id => JSON.stringify(window.cardFixture.plugin.tasks.find(t => t.id === id)), ids.payment);
    await payment.getByRole('button', { name: '更换图标：完成支付模块', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索图标', exact: true }).fill('nonexistent-xyz');
    await page.getByText('没有匹配的图标', { exact: true }).waitFor();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.evaluate(id => JSON.stringify(window.cardFixture.plugin.tasks.find(t => t.id === id)), ids.payment), before);
    assert.equal(await payment.locator('.wt-task-icon').evaluate(el => el === document.activeElement), true);
  });
  await check('keyboard escape preserves the selection and returns focus', async () => {
    await payment.getByRole('button', { name: '更换图标：完成支付模块', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '代码 · code', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('searchbox', { name: '搜索图标', exact: true }).press('Escape');
    assert.equal(await page.locator('.wt-icon-picker').count(), 0);
    assert.equal(await payment.locator('.wt-task-icon').evaluate(el => el === document.activeElement), true);
  });
  await check('failed icon writes retain the picker and task, then allow retry', async () => {
    const before = await page.evaluate(id => JSON.stringify(window.cardFixture.plugin.tasks.find(t => t.id === id)), ids.payment);
    await payment.getByRole('button', { name: '更换图标：完成支付模块', exact: true }).click();
    await page.evaluate(() => {
      const adapter = window.cardFixture.app.vault.adapter;
      window.restoreIconWrite = () => { adapter.write = original; };
      const original = adapter.write;
      adapter.write = async () => { throw new Error('测试图标写入失败'); };
    });
    try {
      await page.getByRole('button', { name: '目标 · target', exact: true }).click();
      await page.locator('.wt-icon-picker [role=alert]').filter({ hasText: '测试图标写入失败' }).waitFor();
      assert.equal(await page.evaluate(id => JSON.stringify(window.cardFixture.plugin.tasks.find(t => t.id === id)), ids.payment), before);
      assert.equal(await page.getByRole('button', { name: '目标 · target', exact: true }).isEnabled(), true);
    } finally { await page.evaluate(() => window.restoreIconWrite()); }
    await page.getByRole('button', { name: '文档 · file-text', exact: true }).click();
    await page.waitForFunction(id => window.cardFixture.plugin.tasks.find(t => t.id === id).icon === 'file-text', ids.payment);
    await payment.getByRole('button', { name: '更换图标：完成支付模块', exact: true }).click();
    await page.getByRole('button', { name: '代码 · code', exact: true }).click();
  });
  await check('group picker updates inherited icons while preserving explicit overrides', async () => {
    await page.getByRole('button', { name: '管理分组', exact: true }).click();
    await page.getByRole('button', { name: '设置分组图标', exact: true }).click();
    await page.getByRole('button', { name: '图层 · layers', exact: true }).click();
    await page.waitForFunction(() => window.cardFixture.plugin.groups[0].icon === 'layers');
    assert.equal(await long.locator('.wt-task-icon svg.layers').count(), 1);
    assert.equal(await payment.locator('.wt-task-icon svg.code').count(), 1);
  });
  await check('hidden icon remains configurable through the menu and can inherit again', async () => {
    await payment.getByRole('button', { name: '更换图标：完成支付模块', exact: true }).click();
    await page.getByRole('button', { name: '隐藏图标', exact: true }).click();
    await page.waitForFunction(id => window.cardFixture.plugin.tasks.find(t => t.id === id).icon === null, ids.payment);
    assert.equal(await payment.locator('.wt-task-icon').count(), 0);
    await payment.getByRole('button', { name: '任务操作：完成支付模块', exact: true }).click();
    await page.getByRole('menuitem', { name: '更换图标…', exact: true }).click();
    await page.getByRole('button', { name: '继承分组图标', exact: true }).click();
    await page.waitForFunction(id => window.cardFixture.plugin.tasks.find(t => t.id === id).icon === undefined, ids.payment);
    assert.equal(await payment.locator('.wt-task-icon svg.layers').count(), 1);
  });
  await page.evaluate(id => window.cardFixture.plugin.accessTaskFolder(id, true), ids.payment);
  await check('narrow card keeps a readable title with consistent header controls', async () => {
    await payment.evaluate(el => { el.parentElement.style.gridTemplateColumns = '260px'; });
    const widths = await payment.evaluate(el => ({ title: el.querySelector('.wt-card-open').getBoundingClientRect().width, toolsInTitle: el.querySelector('.wt-card-heading').querySelectorAll('.wt-card-folder, .wt-notes-entry').length, tools: [...el.querySelectorAll('.wt-card-heading button:not(.wt-card-open)')].map(b => { const r=b.getBoundingClientRect(); return [r.width,r.height]; }) }));
    assert.ok(widths.title >= 120, JSON.stringify(widths));
    assert.equal(widths.toolsInTitle, 0);
    assert.ok(widths.tools.every(([w,h]) => w === 24 && h === 24), JSON.stringify(widths));
  });
  await check('a card without optional fields shares its notes action with metadata', async () => {
    const plain = page.locator(`[data-task-id="${ids.plain}"]`);
    const notes = plain.getByRole('button', { name: '添加详情', exact: true });
    assert.equal(await notes.evaluate(el => !!el.closest('.wt-card-meta')), true);
    assert.equal(await plain.locator('.wt-card-status-row').count(), 0);
  });
  await check('multiline todo checkbox aligns with the first line', async () => {
    await long.locator('.wt-card-open').click();
    const offsets = await long.locator('.wt-todo-label').first().evaluate(el => {
      const text=el.querySelector('span').getBoundingClientRect(), box=el.querySelector('input').getBoundingClientRect();
      return { difference:box.y-text.y, lines:text.height/parseFloat(getComputedStyle(el).lineHeight) };
    });
    assert.ok(offsets.lines > 2 && offsets.difference >= 0 && offsets.difference <= 3, JSON.stringify(offsets));
  });
  for (const dark of [false,true]) for (const width of [390,900,1440]) {
    await check(`consistent editor controls and no overflow: dark=${dark} width=${width}`, async () => {
      await page.setViewportSize({ width, height:1000 });
      await page.evaluate(dark => { document.body.classList.toggle('theme-dark',dark); document.querySelectorAll('.wt-card-grid').forEach(el=>el.style.removeProperty('grid-template-columns')); }, dark);
      if (await payment.locator('.wt-card-open').getAttribute('aria-expanded') !== 'true') await payment.locator('.wt-card-open').click();
      const sizes = await payment.evaluate(el => {
        const buttons=[...el.querySelector('.wt-composer-footer').querySelectorAll('button')].map(b=>b.getBoundingClientRect().height);
        return { buttons, width:el.clientWidth, scroll:el.scrollWidth, title:el.querySelector('.wt-card-open').getBoundingClientRect().width };
      });
      assert.ok(Math.abs(sizes.buttons[0]-sizes.buttons[1]) < 1, JSON.stringify(sizes));
      assert.ok(sizes.scroll <= sizes.width + 1 && sizes.title >= 90, JSON.stringify(sizes));
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(`${checks} card hierarchy and icon-picker checks passed.`);
} finally { await browser.close(); }
