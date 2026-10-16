const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  plus:'M12 5v14M5 12h14', close:'m6 6 12 12M18 6 6 18', left:'m14 6-6 6 6 6', right:'m10 6 6 6-6 6',
  expand:'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5', collapse:'M8 3v5H3M16 3v5h5M21 16h-5v5M3 16h5v5',
  moon:'M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z', sun:'M12 3V1M12 23v-2M3 12H1M23 12h-2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  sparkles:'m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3ZM21 2v4M19 4h4',
  panel:'M3 4h18v16H3zM15 4v16', calendar:'M4 5h16v16H4zM16 3v4M8 3v4M4 11h16',
  history:'M3 11a9 9 0 1 1 2.7 7M3 4v7h7M12 7v5l3 2',
  message:'M21 11a8 8 0 0 1-8 8H5l-3 3V7a5 5 0 0 1 5-5h8a6 6 0 0 1 6 6v3ZM7 8h9M7 12h6',
  search:'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6',
  'arrow-up':'M12 19V5m-6 6 6-6 6 6', arrow:'M5 12h14m-5-5 5 5-5 5',
  mouse:'M12 8V5m-5-3h10a2 2 0 0 1 2 2v10a7 7 0 0 1-14 0V4a2 2 0 0 1 2-2Z',
  edit:'m15 5 4 4M4 16 16 4a3 3 0 0 1 4 4L8 20H4v-4Z',
  check:'m5 12 4 4L19 6', list:'m3 6 1 1 2-2M9 6h12M9 12h12M9 18h12M3 12h2M3 18h2',
  file:'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h8', folder:'M3 6h6l2 3h10v12H3V6Z',
  pause:'M8 4v16M16 4v16', play:'m7 3 14 9-14 9V3Z', clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
};
function icon(name){return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]||paths.file}"></path></svg>`;}
function icons(scope=document){$$('[data-icon]',scope).forEach(el=>{el.innerHTML=icon(el.dataset.icon);});}
const quadrants=[
  {id:'iu',label:'重要且紧急',color:'#ad7d70'}, {id:'in',label:'重要不紧急',color:'#688f85'},
  {id:'nu',label:'紧急不重要',color:'#b59b64'}, {id:'nn',label:'不重要不紧急',color:'#8e8aaa'},
];
const groups=['工作','学习','生活','未分组'];
const today='2026-10-15';
const seedTasks=[
  {id:'design',title:'让工作台更有呼吸感',group:'工作',q:'in',icon:'artist-palette',due:'2026-10-18',notes:'把当前任务的进展、待办和材料放在同一处。\n\n界面轻盈，动作明确；每次回来，都能接着上次的思路。',todos:[['明确展示台与任务卡片的关系',true],['比较右侧助手展开与收起的体验',false],['检查大画幅中的阅读与切换',false]],events:[{at:'2026-10-15T16:40',text:'方向已经清楚：上方展开当前任务，\n下方用封面流切换。\n接下来，把每个动作做得更自然。'},{at:'2026-10-14T10:20',text:'整理了现有工作台的阅读顺序，确认进展是任务的主线。'}]},
  {id:'launch',title:'准备秋季产品发布',group:'工作',q:'iu',icon:'rocket',due:today,notes:'核对版本说明与发布素材。先完成桌面端的最终检查，再整理对外介绍。',todos:[['整理版本说明',true],['核对安装包与校验值',false],['完成发布前检查',false]],events:[{at:'2026-10-15T14:20',text:'发布说明已整理，安装包等待最终核对。\n下午先把关键流程走一遍。'},{at:'2026-10-13T11:30',text:'汇总了本轮功能变化和已知边界。'}]},
  {id:'reading',title:'读完《设计心理学》',group:'学习',q:'in',icon:'books',notes:'关注可见性、反馈和用户的心智模型。每读一章，找一个日常界面里的具体例子。',todos:[['阅读“日常行为心理学”',true],['记录三个反馈设计的例子',false]],events:[{at:'2026-10-15T09:10',text:'读到“执行鸿沟”：按钮出现了，\n不代表用户知道下一步怎么做。'}]},
  {id:'photo',title:'周末的城市散步',group:'生活',q:'nn',icon:'camera',due:'2026-10-17',notes:'沿着河边慢慢走，记录傍晚的光线。轻装出门，只带一支镜头。',todos:[['给相机充电',false],['确定散步路线',false]],events:[{at:'2026-10-14T20:30',text:'选好河边到老街的路线。\n这次想拍一些安静的街角。'}]},
  {id:'garden',title:'阳台的植物计划',group:'生活',q:'in',icon:'seedling',notes:'观察光照和浇水频率，先照顾好已有的植物，再决定是否添新盆。',todos:[['记录一周光照',false]],events:[]},
  {id:'notes',title:'整理访谈中的关键发现',group:'工作',q:'nu',icon:'spiral-notepad',due:today,notes:'把观察、用户原话与设计建议分开记录。保留原始语境，避免过度概括。',todos:[['核对访谈记录',true],['提炼共性问题',false]],events:[{at:'2026-10-15T11:05',text:'已经整理前三份访谈。大家更在意切换任务后能不能快速找回上下文，而不是看到更多统计指标。'}]},
  {id:'writing',title:'写一篇关于注意力的文章',group:'学习',q:'nn',icon:'fountain-pen',notes:'从自己的工作切换习惯出发，写一个具体、有用的观察。',todos:[],events:[{at:'2026-10-12T19:20',text:'写下开头：有时候丢掉的不是时间，而是重新进入工作的那条线索。'}]},
  {id:'travel',title:'安排十一月的短途旅行',group:'生活',q:'nu',icon:'globe-showing-asia-australia',due:'2026-10-22',notes:'两到三天，交通方便，留出不排计划的半天。',todos:[['比较目的地',false],['确认交通',false]],events:[]},
  {id:'course',title:'理解动画中的弹簧与阻尼',group:'学习',q:'in',icon:'compass',notes:'比较同一动作在不同阻尼下的感受，重点观察停止和反向操作。',todos:[['阅读基础材料',true],['做一个可以调节参数的小实验',false]],events:[{at:'2026-10-14T17:00',text:'记住了一点：动画的结束方式，也在表达物体的重量。'}]},
  {id:'empty',title:'一个刚冒出来的想法',group:'未分组',q:'nn',icon:'headphone',notes:'',todos:[],events:[]},
  {id:'long',title:'梳理跨团队协作中任务切换、材料交接与长期上下文恢复的完整流程',group:'工作',q:'in',icon:'compass',notes:'需要覆盖开始、交接、暂停、恢复和结束五个阶段。重点检查身份、资料和未完成的思路如何在不同阶段延续。\n\n把每一步的输入、输出与责任写清楚，也保留例外情况。',todos:[['收集两组真实流程',true],['梳理交接时容易丢失的信息',false],['标记需要共同确认的节点',false]],events:[{at:'2026-10-13T15:00',text:'完成了第一轮流程梳理。交接的主要问题集中在材料分散、状态不明确，以及“下一步”没有被明确记录。需要将具体观察与我们的推测分开，并用第二组流程验证，避免把个别经历当成普遍规律。'}]},
  {id:'reply',title:'回复本周合作事项',group:'工作',q:'iu',icon:'fountain-pen',due:'2026-10-16',notes:'确认时间与交付边界，把尚未确定的事项单独列出。',todos:[['确认本周时间',true],['整理合作范围',false]],events:[{at:'2026-10-15T10:15',text:'时间已经对齐，还需要确认具体交付范围。'}]},
];
const tasks=structuredClone(seedTasks);
tasks.splice(2,0,tasks.shift());
const query=new URLSearchParams(location.search);
const initial=query.get('state')||'idle';
const state={selected:initial==='long'?'long':initial==='empty-task'?'empty':'design',group:'all',quadrant:'all',search:'',overview:initial==='overview'||initial==='quadrants',layout:initial==='quadrants'?'quadrant':'group',sidebar:innerWidth>960&&initial!=='collapsed',panel:'chat',date:today,month:'2026-10',refs:[],drafts:new Map(),editing:new Set(),details:new Set(),messages:[],flowCenter:0,flowScroll:0,historyTask:null};
if(initial==='filtered'){state.group='工作';state.quadrant='in';}
if(initial==='no-results'){state.group='未分组';state.quadrant='iu';}
if(initial==='dark'||query.get('theme')==='dark')document.body.classList.add('dark');
if(query.get('motion')==='off'||matchMedia('(prefers-reduced-motion: reduce)').matches)document.body.classList.add('motion-paused');
const current=()=>tasks.find(t=>t.id===state.selected);
const quadrant=t=>quadrants.find(q=>q.id===t.q);
const filtered=()=>tasks.filter(t=>(state.group==='all'||t.group===state.group)&&(state.quadrant==='all'||t.q===state.quadrant)&&t.title.includes(state.search));
const dateLabel=date=>`${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`;
function setPressed(el,value){el.setAttribute('aria-pressed',String(value));}
let toastTimer;
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,2300);}
function coverHeading(t){return `<span class="cover-identity"><img class="cover-icon" src="assets/${t.icon}.svg" alt="" width="30" height="30"><span>${escape(t.group)}</span></span><span class="cover-selected" ${t.id===state.selected?'':'hidden'}>当前任务</span>`;}
function taskCover(t){const q=quadrant(t);return `<button class="task-cover${t.id===state.selected?' selected':''}" data-task="${escape(t.id)}" aria-pressed="${t.id===state.selected}" aria-label="打开任务：${escape(t.title)}"><span class="cover-top">${coverHeading(t)}</span><span class="cover-title">${escape(t.title)}</span><span class="cover-bottom"><span><i class="quadrant-dot" style="--q-color:${q.color}"></i>${q.label}</span>${t.due?`<span class="cover-due">${t.due===today?'今天截止':dateLabel(t.due)}</span>`:''}</span></button>`;}
function renderStage(){
  const t=current(),q=quadrant(t),latest=t.events[0],editing=state.editing.has(t.id),expanded=state.details.has(t.id);
  $('#task-title').textContent=t.title;
  $('#task-meta').innerHTML=`<span>${icon('folder')}${escape(t.group)}</span><span class="meta-separator"></span><span><i class="quadrant-dot" style="--q-color:${q.color}"></i>${q.label}</span>${t.due?`<span class="meta-separator"></span><span>${icon('calendar')}${dateLabel(t.due)}截止</span>`:''}`;
  $('#bento').innerHTML=`<article class="bento-card progress-card"><div class="card-heading"><h2>${icon('edit')}最新进展</h2></div>${latest?`<div class="progress-time">${dateLabel(latest.at)} · ${latest.at.slice(11,16)}</div><p class="progress-text${latest.text.length>90?' long':''}">${escape(latest.text)}</p>`:'<p class="progress-text">从第一步开始。</p><p class="progress-note">记下现在做到哪里，下次回来就能接着推进。</p>'}<div class="progress-footer" ${editing?'hidden':''}><button class="text-button" id="stage-history">${t.events.length?'查看 '+t.events.length+' 条进展':'查看任务历史'} ${icon('arrow')}</button><button class="button primary" id="edit-progress">${icon('plus')}记录进展</button></div><form class="progress-composer" id="progress-form" ${editing?'':'hidden'}><textarea id="progress-input" aria-label="记录任务进展" placeholder="刚刚推进了什么？接下来要做什么？" rows="3">${escape(state.drafts.get(t.id)||'')}</textarea><div class="compose-actions"><span>⌘ / Ctrl + Enter 记录</span><div><button type="button" class="text-button" id="cancel-progress">收起</button><button class="button primary small" type="submit">记录进展</button></div></div></form></article><article class="bento-card todos-card"><div class="card-heading"><h2>${icon('list')}待办清单</h2><span class="todo-counter">${t.todos.filter(x=>x[1]).length} / ${t.todos.length}</span></div><div class="todo-list">${t.todos.length?t.todos.map((item,index)=>`<label class="todo-row"><input type="checkbox" data-todo="${index}" ${item[1]?'checked':''}><span>${escape(item[0])}</span></label>`).join(''):'<p class="empty-copy">暂时没有待办。<br>可以先从一条进展开始。</p>'}</div></article><article class="bento-card details-card"><div class="card-heading"><h2>${icon('file')}任务详情</h2>${t.notes.length>90?`<button class="text-button" id="toggle-details">${expanded?'收起':'展开'}</button>`:''}</div><p class="details-copy${expanded?' expanded':''}">${escape(t.notes?(expanded?t.notes:t.notes.slice(0,93)+(t.notes.length>93?'…':'')):'还没有补充详情。')}</p></article>`;
  $('#bento').classList.remove('appear');void $('#bento').offsetWidth;$('#bento').classList.add('appear');
  $('#stage-history').onclick=()=>showHistory(t.id);
  $('#edit-progress').onclick=()=>{state.editing.add(t.id);$('#progress-form').hidden=false;$('.progress-footer').hidden=true;$('#progress-input').focus();};
  $('#cancel-progress').onclick=()=>{state.editing.delete(t.id);$('#progress-form').hidden=true;$('.progress-footer').hidden=false;$('#edit-progress').focus();};
  $('#progress-input').oninput=e=>state.drafts.set(t.id,e.target.value);
  $('#progress-form').onsubmit=e=>{e.preventDefault();const input=$('#progress-input');if(composing||!input.value.trim())return;const at=`${today}T17:${String(10+t.events.length).padStart(2,'0')}`;t.events.unshift({at,text:input.value.trim()});state.drafts.delete(t.id);state.editing.delete(t.id);renderStage();renderActivity();if(state.panel==='history'&&state.historyTask===t.id)renderHistory();toast('进展已记录');};
  $('#progress-input').onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!e.isComposing&&!composing){e.preventDefault();$('#progress-form').requestSubmit();}};
  $$('[data-todo]').forEach(el=>el.onchange=()=>{t.todos[+el.dataset.todo][1]=el.checked;$('.todo-counter').textContent=`${t.todos.filter(x=>x[1]).length} / ${t.todos.length}`;});
  if($('#toggle-details'))$('#toggle-details').onclick=()=>{expanded?state.details.delete(t.id):state.details.add(t.id);const copy=$('.details-copy');copy.textContent=expanded?t.notes.slice(0,93)+(t.notes.length>93?'…':''):t.notes;copy.classList.toggle('expanded',!expanded);$('#toggle-details').textContent=expanded?'展开':'收起';};
  updateOutsideFilter();
}
function updateOutsideFilter(){$('#outside-filter').hidden=filtered().some(t=>t.id===state.selected);}
function selectTask(id,{center=true}={}){
  if(composing)return;
  if(id===state.selected){if(state.overview)toggleOverview(false);return;}
  state.selected=id;renderStage();
  $$('[data-task]').forEach(el=>{const selected=el.dataset.task===id;el.classList.toggle('selected',selected);setPressed(el,selected);$('.cover-selected',el).hidden=!selected;});
  if(state.overview)toggleOverview(false);
  if(center){const i=filtered().findIndex(t=>t.id===id);if(i>=0)centerFlow(i,true);}
}
function renderFilters(){
  $('#group-filters').innerHTML=['all',...groups].map(g=>`<button data-group="${g}" aria-pressed="${state.group===g}">${g==='all'?'全部':g}</button>`).join('');
  $('#quadrant-filters').innerHTML=`<button data-quadrant="all" aria-pressed="${state.quadrant==='all'}">全部</button>`+quadrants.map(q=>`<button data-quadrant="${q.id}" aria-pressed="${state.quadrant===q.id}"><i class="quadrant-dot" style="--q-color:${q.color}"></i>${q.label}</button>`).join('');
  $('#clear-filters').hidden=state.group==='all'&&state.quadrant==='all'&&!state.search;
}
function resetFilters(){state.group='all';state.quadrant='all';state.search='';$('#task-search').value='';renderFilters();renderLibrary();}
function renderLibrary(){
  const list=filtered();$('#task-count').textContent=`${list.length} 项`;
  $('#cover-flow').innerHTML=list.map(taskCover).join('');
  $('#flow-empty').hidden=!!list.length;$('#cover-flow').hidden=!list.length;$('#flow-footer').hidden=!list.length||state.overview;
  renderOverview();updateOutsideFilter();
  requestAnimationFrame(()=>centerFlow(Math.max(0,list.findIndex(t=>t.id===state.selected)),false));
}
function renderOverview(){
  const list=filtered();$('#overview-board').classList.toggle('quadrants',state.layout==='quadrant');
  if(!list.length){$('#overview-board').innerHTML='<div class="board-empty">没有匹配的任务，请调整上方筛选条件。</div>';return;}
  const sections=state.layout==='quadrant'?quadrants.map(q=>({label:q.label,color:q.color,list:list.filter(t=>t.q===q.id)})):groups.map(g=>({label:g,color:null,list:list.filter(t=>t.group===g)})).filter(x=>x.list.length);
  $('#overview-board').innerHTML=sections.map(s=>`<section class="board-section"><h3>${s.color?`<i class="quadrant-dot" style="--q-color:${s.color}"></i>`:icon('folder')}${s.label}<span>${s.list.length}</span></h3>${s.list.length?`<div class="board-grid">${s.list.map(taskCover).join('')}</div>`:'<div class="board-empty">这个象限暂时没有任务</div>'}</section>`).join('');
}
let scrollFrame;
function updateFlow(){
  const flow=$('#cover-flow');if(!flow.clientWidth||state.overview)return;
  const center=flow.scrollLeft+flow.clientWidth/2;
  let closest=0,distance=Infinity;
  $$('.task-cover',flow).forEach((el,i)=>{const d=el.offsetLeft+el.offsetWidth/2-center;const r=Math.max(-1,Math.min(1,d/(flow.clientWidth/2)));const edge=Math.max(0,(Math.abs(r)-.42)/.58);const selected=el.dataset.task===state.selected;el.style.setProperty('--rotate',`${selected?0:-Math.sign(r)*edge*8}deg`);el.style.setProperty('--scale',String(selected?1:1-edge*.045));el.style.setProperty('--lift',selected?'-4px':'0px');const abs=Math.abs(d);if(abs<distance){distance=abs;closest=i;}});
  state.flowCenter=closest;state.flowScroll=flow.scrollLeft;
  const count=filtered().length;$('#flow-position').textContent=count?`${String(closest+1).padStart(2,'0')} / ${String(count).padStart(2,'0')}`:'0 / 0';$('#flow-prev').disabled=!count||closest===0;$('#flow-next').disabled=!count||closest===count-1;
}
function centerFlow(index,smooth=true){
  const flow=$('#cover-flow'),cards=$$('.task-cover',flow);if(!cards.length||!flow.clientWidth||state.overview)return;
  index=Math.max(0,Math.min(cards.length-1,index));const el=cards[index];
  flow.scrollTo({left:el.offsetLeft+el.offsetWidth/2-flow.clientWidth/2,behavior:smooth&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant'});updateFlow();
}
function toggleOverview(value=!state.overview){
  if(value)state.flowScroll=$('#cover-flow').scrollLeft;
  const scroll=state.flowScroll;state.overview=value;$('#app').classList.toggle('overview',value);$('#task-stage').hidden=value;$('#overview-board').hidden=!value;$('#overview-modes').hidden=!value;$('#flow-footer').hidden=value||!filtered().length;$('#library-title').textContent=value?'任务总览':'任务牌组';$('#overview-label').textContent=value?'返回工作台':'全屏总览';$('#overview-toggle').setAttribute('aria-expanded',String(value));$('#overview-toggle [data-icon]').dataset.icon=value?'collapse':'expand';icons($('#overview-toggle'));renderOverview();
  if(!value){requestAnimationFrame(()=>{$('#cover-flow').scrollLeft=scroll;updateFlow();});}
}
function showSidebar(value){state.sidebar=value;$('#sidebar').hidden=!value;$('#side-rail').hidden=value;$('#app').classList.toggle('sidebar-collapsed',!value);$('#side-toggle').setAttribute('aria-expanded',String(value));$('#side-toggle').setAttribute('aria-label',value?'收起工作助手':'打开工作助手');requestAnimationFrame(()=>centerFlow(state.flowCenter,false));}
function panel(name){state.panel=name;$('#chat-pane').hidden=name!=='chat';$('#activity-pane').hidden=name!=='activity';$('#history-pane').hidden=name!=='history';$$('[data-panel]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.panel===name)));if(name==='activity')renderActivity();}
function renderDate(){
  $('#date-title').textContent=dateLabel(state.date);$('#today').disabled=state.date===today;
  const date=new Date(state.date+'T12:00:00');date.setDate(date.getDate()-(date.getDay()+6)%7);
  $('#week').innerHTML=Array.from({length:7},(_,i)=>{const d=new Date(date);d.setDate(d.getDate()+i);const key=localDate(d);return `<button data-day="${key}" class="${key===today?'is-today':''}" aria-pressed="${key===state.date}" aria-label="${key}"><span>${'一二三四五六日'[i]}</span><b>${d.getDate()}</b></button>`;}).join('');
  const due=tasks.filter(t=>t.due===state.date);$('#due-list').innerHTML=due.length?`<div class="due-label"><span></span>当日截止 · ${due.length}</div>`+due.map(t=>`<button class="due-item" data-due="${t.id}"><span>${escape(t.title)}</span>${icon('right')}</button>`).join(''):'<p class="due-empty">这一天没有截止任务</p>';
  renderActivity();
}
function localDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function shiftDay(n){const d=new Date(state.date+'T12:00:00');d.setDate(d.getDate()+n);state.date=localDate(d);renderDate();}
function eventMarkup(event,title=''){return `<article class="event"><time>${dateLabel(event.at)} · ${event.at.slice(11,16)}</time>${title?`<h4>${escape(title)}</h4>`:''}<p>${escape(event.text)}</p></article>`;}
function renderActivity(){const events=tasks.flatMap(t=>t.events.filter(e=>e.at.startsWith(state.date)).map(e=>({...e,title:t.title}))).sort((a,b)=>b.at.localeCompare(a.at));$('#activity-pane').innerHTML=`<h3>${dateLabel(state.date)}的推进</h3>${events.length?events.map(e=>eventMarkup(e,e.title)).join(''):'<p class="empty-copy">这一天还没有进展记录。</p>'}`;}
function showHistory(id){state.historyTask=id;showSidebar(true);panel('history');renderHistory();}
function renderHistory(){const t=tasks.find(t=>t.id===state.historyTask);$('#history-title').textContent=t.title;$('#history-events').innerHTML=t.events.length?t.events.map(e=>eventMarkup(e)).join(''):'<p class="empty-copy">记录第一条进展后，会在这里留下足迹。</p>';}
function renderRefs(){$('#chat-refs').innerHTML=state.refs.map(id=>`<span class="ref-chip"><span>@${escape(tasks.find(t=>t.id===id).title)}</span><button type="button" data-remove-ref="${id}" aria-label="移除引用">×</button></span>`).join('');}
function referenceCurrent(){if(!state.refs.includes(state.selected)){state.refs.push(state.selected);renderRefs();}showSidebar(true);panel('chat');$('#chat-input').focus();}
function sendMessage(text){
  if(composing||!text.trim())return;
  const refs=[...state.refs];state.messages.push({role:'user',text:text.trim(),refs});
  let reply='可以先引用一项任务，我们从它最近的进展和待办开始。';
  if(refs.length){const t=tasks.find(t=>t.id===refs[0]);if(/上次|回顾|哪里/.test(text)){reply=t.events[0]?`「${t.title}」最近的记录是：\n\n${t.events[0].text}`:'这项任务还没有进展记录，可以先记下当前的想法。';}else{const todo=t.todos.find(x=>!x[1]);reply=todo?`「${t.title}」还有这一步待推进：\n\n${todo[0]}\n\n可以先确定这一步完成时应看到什么结果，再开始行动。`:'这项任务暂时没有未完成待办。可以先记录当前状态，再补充下一步。';}}
  state.messages.push({role:'assistant',text:reply,refs});$('#messages').innerHTML=state.messages.map(m=>`<div class="message ${m.role}">${m.role==='user'&&m.refs.length?`<span class="message-ref">${m.refs.map(id=>'@'+escape(tasks.find(t=>t.id===id).title)).join(' · ')}</span>`:''}${escape(m.text)}</div>`).join('');$('.assistant-intro').hidden=true;$('.suggestions').hidden=true;$('#chat-input').value='';requestAnimationFrame(()=>$('#chat-stream').scrollTop=$('#chat-stream').scrollHeight);
}
function renderMonth(){
  const first=new Date(state.month+'-01T12:00:00'),start=new Date(first);start.setDate(1-(first.getDay()+6)%7);$('#month-title').textContent=`${first.getFullYear()}年 ${first.getMonth()+1}月`;
  $('#month-grid').innerHTML=Array.from({length:42},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);const key=localDate(d),due=tasks.filter(t=>t.due===key);return `<button data-month-day="${key}" class="${key.slice(0,7)!==state.month?'outside ':''}${key===state.date?'selected':''}" aria-label="${key}${due.length?'，'+due.length+'项截止':''}"><span>${d.getDate()}</span>${due.slice(0,2).map(t=>`<small>${escape(t.title)}</small>`).join('')}</button>`;}).join('');
  const due=tasks.filter(t=>t.due===state.date);$('#month-tasks').innerHTML=`<h4>${dateLabel(state.date)}</h4>${due.length?due.map(t=>`<button data-calendar-task="${t.id}">${escape(t.title)} ${icon('arrow')}</button>`).join(''):'<p>这一天没有截止任务</p>'}`;
}
function openCalendar(){state.month=state.date.slice(0,7);renderMonth();$('#calendar-dialog').showModal();}
function shiftMonth(n){const d=new Date(state.month+'-01T12:00:00');d.setMonth(d.getMonth()+n);state.month=localDate(d).slice(0,7);renderMonth();}
let composing=false;
document.addEventListener('compositionstart',()=>composing=true);
document.addEventListener('compositionend',()=>composing=false);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&!composing&&!$('dialog[open]')){if(state.overview){toggleOverview(false);$('#overview-toggle').focus();}else if(innerWidth<=960&&state.sidebar){showSidebar(false);$('#side-toggle').focus();}}});
document.addEventListener('click',e=>{
  const task=e.target.closest('[data-task]');if(task)selectTask(task.dataset.task);
  const group=e.target.closest('[data-group]');if(group){state.group=group.dataset.group;renderFilters();renderLibrary();}
  const quad=e.target.closest('[data-quadrant]');if(quad){state.quadrant=quad.dataset.quadrant;renderFilters();renderLibrary();}
  const layout=e.target.closest('[data-layout]');if(layout){state.layout=layout.dataset.layout;$$('[data-layout]').forEach(x=>setPressed(x,x===layout));renderOverview();}
  const day=e.target.closest('[data-day]');if(day){state.date=day.dataset.day;renderDate();}
  const due=e.target.closest('[data-due]');if(due)selectTask(due.dataset.due);
  const tab=e.target.closest('[data-panel]');if(tab)panel(tab.dataset.panel);
  const rail=e.target.closest('[data-open-panel]');if(rail){showSidebar(true);panel(rail.dataset.openPanel);}
  const ref=e.target.closest('[data-remove-ref]');if(ref){state.refs=state.refs.filter(id=>id!==ref.dataset.removeRef);renderRefs();}
  const prompt=e.target.closest('[data-prompt]');if(prompt){referenceCurrent();sendMessage(prompt.dataset.prompt);}
  const close=e.target.closest('.close-dialog');if(close)close.closest('dialog').close();
  const md=e.target.closest('[data-month-day]');if(md){state.date=md.dataset.monthDay;renderDate();renderMonth();}
  const mt=e.target.closest('[data-calendar-task]');if(mt){$('#calendar-dialog').close();selectTask(mt.dataset.calendarTask);}
});
$('#overview-toggle').onclick=()=>toggleOverview();
$('#side-toggle').onclick=()=>showSidebar(!state.sidebar);
$('#open-history').onclick=()=>showHistory(state.selected);
$('#back-chat').onclick=()=>panel('chat');
$('#clear-filters').onclick=resetFilters;$('#reset-empty').onclick=resetFilters;
$('#task-search').addEventListener('input',e=>{if(e.isComposing)return;state.search=e.target.value;renderFilters();renderLibrary();});
$('#task-search').addEventListener('compositionend',e=>{state.search=e.target.value;renderFilters();renderLibrary();});
$('#theme-toggle').onclick=()=>{document.body.classList.toggle('dark');updateAppearanceButtons();};
$('#motion-toggle').onclick=()=>{document.body.classList.toggle('motion-paused');updateAppearanceButtons();};
function updateAppearanceButtons(){const dark=document.body.classList.contains('dark'),paused=document.body.classList.contains('motion-paused');$('#theme-toggle').dataset.icon=dark?'sun':'moon';$('#theme-toggle').setAttribute('aria-label',dark?'切换浅色外观':'切换深色外观');$('#motion-toggle').setAttribute('aria-label',paused?'开启背景动效':'暂停背景动效');setPressed($('#motion-toggle'),!paused);icons($('#theme-toggle').parentElement);}
$('#flow-prev').onclick=()=>centerFlow(state.flowCenter-1);$('#flow-next').onclick=()=>centerFlow(state.flowCenter+1);
$('#cover-flow').addEventListener('scroll',()=>{cancelAnimationFrame(scrollFrame);scrollFrame=requestAnimationFrame(updateFlow);},{passive:true});
let wheelTarget=null,wheelTimer;
$('#cover-flow').addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey||filtered().length<2)return;const flow=e.currentTarget;const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;const amount=delta*(e.deltaMode===1?24:e.deltaMode===2?flow.clientWidth:1);const target=Math.max(0,Math.min(flow.scrollWidth-flow.clientWidth,(wheelTarget??flow.scrollLeft)+amount));if(target===flow.scrollLeft&&wheelTarget===null)return;e.preventDefault();wheelTarget=target;flow.scrollTo({left:target,behavior:'instant'});clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{wheelTarget=null;centerFlow(state.flowCenter);},150);},{passive:false});
$('#cover-flow').addEventListener('keydown',e=>{if(e.target!==e.currentTarget||e.isComposing)return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();centerFlow(state.flowCenter+(e.key==='ArrowRight'?1:-1));}if(e.key==='Enter'){e.preventDefault();const t=filtered()[state.flowCenter];if(t)selectTask(t.id);}if(e.key==='Home'){e.preventDefault();centerFlow(0);}if(e.key==='End'){e.preventDefault();centerFlow(filtered().length-1);}});
$('#day-prev').onclick=()=>shiftDay(-1);$('#day-next').onclick=()=>shiftDay(1);$('#today').onclick=()=>{state.date=today;renderDate();};
$('#open-calendar').onclick=openCalendar;$('#rail-calendar').onclick=openCalendar;$('#month-prev').onclick=()=>shiftMonth(-1);$('#month-next').onclick=()=>shiftMonth(1);
$('#reference-current').onclick=referenceCurrent;
$('#chat-form').onsubmit=e=>{e.preventDefault();sendMessage($('#chat-input').value);};
$('#chat-input').onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!e.isComposing&&!composing){e.preventDefault();$('#chat-form').requestSubmit();}};
$('#clear-chat').onclick=()=>{state.messages=[];state.refs=[];renderRefs();$('#messages').replaceChildren();$('.assistant-intro').hidden=false;$('.suggestions').hidden=false;panel('chat');};
$('#new-task').onclick=()=>$('#new-dialog').showModal();
$('#new-quadrants').innerHTML=quadrants.map(q=>`<label><input type="radio" name="quadrant" value="${q.id}" ${q.id==='nn'?'checked':''}>${q.label}</label>`).join('');
$('#new-form').onsubmit=e=>{e.preventDefault();if(composing)return;const data=new FormData(e.target);const title=String(data.get('title')||'').trim();if(!title)return;const id='task-'+crypto.randomUUID();tasks.push({id,title,group:String(data.get('group')),q:String(data.get('quadrant')),icon:'compass',notes:'',todos:[],events:[]});state.selected=id;resetFilters();renderStage();$('#new-dialog').close();e.target.reset();if(state.overview)toggleOverview(false);toast('任务已创建');requestAnimationFrame(()=>centerFlow(filtered().length-1));};
$$('dialog').forEach(dialog=>{dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});dialog.addEventListener('cancel',e=>{if(composing)e.preventDefault();});});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{showSidebar(state.sidebar);updateFlow();},120);});
icons();renderStage();renderFilters();renderLibrary();renderDate();showSidebar(state.sidebar);toggleOverview(state.overview);updateAppearanceButtons();
if(initial==='history')showHistory(state.selected);
if(initial==='editing')$('#edit-progress').click();
if(initial==='calendar')openCalendar();
if(initial==='activity')panel('activity');
$$('[data-layout]').forEach(el=>setPressed(el,el.dataset.layout===state.layout));
document.fonts.ready.then(()=>requestAnimationFrame(()=>centerFlow(Math.max(0,filtered().findIndex(t=>t.id===state.selected)),false)));
// Isolated design fixture: no Obsidian API, filesystem, model, or production storage is connected.
window.mockup={getSnapshot:()=>({selected:state.selected,group:state.group,quadrant:state.quadrant,visible:filtered().map(t=>t.id),overview:state.overview,sidebar:state.sidebar,refs:[...state.refs],flowCenter:state.flowCenter,drafts:Object.fromEntries(state.drafts),taskCount:tasks.length})};
