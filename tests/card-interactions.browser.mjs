import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({
  entryPoints: ["tests/helpers/card-fixture.mjs"], bundle: true, write: false, format: "esm",
  alias: { obsidian: resolve("tests/helpers/obsidian-browser.mjs") },
});
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
const failures = [];
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => console.error(error.message));
  await page.route("https://tracelo.test/", (route) => route.fulfill({
    contentType: "text/html",
    body: '<style>' + readFileSync("tests/helpers/obsidian-host.css", "utf8") + '\n' + readFileSync("styles.css", "utf8") + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>',
  }));
  await page.goto("https://tracelo.test/");
  await page.waitForFunction(() => window.cardFixture);
  const ids = await page.evaluate(() => window.cardFixture.ids);
  const card = (id) => page.locator('[data-task-id="' + id + '"]');
  const payment = card(ids.payment);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function check(name, run) {
    try { await run(); checks++; } catch (error) { failures.push(name + ": " + error.message); }
  }
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
  await check("long progress occupies its own complete layout box", async () => {
    const m = await card(ids.long).evaluate((el) => {
      const latest = el.querySelector(".wt-card-latest");
      const footer = el.querySelector(".wt-card-meta");
      return { insideButton: Boolean(latest.closest("button")), bottom: latest.getBoundingClientRect().bottom, footer: footer.getBoundingClientRect().top, scroll: latest.scrollHeight, height: latest.clientHeight };
    });
    assert.equal(m.insideButton, false);
    assert.ok(m.bottom <= m.footer);
    assert.ok(m.height >= m.scroll - 1);
  });
  await payment.locator(".wt-card-open").click();
  await check("expansion preserves title focus instead of jumping to composer", async () => {
    await settle();
    assert.equal(await payment.locator("textarea").evaluate((el) => el === document.activeElement), false);
  });
  await check("expanded checklist exposes count and persistent add field", async () => {
    assert.equal(await payment.getByText("2 / 4 已完成", { exact: true }).count(), 1);
    assert.equal(await payment.getByRole("textbox", { name: "新增待办" }).count(), 1);
    assert.equal(await payment.getByRole("button", { name: "添加待办", exact: true }).count(), 1);
  });
  await check("expanded accent is a short marker", async () => {
    assert.equal(await payment.evaluate((el) => getComputedStyle(el, "::before").height), "28px");
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
      assert.equal(await card(ids.plain).getByText("1 / 1 已完成", { exact: true }).count(), 1);
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
  await card(ids.long).locator(".wt-card-open").click();
  for (const theme of ["theme-light", "theme-dark"]) {
    await page.evaluate((name) => { document.body.className = name; }, theme);
    for (const width of [1440, 1000, 760, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await settle();
      await check(theme + " at " + width + "px: contents fit and follow the base grid", async () => {
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
          assert.ok(Math.abs((r.height + 12) / 160 - Math.round((r.height + 12) / 160)) < 0.02, "off-grid card");
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
  assert.deepEqual(failures, []);
  console.log(checks + " real-render card checks passed with Obsidian host CSS.");
} finally { await browser.close(); }
