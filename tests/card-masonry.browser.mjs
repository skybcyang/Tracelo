import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  const ids = await page.evaluate(async () => {
    const { plugin, ids } = window.cardFixture;
    for (let i = 0; i < 6; i++) await plugin.addTask({ title: `布局任务 ${i}`, groupId: plugin.groups[0].id, groupName: plugin.groups[0].name, important: true, urgent: false, dueDate: null, todos: [], initialProgress: '', notes: i === 5 ? '较长的任务背景。'.repeat(40) : '' });
    const settings = plugin.settingTabs[0];
    settings.containerEl.className = 'test-settings';
    document.body.append(settings.containerEl);
    settings.display();
    return ids;
  });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const selector = `.wt-task-section:has([data-task-id="${ids.payment}"]) .wt-card-grid`;
  const firstGrid = page.locator(selector).first();
  const metrics = () => firstGrid.evaluate(grid => {
    const origin = grid.getBoundingClientRect();
    const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top, width: r.width, height: r.height }; };
    return {
    gap: parseFloat(getComputedStyle(grid).columnGap),
    zoom: Number(getComputedStyle(grid.closest('.wt-board')).zoom),
    bounds: rect(grid),
    items: [...grid.querySelectorAll('.wt-card, .wt-card-create')].map(el => ({ id: el.dataset.taskId ?? 'create', ...rect(el), content: el.querySelector('.wt-card-body')?.getBoundingClientRect().height })),
  }; });
  function verifyFit({ items, bounds }) {
    assert.ok(items.every(item => Math.abs(item.width - items[0].width) < 1), 'unequal card widths');
    for (const a of items) {
      assert.ok(a.left >= bounds.left - 1 && a.right <= bounds.right + 1 && a.bottom <= bounds.bottom + 1, 'card escapes its section');
      if (a.content) assert.ok(a.height >= a.content, 'content is clipped');
      for (const b of items) if (a !== b) assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, 'cards overlap');
    }
  }
  function verifyPacked(state) {
    verifyFit(state);
    for (const item of state.items) {
      const above = state.items.filter(other => Math.abs(other.left - item.left) < 1 && other.top < item.top - 1).sort((a, b) => b.top - a.top)[0];
      if (above) assert.ok(Math.abs(item.top - above.bottom - state.gap * state.zoom) < 1.5, 'column contains row-alignment whitespace');
    }
  }

  const setting = page.getByRole('combobox', { name: '卡片布局', exact: true });
  assert.equal(await setting.count(), 1, 'card layout must be available in plugin settings');
  assert.equal(await setting.inputValue(), 'aligned');
  assert.deepEqual(await setting.locator('option').allTextContents(), ['顶部对齐（默认）', '瀑布流']);
  // Initial task creation schedules timeline scrolling on the next frame.
  await settle();
  const aligned = await metrics();
  verifyFit(aligned);
  const firstRow = aligned.items.filter(i => Math.abs(i.top - aligned.items[0].top) < 1);
  assert.ok(firstRow.length >= 2, 'group cards must use the available width for multiple columns');
  const sections = await page.locator('.wt-board.is-group > .wt-task-section').evaluateAll(elements => elements.map(el => {
    const r = el.getBoundingClientRect(); return {left:r.left, top:r.top, bottom:r.bottom, width:r.width};
  }));
  assert.ok(sections.every((section,index) => index === 0 ||
    (Math.abs(section.left-sections[0].left)<1 && Math.abs(section.width-sections[0].width)<1 && section.top>=sections[index-1].bottom)),
    'groups must stack vertically with full-width card grids');
  const nextRow = aligned.items.find(i => i.top > firstRow[0].top + 1);
  assert.ok(nextRow.top >= Math.max(...firstRow.map(i => i.bottom)), 'default layout must align by row');
  checks++;

  assert.equal(await page.locator('.wt-timeline-column').isVisible(), true);
  await page.evaluate(() => {
    const pane = document.querySelector('.wt-timeline-column');
    // Stop the host's smooth initial scroll at a deliberate reading position.
    pane.querySelector('.wt-timeline-scroll').scrollTo({ top: 40, behavior: 'instant' });
    window.savedLayoutTimeline = { pane, html: pane.innerHTML, top: pane.querySelector('.wt-timeline-scroll').scrollTop };
    window.savedOrders = JSON.stringify(window.cardFixture.plugin.state.orders);
  });
  await setting.selectOption('masonry');
  await page.waitForFunction(() => window.cardFixture.plugin.data.cardLayout === 'masonry');
  await settle();
  const masonry = await metrics();
  verifyPacked(masonry);
  assert.equal(masonry.items.length, aligned.items.length, 'layout preference must preserve every task');
  assert.deepEqual(await page.evaluate(() => {
    const old = window.savedLayoutTimeline, pane = document.querySelector('.wt-timeline-column');
    return { same: old.pane === pane, html: old.html === pane.innerHTML, scroll: old.top === pane.querySelector('.wt-timeline-scroll').scrollTop, orders: window.savedOrders === JSON.stringify(window.cardFixture.plugin.state.orders) };
  }), { same: true, html: true, scroll: true, orders: true });
  if (process.env.MASONRY_SCREENSHOT) await page.locator('.view-content').screenshot({ path: process.env.MASONRY_SCREENSHOT });
  checks++;

  const openedId = masonry.items[0].id;
  const opened = page.locator(`[data-task-id="${openedId}"]`);
  await opened.locator('.wt-card-open').click();
  await settle();
  const expanded = await metrics();
  verifyPacked(expanded);
  for (const before of masonry.items) {
    const after = expanded.items.find(i => i.id === before.id);
    assert.ok(Math.abs(after.left - before.left) < 1, 'expansion changes column assignment');
    if (Math.abs(before.left - masonry.items[0].left) > 1) assert.ok(Math.abs(after.top - before.top) < 1, 'expansion shifts another column');
  }
  await opened.locator('.wt-card-composer textarea').fill('切换布局保留的草稿');
  await setting.selectOption('aligned');
  await settle();
  assert.equal(await opened.locator('.wt-card-composer textarea').inputValue(), '切换布局保留的草稿');
  await setting.selectOption('masonry');
  await settle();
  assert.equal(await opened.locator('.wt-card-composer textarea').inputValue(), '切换布局保留的草稿');
  await opened.getByRole('button', { name: '收起', exact: true }).click();
  await settle();
  verifyPacked(await metrics());
  checks++;

  // An asynchronously decoded image grows only its own column.
  const beforeImage = await metrics();
  await opened.locator('.wt-card-body').evaluate(async body => {
    const image = document.createElement('img');
    image.style.cssText = 'width:100%;height:auto';
    body.append(image);
    image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="800"><rect width="200" height="800" fill="steelblue"/></svg>');
    await image.decode();
  });
  await settle();
  const afterImage = await metrics();
  verifyPacked(afterImage);
  for (const before of beforeImage.items) {
    const after = afterImage.items.find(i => i.id === before.id);
    assert.ok(Math.abs(after.left - before.left) < 1);
    if (Math.abs(before.left - beforeImage.items[0].left) > 1) assert.ok(Math.abs(after.top - before.top) < 1);
  }
  checks++;

  for (const mode of ['group', 'quadrant']) {
    for (const width of [1680, 375, 1440]) {
      for (const zoom of [60, 100, 120]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(async ({ mode, zoom }) => { await window.cardFixture.plugin.setViewMode(mode); await window.cardFixture.plugin.setBoardZoom(zoom); }, { mode, zoom });
        await settle();
        const current = await metrics();
        verifyPacked(current);
        if (width === 375) assert.ok(current.items.every(i => Math.abs(i.left - current.items[0].left) < 1), 'narrow view must be one column');
        checks++;
      }
    }
  }
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.evaluate(async () => { await window.cardFixture.plugin.setViewMode('group'); await window.cardFixture.plugin.setBoardZoom(100); });
  await settle();
  verifyPacked(await metrics());
  checks++;

  await page.evaluate(async id => { await window.cardFixture.plugin.finishTask(id); }, ids.plain);
  await page.locator('.wt-ended-section > summary').evaluate(el => { el.parentElement.open = true; });
  await settle();
  assert.equal(await page.locator('.wt-ended-section .wt-masonry-column .wt-card').count(), 1);
  checks++;

  // Drag/drop is handled by the existing card and section listeners after wrapping.
  const orderIds = (await metrics()).items.filter(i => i.id !== 'create').map(i => i.id);
  await page.locator(`[data-task-id="${orderIds[0]}"]`).dispatchEvent('drop', { dataTransfer: await page.evaluateHandle(id => { const data = new DataTransfer(); data.setData('text/plain', id); return data; }, orderIds[2]) });
  await settle();
  const order = await page.evaluate(() => window.cardFixture.plugin.state.orders.group[window.cardFixture.plugin.groups[0].id]);
  assert.equal(order[order.indexOf(orderIds[0]) - 1], orderIds[2]);
  verifyPacked(await metrics());
  checks++;

  await page.evaluate(() => {
    const plugin = window.cardFixture.plugin;
    const save = plugin.saveData;
    window.restoreLayoutSave = () => { plugin.saveData = save; };
    plugin.saveData = async () => { throw new Error('布局保存失败测试'); };
  });
  try {
    await setting.selectOption('aligned');
    await page.getByText('布局保存失败测试', { exact: true }).waitFor();
    assert.equal(await setting.inputValue(), 'masonry');
    assert.equal(await page.evaluate(() => window.cardFixture.plugin.state.cardLayout), 'masonry');
    verifyPacked(await metrics());
  } finally { await page.evaluate(() => window.restoreLayoutSave()); }
  checks++;

  await setting.selectOption('aligned');
  await settle();
  assert.equal(await page.locator('.wt-masonry-column').count(), 0);
  assert.equal(await page.evaluate(() => window.cardFixture.plugin.data.cardLayout), 'aligned');
  assert.deepEqual(errors, []);
  checks++;
  console.log(`${checks} card layout preference and masonry checks passed.`);
} finally { await browser.close(); }
