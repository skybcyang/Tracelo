import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = 'desktop/Sources/TraceloCapture/Resources/';
const bundle = await build({ stdin: { contents: 'export * from "./src/capture-form"; export {serializeGroupArchive, parseTaskMarkdown} from "./src/archive";', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'TraceloCreateTask' });
const html = readFileSync(root + 'capture.html', 'utf8')
  .replace('/*PLUGIN_STYLES*/', readFileSync('styles.css', 'utf8'))
  .replace('/*CAPTURE_STYLES*/', readFileSync(root + 'capture.css', 'utf8'))
  .replace('/*CREATE_TASK_SCRIPT*/', bundle.outputFiles[0].text)
  .replace('/*CAPTURE_SCRIPT*/', readFileSync(root + 'capture.js', 'utf8'));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
try {
  for (const platform of ['mac', 'windows']) {
    const page = await browser.newPage({ viewport: { width: 560, height: 650 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(platform => {
      window.messages = [];
      const postMessage = value => window.messages.push(value);
      if (platform === 'windows') { window.chrome ??= {}; window.chrome.webview = { postMessage }; }
      else window.webkit = { messageHandlers: { capture: { postMessage } } };
    }, platform);
    await page.goto('about:blank');
    await page.setContent(html);
    await page.waitForFunction(() => window.capture);
    const title = page.locator('#task-title'), details = page.getByRole('textbox', { name: '任务详情', exact: true });
    const submit = page.locator('#submit');
    assert.equal(await submit.isDisabled(), true);
    await page.evaluate(() => window.capture.update({ configured: true, groupsSource: '', draft: { title: '独立标题', notes: '独立详情\n第二行', quadrant: 'important_urgent' }, focus: true }));
    assert.equal(await title.inputValue(), '独立标题');
    assert.equal(await details.inputValue(), '独立详情\n第二行');
    assert.equal(await title.evaluate(el => el === document.activeElement), true);
    const quadrants = page.getByRole('group', { name: '任务象限', exact: true });
    assert.equal(await quadrants.getByRole('radio').count(), 4, 'show all four choices directly');
    assert.equal(await quadrants.getByRole('radio', { name: '重要且紧急', exact: true }).isChecked(), true);
    for (const choice of await quadrants.locator('.wt-quadrant-option').all()) {
      await choice.click();
      const value = await choice.locator('input').inputValue();
      assert.equal(await page.evaluate(() => window.capture.getDraft().quadrant), value);
      assert.equal(await quadrants.locator('input:checked').count(), 1);
    }
    await quadrants.getByRole('radio', { name: '不重要不紧急', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await quadrants.getByRole('radio', { name: '重要且紧急', exact: true }).isChecked(), true, 'native radio arrow keys wrap choices');
    await page.evaluate(() => {
      window.groupArchive = { version: 1, groups: [{ id: 'group-1', name: '产品研发' }], events: [] };
      window.capture.update({ groupsSource: TraceloCreateTask.serializeGroupArchive(window.groupArchive) });
    });
    await page.getByRole('combobox', { name: '任务分组', exact: true }).selectOption('group-1');
    await details.press('End'); await details.press('Enter');
    assert.equal(await page.evaluate(() => window.messages.filter(m => m.action === 'submit').length), 0);
    await page.getByRole('button', { name: '添加待办', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '待办内容', exact: true }).count(), 1,
      JSON.stringify({ platform, errors, state: await page.evaluate(() => ({ draft: window.capture.getDraft(), active: document.activeElement?.outerHTML, messages: window.messages.slice(-3) })) }));
    await page.getByRole('textbox', { name: '待办内容', exact: true }).fill('验收完整任务');
    await page.getByRole('button', { name: '截止日期', exact: true }).click();
    await page.locator('input[type=date]').fill('2026-12-01');
    await page.getByRole('button', { name: '初始进展', exact: true }).click();
    await page.getByRole('textbox', { name: '初始进展', exact: true }).fill('已经开始');
    await page.locator('input[type=file]').setInputFiles({ name: 'capture.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') });
    await page.waitForFunction(() => !document.querySelector('#submit').disabled);
    await title.dispatchEvent('compositionstart');
    await title.press('Control+Enter');
    await page.locator('form').evaluate(form => form.requestSubmit());
    assert.equal(await page.evaluate(() => window.messages.filter(m => m.action === 'submit').length), 0);
    await title.dispatchEvent('compositionend');
    await title.press(platform === 'windows' ? 'Control+Enter' : 'Meta+Enter');
    const first = await page.evaluate(() => window.messages.filter(m => m.action === 'submit').at(-1));
    assert.ok(first.request.id);
    const task = JSON.parse(first.request.markdown.match(/^<!-- work-timeline-task:v1\n([\s\S]+?)\n-->/)[1]);
    assert.equal(await page.evaluate(markdown => TraceloCreateTask.parseTaskMarkdown(markdown).groupName, first.request.markdown), '产品研发');
    assert.equal(task.title, '独立标题'); assert.equal(task.important, true); assert.equal(task.urgent, true);
    assert.equal(first.request.attachments.length, 1);
    assert.doesNotMatch(task.notes, /tracelo-draft:/);
    assert.match(task.notes, /image-[a-f0-9]+\.png/);
    assert.equal(task.dueDate, '2026-12-01'); assert.equal(task.todos[0].text, '验收完整任务');
    assert.equal(task.events.at(-1).text, '已经开始');
    await submit.evaluate(el => el.click());
    assert.equal(await page.evaluate(() => window.messages.filter(m => m.action === 'submit').length), 1);
    await page.evaluate(() => window.capture.update({ saving: false, error: '测试写入失败' }));
    assert.equal(await page.getByRole('alert').textContent(), '测试写入失败');
    await submit.click();
    const retry = await page.evaluate(() => window.messages.filter(m => m.action === 'submit').at(-1));
    assert.deepEqual(retry.request, first.request, 'retry retains the exact ID and archive');
    await page.evaluate(() => window.capture.update({ saving: false, error: '测试写入失败' }));
    await page.evaluate(() => {
      window.groupArchive.groups[0].name = '研发新名称';
      window.capture.update({ groupsSource: TraceloCreateTask.serializeGroupArchive(window.groupArchive) });
    });
    await submit.click();
    const regrouped = await page.evaluate(() => window.messages.filter(m => m.action === 'submit').at(-1));
    assert.notEqual(regrouped.request.id, first.request.id, 'changed group source invalidates the old request');
    assert.equal(await page.evaluate(markdown => TraceloCreateTask.parseTaskMarkdown(markdown).groupName, regrouped.request.markdown), '研发新名称');
    await page.evaluate(() => window.capture.update({ saving: false, error: '测试写入失败' }));
    await title.press('Escape');
    assert.deepEqual(await page.evaluate(() => window.messages.filter(m => m.action === 'dismiss').at(-1).draft), first.draft);
    // Invalid or removed group never silently becomes Ungrouped.
    await page.evaluate(() => window.capture.update({ groupsSource: 'invalid archive' }));
    assert.equal(await submit.isDisabled(), true);
    await page.evaluate(() => window.capture.update({ groupsSource: '', draft: { title: '丢失分组', groupId: 'removed' }, error: '' }));
    await submit.click();
    assert.match(await page.getByRole('alert').textContent(), /重新选择/);
    await page.getByRole('combobox', { name: '任务分组', exact: true }).selectOption('');
    await page.evaluate(() => window.capture.update({ configured: false, location: '设置保存位置…' }));
    assert.equal(await submit.isDisabled(), true);
    await page.getByRole('button', { name: '设置保存位置…', exact: true }).click();
    assert.equal(await page.evaluate(() => window.messages.at(-1).action), 'settings');
    for (const dark of [false, true]) {
      await page.evaluate(dark => window.capture.update({ dark, configured: true, draft: { title: '示例任务', notes: '完整详情', todos: Array(10).fill('待办'), expanded: { todos: true, due: true, progress: true } }, focus: true }), dark);
      await page.waitForFunction(dark => getComputedStyle(document.querySelector('textarea')).backgroundColor === (dark ? 'rgba(27, 34, 46, 0.9)' : 'rgba(248, 251, 255, 0.9)'), dark);
      for (const [width, height] of [[560, 650], [360, 320]]) {
        await page.setViewportSize({ width, height });
        const bounds = await submit.boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height, 'footer remains visible');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    }
    await page.evaluate(() => window.capture.update({ draft: { title: '中断后恢复', notes: '![截图](<tracelo-draft:interrupted>)', images: [{ id: 'interrupted', name: '截图.png', type: 'image/png', data: '', state: 'processing' }] }, saving: false, error: '' }));
    assert.equal(await page.getByRole('button', { name: '重试图片：截图.png' }).count(), 1, 'interrupted reads must expose recovery rather than wait forever');
    assert.equal(await submit.isDisabled(), true);
    await page.evaluate(() => window.capture.update({ draft: null, saving: false, error: '' }));
    assert.equal(await title.inputValue(), ''); assert.equal(await details.inputValue(), '');
    assert.deepEqual(errors, []);
    console.log(`${platform}: complete shared form, archive fields, IME, retry, drafts, groups, themes and footer passed.`);
    await page.close();
  }
} finally { await browser.close(); }
