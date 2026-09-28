import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Real plugin actions with isolated in-memory archives; never touches user tasks.
const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
const failures = [];
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(2500);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  async function check(name, run) {
    await page.goto('https://tracelo.test/');
    await page.waitForFunction(() => window.cardFixture);
    errors.length = 0;
    const ids = await page.evaluate(() => window.cardFixture.ids);
    try { await run(ids); assert.deepEqual(errors, []); checks++; console.log('PASS ' + name); }
    catch (error) { failures.push(name + ': ' + error.message); }
  }
  await check('card context and overflow menus expose details without duplicate card controls', async ids => {
    const card = page.locator(`[data-task-id="${ids.plain}"]`);
    assert.equal(await card.locator('.wt-card-rename').count(), 0);
    assert.equal(await card.locator('.wt-notes-entry, .wt-card-folder, button.wt-task-icon').count(), 0);
    await card.locator('.wt-card-open').click({ button: 'right' });
    const contextItems = await page.getByRole('menuitem').allTextContents();
    for (const name of ['改名', '添加详情', '记录进展', '添加待办', '设置截止日期', '完成', '异常关闭']) assert.ok(contextItems.includes(name), name);
    await page.getByRole('menuitem', { name: '添加详情', exact: true }).click();
    const input = card.getByRole('textbox', { name: '任务详情', exact: true });
    await input.fill('标题下直接显示的详情');
    await card.getByRole('button', { name: '保存详情', exact: true }).click();
    await card.locator('.wt-notes-preview').waitFor();
    assert.equal(await card.locator('.wt-details-heading').count(), 0);
    assert.equal(await card.getByRole('button', { name: '编辑详情', exact: true }).count(), 0);
    await card.locator('.wt-card-menu').click();
    const overflowItems = await page.getByRole('menuitem').allTextContents();
    assert.deepEqual(overflowItems, contextItems.map(name => name === '添加详情' ? '编辑详情' : name));
    await page.getByRole('menuitem', { name: '编辑详情', exact: true }).click();
    assert.equal(await input.inputValue(), '标题下直接显示的详情');
    await card.getByRole('button', { name: '取消详情编辑', exact: true }).click();
    await card.locator('.wt-card-menu').click();
    await page.getByRole('menuitem', { name: '记录进展', exact: true }).click();
    await page.waitForFunction(id => document.activeElement === document.querySelector(`[data-task-id="${id}"] .wt-card-composer textarea`), ids.plain);
    assert.equal(await card.locator('.wt-draft-state').count(), 0);
    const composer = card.locator('.wt-card-composer textarea');
    await composer.fill('没有提示文字也保留草稿');
    await card.getByRole('button', { name: '关闭进展输入', exact: true }).click();
    await card.locator('.wt-card-menu').click();
    await page.getByRole('menuitem', { name: '记录进展', exact: true }).click();
    assert.equal(await composer.inputValue(), '没有提示文字也保留草稿');
    await card.locator('.wt-card-menu').click();
    await page.getByRole('menuitem', { name: '添加待办', exact: true }).click();
    assert.equal(await card.getByRole('textbox', { name: '新增待办', exact: true }).evaluate(el => el === document.activeElement), true);
    await page.evaluate(id => window.cardFixture.plugin.finishTask(id), ids.plain);
    await page.locator('.wt-ended-section summary').click();
    await card.locator('.wt-card-menu').click();
    assert.equal(await page.getByRole('menuitem', { name: '记录进展', exact: true }).count(), 0);
    assert.equal(await page.getByRole('menuitem', { name: '添加待办', exact: true }).count(), 0);
    assert.equal(await page.getByRole('menuitem', { name: '重新打开', exact: true }).count(), 1);
    await page.getByRole('menuitem', { name: '编辑详情', exact: true }).click();
    assert.equal(await input.inputValue(), '标题下直接显示的详情');
  });
  await check('new todo keeps text during composing Escape and Enter, then submits normally', async ids => {
    const card = page.locator(`[data-task-id="${ids.plain}"]`);
    await card.locator('.wt-card-open').click();
    await card.getByRole('button', { name: '添加待办', exact: true }).click();
    const input = card.getByRole('textbox', { name: '新增待办', exact: true });
    await input.fill('正在选择中文待办');
    await input.dispatchEvent('compositionstart');
    await input.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
    assert.equal(await input.count(), 1);
    assert.equal(await input.inputValue(), '正在选择中文待办');
    await input.evaluate(el => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
      el.closest('form').requestSubmit();
    });
    assert.equal(await page.evaluate(id => window.cardFixture.plugin.tasks.find(t => t.id === id).todos?.length ?? 0, ids.plain), 0);
    await input.dispatchEvent('compositionend');
    await input.press('Enter');
    await page.waitForFunction(id => window.cardFixture.plugin.tasks.find(t => t.id === id).todos?.length === 1, ids.plain);
  });
  await check('group and quadrant choices stay in checked submenus and save correctly', async ids => {
    const card = page.locator(`[data-task-id="${ids.plain}"]`);
    await card.locator('.wt-card-menu').click();
    const top = await page.getByRole('menuitem').allTextContents();
    assert.ok(top.includes('分组') && top.includes('象限'));
    assert.ok(!top.some(name => name.startsWith('分组 ·') || name.startsWith('象限 ·')));
    assert.equal(await page.getByRole('menuitem', { name: '未分组', exact: true }).count(), 0);
    await page.getByRole('menuitem', { name: '分组', exact: true }).click();
    await page.getByRole('menuitem', { name: '未分组', exact: true }).click();
    await page.waitForFunction(id => window.cardFixture.plugin.tasks.find(t => t.id === id).groupId === null, ids.plain);
    await card.locator('.wt-card-menu').click();
    await page.getByRole('menuitem', { name: '分组', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: '未分组', exact: true }).getAttribute('aria-checked'), 'true');
    await page.getByRole('menuitem', { name: '产品研发', exact: true }).click();
    await card.locator('.wt-card-menu').click();
    await page.getByRole('menuitem', { name: '象限', exact: true }).click();
    await page.getByRole('menuitem', { name: '重要且紧急', exact: true }).click();
    await page.waitForFunction(id => { const task = window.cardFixture.plugin.tasks.find(t => t.id === id); return task.important && task.urgent; }, ids.plain);
    await card.locator('.wt-card-menu').click();
    await page.getByRole('menuitem', { name: '象限', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: '重要且紧急', exact: true }).getAttribute('aria-checked'), 'true');
  });
  for (const item of ['象限 · 重要且紧急', '分组 · 未分组', '重新打开']) {
    await check(`${item} reports a failed archive write without changing the task`, async ids => {
      if (item === '重新打开') await page.evaluate(id => window.cardFixture.plugin.finishTask(id), ids.plain);
      const before = await page.evaluate(id => structuredClone(window.cardFixture.plugin.tasks.find(t => t.id === id)), ids.plain);
      if (item === '重新打开') await page.locator('.wt-ended-section summary').click();
      await page.evaluate(() => { window.cardFixture.app.vault.adapter.write = async () => { throw new Error('入口测试写入失败'); }; });
      await page.locator(`[data-task-id="${ids.plain}"] .wt-card-menu`).click();
      if (item.includes(' · ')) await page.getByRole('menuitem', { name: item.split(' · ')[0], exact: true }).click();
      await page.getByRole('menuitem', { name: item.split(' · ').at(-1), exact: true }).click();
      await page.locator('.notice').filter({ hasText: '入口测试写入失败' }).waitFor();
      assert.deepEqual(await page.evaluate(id => structuredClone(window.cardFixture.plugin.tasks.find(t => t.id === id)), ids.plain), before);
    });
  }
  await check('card drop reports a failed state write and keeps a readable board', async ids => {
    await page.evaluate(() => { window.cardFixture.plugin.saveData = async () => { throw new Error('拖放测试状态保存失败'); }; });
    const data = await page.evaluateHandle(id => { const data = new DataTransfer(); data.setData('text/plain', id); return data; }, ids.plain);
    await page.locator(`[data-task-id="${ids.payment}"]`).dispatchEvent('drop', { dataTransfer: data });
    await page.locator('.notice').filter({ hasText: '拖放测试状态保存失败' }).waitFor();
    assert.equal(await page.locator('.wt-card').count(), 4);
    await data.dispose();
  });
  await check('empty-area drop reports a failed archive write', async ids => {
    await page.evaluate(() => { window.cardFixture.app.vault.adapter.write = async () => { throw new Error('跨组拖放失败'); }; });
    const data = await page.evaluateHandle(id => { const data = new DataTransfer(); data.setData('text/plain', id); return data; }, ids.plain);
    await page.locator('[data-area="ungrouped"] .wt-card-grid').dispatchEvent('drop', { dataTransfer: data });
    await page.locator('.notice').filter({ hasText: '跨组拖放失败' }).waitFor();
    await data.dispose();
  });
  await check('group reorder reports a failed write', async () => {
    await page.evaluate(() => window.cardFixture.plugin.addGroup('第二分组'));
    await page.getByRole('button', { name: '管理分组', exact: true }).click();
    await page.evaluate(() => { window.cardFixture.app.vault.adapter.write = async () => { throw new Error('分组排序失败'); }; });
    await page.getByRole('button', { name: '下移分组', exact: true }).first().click();
    await page.locator('.notice').filter({ hasText: '分组排序失败' }).waitFor();
  });
  for (const label of ['四象限', '缩小看板']) {
    await check(`${label} reports a failed setting write`, async () => {
      await page.evaluate(() => { window.cardFixture.plugin.saveData = async () => { throw new Error('显示设置失败'); }; });
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.locator('.notice').filter({ hasText: '显示设置失败' }).waitFor();
    });
  }
  assert.deepEqual(failures, []);
  console.log(`${checks} user-entry error and input checks passed.`);
} finally { await browser.close(); }
