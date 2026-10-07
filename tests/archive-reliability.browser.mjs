import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: ['tests/helpers/card-fixture.mjs'], bundle: true, write: false, format: 'esm', external: ['electron', 'node:child_process'], alias: { obsidian: resolve('tests/helpers/obsidian-browser.mjs') } });
const browser = await chromium.launch({ headless: true });
let failures = 0;
try {
  for (const scenario of ['daily-snapshot', 'damaged-groups', 'move-outside', 'rename-extension', 'removed-reference']) {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    try {
      await page.route('https://tracelo.test/', route => route.fulfill({ contentType: 'text/html', body: '<style>' + readFileSync('styles.css', 'utf8') + '</style><script type="module">' + bundle.outputFiles[0].text + '</script>' }));
      await page.goto('https://tracelo.test/');
      await page.waitForFunction(() => window.cardFixture);
      if (scenario === 'daily-snapshot') {
        const result=await page.evaluate(async()=>{
          const {plugin,app,ids}=window.cardFixture;
          const path=plugin.taskArchivePath(ids.payment);
          const source=(await app.vault.adapter.read(path)).replace(/(<!-- tracelo-event )(\{.*?\})( -->)/g,(_all,before,json,after)=>before+JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(json)).reverse()))+after);
          await app.vault.adapter.write(path,source);
          const reloaded=new plugin.constructor(app,plugin.manifest); reloaded.data=structuredClone(plugin.state); reloaded.data.lastDailyBackup=null;
          await reloaded.onload();
          return {source,current:await app.vault.adapter.read(path),backup:await app.vault.adapter.read(`.obsidian/plugins/work-timeline/backups/daily/${reloaded.state.lastDailyBackup}/${ids.payment}.md`)};
        });
        assert.equal(result.current,result.source,'daily backup must not rewrite editable source');
        assert.equal(result.backup,result.source,'daily backup must keep the exact source');
      } else if (scenario === 'damaged-groups') {
        const result = await page.evaluate(async () => {
          const { plugin, app } = window.cardFixture;
          const path = plugin.state.taskDirectory + '/_groups.md';
          window.validGroups = await app.vault.adapter.read(path);
          const daily = `.obsidian/plugins/work-timeline/backups/daily/${plugin.state.lastDailyBackup}/_groups.md`;
          const backup = await app.vault.adapter.read(daily);
          await app.vault.adapter.write(path, 'damaged group archive');
          const reloaded = new plugin.constructor(app, plugin.manifest);
          reloaded.data = structuredClone(plugin.state);
          reloaded.data.lastDailyBackup = null;
          await reloaded.onload();
          window.reloadedPlugin = reloaded;
          return { source: await app.vault.adapter.read(path), backup: await app.vault.adapter.read(daily), originalBackup: backup };
        });
        assert.equal(result.source, 'damaged group archive', 'startup must preserve damaged groups');
        assert.equal(result.backup, result.originalBackup, 'startup must preserve the last valid backup');
        await page.evaluate(async () => {
          const plugin = window.reloadedPlugin;
          for (const operation of [() => plugin.addGroup('不得写入'), () => plugin.renameGroup(window.cardFixture.plugin.groups[0].id, '不得改名'), () => plugin.createExport()]) {
            let rejected = false;
            try { await operation(); } catch { rejected = true; }
            if (!rejected) throw Error('group-dependent writes must remain paused');
          }
          const { app } = window.cardFixture;
          const path = plugin.state.taskDirectory + '/_groups.md';
          await app.vault.adapter.write(path, window.validGroups);
          app.emitVaultEvent('modify', path);
        });
        await page.waitForFunction(() => window.reloadedPlugin.groups.length === 1);
        await page.evaluate(async () => {
          await window.reloadedPlugin.addGroup('恢复后可保存');
          if (window.reloadedPlugin.groups.length !== 2) throw Error('repaired groups did not recover');
        });
      } else if (scenario === 'move-outside' || scenario === 'rename-extension') {
        await page.evaluate(async scenario => {
          const { plugin, app, ids } = window.cardFixture;
          const old = plugin.taskArchivePath(ids.payment);
          plugin.updateDraft(ids.payment, '文件移动后保留草稿');
          const path = scenario === 'move-outside' ? '移出目录/任务.md' : old.replace(/\.md$/, '.txt');
          if (scenario === 'move-outside') await app.vault.adapter.mkdir('移出目录');
          await app.vault.adapter.rename(old, path);
          window.movedPath = path;
          window.movedSource = await app.vault.adapter.read(path);
          app.emitVaultEvent('rename', path, old);
        }, scenario);
        await page.waitForFunction(() => !window.cardFixture.plugin.tasks.some(t => t.id === window.cardFixture.ids.payment));
        assert.equal(await page.evaluate(() => window.cardFixture.plugin.state.drafts[window.cardFixture.ids.payment]), '文件移动后保留草稿');
        assert.equal(await page.evaluate(() => window.cardFixture.app.vault.adapter.read(window.movedPath)), await page.evaluate(() => window.movedSource));
        if (scenario === 'move-outside') {
          await page.evaluate(async () => {
            const { plugin, app } = window.cardFixture;
            const path = plugin.state.taskDirectory + '/移回任务.md';
            await app.vault.adapter.rename(window.movedPath, path);
            app.emitVaultEvent('rename', path, window.movedPath);
          });
          await page.waitForFunction(() => window.cardFixture.plugin.tasks.some(t => t.id === window.cardFixture.ids.payment));
          await page.evaluate(() => window.cardFixture.plugin.recordProgress(window.cardFixture.ids.payment, '移回后正常保存'));
        }
      } else {
        await page.evaluate(async () => {
          const { plugin, app, ids } = window.cardFixture;
          plugin.state.smartCapture = { baseUrl: 'https://example.test', model: 'test', apiKey: 'test-credential-1234567890' };
          window.modelRequest = async request => {
            window.lastRequest = JSON.parse(request.body);
            return { status: 200, text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: '继续讨论。', proposal: null }) } }] }) };
          };
          const chat = app.workspace.getLeavesOfType('work-timeline-view')[0].view.conversation;
          chat.addReference(ids.payment);
          chat.input.value = '讨论引用任务';
          await chat.send();
          const path = plugin.taskArchivePath(ids.payment);
          await app.vault.adapter.remove(path);
          app.emitVaultEvent('delete', path);
        });
        await page.waitForFunction(() => !window.cardFixture.plugin.tasks.some(t => t.id === window.cardFixture.ids.payment));
        await page.getByRole('button', { name: '移除引用', exact: true }).click();
        const result = await page.evaluate(async () => {
          const chat = window.cardFixture.app.workspace.getLeavesOfType('work-timeline-view')[0].view.conversation;
          chat.input.value = '继续讨论一个无关的问题';
          await chat.send();
          return { messages: chat.session.messages.length, status: chat.status.textContent, context: window.lastRequest.messages[1].content };
        });
        assert.equal(result.messages, 4, 'missing historical references must not block the conversation');
        assert.equal(result.status, '');
        assert.match(result.context, /unavailableTaskIds/);
        assert.match(result.context, /"tasks":\[\]/);
        assert.equal(await page.evaluate(() => window.cardFixture.app.workspace.getLeavesOfType('work-timeline-view')[0].view.conversation.session.messages[0].refs.length), 1, 'keep frozen historical references');
      }
      console.log('PASS archive reliability:', scenario);
    } catch (error) {
      failures++;
      console.error('FAIL archive reliability:', scenario, error.message);
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
if (failures) process.exitCode = 1;
