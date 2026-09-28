import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Exercise previously unchecked task.md boundaries against the real plugin.
// All writes stay in the browser fixture's isolated in-memory vault.
const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
const failures = [];
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 850 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const card = id => page.locator(`[data-task-id="${id}"]`);
  const task = id => page.evaluate(id => structuredClone(window.cardFixture.plugin.tasks.find(t => t.id === id)), id);
  async function check(name, run) {
    await page.goto('https://tracelo.test/');
    await page.waitForFunction(() => window.cardFixture);
    const ids = await page.evaluate(() => window.cardFixture.ids);
    try { await run(ids); checks++; console.log('PASS ' + name); }
    catch (error) { failures.push(name + ': ' + error.stack); }
  }

  await check('selection persists on collapse and clears on daily history', async ids => {
    const item = card(ids.payment);
    await item.locator('.wt-card-open').press('Enter');
    await settle();
    assert.ok(await item.evaluate(el => el.classList.contains('is-selected') && el.classList.contains('is-expanded')));
    await item.locator('.wt-card-open').press('Enter');
    await settle();
    assert.ok(await item.evaluate(el => el.classList.contains('is-selected') && !el.classList.contains('is-expanded')));
    assert.equal(await page.locator('.wt-timeline-column h2').textContent(), '完成支付模块');
    await page.getByRole('button', { name: '返回每日时间线', exact: true }).click();
    assert.equal(await page.locator('.wt-card.is-selected').count(), 0);
  });

  await check('hover does not move or scale cards in either theme', async ids => {
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.body.classList.toggle('theme-dark', dark), dark);
      await page.mouse.move(0, 0);
      const item = card(ids.payment), before = await item.boundingBox();
      await item.hover();
      await settle();
      assert.deepEqual(await item.boundingBox(), before);
      assert.equal(await item.evaluate(el => getComputedStyle(el).transform), 'none');
    }
  });

  await check('failed progress retains text; retry saves once with static success feedback', async ids => {
    await page.getByRole('button', { name: '展示模式', exact: true }).click();
    const item = card(ids.payment), before = await task(ids.payment);
    await item.locator('.wt-card-open').click();
    const input = item.locator('.wt-card-composer textarea');
    await input.fill('专项验收：失败后重试');
    await page.evaluate(() => {
      const adapter = window.cardFixture.app.vault.adapter, original = adapter.write;
      window.restoreWrite = () => { adapter.write = original; };
      adapter.write = async () => { throw new Error('专项验收写入失败'); };
    });
    await item.getByRole('button', { name: '记录进展', exact: true }).click();
    await page.locator('.notice').filter({ hasText: '专项验收写入失败' }).waitFor();
    assert.equal(await input.inputValue(), '专项验收：失败后重试');
    assert.equal(await input.isEnabled(), true);
    assert.deepEqual((await task(ids.payment)).events, before.events);
    await page.evaluate(() => window.restoreWrite());
    await item.getByRole('button', { name: '记录进展', exact: true }).click();
    await item.getByRole('status').filter({ hasText: '进展已记录' }).waitFor();
    const after = await task(ids.payment);
    assert.equal(after.events.filter(e => e.kind === 'progress').length, before.events.filter(e => e.kind === 'progress').length + 1);
    assert.equal(await item.locator('.wt-card-composer').count(), 0);
    assert.equal(await page.locator('.wt-card.is-expanded').count(), 4);
    assert.equal(await page.locator('.wt-card').first().getAttribute('data-task-id'), ids.payment);
    assert.equal(await item.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await item.getByRole('status').waitFor({ state: 'detached', timeout: 5000 });
  });

  await check('Escape protects composition, then closes with draft and title focus retained', async ids => {
    await page.getByRole('button', { name: '展示模式', exact: true }).click();
    const item = card(ids.payment);
    await item.locator('.wt-card-open').press('Enter');
    const input = item.locator('.wt-card-composer textarea');
    await input.fill('键盘关闭仍保留草稿');
    await input.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
    assert.equal(await input.count(), 1);
    await input.press('Escape');
    await settle();
    assert.equal(await input.count(), 0);
    assert.equal(await item.locator('.wt-card-open').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('.wt-card.is-expanded').count(), 4);
    await item.locator('.wt-card-open').press('Enter');
    assert.equal(await input.inputValue(), '键盘关闭仍保留草稿');
    await item.getByRole('button', { name: '关闭进展输入', exact: true }).click();
    await settle();
    assert.equal(await item.locator('.wt-card-open').evaluate(el => el === document.activeElement), true);
  });

  await check('rename cancellation, empty title and composing Enter leave the task unchanged', async ids => {
    const before = await task(ids.payment), item = card(ids.payment);
    await item.locator('.wt-card-rename').click();
    const input = page.locator('.wt-prompt-modal input');
    await input.fill('取消改名');
    await input.press('Escape');
    assert.deepEqual(await task(ids.payment), before);
    await item.locator('.wt-card-rename').click();
    await input.fill('');
    await page.getByRole('button', { name: '确认', exact: true }).click();
    assert.equal(await input.count(), 1);
    assert.deepEqual(await task(ids.payment), before);
    await input.fill('中文组合输入');
    const prevented = await input.evaluate(el => !el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    assert.equal(prevented, true);
    assert.deepEqual(await task(ids.payment), before);
    await page.getByRole('button', { name: '取消', exact: true }).click();
  });

  await check('rename failure retains input and archive; retry preserves identity, history and images', async ids => {
    await page.evaluate(async id => {
      const { plugin, app } = window.cardFixture;
      await plugin.accessTaskFolder(id, true);
      const folder = plugin.taskArchivePath(id).split('/').slice(0, -1).join('/');
      await app.vault.adapter.writeBinary(folder + '/reference.png', new Uint8Array([137, 80, 78, 71, 1, 2]).buffer);
      await plugin.saveTaskNotes(id, '前文\n![参考](<reference.png>)\n后文');
    }, ids.payment);
    const before = await task(ids.payment), item = card(ids.payment);
    const source = await page.evaluate(async id => {
      const { plugin, app } = window.cardFixture, path = plugin.taskArchivePath(id);
      window.renameOldPath = path;
      return app.vault.adapter.read(path);
    }, ids.payment);
    await item.locator('.wt-card-rename').click();
    const input = page.locator('.wt-prompt-modal input');
    await input.fill('中文验收 / 非法:字符?');
    await page.evaluate(() => {
      const adapter = window.cardFixture.app.vault.adapter, original = adapter.copy;
      window.restoreCopy = () => { adapter.copy = original; };
      adapter.copy = async () => { throw new Error('专项改名失败'); };
    });
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '专项改名失败' }).waitFor();
    assert.equal(await input.inputValue(), '中文验收 / 非法:字符?');
    assert.deepEqual(await task(ids.payment), before);
    assert.equal(await page.evaluate(() => window.cardFixture.app.vault.adapter.read(window.renameOldPath)), source);
    await page.evaluate(() => window.restoreCopy());
    await input.press('Enter');
    await page.locator('.wt-prompt-modal').waitFor({ state: 'detached' });
    const after = await task(ids.payment);
    assert.equal(after.title, '中文验收 / 非法:字符?');
    assert.equal(after.id, before.id);
    assert.deepEqual(after.events.slice(0, -1), before.events);
    assert.equal(after.events.at(-1).kind, 'renamed');
    assert.equal(after.notes, before.notes);
    assert.deepEqual(after.todos, before.todos);
    const files = await page.evaluate(async id => {
      const { plugin, app } = window.cardFixture, path = plugin.taskArchivePath(id), folder = path.split('/').slice(0, -1).join('/');
      return { path, bytes: [...new Uint8Array(await app.vault.adapter.readBinary(folder + '/reference.png'))], oldExists: await app.vault.adapter.exists(window.renameOldPath) };
    }, ids.payment);
    assert.ok(files.path.endsWith('中文验收 - 非法-字符-/'+ before.events[0].day +' 中文验收 - 非法-字符-.md'), files.path);
    assert.deepEqual(files.bytes, [137, 80, 78, 71, 1, 2]);
    assert.equal(files.oldExists, false);
  });

  await check('collapsed details do not manufacture a read-more control for short content', async ids => {
    const item = card(ids.plain);
    await item.getByRole('button', { name: '添加详情', exact: true }).click();
    await item.getByRole('textbox', { name: '任务详情', exact: true }).fill('完整短详情');
    await item.getByRole('button', { name: '保存详情', exact: true }).click();
    await item.locator('.wt-notes-preview').waitFor();
    await item.getByRole('button', { name: '关闭进展输入', exact: true }).click();
    await settle();
    assert.equal(await item.locator('.wt-notes-preview').textContent(), '完整短详情');
    assert.equal(await item.locator('.wt-read-more').isVisible(), false);
    assert.equal(await item.locator('.wt-card-composer').count(), 0);
  });

  await check('collapse returns an offscreen title to the reading area', async ids => {
    await page.evaluate(async id => window.cardFixture.plugin.saveTaskNotes(id, '长详情\n'.repeat(160)), ids.payment);
    const item = card(ids.payment);
    await item.locator('.wt-card-open').click();
    await item.getByRole('button', { name: '关闭进展输入', exact: true }).scrollIntoViewIfNeeded();
    const wasAbove = await item.evaluate(el => el.querySelector('.wt-card-heading').getBoundingClientRect().bottom < document.querySelector('.wt-task-column').getBoundingClientRect().top);
    assert.equal(wasAbove, true);
    await item.getByRole('button', { name: '关闭进展输入', exact: true }).click();
    await settle();
    const visible = await item.evaluate(el => {
      const title = el.querySelector('.wt-card-heading').getBoundingClientRect(), pane = document.querySelector('.wt-task-column').getBoundingClientRect();
      return title.top >= pane.top - 1 && title.bottom <= pane.bottom;
    });
    assert.equal(visible, true);
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(`${checks} task acceptance boundary checks passed.`);
} finally { await browser.close(); }
