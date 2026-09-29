// An isolated design prototype. All records below are fictional and kept in memory.
// Native controls and CSS motion explore interaction patterns; no React library is claimed.
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const ib = (name,label,action,extra='') => `<button class="icon-btn ${action==='mobile-menu'?'mobile-menu':''}" type="button" aria-label="${escape(label)}" title="${escape(label)}" data-action="${action}" ${extra}>${icon(name)}</button>`;
const btn = (label, action, name='', kind='', extra='') => `<button class="btn ${kind}" type="button" data-action="${action}" ${extra}>${name?icon(name):''}${label}</button>`;
const TODAY = '2026-09-29';
const app = $('#app');
const panel = $('#panel');
let groups = [
  {id:'product', name:'产品研发', icon:'layers-2', color:'#548877'},
  {id:'work', name:'日常工作', icon:'briefcase-business', color:'#6686a6'},
  {id:'personal', name:'个人计划', icon:'sprout', color:'#a48b62'},
];
const quadrants = [
  {id:'do',name:'重要且紧急',desc:'优先处理',icon:'flame',color:'#b76769',style:'urgent'},
  {id:'plan',name:'重要不紧急',desc:'安排时间',icon:'calendar-clock',color:'#598d7b',style:'plan'},
  {id:'delegate',name:'不重要但紧急',desc:'尽快推进',icon:'timer',color:'#b3945e',style:'due'},
  {id:'later',name:'不重要不紧急',desc:'留待以后',icon:'coffee',color:'#8b8797',style:''},
];
const todo = (title,done=false) => ({title,done});
let tasks = [
  {id:'payment',title:'完成支付模块联调',group:'product',q:'do',icon:'credit-card',due:TODAY,notes:'打通支付下单、回调验签与退款流程。重点关注异常回调和重复请求，保证账单状态一致。',todos:[todo('支付回调与验签',true),todo('退款异常场景验证'),todo('补齐联调验收记录')],status:'active',attachments:[]},
  {id:'onboarding',title:'优化新用户引导',group:'product',q:'plan',icon:'route',due:'2026-10-02',notes:'从用户第一次打开插件开始，让创建第一项任务、记录第一条进展更自然。',todos:[todo('梳理首次使用路径',true),todo('设计空状态文案',true),todo('完成交互原型'),todo('小范围可用性验证')],status:'active',attachments:[]},
  {id:'release',title:'整理 0.9.0 发布材料',group:'product',q:'plan',icon:'package-check',due:'',notes:'汇总更新说明、安装步骤和跨平台验证结果。',todos:[],status:'active',attachments:[]},
  {id:'report',title:'提交本周项目周报',group:'work',q:'do',icon:'notebook-pen',due:TODAY,notes:'汇总本周交付、风险与下周安排。',todos:[todo('汇总各模块进展',true),todo('补充风险与依赖'),todo('发出最终版本')],status:'active',attachments:[]},
  {id:'feedback',title:'整理客户反馈',group:'work',q:'delegate',icon:'messages-square',due:'2026-09-30',notes:'把零散反馈归并到实际使用场景，明确问题优先级。',todos:[todo('归类高频问题',true),todo('补充复现步骤')],status:'active',attachments:[]},
  {id:'reading',title:'读完《设计心理学》',group:'personal',q:'later',icon:'book-open',due:'',notes:'记录那些可以用到日常产品设计中的观察。',todos:[todo('阅读第一章',true),todo('整理可供性与示能符笔记'),todo('对照自己的产品做一次检查')],status:'active',attachments:[]},
  {id:'backup',title:'完成工作资料归档',group:'work',q:'plan',icon:'archive',due:'2026-09-28',notes:'将阶段性资料归档，整理目录与检索入口。',todos:[todo('整理目录',true),todo('检查备份',true)],status:'completed',attachments:[]},
  {id:'old',title:'旧版快捷窗口实验',group:'product',q:'later',icon:'app-window',due:'',notes:'保留实验记录，后续采用统一表单方案。',todos:[],status:'closed',attachments:[]},
];
let events = [
  {id:'e1',task:'payment',day:TODAY,time:'14:32',type:'进展',text:'回调验签已通过，正在补充退款异常场景。重复请求会返回原订单结果。'},
  {id:'e2',task:'onboarding',day:TODAY,time:'13:48',type:'进展',text:'把首次使用路径缩短到两步。空状态文案已更新，下一步验证创建流程。'},
  {id:'e3',task:'backup',day:TODAY,time:'11:26',type:'完成任务',text:'资料已归档，抽查备份文件均可正常打开。'},
  {id:'e4',task:'report',day:TODAY,time:'10:15',type:'进展',text:'已汇总本周交付与风险，等待补充下周的资源安排。'},
  {id:'e5',task:'feedback',day:TODAY,time:'09:40',type:'进展',text:'归纳了五条高频问题，补齐了三条复现路径。'},
  {id:'e6',task:'payment',day:'2026-09-28',time:'16:20',type:'进展',text:'支付下单接口联调完成，补齐了失败与超时的状态处理。'},
  {id:'e7',task:'payment',day:'2026-09-28',time:'10:08',type:'待办变更',text:'已完成「支付回调与验签」。'},
  {id:'e8',task:'payment',day:'2026-09-26',time:'15:10',type:'创建任务',text:'创建任务，归入产品研发，设为重要且紧急。'},
  {id:'e9',task:'reading',day:'2026-09-28',time:'21:35',type:'进展',text:'读完第一章。好的设计应该让用户看得见下一步能做什么。'},
  {id:'e10',task:'release',day:'2026-09-28',time:'17:10',type:'进展',text:'更新说明已整理，macOS 和 Windows 的安装步骤还需要复核。'},
  {id:'e11',task:'old',day:'2026-09-27',time:'18:20',type:'异常关闭',text:'独立维护成本较高，改为与插件共用完整新建表单。'},
];
let state = {page:'board',view:'group',group:'all',day:TODAY,sort:'recent',filter:'all',theme:'light',zoom:100,columns:3,mobileTimeline:false,showDetails:true};
const drafts = new Map();
let createDraft = {title:'',notes:'',group:'',q:'later',due:'',todos:[],initial:'',attachments:[],icon:'circle-dot'};
let currentTask = null;
let modalMode = '';
let selectedQuick = 'payment';
let toastTimer;
let returnFocus;
let pendingImport = null;
let mockMinute = 14 * 60 + 32;
const findTask = id => tasks.find(t=>t.id===id);
const groupOf = t => groups.find(g=>g.id===t.group) || {id:'',name:'未分组',icon:'inbox',color:'#8a8594'};
const quadrantOf = t => quadrants.find(q=>q.id===t.q) || quadrants[3];
const historyOf = id => events.filter(e=>e.task===id).sort((a,b)=>(b.day+b.time).localeCompare(a.day+a.time));
const latest = t => historyOf(t.id).find(e=>e.type==='进展');
const lastStamp = t => {const e=historyOf(t.id)[0];return e?e.day+e.time:'';};
const activeTasks = () => tasks.filter(t=>t.status==='active');
const fmtDay = (day,long=false) => {const d = new Date(day+'T12:00:00');return long?`${d.getMonth()+1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`:`${d.getMonth()+1}月${d.getDate()}日`;};
const relative = day => day===TODAY?'今天':day==='2026-09-28'?'昨天':fmtDay(day);
const option = (value,label,selected) => `<option value="${escape(value)}" ${value===selected?'selected':''}>${escape(label)}</option>`;
const groupOptions = selected => option('','未分组',selected)+groups.map(g=>option(g.id,g.name,selected)).join('');
const qOptions = selected => quadrants.map(q=>option(q.id,q.name,selected)).join('');
const refreshIcons = () => window.lucide.createIcons({attrs:{'stroke-width':1.65,'aria-hidden':true}});
function notify(message){
  const toast=$('#toast');
  (panel.open?panel:document.body).append(toast);
  toast.innerHTML=icon('check')+escape(message);refreshIcons();toast.classList.add('visible');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),2600);
}
function addEvent(id,type,text){mockMinute++;events.unshift({id:crypto.randomUUID(),task:id,day:TODAY,time:`${String(Math.floor(mockMinute/60)).padStart(2,'0')}:${String(mockMinute%60).padStart(2,'0')}`,type,text});}
function duePill(t){if(!t.due)return '';const overdue=t.due<TODAY&&t.status==='active';return `<span class="pill ${overdue?'urgent':t.due===TODAY?'due':''}">${icon('calendar-days')}${overdue?'已逾期':t.due===TODAY?'今天截止':fmtDay(t.due)}</span>`;}
function navItem(page,label,name,count){return `<button class="nav-item ${state.page===page?'active':''}" data-action="navigate" data-page="${page}" ${state.page===page?'aria-current="page"':''}>${icon(name)}<span>${label}</span>${count!==undefined?`<span class="count">${count}</span>`:''}</button>`;}
function sidebar(){return `<aside class="sidebar" aria-label="主导航">
  <div class="brand"><span class="brand-mark">${icon('waypoints')}</span><div><strong>Tracelo</strong><div class="workspace-label">个人工作空间</div></div></div>
  <button class="search-launch" data-action="search">${icon('search')}<span>搜索任务与进展</span><kbd>⌘ K</kbd></button>
  <nav class="nav-group">${navItem('board','任务看板','layout-dashboard',activeTasks().length)}${navItem('timeline','每日时间线','history')}${navItem('archive','已结束','circle-check',tasks.filter(t=>t.status!=='active').length)}</nav>
  <div><div class="spread side-label"><span>我的分组</span>${ib('plus','管理分组','groups')}</div><div class="nav-group">${groups.map(g=>`<button class="nav-item ${state.group===g.id&&state.page==='board'?'active':''}" data-action="filter-group" data-group="${g.id}">${icon(g.icon)}<span>${escape(g.name)}</span><span class="count">${activeTasks().filter(t=>t.group===g.id).length}</span></button>`).join('')}<button class="nav-item ${state.group===''&&state.page==='board'?'active':''}" data-action="filter-group" data-group="">${icon('inbox')}<span>未分组</span><span class="count">${activeTasks().filter(t=>!t.group).length}</span></button></div></div>
  <div class="side-bottom"><div class="nav-group"><button class="nav-item" data-action="transfer">${icon('arrow-right-left')}<span>导入与导出</span></button>${navItem('settings','设置','settings-2')}</div><div class="local-status"><span class="dot"></span>本地工作，随时记录</div><div class="profile row"><div class="avatar">S</div><div><strong>我的 Obsidian</strong><br><small>个人工作空间</small></div>${ib('sun-moon','切换深浅色','theme')}</div></div>
</aside>`;}
const pageNames = {board:'任务看板',timeline:'每日时间线',archive:'已结束',settings:'设置'};
function render(){
  const scroll=$('.workspace')?.scrollTop||0;
  document.documentElement.dataset.theme=state.theme;
  app.innerHTML=`<div class="shell">${sidebar()}<main class="main ${state.mobileTimeline?'show-timeline':''}">
  <header class="topbar"><div class="breadcrumb">${ib('menu','打开导航','mobile-menu')}<span class="crumb-root">工作空间</span>${icon('chevron-right')}<span>${pageNames[state.page]}</span></div><div class="top-actions"><span class="mock-label">交互原型</span>${btn('<span class="quick-label">快捷记录</span>','quick','zap','ghost quick-entry')}<span class="separator"></span>${ib('search','搜索','search')}${btn('新建任务','create','plus','primary')}</div></header>
  <div class="work-area"><section class="workspace" aria-label="${pageNames[state.page]}">${state.page==='board'?boardPage():state.page==='timeline'?timelinePage():state.page==='archive'?archivePage():settingsPage()}</section>${state.page==='board'?timelineRail():''}</div></main></div>`;
  if(['board','timeline'].includes(state.page)){
    const due=activeTasks().filter(t=>t.due===state.day);
    if(due.length)$('.timeline-list',app)?.insertAdjacentHTML('afterbegin',`<div class="daily-due"><div class="daily-due-label">${icon('calendar-clock')}${state.day===TODAY?'今天截止':'当日截止'} <span>${due.length}</span></div>${due.map(t=>`<button data-action="detail" data-id="${t.id}">${escape(t.title)}${icon('chevron-right')}</button>`).join('')}</div>`);
  }
  refreshIcons();
  $('.workspace').scrollTop=scroll;
  bindDrag();
}
function boardPage(){
  let list=activeTasks().filter(t=>(state.group==='all'||t.group===state.group)&&(state.filter==='all'||(state.filter==='due'?t.due&&t.due<=TODAY:t.q==='do')));
  list.sort((a,b)=>state.sort==='title'?a.title.localeCompare(b.title,'zh-CN'):state.sort==='due'?(a.due||'9999').localeCompare(b.due||'9999'):lastStamp(b).localeCompare(lastStamp(a)));
  const heading=state.group==='all'?'让工作，持续向前。':groups.find(g=>g.id===state.group)?.name||'未分组';
  const due=activeTasks().filter(t=>t.due===TODAY).length;
  let columns=state.view==='quadrant'?quadrants:groups.concat(activeTasks().some(t=>!t.group)||state.group===''?[{id:'',name:'未分组',color:'#8a8594',icon:'inbox'}]:[]);
  if(state.group!=='all'&&state.view==='group')columns=columns.filter(g=>g.id===state.group);
  return `<div class="page-heading spread"><div><h1>${escape(heading)}</h1><p>${fmtDay(TODAY,true)}<span style="margin:0 9px;color:var(--line)">/</span>${activeTasks().length} 项进行中，${due} 项今天截止</p></div><div class="heading-right"><div class="segmented mobile-tabs"><button class="active" data-action="mobile-view" data-value="board">任务</button><button data-action="mobile-view" data-value="timeline">时间线</button></div>${btn('管理分组','groups','folder-cog','ghost')}</div></div>
  <div class="view-toolbar"><div class="segmented" aria-label="看板视图"><button class="${state.view==='group'?'active':''}" data-action="view" data-value="group" aria-pressed="${state.view==='group'}">${icon('columns-3')}分组</button><button class="${state.view==='quadrant'?'active':''}" data-action="view" data-value="quadrant" aria-pressed="${state.view==='quadrant'}">${icon('grid-2x2')}四象限</button></div><div class="toolbar-end"><select aria-label="排序" data-change="sort" class="sort-select">${option('recent','最近更新',state.sort)}${option('due','截止日期',state.sort)}${option('title','任务名称',state.sort)}</select><select aria-label="筛选任务" data-change="filter">${option('all','全部任务',state.filter)}${option('due','今天到期',state.filter)}${option('urgent','重要紧急',state.filter)}</select><select aria-label="看板缩放" data-change="zoom">${[80,90,100,110,120].map(n=>option(n,`${n}%`,state.zoom)).join('')}</select></div></div>
  ${state.group!=='all'?`<div class="selection-bar"><span>正在查看${escape(heading)}</span>${btn('查看全部','all-groups')}</div>`:''}
  <div class="${state.view==='quadrant'?'quadrant-board':'board'}" data-columns="${state.columns}" style="zoom:${state.zoom/100}">${columns.map(g=>{const contents=list.filter(t=>state.view==='quadrant'?t.q===g.id:t.group===g.id);return `<section class="board-column" data-drop="${g.id}" aria-label="${escape(g.name)}"><div class="column-heading" style="--group:${g.color}"><span class="dot"></span><span>${escape(g.name)}</span><span class="count">${contents.length}</span>${state.view==='quadrant'?`<span class="quadrant-description">${g.desc}</span>`:''}${ib('plus',`在${g.name}新建任务`,'create',`data-context="${g.id}"`)}</div><div class="card-stack">${contents.map(card).join('')}</div><button class="column-add" data-action="create" data-context="${g.id}">${icon('plus')}新建任务</button></section>`;}).join('')}</div>
  ${!list.length?`<div class="empty">${icon('inbox')}<h3>这里还没有任务</h3><p>调整筛选，或新建一项任务开始记录。</p></div>`:''}
  <div class="board-note">${icon('mouse-pointer-2')}点击任务查看详情与历史，拖动卡片可调整${state.view==='group'?'分组':'四象限'}。</div>`;
}
function card(t){const g=groupOf(t),q=quadrantOf(t),p=latest(t),done=t.todos.filter(i=>i.done).length;return `<article class="task-card" draggable="true" data-id="${t.id}" style="--group:${g.color}">
  <div class="card-title-row"><span class="task-icon">${icon(t.icon)}</span><button class="card-title" data-action="detail" data-id="${t.id}">${escape(t.title)}</button>${ib('ellipsis','任务操作','detail',`data-id="${t.id}"`)}</div>
  <div class="card-badges">${state.view==='group'?`<span class="pill ${q.style}">${icon(q.icon)}${q.name}</span>`:`<span class="pill">${escape(g.name)}</span>`}${duePill(t)}</div>
  ${state.showDetails&&t.notes?`<p class="card-excerpt">${escape(t.notes)}</p>`:''}
  ${p?`<div class="progress-preview"><div class="progress-time">最新进展<span style="margin:0 6px">·</span>${relative(p.day)} ${p.time}</div><p>${escape(p.text)}</p></div>`:''}
  ${t.todos.length?`<div class="todo-mini">${t.todos.slice(0,3).map((item,i)=>`<label class="todo-line ${item.done?'checked':''}"><input type="checkbox" ${item.done?'checked':''} data-change="todo" data-id="${t.id}" data-index="${i}"><span>${escape(item.title)}</span></label>`).join('')}${t.todos.length>3?`<button class="text-btn" style="text-align:left" data-action="detail" data-id="${t.id}">查看全部 ${t.todos.length} 项待办</button>`:''}</div>`:''}
  <div class="card-bottom"><span class="completion">${icon(t.todos.length?'circle-check':'clock-3')}${t.todos.length?`${done}/${t.todos.length} 项完成`:'持续记录中'}</span><button data-action="progress" data-id="${t.id}">${icon('plus')}记录进展</button></div></article>`;}
