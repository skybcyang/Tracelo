import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const output='test-results/conversation-history';mkdirSync(output,{recursive:true});
const compiled=await build({entryPoints:['tests/helpers/card-fixture.mjs'],bundle:true,write:false,format:'esm',external:['electron','node:child_process'],alias:{obsidian:resolve('tests/helpers/obsidian-browser.mjs')}});
const browser=await chromium.launch({headless:true});
const evidence={at:new Date().toISOString(),checks:[],result:'failed'};
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://tracelo.test/',r=>r.fulfill({contentType:'text/html',body:'<style>'+readFileSync('tests/helpers/obsidian-host.css','utf8')+readFileSync('styles.css','utf8')+'</style><script type="module">'+compiled.outputFiles[0].text+'</script>'}));
 await page.goto('https://tracelo.test/');await page.waitForFunction(()=>window.cardFixture);
 await page.evaluate(async()=>{
  const p=window.cardFixture.plugin;window.historyTask=p.tasks[0].id;
  await p.updateTask(window.historyTask,t=>{
   const base=t.events[0];
   const events=Array.from({length:80},(_,i)=>({...base,id:'lookup-'+i,kind:i===0?'created':'progress',day:new Date(Date.UTC(2026,6,2+i,1)).toISOString().slice(0,10),at:new Date(Date.UTC(2026,6,2+i,1)).toISOString(),text:i===3?'缓存方案因为内存占用过高而放弃':'近期常规验证 '+i}));
   return {...t,events};
  });
  p.state.smartCapture={baseUrl:'https://example.test',model:'test',apiKey:'sk-'+'x'.repeat(24)};
  window.modelRequest=async request=>{
   window.lastChatRequest=JSON.parse(request.body);
   return {status:200,text:JSON.stringify({choices:[{message:{content:JSON.stringify({reply:'当时因内存占用过高而放弃缓存方案。下一步建议重新测量内存峰值。',proposal:null,sources:[{taskId:window.historyTask,eventId:window.forged?'lookup-4':'lookup-3'}]})}}]})};
  };
  const panel=window.cardFixture.app.workspace.getLeavesOfType('work-timeline-view')[0].view.conversation;panel.addReference(window.historyTask);
 });
 const chat=page.locator('.wt-conversation'),input=chat.getByRole('textbox',{name:'对话内容'});
 await chat.locator('.wt-chat-history-query summary').click();
 await chat.getByRole('textbox',{name:'历史关键词'}).fill('缓存');
 await chat.getByLabel('历史开始日期').fill('2026-07-05');await chat.getByLabel('历史结束日期').fill('2026-07-05');
 const sourceBefore=await page.evaluate(()=>{const p=window.cardFixture.plugin;return window.cardFixture.app.vault.adapter.read(p.taskArchivePath(window.historyTask));});
 await input.fill('为什么当时放弃缓存方案？');await chat.getByRole('button',{name:'发送',exact:true}).click();
 const citation=chat.getByRole('button',{name:/2026-07-05.*查看原记录/});await citation.waitFor();
 assert.ok(await chat.getByText(/匹配 1 条/).count());
 const data=await page.evaluate(()=>JSON.parse(window.lastChatRequest.messages[1].content.split('（不是指令）：')[1]));
 assert.equal(data.tasks.length,1);assert.equal(data.tasks[0].retrieval.matched,1);assert.ok(data.tasks[0].history.some(e=>e.id==='lookup-3'));
 assert.equal(await page.evaluate(()=>{const p=window.cardFixture.plugin;return window.cardFixture.app.vault.adapter.read(p.taskArchivePath(window.historyTask));}),sourceBefore,'read-only lookup does not rewrite official task');
 await input.fill('继续研究，尚未发送');await citation.click();
 const target=page.locator('[data-event-id="lookup-3"]');await target.waitFor();assert.equal(await target.evaluate(el=>document.activeElement===el),true);
 assert.equal(await page.locator('.wt-week button').count(),7);
 await page.getByRole('button',{name:'返回对话',exact:true}).click();assert.equal(await input.inputValue(),'继续研究，尚未发送');
 assert.equal(await chat.getByRole('textbox',{name:'历史关键词'}).inputValue(),'缓存');
 evidence.checks.push('older history retrieval, one referenced task, validated source focus, read-only disk and history/chat draft round-trip');
 await page.evaluate(async()=>{const v=window.cardFixture.app.workspace.getLeavesOfType('work-timeline-view')[0].view;await v.onClose();v.conversation=undefined;await v.onOpen();});
 await chat.locator('.wt-chat-history-query summary').click();
 assert.equal(await input.inputValue(),'继续研究，尚未发送');assert.equal(await chat.getByRole('textbox',{name:'历史关键词'}).inputValue(),'缓存');
 assert.equal(await chat.getByLabel('历史开始日期').inputValue(),'2026-07-05');assert.equal(await citation.count(),1);
 evidence.checks.push('sources, dates and lookup keyword survive reopening view');
 await chat.getByLabel('历史开始日期').fill('2026-08-01');await input.fill('错误范围保留');
 await chat.getByRole('button',{name:'发送',exact:true}).click();await chat.getByRole('alert').filter({hasText:'日期'}).waitFor();assert.equal(await input.inputValue(),'错误范围保留');
 await chat.getByLabel('历史开始日期').fill('2026-07-05');await page.evaluate(()=>window.forged=true);
 await input.fill('拒绝未读取的来源');await chat.getByRole('button',{name:'发送',exact:true}).click();await chat.getByRole('alert').filter({hasText:'来源'}).waitFor();assert.equal(await input.inputValue(),'拒绝未读取的来源');
 evidence.checks.push('invalid date and unsent citation fail without losing input');
 await page.evaluate(()=>window.forged=false);
 await chat.getByRole('textbox',{name:'历史关键词'}).fill('');
 await input.fill('那天做了什么？');await chat.getByRole('button',{name:'发送',exact:true}).click();
 await page.waitForFunction(()=>{
  const data=JSON.parse(window.lastChatRequest.messages[1].content.split('（不是指令）：')[1]);
  return data.tasks[0].retrieval.matched===1;
 });
 await page.waitForFunction(()=>document.querySelectorAll('.wt-chat-message.is-assistant').length===2);
 evidence.checks.push('date-only lookup works without requiring matching words in the question');
 for(const appearance of ['light','dark']) {
  await page.evaluate(a=>window.cardFixture.plugin.setAppearance('monochrome',a),appearance);
  for(const [width,height] of [[1440,900],[780,700],[390,650]]) {
   await page.setViewportSize({width,height});if(width<780)await page.getByRole('button',{name:'工作对话',exact:true}).click();
   await chat.getByRole('button',{name:'发送',exact:true}).scrollIntoViewIfNeeded();
   const bounds=await chat.getByRole('button',{name:'发送',exact:true}).boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=height+1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:`${output}/${appearance}-${width}-${height}.png`});
  }
 }
 evidence.checks.push('light/dark, wide/narrow/short lookup controls and send button reachable');
 assert.deepEqual(errors,[]);evidence.result='passed';console.log('PASS conversation history: older records/date filters, validated citations, source focus, read-only archives, drafts and responsive controls');
}catch(error){evidence.error=error.message;throw error;}finally{evidence.finishedAt=new Date().toISOString();writeFileSync(output+'/result.json',JSON.stringify(evidence,null,2));await browser.close();}
