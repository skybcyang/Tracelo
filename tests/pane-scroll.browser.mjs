import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce" });
try {
  await page.setContent(`<style>
    * { box-sizing: border-box } body { margin: 0; font: 14px Arial }
    #host { height: 640px; margin-top: 80px; }
    ${readFileSync("styles.css", "utf8")}
  </style><div id="host"><div class="work-timeline-view"><div class="wt-shell">
    <header class="wt-header"><div>Tracelo</div><div class="wt-view-switch">分组 / 四象限</div><button>新建任务</button></header>
    <div class="wt-layout"><main class="wt-task-column"><div class="wt-card-grid">
      ${Array.from({ length: 100 }, (_, i) => `<article class="wt-card">任务 ${i}</article>`).join("")}
    </div></main><aside class="wt-timeline-column"><header class="wt-timeline-header">每日时间线</header>
      <div class="wt-timeline-scroll"><ul class="wt-event-list">
        ${Array.from({ length: 100 }, (_, i) => `<li>记录 ${i}</li>`).join("")}
      </ul></div></aside></div></div></div></div>`);
  const positions = () => page.evaluate(() => {
    const get = s => document.querySelector(s);
    return {
      left: get('.wt-task-column').scrollTop, right: get('.wt-timeline-scroll').scrollTop,
      root: get('.work-timeline-view').scrollTop, outer: window.scrollY,
      header: get('.wt-header').getBoundingClientRect().top,
      timelineHeader: get('.wt-timeline-header').getBoundingClientRect().top,
      leftBottom: get('.wt-task-column').getBoundingClientRect().bottom,
      rightBottom: get('.wt-timeline-column').getBoundingClientRect().bottom,
      hostBottom: get('#host').getBoundingClientRect().bottom,
    };
  });
  const before = await positions();
  assert.ok(before.leftBottom <= before.hostBottom + 1, 'task pane exceeds plugin height');
  assert.ok(before.rightBottom <= before.hostBottom + 1, 'timeline exceeds plugin height');
  await page.locator('.wt-task-column').hover();
  await page.mouse.wheel(0, 420);
  await page.waitForFunction(() => document.querySelector('.wt-task-column').scrollTop > 0);
  const leftScrolled = await positions();
  assert.equal(leftScrolled.right, 0, 'left wheel moved timeline');
  assert.equal(leftScrolled.header, before.header, 'toolbar moved');
  await page.locator('.wt-timeline-scroll').hover();
  await page.mouse.wheel(0, 420);
  await page.waitForFunction(() => document.querySelector('.wt-timeline-scroll').scrollTop > 0);
  const rightScrolled = await positions();
  assert.equal(rightScrolled.left, leftScrolled.left, 'right wheel moved tasks');
  assert.equal(rightScrolled.timelineHeader, before.timelineHeader, 'timeline heading moved');
  for (const selector of ['.wt-task-column', '.wt-timeline-scroll']) {
    await page.locator(selector).evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.locator(selector).hover();
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(150);
    const atEnd = await positions();
    assert.equal(atEnd.root, 0, 'wheel at pane bottom scrolled root');
    assert.equal(atEnd.outer, 0, 'wheel at pane bottom scrolled window');
  }
  for (const width of [800, 390, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => {
      document.querySelector('.wt-layout').scrollTop = 100000;
    });
    const state = await page.evaluate(() => {
      const root = document.querySelector('.work-timeline-view');
      const layout = document.querySelector('.wt-layout');
      const timeline = document.querySelector('.wt-timeline-column').getBoundingClientRect();
      const host = document.querySelector('#host').getBoundingClientRect();
      return { overflow: root.scrollWidth > root.clientWidth, timelineBottom: timeline.bottom, hostBottom: host.bottom, scrolled: layout.scrollTop };
    });
    assert.equal(state.overflow, false, `horizontal overflow at ${width}`);
    assert.ok(state.timelineBottom <= state.hostBottom + 1, `timeline inaccessible at ${width}`);
    if (width <= 900) assert.ok(state.scrolled > 0, 'stacked layout cannot scroll');
  }
  console.log('Independent wheel scrolling, fixed headings, boundary containment, and narrow layouts passed.');
} finally { await browser.close(); }
