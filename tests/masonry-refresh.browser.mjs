import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['src/card-layout.ts'], bundle: true, write: false, format: 'iife', globalName: 'cardLayout' });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent('<style>*{box-sizing:border-box}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));width:960px;gap:12px}.wt-masonry-column{display:flex;flex-direction:column;gap:12px}.wt-card{border:1px solid;padding:12px}</style><div class="grid"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const grid = document.querySelector('.grid');
    for (let index = 0; index < 8; index++) {
      const card = document.createElement('article');
      card.className = 'wt-card'; card.dataset.taskId = `task-${index}`;
      card.textContent = `摘要 ${index}`;
      if (index === 1) {
        card.classList.add('is-editing');
        const input = document.createElement('textarea'); input.value = '正在编辑的草稿'; card.append(input);
      }
      grid.append(card);
    }
    window.editor = grid.querySelector('textarea');
    window.stopLayout = cardLayout.mountMasonryColumns(grid);
    // Presentation refresh replaces reading cards while retaining the current editor.
    for (const old of grid.querySelectorAll('.wt-card:not(.is-editing)')) {
      const updated = old.cloneNode(true); updated.classList.add('is-expanded'); updated.textContent = '完整展示内容 '.repeat(30);
      old.replaceWith(updated);
    }
    window.currentCards = [...grid.querySelectorAll('.wt-card')];
    window.editor.focus(); window.editor.setSelectionRange(2, 4);
  });
  for (const width of [300, 960, 550, 300, 960]) {
    await page.locator('.grid').evaluate((el, width) => { el.style.width = `${width}px`; }, width);
    const expectedCount = width === 960 ? 3 : width === 550 ? 2 : 1;
    await page.waitForFunction(count => document.querySelectorAll('.wt-masonry-column').length === count, expectedCount);
    const result = await page.evaluate(() => {
      const grid = document.querySelector('.grid');
      const cards = [...grid.querySelectorAll('.wt-card')];
      return {
        retained: window.currentCards.every(card => card.isConnected && grid.contains(card)),
        expanded: cards.filter(card => card.classList.contains('is-expanded')).length,
        columns: [...grid.children].map(column => [...column.children].map(card => card.dataset.taskId)),
        editor: window.editor === grid.querySelector('textarea'), draft: grid.querySelector('textarea').value,
        selection: [window.editor.selectionStart, window.editor.selectionEnd], focus: document.activeElement === window.editor,
      };
    });
    assert.equal(result.retained, true, `resize to ${width}px must not resurrect replaced cards`);
    assert.equal(result.expanded, 7);
    assert.equal(result.editor, true); assert.equal(result.focus, true);
    assert.equal(result.draft, '正在编辑的草稿'); assert.deepEqual(result.selection, [2, 4]);
    assert.deepEqual(result.columns, Array.from({ length: expectedCount }, (_, column) => Array.from({ length: 8 }, (_, index) => `task-${index}`).filter((_, index) => index % expectedCount === column)));
  }
  const fixture = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + fixture.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  const editingId = await page.evaluate(async () => {
    const { plugin, ids } = window.cardFixture;
    for (let index = 0; index < 5; index++) await plugin.addTask({ title: `模式缩放任务 ${index}`, groupId: plugin.groups[0].id, groupName: plugin.groups[0].name, important: true, urgent: false, dueDate: null, todos: [], initialProgress: '缩放后保持完整阅读内容。'.repeat(20) });
    await plugin.setViewMode('group');
    window.originalTaskOrder = [...document.querySelector('.wt-card-grid').querySelectorAll('.wt-card')].map(card => card.dataset.taskId);
    await plugin.setCardLayout('masonry');
    return ids.payment;
  });
  const editorCard = page.locator(`.wt-card[data-task-id="${editingId}"]`);
  await editorCard.locator('.wt-card-open').click();
  await editorCard.locator('.wt-card-composer textarea').fill('模式切换与缩放之间保留的草稿');
  await editorCard.locator('.wt-card-composer textarea').evaluate(input => { window.liveEditor = input; input.setSelectionRange(3, 6); });
  for (const presentation of [true, false, true]) {
    await page.evaluate(value => window.cardFixture.plugin.setPresentationMode(value), presentation);
    assert.equal(await page.evaluate(() => window.liveEditor.isConnected), true, 'mode changes retain the editor DOM');
    await page.evaluate(() => {
      window.readingCards = [...document.querySelector('.wt-card-grid').querySelectorAll('.wt-card')];
      window.liveEditor.focus();
    });
    for (const width of [375, 1680, 900]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const state = await page.evaluate(() => {
        const grid = document.querySelector('.wt-card-grid');
        const columns = [...grid.querySelectorAll('.wt-masonry-column')];
        return {
          sameCards: window.readingCards.every(card => card.isConnected && grid.contains(card)),
          expanded: [...grid.querySelectorAll('.wt-card')].map(card => card.classList.contains('is-expanded')),
          columns: columns.map(column => [...column.children].map(card => card.dataset.taskId)),
          expected: columns.map((_, column) => window.originalTaskOrder.filter((_, index) => index % columns.length === column)),
          editor: window.liveEditor === grid.querySelector('textarea'), draft: window.liveEditor.value,
          selection: [window.liveEditor.selectionStart, window.liveEditor.selectionEnd],
        };
      });
      assert.equal(state.sameCards, true, `mode=${presentation}, width=${width}: current cards must survive reflow`);
      assert.equal(state.expanded.filter(Boolean).length, presentation ? state.expanded.length : 1);
      assert.deepEqual(state.columns, state.expected);
      assert.equal(state.editor, true); assert.equal(state.draft, '模式切换与缩放之间保留的草稿');
      assert.deepEqual(state.selection, [3, 6]);
      assert.equal(await page.locator('.wt-card-composer').count(), 1);
    }
  }
  console.log('14 stable masonry refresh checks passed (mode, replacement nodes, order, draft, focus and selection).');
} finally { await browser.close(); }
