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
    ${Array.from({ length: 12 }, (_, i) => `<article class="wt-card${i === 0 ? " is-expanded is-selected" : ""}">
      <button class="wt-card-open"><span class="wt-card-title">任务 ${i + 1}</span>
      <span class="wt-card-latest">检查任务进展与响应式布局</span>
      <span class="wt-card-meta"><span>未分组</span><span class="wt-tag">重要</span><span class="wt-card-time">9/18 20:50</span></span></button>
      ${i === 0 ? '<form class="wt-card-composer"><label>记录当前进展<textarea></textarea></label><div class="wt-composer-footer"><span class="wt-draft-state">草稿已自动保存</span><button class="mod-cta">记录进展</button></div></form>' : ''}
    </article>`).join("")}</div></div>`);
  for (const zoom of [1, 1.25, 1.5]) {
    for (const width of [1400, 735, 1100, 537, 900, 260, 1600, 808, 269]) {
      const geometry = await page.evaluate(({ width, zoom }) => {
        document.body.style.zoom = String(zoom);
        const grid = document.querySelector('.wt-card-grid');
        grid.style.width = `${width}px`;
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left / zoom, top: r.top / zoom, width: r.width / zoom, height: r.height / zoom, bottom: r.bottom / zoom, right: r.right / zoom };
        };
        return { grid: rect(grid), cards: [...grid.children].map(rect), gap: parseFloat(getComputedStyle(grid).columnGap) };
      }, { width, zoom });
      try {
        const { cards, grid, gap } = geometry;
        const expanded = cards[0];
        assert.ok(cards.every(c => Math.abs(c.width - expanded.width) < 0.1), `unequal widths: ${cards.map(c => c.width)}`);
        assert.ok(cards.every(c => c.width >= Math.min(width, 260) - 0.1 && c.right <= grid.right + 0.1), 'narrow or overflowing columns');
        assert.ok(Math.abs(expanded.height - (2 * cards[1].height + gap)) < 0.1, 'expanded height is not two cells plus gap');
        if (width >= 529) {
          const beside = cards.filter(c => c.left > expanded.left + 1 && c.top < expanded.bottom);
          assert.ok(beside.some(c => Math.abs(c.bottom - expanded.bottom) < 0.1), 'second card bottom does not align with expanded card');
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
  console.log(`${checks} browser layout cases passed (width, height, alignment, resize, overlap, zoom).`);
} finally { await browser.close(); }
