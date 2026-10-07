import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.clock.install({ time: new Date(2026, 7, 15, 12) }); // Six calendar weeks.
  await page.route('https://tracelo.test/', r => r.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('tests/helpers/obsidian-host.css', 'utf8') + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/');
  await page.waitForFunction(() => window.cardFixture);
  await page.getByRole('button', { name: '截止日历', exact: true }).click();
  const modal = page.locator('.wt-calendar-modal');
  mkdirSync('test-results/release-097', { recursive: true });
  for (const appearance of ['light', 'dark']) {
    await page.evaluate(appearance => window.cardFixture.plugin.setAppearance('monochrome', appearance), appearance);
    for (const [width, height] of [[1280, 720], [1280, 560], [1280, 420], [390, 560]]) {
      await page.setViewportSize({ width, height });
      await modal.locator('.modal-content').evaluate(el => el.scrollTop = 0);
      await page.screenshot({ path: `test-results/release-097/calendar-${appearance}-${width}-${height}.png` });
      assert.equal(await modal.locator('.wt-calendar-day').count(), 42);
      const bounds = await modal.evaluate(el => {
        const content = el.querySelector('.modal-content').getBoundingClientRect();
        const last = el.querySelector('.wt-calendar-day:last-child').getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, contentBottom: content.bottom, lastBottom: last.bottom, overflow: el.scrollWidth - el.clientWidth };
      });
      assert.ok(bounds.top >= 0 && bounds.bottom <= height + 1, 'modal must stay inside the viewport');
      assert.ok(bounds.overflow <= 1, 'no horizontal overflow');
      if (width === 1280 && height === 720) assert.ok(bounds.lastBottom <= bounds.contentBottom + 1, 'sixth week must be fully visible at 720px');
      const last = modal.locator('.wt-calendar-day').last();
      await last.scrollIntoViewIfNeeded();
      await last.click();
      await modal.getByRole('button', { name: '关闭截止日历', exact: true }).scrollIntoViewIfNeeded();
      const close = await modal.getByRole('button', { name: '关闭截止日历', exact: true }).boundingBox();
      assert.ok(close.y >= 0 && close.y + close.height <= height, 'close remains reachable');
      console.log(`PASS calendar viewport: ${appearance} ${width}x${height}`);
    }
  }
} finally { await browser.close(); }
