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
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.setDefaultTimeout(2500);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const pane = page.locator('.wt-timeline-scroll');
  const anchor = () => pane.evaluate(el => { const top=el.getBoundingClientRect().top; const item=[...el.querySelectorAll('[data-event-id]')].find(n=>n.getBoundingClientRect().bottom>top); return {id:item?.dataset.eventId,offset:item?.getBoundingClientRect().top-top}; });
  const assertAnchor = async before => {
    const offset = await pane.evaluate((el, id) => el.querySelector(`[data-event-id="${id}"]`).getBoundingClientRect().top - el.getBoundingClientRect().top, before.id);
    assert.ok(Math.abs(offset - before.offset) < 1, `reading anchor ${before.id}: ${before.offset} → ${offset}`);
  };
  const view = 'work-timeline-view';
  const screenshot = async name => {
    if (process.env.TIMELINE_SCREENSHOT_DIR) await page.locator('.wt-timeline-column').screenshot({ path: resolve(process.env.TIMELINE_SCREENSHOT_DIR, `${name}.png`) });
  };
  async function check(name, run) { try { await run(); checks++; } catch (error) { failures.push(name + ': ' + error.stack); } }
  async function seed(kinds, taskMode = true) {
    await page.evaluate(({ kinds, taskMode, view }) => {
      const { plugin, app, ids } = window.cardFixture;
      const task = plugin.tasks.find(t => t.id === ids.payment);
      plugin.tasks.filter(t => t !== task).forEach(t => { t.events = t.events.map(e => ({ ...e, day: '2020-01-01', at: '2020-01-01T08:00:00+08:00' })); });
      task.events = kinds.map((kind, i) => ({ ...task.events[0], id: `timeline-${i}`, kind, title: task.title, text: `记录 ${i} ${kind} ` + (kind === 'progress' ? '正文完整阅读。'.repeat(12) : '属性变化'), at: `2026-09-${i < kinds.length / 2 ? '27' : '28'}T${String(8 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00+08:00`, day: `2026-09-${i < kinds.length / 2 ? '27' : '28'}` }));
      task.events.forEach(event => { event.at = new Date(event.at).toISOString(); });
      const timeline = app.workspace.getLeavesOfType(view)[0].view;
      timeline.selectedTaskId = null;
      timeline.selectedDay = '2026-01-01';
      timeline.render();
      timeline.selectedTaskId = taskMode ? task.id : null;
      timeline.narrowPane = 'history';
      timeline.selectedDay = '2026-09-28';
      timeline.render();
    }, { kinds, taskMode, view });
    await settle();
  }
  await check('all mixed events stay visible in chronological order on one continuous cross-day rail', async () => {
    const kinds = ['renamed', 'progress', 'todo_added', 'todo_done', 'progress', 'completed', 'reopened', 'closed', 'group_changed'];
    await seed(kinds);
    assert.equal(await pane.locator('details, summary').count(), 0);
    assert.equal(await pane.locator('.wt-event-text:visible').count(), kinds.length);
    const actual = await pane.locator('li').evaluateAll(items => items.map(el => el.className.split(' ')[0].replace('is-', '')));
    assert.deepEqual(actual, [...kinds].reverse());
    assert.equal(await pane.locator('.wt-event-task').count(), 0);
    assert.equal(await pane.locator('.wt-timeline-day h3').count(), 2);
    const rail = await pane.locator('.wt-event-stream').evaluate(el => {
      const line = getComputedStyle(el, '::before');
      const first = el.querySelector('li').getBoundingClientRect();
      const last = [...el.querySelectorAll('li')].at(-1).getBoundingClientRect();
      return { content: line.content, width: line.width, height: parseFloat(line.height), distance: last.top - first.top };
    });
    assert.equal(rail.width, '1px');
    assert.ok(rail.content !== 'none' && rail.height >= rail.distance);
    assert.equal(await pane.locator('.is-progress .wt-event-text').first().evaluate(el => getComputedStyle(el).fontSize), '11px');
    await pane.evaluate(el => { el.scrollTop = 0; });
    await screenshot('timeline-mixed');
  });
  await check('daily timeline interleaves tasks without fragmenting the rail', async () => {
    await seed(['created', 'progress', 'renamed', 'progress'], false);
    await page.evaluate(view => {
      const { plugin, app, ids } = window.cardFixture;
      const task = plugin.tasks.find(t => t.id === ids.plain);
      task.events.push({ ...task.events[0], id: 'interleaved-task', kind: 'progress', text: '另一任务的交错进展', day: '2026-09-28', at: '2026-09-28T00:02:30.000Z' });
      app.workspace.getLeavesOfType(view)[0].view.render();
    }, view);
    const titles = await pane.locator('.wt-event-task').allTextContents();
    assert.deepEqual(titles, ['完成支付模块', '整理客户反馈', '完成支付模块']);
    assert.equal(await pane.locator('.wt-event-stream').count(), 1);
    assert.equal(await pane.locator('.wt-event-list').count(), 1);
    const times = await pane.locator('time').evaluateAll(els => els.map(el => el.dateTime));
    assert.deepEqual(times, [...times].sort().reverse());
  });
  await check('property-only days keep every event visible and date controls work with keyboard', async () => {
    await seed(['renamed', 'todo_added', 'todo_done', 'group_changed'], false);
    assert.equal(await pane.locator('details').count(), 0);
    assert.equal(await pane.locator('.wt-event-text:visible').count(), 2);
    await page.getByRole('button', { name: '前一天', exact: true }).press('Enter');
    assert.equal(await page.getByLabel('选择时间线日期').inputValue(), '2026-09-27');
    assert.equal(await pane.locator('.wt-event-task:visible').count(), 2);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '前一天');
    await page.getByRole('button', { name: '后一天', exact: true }).press('Enter');
    assert.equal(await page.getByLabel('选择时间线日期').inputValue(), '2026-09-28');
    await pane.locator('.wt-event-task').first().press('Enter');
    await page.getByRole('button', { name: '返回每日时间线', exact: true }).waitFor();
    assert.equal(await pane.locator('.wt-event-task').count(), 0);
  });
  await check('bottom reading follows newly created tasks but not property-only updates', async () => {
    await seed(Array.from({ length: 20 }, () => 'progress'), false);
    await page.clock.setFixedTime(new Date('2026-09-28T12:00:00.000Z'));
    for (let i = 0; i < 6; i++) {
      await page.evaluate(async i => {
        await window.cardFixture.plugin.addTask({ title: `新任务 ${i}`, groupId: null, groupName: '未分组', important: false, urgent: false, todos: [], initialProgress: '', dueDate: null });
      }, i);
      await settle();
      assert.ok(await pane.evaluate(el => el.scrollTop < 2), `creation ${i} should follow to latest record`);
    }
    const top = await anchor();
    await page.evaluate(view => {
      const { plugin, app, ids } = window.cardFixture;
      const task = plugin.tasks.find(t => t.id === ids.payment);
      task.events.push({ ...task.events.at(-1), id: 'bottom-property', kind: 'renamed', text: '属性变更保留位置', at: '2026-09-28T13:00:00.000Z', day: '2026-09-28' });
      app.workspace.getLeavesOfType(view)[0].view.render();
    }, view);
    await settle();
    await assertAnchor(top);
  });
  await check('old-record reading survives rerenders, property updates and incoming progress', async () => {
    await seed(Array.from({ length: 32 }, (_, i) => i % 3 ? 'progress' : 'todo_added'));
    assert.ok(await pane.evaluate(el => el.scrollTop < 2), 'first entry opens at latest records');
    await pane.evaluate(el => { el.scrollTop = 140; });
    await settle();
    const before = await anchor();
    await page.evaluate(view => window.cardFixture.app.workspace.getLeavesOfType(view)[0].view.render(), view);
    await settle();
    await assertAnchor(before);
    await page.evaluate(view => {
      const { plugin, app, ids } = window.cardFixture;
      const task = plugin.tasks.find(t => t.id === ids.payment);
      task.events.push({ ...task.events.at(-1), id: 'new-property', kind: 'renamed', text: '新属性变更', at: '2026-09-28T04:00:00.000Z' });
      app.workspace.getLeavesOfType(view)[0].view.render();
    }, view);
    await settle();
    await assertAnchor(before);
    assert.equal(await page.getByRole('button', { name: '有新进展', exact: true }).count(), 0);
    await page.clock.setFixedTime(new Date('2026-09-29T12:00:00.000Z'));
    await page.evaluate(async () => window.cardFixture.plugin.recordProgress(window.cardFixture.ids.payment, '新进展不会抢走阅读位置'));
    await settle();
    await assertAnchor(before);
    await page.getByRole('button', { name: '有新进展', exact: true }).waitFor();
    await page.evaluate(view => window.cardFixture.app.workspace.getLeavesOfType(view)[0].view.render(), view);
    await settle();
    await page.getByRole('button', { name: '有新进展', exact: true }).press('Enter');
    await settle();
    assert.ok(await pane.evaluate(el => el.scrollTop < 2));
    assert.equal(await page.getByRole('button', { name: '有新进展', exact: true }).count(), 0);
    await page.evaluate(async () => window.cardFixture.plugin.recordProgress(window.cardFixture.ids.payment, '底部阅读跟随最新进展'));
    await settle();
    assert.ok(await pane.evaluate(el => el.scrollTop < 2));
  });
  await check('narrow timeline supports long content, both themes and empty date', async () => {
    await page.setViewportSize({ width: 1100, height: 700 });
    await seed(['created', 'progress', 'renamed', 'progress'], false);
    await page.evaluate(view => {
      const { plugin, app, ids } = window.cardFixture;
      const task = plugin.tasks.find(t => t.id === ids.payment);
      task.events.forEach(e => { e.title = '跨团队任务标题完整展示与连续阅读'.repeat(4); });
      app.workspace.getLeavesOfType(view)[0].view.render();
    }, view);
    for (const theme of ['', 'theme-dark']) {
      await page.evaluate(theme => { document.body.className = theme; }, theme);
      await settle();
      assert.ok(await page.locator('.wt-timeline-column').evaluate(el => el.scrollWidth <= el.clientWidth));
      assert.ok(await pane.locator('.wt-event-text').evaluateAll(items => items.every(el => el.scrollHeight <= el.clientHeight + 1)));
      assert.ok(await pane.locator('.wt-event-task').evaluateAll(items => items.every(el => getComputedStyle(el).whiteSpace !== 'nowrap')));
      await screenshot(theme ? 'timeline-dark' : 'timeline-light');
    }
    await page.getByLabel('选择时间线日期').fill('2026-01-01');
    await page.getByLabel('选择时间线日期').dispatchEvent('change');
    await page.getByText('这一天还没有记录', { exact: true }).waitFor();
    await page.getByRole('button', { name: '今天', exact: true }).press('Enter');
    assert.equal(await page.getByLabel('选择时间线日期').inputValue(), await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }));
  });
  await check('inserting earlier history preserves the visible event anchor', async () => {
    await seed(Array.from({ length: 30 }, () => 'progress'));
    await pane.evaluate(el => { el.scrollTop = 350; });
    const reading = await pane.evaluate(el => {
      const top = el.getBoundingClientRect().top;
      const item = [...el.querySelectorAll('li')].find(item => item.getBoundingClientRect().bottom > top);
      return { id: item.dataset.eventId, offset: item.getBoundingClientRect().top - top };
    });
    await page.evaluate(view => {
      const { plugin, app, ids } = window.cardFixture;
      const task = plugin.tasks.find(t => t.id === ids.payment);
      task.events.unshift({ ...task.events[0], id: 'earlier-history', kind: 'renamed', text: '外部同步的较早属性记录', at: '2026-09-26T08:00:00.000Z', day: '2026-09-26' });
      app.workspace.getLeavesOfType(view)[0].view.render();
    }, view);
    await settle();
    const offset = await pane.evaluate((el, id) => [...el.querySelectorAll('li')].find(item => item.dataset.eventId === id).getBoundingClientRect().top - el.getBoundingClientRect().top, reading.id);
    assert.ok(Math.abs(offset - reading.offset) < 1, `${offset} differs from ${reading.offset}`);
    assert.equal(await page.getByRole('button', { name: '有新进展', exact: true }).count(), 0);
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(`${checks} timeline continuity and reading checks passed.`);
} finally { await browser.close(); }
