import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
const failures = [];
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  const ids = await page.evaluate(async () => {
    const { plugin, ids } = window.cardFixture;
    const common = { groupId: plugin.groups[0].id, groupName: plugin.groups[0].name, important: false, urgent: false, dueDate: null, todos: [], initialProgress: '' };
    const bare = await plugin.addTask({ ...common, title: '空白卡片' });
    const many = await plugin.addTask({ ...common, title: '需要完整阅读的长标题'.repeat(10), initialProgress: '完整进展文字。'.repeat(80), todos: ['长待办内容。'.repeat(60), '第二项', '第三项', '第四项', '第五项'] });
    await plugin.setViewMode('group');
    return { ...ids, bare, many };
  });
  const card = id => page.locator(`[data-task-id="${id}"]`);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function check(name, run) { try { await run(); checks++; } catch (error) { failures.push(name + ': ' + error.message); } }
  await check('equal-width cards use their natural height without row rounding', async () => {
    await settle();
    const m = await card(ids.bare).evaluate(el => ({ height: el.getBoundingClientRect().height, content: el.querySelector('.wt-card-body').getBoundingClientRect().height, padding: parseFloat(getComputedStyle(el.querySelector('.wt-card-body')).paddingBottom) }));
    assert.ok(Math.abs(m.height - m.content - 2) < 1, JSON.stringify(m));
    assert.ok(m.padding >= 18 && m.padding <= 20, JSON.stringify(m));
    assert.ok(m.height < await card(ids.many).evaluate(el => el.getBoundingClientRect().height));
  });
  await check('empty notes entry shares a row instead of reserving a notes section', async () => {
    assert.equal(await card(ids.bare).locator('.wt-task-notes').count(), 0);
    assert.equal(await card(ids.bare).getByRole('button', { name: '添加备注', exact: true }).count(), 1);
    assert.equal(await card(ids.bare).locator('.wt-read-more:visible').count(), 0);
  });
  await check('collapsed cards show three open todos with one fraction and clear remaining count', async () => {
    assert.equal(await card(ids.many).locator('.wt-todo-check:visible').count(), 3);
    assert.equal(await card(ids.many).getByRole('button', { name: '还有 2 项待办', exact: true }).count(), 1);
    assert.equal(await card(ids.many).locator('.wt-checklist-count').count(), 0);
    assert.equal(await card(ids.many).locator('.wt-progress-chip').textContent(), '0/5');
    const metrics = await card(ids.many).evaluate(el => ['.wt-card-title', '.wt-card-latest', '.wt-todo-label span'].map(selector => {
      const node = el.querySelector(selector), style = getComputedStyle(node);
      return node.clientHeight / parseFloat(style.lineHeight);
    }));
    assert.ok(metrics[0] <= 2.05 && metrics[1] <= 3.05 && metrics[2] <= 2.05, JSON.stringify(metrics));
  });
  await check('checking a summary todo updates counts without expanding and can be undone from completed items', async () => {
    const first = card(ids.many).locator('.wt-todo-check:visible').first();
    const label = await first.getAttribute('aria-label');
    await card(ids.many).getByRole('checkbox', { name: label, exact: true }).click();
    await page.waitForFunction(id => window.cardFixture.plugin.tasks.find(t => t.id === id).todos[0].done, ids.many);
    assert.equal(await card(ids.many).locator('.wt-card-composer').count(), 0);
    assert.equal(await card(ids.many).locator('.wt-progress-chip').textContent(), '1/5');
    assert.equal(await card(ids.many).locator('.wt-todo-check:visible').count(), 3);
    await card(ids.many).locator('.wt-completed-todos summary').click();
    await card(ids.many).getByRole('checkbox', { name: label, exact: true }).click();
    await page.waitForFunction(id => !window.cardFixture.plugin.tasks.find(t => t.id === id).todos[0].done, ids.many);
    assert.equal(await card(ids.many).locator('.wt-completed-todos').count(), 0);
    assert.equal(await card(ids.many).locator('.wt-progress-chip').textContent(), '0/5');
  });
  await check('read more expands the same card and shows every todo without text clamps', async () => {
    await card(ids.many).getByRole('button', { name: '展开完整内容', exact: true }).click();
    assert.equal(await card(ids.many).locator('.wt-todo-check:visible').count(), 5);
    assert.equal(await card(ids.many).locator('.wt-card-composer').count(), 1);
    const unclipped = await card(ids.many).evaluate(el => ['.wt-card-title', '.wt-card-latest', '.wt-todo-label span'].every(selector => {
      const node = el.querySelector(selector); return node.clientHeight + 1 >= node.scrollHeight;
    }));
    assert.ok(unclipped);
    await card(ids.many).getByRole('button', { name: '关闭进展输入', exact: true }).click();
  });
  await check('all-complete todos remain discoverable without creating empty open rows', async () => {
    await page.evaluate(async id => {
      const { plugin } = window.cardFixture;
      for (const todo of plugin.tasks.find(t => t.id === id).todos) if (!todo.done) await plugin.toggleTaskTodo(id, todo.id, true);
    }, ids.payment);
    assert.equal(await card(ids.payment).locator('.wt-todo-check:visible').count(), 0);
    await card(ids.payment).locator('.wt-completed-todos summary').click();
    assert.equal(await card(ids.payment).locator('.wt-todo-check:visible').count(), 4);
    assert.equal(await card(ids.payment).locator('.wt-card-composer').count(), 0);
  });
  for (const mode of ['group', 'quadrant']) for (const dark of [false, true]) for (const width of [390, 900, 1920]) for (const zoom of [60, 100, 120]) for (const presenting of [false, true]) {
    await check(`content fits ${mode} ${dark ? 'dark' : 'light'} ${width}px ${zoom}% presentation=${presenting}`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(async ({ mode, dark, zoom, presenting }) => {
        document.body.classList.toggle('theme-dark', dark);
        const { plugin } = window.cardFixture;
        await plugin.setViewMode(mode);
        await plugin.setBoardZoom(zoom);
        await plugin.setPresentationMode(presenting);
      }, { mode, dark, zoom, presenting });
      await settle();
      const layout = await page.locator('.wt-board').evaluate(board => {
        const cards = [...board.querySelectorAll('.wt-card')];
        return cards.map(el => { const r = el.getBoundingClientRect(), body = el.querySelector('.wt-card-body').getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height, body:body.height, scroll:el.scrollWidth, client:el.clientWidth }; });
      });
      for (const item of layout) { assert.ok(Math.abs(item.height - item.body - 2 * zoom / 100) < 1.1, JSON.stringify(item)); assert.ok(item.scroll <= item.client + 1); }
      for (let i=0; i<layout.length; i++) for (let j=i+1; j<layout.length; j++) {
        const a=layout[i], b=layout[j]; assert.ok(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1, 'overlapping cards');
      }
      if (presenting) assert.equal(await card(ids.many).locator('.wt-todo-check:visible').count(), 5);
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(`${checks} content-adaptive card checks passed.`);
} finally { await browser.close(); }
