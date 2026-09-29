import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
  await page.goto('https://tracelo.test/'); await page.waitForFunction(() => window.cardFixture);
  const result = await page.evaluate(async () => {
    const {plugin,app,ids} = window.cardFixture, adapter = app.vault.adapter;
    const directory = plugin.state.taskDirectory + '/.tracelo-operations'; await adapter.mkdir(directory);
    const operation = { version: 1, id: 'quick-' + 'a'.repeat(32), taskId: ids.payment, kind: 'progress', text: '桌面新增进展' };
    const request = directory + '/' + operation.id + '.request.json', receipt = directory + '/' + operation.id + '.result.json';
    await adapter.write(request, JSON.stringify(operation));
    await plugin.renameTask(ids.payment, '同步前已改名');
    await plugin.recordProgress(ids.payment, '插件同时记录');
    await plugin.processQuickOperations();
    const first = JSON.parse(await adapter.read(receipt));
    await adapter.remove(receipt); // Lost acknowledgement must not replay the event.
    await plugin.processQuickOperations();
    const task = plugin.tasks.find(t => t.id === ids.payment);
    await plugin.finishTask(ids.payment);
    const ended = { ...operation, id: 'quick-' + 'b'.repeat(32), text: '不应写入' };
    await adapter.write(directory + '/' + ended.id + '.request.json', JSON.stringify(ended));
    await plugin.processQuickOperations();
    const rejected = JSON.parse(await adapter.read(directory + '/' + ended.id + '.result.json'));
    return { first, rejected, task, latest: plugin.tasks.find(t => t.id === ids.payment), groupOrder: plugin.state.orders.group[task.groupId] };
  });
  assert.equal(result.first.status, 'applied');
  assert.equal(result.task.title, '同步前已改名');
  assert.equal(result.task.events.filter(e => e.text === '桌面新增进展').length, 1);
  assert.equal(result.task.events.filter(e => e.text === '插件同时记录').length, 1);
  assert.equal(result.task.todos.length, 4);
  assert.equal(result.rejected.status, 'failed');
  assert.equal(result.latest.events.some(e => e.text === '不应写入'), false);
  console.log('PASS quick inbox: serialized merge, rename, lost receipt retry, unchanged todos and ended-task rejection');
} finally { await browser.close(); }
