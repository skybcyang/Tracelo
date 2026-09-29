import WorkTimelinePlugin from '../../../src/main.ts';
import {createApp,Modal} from './host-adapter.mjs';
const parameters=new URLSearchParams(location.search);
document.body.classList.toggle('theme-dark',parameters.get('theme')!=='light');
document.body.dataset.accent=parameters.get('accent')==='blue'?'blue':'violet';
document.querySelector('#theme').value=document.body.classList.contains('theme-dark')?'dark':'light';
document.querySelector('#accent').value=document.body.dataset.accent;
window.lucide.createIcons({attrs:{'stroke-width':1.7,'aria-hidden':true}});
const app=createApp();
const plugin=new WorkTimelinePlugin(app,{id:'work-timeline',name:'Tracelo',version:'0.9.0'});
await plugin.onload();
for(const name of ['产品研发','日常工作','个人计划'])await plugin.addGroup(name);
const today=new Date();
const dateKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const after=days=>{const d=new Date(today);d.setDate(d.getDate()+days);return dateKey(d);};
const samples=[
  {key:'payment',title:'完成支付模块联调',group:0,important:true,urgent:true,dueDate:after(0),notes:'打通下单、回调验签与退款流程，重点核对重复请求的账单状态。',todos:['支付回调与验签','退款异常场景验证','补齐联调验收记录'],initialProgress:'回调验签已通过，正在补充退款异常场景。重复请求会返回原订单结果。',done:1},
  {key:'onboarding',title:'优化新用户引导',group:0,important:true,urgent:false,dueDate:after(3),notes:'从第一次打开插件开始，让创建任务和记录进展更自然。',todos:['梳理首次使用路径','完成交互原型','小范围可用性验证'],initialProgress:'首次使用路径已缩短到两步，接下来验证创建流程。',done:1},
  {key:'release',title:'整理 0.9.0 发布材料',group:0,important:true,urgent:false,notes:'汇总更新说明、安装步骤和跨平台验证结果。',todos:[],initialProgress:'更新说明已整理，安装步骤还需要复核。'},
  {key:'report',title:'提交本周项目周报',group:1,important:true,urgent:true,dueDate:after(0),todos:['汇总各模块进展','补充风险与依赖','发出最终版本'],initialProgress:'已汇总本周交付与风险，等待补充下周的资源安排。',done:1},
  {key:'feedback',title:'整理客户反馈',group:1,important:false,urgent:true,dueDate:after(1),todos:['归类高频问题','补充复现步骤'],initialProgress:'归纳了五条高频问题，补齐了三条复现路径。',done:1},
  {key:'reading',title:'读完《设计心理学》',group:2,important:false,urgent:false,notes:'记录可以用于日常产品设计的观察。',todos:['阅读第一章','整理可供性与示能符笔记'],initialProgress:'好的设计应该让用户看得见下一步能做什么。',done:1}
];
const ids={};
// Optional creation fields receive successive millisecond timestamps. Wait for
// that short sequence to elapse before simulating a subsequent user action.
async function waitForCreation(id){
  const task=plugin.tasks.find(t=>t.id===id);
  const delay=Math.max(...task.events.map(event=>Date.parse(event.at)))-Date.now()+1;
  if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
}
for(const sample of [...samples].reverse()){
  const group=plugin.groups[sample.group];
  const id=await plugin.addTask({...sample,groupId:group.id,groupName:group.name,dueDate:sample.dueDate||null});ids[sample.key]=id;
  await waitForCreation(id);
  for(const todo of (plugin.tasks.find(t=>t.id===id).todos||[]).slice(0,sample.done||0))await plugin.toggleTaskTodo(id,todo.id,true);
}
const archived=await plugin.addTask({title:'完成工作资料归档',groupId:plugin.groups[1].id,groupName:'日常工作',important:false,urgent:false,todos:[],initialProgress:'资料已归档，抽查备份文件均可打开。'});
await waitForCreation(archived);
await plugin.finishTask(archived);
await plugin.setViewMode(parameters.get('view')==='quadrant'?'quadrant':'group');
await plugin.activateView();
const view=app.workspace.getLeavesOfType('work-timeline-view')[0].view;
const noteTexts={
  weekly:{title:'周报 · 第 40 周',section:'本周推进',body:'支付模块已完成回调验签，正在补充退款与异常场景。新用户引导已简化为两步，交互原型进入验证。',next:'下周安排',nextBody:'完成支付联调验收；组织一次新用户路径体验，汇总观察记录。'},
  payment:{title:'支付模块方案',section:'联调范围',body:'覆盖创建订单、支付回调、验签、退款及账单状态一致性。重复请求需要返回原订单结果。',next:'验收关注点',nextBody:'验证异常回调、网络超时与重复退款。每一步实际推进记录在工作时间线中。'},
  onboarding:{title:'新用户引导',section:'首次使用路径',body:'创建第一项任务，记录第一条进展。减少必填项，把补充信息放在用户需要时。',next:'待验证',nextBody:'检查空状态、创建成功后的反馈，以及再次进入工作区时能否找到上次的任务。'}
};
function showPlugin(){document.querySelector('#plugin-mount').hidden=false;document.querySelector('#note-preview').hidden=true;document.querySelector('#host-view-title').textContent='工作时间线';document.querySelector('#host-view-subtitle').textContent='Tracelo';document.querySelectorAll('.host-tab').forEach(t=>t.classList.toggle('active',t.dataset.host==='plugin'));}
document.querySelectorAll('[data-host=plugin]').forEach(button=>button.addEventListener('click',showPlugin));
document.querySelectorAll('[data-note]').forEach(button=>button.addEventListener('click',()=>{
  const note=noteTexts[button.dataset.note];const target=document.querySelector('#note-preview');target.replaceChildren();
  target.append(Object.assign(document.createElement('p'),{className:'note-breadcrumb',textContent:'工作笔记 / '+note.title}));
  for(const [tag,text] of [['h1',note.title],['h2',note.section],['p',note.body],['h2',note.next],['p',note.nextBody]])target.append(Object.assign(document.createElement(tag),{textContent:text}));
  const back=Object.assign(document.createElement('button'),{className:'note-return',textContent:'返回工作时间线'});back.onclick=showPlugin;target.append(back);
  document.querySelector('#plugin-mount').hidden=true;target.hidden=false;document.querySelector('#host-view-title').textContent=note.title;document.querySelector('#host-view-subtitle').textContent='只读示意笔记';document.querySelectorAll('.host-tab').forEach(t=>t.classList.toggle('active',t.dataset.note===button.dataset.note));
}));
document.querySelector('#toggle-files').onclick=()=>document.body.classList.toggle('files-hidden');
document.querySelector('[data-host=search]').onclick=()=>{showPlugin();document.querySelector('.wt-search input')?.focus();};
document.querySelector('#theme').onchange=e=>document.body.classList.toggle('theme-dark',e.target.value==='dark');
document.querySelector('#accent').onchange=e=>document.body.dataset.accent=e.target.value;
document.querySelector('#host-settings').onclick=()=>{
  const modal=new Modal(app);modal.setTitle('Tracelo 设置');modal.modalEl.classList.add('wt-modal','preview-settings');
  modal.onOpen=()=>{const settings=plugin.settingTabs[0];settings.containerEl=modal.contentEl;settings.display();const close=document.createElement('button');close.textContent='完成';close.className='settings-close';close.onclick=()=>modal.close();modal.contentEl.append(close);};modal.open();
};
const observer=new MutationObserver(()=>{document.querySelector('#task-count').textContent=`· ${plugin.tasks.filter(t=>t.status==='active').length} 项进行中`;});observer.observe(document.querySelector('#plugin-mount'),{childList:true,subtree:true});
document.querySelector('#task-count').textContent='· 6 项进行中';
if(parameters.get('screen')==='create')view.openNewTask();
if(parameters.get('screen')==='detail')document.querySelector(`[data-task-id="${ids.payment}"] .wt-card-open`)?.click();
if(parameters.get('screen')==='calendar')document.querySelector('[aria-label="截止日历"]')?.click();
// Kept local to this review, useful for deterministic UI tests without exposing a real vault.
window.pluginNativePreview={ids};