function weekDays(){let d=new Date(state.day+'T12:00:00');d.setDate(d.getDate()-(d.getDay()+6)%7);return Array.from({length:7},(_,i)=>{const date=new Date(d);date.setDate(date.getDate()+i);const iso=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;return `<button class="day-button ${state.day===iso?'active':''} ${events.some(e=>e.day===iso)?'has-events':''}" data-action="day" data-day="${iso}" aria-label="${fmtDay(iso,true)}" aria-pressed="${state.day===iso}"><span>${'一二三四五六日'[i]}</span><b>${date.getDate()}</b><span class="day-dot"></span></button>`;}).join('');}
function dateNav(){return `<div class="date-navigation"><strong>${fmtDay(state.day,true)}</strong><div class="row" style="gap:3px">${ib('chevron-left','前一天','previous-day')}<button class="text-btn" data-action="today">今天</button>${ib('chevron-right','后一天','next-day')}</div></div>`;}
function eventMarkup(e,dates=false){const t=findTask(e.task);if(!t)return '';const g=groupOf(t);return `<article class="timeline-event ${['完成任务','创建任务','重新打开'].includes(e.type)?'lifecycle':''}" data-event="${e.id}"><div class="event-meta"><time>${dates?relative(e.day)+' ':''}${e.time}</time><span class="event-type">${escape(e.type)}</span></div><button class="event-title" data-action="detail" data-id="${t.id}">${escape(t.title)}</button><p class="event-copy">${escape(e.text)}</p><div class="event-group" style="--group:${g.color}"><span class="dot"></span>${escape(g.name)}</div></article>`;}
function dayEvents(){return events.filter(e=>e.day===state.day).sort((a,b)=>b.time.localeCompare(a.time));}
function timelineRail(){const list=dayEvents();return `<aside class="timeline-rail" aria-label="每日时间线"><div class="timeline-head"><div class="spread"><div class="timeline-title row">${icon('history')}每日时间线</div><div class="row">${btn('返回任务','mobile-back','','ghost mobile-tabs')}${ib('expand','打开完整时间线','timeline-full')}</div></div>${dateNav()}<div class="week-strip">${weekDays()}</div></div><div class="rail-summary"><span>${list.length} 条记录</span><span><b>${list.filter(e=>e.type==='完成任务').length}</b> 项完成</span></div><div class="timeline-list">${list.length?list.map(e=>eventMarkup(e)).join(''):`<div class="empty">${icon('notebook-pen')}<h3>这一天还没有记录</h3><p>每一步进展，都会留在这里。</p></div>`}</div><div class="rail-foot">${icon('lock-keyhole')}记录按时间留存，变化有迹可循</div></aside>`;}
function timelinePage(){return `<div class="page-heading spread"><div><h1>每日时间线</h1><p>每一次推进，都有迹可循。</p></div>${btn('记录进展','quick','plus')}</div><div class="full-timeline">${dateNav()}<div class="week-strip">${weekDays()}</div><div class="timeline-list">${dayEvents().length?dayEvents().map(e=>eventMarkup(e)).join(''):'<div class="empty"><h3>这一天还没有记录</h3><p>切换日期查看其他工作记录。</p></div>'}</div></div>`;}
function archivePage(){const list=tasks.filter(t=>t.status!=='active');return `<div class="page-heading"><h1>已经走过的路。</h1><p>${list.length} 项已结束任务，完整保留进展与上下文。</p></div><div class="archive-list">${list.map(t=>`<div class="archive-row"><span class="task-icon" style="--group:${groupOf(t).color}">${icon(t.icon)}</span><div><button class="event-title" data-action="detail" data-id="${t.id}">${escape(t.title)}</button><p>${escape(groupOf(t).name)} · ${fmtDay(historyOf(t.id)[0]?.day||TODAY)}结束</p></div><div class="row"><span class="pill ${t.status==='completed'?'done':''}">${t.status==='completed'?'已完成':'异常关闭'}</span>${btn('重新打开','reopen','rotate-ccw','',`data-id="${t.id}"`)}</div></div>`).join('')||'<div class="empty"><h3>还没有已结束的任务</h3><p>完成后的任务会出现在这里。</p></div>'}</div>`;}
function settingsPage(){return `<div class="page-heading"><h1>你的工作方式。</h1><p>让 Tracelo 更贴合你的日常习惯。</p></div><div class="settings-layout">
  <section class="settings-section"><h3>外观与布局</h3><div class="settings-surface"><div class="setting-row"><div><h4>界面外观</h4><p>深浅色在整个工作空间保持一致。</p></div><div class="segmented">${['light','dark'].map(mode=>`<button data-action="set-theme" data-value="${mode}" class="${state.theme===mode?'active':''}">${icon(mode==='light'?'sun':'moon')}${mode==='light'?'浅色':'深色'}</button>`).join('')}</div></div><div class="setting-row"><div><h4>分组列数</h4><p>窄窗口会自动减少列数，确保任务内容可读。</p></div><select aria-label="分组列数" data-change="columns">${option(2,'两列',state.columns)}${option(3,'三列',state.columns)}</select></div><div class="setting-row"><div><h4>卡片详情摘要</h4><p>在卡片中显示任务说明，完整内容始终保留在详情中。</p></div><button class="switch" role="switch" aria-label="卡片详情摘要" aria-checked="${state.showDetails}" data-action="toggle-details"></button></div><div class="setting-row"><div><h4>看板缩放</h4><p>只调整任务区域，不影响导航与时间线。</p></div><select aria-label="看板缩放" data-change="zoom">${[80,90,100,110,120].map(n=>option(n,n+'%',state.zoom)).join('')}</select></div></div></section>
  <section class="settings-section"><h3>任务与记录</h3><div class="settings-surface"><div class="setting-row"><div><h4>任务分组</h4><p>调整名称、顺序和图标。</p></div>${btn('管理分组','groups','folder-cog')}</div><div class="setting-row"><div><h4>任务目录</h4><p>任务、材料和历史记录的保存位置。</p></div><span class="pill">${icon('folder')}工作记录 / 任务</span></div><div class="setting-row"><div><h4>导入与导出</h4><p>完整携带任务、进展、分组与材料。</p></div>${btn('打开','transfer','arrow-right-left')}</div><div class="setting-row"><div><h4>自动备份</h4><p>正式插件保留最近 7 个备份日期，升级与迁移快照独立留存。</p></div><span class="pill done">最近 7 天</span></div></div></section>
  <section class="settings-section"><h3>快捷记录</h3><div class="settings-surface"><div class="setting-row"><div><h4>随时捕捉进展</h4><p>桌面快捷窗口与工作台使用相同的录入方式。</p></div>${btn('预览快捷窗口','quick','zap')}</div><div class="setting-row"><div><h4>键盘快捷键</h4><p>搜索 ⌘K / Ctrl+K，新建 N，提交 ⌘Enter / Ctrl+Enter。</p></div>${icon('keyboard')}</div></div></section>
  <div class="inline-notice">这是独立设计原型，操作仅影响当前页面的示例数据。刷新页面可恢复初始内容。</div></div>`;}

