import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
let checks = 0;
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(2500);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  const ids = await page.evaluate(() => window.cardFixture.ids);
  const payment = page.locator(`[data-task-id="${ids.payment}"]`);
  const long = page.locator(`[data-task-id="${ids.long}"]`);
  async function check(name, run) { try { await run(); checks++; } catch (error) { failures.push(name + ': ' + error.message); } finally { await page.locator('.modal-container').evaluateAll(els => els.forEach(el => el.remove())); } }
  await page.evaluate(id => window.cardFixture.plugin.accessTaskFolder(id, true), ids.payment);
  await check('time stays at the footer right edge with optional fields and folder actions', async () => {
    for (const width of [260, 340, 480]) {
      for (const viewMode of ['group', 'quadrant']) {
        await page.evaluate(({ width, viewMode }) => {
          const { plugin, app } = window.cardFixture;
          plugin.state.viewMode = viewMode;
          app.workspace.getLeavesOfType('work-timeline-view')[0].view.render();
          document.querySelectorAll('.wt-card-grid').forEach(el => el.style.gridTemplateColumns = `${width}px`);
        }, { width, viewMode });
        const positions = await page.locator('.wt-card').evaluateAll(cards => cards.map(card => {
          const meta = card.querySelector('.wt-card-meta').getBoundingClientRect();
          const time = card.querySelector('.wt-card-time').getBoundingClientRect();
          const tools = card.querySelector('.wt-card-tools')?.getBoundingClientRect();
          return { title: card.querySelector('.wt-card-title').textContent, rightGap: meta.right - time.right,
            toolsBeforeTime: !tools || tools.right <= time.left - 4,
            overflow: card.scrollWidth > card.clientWidth + 1 };
        }));
        assert.ok(positions.every(p => Math.abs(p.rightGap) < 1 && p.toolsBeforeTime && !p.overflow), JSON.stringify({ width, viewMode, positions }));
      }
    }
    await page.evaluate(() => {
      window.cardFixture.plugin.state.viewMode = 'group';
      window.cardFixture.app.workspace.getLeavesOfType('work-timeline-view')[0].view.render();
    });
  });
  await check('narrow card keeps a readable title with consistent header controls', async () => {
    await payment.evaluate(el => { el.parentElement.style.gridTemplateColumns = '260px'; });
    const widths = await payment.evaluate(el => ({ title: el.querySelector('.wt-card-open').getBoundingClientRect().width, toolsInTitle: el.querySelector('.wt-card-heading').querySelectorAll('.wt-card-folder, .wt-notes-entry').length, tools: [...el.querySelectorAll('.wt-card-heading button:not(.wt-card-open)')].map(b => { const r=b.getBoundingClientRect(); return [r.width,r.height]; }) }));
    assert.ok(widths.title >= 120, JSON.stringify(widths));
    assert.equal(widths.toolsInTitle, 0);
    assert.ok(widths.tools.every(([w,h]) => w === 24 && h === 24), JSON.stringify(widths));
  });
  await check('a card without optional fields keeps metadata free of duplicate actions', async () => {
    const plain = page.locator(`[data-task-id="${ids.plain}"]`);
    const notes = plain.getByRole('button', { name: '添加详情', exact: true });
    assert.equal(await notes.count(), 0);
    assert.equal(await plain.locator('.wt-card-tools, .wt-card-folder').count(), 0);
    assert.equal(await plain.locator('.wt-card-status-row').count(), 1);
  });
  await check('multiline todo checkbox aligns with the first line', async () => {
    await long.locator('.wt-card-open').click();
    const offsets = await long.locator('.wt-todo-label').first().evaluate(el => {
      const text=el.querySelector('span').getBoundingClientRect(), box=el.querySelector('input').getBoundingClientRect();
      return { difference:box.y-text.y, lines:text.height/parseFloat(getComputedStyle(el).lineHeight) };
    });
    assert.ok(offsets.lines > 2 && offsets.difference >= 0 && offsets.difference <= 3, JSON.stringify(offsets));
  });
  for (const dark of [false,true]) for (const width of [390,900,1440]) {
    await check(`consistent editor controls and no overflow: dark=${dark} width=${width}`, async () => {
      await page.setViewportSize({ width, height:1000 });
      await page.evaluate(dark => { document.body.classList.toggle('theme-dark',dark); document.querySelectorAll('.wt-card-grid').forEach(el=>el.style.removeProperty('grid-template-columns')); }, dark);
      if (await payment.locator('.wt-card-open').getAttribute('aria-expanded') !== 'true') await payment.locator('.wt-card-open').click();
      const sizes = await payment.evaluate(el => {
        const buttons=[...el.querySelector('.wt-composer-footer').querySelectorAll('button')].filter(b=>b.getBoundingClientRect().height>0).map(b=>b.getBoundingClientRect().height);
        return { buttons, width:el.clientWidth, scroll:el.scrollWidth, title:el.querySelector('.wt-card-open').getBoundingClientRect().width };
      });
      assert.deepEqual(sizes.buttons, [30], 'one compact save button; collapse lives in the card footer');
      assert.ok(sizes.scroll <= sizes.width + 1 && sizes.title >= 90, JSON.stringify(sizes));
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(`${checks} card hierarchy checks passed.`);
} finally { await browser.close(); }
