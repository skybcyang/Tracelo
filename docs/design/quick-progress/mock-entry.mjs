import WorkTimelinePlugin from '../../../src/main.ts';
import { createApp, setIcon } from '../../../tests/helpers/obsidian-browser.mjs';
import { mountNewTaskForm } from '../../../src/new-task-form.ts';

// Browser-only host: all archive writes go to the fixture's in-memory Map.
const app=createApp();
const plugin=new WorkTimelinePlugin(app,{id:'work-timeline',name:'Tracelo',version:'0.9.0'});
await plugin.onload();
await plugin.addGroup('产品研发');await plugin.addGroup('日常工作');
const common={groupId:plugin.groups[0].id,groupName:'产品研发',important:true,urgent:false,dueDate:null,todos:[],initialProgress:''};
const login=await plugin.addTask({...common,title:'登录功能联调',notes:'完成登录与鉴权流程联调，覆盖验证码、登录态过期及弱网重试场景。',dueDate:'2026-09-30',todos:['确认登录接口协议','完成登录主流程联调','验证登录态过期与弱网重试','补充联调验收记录'],initialProgress:'登录主流程已跑通，验证码接口返回正常，接下来验证异常场景。'});
const weekly=await plugin.addTask({...common,groupId:plugin.groups[1].id,groupName:'日常工作',title:'整理本周工作进展',notes:'整理本周交付、风险与下周计划，用于周会同步。',todos:['汇总各项目本周交付','补充风险和下周计划'],initialProgress:'已收集各项目进展，待补充风险与下周计划。'});
await plugin.addTask({...common,title:'客户需求方案确认',initialProgress:'第二版方案已发出，等待客户确认排期。'});
await plugin.addTask({...common,title:'验证自动备份',initialProgress:'本地备份验证通过，下一步检查恢复流程。'});
await plugin.addTask({...common,title:'季度项目复盘',initialProgress:'完成数据整理，准备梳理关键决策。'});
const first=plugin.tasks.find(t=>t.id===login);
// Initial fields receive successive millisecond timestamps in buildNewTask.
// Seed checkbox updates only after those initial events, as the existing fixture does.
await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(first.events.at(-1).at)-Date.now()+2)));
await plugin.toggleTaskTodo(login,first.todos[0].id,true);await plugin.toggleTaskTodo(login,first.todos[1].id,true);
plugin.updateDraft(weekly,'已补充两个项目的风险，准备整理下周计划。');
await plugin.activateView();
const view=app.workspace.getLeavesOfType('work-timeline-view')[0].view;
await view.onClose();
const $=id=>document.getElementById(id);
$('card-mount').append(view.contentEl);
let chosen=login,mode='progress',phase='card',selected=0,createDraft=null,createController=null,composing=false,busy=false;
const latest=t=>[...t.events].reverse().find(e=>e.kind==='progress');
function updateMode(){
 $('progress-mode').setAttribute('aria-pressed',String(mode==='progress'));$('create-mode').setAttribute('aria-pressed',String(mode==='create'));
 $('progress-window').hidden=mode!=='progress'||phase==='finished';$('create-window').hidden=mode!=='create'||phase==='finished';$('finished').hidden=phase!=='finished';
}
function finish(saved=false,title='',text=''){
 phase='finished';updateMode();$('finish-label').textContent=saved?'进展已记录':'窗口已收起';$('finish-title').textContent=saved?'继续手头的事。':'草稿已保留。';$('finish-body').textContent=saved?title+'\n'+text:'再次唤起后，可以接着刚才的内容继续写。';$('reopen').focus();
}
view.render=()=>{
 view.contentEl.replaceChildren();if(!chosen)return;
 const task=plugin.tasks.find(t=>t.id===chosen);if(!task)return;
 view.selectedTaskId=chosen;view.expandedTaskId=chosen;
 view.renderCard(view.contentEl,task,task.groupId||'ungrouped');
 $('group-context').textContent=task.groupName+' / 进行中';
 const card=view.contentEl.querySelector('.wt-card');card.draggable=false;
 const textarea=card.querySelector('.wt-card-composer textarea');
 const submit=card.querySelector('.wt-card-composer button[type=submit]');
 const form=card.querySelector('.wt-card-composer');
 if(textarea){
  $('draft-status').textContent=textarea.value?'已恢复此任务的草稿':'草稿会随输入保留';
  submit.disabled=!textarea.value.trim();
  textarea.addEventListener('input',()=>{submit.disabled=!textarea.value.trim();$('draft-status').textContent='草稿已保留'});
  textarea.addEventListener('compositionstart',()=>composing=true);textarea.addEventListener('compositionend',()=>composing=false);
  textarea.addEventListener('keydown',e=>{if(e.isComposing||composing)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish()}else if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();form.requestSubmit()}},true);
  form.addEventListener('submit',e=>{if(composing||busy||!textarea.value.trim()){e.preventDefault();e.stopImmediatePropagation()}},true);
  card.querySelector('.wt-composer-close').onclick=()=>finish();
 }
 updateMode();
};
view.taskRecorded=()=>{};
const record=plugin.recordProgress.bind(plugin);
plugin.recordProgress=async(id,text)=>{
 busy=true;
 try{
  if($('fail').checked){$('fail').checked=false;throw new Error('未能保存，内容已保留。请重试。')}
  await record(id,text);finish(true,plugin.tasks.find(t=>t.id===id).title,text);
 }finally{busy=false}
};
function choose(id){chosen=id;mode='progress';phase='card';$('picker').hidden=true;$('card-mount').hidden=false;view.render();view.contentEl.querySelector('.wt-card-composer textarea')?.focus({preventScroll:true})}
function renderResults(){
 const q=$('search').value.trim().toLowerCase();const tasks=plugin.tasks.filter(t=>t.status==='active'&&[t.title,t.groupName,latest(t)?.text||''].some(s=>s.toLowerCase().includes(q)));
 tasks.sort((a,b)=>Date.parse(latest(b)?.at||b.events[0].at)-Date.parse(latest(a)?.at||a.events[0].at));
 selected=Math.max(0,Math.min(selected,tasks.length-1));$('results').replaceChildren();
 tasks.forEach((t,i)=>{const button=document.createElement('button');button.className=i===selected?'selected':'';const top=document.createElement('span');top.className='result-top';const title=document.createElement('strong');title.textContent=t.title;const meta=document.createElement('small');meta.textContent=plugin.state.drafts[t.id]?.trim()?'有草稿':t.groupName;top.append(title,meta);const summary=document.createElement('span');summary.className='result-summary';summary.textContent=latest(t)?.text||'还没有记录进展';button.append(top,summary);button.onclick=()=>choose(t.id);$('results').append(button)});
 if(!tasks.length)$('results').textContent='没有匹配的任务，试试更短的关键词。';return tasks;
}
function picker(){if(busy)return;mode='progress';phase='picker';updateMode();$('picker').hidden=false;$('card-mount').hidden=true;$('search').value='';selected=0;renderResults();$('search').focus()}
function create(){if(busy)return;mode='create';phase='create';updateMode();$('create-mount').replaceChildren();createController=mountNewTaskForm($('create-mount'),{groups:plugin.groups,draft:createDraft,isWin:!/Mac/.test(navigator.platform),setIcon,onChange:draft=>createDraft=draft,onCancel:()=>finish(),onSubmit:async values=>{const id=await plugin.addTask(values);createDraft=null;choose(id)}});createController.focus()}
$('create-mode').onclick=create;$('progress-mode').onclick=()=>{if(createController?.isSaving()||busy)return;mode='progress';phase='card';choose(chosen)};
$('switch-task').onclick=picker;$('search').oninput=()=>{selected=0;renderResults()};
$('search').onkeydown=e=>{if(e.isComposing)return;const tasks=renderResults();if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();selected=(selected+(e.key==='ArrowDown'?1:-1)+Math.max(1,tasks.length))%Math.max(1,tasks.length);renderResults()}else if(e.key==='Enter'&&tasks[selected])choose(tasks[selected].id)};
$('close').onclick=()=>{if(!busy)finish()};$('reopen').onclick=()=>mode==='create'?create():choose(chosen);
$('theme').onclick=()=>{const dark=document.body.classList.toggle('theme-dark');$('theme').textContent=dark?'浅色外观':'深色外观'};
document.addEventListener('keydown',e=>{if(e.key!=='Escape'||e.isComposing||composing||busy||createController?.isSaving())return;if(document.querySelector('.modal-container'))return;e.preventDefault();if(phase!=='finished')finish()});
// The underlying plugin card/form operations remain the actual implementation.
view.render();
if(new URLSearchParams(location.search).get('mode')==='create')create();
