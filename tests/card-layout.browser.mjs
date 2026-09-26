import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

// Measure the shipped CSS in Chromium, including repeated wide → narrow resizes.
const css = readFileSync("styles.css", "utf8");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const failures = [];
let checks = 0;
try {
  await page.setContent(`<style>* { box-sizing: border-box } body { margin: 0; font: 14px Arial } ${css}</style>
    <div class="work-timeline-view"><div class="wt-card-grid">
    ${Array.from({ length: 12 }, (_, i) => `<article class="wt-card${i === 0 ? " is-expanded is-selected" : ""}"><div class="wt-card-body">
      <div class="wt-card-heading"><button class="wt-card-open"><span class="wt-card-title">任务 ${i + 1}</span></button></div>
      <p class="wt-card-latest">${i === 2 ? '很长的进展文字需要完整显示。'.repeat(40) : '检查任务进展与响应式布局'}</p><footer class="wt-card-footer">
      ${i === 0 ? '<div class="wt-card-summary"><button class="wt-summary-chip">待办 1/4</button><button class="wt-summary-chip">9月30日截止</button></div>' : ''}
      <div class="wt-card-meta"><span>未分组</span><span class="wt-tag">重要</span><span class="wt-card-time">9/18 20:50</span></div></footer>
      ${i === 0 ? `<section class="wt-card-todos"><h4>待办</h4>${Array.from({ length: 4 }, (_, j) => `<div class="wt-todo-row"><label class="wt-todo-label"><input type="checkbox"><span>${j === 2 ? '需要换行的待办内容。'.repeat(6) : '核对清单项目'}</span></label></div>`).join('')}</section><div class="wt-optional-actions"><button>添加待办</button></div><form class="wt-card-composer"><label>记录当前进展<textarea></textarea></label><div class="wt-composer-footer"><span class="wt-draft-state">草稿已自动保存</span><button class="mod-cta">记录进展</button></div></form>` : ''}
    </div></article>`).join("")}</div></div>`);
  await page.evaluate(() => {
    const observer = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        const body = target;
        const card = body.parentElement;
        const style = getComputedStyle(card.parentElement);
        const row = parseFloat(style.gridAutoRows);
        const gap = parseFloat(style.rowGap);
        card.style.gridRowEnd = `span ${Math.max(1, Math.ceil((body.scrollHeight + 2 + gap) / (row + gap)))}`;
      }
    });
    document.querySelectorAll('.wt-card-body').forEach(body => observer.observe(body));
  });
  for (const zoom of [1, 1.25, 1.5]) {
    for (const width of [1400, 735, 1100, 537, 900, 260, 1600, 808, 269]) {
      await page.evaluate(({ width, zoom }) => {
        document.body.style.zoom = String(zoom);
        const grid = document.querySelector('.wt-card-grid');
        grid.style.width = `${width}px`;
      }, { width, zoom });
      await page.waitForFunction(({ width, zoom }) => {
        const cards = [...document.querySelectorAll('.wt-card')];
        const fits = cards.every(card => card.getBoundingClientRect().height / zoom + 0.5 >= card.querySelector('.wt-card-body').scrollHeight + 2);
        const compact = cards.every(card => card.getBoundingClientRect().height / zoom - card.querySelector('.wt-card-body').scrollHeight - 2 < 160);
        return fits && compact;
      }, { width, zoom });
      const settled = await page.evaluate((zoom) => {
        const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left / zoom, top: r.top / zoom, width: r.width / zoom, height: r.height / zoom, bottom: r.bottom / zoom, right: r.right / zoom }; };
        const grid = document.querySelector('.wt-card-grid');
        return { grid: rect(grid), cards: [...grid.children].map(rect), gap: parseFloat(getComputedStyle(grid).rowGap), content: [...grid.children].map(card => card.querySelector('.wt-card-body').scrollHeight + 2) };
      }, zoom);
      try {
        const { cards, grid, gap, content } = settled;
        const expanded = cards[0];
        assert.ok(cards.every(c => Math.abs(c.width - expanded.width) < 0.1), `unequal widths: ${cards.map(c => c.width)}`);
        assert.ok(cards.every(c => c.width >= Math.min(width, 260) - 0.1 && c.right <= grid.right + 0.1), 'narrow or overflowing columns');
        assert.ok(cards.every((c, i) => c.height + 0.5 >= content[i]), `card content clipped: ${cards.map((c, i) => `${i}:${c.height}/${content[i]}`).join(', ')}`);
        assert.ok(cards.every(c => Math.abs((c.height + gap) / (148 + gap) - Math.round((c.height + gap) / (148 + gap))) < 0.02), 'card height not on integer grid');
        assert.ok(cards.every((c, i) => c.height - content[i] < 160), 'card reserves more than the smallest whole-row height');
        if (width >= 529) {
          const beside = cards.filter(c => c.left > expanded.left + 1 && c.top < expanded.bottom);
          assert.ok(beside.length > 0, 'neighbor cards are not packed beside expanded card');
        }
        for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
          const a = cards[i], b = cards[j];
          assert.ok(a.right <= b.left + 0.1 || b.right <= a.left + 0.1 || a.bottom <= b.top + 0.1 || b.bottom <= a.top + 0.1, 'cards overlap');
        }
        checks++;
      } catch (error) { failures.push(`${width}px at ${zoom * 100}%: ${error.message}`); }
    }
  }
  assert.deepEqual(failures, []);
  if (process.env.CARD_SCREENSHOT) {
    await page.evaluate(() => { document.body.style.zoom = '1'; document.querySelector('.wt-card-grid').style.width = '735px'; });
    await page.waitForFunction(() => [...document.querySelectorAll('.wt-card')].every(card => card.getBoundingClientRect().height + 0.5 >= card.querySelector('.wt-card-body').scrollHeight + 2));
    await page.screenshot({ path: process.env.CARD_SCREENSHOT, fullPage: true });
  }
  if (process.env.CARD_MOBILE_SCREENSHOT) {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => { document.querySelector('.wt-card-grid').style.width = '343px'; });
    await page.waitForFunction(() => [...document.querySelectorAll('.wt-card')].every(card => card.getBoundingClientRect().height + 0.5 >= card.querySelector('.wt-card-body').scrollHeight + 2));
    await page.screenshot({ path: process.env.CARD_MOBILE_SCREENSHOT, fullPage: true });
  }
  if (process.env.CARD_DARK_SCREENSHOT) {
    await page.evaluate(() => { document.body.classList.add('theme-dark'); document.querySelector('.wt-card-grid').style.width = '735px'; });
    await page.waitForFunction(() => [...document.querySelectorAll('.wt-card')].every(card => card.getBoundingClientRect().height + 0.5 >= card.querySelector('.wt-card-body').scrollHeight + 2));
    await page.waitForTimeout(250);
    await page.screenshot({ path: process.env.CARD_DARK_SCREENSHOT, fullPage: true });
  }
  console.log(`${checks} browser layout cases passed (width, height, alignment, resize, overlap, zoom).`);
} finally { await browser.close(); }
