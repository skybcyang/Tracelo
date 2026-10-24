import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const output = process.env.STAGE_SCROLL_OUTPUT ?? 'test-results/stage-scroll-20261024';
mkdirSync(output, { recursive: true });
const evidence = { startedAt: new Date().toISOString(), checks: [], result: 'failed' };
const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(5000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const module = name => page.locator(`.wt-stage-canvas [data-stage-module="${name}"]`);
const body = name => module(name).locator('.wt-stage-module-scroll');
const settle = () => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
});
const hit = locator => locator.evaluate(el => {
  const r = el.getBoundingClientRect();
  return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
});
const positions = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.wt-stage-canvas [data-stage-module]')].map(el => [el.dataset.stageModule, el.querySelector('.wt-stage-module-scroll').scrollTop])));
try {
  await page.route('https://tracelo.test/**', route => route.fulfill({ contentType: 'text/html', body: `<meta charset="utf-8"><style>${readFileSync('tests/helpers/obsidian-host.css', 'utf8')}\n${readFileSync('styles.css', 'utf8')}</style><script type="module">${bundle.outputFiles[0].text}</script>` }));
  await page.goto('https://tracelo.test/?workbench=1');
  await page.waitForFunction(() => window.cardFixture);
  const id = await page.evaluate(async () => {
    const { plugin } = window.cardFixture;
    const id = await plugin.addTask({ title: '隔离验证：模块内部滚动', groupId: null, groupName: '未分组', important: false, urgent: false, dueDate: null,
      initialProgress: Array.from({ length: 24 }, (_, i) => `进展 ${i + 1}：已验证业务边界，继续补充可追溯记录。`).join('\n\n'),
      notes: Array.from({ length: 36 }, (_, i) => `详情 ${i + 1}：完整保留背景、决定与参考材料，阅读长内容时模块标题和编辑入口应保持可见。`).join('\n\n'),
      todos: Array.from({ length: 32 }, (_, i) => `核查第 ${i + 1} 项边界与恢复流程`) });
    const key = JSON.stringify([plugin.state.taskDirectory, id]);
    await plugin.setStageLayout(key, { columns: ['progress', 'todos', 'details'].map(module => ({ width: 1 / 3, rows: [{ module, height: 1 }] })) });
    window.stageScrollTask = id;
    return id;
  });
  await page.locator(`.wt-cover-flow [data-cover-task="${id}"]`).click();
  await settle();
  const geometry = await page.evaluate(() => {
    const outer = document.querySelector('.wt-task-stage-scroll').getBoundingClientRect();
    return { outer: { top: outer.top, bottom: outer.bottom, height: outer.height }, modules: [...document.querySelectorAll('.wt-stage-canvas [data-stage-module]')].map(el => { const r = el.getBoundingClientRect(); return { name: el.dataset.stageModule, top: r.top, bottom: r.bottom, height: r.height }; }) };
  });
  evidence.initial = geometry;
  assert.ok(geometry.modules.every(m => m.bottom <= geometry.outer.bottom + 1), `long module content must remain within the stage viewport: ${JSON.stringify(geometry)}`);
  assert.ok(Math.max(...geometry.modules.map(m => m.height)) - Math.min(...geometry.modules.map(m => m.height)) < 2, 'three equal columns retain equal module heights');
  for (const name of ['progress', 'todos', 'details']) {
    assert.equal(await body(name).count(), 1, `${name} has one body scroll container`);
    assert.ok(await body(name).evaluate(el => el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 20), `${name} long content overflows its own body`);
  }
  const title = module('details').locator('h2');
  const titleBefore = await title.boundingBox();
  const outerBefore = await page.locator('.wt-task-stage-scroll').evaluate(el => el.scrollTop);
  await body('details').hover();
  await page.mouse.wheel(0, 180);
  await page.waitForFunction(() => document.querySelector('[data-stage-module="details"] .wt-stage-module-scroll').scrollTop > 0);
  assert.equal(await page.locator('.wt-task-stage-scroll').evaluate(el => el.scrollTop), outerBefore, 'wheel scroll moves the details body without moving the outer stage');
  await body('details').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await settle();
  assert.ok(await body('details').evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2), 'details body reaches its last line');
  assert.ok(Math.abs((await title.boundingBox()).y - titleBefore.y) < 1, 'scrolling body leaves the module heading fixed');
  assert.ok(await hit(module('details').getByRole('button', { name: '编辑详情', exact: true })), 'details action remains uncovered after scrolling');
  evidence.checks.push('long content stays inside equal-height modules; independent body scrolling and fixed actionable heading');
  await page.screenshot({ path: `${output}/reading-900.png` });

  const tallBody = await body('details').evaluate(el => el.clientHeight);
  for (const height of [720, 650]) {
    await page.setViewportSize({ width: 1280, height });
    await settle();
    const size = await body('details').evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight }));
    assert.ok(size.height > 0 && size.height < tallBody && size.scroll > size.height, `body adapts to ${height}px viewport without losing its content: ${JSON.stringify(size)}`);
    await body('details').evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await body('details').evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2), `last detail remains reachable at ${height}`);
  }
  evidence.checks.push('body adapts at 720/650px; last content remains reachable (outer fallback scrolling allowed)');

  await page.setViewportSize({ width: 1280, height: 900 });
  // Repeated wording still creates a new formal event. Its reading position
  // follows that event identity, while unchanged sibling modules keep theirs.
  const previousProgress = await page.evaluate(id => {
    const events = window.cardFixture.plugin.tasks.find(task => task.id === id).events.filter(event => event.kind === 'progress');
    return { id: events.at(-1).id, text: events.at(-1).text, count: events.length };
  }, id);
  await module('progress').getByRole('button', { name: '记录进展', exact: true }).click();
  const repeatedInput = module('progress').getByRole('textbox', { name: '记录当前进展', exact: true });
  await repeatedInput.fill(previousProgress.text);
  await settle();
  for (const name of ['progress', 'details', 'todos']) await body(name).evaluate(el => { el.scrollTop = 240; });
  const beforeRepeated = await positions();
  assert.ok(beforeRepeated.progress >= 200, 'repeated progress starts with its previous long body scrolled');
  await module('progress').locator('.wt-card-composer').getByRole('button', { name: '记录进展', exact: true }).click();
  await page.waitForFunction(({ id, previous }) => window.cardFixture.plugin.tasks.find(task => task.id === id).events.filter(event => event.kind === 'progress').at(-1).id !== previous, { id, previous: previousProgress.id });
  await module('progress').locator('.wt-card-composer').waitFor({ state: 'detached' });
  await settle();
  const repeated = await page.evaluate(id => {
    const plugin = window.cardFixture.plugin;
    const events = plugin.tasks.find(task => task.id === id).events.filter(event => event.kind === 'progress');
    return { id: events.at(-1).id, text: events.at(-1).text, count: events.length, draft: plugin.state.drafts[id] ?? '' };
  }, id);
  assert.equal(repeated.count, previousProgress.count + 1, 'identical text is appended exactly once');
  assert.equal(repeated.text, previousProgress.text, 'new event genuinely repeats the exact prior text');
  assert.notEqual(repeated.id, previousProgress.id, 'the appended progress has a new stable event identity');
  assert.equal(repeated.draft, '', 'confirmed progress clears its submitted draft');
  const afterRepeated = await positions();
  evidence.repeatedProgress = { before: beforeRepeated, after: afterRepeated, previousEvent: previousProgress.id, newEvent: repeated.id };
  assert.equal(afterRepeated.progress, 0, 'a new formal progress event starts at the top even when its text is identical');
  for (const name of ['details', 'todos']) assert.ok(Math.abs(afterRepeated[name] - beforeRepeated[name]) < 3, `${name} keeps its reading position after identical-text progress`);
  evidence.checks.push('identical-text progress appends one new event, resets only progress reading and clears its submitted draft');

  await module('progress').getByRole('button', { name: '记录进展', exact: true }).click();
  const input = module('progress').getByRole('textbox', { name: '记录当前进展', exact: true });
  await input.fill('内部滚动及同任务重绘后仍需保留的草稿');
  const editor = await input.elementHandle();
  await settle();
  for (const name of ['progress', 'todos', 'details']) await body(name).evaluate(el => { el.scrollTop = Math.min(160, el.scrollHeight - el.clientHeight); });
  const todo = module('todos').getByRole('checkbox', { name: '核查第 32 项边界与恢复流程', exact: true });
  await todo.scrollIntoViewIfNeeded();
  const before = await positions();
  assert.ok(before.todos > 0 && before.details > 0, 'refresh retention starts from genuinely scrolled modules');
  await todo.check();
  await page.waitForFunction(id => window.cardFixture.plugin.tasks.find(t => t.id === id).todos.at(-1).done, id);
  await settle();
  const after = await positions();
  for (const name of ['progress', 'todos', 'details']) assert.ok(Math.abs(after[name] - before[name]) < 3, `${name} reading position survives a todo-triggered redraw: ${before[name]} -> ${after[name]}`);
  assert.equal(await input.inputValue(), '内部滚动及同任务重绘后仍需保留的草稿');
  assert.ok(await editor.evaluate(el => el.isConnected), 'same-task redraw retains the live editor node');
  evidence.checks.push('checking a scrolled todo retains module reading positions, draft and editor identity');

  const existingBody = await body('details').elementHandle();
  const layoutBefore = await positions();
  await page.getByRole('separator', { name: '调整列宽', exact: true }).first().focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('.wt-layout-status').filter({ hasText: '布局已保存' }).waitFor();
  await settle();
  assert.ok(await existingBody.evaluate(el => el.isConnected), 'layout reparenting retains the body node');
  const layoutAfter = await positions();
  assert.ok(Math.abs(layoutAfter.details - layoutBefore.details) < 3, 'reparenting an unchanged-width details column preserves its reading position');
  assert.ok(await editor.evaluate(el => el.isConnected), 'layout reparenting retains the live editor');
  assert.equal(await input.inputValue(), '内部滚动及同任务重绘后仍需保留的草稿');
  evidence.checks.push('layout reparenting preserves existing scroll and editor nodes');

  // A real directory is loaded asynchronously. A second task interaction while
  // its refresh is pending must not replace the saved reading position with zero.
  await page.evaluate(async id => {
    const { app, plugin } = window.cardFixture;
    const folder = plugin.taskFolderPath(id);
    await app.vault.adapter.mkdir(folder);
    for (let i = 1; i <= 80; i++) await app.vault.adapter.write(`${folder}/资料-${String(i).padStart(2, '0')}.txt`, '隔离目录材料');
    const key = JSON.stringify([plugin.state.taskDirectory, id]);
    await plugin.setStageLayout(key, { columns: ['progress', 'details', 'files'].map(module => ({ width: 1 / 3, rows: [{ module, height: 1 }] })) });
    app.emitVaultEvent('create', folder);
  }, id);
  const tree = module('files').getByRole('tree', { name: '任务目录', exact: true });
  await page.waitForFunction(() => document.querySelectorAll('.wt-stage-canvas [data-stage-module="files"] [role="treeitem"]').length === 80);
  assert.equal(await body('files').count(), 1, 'directory has one body scroll container');
  assert.equal(await tree.evaluate(el => el.classList.contains('wt-stage-module-scroll')), true, 'directory retains tree semantics on its scroll container');
  await settle();
  await tree.evaluate(el => { el.scrollTop = 480; });
  const directoryTop = await tree.evaluate(el => el.scrollTop);
  assert.ok(directoryTop > 400, 'directory preservation begins with a genuinely scrolled 80-row list');
  await body('details').evaluate(el => { el.scrollTop = el.scrollHeight; });
  const editDetails = module('details').getByRole('button', { name: '编辑详情', exact: true });
  assert.ok(await hit(editDetails), 'edit details stays clickable with long body scrolled to its end');
  const detailsHeadingTop = (await module('details').locator('h2').boundingBox()).y;
  await page.evaluate(async id => {
    const { app, plugin } = window.cardFixture;
    const adapter = app.vault.adapter, folder = plugin.taskFolderPath(id);
    const original = adapter.list.bind(adapter);
    window.directoryListCalls = 0;
    const pending = new Promise(resolve => { window.releaseDirectoryList = () => { adapter.list = original; resolve(); }; });
    adapter.list = async path => {
      if (path === folder) { window.directoryListCalls++; await pending; }
      return original(path);
    };
    const added = `${folder}/资料-81.txt`;
    await adapter.write(added, '触发隔离异步刷新');
    app.emitVaultEvent('create', added);
  }, id);
  await page.waitForFunction(() => window.directoryListCalls >= 1);
  assert.equal(await tree.getByRole('treeitem').count(), 0, 'refresh remains pending until explicitly released');
  await editDetails.click();
  await module('details').locator('.wt-notes-editor').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.directoryListCalls >= 2);
  assert.ok(Math.abs((await module('details').locator('h2').boundingBox()).y - detailsHeadingTop) < 1, 'opening details editor keeps its heading fixed');
  await page.evaluate(() => window.releaseDirectoryList());
  await page.waitForFunction(() => document.querySelectorAll('.wt-stage-canvas [data-stage-module="files"] [role="treeitem"]').length === 81);
  await settle();
  const restoredDirectoryTop = await tree.evaluate(el => el.scrollTop);
  evidence.directory = { before: directoryTop, after: restoredDirectoryTop, rows: await tree.getByRole('treeitem').count() };
  assert.ok(Math.abs(restoredDirectoryTop - directoryTop) < 3, `delayed directory refresh preserves reading position across another interaction: ${directoryTop} -> ${restoredDirectoryTop}`);
  assert.equal(await input.inputValue(), '内部滚动及同任务重绘后仍需保留的草稿');
  assert.ok(await editor.evaluate(el => el.isConnected), 'asynchronous directory refresh retains the progress editor');
  await module('details').getByRole('button', { name: '取消', exact: true }).click();
  evidence.checks.push('80-row asynchronous directory refresh retains scroll across details editing; directory tree semantics and draft preserved');

  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  assert.ok(await page.locator('.view-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'narrow fallback has no horizontal overflow');
  const edit = module('details').getByRole('button', { name: '编辑详情', exact: true });
  await edit.scrollIntoViewIfNeeded();
  assert.ok(await hit(edit), 'narrow fallback keeps module controls reachable');
  evidence.checks.push('390px fallback has no horizontal overflow and exposes module controls');
  await page.screenshot({ path: `${output}/narrow.png` });
  assert.deepEqual(errors, []);
  evidence.result = 'passed';
  console.log(`PASS stage body scrolling: ${evidence.checks.join('; ')}`);
} catch (error) {
  evidence.error = error.message;
  await page.screenshot({ path: `${output}/failed.png` });
  throw error;
} finally {
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(`${output}/result.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
}
