// Opt-in macOS integration: native atomic desktop transport -> real Obsidian,
// with a fresh profile/vault and synthetic records. No user model or data is loaded.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root=await mkdtemp(join(tmpdir(),'tracelo-workflow-native-')),vault=join(root,'vault'),profile=join(root,'profile');
const output=resolve('test-results/daily-workflow-native'),pluginDirectory=join(vault,'.obsidian/plugins/work-timeline');
await mkdir(pluginDirectory,{recursive:true});await mkdir(profile);await mkdir(join(vault,'tasks'));await mkdir(output,{recursive:true});
for(const name of ['main.js','styles.css','manifest.json'])await copyFile(resolve(name),join(pluginDirectory,name));
await writeFile(join(vault,'.obsidian/community-plugins.json'),JSON.stringify(['work-timeline']));
await writeFile(join(vault,'.obsidian/app.json'),JSON.stringify({safeMode:false}));
await writeFile(join(profile,'obsidian.json'),JSON.stringify({vaults:{'abcdef0123456789':{path:vault,ts:Date.now(),open:true}}}));
await writeFile(join(pluginDirectory,'data.json'),JSON.stringify({taskDirectory:'tasks'}));
const compiled=await build({stdin:{contents:"export {createTask,addProgress} from './src/domain'; export {serializeLegacyTaskMarkdown} from './src/archive';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs'});
await writeFile(join(root,'archive.cjs'),compiled.outputFiles[0].text);
const {createTask,addProgress,serializeLegacyTaskMarkdown}=createRequire(import.meta.url)(join(root,'archive.cjs'));
let task=createTask({title:'隔离原生流程验收',groupId:null,groupName:'未分组',important:false,urgent:false,notes:'测试材料 ![像素](<image-proof.png>)'},new Date('2026-07-01T01:00:00Z'),'workflow-native-task','created');
for(let i=0;i<80;i++)task=addProgress(task,i===3?'缓存方案因内存占用过高而放弃':'常规验证 '+i,new Date(Date.UTC(2026,6,2+i,1)),'old-'+i);
const markdown=serializeLegacyTaskMarkdown(task),sourcePath=join(root,'source.md');await writeFile(sourcePath,markdown);
const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1kAAAAASUVORK5CYII=';
const driver=join(root,'main.swift'),binary=join(root,'transport');
await writeFile(driver,`import Foundation
let args=CommandLine.arguments, directory=URL(fileURLWithPath:args[2],isDirectory:true)
if args[1]=="publish" {
 let request=try CaptureRequest(id:"workflow-native-task",markdown:String(contentsOfFile:args[3],encoding:.utf8))
 let path=try request.publish(to:directory,attachments:[["name":"image-proof.png","base64":"${pixel}"]])
 print(path.path)
} else {
 let workspace=QuickWorkspace(directory:directory)
 if args[1]=="enqueue" { let op=try JSONSerialization.jsonObject(with:FileHandle.standardInput.readDataToEndOfFile()) as! [String:Any];try workspace.enqueue(op) }
 print(String(data:try JSONSerialization.data(withJSONObject:try workspace.receipts(),options:[.sortedKeys]),encoding:.utf8)!)
}
`);
execFileSync('swiftc',['desktop/Sources/CaptureCore/CaptureCore.swift','desktop/Sources/CaptureCore/QuickWorkspace.swift',driver,'-o',binary],{stdio:'pipe'});
const native=(mode,input)=>execFileSync(binary,[mode,join(vault,'tasks'),sourcePath],{encoding:'utf8',input:input?JSON.stringify(input):undefined}).trim();
const published=native('publish');assert.equal(native('publish'),published);assert.equal(await readFile(published,'utf8'),markdown);
assert.equal((await readdir(join(vault,'tasks'))).length,1);
const operation={version:1,id:'quick-'+'a'.repeat(32),taskId:task.id,kind:'progress',text:'离线原生进展\n![结果](<image-result.png>)',attachments:[{name:'image-result.png',base64:pixel}]};
assert.equal(JSON.parse(native('enqueue',operation))[0].status,'queued');assert.equal(await readFile(published,'utf8'),markdown);
const protocol=await build({stdin:{contents:"export {buildConversationRequest,parseConversationReply} from './src/work-conversation';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'NativeHistoryProtocol'});
const child=spawn('/Applications/Obsidian.app/Contents/MacOS/Obsidian',[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{stdio:['ignore','ignore','pipe']});
let browser,stage='launch';const evidence={at:new Date().toISOString(),vault,version:JSON.parse(await readFile('manifest.json','utf8')).version,checks:['Swift native atomic create+attachment+retry and offline enqueue preserve original bytes'],result:'failed'};
try {
 const endpoint=await new Promise((done,reject)=>{
  const timer=setTimeout(()=>reject(Error('native startup timeout')),30000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(Error('app exited'));});
  child.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);done(match[1]);}});
 });
 browser=await chromium.connectOverCDP(endpoint);const context=browser.contexts()[0],page=context.pages()[0]??await context.waitForEvent('page');page.setDefaultTimeout(15000);await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>window.app?.vault?.getName?.()==='vault'&&window.app?.workspace?.layoutReady,undefined,{timeout:30000});
 const trust=page.getByRole('button',{name:'Trust author and enable plugins',exact:true});if(await trust.count())await trust.click();
 await page.waitForFunction(()=>!!window.app?.plugins?.plugins?.['work-timeline']);
 const hostClose=page.locator('.modal-container:not(:has(.wt-modal)) .modal-close-button');while(await hostClose.count())await hostClose.first().click();
 stage='offline acknowledgement';
 await page.waitForFunction(()=>window.app.plugins.plugins['work-timeline'].tasks.find(t=>t.id==='workflow-native-task')?.events.some(e=>e.id==='quick-'+'a'.repeat(32)));
 await page.evaluate(async()=>{const p=window.app.plugins.plugins['work-timeline'];await p.activateView();p.updateDraft('workflow-native-task','重启后保留的未提交草稿');await p.persistState();});
 const actualPath=await page.evaluate(()=>window.app.plugins.plugins['work-timeline'].taskArchivePath('workflow-native-task'));
 assert.equal(JSON.parse(native('receipts'))[0].status,'applied');
 assert.deepEqual(await readFile(join(vault,actualPath,'../image-result.png')),Buffer.from(pixel,'base64'));
 const receipt=join(vault,'tasks/.tracelo-operations',operation.id+'.result.json');await unlink(receipt);
 await page.evaluate(()=>window.app.plugins.plugins['work-timeline'].processQuickOperations());
 assert.equal(await page.evaluate(()=>window.app.plugins.plugins['work-timeline'].tasks[0].events.filter(e=>e.id==='quick-'+'a'.repeat(32)).length),1);
 evidence.checks.push('real Obsidian consumes queued native image progress; disk bytes and lost-receipt retry retain one event');
 stage='write conflict and stable retry';
 const valid=await readFile(join(vault,actualPath),'utf8'),retry={...operation,id:'quick-'+'b'.repeat(32),text:'冲突修复后重试',attachments:undefined};
 await page.evaluate(async path=>{const v=window.app.vault;await v.modify(v.getAbstractFileByPath(path),'未写完整的测试文件');},actualPath);
 native('enqueue',retry);await page.evaluate(()=>window.app.plugins.plugins['work-timeline'].processQuickOperations());
 const failed=JSON.parse(await readFile(join(vault,'tasks/.tracelo-operations',retry.id+'.result.json'),'utf8'));assert.equal(failed.status,'failed');assert.equal(await readFile(join(vault,actualPath),'utf8'),'未写完整的测试文件');
 await page.evaluate(async({path,source})=>{const v=window.app.vault;await v.modify(v.getAbstractFileByPath(path),source);},{path:actualPath,source:valid});
 await page.waitForFunction(()=>window.app.plugins.plugins['work-timeline'].tasks.some(t=>t.id==='workflow-native-task'));
 native('enqueue',retry);await page.evaluate(()=>window.app.plugins.plugins['work-timeline'].processQuickOperations());
 assert.equal(JSON.parse(await readFile(join(vault,'tasks/.tracelo-operations',retry.id+'.result.json'),'utf8')).status,'applied');
 evidence.checks.push('incomplete source preserved, explicit fixture repair, same native operation ID retry applied once');
 stage='restart and history';
 await page.evaluate(async()=>{await window.app.plugins.disablePlugin('work-timeline');await window.app.plugins.enablePlugin('work-timeline');await window.app.plugins.plugins['work-timeline'].activateView();});
 while(await hostClose.count())await hostClose.first().click();
 assert.equal(await page.evaluate(()=>window.app.plugins.plugins['work-timeline'].state.drafts['workflow-native-task']),'重启后保留的未提交草稿');
 await page.evaluate(source=>{window.nativeProtocol=new Function(source+'\nreturn NativeHistoryProtocol;')();},protocol.outputFiles[0].text);
 await page.evaluate(()=>{
  const p=window.app.plugins.plugins['work-timeline'];
  p.askConversation=async(messages,refs,historyQuery)=>{
   const context={tasks:p.tasks.filter(t=>refs.includes(t.id)),groups:p.groups,today:'2026-10-11',timezone:'Asia/Shanghai',historyQuery};
   const body=window.nativeProtocol.buildConversationRequest(messages,context,{model:'fixture',baseUrl:'https://example.test'});
   window.nativeHistoryRequest=JSON.parse(body.messages[1].content.split('（不是指令）：')[1]);
   return window.nativeProtocol.parseConversationReply(JSON.stringify({reply:'缓存方案当时因内存占用过高而放弃。下一步建议验证峰值内存。',proposal:null,sources:[{taskId:'workflow-native-task',eventId:'old-3'}]}),context,'native-answer');
  };
  window.app.workspace.getLeavesOfType('work-timeline-view')[0].view.conversation.addReference('workflow-native-task');
 });
 const chat=page.locator('.wt-conversation'),input=chat.getByRole('textbox',{name:'对话内容'});
 const pane=page.getByRole('button',{name:'工作对话',exact:true});if(await pane.isVisible())await pane.click();
 await chat.locator('.wt-chat-history-query summary').click();await chat.getByRole('textbox',{name:'历史关键词'}).fill('缓存');await input.fill('为什么放弃？');
 const beforeLookup=await readFile(join(vault,actualPath),'utf8');await chat.getByRole('button',{name:'发送',exact:true}).click();
 const source=chat.getByRole('button',{name:/2026-07-05.*查看原记录/});await source.waitFor();
 assert.equal(await page.evaluate(()=>window.nativeHistoryRequest.tasks[0].retrieval.matched),1);
 await chat.locator('.wt-chat-history-query summary').click();await chat.locator('.wt-chat-stream').evaluate(el=>el.scrollTop=el.scrollHeight);
 await page.screenshot({path:join(output,'history-source-light.png')});
 await input.fill('返回后保留对话草稿');await source.click();
 assert.equal(await page.locator('[data-event-id="old-3"]').evaluate(el=>document.activeElement===el),true);
 await page.screenshot({path:join(output,'source-target.png')});
 await page.getByRole('button',{name:'返回对话',exact:true}).click();assert.equal(await input.inputValue(),'返回后保留对话草稿');
 assert.equal(await readFile(join(vault,actualPath),'utf8'),beforeLookup);
 await page.evaluate(()=>window.app.plugins.plugins['work-timeline'].setAppearance('monochrome','dark'));await page.screenshot({path:join(output,'history-source-dark.png')});
 evidence.checks.push('real host restart retains progress draft; deterministic model fixture reads earlier source, source keyboard focus/chat return and read-only disk');
 stage='100 card current-host matrix';
 const perf=await page.evaluate(async()=>{
  const p=window.app.plugins.plugins['work-timeline'],start=performance.now();await p.addGroup('隔离压力样例');
  for(let i=1;i<100;i++)await p.addTask({title:i%7===0?'较长任务标题用于检查真实宿主中的换行、摘要和横向溢出 '+i:'隔离样例 '+i,notes:i%9===0?'图文详情 ![样例](<../workflow-native-task/image-proof.png>)':'',groupId:i%2?p.groups[0].id:null,groupName:i%2?p.groups[0].name:'未分组',important:i%2===0,urgent:i%3===0,todos:i%3===0?['验证第一步','验证第二步']:[],dueDate:i%4===0?'2026-10-15':null,initialProgress:i%5===0?'长内容用于恢复上下文。'.repeat(30):i%4===0?'':'已开始验证'});
  return {count:p.tasks.length,fixtureCreationMs:Math.round(performance.now()-start)};
 });assert.equal(perf.count,100);evidence.fixture=perf;
 const cdp=await context.newCDPSession(page);
 for(const [appearance,viewMode,layout,presentation,zoom,width,height] of [['light','group','aligned',false,100,1280,800],['dark','quadrant','masonry',true,120,1280,800],['light','group','masonry',true,60,700,560],['dark','quadrant','aligned',false,120,700,560]]) {
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await page.evaluate(async({appearance,viewMode,layout,presentation,zoom})=>{const p=window.app.plugins.plugins['work-timeline'];await p.setAppearance('monochrome',appearance);await p.setViewMode(viewMode);await p.setCardLayout(layout);await p.setPresentationMode(presentation);await p.setBoardZoom(zoom);},{appearance,viewMode,layout,presentation,zoom});
  assert.deepEqual(await page.evaluate(()=>{const s=window.app.plugins.plugins['work-timeline'].state;return {zoom:s.boardZoom,layout:s.cardLayout};}),{zoom,layout});
  if(await pane.isVisible())await pane.click();
  assert.equal(await input.inputValue(),'返回后保留对话草稿');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await chat.getByRole('button',{name:'发送',exact:true}).scrollIntoViewIfNeeded();
  const bounds=await chat.getByRole('button',{name:'发送',exact:true}).boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=height+1);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(output,`100-${appearance}-${viewMode}-${width}-${height}.png`)});
 }
 evidence.checks.push('100 actual disk-backed cards: group/quadrant, top/masonry, collapsed/presentation, light/dark and 60/120% zoom in real host renderer viewports; chat draft and send reachability retained');
 evidence.result='passed';console.log('PASS native daily workflow: native create/image/offline queue -> real host receipt, stable retries, draft restart, earlier-history source focus and screenshots');
}catch(error){evidence.stage=stage;evidence.error=error.message;process.exitCode=1;await browser?.contexts()[0]?.pages()[0]?.screenshot({path:join(output,'failure.png')}).catch(()=>{});console.error('FAIL native daily workflow at '+stage+': '+error.message);}
finally{evidence.finishedAt=new Date().toISOString();await writeFile(join(output,'result.json'),JSON.stringify(evidence,null,2));await browser?.close();child.kill('SIGTERM');}