function openPanel(content,mode='',kind=''){
  panel.onpaste=null;panel.ondragover=null;panel.ondrop=null;
  document.body.append($('#toast')); // Keep the reusable notification out of replaced dialog content.
  if(!panel.open)returnFocus=document.activeElement;
  modalMode=mode;panel.dataset.mode=mode;panel.className=kind;panel.innerHTML=content;
  if(!panel.open)panel.showModal();refreshIcons();
}
function closePanel(){document.body.append($('#toast'));panel.close();modalMode='';currentTask=null;returnFocus?.isConnected&&returnFocus.focus();}
function dialogHead(title){return `<header class="dialog-head"><h2 id="panel-title">${title}</h2>${ib('x','关闭','close')}</header>`;}
function openDetail(id,focusComposer=false,highlight=''){
  const t=findTask(id);if(!t)return;currentTask=id;const g=groupOf(t);const hist=historyOf(id);const count=t.todos.filter(i=>i.done).length;
  openPanel(`<div class="detail-wrap"><div class="detail-top"><span class="row">${icon(g.icon)}${escape(g.name)}</span><div class="row">${t.status==='active'?btn('完成任务','complete','check','',`data-id="${id}"`):btn('重新打开','reopen','rotate-ccw','',`data-id="${id}"`)}${ib('folder-open','任务材料','materials',`data-id="${id}"`)}${ib('x','关闭详情','close')}</div></div><div class="detail-body"><div class="detail-title"><button class="task-icon" style="--group:${g.color}" aria-label="修改任务图标" data-action="icon-picker" data-id="${id}">${icon(t.icon)}</button><h2 id="panel-title">${escape(t.title)}</h2>${ib('pencil','修改任务名称','rename',`data-id="${id}"`)}</div>
  <div class="detail-props"><span>状态</span><div><span class="pill ${t.status==='completed'?'done':'plan'}">${icon(t.status==='completed'?'circle-check':'circle-dot')}${t.status==='active'?'进行中':t.status==='completed'?'已完成':'异常关闭'}</span></div><label for="detail-group">分组</label><select id="detail-group" data-change="task-group" data-id="${id}">${groupOptions(t.group)}</select><label for="detail-q">优先级</label><select id="detail-q" data-change="task-q" data-id="${id}">${qOptions(t.q)}</select><label for="detail-due">截止日期</label><input id="detail-due" type="date" value="${escape(t.due)}" data-change="task-due" data-id="${id}"></div>
  <section class="detail-section"><div class="spread"><h3>任务详情</h3><button class="text-btn" data-action="edit-notes" data-id="${id}">编辑</button></div><p class="detail-notes">${escape(t.notes)||'添加一点背景，让未来的自己更容易接上思路。'}</p>${attachmentMarkup(t)}</section>
  <section class="detail-section"><div class="spread"><h3>待办清单 <span class="muted" style="font-weight:400;margin-left:6px">${count} / ${t.todos.length}</span></h3><button class="text-btn" data-action="add-todo" data-id="${id}">添加待办</button></div>${t.todos.length?`<div class="progress-meter"><span style="width:${count/t.todos.length*100}%"></span></div>`:''}${t.todos.map((item,i)=>`<div class="spread"><label class="todo-line ${item.done?'checked':''}"><input type="checkbox" ${item.done?'checked':''} data-change="todo" data-id="${id}" data-index="${i}"><span>${escape(item.title)}</span></label>${ib('pencil','编辑待办','edit-todo',`data-id="${id}" data-index="${i}"`)}</div>`).join('')}</section>
  <section class="detail-section"><div class="spread"><h3>完整历史 <span class="muted" style="font-weight:400;margin-left:6px">${hist.length}</span></h3><span class="muted" style="font-size:10px">最新在前</span></div><div class="timeline-list">${hist.map(e=>eventMarkup(e,true)).join('')}</div></section>${t.status==='active'?`<button class="text-btn" style="color:var(--muted)" data-action="abnormal" data-id="${id}">异常关闭任务</button>`:''}</div>
  ${t.status==='active'?`<form class="progress-composer" data-form="progress" data-id="${id}"><h3><label for="progress-input">记录新的进展</label></h3><textarea id="progress-input" name="progress" placeholder="刚刚推进了什么？下一步准备做什么？" required data-input="progress" data-id="${id}">${escape(drafts.get(id)||'')}</textarea><div class="spread"><span class="composer-hint">${drafts.get(id)?'已保留草稿':'每一步进展，都值得留下'}<span style="margin-left:8px"><kbd>⌘ ↵</kbd></span></span><button class="btn primary" type="submit">${icon('arrow-up')}记录进展</button></div></form>`:''}</div>`,'detail','drawer');
  if(focusComposer)$('#progress-input')?.focus();
  if(highlight){const node=$$('[data-event]',panel).find(el=>el.dataset.event===highlight);node?.classList.add('is-highlighted');node?.scrollIntoView({block:'center'});}
}
function attachmentMarkup(t){return t.attachments?.length?`<div class="attachment-list">${t.attachments.map((a,i)=>`<button data-action="lightbox" data-id="${t.id}" data-index="${i}" aria-label="预览${escape(a.name)}"><img src="${escape(a.url)}" alt="${escape(a.name)}"></button>`).join('')}</div>`:'';}
function openCreate(context,quick=false){
  if(context!==undefined){if(state.view==='quadrant')createDraft.q=context;else createDraft.group=context;}
  const d=createDraft;
  openPanel(`${dialogHead(quick?'快捷窗口':'新建任务')}${quick?`<div class="quick-tabs"><div class="segmented"><button data-action="quick">记录进展</button><button class="active">新建任务</button></div></div>`:''}<form data-form="create"><div class="dialog-body"><div class="stack"><div class="row" style="align-items:flex-start"><span class="task-icon">${icon(d.icon)}</span><label class="field" style="flex:1"><span class="muted" style="font-size:11px">任务名称</span><input class="title-input" name="title" maxlength="120" value="${escape(d.title)}" placeholder="你准备推进什么？" required autofocus data-draft="title"></label></div>
  <label class="field"><span>详情 <small>可选</small></span><div class="editor-area"><textarea name="notes" placeholder="补充背景、目标，或粘贴图片…" data-draft="notes">${escape(d.notes)}</textarea><div class="editor-tools">${ib('image-plus','添加详情图片','create-image')}${ib('paperclip','上传图片','create-image')}<small>支持图片粘贴和拖入</small></div></div></label><div id="create-attachments" class="attachment-list">${d.attachments.map(a=>`<img src="${escape(a.url)}" alt="${escape(a.name)}">`).join('')}</div>
  <div class="field-row"><label class="field"><span>分组</span><select name="group" data-draft="group">${groupOptions(d.group)}</select></label><label class="field"><span>截止日期 <small>可选</small></span><input type="date" name="due" value="${escape(d.due)}" data-draft="due"></label></div>
  <div class="field"><span>优先级</span><div class="choice-grid">${quadrants.map(q=>`<button type="button" class="choice ${d.q===q.id?'active':''}" data-action="create-q" data-value="${q.id}" aria-pressed="${d.q===q.id}">${icon(q.icon)}${q.name}</button>`).join('')}</div></div></div>
  <details class="optional-section" ${d.todos.length||d.initial?'open':''}><summary>待办清单与初始进展 <span class="muted">（可选）</span></summary><div class="stack"><label class="field"><span>待办清单</span><textarea name="todos" placeholder="每行一条待办" data-draft="todos" style="min-height:76px">${escape(d.todos.join('\n'))}</textarea></label><label class="field"><span>初始进展</span><textarea name="initial" placeholder="已经有一些进展？一起记下来。" data-draft="initial" style="min-height:76px">${escape(d.initial)}</textarea></label></div></details><p class="error" id="create-error" role="alert"></p></div><footer class="dialog-footer"><small>关闭后保留本次草稿 <kbd>⌘ ↵</kbd></small><div class="row">${btn('取消','close')}<button type="submit" class="btn primary">${icon('plus')}创建任务</button></div></footer></form>`,'create');
  bindImages(panel,files=>acceptImages(files,createDraft.attachments,()=>{const holder=$('#create-attachments');holder.innerHTML=createDraft.attachments.map(a=>`<img src="${escape(a.url)}" alt="${escape(a.name)}">`).join('');}));
}
function openQuick(){
  const list=activeTasks();if(!findTask(selectedQuick)||findTask(selectedQuick).status!=='active')selectedQuick=list[0]?.id;
  const t=findTask(selectedQuick);const p=t&&latest(t);
  openPanel(`${dialogHead('<span class="quick-brand"><span class="brand-mark">'+icon('waypoints')+'</span>Tracelo <span class="muted" style="font-weight:400">快捷窗口</span></span>')}<div class="quick-tabs"><div class="segmented"><button class="active">记录进展</button><button data-action="quick-create">新建任务</button></div></div><form data-form="quick" data-id="${t?.id||''}"><div class="dialog-body"><label class="field"><span>记录到哪项任务</span><select name="quick-task" data-change="quick-task">${list.map(t=>option(t.id,`${groupOf(t).name} / ${t.title}`,selectedQuick)).join('')}</select></label>${t?`<div class="quick-context"><div class="spread"><strong>${escape(t.title)}</strong>${duePill(t)}</div><p>${escape(p?.text||t.notes)}</p><small>${p?'上次进展 '+relative(p.day)+' '+p.time:'暂无进展'}</small></div><label class="field quick-composer"><span>新的进展</span><textarea name="progress" required autofocus placeholder="把刚刚的进展记下来…" data-input="progress" data-id="${t.id}">${escape(drafts.get(t.id)||'')}</textarea></label>`:'<div class="empty"><h3>先创建一项任务</h3><p>有了任务，就可以持续追加进展。</p></div>'}</div><footer class="dialog-footer"><small>随时记录，稍后继续 <kbd>⌘ ↵</kbd></small><button class="btn primary" type="submit" ${!t?'disabled':''}>${icon('arrow-up')}记录进展</button></footer></form>`,'quick');
}
function openSearch(){openPanel(`<div class="search-box">${icon('search')}<label for="search-input" id="panel-title" hidden>搜索任务与进展</label><input id="search-input" autofocus placeholder="搜索任务名称、详情或进展…" autocomplete="off">${ib('x','关闭搜索','close')}</div><div id="search-results" class="search-results"></div><div class="search-foot"><kbd>↑</kbd> <kbd>↓</kbd> 选择 <span style="margin:0 12px"><kbd>↵</kbd> 打开记录</span><kbd>esc</kbd> 关闭</div>`,'search');renderSearch('');$('#search-input').addEventListener('input',e=>renderSearch(e.target.value));$('#search-input').focus();}
function renderSearch(query){const q=query.trim().toLowerCase();const results=[];const highlight=str=>!q?escape(str):escape(str).replace(new RegExp(escape(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),m=>`<mark>${m}</mark>`);
  for(const t of tasks){if(!q||t.title.toLowerCase().includes(q)||t.notes.toLowerCase().includes(q))results.push({t,text:t.notes,event:null});for(const e of historyOf(t.id)){if(q&&e.text.toLowerCase().includes(q))results.push({t,text:e.text,event:e});}}
  $('#search-results').innerHTML=results.length?results.slice(0,20).map(({t,text,event})=>`<button class="search-result" data-action="search-open" data-id="${t.id}" data-event="${event?.id||''}"><span class="task-icon" style="--group:${groupOf(t).color}">${icon(event?'message-square':t.icon)}</span><span class="result-copy"><strong>${highlight(t.title)}</strong><p>${highlight(text)}</p><small>${escape(groupOf(t).name)}${event?' · '+fmtDay(event.day)+' '+event.time+' '+event.type:''}</small></span>${icon('arrow-up-right')}</button>`).join(''):`<div class="empty">${icon('search')}<h3>没有找到“${escape(query)}”</h3><p>试试更短的关键词，任务与完整历史都会被搜索。</p></div>`;refreshIcons();
}
function openTransfer(){openPanel(`${dialogHead('导入与导出')}<div class="dialog-body stack"><p class="muted" style="font-size:12px">把工作记录完整带走，或从已有备份继续。</p><section class="transfer-card"><span class="task-icon">${icon('download')}</span><div><h3>导出工作空间</h3><p>包含任务、分组、完整进展与图片材料。</p>${btn('导出示例数据','export','download')}</div></section><section class="transfer-card"><span class="task-icon">${icon('upload')}</span><div><h3>从文件导入</h3><p>先预览，再导入。相同 ID 的任务会被跳过。</p><input type="file" id="import-file" accept=".json" hidden>${btn('选择原型导出文件','choose-import','file-up')}</div></section><div id="import-preview"></div><div class="inline-notice">原型使用独立的演示格式，不读写正式插件存档。</div></div><footer class="dialog-footer"><small>本次仅处理示例工作空间</small>${btn('完成','close')}</footer>`,'transfer');$('#import-file').addEventListener('change',readImport);}
async function readImport(e){
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>5*1024*1024)throw Error('请选择 5 MB 以内的原型导出文件。');
    const data=JSON.parse(await file.text());
    const safeId=id=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(id);
    if(data?.format!=='tracelo-studio-mock-v1'||!Array.isArray(data.tasks)||!Array.isArray(data.groups)||!Array.isArray(data.events))throw Error('文件格式不匹配。请选择本原型导出的 JSON 文件。');
    if(!data.tasks.every(t=>t&&safeId(t.id)&&typeof t.title==='string'&&typeof t.notes==='string'&&['active','completed','closed'].includes(t.status)&&typeof t.due==='string'&&(!t.due||/^\d{4}-\d{2}-\d{2}$/.test(t.due))&&Array.isArray(t.todos)&&t.todos.every(i=>i&&typeof i.title==='string'&&typeof i.done==='boolean')&&Array.isArray(t.attachments)&&t.attachments.every(a=>a&&typeof a.name==='string'&&typeof a.url==='string'&&/^data:image\/(png|jpeg|webp|gif);base64,/.test(a.url))))throw Error('任务内容不完整，请重新选择文件。');
    if(!data.groups.every(g=>g&&safeId(g.id)&&typeof g.name==='string')||!data.events.every(e=>e&&safeId(e.id)&&safeId(e.task)&&typeof e.text==='string'&&typeof e.type==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(e.day)&&/^\d{2}:\d{2}$/.test(e.time)))throw Error('分组或历史格式不正确。');
    if(new Set(data.tasks.map(t=>t.id)).size!==data.tasks.length)throw Error('导入文件含重复任务 ID，请检查文件。');
    pendingImport=data;
    const count=data.tasks.filter(t=>!findTask(t.id)).length;
    $('#import-preview').innerHTML=`<h3>导入预览</h3><div class="transfer-summary"><div><strong>${count}</strong><small>新增任务</small></div><div><strong>${data.tasks.length-count}</strong><small>相同 ID 跳过</small></div><div><strong>${data.groups.length}</strong><small>来源分组</small></div></div><div style="margin-top:15px">${btn('确认导入','confirm-import','check','primary')}</div>`;refreshIcons();
  }catch(error){pendingImport=null;$('#import-preview').innerHTML=`<p class="error" role="alert">${escape(error.message)}</p>`;}
}
function openGroups(){openPanel(`${dialogHead('管理分组')}<div class="dialog-body"><p class="dialog-subtitle" style="margin:0 0 18px">为不同的工作留出自己的位置。</p><div>${groups.map((g,i)=>`<div class="group-row">${ib(g.icon,'修改分组图标','group-icon',`data-group="${g.id}"`)}<input aria-label="${escape(g.name)}的名称" value="${escape(g.name)}" data-change="group-name" data-group="${g.id}" maxlength="40">${ib('arrow-up','上移分组','group-up',`data-group="${g.id}" ${i===0?'disabled':''}`)}${ib('arrow-down','下移分组','group-down',`data-group="${g.id}" ${i===groups.length-1?'disabled':''}`)}${ib('trash-2','删除分组','group-delete',`data-group="${g.id}"`)}</div>`).join('')}</div><form data-form="group" style="display:flex;gap:8px;margin-top:20px"><input aria-label="新分组名称" name="name" placeholder="新分组名称" maxlength="40" required><button class="btn primary" type="submit">${icon('plus')}添加</button></form></div><footer class="dialog-footer"><small>删除分组时，任务移入未分组</small>${btn('完成','close')}</footer>`,'groups');}
function textDialog(title,value,onSubmit,{multiline=false,label=title,submit='保存'}={}){openPanel(`${dialogHead(title)}<form id="text-form"><div class="dialog-body"><label class="field"><span>${escape(label)}</span>${multiline?`<textarea name="value" autofocus>${escape(value)}</textarea>`:`<input name="value" value="${escape(value)}" autofocus required maxlength="200">`}</label><p id="text-error" class="error" role="alert"></p></div><footer class="dialog-footer"><small>变更会保留在任务历史中</small><div class="row">${btn('取消','close')}<button class="btn primary" type="submit">${submit}</button></div></footer></form>`,'text');$('#text-form').addEventListener('submit',e=>{e.preventDefault();const value=new FormData(e.target).get('value').trim();onSubmit(value);});}
function confirmation(title,copy,proceed,label='确认'){openPanel(`${dialogHead(title)}<div class="dialog-body"><p style="font-size:13px;line-height:1.9">${escape(copy)}</p></div><footer class="dialog-footer"><small>任务与历史记录都会保留</small><div class="row">${btn('返回','close')}<button class="btn primary" id="confirm-action">${label}</button></div></footer>`,'confirm');$('#confirm-action').onclick=proceed;}
const availableIcons=['circle-dot','credit-card','layers-2','briefcase-business','sprout','notebook-pen','messages-square','book-open','package-check','route','code-2','camera','music','folder','lightbulb','coffee','heart','rocket','pen-tool','globe','target','calendar','map','laptop','archive','file-text','bug','database','puzzle','palette','image','flask-conical'];
function iconPicker(onSelect){openPanel(`${dialogHead('选择图标')}<div class="dialog-body"><div class="icon-grid">${availableIcons.map(name=>ib(name,name,'pick-icon',`data-icon="${name}"`)).join('')}</div></div>`,'icons');$$('[data-action="pick-icon"]',panel).forEach(el=>el.onclick=()=>onSelect(el.dataset.icon));}
function bindImages(root,callback){root.onpaste=e=>{const files=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();callback(files);}};root.ondragover=e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();};root.ondrop=e=>{const files=[...(e.dataTransfer?.files||[])];if(files.length){e.preventDefault();callback(files);}};}
async function acceptImages(files,target,after){for(const f of files){if(!/^image\/(png|jpeg|webp|gif)$/.test(f.type)||f.size>2*1024*1024){notify('请选择 2 MB 以内的 PNG、JPEG、WebP 或 GIF 图片');continue;}const url=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(f);});target.push({name:f.name,url});}after();}
function chooseImages(callback){const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,image/gif';input.multiple=true;input.onchange=()=>callback([...input.files]);input.click();}
function bindDrag(){
  $$('.task-card').forEach(el=>{el.ondragstart=e=>{e.dataTransfer.setData('text/tracelo-task',el.dataset.id);e.dataTransfer.effectAllowed='move';};});
  $$('[data-drop]').forEach(el=>{el.ondragover=e=>{if(e.dataTransfer.types.includes('text/tracelo-task')){e.preventDefault();el.classList.add('dragover');}};el.ondragleave=e=>{if(!el.contains(e.relatedTarget))el.classList.remove('dragover');};el.ondrop=e=>{e.preventDefault();el.classList.remove('dragover');const t=findTask(e.dataTransfer.getData('text/tracelo-task'));if(!t)return;const field=state.view==='quadrant'?'q':'group';if(t[field]===el.dataset.drop)return;t[field]=el.dataset.drop;addEvent(t.id,field==='q'?'优先级变更':'分组变更',`移动到${field==='q'?quadrantOf(t).name:groupOf(t).name}`);render();notify('已移动任务');};});
}

document.addEventListener('click',e=>{
  const target=e.target.closest('[data-action]');if(!target)return;
  const {action,id,value,group,context,index}=target.dataset;
  const t=findTask(id);const g=groups.find(g=>g.id===group);
  if(action==='pick-icon')return;
  switch(action){
    case 'navigate':state.page=target.dataset.page;state.group='all';state.mobileTimeline=false;render();$('.workspace').scrollTop=0;break;
    case 'view':state.view=value;render();break;
    case 'theme':state.theme=state.theme==='light'?'dark':'light';render();break;
    case 'set-theme':state.theme=value;render();break;
    case 'mobile-menu':$('.shell').classList.toggle('nav-open');break;
    case 'mobile-view':state.mobileTimeline=value==='timeline';render();break;
    case 'mobile-back':state.mobileTimeline=false;render();break;
    case 'filter-group':state.page='board';state.group=group;state.mobileTimeline=false;render();break;
    case 'all-groups':state.group='all';render();break;
    case 'timeline-full':state.page='timeline';render();break;
    case 'day':state.day=target.dataset.day;render();break;
    case 'today':state.day=TODAY;render();break;
    case 'previous-day':case 'next-day':{const d=new Date(state.day+'T12:00:00');d.setDate(d.getDate()+(action==='next-day'?1:-1));state.day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;render();break;}
    case 'create':openCreate(context);break;
    case 'quick-create':openCreate(undefined,true);break;
    case 'create-q':createDraft.q=value;$$('.choice',panel).forEach(el=>{el.classList.toggle('active',el.dataset.value===value);el.setAttribute('aria-pressed',String(el.dataset.value===value));});break;
    case 'create-image':chooseImages(files=>acceptImages(files,createDraft.attachments,()=>{$('#create-attachments').innerHTML=createDraft.attachments.map(a=>`<img src="${escape(a.url)}" alt="${escape(a.name)}">`).join('');}));break;
    case 'detail':openDetail(id);break;
    case 'progress':openDetail(id,true);break;
    case 'search-open':openDetail(id,false,target.dataset.event);break;
    case 'quick':openQuick();break;
    case 'search':openSearch();break;
    case 'close':closePanel();break;
    case 'groups':openGroups();break;
    case 'transfer':openTransfer();break;
    case 'toggle-details':state.showDetails=!state.showDetails;render();break;
    case 'rename':textDialog('修改任务名称',t.title,newName=>{const old=t.title;t.title=newName;addEvent(id,'名称变更',`${old} → ${newName}`);render();openDetail(id);notify('任务名称已更新');});break;
    case 'edit-notes':textDialog('编辑任务详情',t.notes,notes=>{t.notes=notes;addEvent(id,'详情变更','更新了任务详情。');render();openDetail(id);notify('任务详情已更新');},{multiline:true,label:'任务详情'});break;
    case 'add-todo':textDialog('添加待办','',title=>{t.todos.push(todo(title));addEvent(id,'待办变更',`添加「${title}」`);render();openDetail(id);});break;
    case 'edit-todo':textDialog('编辑待办',t.todos[index].title,title=>{t.todos[index].title=title;addEvent(id,'待办变更',`更新待办为「${title}」`);render();openDetail(id);});break;
    case 'complete':{const remaining=t.todos.filter(i=>!i.done).length;const finish=()=>{t.status='completed';addEvent(id,'完成任务',remaining?`任务已完成，保留 ${remaining} 项未完成待办。`:'所有工作已完成。');render();openDetail(id);notify('任务已完成，记录完整保留');};if(remaining)confirmation('完成这项任务？',`还有 ${remaining} 项待办未完成。你可以返回处理，也可以直接结束任务。`,finish,'仍然完成');else finish();break;}
    case 'abnormal':textDialog('异常关闭任务','',reason=>{t.status='closed';addEvent(id,'异常关闭',reason);render();openDetail(id);notify('任务已关闭');},{multiline:true,label:'记录关闭原因',submit:'关闭任务'});break;
    case 'reopen':t.status='active';addEvent(id,'重新打开','任务重新进入进行中。');render();if(panel.open)openDetail(id);notify('任务已重新打开');break;
    case 'icon-picker':iconPicker(name=>{t.icon=name;addEvent(id,'图标变更','更新了任务图标。');render();openDetail(id);});break;
    case 'group-icon':iconPicker(name=>{g.icon=name;render();openGroups();});break;
    case 'group-up':case 'group-down':{const at=groups.indexOf(g);const to=at+(action==='group-up'?-1:1);if(to>=0&&to<groups.length){[groups[at],groups[to]]=[groups[to],groups[at]];render();openGroups();}break;}
    case 'group-delete':confirmation('删除分组？',`删除「${g.name}」后，其中的任务会移入未分组，历史记录仍然保留。`,()=>{tasks.filter(t=>t.group===group).forEach(t=>{t.group='';addEvent(t.id,'分组变更',`「${g.name}」已删除，任务移入未分组。`);});groups=groups.filter(item=>item.id!==group);if(state.group===group)state.group='all';render();openGroups();},'删除分组');break;
    case 'materials':openPanel(`${dialogHead('任务材料')}<div class="dialog-body"><p class="muted" style="font-size:12px;margin-bottom:18px">${escape(t.title)}</p>${attachmentMarkup(t)||'<div class="empty"><h3>还没有图片材料</h3><p>为任务添加截图、草图或参考图片。</p></div>'}${btn('添加图片','task-image','image-plus','',`data-id="${id}"`)}<div class="inline-notice">正式插件可打开对应的本地任务文件夹。原型仅预览当前页面的图片。</div></div><footer class="dialog-footer"><small>图片只保留在本次页面会话</small>${btn('返回任务','detail','','',`data-id="${id}"`)}</footer>`,'materials');break;
    case 'task-image':chooseImages(files=>acceptImages(files,t.attachments,()=>{addEvent(id,'详情变更','添加了图片材料。');openDetail(id);notify('图片已添加');}));break;
    case 'lightbox':openPanel(`${ib('x','关闭图片','detail',`data-id="${id}"`)}<h2 id="panel-title" hidden>${escape(t.attachments[index].name)}</h2><img src="${escape(t.attachments[index].url)}" alt="${escape(t.attachments[index].name)}">`,'lightbox','lightbox');break;
    case 'export':{const data={format:'tracelo-studio-mock-v1',tasks,groups,events};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='Tracelo-mockup-2026-09-29.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('示例数据已导出');break;}
    case 'choose-import':$('#import-file').click();break;
    case 'confirm-import':{if(!pendingImport)return;const newIds=new Set(pendingImport.tasks.filter(t=>!findTask(t.id)).map(t=>t.id));const groupMap=new Map();for(const item of pendingImport.groups){let existing=groups.find(g=>g.id===item.id||g.name===item.name);if(!existing){existing={...item,icon:availableIcons.includes(item.icon)?item.icon:'folder',color:'#548877'};groups.push(existing);}groupMap.set(item.id,existing.id);}tasks.push(...pendingImport.tasks.filter(t=>newIds.has(t.id)).map(t=>({...t,icon:availableIcons.includes(t.icon)?t.icon:'circle-dot',group:groupMap.get(t.group)||'',q:quadrants.some(q=>q.id===t.q)?t.q:'later'})));events.push(...pendingImport.events.filter(e=>newIds.has(e.task)));pendingImport=null;render();openTransfer();notify(`已导入 ${newIds.size} 项任务`);break;}
  }
});

document.addEventListener('change',e=>{
  const el=e.target;const type=el.dataset.change;const t=findTask(el.dataset.id);
  if(type==='todo'){const item=t.todos[Number(el.dataset.index)];item.done=el.checked;addEvent(t.id,'待办变更',`${item.done?'完成':'取消完成'}「${item.title}」`);const position=$('.detail-body')?.scrollTop;render();if(modalMode==='detail'){openDetail(t.id);$('.detail-body').scrollTop=position;}return;}
  if(['sort','filter','zoom','columns'].includes(type)){state[type]=['zoom','columns'].includes(type)?Number(el.value):el.value;render();return;}
  if(type==='quick-task'){selectedQuick=el.value;openQuick();return;}
  if(type==='group-name'){const g=groups.find(g=>g.id===el.dataset.group);const name=el.value.trim();if(!name||groups.some(item=>item!==g&&item.name===name)){el.value=g.name;notify('分组名称不能为空或重复');return;}g.name=name;render();return;}
  if(['task-group','task-q','task-due'].includes(type)){const key=type.replace('task-','');const old=t[key];t[key]=el.value;if(old!==t[key])addEvent(t.id,key==='group'?'分组变更':key==='q'?'优先级变更':'截止日期变更',key==='group'?`移入${groupOf(t).name}`:key==='q'?`设为${quadrantOf(t).name}`:`${old||'未设置'} → ${t[key]||'未设置'}`);render();openDetail(t.id);}
});
document.addEventListener('input',e=>{const el=e.target;if(el.dataset.draft){createDraft[el.dataset.draft]=el.dataset.draft==='todos'?el.value.split('\n'):el.value;}if(el.dataset.input==='progress'){drafts.set(el.dataset.id,el.value);const hint=$('.composer-hint');if(hint)hint.textContent='已保留草稿';}});
document.addEventListener('submit',e=>{
  const form=e.target;if(!form.dataset.form)return;e.preventDefault();const values=new FormData(form);
  if(form.dataset.form==='create'){const title=String(values.get('title')).trim();if(!title){$('#create-error').textContent='请填写任务名称。';return;}const id=crypto.randomUUID();const t={id,title,notes:String(values.get('notes')).trim(),group:String(values.get('group')),q:createDraft.q,icon:createDraft.icon,due:String(values.get('due')),todos:String(values.get('todos')||'').split('\n').map(x=>x.trim()).filter(Boolean).map(x=>todo(x)),attachments:[...createDraft.attachments],status:'active'};tasks.unshift(t);addEvent(id,'创建任务',`创建任务，归入${groupOf(t).name}。`);const initial=String(values.get('initial')||'').trim();if(initial)addEvent(id,'进展',initial);createDraft={title:'',notes:'',group:'',q:'later',due:'',todos:[],initial:'',attachments:[],icon:'circle-dot'};closePanel();state.page='board';state.filter='all';state.group='all';render();notify('任务已创建');openDetail(id);return;}
  if(['progress','quick'].includes(form.dataset.form)){const text=String(values.get('progress')||'').trim();if(!text){form.elements.progress.setCustomValidity('请输入进展内容');form.elements.progress.reportValidity();form.elements.progress.oninput=()=>form.elements.progress.setCustomValidity('');return;}const id=form.dataset.id;addEvent(id,'进展',text);drafts.delete(id);render();if(form.dataset.form==='quick')openQuick();else openDetail(id);notify('进展已记录');return;}
  if(form.dataset.form==='group'){const name=String(values.get('name')).trim();if(!name||groups.some(g=>g.name===name)){notify('请输入不重复的分组名称');return;}groups.push({id:crypto.randomUUID(),name,icon:'folder',color:'#548877'});render();openGroups();notify('分组已添加');}
});
document.addEventListener('keydown',e=>{
  if(e.isComposing)return;
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch();return;}
  if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&panel.open){const form=$('form',panel);if(form){e.preventDefault();form.requestSubmit();}return;}
  if(modalMode==='search'&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const rows=$$('.search-result',panel);const at=rows.indexOf(document.activeElement);rows[(at+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();return;}
  if(e.key.toLowerCase()==='n'&&!panel.open&&!e.metaKey&&!e.ctrlKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();openCreate();}
});
panel.addEventListener('cancel',e=>{e.preventDefault();closePanel();});
panel.addEventListener('click',e=>{if(e.target===panel){const r=panel.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closePanel();}});
const params=new URLSearchParams(location.search);
if(params.get('theme')==='dark'||(!params.has('theme')&&matchMedia('(prefers-color-scheme: dark)').matches))state.theme='dark';
if(Object.hasOwn(pageNames,params.get('page')))state.page=params.get('page');
if(params.get('view')==='quadrant')state.view='quadrant';
render();
if(params.get('screen')==='create')openCreate();
if(params.get('screen')==='detail')openDetail('payment');
if(params.get('screen')==='quick')openQuick();
if(params.get('screen')==='search')openSearch();
if(params.get('screen')==='transfer')openTransfer();
if(params.get('screen')==='groups')openGroups();
