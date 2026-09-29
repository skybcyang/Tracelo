import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm',
  external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
const failures = [];
let checks = 0;
async function check(name, test) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(3000);
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: `<style>${readFileSync('tests/helpers/obsidian-host.css', 'utf8')}\n${readFileSync('styles.css', 'utf8')}</style><script type="module">${bundle.outputFiles[0].text}</script>` }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  const ids = await page.evaluate(() => window.cardFixture.ids);
  const card = page.locator(`[data-task-id="${ids.payment}"]`);
  await card.locator('.wt-card-open').click();
  try { await test(page, card, ids); checks++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); }
  finally { await page.close(); }
}
try {
  await check('toolbar mode click retains an unsubmitted new-todo draft', async (page, card) => {
    await card.getByRole('textbox', { name: '新增待办', exact: true }).fill('还没有提交的下一步');
    await page.getByRole('button', { name: '展示模式', exact: true }).click();
    assert.equal(await card.getByRole('textbox', { name: '新增待办', exact: true }).inputValue(), '还没有提交的下一步');
    assert.equal(await page.locator('.wt-card-composer').count(), 1);
  });
  await check('a delayed mode preference write does not detach a composing editor', async (page, card) => {
    await page.evaluate(() => {
      const plugin = window.cardFixture.plugin;
      const save = plugin.saveData.bind(plugin); let held = false;
      plugin.saveData = async data => {
        if (!held) { held = true; await new Promise(resolve => { window.releaseMode = resolve; }); }
        await save(data);
      };
    });
    await page.getByRole('button', { name: '展示模式', exact: true }).click();
    await page.waitForFunction(() => window.releaseMode);
    await card.getByRole('textbox', { name: '记录当前进展', exact: true }).focus();
    await card.getByRole('textbox', { name: '记录当前进展', exact: true }).evaluate(input => {
      window.composingInput = input;
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      input.value = '中文候选';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true, data: '中文候选' }));
    });
    await page.evaluate(() => window.releaseMode());
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(() => window.composingInput.isConnected), true, 'replacing this input interrupts the OS composition session');
    assert.equal(await page.evaluate(() => document.activeElement === window.composingInput), true, 'preference completion must not steal focus from the active composition');
  });
  await check('pending progress remains locked across mode redraw until its write workflow settles', async (page, card) => {
    await card.getByRole('textbox', { name: '记录当前进展', exact: true }).fill('不能重复提交的进展');
    await page.waitForTimeout(300); // Let the independent draft debounce finish before holding the commit-state save.
    await page.evaluate(() => {
      const plugin = window.cardFixture.plugin;
      const save = plugin.saveData.bind(plugin); let held = false;
      plugin.saveData = async data => {
        if (!held) { held = true; await new Promise(resolve => { window.releaseProgress = resolve; }); }
        await save(data);
      };
    });
    await card.locator('.wt-card-composer button[type="submit"]').click();
    await page.waitForFunction(() => window.releaseProgress);
    assert.equal(await card.locator('.wt-card-composer button[type="submit"]').isDisabled(), true);
    await page.getByRole('button', { name: '展示模式', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.wt-presentation-toggle').getAttribute('aria-pressed') === 'true');
    const locked = await card.locator('.wt-card-composer button[type="submit"]').isDisabled();
    await page.evaluate(() => window.releaseProgress());
    assert.equal(locked, true, 'mode redraw must not recreate an enabled composer during pending recordProgress');
  });
  await check('pending notes save keeps its editor disabled and saving feedback across mode redraw', async (page, card) => {
    await card.locator('.wt-card-menu').click();
    await page.getByRole('menuitem', { name: '添加详情', exact: true }).click();
    await card.getByRole('textbox', { name: '任务详情', exact: true }).fill('保存中的详情');
    await page.evaluate(() => {
      const { plugin, ids } = window.cardFixture;
      const save = plugin.saveData.bind(plugin); let held = false;
      plugin.saveData = async data => {
        if (!held && plugin.tasks.find(t => t.id === ids.payment).notes === '保存中的详情') {
          held = true; await new Promise(resolve => { window.releaseNotes = resolve; });
        }
        await save(data);
      };
    });
    await card.getByRole('button', { name: '保存详情', exact: true }).click();
    await page.waitForFunction(() => window.releaseNotes);
    await page.getByRole('button', { name: '展示模式', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.wt-presentation-toggle').getAttribute('aria-pressed') === 'true');
    const result = { disabled: await card.getByRole('textbox', { name: '任务详情', exact: true }).isDisabled(), status: await card.locator('.wt-notes-status').textContent() };
    await page.evaluate(() => window.releaseNotes());
    assert.equal(result.disabled, true, 'mode redraw must preserve pending notes-save lock');
    assert.equal(result.status, '保存中…');
  });
  await check('mode waits for pending todo archive write, then preserves one confirmed event', async (page, card, ids) => {
    await page.evaluate(id => {
      const { plugin, app } = window.cardFixture;
      const write = app.vault.adapter.write.bind(app.vault.adapter); let held = false;
      app.vault.adapter.write = async (path, source) => {
        if (!held && path === plugin.taskArchivePath(id)) { held = true; await new Promise(resolve => { window.releaseTodo = resolve; }); }
        return write(path, source);
      };
    }, ids.payment);
    const todo = card.getByRole('checkbox', { name: '验证退款与异常流程', exact: true });
    await todo.check();
    await page.waitForFunction(() => window.releaseTodo);
    await page.getByRole('button', { name: '展示模式', exact: true }).click();
    assert.equal(await todo.isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '展示模式', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => window.releaseTodo());
    await page.waitForFunction(() => document.querySelector('.wt-presentation-toggle').getAttribute('aria-pressed') === 'true');
    assert.equal(await todo.isChecked(), true);
    assert.equal(await page.evaluate(id => window.cardFixture.plugin.tasks.find(t => t.id === id).events.filter(e => e.kind === 'todo_done' && e.text === '验证退款与异常流程').length, ids.payment), 1);
  });
  await check('mode redraw after failed progress retains retry text and never duplicates events', async (page, card, ids) => {
    await card.getByRole('textbox', { name: '记录当前进展', exact: true }).fill('失败后必须保留');
    await page.evaluate(id => {
      const { plugin, app } = window.cardFixture;
      const write = app.vault.adapter.write.bind(app.vault.adapter);
      app.vault.adapter.write = async (path, source) => {
        if (path === plugin.taskArchivePath(id)) throw new Error('模拟任务写入失败');
        return write(path, source);
      };
    }, ids.payment);
    await card.locator('.wt-card-composer button[type="submit"]').click();
    await page.getByText('模拟任务写入失败', { exact: true }).waitFor();
    await page.getByRole('button', { name: '展示模式', exact: true }).click();
    assert.equal(await card.getByRole('textbox', { name: '记录当前进展', exact: true }).inputValue(), '失败后必须保留');
    assert.equal(await page.evaluate(id => window.cardFixture.plugin.tasks.find(t => t.id === id).events.filter(e => e.text === '失败后必须保留').length, ids.payment), 0);
  });
  await check('switching task preserves the progress draft and only one composer', async (page, card, ids) => {
    await page.getByRole('button', { name: '展示模式', exact: true }).click();
    await card.getByRole('textbox', { name: '记录当前进展', exact: true }).fill('切卡后的草稿');
    const other = page.locator(`[data-task-id="${ids.plain}"]`);
    await other.locator('.wt-card-open').click();
    assert.equal(await page.locator('.wt-card-composer').count(), 1);
    await card.locator('.wt-card-open').click();
    assert.equal(await page.locator('.wt-card-composer').count(), 1);
    assert.equal(await card.getByRole('textbox', { name: '记录当前进展', exact: true }).inputValue(), '切卡后的草稿');
  });
  await check('successful progress returns keyboard focus to its remaining task control', async (page, card, ids) => {
    await card.getByRole('textbox', { name: '记录当前进展', exact: true }).fill('保存后的焦点');
    await card.locator('.wt-card-composer button[type="submit"]').click();
    await card.getByText('✓ 进展已记录', { exact: true }).waitFor();
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(id => document.activeElement?.closest('.wt-card')?.dataset.taskId === id, ids.payment), true, 'removing the composer must leave a reachable task focus');
  });
  await check('a pending notes save never steals focus from a different task being edited', async (page, card, ids) => {
    await card.locator('.wt-card-menu').click();
    await page.getByRole('menuitem', { name: '添加详情', exact: true }).click();
    await card.getByRole('textbox', { name: '任务详情', exact: true }).fill('前一张卡片待保存');
    await page.evaluate(() => {
      const { plugin, ids } = window.cardFixture;
      const save = plugin.saveData.bind(plugin); let held = false;
      plugin.saveData = async data => {
        if (!held && plugin.tasks.find(t => t.id === ids.payment).notes === '前一张卡片待保存') {
          held = true; await new Promise(resolve => { window.releasePriorNotes = resolve; });
        }
        await save(data);
      };
    });
    await card.getByRole('button', { name: '保存详情', exact: true }).click();
    await page.waitForFunction(() => window.releasePriorNotes);
    const next = page.locator(`[data-task-id="${ids.plain}"]`);
    await next.locator('.wt-card-open').click();
    await next.getByRole('textbox', { name: '记录当前进展', exact: true }).fill('正在另一张卡输入');
    await page.evaluate(() => window.releasePriorNotes());
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(id => document.activeElement?.closest('.wt-card')?.dataset.taskId === id, ids.plain), true, 'completion of an earlier task must not focus its old card');
    assert.equal(await next.getByRole('textbox', { name: '记录当前进展', exact: true }).inputValue(), '正在另一张卡输入');
  });
  await check('normal motion keeps the real 100-card masonry reading anchor and column order', async page => {
    const result = await page.evaluate(async () => {
      const { plugin, app } = window.cardFixture;
      const template = plugin.tasks[0];
      plugin.tasks = Array.from({ length: 100 }, (_, i) => ({ ...template, id: `edge-${i}`, title: `边界任务 ${i}`, todos: [], notes: '完整阅读内容需要多行显示。'.repeat(18), events: template.events.map((event, j) => ({ ...event, id: `edge-${i}-event-${j}` })) }));
      const view = app.workspace.getLeavesOfType('work-timeline-view')[0]?.view ?? app.workspace.getLeavesOfType('work-timeline')[0]?.view;
      if (view) { view.selectedTaskId = null; view.expandedTaskId = null; }
      await plugin.setCardLayout('masonry');
      const pane = document.querySelector('.wt-task-column');
      document.querySelector('.work-timeline-view').getAnimations({ subtree: true }).forEach(animation => animation.finish());
      pane.scrollTop = 2100;
      const paneTop = pane.getBoundingClientRect().top;
      const anchor = [...pane.querySelectorAll('.wt-card')].find(card => card.getBoundingClientRect().bottom > paneTop && card.getBoundingClientRect().top < pane.getBoundingClientRect().bottom);
      const id = anchor.dataset.taskId;
      const before = anchor.getBoundingClientRect().top - paneTop;
      const visibleIds = [...pane.querySelectorAll('.wt-card')].filter(card => card.getBoundingClientRect().bottom > paneTop && card.getBoundingClientRect().top < pane.getBoundingClientRect().bottom).map(card => card.dataset.taskId);
      const order = [...pane.querySelectorAll('.wt-masonry-column')].map(column => [...column.children].map(card => card.dataset.taskId));
      await plugin.setPresentationMode(true);
      const root = document.querySelector('.work-timeline-view');
      const animations = root.getAnimations({ subtree: true });
      animations.forEach(animation => { animation.pause(); animation.currentTime = Number(animation.effect.getTiming().duration) * .45; });
      const now = document.querySelector(`.wt-card[data-task-id="${id}"]`);
      const newPane = document.querySelector('.wt-task-column');
      const middle = now.getBoundingClientRect().top - newPane.getBoundingClientRect().top;
      animations.forEach(animation => animation.finish());
      return { before, middle, end: now.getBoundingClientRect().top - newPane.getBoundingClientRect().top, count: animations.length, visibleIds,
        animatedCards: [...new Set(animations.map(animation => animation.effect.target?.closest?.('.wt-card')?.dataset.taskId).filter(Boolean))],
        order, afterOrder: [...newPane.querySelectorAll('.wt-masonry-column')].map(column => [...column.children].map(card => card.dataset.taskId)) };
    });
    assert.deepEqual(result.afterOrder, result.order);
    assert.ok(result.animatedCards.length <= result.visibleIds.length && result.animatedCards.every(id => result.visibleIds.includes(id)), `offscreen cards should not animate: ${result.animatedCards.length} cards / ${result.visibleIds.length} visible`);
    assert.ok(Math.abs(result.before - result.middle) < 2 && Math.abs(result.before - result.end) < 2, `reading anchor moved ${result.before} → ${result.middle} → ${result.end}`);
  });
  await check('real progress commit produces one event and highlights only that new timeline node', async (page, card, ids) => {
    await card.getByRole('textbox', { name: '记录当前进展', exact: true }).fill('只确认一次的新记录');
    await card.locator('.wt-card-composer button[type="submit"]').click();
    await card.getByText('✓ 进展已记录', { exact: true }).waitFor();
    const result = await page.evaluate(id => {
      const { plugin, app } = window.cardFixture;
      const events = plugin.tasks.find(t => t.id === id).events.filter(e => e.text === '只确认一次的新记录');
      const added = document.querySelector(`[data-event-id="${events[0].id}"]`);
      const newAnimations = added.getAnimations({ subtree: true }).length;
      const oldAnimations = [...document.querySelectorAll('[data-event-id]')].filter(item => item !== added).reduce((total, item) => total + item.getAnimations({ subtree: true }).length, 0);
      document.querySelector('.work-timeline-view').getAnimations({ subtree: true }).forEach(animation => animation.finish());
      app.workspace.getLeavesOfType('work-timeline-view')[0].view.render();
      return { count: events.length, newAnimations, oldAnimations,
        replayed: document.querySelector(`[data-event-id="${events[0].id}"]`).getAnimations({ subtree: true }).length };
    }, ids.payment);
    assert.equal(result.count, 1);
    assert.ok(result.newAnimations > 0);
    assert.equal(result.oldAnimations, 0);
    assert.equal(result.replayed, 0);
  });
} finally { await browser.close(); }
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Presentation edge browser checks passed: ${checks}`);
