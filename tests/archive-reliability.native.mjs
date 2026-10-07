// Opt-in macOS QA of the built plugin in a fresh, real Obsidian profile/vault.
// No model credentials, production tasks or personal vaults are loaded.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const root = await mkdtemp(join(tmpdir(), 'tracelo-097-native-'));
const vault = join(root, 'vault'), profile = join(root, 'profile');
const pluginDirectory = join(vault, '.obsidian/plugins/work-timeline');
const output = resolve('test-results/release-097/native');
await mkdir(pluginDirectory, { recursive: true }); await mkdir(profile); await mkdir(output, { recursive: true });
for (const name of ['main.js', 'styles.css', 'manifest.json']) await copyFile(resolve(name), join(pluginDirectory, name));
await writeFile(join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['work-timeline']));
await writeFile(join(vault, '.obsidian/app.json'), JSON.stringify({ safeMode: false }));
await writeFile(join(profile, 'obsidian.json'), JSON.stringify({ vaults: { '1234567890abcdef': { path: vault, ts: Date.now(), open: true } } }));
await writeFile(join(pluginDirectory, 'data.json'), JSON.stringify({ taskDirectory: 'tasks' }));
const child = spawn('/Applications/Obsidian.app/Contents/MacOS/Obsidian', [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], { stdio: ['ignore', 'ignore', 'pipe'] });
let browser, stage = 'launch';
const evidence = { at: new Date().toISOString(), vault, version: JSON.parse(await readFile('manifest.json', 'utf8')).version, checks: [] };
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('debug startup timeout')), 30000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', () => { clearTimeout(timer); reject(Error('app exited')); });
    child.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page'); page.setDefaultTimeout(15000);
  stage = 'load';
  await page.waitForFunction(() => window.app?.vault?.getName?.() === 'vault' && window.app?.workspace?.layoutReady, undefined, { timeout: 30000 });
  await page.getByRole('button', { name: 'Trust author and enable plugins', exact: true }).click();
  await page.waitForFunction(() => !!window.app?.plugins?.plugins?.['work-timeline']);
  const restricted = page.locator('.modal').filter({ hasText: 'Restricted mode' });
  if (await restricted.count()) await restricted.locator('.modal-close-button').click();
  await page.waitForFunction(async version => { const p=window.app.plugins.plugins['work-timeline']; return p?.state.pluginVersion===version && !!p.state.lastDailyBackup && await window.app.vault.adapter.exists(p.state.taskDirectory+'/_groups.md') && getComputedStyle(document.querySelector('body')).fontSize; }, evidence.version);
  await page.waitForFunction(() => !!document.querySelector('style[data-plugin="work-timeline"]') || [...document.styleSheets].some(s=>s.ownerNode?.textContent?.includes('.wt-calendar-modal')));
  await page.evaluate(async () => {
    const p = window.app.plugins.plugins['work-timeline'];
    await p.activateView(); await p.addGroup('原生验收');
    window.qaId = await p.addTask({title:'移动测试',notes:'隔离测试正文',groupId:p.groups[0].id,groupName:'原生验收',important:false,urgent:false,todos:[],initialProgress:'',dueDate:null});
    p.updateDraft(window.qaId, '移动后保留草稿');
  });
  evidence.host = await page.evaluate(() => ({ userAgent:navigator.userAgent, version:window.app.plugins.plugins['work-timeline'].manifest.version, byteExactDaily:typeof window.app.plugins.plugins['work-timeline'].store.backupTask==='function' }));
  assert.equal(evidence.host.version, evidence.version); assert.equal(evidence.host.byteExactDaily,true);
  stage = 'move-outside';
  const moved = await page.evaluate(async () => {
    const p = window.app.plugins.plugins['work-timeline'], v = window.app.vault;
    const old = p.taskArchivePath(window.qaId), source = await v.adapter.read(old);
    await v.createFolder('outside'); await v.rename(v.getAbstractFileByPath(old),'outside/task.md');
    return { source, path:'outside/task.md' };
  });
  await page.waitForFunction(() => !window.app.plugins.plugins['work-timeline'].tasks.some(t=>t.id===window.qaId));
  assert.equal(await readFile(join(vault,moved.path),'utf8'),moved.source);
  assert.equal(await page.evaluate(()=>window.app.plugins.plugins['work-timeline'].state.drafts[window.qaId]),'移动后保留草稿');
  await page.evaluate(async () => {const v=window.app.vault; await v.rename(v.getAbstractFileByPath('outside/task.md'),'tasks/移回任务.md');});
  await page.waitForFunction(() => window.app.plugins.plugins['work-timeline'].tasks.some(t=>t.id===window.qaId));
  await page.evaluate(()=>window.app.plugins.plugins['work-timeline'].recordProgress(window.qaId,'移回后正常保存'));
  evidence.checks.push('real vault rename events: remove, preserve draft/source, reimport and save');
  stage = 'damaged-groups';
  const groups = await readFile(join(vault,'tasks/_groups.md'),'utf8');
  await page.evaluate(async () => {
    const p=window.app.plugins.plugins['work-timeline']; p.state.lastDailyBackup=null; await p.saveData(p.state);
    await window.app.plugins.disablePlugin('work-timeline');
    await window.app.vault.adapter.write('tasks/_groups.md','damaged group archive');
    await window.app.plugins.enablePlugin('work-timeline');
    await window.app.plugins.plugins['work-timeline'].activateView();
  });
  assert.equal(await readFile(join(vault,'tasks/_groups.md'),'utf8'),'damaged group archive');
  assert.equal(await page.evaluate(async()=>{try{await window.app.plugins.plugins['work-timeline'].addGroup('不得写入');return false;}catch{return true;}}),true);
  await page.evaluate(async source=>{ const v=window.app.vault;await v.modify(v.getAbstractFileByPath('tasks/_groups.md'),source);},groups);
  await page.waitForFunction(()=>window.app.plugins.plugins['work-timeline'].groups.length===1);
  await page.evaluate(()=>window.app.plugins.plugins['work-timeline'].addGroup('恢复后正常保存'));
  evidence.checks.push('real plugin restart: damaged source preserved, writes paused, repair event resumes');
  stage = 'calendar';
  const hostClose=page.locator('.modal-container:not(:has(.wt-modal)) .modal-close-button');
  while(await hostClose.count()) await hostClose.first().click();
  const cdp = await context.newCDPSession(page);
  for (const appearance of ['light','dark']) {
    await page.evaluate(a=>window.app.plugins.plugins['work-timeline'].setAppearance('monochrome',a),appearance);
    for (const [width,height] of [[1200,800],[1000,600],[700,560]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      const trigger = page.getByRole('button',{name:'截止日历',exact:true});
      await trigger.click();
      const modal = page.locator('.wt-calendar-modal');
      // Navigate to the next six-week month without overriding the native clock.
      for (let n=0;n<12 && await modal.locator('.wt-calendar-day').count()!==42;n++) await modal.getByRole('button',{name:'下个月',exact:true}).click();
      assert.equal(await modal.locator('.wt-calendar-day').count(),42);
      await modal.locator('.wt-calendar-day').last().scrollIntoViewIfNeeded();
      await modal.locator('.wt-calendar-day').last().click();
      await modal.getByRole('button',{name:'关闭截止日历',exact:true}).scrollIntoViewIfNeeded();
      const bounds = await modal.evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,overflow:el.scrollWidth-el.clientWidth};});
      assert.ok(bounds.top>=0 && bounds.bottom<=bounds.height+1 && bounds.overflow<=1);
      await page.screenshot({path:join(output,`calendar-${appearance}-${width}-${height}.png`)});
      await page.keyboard.press('Escape'); await modal.waitFor({state:'detached'});
      assert.equal(await trigger.evaluate(el=>document.activeElement===el),true,'Escape restores calendar trigger focus');
      evidence.checks.push(`real host six-week calendar renderer viewport, Escape/focus: ${appearance} window ${width}x${height}`);
    }
  }
  evidence.result='passed';
  console.log('PASS real Obsidian 0.9.7: file move/draft, damaged-group restart/recovery, six calendar window/appearance and Escape focus checks');
} catch(error) {
  evidence.result='failed';evidence.stage=stage;evidence.error=error.message;process.exitCode=1;
  await browser?.contexts()[0]?.pages()[0]?.screenshot({path:join(output,'failure.png')}).catch(()=>{});
  console.error(`FAIL real Obsidian at ${stage}: ${error.message}`);
} finally {
  await writeFile(join(output,'result.json'),JSON.stringify(evidence,null,2));
  await browser?.close();child.kill('SIGTERM');
}
