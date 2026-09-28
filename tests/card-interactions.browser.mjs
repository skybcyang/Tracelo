import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({
  entryPoints: ["tests/helpers/card-fixture.mjs"], bundle: true, write: false, format: "esm",
  external: ["electron", "node:child_process"],
  alias: { obsidian: resolve("tests/helpers/obsidian-browser.mjs") },
});
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
const failures = [];
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("https://tracelo.test/", (route) => route.fulfill({
    contentType: "text/html",
    body: '<style>' + readFileSync("tests/helpers/obsidian-host.css", "utf8") + '\n' + readFileSync("styles.css", "utf8") + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>',
  }));
  await page.goto("https://tracelo.test/");
  await page.waitForFunction(() => window.cardFixture);
  const ids = await page.evaluate(() => window.cardFixture.ids);
  const card = (id) => page.locator('[data-task-id="' + id + '"]');
  let payment = card(ids.payment);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function check(name, run) {
    if (process.env.TRACE_CHECKS) console.log(name);
    try { await run(); checks++; } catch (error) { failures.push(name + ": " + error.message); }
  }
  await check('first image upload survives real folder events and saves its visible reference', async () => {
    await payment.getByRole('button', { name: '添加详情', exact: true }).click();
    const notes = payment.getByRole('textbox', { name: '任务详情', exact: true });
    await notes.fill('图片之前\n\n图片之后');
    await notes.evaluate(el => el.setSelectionRange(5, 5));
    await page.evaluate(() => {
      const { app } = window.cardFixture;
      const mkdir = app.vault.adapter.mkdir.bind(app.vault.adapter);
      app.vault.adapter.mkdir = async path => { await mkdir(path); app.emitVaultEvent('create', path); };
    });
    await payment.getByLabel('插入详情图片', { exact: true }).setInputFiles({
      name: 'reference.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
    });
    await page.waitForFunction(id => window.cardFixture.plugin.state.noteDrafts[id]?.includes('image-'), ids.payment);
    const visible = await notes.inputValue();
    assert.match(visible, /图片之前\n!\[reference\.png\]\(<image-[^>]+\.png>\)\n图片之后/);
    await payment.getByRole('button', { name: '保存详情', exact: true }).click();
    await page.waitForFunction(id => !Object.hasOwn(window.cardFixture.plugin.state.noteDrafts, id), ids.payment);
    const saved = await page.evaluate(async id => {
      const { plugin, app } = window.cardFixture;
      return { notes: plugin.tasks.find(task => task.id === id).notes, source: await app.vault.adapter.read(plugin.taskArchivePath(id)) };
    }, ids.payment);
    assert.equal(saved.notes, visible);
    assert.ok(saved.source.includes(visible));
  });
  await check('clipboard images replace the selection in order and keep exact attachment bytes', async () => {
    await payment.getByRole('button', { name: '编辑详情', exact: true }).click();
    const notes = payment.getByRole('textbox', { name: '任务详情', exact: true });
    await notes.fill('前文\n替换这里\n后文');
    await notes.evaluate(el => {
      el.setSelectionRange(3, 7);
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array([1, 2, 3])], 'paste-a.png', { type: 'image/png' }));
      data.items.add(new File([new Uint8Array([4, 5, 6])], 'paste-b.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await payment.getByText('图片已插入，请保存详情', { exact: true }).waitFor();
    const visible = await notes.inputValue();
    assert.match(visible, /^前文\n!\[paste-a.png\]\(<image-[^>]+>\)!\[paste-b.png\]\(<image-[^>]+>\)\n后文$/);
    await payment.getByRole('button', { name: '保存详情', exact: true }).click();
    const saved = await page.evaluate(async id => {
      const { plugin, app } = window.cardFixture;
      const task = plugin.tasks.find(t => t.id === id);
      const paths = Array.from(task.notes.matchAll(/<([^>]+)>/g), match => match[1]);
      const folder = plugin.taskArchivePath(id).split('/').slice(0, -1).join('/');
      return { notes: task.notes, bytes: await Promise.all(paths.map(async path => Array.from(new Uint8Array(await app.vault.adapter.readBinary(folder + '/' + path))))) };
    }, ids.payment);
    assert.equal(saved.notes, visible);
    assert.deepEqual(saved.bytes, [[1, 2, 3], [4, 5, 6]]);
  });
  await check('external image drop ignores non-images and never moves the dragged task id', async () => {
    await payment.getByRole('button', { name: '编辑详情', exact: true }).click();
    const notes = payment.getByRole('textbox', { name: '任务详情', exact: true });
    await notes.fill('拖入前\n\n拖入后');
    const before = await page.evaluate(() => window.cardFixture.plugin.tasks);
    await notes.evaluate((el, moving) => {
      el.setSelectionRange(4, 4);
      const data = new DataTransfer();
      data.setData('text/plain', moving);
      data.items.add(new File(['ignored'], 'ignore.txt', { type: 'text/plain' }));
      data.items.add(new File([new Uint8Array([7, 8, 9])], 'drop.png', { type: 'image/png' }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    }, ids.plain);
    await payment.getByText('图片已插入，请保存详情', { exact: true }).waitFor();
    const visible = await notes.inputValue();
    assert.match(visible, /^拖入前\n!\[drop.png\]\(<image-[^>]+>\)\n拖入后$/);
    assert.deepEqual(await page.evaluate(() => window.cardFixture.plugin.tasks), before);
    await payment.getByRole('button', { name: '保存详情', exact: true }).click();
    assert.equal(await payment.locator('.wt-notes-preview img').count(), 1);
  });
  await check('pending and failed image writes protect the editor and permit a clipboard retry', async () => {
    await payment.getByRole('button', { name: '编辑详情', exact: true }).click();
    const notes = payment.getByRole('textbox', { name: '任务详情', exact: true });
    await notes.fill('失败后保留文字');
    await page.evaluate(() => {
      const adapter = window.cardFixture.app.vault.adapter;
      window.restoreImageWrite = adapter.writeBinary;
      adapter.writeBinary = () => new Promise((_, reject) => { window.rejectImageWrite = () => reject(new Error('附件磁盘写入失败')); });
    });
    const pasteImage = () => notes.evaluate(el => {
      el.setSelectionRange(el.value.length, el.value.length);
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array([10, 11])], 'retry.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
    await pasteImage();
    await page.waitForFunction(() => Boolean(window.rejectImageWrite));
    assert.equal(await notes.isDisabled(), true);
    assert.equal(await payment.getByRole('button', { name: '保存详情', exact: true }).isDisabled(), true);
    await payment.getByText('图片上传中…', { exact: true }).waitFor();
    await payment.getByRole('button', { name: '取消详情编辑', exact: true }).click();
    assert.equal(await notes.count(), 1);
    await page.evaluate(() => window.rejectImageWrite());
    await payment.getByText('上传失败：附件磁盘写入失败', { exact: true }).waitFor();
    assert.equal(await notes.inputValue(), '失败后保留文字');
    assert.equal(await notes.isDisabled(), false);
    await page.evaluate(() => { window.cardFixture.app.vault.adapter.writeBinary = window.restoreImageWrite; });
    await pasteImage();
    await payment.getByText('图片已插入，请保存详情', { exact: true }).waitFor();
    assert.match(await notes.inputValue(), /^失败后保留文字!\[retry.png\]/);
    await payment.getByRole('button', { name: '保存详情', exact: true }).click();
    await payment.getByRole('button', { name: '编辑详情', exact: true }).click();
    await notes.fill('图片已移除，文字保留');
    await payment.getByRole('button', { name: '保存详情', exact: true }).click();
    assert.equal(await payment.locator('.wt-notes-preview img').count(), 0);
    await payment.getByRole('button', { name: '编辑详情', exact: true }).click();
    await notes.fill('');
    await payment.getByRole('button', { name: '保存详情', exact: true }).click();
    assert.equal(await payment.locator('.wt-notes-preview').count(), 0);
    await payment.getByRole('button', { name: '添加详情', exact: true }).waitFor();
    assert.equal(await page.evaluate(id => window.cardFixture.plugin.tasks.find(t => t.id === id).events.filter(e => e.kind === 'progress').length, ids.payment), 1);
  });
  await page.reload();
  await page.waitForFunction(() => window.cardFixture);
  Object.assign(ids, await page.evaluate(() => window.cardFixture.ids));
  payment = card(ids.payment);
  await check('optional icons and a direct rename entry are available', async () => {
    assert.equal(await payment.locator('.wt-task-icon').count(), 1);
    assert.equal(await payment.getByRole('button', { name: '编辑标题：完成支付模块', exact: true }).count(), 1);
  });
  await check('board controls offer independent zoom and presentation mode', async () => {
    assert.equal(await page.getByRole('button', { name: '缩小看板', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '展示模式', exact: true }).count(), 1);
  });
  await check('view settings fit the top bar across narrow and dark layouts', async () => {
    try {
      for (const dark of [false, true]) for (const width of [390, 900, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(dark => document.body.classList.toggle('theme-dark', dark), dark);
        const geometry = await page.getByRole('button', { name: '缩小看板', exact: true }).evaluate(button => {
          const header = button.closest('.wt-header');
          if (!header) return null;
          const bar = header.getBoundingClientRect(), layout = document.querySelector('.wt-layout').getBoundingClientRect();
          const root = document.querySelector('.work-timeline-view');
          return { top: bar.top, bottom: bar.bottom, contentTop: layout.top, hostBottom: root.getBoundingClientRect().bottom, overflow: root.scrollWidth > root.clientWidth, controls: [...header.querySelectorAll('button')].filter(el => el.getClientRects().length).map(el => { const r = el.getBoundingClientRect(); return { height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }) };
        });
        assert.ok(geometry, 'display settings must be grouped in the header');
        assert.ok(geometry.bottom <= geometry.contentTop + 1 && geometry.bottom <= geometry.hostBottom + 1, JSON.stringify(geometry));
        assert.equal(geometry.overflow, false);
        assert.ok(geometry.controls.every(control => control.height >= 30 && control.top >= geometry.top && control.bottom <= geometry.bottom));
        for (let i=0; i<geometry.controls.length; i++) for (let j=i+1; j<geometry.controls.length; j++) {
          const a=geometry.controls[i], b=geometry.controls[j];
          assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, 'header controls overlap');
        }
        const before = await page.getByRole('button', { name: '缩小看板', exact: true }).boundingBox();
        await page.evaluate(() => { document.querySelector('.wt-task-column').scrollTop = 500; document.querySelector('.wt-layout').scrollTop = 500; });
        assert.deepEqual(await page.getByRole('button', { name: '缩小看板', exact: true }).boundingBox(), before);
      }
    } finally {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => { document.body.classList.remove('theme-dark'); document.querySelector('.wt-task-column').scrollTop = 0; document.querySelector('.wt-layout').scrollTop = 0; });
    }
  });
  await check('keyboard zoom retains focus for repeated steps and moves to reset at the limit', async () => {
    const smaller = page.getByRole('button', { name: '缩小看板', exact: true });
    const reset = page.getByRole('button', { name: '恢复看板缩放为100%', exact: true });
    try {
      await smaller.focus();
      await page.keyboard.press('Enter');
      await settle();
      assert.equal(await smaller.evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Enter');
      await settle();
      assert.equal(await reset.textContent(), '90%');
      await page.evaluate(() => window.cardFixture.plugin.setBoardZoom(65));
      await smaller.focus();
      await page.keyboard.press('Enter');
      await settle();
      assert.equal(await smaller.isDisabled(), true);
      assert.equal(await reset.evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Enter');
      await settle();
      assert.equal(await reset.textContent(), '100%');
    } finally { await page.evaluate(() => window.cardFixture.plugin.setBoardZoom(100)); }
  });
  await check('presentation exposes all information but only the clicked card editor', async () => {
    await page.getByRole('button', { name: '展示模式', exact: true }).click();
    assert.equal(await page.locator('.wt-card.is-expanded').count(), 4);
    assert.equal(await page.locator('.wt-card-composer').count(), 0);
    await payment.locator('.wt-card-latest').click();
    await settle();
    assert.equal(await page.locator('.wt-card-composer').count(), 1);
    assert.equal(await payment.locator('textarea').evaluate(el => el === document.activeElement), true);
    await payment.locator('.wt-card-composer textarea').fill('保留展示草稿');
    await page.getByRole('button', { name: '缩小看板', exact: true }).click();
    assert.equal(await page.evaluate(() => window.cardFixture.plugin.state.boardZoom), 95);
    assert.equal(await payment.locator('.wt-card-composer textarea').inputValue(), '保留展示草稿');
    await payment.getByRole('button', { name: '关闭进展输入', exact: true }).click();
    assert.equal(await page.locator('.wt-card-composer').count(), 0);
    assert.equal(await page.locator('.wt-card.is-expanded').count(), 4);
    await page.getByRole('button', { name: '展示模式', exact: true }).click();
    await page.getByRole('button', { name: '恢复看板缩放为100%', exact: true }).click();
  });
  await check('notes save separately and unsaved text survives switching cards', async () => {
    await payment.getByRole('button', { name: '添加详情', exact: true }).click();
    await payment.getByRole('textbox', { name: '任务详情', exact: true }).fill('背景信息\nhttps://example.com');
    await card(ids.plain).locator('.wt-card-open').click();
    await payment.getByRole('button', { name: '详情 · 有未保存内容', exact: true }).click();
    assert.equal(await payment.getByRole('textbox', { name: '任务详情', exact: true }).inputValue(), '背景信息\nhttps://example.com');
    const before = await payment.locator('.wt-card-latest').textContent();
    await payment.getByRole('button', { name: '保存详情', exact: true }).click();
    await page.waitForFunction(id => window.cardFixture.plugin.tasks.find(t => t.id === id).notes === '背景信息\nhttps://example.com', ids.payment);
    assert.equal(await payment.locator('.wt-card-latest').textContent(), before);
    assert.equal(await payment.locator('.wt-notes-preview').textContent(), '背景信息\nhttps://example.com');
    assert.equal(await page.locator('.wt-event-changes .is-notes_changed').count(), 1);
    assert.equal(await page.locator('.wt-event-changes .is-notes_changed').isVisible(), false);
  });
  await check('failed notes save keeps the draft and retry succeeds without progress changes', async () => {
    await payment.getByRole('button', { name: '编辑详情', exact: true }).click();
    await payment.getByRole('textbox', { name: '任务详情', exact: true }).fill('失败后继续编辑');
    await page.evaluate(() => {
      const adapter = window.cardFixture.app.vault.adapter;
      window.restoreNotesWrite = adapter.write;
      adapter.write = async () => { throw new Error('模拟磁盘错误'); };
    });
    await payment.getByRole('button', { name: '保存详情', exact: true }).click();
    await payment.getByText('保存失败：模拟磁盘错误', { exact: true }).waitFor();
    assert.equal(await payment.getByRole('textbox', { name: '任务详情', exact: true }).inputValue(), '失败后继续编辑');
    await page.evaluate(() => { window.cardFixture.app.vault.adapter.write = window.restoreNotesWrite; });
    await payment.getByRole('button', { name: '保存详情', exact: true }).click();
    await page.waitForFunction(id => window.cardFixture.plugin.tasks.find(t => t.id === id).notes === '失败后继续编辑', ids.payment);
  });
  await check('60 percent zoom increases columns while toolbar and timeline stay unscaled', async () => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    const measure = () => page.evaluate(() => ({
      columns: getComputedStyle(document.querySelector('.wt-card-grid')).gridTemplateColumns.split(' ').length,
      toolbar: document.querySelector('.wt-task-toolbar').getBoundingClientRect().height,
      timeline: getComputedStyle(document.querySelector('.wt-timeline-column')).fontSize,
    }));
    await settle(); const before = await measure();
    await page.evaluate(() => window.cardFixture.plugin.setBoardZoom(60));
    await settle(); const after = await measure();
    assert.ok(after.columns > before.columns, JSON.stringify({ before, after }));
    assert.equal(after.toolbar, before.toolbar);
    assert.equal(after.timeline, before.timeline);
    assert.equal(await page.getByRole('button', { name: '缩小看板', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.cardFixture.plugin.setBoardZoom(120));
    assert.equal(await page.getByRole('button', { name: '放大看板', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '恢复看板缩放为100%', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check('committed progress and notes are not retried when preference persistence fails', async () => {
    const result = await page.evaluate(async id => {
      const plugin = window.cardFixture.plugin;
      const save = plugin.saveData;
      const before = plugin.tasks.find(t => t.id === id).events.filter(e => e.kind === 'progress').length;
      plugin.saveData = async () => { throw new Error('偏好保存失败'); };
      try {
        await plugin.recordProgress(id, '正式保存一次');
        await plugin.saveTaskNotes(id, '正式详情已保存');
        return { count: plugin.tasks.find(t => t.id === id).events.filter(e => e.kind === 'progress').length - before, notes: plugin.tasks.find(t => t.id === id).notes, draft: plugin.state.drafts[id] };
      } finally { plugin.saveData = save; }
    }, ids.plain);
    assert.deepEqual(result, { count: 1, notes: '正式详情已保存', draft: undefined });
  });
  await check('directory migration preserves nested task images and progress drafts', async () => {
    const result = await page.evaluate(async id => {
      const { plugin, app } = window.cardFixture;
      const path = await plugin.addNoteAttachment(id, '截图.png', new Uint8Array([1, 2, 3]).buffer);
      await plugin.saveTaskNotes(id, `图片之前\n![截图](<${path}>)\n图片之后`);
      const before = structuredClone(plugin.tasks.find(t => t.id === id));
      await plugin.changeTaskDirectory('迁移后的任务');
      const task = plugin.tasks.find(t => t.id === id);
      return { before, task, bytes: [...new Uint8Array(await app.vault.adapter.readBinary(task.materialFolder + '/' + path))], source: await app.vault.adapter.read(plugin.taskArchivePath(id)), draft: plugin.state.drafts[id] };
    }, ids.payment);
    assert.deepEqual(result.bytes, [1, 2, 3]);
    assert.equal(result.task.id, result.before.id);
    assert.equal(result.task.notes, result.before.notes);
    assert.match(result.task.materialFolder, /^迁移后的任务\//);
    assert.match(result.source, /图片之前/);
    assert.equal(result.draft, '保留展示草稿');
  });
  await check('external create and atomic rename events ingest and deduplicate cards', async () => {
    const id = await page.evaluate(async () => {
      const fixture = window.cardFixture;
      const { task, source } = fixture.externalArchive();
      const path = `${fixture.plugin.state.taskDirectory}/${task.archiveName}.md`;
      await fixture.app.vault.adapter.write(path, source);
      fixture.app.emitVaultEvent('create', path);
      fixture.app.emitVaultEvent('rename', path, path + '.tmp');
      return task.id;
    });
    await page.waitForFunction(id => window.cardFixture.plugin.tasks.some(task => task.id === id), id);
    assert.equal(await card(id).count(), 1);
    assert.equal(await card(id).locator('.wt-card-latest').count(), 0);
    assert.equal(await card(id).getByRole('button', { name: '编辑详情', exact: true }).count(), 1);
  });
  await page.reload();
  await page.waitForFunction(() => window.cardFixture);
  Object.assign(ids, await page.evaluate(() => window.cardFixture.ids));
  payment = card(ids.payment);
  await check('top-level creation needs only a title and defaults to ungrouped, neither important nor urgent', async () => {
    await page.getByRole('button', { name: '新建任务', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: '任务分组' }).inputValue(), '');
    assert.equal(await page.getByRole('combobox', { name: '任务象限', exact: true }).inputValue(), 'not_important_not_urgent');
    await page.locator('.wt-modal-title').fill('默认分类任务');
    await page.getByRole('button', { name: '创建任务', exact: true }).click();
    await page.locator('.wt-new-task-modal').waitFor({ state: 'detached' });
    const created = await page.evaluate(() => window.cardFixture.plugin.tasks.find(t => t.title === '默认分类任务'));
    assert.equal(created.groupId, null);
    assert.equal(created.important, false);
    assert.equal(created.urgent, false);
    assert.equal(created.dueDate ?? null, null);
    assert.equal(created.todos?.length ?? 0, 0);
  });
  await page.reload();
  await page.waitForFunction(() => window.cardFixture);
  Object.assign(ids, await page.evaluate(() => window.cardFixture.ids));
  payment = card(ids.payment);
  await check('compact summaries show proportional progress without repeated labels', async () => {
    const futureLabel = await page.evaluate(async id => {
      const date = new Date(); date.setDate(date.getDate() + 7);
      const day = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      await window.cardFixture.plugin.setTaskDueDate(id, day);
      return `${date.getMonth()+1}月${date.getDate()}日`;
    }, ids.payment);
    const summary = payment.getByRole('button', { name: '查看待办，已完成 2/4', exact: true });
    assert.equal((await summary.textContent()).trim(), '2/4');
    assert.equal(await summary.locator('.wt-progress-value').getAttribute('stroke-dasharray'), '50 100');
    assert.equal(await payment.locator('.wt-card-properties').textContent(), '重要');
    assert.equal(await payment.locator('.wt-due-chip').textContent(), futureLabel);
    assert.match(await payment.locator('.wt-due-chip').getAttribute('aria-label'), /截止/);
  });
  await check('quadrant color has text context and cards omit duplicate priority labels', async () => {
    await page.getByRole('button', { name: '四象限', exact: true }).click();
    assert.equal(await payment.locator('.wt-card-properties').textContent(), '产品研发');
    const colors = await page.locator('.wt-section-heading').evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
    assert.equal(new Set(colors).size, 4);
    assert.ok(colors.every(color => color !== 'rgba(0, 0, 0, 0)'));
    await page.getByRole('button', { name: '分组', exact: true }).click();
  });
  await check('property history is disclosed in chronological position without losing events', async () => {
    await payment.locator('.wt-card-open').click();
    // Card expansion restores focus on the next frame; finish that before moving
    // keyboard focus to the timeline disclosure.
    await settle();
    const expected = await page.evaluate(id => window.cardFixture.plugin.tasks.find(t => t.id === id).events.map(e => e.text), ids.payment);
    // Events recorded within the same millisecond may have a deterministic ID tie-break.
    assert.deepEqual((await page.locator('.wt-timeline-scroll .wt-event-text').allTextContents()).sort(), [...expected].sort());
    const timestamps = await page.locator('.wt-timeline-scroll time').evaluateAll(els => els.map(el => el.getAttribute('datetime')));
    assert.deepEqual(timestamps, [...timestamps].sort());
    const details = page.locator('.wt-event-changes').first();
    assert.equal(await details.count(), 1);
    assert.equal(await details.getAttribute('open'), null);
    await details.locator('summary').press('Enter');
    await details.locator('.wt-event-list').waitFor({ state: 'visible' });
    assert.notEqual(await details.getAttribute('open'), null);
    await payment.locator('.wt-card-open').click();
    await page.getByRole('button', { name: '返回每日时间线', exact: true }).click();
  });
  await check('complete and empty progress rings track checklist state without replacing progress', async () => {
    const latest = await payment.locator('.wt-card-latest').textContent();
    await payment.locator('.wt-card-open').click();
    for (let i = 0; i < 4; i++) await payment.locator('.wt-todo-check').nth(i).check();
    assert.equal(await payment.locator('.wt-progress-value').getAttribute('stroke-dasharray'), '100 100');
    assert.equal(await payment.locator('.wt-progress-chip.is-complete').textContent(), '4/4');
    for (let i = 0; i < 4; i++) await payment.locator('.wt-todo-check').nth(i).uncheck();
    assert.equal(await payment.locator('.wt-progress-value').getAttribute('stroke-dasharray'), '0 100');
    assert.equal(await payment.locator('.wt-progress-chip.is-empty').textContent(), '0/4');
    assert.equal(await payment.locator('.wt-card-latest').textContent(), latest);
  });
  await check('today and overdue styling clears for ended tasks and retains their context', async () => {
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
    await page.evaluate(({ id, today }) => window.cardFixture.plugin.setTaskDueDate(id, today), { id: ids.payment, today });
    assert.equal(await payment.locator('.wt-due-chip.is-today').textContent(), '今天截止');
    await page.evaluate(id => window.cardFixture.plugin.setTaskDueDate(id, '2020-01-01'), ids.payment);
    assert.match(await payment.locator('.wt-due-chip.is-overdue').textContent(), /已逾期/);
    await page.evaluate(id => window.cardFixture.plugin.finishTask(id), ids.payment);
    await page.getByRole('button', { name: '四象限', exact: true }).click();
    assert.equal(await payment.locator('.wt-due-chip.is-overdue, .wt-due-chip.is-today').count(), 0);
    assert.equal(await payment.locator('.wt-card-properties').textContent(), '产品研发重要已完成');
    await page.evaluate(id => window.cardFixture.plugin.setTaskDueDate(id, null), ids.dateOnly);
    assert.equal(await card(ids.dateOnly).locator('.wt-due-chip').count(), 0);
  });
  await page.reload();
  await page.waitForFunction(() => window.cardFixture);
  Object.assign(ids, await page.evaluate(() => window.cardFixture.ids));
  payment = card(ids.payment);
  await check('each active section has a dashed base-grid creation card', async () => {
    assert.equal(await page.locator('.wt-card-create').count(), 2);
    assert.equal(await page.locator('.wt-ended-section .wt-card-create').count(), 0);
    const tiles = await page.locator('.wt-card-create').evaluateAll(elements => elements.map(el => ({ h: el.getBoundingClientRect().height, border: getComputedStyle(el).borderStyle, tag: el.tagName })));
    assert.ok(tiles.every(t => t.h >= 100 && t.border === 'dashed' && t.tag === 'BUTTON'));
  });
  if (await page.locator('.wt-card-create').count()) {
    await check('group creation carries context, cancels without saving and restores keyboard focus', async () => {
      const tile = page.getByRole('button', { name: '在产品研发中新建任务', exact: true });
      await tile.focus(); await tile.press('Enter');
      assert.equal(await page.getByRole('combobox', { name: '任务分组' }).inputValue(), await page.evaluate(() => window.cardFixture.plugin.groups[0].id));
      assert.equal(await page.getByRole('combobox', { name: '任务象限', exact: true }).inputValue(), 'not_important_not_urgent');
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await settle();
      assert.equal(await tile.evaluate(el => el === document.activeElement), true);
      assert.equal(await page.evaluate(() => window.cardFixture.plugin.tasks.length), 4);
      await page.getByRole('button', { name: '在未分组中新建任务', exact: true }).click();
      assert.equal(await page.getByRole('combobox', { name: '任务分组' }).inputValue(), '');
      await page.getByRole('button', { name: '取消', exact: true }).click();
    });
    await check('all four quadrant creation cards preselect their quadrant and create in it', async () => {
      await page.getByRole('button', { name: '四象限', exact: true }).click();
      assert.equal(await page.locator('.wt-card-create').count(), 4);
      const areas = await page.locator('.wt-task-section').evaluateAll(els => els.map(el => el.dataset.area));
      for (const area of areas) {
        await page.locator(`[data-area="${area}"] .wt-card-create`).click();
        assert.equal(await page.getByRole('combobox', { name: '任务象限', exact: true }).inputValue(), area);
        await page.locator('.wt-modal-title').fill('象限入口 ' + area);
        await page.getByRole('button', { name: '创建任务', exact: true }).click();
        await page.locator('.wt-new-task-modal').waitFor({ state: 'detached' });
        assert.equal(await page.locator(`[data-area="${area}"] .wt-card-title`).getByText('象限入口 ' + area, { exact: true }).count(), 1);
      }
    });
    await check('group creation can override defaults and makes a search-hidden new task visible', async () => {
      await page.getByRole('button', { name: '分组', exact: true }).click();
      await page.getByRole('searchbox').fill('没有匹配的任务');
      await page.getByRole('button', { name: '在产品研发中新建任务', exact: true }).click();
      await page.locator('.wt-modal-title').fill('分组入口验证');
      await page.getByRole('combobox', { name: '任务分组' }).selectOption('');
      await page.getByRole('combobox', { name: '任务象限', exact: true }).selectOption('important_urgent');
      await page.getByRole('button', { name: '创建任务', exact: true }).click();
      await page.locator('.wt-new-task-modal').waitFor({ state: 'detached' });
      assert.equal(await page.getByRole('searchbox').inputValue(), '');
      assert.equal(await page.locator('[data-area="ungrouped"] .wt-card.is-expanded .wt-card-title').textContent(), '分组入口验证');
    });
  }
  await page.reload();
  await page.waitForFunction(() => window.cardFixture);
  Object.assign(ids, await page.evaluate(() => window.cardFixture.ids));
  payment = card(ids.payment);
  if (await page.locator('.wt-card-create').count()) {
    await check('dropping onto a creation card moves a task without creating one', async () => {
      const data = await page.evaluateHandle(id => { const data = new DataTransfer(); data.setData('text/plain', id); return data; }, ids.payment);
      await page.locator('[data-area="ungrouped"] .wt-card-create').dispatchEvent('drop', { dataTransfer: data });
      await page.waitForFunction(id => window.cardFixture.plugin.tasks.find(t => t.id === id).groupId === null, ids.payment);
      assert.equal(await page.locator('.wt-new-task-modal').count(), 0);
      assert.equal(await page.evaluate(() => window.cardFixture.plugin.tasks.length), 4);
      await data.dispose();
    });
    for (const mode of ['group', 'quadrant']) {
      await page.evaluate(mode => window.cardFixture.plugin.setViewMode(mode), mode);
      for (const theme of ['theme-light', 'theme-dark']) {
        await page.evaluate(theme => { document.body.className = theme; }, theme);
        if (mode === 'quadrant') await check(`${theme}: compact chrome and semantic text remain readable`, async () => {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await settle();
          const contrast = await page.locator('.wt-view-switch button, .wt-new-task-button, .wt-section-heading h3, .wt-progress-chip, .wt-due-chip').evaluateAll(els => {
            const context = document.createElement('canvas').getContext('2d');
            function rgba(color) {
              context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
              const data = [...context.getImageData(0, 0, 1, 1).data]; return [...data.slice(0,3).map(n => n / 255), data[3] / 255];
            }
            const blend = (fg, bg) => fg.slice(0,3).map((n,i) => n * fg[3] + bg[i] * (1-fg[3]));
            const luminance = c => c.map(n => n <= .04045 ? n/12.92 : ((n+.055)/1.055)**2.4).reduce((sum,n,i) => sum + n * [.2126,.7152,.0722][i], 0);
            return els.map(el => {
              const parents = []; for (let p=el;p;p=p.parentElement) parents.unshift(p);
              const bg = parents.reduce((c,p) => blend(rgba(getComputedStyle(p).backgroundColor), c), [1,1,1]);
              const fg = blend(rgba(getComputedStyle(el).color), bg);
              const a=luminance(fg), b=luminance(bg);
              return { text: el.textContent, ratio: (Math.max(a,b)+.05)/(Math.min(a,b)+.05) };
            });
          });
          assert.ok(contrast.every(item => item.ratio >= 4.5), JSON.stringify(contrast.filter(item => item.ratio < 4.5)));
        });
        for (const width of [1440, 760, 375]) {
          await check(`${mode} ${theme} ${width}px: creation tiles preserve the base grid`, async () => {
            await page.setViewportSize({ width, height: 1000 });
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await settle();
            const sizes = await page.locator('.wt-card-create').evaluateAll(els => els.map(el => {
              const r = el.getBoundingClientRect(), grid = el.parentElement.getBoundingClientRect();
              const other = el.parentElement.querySelector('.wt-card')?.getBoundingClientRect();
              return { h: r.height, w: r.width, sw: el.scrollWidth, sh: el.scrollHeight, top: r.top - grid.top - 9, right: r.right, gridRight: grid.right, other: other?.width };
            }));
            assert.ok(sizes.every(s => s.h >= 100 && s.sw <= s.w && s.sh <= s.h && s.right <= s.gridRight + 1));
            assert.ok(sizes.every(s => s.other === undefined || Math.abs(s.other - s.w) < .1));
            if (process.env.TRACELO_ARTIFACT_DIR && [1440, 375].includes(width)) await page.screenshot({ path: `${process.env.TRACELO_ARTIFACT_DIR}/create-${mode}-${theme}-${width}.png` });
          });
        }
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.waitForFunction(() => window.cardFixture);
  Object.assign(ids, await page.evaluate(() => window.cardFixture.ids));
  payment = card(ids.payment);
  await check('expanded notes controls and progress fit their natural height', async () => {
    const weekly = card(ids.dateOnly);
    await weekly.locator('.wt-card-open').click();
    await weekly.evaluate(el => { el.parentElement.style.gridTemplateColumns = 'repeat(2, 260px)'; });
    await settle();
    const metrics = await weekly.evaluate(el => {
      const body = el.querySelector('.wt-card-body');
      const latest = el.querySelector('.wt-card-latest');
      return { height: el.getBoundingClientRect().height, content: body.scrollHeight + 2, lines: latest.getBoundingClientRect().height / parseFloat(getComputedStyle(latest).lineHeight) };
    });
    assert.ok(metrics.lines >= 1.98, 'regression requires wrapped progress: ' + JSON.stringify(metrics));
    assert.ok(Math.abs(metrics.height - metrics.content) <= 1, JSON.stringify(metrics));
  });
  await page.reload();
  await page.waitForFunction(() => window.cardFixture);
  Object.assign(ids, await page.evaluate(() => window.cardFixture.ids));
  payment = card(ids.payment);
  await check('transfer entry shows import preview without writing and permits cancellation', async () => {
    await page.getByRole('button', { name: '导入与导出', exact: true }).click();
    await page.getByRole('button', { name: '导出全部数据', exact: true }).waitFor();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出全部数据', exact: true }).click();
    const download = await downloadEvent;
    assert.match(download.suggestedFilename(), /^Tracelo .*\.tracelo\.json$/);
    const bundle = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(bundle.tasks.length, 4);
    await page.locator('.wt-transfer-file').setInputFiles({ name: '备份.tracelo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
    await page.getByText('将新增 0 张卡片，跳过 4 张已有卡片。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.cardFixture.plugin.tasks.length), 4);
    assert.equal(await page.getByRole('button', { name: '导出全部数据', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: '确认导入', exact: true }).isEnabled(), true);
    if (process.env.TRACELO_ARTIFACT_DIR) await page.screenshot({ path: process.env.TRACELO_ARTIFACT_DIR + '/transfer-preview.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.body.classList.add('theme-dark'));
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const bounds = await page.locator('.wt-transfer-modal').boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'mobile transfer modal must fit the viewport');
    if (process.env.TRACELO_ARTIFACT_DIR) await page.screenshot({ path: process.env.TRACELO_ARTIFACT_DIR + '/transfer-mobile-dark.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => document.body.classList.remove('theme-dark'));
    await page.locator('.wt-transfer-file').setInputFiles({ name: '损坏.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
    await page.getByRole('alert').filter({ hasText: '无法读取导入包' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '确认导入', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await check('import preview and confirmation create a separate same-title task', async () => {
    const bundle = await page.evaluate(async () => {
      const bundle = await window.cardFixture.plugin.createExport();
      bundle.tasks = [bundle.tasks[0]]; bundle.tasks[0].id = 'import-ui-example';
      bundle.materials = []; return bundle;
    });
    await page.getByRole('button', { name: '导入与导出', exact: true }).click();
    await page.locator('.wt-transfer-file').setInputFiles({ name: '同名任务.tracelo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
    await page.getByText('将新增 1 张卡片，跳过 0 张已有卡片。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.cardFixture.plugin.tasks.length), 4);
    await page.getByRole('button', { name: '确认导入', exact: true }).click();
    await page.getByText('导入完成：新增 1 张卡片，跳过 0 张已有卡片。', { exact: true }).waitFor();
    const imported = await page.evaluate(() => window.cardFixture.plugin.tasks.find(t => t.id === 'import-ui-example'));
    assert.match(imported.archiveName, / 完成支付模块（2）$/);
    assert.equal(await page.evaluate(() => window.cardFixture.plugin.tasks.length), 5);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await check('export waits for an in-flight task creation', async () => {
    const result = await page.evaluate(async () => {
      const plugin = window.cardFixture.plugin;
      const write = plugin.app.vault.adapter.write.bind(plugin.app.vault.adapter);
      let release; let started;
      const entered = new Promise(resolve => { started = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      plugin.app.vault.adapter.write = async (path, source) => {
        if (source.includes('导出并发验证')) { started(); await gate; }
        return write(path, source);
      };
      const added = plugin.addTask({ title: '导出并发验证', groupId: null, groupName: '未分组', important: false, urgent: false, dueDate: null, todos: [], initialProgress: '' });
      await Promise.race([entered, added.then(() => { throw new Error('creation bypassed the expected write'); }), new Promise((_, reject) => setTimeout(() => reject(new Error('creation did not reach write gate')), 5000))]);
      const exported = plugin.createExport();
      release();
      const id = await added;
      const bundle = await exported;
      plugin.app.vault.adapter.write = write;
      return bundle.tasks.some(t => t.id === id);
    });
    assert.equal(result, true);
  });
  await check('directory migration rejects occupied and unsafe destinations without altering cards', async () => {
    const result = await page.evaluate(async () => {
      const { plugin, app } = window.cardFixture;
      await app.vault.adapter.mkdir('已有资料'); await app.vault.adapter.write('已有资料/保留.txt', 'keep');
      const failures = [];
      for (const path of ['已有资料', '../outside', '.obsidian/plugins', plugin.state.taskDirectory + '/子目录']) {
        try { await plugin.changeTaskDirectory(path); } catch { failures.push(path); }
      }
      return { failures: failures.length, directory: plugin.state.taskDirectory, content: await app.vault.adapter.read('已有资料/保留.txt') };
    });
    assert.deepEqual(result, { failures: 4, directory: '工作记录/任务', content: 'keep' });
  });
  await page.reload();
  await page.waitForFunction(() => window.cardFixture);
  Object.assign(ids, await page.evaluate(() => window.cardFixture.ids));
  payment = card(ids.payment);
  await check('card whitespace toggles expansion while preserving timeline selection', async () => {
    await payment.click({ position: { x: 5, y: 100 } });
    assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'true');
    await payment.click({ position: { x: 5, y: 100 } });
    assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'false');
    await page.getByRole('button', { name: '返回每日时间线', exact: true }).click();
    await payment.click({ position: { x: 5, y: 100 } });
    assert.equal(await page.getByRole('button', { name: '返回每日时间线', exact: true }).count(), 1);
    await payment.locator('.wt-card-open').click();
    assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'false');
  });
  await check('right click and overflow menu share folder actions without expanding', async () => {
    await payment.click({ button: 'right' });
    assert.equal(await page.getByRole('menuitem', { name: '创建文件夹', exact: true }).count(), 1);
    const rightItems = await page.getByRole('menuitem').allTextContents();
    await payment.locator('.wt-card-menu').click();
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), rightItems);
    assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'false');
    assert.equal(await payment.locator('.wt-card-folder').count(), 0);
  });
  await check('keyboard context menu is equivalent and keeps the card collapsed', async () => {
    await payment.locator('.wt-card-open').press('Shift+F10');
    assert.equal(await page.getByRole('menuitem', { name: '创建文件夹', exact: true }).count(), 1);
    assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'false');
  });
  if (await page.getByRole('menuitem', { name: '创建文件夹', exact: true }).count()) {
    await check('folder creation is lazy, opens the directory and preserves task history', async () => {
      const before = await page.evaluate(id => JSON.stringify(window.cardFixture.plugin.tasks.find(t => t.id === id).events), ids.payment);
      assert.equal(await page.evaluate(() => window.cardFixture.app.vault.adapter.exists('工作记录/材料')), false);
      await page.getByRole('menuitem', { name: '创建文件夹', exact: true }).click();
      await page.waitForFunction(() => window.cardFixture.app.openedFolders.length === 1);
      assert.equal(await payment.locator('.wt-card-folder').count(), 1);
      assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.evaluate(id => JSON.stringify(window.cardFixture.plugin.tasks.find(t => t.id === id).events), ids.payment), before);
      const path = await page.evaluate(() => window.cardFixture.app.openedFolders[0]);
      const name = await page.evaluate(id => window.cardFixture.plugin.tasks.find(t => t.id === id).archiveName, ids.payment);
      assert.match(name, /^\d{4}-\d{2}-\d{2} 完成支付模块$/);
      assert.equal(path, '/test-vault/工作记录/任务/' + name);
    });
    await check('folder shortcut reuses directory and never expands the card', async () => {
      await payment.locator('.wt-card-folder').click();
      await page.waitForFunction(() => window.cardFixture.app.openedFolders.length === 2);
      assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'false');
      await payment.click({ button: 'right' });
      assert.equal(await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).count(), 1);
    });
    await check('Windows folder access launches Explorer with the exact path as one argument', async () => {
      const result = await page.evaluate(async id => {
        const { plugin, app, platform } = window.cardFixture;
        const fullPath = app.vault.adapter.getFullPath;
        const before = app.openedFolders.length;
        platform.isWin = true;
        const path = "C:\\工作 资料\\O'Brien & 周报 (1)";
        app.vault.adapter.getFullPath = () => path;
        try { await plugin.accessTaskFolder(id); return { launch: app.folderLaunches.at(-1), before, after: app.openedFolders.length, path }; }
        finally { platform.isWin = false; app.vault.adapter.getFullPath = fullPath; }
      }, ids.payment);
      assert.ok(result.launch, 'Windows must use the Explorer launch path');
      assert.equal(result.launch.file, 'explorer.exe');
      assert.deepEqual(result.launch.args, [result.path]);
      assert.equal(result.launch.options.shell, false);
      assert.equal(result.launch.options.windowsHide, false);
      assert.equal(result.after, result.before);
    });
    await check('Windows launch failure leaves the folder intact and allows retry', async () => {
      const result = await page.evaluate(async id => {
        const { plugin, app, platform } = window.cardFixture;
        platform.isWin = true; app.openError = '启动资源管理器失败';
        let message;
        try {
          try { await plugin.accessTaskFolder(id); } catch (error) { message = error.message; }
          app.openError = ''; await plugin.accessTaskFolder(id);
          return { message, exists: plugin.hasTaskFolder(id), launches: app.folderLaunches.length };
        } finally { platform.isWin = false; app.openError = ''; }
      }, ids.payment);
      assert.match(result.message, /启动资源管理器失败/);
      assert.equal(result.exists, true);
      assert.equal(result.launches, 3);
    });
    await check('folder survives task rename and completion', async () => {
      await page.evaluate(async id => { const p = window.cardFixture.plugin; await p.renameTask(id, '支付模块改名'); await p.finishTask(id); }, ids.payment);
      await page.locator('.wt-ended-section > summary').click();
      assert.equal(await payment.locator('.wt-card-folder').count(), 1);
      await payment.locator('.wt-card-folder').click();
      const name = await page.evaluate(id => window.cardFixture.plugin.tasks.find(t => t.id === id).archiveName, ids.payment);
      assert.match(name, / 支付模块改名$/);
      assert.equal(await page.evaluate(() => window.cardFixture.app.openedFolders.at(-1)), '/test-vault/工作记录/任务/' + name);
    });
    await check('system open failure reports error without removing the folder', async () => {
      await page.evaluate(() => { window.cardFixture.app.openError = '无法启动文件管理器'; });
      await payment.locator('.wt-card-folder').click();
      await page.getByText(/无法启动文件管理器/).waitFor();
      assert.equal(await payment.locator('.wt-card-folder').count(), 1);
    });
    await check('creation failure can be retried without a false folder indicator', async () => {
      const result = await page.evaluate(async id => {
        const { plugin, app } = window.cardFixture;
        const original = app.vault.adapter.mkdir;
        app.openError = '';
        app.vault.adapter.mkdir = async () => { throw new Error('没有写入权限'); };
        let error;
        try { await plugin.accessTaskFolder(id, true); } catch (reason) { error = reason.message; }
        app.vault.adapter.mkdir = original;
        const absent = !plugin.hasTaskFolder(id);
        await Promise.all([plugin.accessTaskFolder(id, true), plugin.accessTaskFolder(id, true)]);
        return { error, absent, opened: app.openedFolders.filter(path => path.endsWith(plugin.tasks.find(t => t.id === id).archiveName)).length, ready: plugin.hasTaskFolder(id) };
      }, ids.plain);
      assert.deepEqual(result, { error: '没有写入权限', absent: true, opened: 1, ready: true });
    });
    await check('same-name file is never overwritten by folder creation', async () => {
      const result = await page.evaluate(async id => {
        const { plugin, app } = window.cardFixture;
        const path = '工作记录/任务/' + plugin.tasks.find(t => t.id === id).archiveName;
        await app.vault.adapter.write(path, 'existing content');
        let error;
        try { await plugin.accessTaskFolder(id, true); } catch (reason) { error = reason.message; }
        return { error, content: await app.vault.adapter.read(path), folder: plugin.hasTaskFolder(id) };
      }, ids.dateOnly);
      assert.equal(result.error, undefined);
      assert.equal(result.content, 'existing content');
      assert.equal(result.folder, true);
    });
    await check('missing directory is not silently recreated by open', async () => {
      const result = await page.evaluate(async id => {
        const { plugin, app } = window.cardFixture;
        await app.vault.adapter.rmdir('工作记录/任务/' + plugin.tasks.find(t => t.id === id).archiveName);
        try { await plugin.accessTaskFolder(id); } catch (reason) { return { error: reason.message, folder: plugin.hasTaskFolder(id) }; }
      }, ids.plain);
      assert.match(result.error, /移动或删除/);
      assert.equal(result.folder, false);
      assert.equal(await card(ids.plain).locator('.wt-card-folder').count(), 0);
    });
  }
  // Restore the isolated vault before running the existing card regression suite.
  await page.reload();
  await page.waitForFunction(() => window.cardFixture);
  Object.assign(ids, await page.evaluate(() => window.cardFixture.ids));
  payment = card(ids.payment);
  await check('selection and dragging do not expand cards', async () => {
    await payment.locator('.wt-card-latest').evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    await payment.locator('.wt-card-latest').dispatchEvent('click');
    assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'false');
    await page.evaluate(() => document.getSelection().removeAllRanges());
    await payment.dispatchEvent('dragstart');
    await payment.dispatchEvent('dragend');
    await payment.dispatchEvent('click');
    assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'false');
  });
  await check('body text expands but editor clicks and context menu keep editing intact', async () => {
    await payment.locator('.wt-card-latest').click();
    assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'true');
    const input = payment.locator('.wt-card-composer textarea');
    await input.fill('正文点击后的草稿');
    await input.dispatchEvent('contextmenu');
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(await input.inputValue(), '正文点击后的草稿');
    assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'true');
    await input.fill('');
    await payment.locator('.wt-card-open').click();
    await page.getByRole('button', { name: '返回每日时间线', exact: true }).click();
  });
  await check("timeline links resist host button backgrounds", async () => {
    const backgrounds = await page.locator(".wt-event-task, .wt-due-row").evaluateAll(elements => elements.map(el => getComputedStyle(el).backgroundColor));
    assert.ok(backgrounds.length > 0);
    assert.ok(backgrounds.every(bg => bg === "rgba(0, 0, 0, 0)"));
  });
  await check("deadline section stays above the scrolling history", async () => {
    await page.locator('.wt-date-controls input').fill('2026-09-26');
    await page.locator('.wt-date-controls input').dispatchEvent('change');
    await page.setViewportSize({ width: 1440, height: 500 });
    await settle();
    const bounds = await page.locator('.wt-timeline-due').evaluate(el => ({
      section: el.getBoundingClientRect().bottom,
      row: el.querySelector('.wt-due-row').getBoundingClientRect().bottom,
      history: el.nextElementSibling.getBoundingClientRect().top,
    }));
    assert.ok(bounds.row <= bounds.section, 'deadline row clipped by history');
    assert.ok(bounds.section <= bounds.history + 1);
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check("title stays transparent and left aligned under host CSS", async () => {
    const s = await payment.locator(".wt-card-open").evaluate((el) => {
      const c = getComputedStyle(el);
      return { bg: c.backgroundColor, wrap: c.whiteSpace, height: c.height, text: el.textContent };
    });
    assert.equal(s.bg, "rgba(0, 0, 0, 0)");
    assert.notEqual(s.wrap, "nowrap");
    assert.equal(s.text, "完成支付模块");
  });
  await check("collapsed long progress is clamped without overlapping metadata", async () => {
    const m = await card(ids.long).evaluate((el) => {
      const latest = el.querySelector(".wt-card-latest");
      const footer = el.querySelector(".wt-card-meta");
      return { insideButton: Boolean(latest.closest("button")), bottom: latest.getBoundingClientRect().bottom, footer: footer.getBoundingClientRect().top, scroll: latest.scrollHeight, height: latest.clientHeight };
    });
    assert.equal(m.insideButton, false);
    assert.ok(m.bottom <= m.footer);
    assert.ok(m.height < m.scroll);
  });
  await payment.locator(".wt-card-open").click();
  await check("expansion preserves title focus instead of jumping to composer", async () => {
    await settle();
    assert.equal(await payment.locator("textarea").evaluate((el) => el === document.activeElement), false);
  });
  await check("expanded checklist exposes count and persistent add field", async () => {
    assert.equal(await payment.locator('.wt-progress-chip').textContent(), '2/4');
    assert.equal(await payment.getByRole("textbox", { name: "新增待办" }).count(), 1);
    assert.equal(await payment.getByRole("button", { name: "添加待办", exact: true }).count(), 1);
  });
  await check("expanded card uses a quiet blue border and neutral surface", async () => {
    const style = await payment.evaluate(el => ({ border: getComputedStyle(el).borderColor, bg: getComputedStyle(el).backgroundColor, peer: getComputedStyle(document.querySelector('.wt-card:not(.is-expanded)')).backgroundColor }));
    assert.equal(style.border, 'rgb(36, 91, 231)');
    assert.ok(style.bg);
  });
  await payment.locator(".wt-card-open").click();
  await check("collapse removes expanded accent and tinted background", async () => {
    const c = await payment.evaluate((el) => ({ before: getComputedStyle(el, "::before").content, bg: getComputedStyle(el).backgroundImage }));
    assert.ok(c.before === "none" || c.before === "normal");
    assert.equal(c.bg, "none");
  });
  await card(ids.plain).locator(".wt-card-open").click();
  await check("optional controls retain their visible and accessible names", async () => {
    for (const name of ["添加待办", "设置截止日期"]) {
      const button = card(ids.plain).getByRole("button", { name, exact: true });
      assert.equal(await button.count(), 1);
      assert.ok((await button.textContent()).includes(name));
    }
  });
  await check("all four optional combinations omit empty placeholders", async () => {
    assert.equal(await card(ids.plain).locator(".wt-card-summary").count(), 0);
    assert.equal(await card(ids.dateOnly).locator(".wt-summary-chip").count(), 1);
    assert.equal(await card(ids.long).locator(".wt-summary-chip").count(), 1);
    assert.equal(await payment.locator(".wt-summary-chip").count(), 2);
  });
  // Only continue interaction scenarios once the required controls are present.
  if (await card(ids.plain).getByRole("button", { name: "添加待办", exact: true }).count()) {
    await card(ids.plain).getByRole("button", { name: "添加待办", exact: true }).click();
    await card(ids.plain).getByRole("textbox", { name: "新增待办" }).fill("核对真实新增流程");
    await card(ids.plain).getByRole("textbox", { name: "新增待办" }).press("Enter");
    await page.waitForFunction((id) => window.cardFixture.plugin.tasks.find(t => t.id === id).todos?.length === 1, ids.plain);
    await check("adding a todo persists and keeps the next input available", async () => {
      assert.equal(await card(ids.plain).getByRole("checkbox", { name: "核对真实新增流程" }).count(), 1);
      assert.equal(await card(ids.plain).getByRole("textbox", { name: "新增待办" }).inputValue(), "");
    });
    await card(ids.plain).locator(".wt-card-composer textarea").fill("未提交草稿");
    await card(ids.plain).getByRole("checkbox", { name: "核对真实新增流程" }).check();
    await page.waitForFunction((id) => window.cardFixture.plugin.tasks.find(t => t.id === id).todos[0].done, ids.plain);
    await check("checking a todo preserves progress draft and latest progress", async () => {
      assert.equal(await card(ids.plain).locator(".wt-card-composer textarea").inputValue(), "未提交草稿");
      assert.equal(await card(ids.plain).locator('.wt-progress-chip').textContent(), '1/1');
      assert.ok((await card(ids.plain).locator(".wt-card-latest").textContent()).includes("五条高频问题"));
    });
    await card(ids.plain).getByRole("button", { name: "编辑待办：核对真实新增流程", exact: true }).click();
    await page.locator(".wt-prompt-modal input").fill("核对编辑后的清单");
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await page.waitForFunction((id) => window.cardFixture.plugin.tasks.find(t => t.id === id).todos[0].text === "核对编辑后的清单", ids.plain);
    await card(ids.plain).getByRole("button", { name: "删除待办：核对编辑后的清单", exact: true }).click();
    await page.waitForFunction((id) => !window.cardFixture.plugin.tasks.find(t => t.id === id).todos, ids.plain);
    await check("removing the final item restores the optional entry", async () => {
      assert.equal(await card(ids.plain).getByRole("button", { name: "添加待办", exact: true }).count(), 1);
      assert.equal(await card(ids.plain).locator(".wt-card-todos").count(), 0);
    });
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.waitForFunction((id) => window.cardFixture.plugin.tasks.find(t => t.id === id).todos?.length === 1, ids.plain);
    await check("undo restores the original completion state", async () => {
      assert.equal(await card(ids.plain).getByRole("checkbox", { name: "核对编辑后的清单" }).isChecked(), true);
    });
    await card(ids.plain).getByRole("button", { name: "设置截止日期", exact: true }).click();
    await page.locator(".wt-modal input[type=date]").fill("2026-10-01");
    await page.getByRole("button", { name: "保存日期", exact: true }).click();
    await page.waitForFunction((id) => window.cardFixture.plugin.tasks.find(t => t.id === id).dueDate === "2026-10-01", ids.plain);
    await check("deadline changes persist without losing the composer draft", async () => {
      assert.equal(await card(ids.plain).locator(".wt-due-chip").count(), 1);
      assert.equal(await card(ids.plain).locator(".wt-card-composer textarea").inputValue(), "未提交草稿");
    });
  }
  for (const id of [ids.dateOnly, ids.plain, ids.payment, ids.long]) {
    await check('expansion and collapse fit card content: ' + id, async () => {
      const open = card(id).locator('.wt-card-open');
      if (await open.getAttribute('aria-expanded') !== 'true') await open.click();
      await settle();
      const measured = await card(id).evaluate(el => ({ height: el.getBoundingClientRect().height, content: el.querySelector('.wt-card-body').scrollHeight + 2 }));
      assert.ok(measured.height + 1 >= measured.content, 'expanded content clipped');
      assert.ok(Math.abs(measured.height - measured.content) <= 1, `excess blank space: card ${measured.height}px, content ${measured.content}px`);
      await open.click();
      await settle();
      const collapsed = await card(id).evaluate(el => ({ height: el.getBoundingClientRect().height, content: el.querySelector('.wt-card-body').scrollHeight + 2 }));
      assert.ok(Math.abs(collapsed.height - collapsed.content) <= 1, 'collapsed card retains expanded whitespace');
    });
  }
  await page.evaluate(id => window.cardFixture.plugin.accessTaskFolder(id, true), ids.long);
  await card(ids.long).locator(".wt-card-open").click();
  for (const theme of ["theme-light", "theme-dark"]) {
    await page.evaluate((name) => { document.body.className = name; }, theme);
    for (const width of [1440, 1000, 760, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await settle();
      await check(theme + " at " + width + "px: contents fit natural card heights", async () => {
        const result = await page.locator(".wt-card").evaluateAll((cards) => cards.map((el) => {
          const r = el.getBoundingClientRect();
          const body = el.querySelector(".wt-card-body");
          const latest = el.querySelector(".wt-card-latest").getBoundingClientRect();
          const meta = el.querySelector(".wt-card-meta").getBoundingClientRect();
          return { height: r.height, content: body.scrollHeight + 2, width: r.width, scrollWidth: el.scrollWidth, latestBottom: latest.bottom, metaTop: meta.top };
        }));
        for (const r of result) {
          assert.ok(r.height + 1 >= r.content, "clipped card");
          assert.ok(r.scrollWidth <= r.width, "horizontal overflow");
          assert.ok(r.latestBottom <= r.metaTop, "progress overlaps metadata");
          assert.ok(Math.abs(r.height - r.content) <= 1, "empty space below card content");
        }
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.body.className = "theme-light"; });
  await payment.locator(".wt-card-open").click();
  await settle();
  await check("every visible card button has an accessible name", async () => {
    const unnamed = await page.locator(".wt-card button").evaluateAll((buttons) => buttons.filter(el => !el.getAttribute("aria-label") && !el.textContent.trim()).length);
    assert.equal(unnamed, 0);
  });
  if (process.env.TRACE_SCREENSHOTS) {
    await page.evaluate(async id => {
      const plugin = window.cardFixture.plugin;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#dbeafe"/><text x="32" y="65" font-size="28" fill="#183153">Payment API / Reference</text><path d="M32 100H608M32 180H430M32 260H550" stroke="#5a82b7" stroke-width="18"/></svg>';
      await plugin.saveTaskNotes(id, '项目背景：支付流程与退款路径联调。\n参考截图：\n![参考图片](<data:image/svg+xml;base64,' + btoa(svg) + '>)\n截图后说明：检查异常处理与回归记录。');
      const groupId = plugin.tasks.find(task => task.id === id).groupId;
      plugin.state.orders.group[groupId] = [id, ...(plugin.state.orders.group[groupId] ?? []).filter(taskId => taskId !== id)];
      await plugin.setBoardZoom(100);
      await plugin.setPresentationMode(true);
    }, ids.payment);
    for (const theme of ['theme-light', 'theme-dark']) {
      await page.evaluate(theme => { document.body.className = theme; }, theme);
      await settle();
      await page.screenshot({ path: `/tmp/tracelo-${theme}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 375, height: 1000 });
    await page.evaluate(() => window.cardFixture.plugin.setBoardZoom(60));
    if (await payment.locator('.wt-card-composer').count()) await payment.getByRole('button', { name: '关闭进展输入', exact: true }).click();
    await payment.locator('.wt-card-open').click();
    await settle();
    await page.screenshot({ path: '/tmp/tracelo-narrow.png', fullPage: true });
  }
  assert.deepEqual(failures, []);
  assert.deepEqual(pageErrors, []);
  console.log(checks + " real-render card checks passed with Obsidian host CSS.");
} finally { await browser.close(); }
