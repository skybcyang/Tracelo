import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({
  entryPoints: ["tests/helpers/card-fixture.mjs"], bundle: true, write: false, format: "esm",
  external: ["electron"],
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
    try { await run(); checks++; } catch (error) { failures.push(name + ": " + error.message); }
  }
  await check('two-line progress with a deadline fits two complete base rows', async () => {
    const weekly = card(ids.dateOnly);
    await weekly.locator('.wt-card-open').click();
    await weekly.evaluate(el => { el.parentElement.style.gridTemplateColumns = 'repeat(2, 318px)'; });
    await settle();
    const metrics = await weekly.evaluate(el => {
      const body = el.querySelector('.wt-card-body');
      const latest = el.querySelector('.wt-card-latest');
      return { height: el.getBoundingClientRect().height, content: body.scrollHeight + 2, lines: latest.getBoundingClientRect().height / parseFloat(getComputedStyle(latest).lineHeight) };
    });
    assert.ok(Math.abs(metrics.lines - 2) < 0.02, 'regression requires two lines of progress');
    assert.equal(metrics.height, 308, `short expanded card should fit two rows: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.content <= metrics.height, 'two-row content must not clip');
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
        if (path.includes('导出并发验证') && path.endsWith('.md')) { started(); await gate; }
        return write(path, source);
      };
      const added = plugin.addTask({ title: '导出并发验证', groupId: null, groupName: '未分组', important: false, urgent: false, dueDate: null, todos: [], initialProgress: '' });
      await entered;
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
  await check('card whitespace selects and expands without toggling on a second click', async () => {
    await payment.click({ position: { x: 5, y: 100 } });
    assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'true');
    await payment.click({ position: { x: 5, y: 100 } });
    assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'true');
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
      assert.equal(path, '/test-vault/工作记录/材料/' + name);
    });
    await check('folder shortcut reuses directory and never expands the card', async () => {
      await payment.locator('.wt-card-folder').click();
      await page.waitForFunction(() => window.cardFixture.app.openedFolders.length === 2);
      assert.equal(await payment.locator('.wt-card-open').getAttribute('aria-expanded'), 'false');
      await payment.click({ button: 'right' });
      assert.equal(await page.getByRole('menuitem', { name: '打开文件夹', exact: true }).count(), 1);
    });
    await check('folder survives task rename and completion', async () => {
      await page.evaluate(async id => { const p = window.cardFixture.plugin; await p.renameTask(id, '支付模块改名'); await p.finishTask(id); }, ids.payment);
      await page.locator('.wt-ended-section summary').click();
      assert.equal(await payment.locator('.wt-card-folder').count(), 1);
      await payment.locator('.wt-card-folder').click();
      const name = await page.evaluate(id => window.cardFixture.plugin.tasks.find(t => t.id === id).archiveName, ids.payment);
      assert.match(name, / 支付模块改名$/);
      assert.equal(await page.evaluate(() => window.cardFixture.app.openedFolders.at(-1)), '/test-vault/工作记录/材料/' + name);
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
        const original = app.vault.createFolder;
        app.openError = '';
        app.vault.createFolder = async () => { throw new Error('没有写入权限'); };
        let error;
        try { await plugin.accessTaskFolder(id, true); } catch (reason) { error = reason.message; }
        app.vault.createFolder = original;
        const absent = !plugin.hasTaskFolder(id);
        await Promise.all([plugin.accessTaskFolder(id, true), plugin.accessTaskFolder(id, true)]);
        return { error, absent, opened: app.openedFolders.filter(path => path.endsWith(plugin.tasks.find(t => t.id === id).archiveName)).length, ready: plugin.hasTaskFolder(id) };
      }, ids.plain);
      assert.deepEqual(result, { error: '没有写入权限', absent: true, opened: 1, ready: true });
    });
    await check('same-name file is never overwritten by folder creation', async () => {
      const result = await page.evaluate(async id => {
        const { plugin, app } = window.cardFixture;
        const path = '工作记录/材料/' + plugin.tasks.find(t => t.id === id).archiveName;
        await app.vault.adapter.write(path, 'existing content');
        let error;
        try { await plugin.accessTaskFolder(id, true); } catch (reason) { error = reason.message; }
        return { error, content: await app.vault.adapter.read(path), folder: plugin.hasTaskFolder(id) };
      }, ids.dateOnly);
      assert.match(result.error, /同名文件/);
      assert.equal(result.content, 'existing content');
      assert.equal(result.folder, false);
    });
    await check('missing directory is not silently recreated by open', async () => {
      const result = await page.evaluate(async id => {
        const { plugin, app } = window.cardFixture;
        await app.vault.adapter.rmdir('工作记录/材料/' + plugin.tasks.find(t => t.id === id).archiveName);
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
  for (const id of [ids.dateOnly, ids.plain, ids.payment, ids.long]) {
    await check('expansion and collapse use the smallest whole-card grid span: ' + id, async () => {
      const open = card(id).locator('.wt-card-open');
      if (await open.getAttribute('aria-expanded') !== 'true') await open.click();
      await settle();
      const measured = await card(id).evaluate(el => ({ height: el.getBoundingClientRect().height, content: el.querySelector('.wt-card-body').scrollHeight + 2 }));
      assert.ok(measured.height + 1 >= measured.content, 'expanded content clipped');
      assert.ok(measured.height - measured.content < 160, `excess blank space: card ${measured.height}px, content ${measured.content}px`);
      assert.equal((measured.height + 12) % 160, 0, 'expanded card must align with base cards');
      await open.click();
      await settle();
      const collapsed = await card(id).evaluate(el => ({ height: el.getBoundingClientRect().height, content: el.querySelector('.wt-card-body').scrollHeight + 2 }));
      assert.ok(collapsed.height - collapsed.content < 160, 'collapsed card retains expanded whitespace');
      assert.equal((collapsed.height + 12) % 160, 0, 'collapsed card must align with base cards');
    });
  }
  await page.evaluate(id => window.cardFixture.plugin.accessTaskFolder(id, true), ids.long);
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
          assert.ok(r.height - r.content < 160, "more than one whole row of empty space");
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
  assert.deepEqual(pageErrors, []);
  console.log(checks + " real-render card checks passed with Obsidian host CSS.");
} finally { await browser.close(); }
