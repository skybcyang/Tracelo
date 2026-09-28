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
  const page = await browser.newPage({ viewport: { width: 1440, height: 700 } });
  page.setDefaultTimeout(2500);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  const ids = await page.evaluate(() => window.cardFixture.ids);
  const card = id => page.locator(`[data-task-id="${id}"]`);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function check(name, run) { try { await run(); checks++; } catch (error) { failures.push(name + ': ' + error.stack); } }
  await check('display settings preserve the live timeline, scroll and history expansion', async () => {
    await page.evaluate(async id => { for (let i=0; i<12; i++) await window.cardFixture.plugin.recordProgress(id, `时间线位置检查 ${i}`); }, ids.payment);
    await card(ids.payment).locator('.wt-card-open').click();
    await settle();
    await page.locator('.wt-event-changes summary').first().click();
    await settle();
    await page.evaluate(() => {
      const pane = document.querySelector('.wt-timeline-column');
      const scroll = pane.querySelector('.wt-timeline-scroll');
      scroll.scrollTo({ top: 40, behavior: 'instant' });
      window.preservedTimeline = { pane, scroll, top: scroll.scrollTop, html: pane.innerHTML, changes: 0 };
      window.timelineObserver = new MutationObserver(records => window.preservedTimeline.changes += records.length);
      window.timelineObserver.observe(pane, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    for (const name of ['展示模式', '展示模式', '缩小看板', '恢复看板缩放为100%', '四象限', '分组']) {
      await page.getByRole('button', { name, exact: true }).click();
      await settle();
      const state = await page.evaluate(() => {
        const before = window.preservedTimeline, now = document.querySelector('.wt-timeline-column');
        return { same: now === before.pane, connected: before.pane.isConnected, scroll: now.querySelector('.wt-timeline-scroll').scrollTop === before.top, contents: now.innerHTML === before.html, mutations: before.changes };
      });
      assert.deepEqual(state, { same: true, connected: true, scroll: true, contents: true, mutations: 0 }, name);
    }
    await page.evaluate(() => window.timelineObserver.disconnect());
  });
  await check('legacy details are fully visible without expanding a card', async () => {
    await page.evaluate(async id => {
      const plugin = window.cardFixture.plugin;
      await plugin.saveTaskNotes(id, '第一段详情\n\n' + '完整长详情。'.repeat(100) + '\n\n最后一段详情');
      await plugin.setPresentationMode(false);
    }, ids.plain);
    const preview = card(ids.plain).locator('.wt-notes-preview');
    assert.equal(await card(ids.plain).locator('.wt-card-composer').count(), 0);
    assert.equal(await preview.count(), 1);
    assert.match(await preview.textContent(), /最后一段详情$/);
    assert.ok(await preview.evaluate(el => el.clientHeight >= el.scrollHeight - 1));
    await card(ids.plain).getByRole('button', { name: '编辑详情', exact: true }).click();
    await card(ids.plain).getByRole('textbox', { name: '任务详情', exact: true }).fill('取消的内容');
    await card(ids.plain).getByRole('button', { name: '取消详情编辑', exact: true }).click();
    assert.match(await preview.textContent(), /最后一段详情$/);
  });
  await check('creation accepts multiline details and retains them after a failed save', async () => {
    await page.getByRole('button', { name: '新建任务', exact: true }).click();
    await page.locator('.wt-modal-title').fill('创建即有详情');
    const details = page.getByRole('textbox', { name: '任务详情', exact: true });
    await details.fill('任务目标\n\n完整要求与参考链接 https://example.com');
    await page.evaluate(() => {
      const adapter = window.cardFixture.app.vault.adapter, original = adapter.write;
      window.restoreCreationWrite = () => { adapter.write = original; };
      adapter.write = async () => { throw new Error('测试创建失败'); };
    });
    try {
      await page.getByRole('button', { name: '创建任务', exact: true }).click();
      await page.locator('.wt-new-task-modal [role=alert]').filter({ hasText: '测试创建失败' }).waitFor();
      assert.equal(await details.inputValue(), '任务目标\n\n完整要求与参考链接 https://example.com');
    } finally { await page.evaluate(() => window.restoreCreationWrite()); }
    await page.getByRole('button', { name: '创建任务', exact: true }).click();
    await page.locator('.wt-new-task-modal').waitFor({ state: 'detached' });
    const saved = await page.evaluate(async () => {
      const { plugin, app } = window.cardFixture;
      const task = plugin.tasks.find(t => t.title === '创建即有详情');
      return { task, source: await app.vault.adapter.read(plugin.taskArchivePath(task.id)) };
    });
    assert.equal(saved.task.notes, '任务目标\n\n完整要求与参考链接 https://example.com');
    assert.deepEqual(saved.task.events.map(e => e.kind), ['created']);
    assert.ok(saved.source.includes('## 详情'));
    await card(saved.task.id).getByRole('button', { name: '关闭进展输入', exact: true }).click();
    await page.waitForFunction(id => document.querySelector(`[data-task-id="${id}"] .wt-notes-preview`)?.textContent === window.cardFixture.plugin.tasks.find(t => t.id === id).notes, saved.task.id);
    assert.equal(await card(saved.task.id).locator('.wt-notes-preview').textContent(), saved.task.notes);
  });
  await check('long detail images render in full on collapsed cards and open independently', async () => {
    const image = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="960"><rect width="160" height="960" fill="steelblue"/></svg>').toString('base64');
    await page.evaluate(async ({ id, image }) => {
      await window.cardFixture.plugin.saveTaskNotes(id, `图片之前\n![长截图](<${image}>)\n图片之后`);
      await window.cardFixture.plugin.setPresentationMode(false);
    }, { id: ids.dateOnly, image });
    const picture = card(ids.dateOnly).locator('.wt-notes-preview img');
    await picture.evaluate(img => img.decode());
    assert.equal(await picture.evaluate(img => img.getBoundingClientRect().height), 960);
    assert.equal(await card(ids.dateOnly).locator('.wt-card-composer').count(), 0);
    await picture.click();
    assert.equal(await page.locator('.modal-title').textContent(), '详情图片');
    assert.equal(await card(ids.dateOnly).locator('.wt-card-composer').count(), 0);
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(`${checks} display isolation and task-details checks passed.`);
} finally { await browser.close(); }
