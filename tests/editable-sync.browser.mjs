import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({entryPoints:['tests/helpers/card-fixture.mjs'],bundle:true,write:false,format:'esm',external:['electron','node:child_process'],alias:{obsidian:resolve('tests/helpers/obsidian-browser.mjs')}});
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => console.error(error.stack));
  await page.route('https://tracelo.test/', route => route.fulfill({contentType:'text/html',body:'<style>'+readFileSync('styles.css','utf8')+'</style><script type="module">'+bundle.outputFiles[0].text+'</script>'}));
  await page.goto('https://tracelo.test/'); await page.waitForFunction(()=>window.cardFixture);
  const id = await page.evaluate(()=>window.cardFixture.ids.payment);
  await page.locator(`.wt-card[data-task-id="${id}"] .wt-card-open`).click();
  const draft = page.locator(`.wt-card[data-task-id="${id}"] textarea`).last();
  await draft.fill('正在输入的草稿');
  await draft.evaluate(el=>el.setSelectionRange(2,5));
  await draft.evaluate(el=>{window.composingInput=el;el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));});
  await page.evaluate(async()=>{
    const {plugin,app,ids} = window.cardFixture;
    const path=plugin.taskArchivePath(ids.payment);
    const source=await app.vault.adapter.read(path);
    window.editableSource=source.replace('# 完成支付模块','# 文件中改名').replace('urgent: false','urgent: true').replace('接口联调已通过，继续验证退款与异常流程。','文件中的最新进展');
    await app.vault.adapter.write(path,window.editableSource); app.emitVaultEvent('modify',path);
  });
  await page.waitForFunction(()=>window.cardFixture.plugin.tasks.some(t=>t.title==='文件中改名'&&t.urgent));
  assert.equal(await page.evaluate(()=>window.composingInput.isConnected),true,'external refresh must keep the live IME node');
  await draft.evaluate(el=>{
    el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文'}));
    el.value='正在输入的草稿中文';el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'中文'}));
  });
  await page.waitForFunction(()=>document.querySelector('.wt-card-title')?.textContent?.includes('文件中改名') || [...document.querySelectorAll('.wt-card-title')].some(el=>el.textContent.includes('文件中改名')));
  assert.match(await page.locator(`.wt-card[data-task-id="${id}"]`).innerText(),/文件中的最新进展/);
  assert.equal(await draft.inputValue(),'正在输入的草稿中文');
  assert.equal(await draft.evaluate(el=>document.activeElement===el),true);
  await page.evaluate(async()=>{
    const {plugin,app,ids}=window.cardFixture;
    await plugin.addGroup('文件编辑分组');
    const path=plugin.taskArchivePath(ids.payment);
    window.editableSource=window.editableSource.replace('groupName: 产品研发','groupName: 文件编辑分组');
    await app.vault.adapter.write(path,window.editableSource);app.emitVaultEvent('modify',path);
  });
  await page.waitForFunction(()=>window.cardFixture.plugin.tasks.find(t=>t.id===window.cardFixture.ids.payment).groupName==='文件编辑分组');
  await page.evaluate(async()=>{
    const {plugin,app,ids}=window.cardFixture, path=plugin.taskArchivePath(ids.payment);
    await app.vault.adapter.write(path,'---\ntracelo: 2\nid: ['); app.emitVaultEvent('modify',path);
  });
  await page.waitForFunction(()=>window.cardFixture.plugin.lockedTasks.has(window.cardFixture.ids.payment));
  assert.equal(await page.evaluate(async()=>{const {app,plugin,ids}=window.cardFixture;return app.vault.adapter.read(plugin.taskArchivePath(ids.payment));}),'---\ntracelo: 2\nid: [');
  await page.evaluate(async()=>{const {plugin,app,ids}=window.cardFixture;const path=plugin.taskArchivePath(ids.payment);await app.vault.adapter.write(path,window.editableSource);app.emitVaultEvent('modify',path);});
  await page.waitForFunction(()=>!window.cardFixture.plugin.lockedTasks.has(window.cardFixture.ids.payment));
  assert.equal(await page.evaluate(()=>window.cardFixture.plugin.tasks.find(t=>t.id===window.cardFixture.ids.payment).groupName),'文件编辑分组');
  await page.locator(`.wt-card[data-task-id="${id}"] .wt-card-open`).dispatchEvent('dblclick',{button:0});
  assert.equal(await page.evaluate(()=>window.cardFixture.app.openedFiles?.length??0),0);
  // A real double click must not lose its target to the first click's rerender.
  await page.locator(`.wt-card[data-task-id="${id}"] .wt-card-latest`).dblclick();
  await page.waitForFunction(()=>window.cardFixture.app.openedFiles?.length===1);
  const opened=await page.evaluate(()=>window.cardFixture.app.openedFiles);
  assert.equal(opened[0],await page.evaluate(()=>window.cardFixture.plugin.taskArchivePath(window.cardFixture.ids.payment)));
  await page.evaluate(async()=>{const {plugin,app,ids}=window.cardFixture;const old=plugin.taskArchivePath(ids.payment),path=plugin.state.taskDirectory+'/自定文件名.md';await app.vault.adapter.rename(old,path);app.emitVaultEvent('rename',path,old);});
  await page.waitForFunction(()=>window.cardFixture.plugin.taskArchivePath(window.cardFixture.ids.payment).endsWith('/自定文件名.md'));
  await page.evaluate(async()=>{const {plugin,ids}=window.cardFixture; await plugin.recordProgress(ids.payment,'改名后保存');});
  assert.match(await page.evaluate(()=>window.cardFixture.plugin.taskArchivePath(window.cardFixture.ids.payment)),/自定文件名\.md$/);
  await page.evaluate(async()=>{const {plugin,app,ids}=window.cardFixture;const path=plugin.taskArchivePath(ids.payment);await app.vault.adapter.remove(path);app.emitVaultEvent('delete',path);});
  await page.waitForFunction(()=>!window.cardFixture.plugin.tasks.some(t=>t.id===window.cardFixture.ids.payment));
  console.log('PASS editable archive: immediate external edits, invalid YAML preservation, correction, double-click, rename and deletion');
} finally {await browser.close();}
