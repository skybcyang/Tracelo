// Opt-in provider check: synthetic content only, no real tasks or drafts leave the machine.
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(error.message);process.exitCode=1;});
if(!process.argv[2])throw Error('Pass an existing plugin data.json path; credentials are never printed.');
const data=JSON.parse(await readFile(process.argv[2],'utf8')),config=data.smartCapture;
const bundle=await build({stdin:{contents:'export * from "./src/work-conversation"; export {requestModel,readApiKey,validateApiKey} from "./src/smart-capture"; export {createTask} from "./src/domain";',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const key=config.apiKey?api.validateApiKey(config.apiKey):api.readApiKey(await readFile(config.keyFile,'utf8'));
const task=api.createTask({title:'合成测试：定位相机冷启动',groupId:null,groupName:'未分组',important:false,urgent:false},new Date('2026-10-06T00:00:00Z'),'synthetic-task','synthetic-event');
const context={tasks:[task],groups:[],today:'2026-10-06',timezone:'Asia/Shanghai'};
const transport=async req=>{const r=await fetch(req.url,{method:'POST',headers:req.headers,body:req.body});return {status:r.status,text:await r.text()};};
let messages=[{role:'user',text:'我想排查相机冷启动慢，先帮我列两步排查思路，暂时不要新建或修改任务。',refs:[]}];
const ask=async()=>{
 const source=await api.requestModel(api.buildConversationRequest(messages,context,config),config,key,transport);
 try{return api.parseConversationReply(source,context,crypto.randomUUID());}
 catch(error){console.error('Synthetic response:',source.slice(0,6000));throw error;}
};
const discussion=await ask();assert.equal(discussion.proposal,null);console.log('PASS live discussion does not propose a write');
messages.push({role:'assistant',text:discussion.reply,refs:[]},{role:'user',text:'@合成测试：定位相机冷启动 日志已经采集完成，请追加这条进展，并把截止日期改到本周五。',refs:[task.id]});
const change=await ask();assert.equal(change.proposal?.type,'update');assert.equal(change.proposal.taskId,task.id);assert.ok(change.proposal.actions.some(a=>a.kind==='progress'));assert.ok(change.proposal.actions.some(a=>a.kind==='due'&&a.text==='2026-10-09'));console.log('PASS live multi-turn referenced progress + relative deadline');
messages=[{role:'user',text:'新建一个任务：分析初始化日志。先标注阶段，再比较耗时。不设截止日期。',refs:[]}];
const create=await ask();assert.equal(create.proposal?.type,'create');assert.equal(create.proposal.values.initialProgress,'');assert.equal(create.proposal.values.dueDate,null);assert.ok(create.proposal.values.todos.length);console.log('PASS live create separates future todos from completed progress; no task writes');
