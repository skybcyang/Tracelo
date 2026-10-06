import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  const ids = await page.evaluate(async () => {
    const { plugin, ids } = window.cardFixture;
    await plugin.addGroup('需要完整阅读的长分组名称'.repeat(6));
    const group = plugin.groups.at(-1);
    const common = { groupId: group.id, groupName: group.name, important: true, urgent: true, dueDate: null, todos: [], initialProgress: '' };
    const bare = await plugin.addTask({ ...common, title: '空白卡片' });
    const many = await plugin.addTask({ ...common, title: '需要完整阅读的长标题'.repeat(10), initialProgress: '完整进展文字。'.repeat(80), notes: '完整详情内容。'.repeat(30), dueDate: '2026-09-01', todos: ['长待办内容。'.repeat(30), '第二项', '第三项', '第四项'] });
    plugin.state.presentationMode = false;
    await plugin.setViewMode('group');
    return { ...ids, bare, many };
  });
  const card = id => page.locator(`.wt-card[data-task-id="${id}"]`);
  const screenshot = async name => {
    if (!process.env.CARD_DISPLAY_SCREENSHOTS) return;
    mkdirSync(process.env.CARD_DISPLAY_SCREENSHOTS, { recursive: true });
    await page.locator('.wt-task-column').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: resolve(process.env.CARD_DISPLAY_SCREENSHOTS, `${name}.png`) });
  };
  const settle = () => page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  for (const theme of ['evergreen', 'graphite', 'glacier', 'vermilion']) for (const mode of ['group', 'quadrant']) for (const dark of [false, true]) for (const width of [375, 1440]) for (const zoom of [60, 100, 120]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(async ({ theme, mode, dark, zoom }) => {
      const { plugin } = window.cardFixture;
      await plugin.setAppearance(theme, dark ? 'dark' : 'light');
      await plugin.setViewMode(mode);
      await plugin.setBoardZoom(zoom);
    }, { theme, mode, dark, zoom });
    await settle();
    const header = await page.locator('.wt-view-tools').evaluate(el => {
      const controls = ['.wt-view-switch', '.wt-context-actions'].map(selector => el.querySelector(selector).getBoundingClientRect());
      return { overlap: controls[0].right > controls[1].left + 1 && controls[0].bottom > controls[1].top + 1, outside: controls.some(r => r.left < 0 || r.right > innerWidth + 1) };
    });
    assert.equal(header.overlap, false, `toolbar overlaps at ${width}px`);
    assert.equal(header.outside, false, `toolbar outside viewport at ${width}px`);
    const metrics = await page.locator('.wt-board').evaluate(board => [...board.querySelectorAll('.wt-card')].map(el => {
      const rect = el.getBoundingClientRect();
      const title = el.querySelector('.wt-card-title');
      const properties = el.querySelector('.wt-card-properties')?.getBoundingClientRect();
      const deadline = el.querySelector('.wt-card-deadline')?.getBoundingClientRect();
      return { height: rect.height, width: rect.width, scroll: el.scrollWidth, client: el.clientWidth, titleLines: title.clientHeight / parseFloat(getComputedStyle(title).lineHeight), inlineLabels: !deadline || !properties || Math.abs((deadline.top + deadline.bottom) - (properties.top + properties.bottom)) < 2 && deadline.left >= properties.right, latest: el.querySelector('.wt-card-latest')?.getBoundingClientRect().height, footer: el.querySelector('.wt-card-footer').getBoundingClientRect().bottom - rect.top };
    }));
    assert.ok(Math.max(...metrics.map(m => m.height)) - Math.min(...metrics.map(m => m.height)) < 1, `unequal compact heights ${theme}/${mode}/${width}/${zoom}: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.every(m => m.scroll <= m.client + 1), `overflow ${JSON.stringify(metrics)}`);
    assert.ok(metrics.every(m => m.titleLines <= 1.05), 'compact titles must not reserve an empty second line');
    assert.ok(metrics.every(m => m.inlineLabels), `labels and deadlines must share one row: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.every(m => m.latest > 0), 'empty progress must reserve two lines');
    assert.equal(await card(ids.many).locator('.wt-card-todos:visible, .wt-task-notes:visible').count(), 0);
    checks++;
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(async () => { const { plugin } = window.cardFixture; await plugin.setAppearance('evergreen', 'light'); await plugin.setViewMode('group'); await plugin.setBoardZoom(100); });
  await settle();
  await screenshot('compact-light');
  await page.evaluate(async () => { const { plugin } = window.cardFixture; plugin.state.presentationMode = true; await plugin.setViewMode('group'); });
  await settle();
  assert.equal(await page.locator('.wt-card-composer').count(), 0);
  assert.equal(await card(ids.bare).locator('.wt-card-latest, .wt-latest-label, .wt-card-todos, .wt-task-notes').count(), 0);
  assert.equal(await card(ids.many).locator('.wt-todo-check').count(), 4);
  assert.equal(await card(ids.many).locator('.wt-add-todo').count(), 0);
  assert.ok(await card(ids.many).evaluate(el => ['.wt-card-title', '.wt-card-latest'].every(selector => { const node = el.querySelector(selector); return node.clientHeight + 1 >= node.scrollHeight; })));
  assert.ok(await card(ids.many).evaluate(el => el.getBoundingClientRect().height) > await card(ids.bare).evaluate(el => el.getBoundingClientRect().height));
  await screenshot('presentation-light');
  if (process.env.CARD_DISPLAY_SCREENSHOTS) {
    await page.setViewportSize({ width: 375, height: 812 });
    await settle();
    await screenshot('presentation-narrow');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => window.cardFixture.plugin.setAppearance('evergreen', 'dark'));
    await settle();
    await screenshot('presentation-dark');
  }
  checks++;
  await card(ids.many).locator('.wt-todo-check').first().check();
  await page.waitForFunction(id => window.cardFixture.plugin.tasks.find(t => t.id === id).todos[0].done, ids.many);
  assert.equal(await page.locator('.wt-card-composer').count(), 0);
  await card(ids.many).locator('.wt-read-more').click();
  assert.equal(await page.locator('.wt-card-composer').count(), 1);
  await card(ids.many).getByRole('textbox', { name: '记录当前进展' }).fill('保留在阅读模式里的草稿');
  await card(ids.many).locator('.wt-read-more').click();
  assert.equal(await page.locator('.wt-card-composer').count(), 0);
  assert.equal(await card(ids.many).locator('.wt-todo-check').count(), 4);
  assert.equal(await page.evaluate(id => window.cardFixture.plugin.state.drafts[id], ids.many), '保留在阅读模式里的草稿');
  await card(ids.many).locator('.wt-read-more').click();
  assert.equal(await card(ids.many).getByRole('textbox', { name: '记录当前进展' }).inputValue(), '保留在阅读模式里的草稿');
  assert.equal(await card(ids.many).locator('.wt-read-more').textContent(), '');
  assert.equal(await card(ids.many).locator('.wt-read-more').getAttribute('aria-label'), '结束编辑');
  assert.equal(await card(ids.many).locator('.wt-read-more svg').count(), 1);
  await page.evaluate(async () => { const { plugin } = window.cardFixture; plugin.state.presentationMode = false; await plugin.setViewMode('group'); });
  assert.equal(await card(ids.many).locator('.wt-card-composer').count(), 1);
  await card(ids.many).locator('.wt-read-more').click();
  await settle();
  assert.equal(await card(ids.many).locator('.wt-card-todos:visible').count(), 0);
  assert.ok(Math.abs(await card(ids.many).evaluate(el => el.getBoundingClientRect().height) - await card(ids.bare).evaluate(el => el.getBoundingClientRect().height)) < 1);
  checks++;
  await page.evaluate(async id => { const { plugin } = window.cardFixture; await plugin.finishTask(id); plugin.state.presentationMode = true; await plugin.setViewMode('quadrant'); }, ids.many);
  await page.locator('.wt-ended-section > summary').evaluate(el => { el.parentElement.open = true; });
  assert.equal(await card(ids.many).locator('.wt-card-composer, .wt-add-todo').count(), 0);
  assert.equal(await card(ids.many).locator('.wt-todo-check:disabled').count(), 4);
  assert.equal(await card(ids.many).locator('.wt-due-chip.is-overdue').count(), 0);
  await card(ids.many).locator('.wt-card-open').click();
  assert.equal(await card(ids.many).locator('.wt-card-composer').count(), 0);
  checks++;
  await card(ids.plain).locator('.wt-card-menu').click();
  await page.getByRole('menuitem', { name: '添加详情', exact: true }).click();
  await card(ids.plain).getByRole('textbox', { name: '任务详情', exact: true }).fill('切到别卡后仍保留的详情草稿');
  await card(ids.payment).locator('.wt-card-open').click();
  assert.equal(await card(ids.plain).locator('.wt-notes-editor').count(), 0);
  await card(ids.plain).locator('.wt-card-latest').click();
  await card(ids.plain).locator('.wt-card-composer').waitFor();
  assert.equal(await card(ids.plain).locator('.wt-card-composer').count(), 1, 'a card with a retained details draft can re-enter editing from its body');
  assert.equal(await card(ids.plain).getByRole('textbox', { name: '任务详情', exact: true }).inputValue(), '切到别卡后仍保留的详情草稿');
  await card(ids.plain).locator('.wt-read-more').click();
  assert.equal(await card(ids.plain).locator('.wt-notes-draft-status').textContent(), '详情有未保存内容');
  checks++;
  assert.deepEqual(errors, []);
  console.log(`${checks} compact-card and presentation reading/editing checks passed.`);
} finally { await browser.close(); }
