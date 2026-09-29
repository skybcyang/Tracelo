import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
const failures = [];
let checks = 0;
const output = resolve('test-results/readability');
mkdirSync(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' });
  page.setDefaultTimeout(2500);
  page.on('pageerror', error => failures.push(error.message));
  await page.clock.install({ time: new Date('2026-09-28T02:00:00Z') });
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  await page.clock.setSystemTime(new Date('2026-09-29T02:00:00Z'));
  const ids = await page.evaluate(async () => {
    const { plugin, ids } = window.cardFixture;
    const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="500"><rect width="480" height="500" fill="#e5ebf5"/><text x="30" y="60" fill="#172033" font-size="24">Payment flow reference</text><rect x="30" y="100" width="420" height="130" rx="10" fill="#b7c8e6"/><rect x="30" y="270" width="420" height="130" rx="10" fill="#c6d6ed"/></svg>');
    await plugin.saveTaskNotes(ids.payment, '支付流程参考图，保留完整内容。\n\n![流程参考](<' + image + '>)');
    await plugin.recordProgress(ids.payment, '退款联调已通过，下一步验证弱网下的重复回调。');
    const bare = await plugin.addTask({ title: '准备下轮需求讨论', groupId: plugin.groups[0].id, groupName: plugin.groups[0].name, important: false, urgent: false, dueDate: '2026-09-29', todos: [], initialProgress: '' });
    await plugin.setViewMode('group');
    return { ...ids, bare };
  });
  const card = id => page.locator(`.wt-card[data-task-id="${id}"]`);
  const settle = () => page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  async function check(name, fn) { try { await fn(); checks++; } catch (error) { failures.push(name + ': ' + error.message); } }

  await check('latest progress and deadline precede a full-height reference image', async () => {
    await card(ids.payment).locator('.wt-card-open').click();
    const positions = await card(ids.payment).evaluate(el => {
      const box = selector => el.querySelector(selector).getBoundingClientRect();
      const progress = box('.wt-card-latest'), notes = box('.wt-task-notes'), due = box('.wt-due-chip');
      const image = el.querySelector('.wt-notes-preview img');
      return { progressBottom: progress.bottom, notesTop: notes.top, dueBottom: due.bottom, progressTop: progress.top, imageHeight: image.getBoundingClientRect().height, naturalRatio: image.naturalHeight / image.naturalWidth, imageWidth: image.getBoundingClientRect().width };
    });
    assert.ok(positions.notesTop <= positions.progressTop, 'details excerpt precedes latest progress, as in the collection mockup');
    assert.ok(positions.dueBottom <= positions.progressTop, 'deadline is buried below the image');
    assert.ok(Math.abs(positions.imageHeight / positions.imageWidth - positions.naturalRatio) < .01, 'reference image must remain uncropped');
    assert.match(await card(ids.payment).locator('.wt-due-chip').innerText(), /9月30日截止/);
  });
  await check('dates identify progress versus creation, and today is explicit', async () => {
    assert.match(await card(ids.payment).locator('.wt-card-time').innerText(), /进展.*今天/);
    assert.match(await card(ids.bare).locator('.wt-card-time').innerText(), /创建.*今天/);
    assert.match(await card(ids.payment).locator('.wt-latest-label').innerText(), /今天/);
    assert.equal(await card(ids.bare).locator('.wt-latest-label:visible').count(), 0);
    assert.equal(await card(ids.bare).locator('.wt-latest-label.is-placeholder[aria-hidden=true]').count(), 1);
    assert.equal(await card(ids.bare).locator('.wt-due-chip').innerText(), '今天截止');
    assert.match(await card(ids.dateOnly).locator('.wt-due-chip').innerText(), /已逾期/);
  });
  await check('editing details today does not make older progress look new', async () => {
    const before = await card(ids.plain).locator('.wt-card-time').getAttribute('datetime');
    await page.evaluate(async id => {
      await window.cardFixture.plugin.saveTaskNotes(id, '今天补充的背景资料');
      await window.cardFixture.plugin.setViewMode('group');
    }, ids.plain);
    assert.equal(await card(ids.plain).locator('.wt-card-time').getAttribute('datetime'), before);
    assert.match(await card(ids.plain).locator('.wt-card-time').innerText(), /进展.*9\/28/);
    assert.match(await card(ids.plain).locator('.wt-latest-label').innerText(), /^最新进展/);
    assert.doesNotMatch(await card(ids.plain).locator('.wt-latest-label').innerText(), /今天/);
  });
  await check('history opens separately and closing retains the expanded task', async () => {
    // Selection already shows task history in the permanent column.
    assert.equal(await page.locator('.wt-timeline-column').isVisible(), true);
    assert.equal(await page.locator('.wt-timeline-header h2').innerText(), '完成支付模块');
    assert.equal(await page.locator('.wt-card-selection').count(), 0);
    await page.locator('.wt-task-column').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: resolve(output, '5-selected-history.png') });
    await page.getByRole('button', { name: '返回每日时间线', exact: true }).click();
    await card(ids.plain).locator('.wt-card-open').click();
    assert.equal(await card(ids.payment).locator('.wt-card-selection').count(), 0);
    assert.equal(await page.locator('.wt-timeline-header h2').innerText(), '整理客户反馈');
    await card(ids.plain).getByRole('button', { name: '收起', exact: true }).click();
    assert.equal(await page.locator('.wt-card-selection').count(), 0);
    assert.equal(await page.locator('.wt-timeline-header .wt-eyebrow').innerText(), '每日时间线');
  });
  for (const count of [5, 20, 50]) {
    await page.evaluate(async count => {
      const { plugin } = window.cardFixture;
      for (let i = plugin.tasks.length; i < count; i++) {
        await plugin.addTask({ title: ['验证退款异常流程', '整理客户反馈', '补充验收记录', '确认上线计划'][i % 4] + ` · ${i + 1}`, groupId: plugin.groups[0].id, groupName: plugin.groups[0].name, important: i % 2 === 0, urgent: i % 3 === 0, dueDate: i % 4 === 0 ? '2026-09-28' : i % 4 === 1 ? '2026-09-29' : null, initialProgress: '已完成接口核对，下一步验证异常情况。'.repeat(i % 5 === 0 ? 8 : 1), todos: i % 3 === 0 ? ['核对响应结果', '补充异常验证'] : [] });
      }
    }, count);
    for (const mode of ['group', 'quadrant']) for (const dark of [false, true]) for (const width of [375, 900, 1920]) {
      await check(`${count} tasks ${mode} ${dark ? 'dark' : 'light'} ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(async ({ mode, dark }) => {
          document.body.classList.toggle('theme-dark', dark);
          await window.cardFixture.plugin.setViewMode(mode);
        }, { mode, dark });
        await settle();
        const bounds = await page.locator('.wt-board .wt-card').evaluateAll(cards => cards.map(el => {
          const r = el.getBoundingClientRect();
          return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, overflow:el.scrollWidth > el.clientWidth + 1 };
        }));
        assert.equal(bounds.length, count);
        assert.ok(bounds.every(r => !r.overflow && r.x >= 0 && r.right <= width + 1), 'card overflow');
        for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
          const a = bounds[i], b = bounds[j];
          assert.ok(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1, 'overlapping cards');
        }
        if ((count === 5 && mode === 'group' && !dark && width === 1920) || (count === 20 && mode === 'group' && dark && width === 375) || (count === 50 && mode === 'quadrant' && !dark && width === 1920)) {
          await page.screenshot({ path: resolve(output, `${count}-${mode}-${dark ? 'dark' : 'light'}-${width}.png`) });
        }
      });
    }
  }
  await check('ending an overdue task removes deadline urgency without losing its date', async () => {
    await page.evaluate(async id => window.cardFixture.plugin.finishTask(id), ids.dateOnly);
    await page.locator('.wt-ended-section > summary').evaluate(el => { el.parentElement.open = true; });
    assert.equal(await card(ids.dateOnly).locator('.wt-due-chip.is-overdue').count(), 0);
    assert.equal(await card(ids.dateOnly).locator('.wt-due-chip').innerText(), '9月26日截止');
  });
} finally { await browser.close(); }
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Card readability checks passed (${checks} checks).`);
