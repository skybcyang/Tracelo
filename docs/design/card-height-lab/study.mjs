import '../../../tests/helpers/collection-fixture.mjs';
const {plugin}=window.cardFixture;
const group=plugin.groups[0];
for(const [title,notes,progress,todos] of [
 ['确认灰度发布名单','','名单已确认，等待发布窗口。',[]],
 ['整理组件交互规范','统一键盘焦点、禁用和提交反馈。','已完成表单控件梳理，待复核弹窗键盘顺序。',['梳理表单控件','验证键盘焦点','补充错误反馈','核对深色主题']],
 ['排查图片上传失败','部分大图上传后预览空白，需要检查解码和错误提示。','已复现大图问题。压缩后可以上传，继续验证原图解码以及失败重试。',['定位解码问题','补充失败重试']],
 ['更新帮助文档','','',[]],
 ['准备移动端验收','覆盖小屏、横屏和大字号。','基础交互通过；小屏输入键盘弹出后的按钮位置仍需验证。',['窄屏布局','大字号阅读','软键盘遮挡']],
 ['复核导出文件','核对图片链接、时间字段与完整历史。','字段映射已确认。',[]],
]) await plugin.addTask({title,groupId:group.id,groupName:group.name,notes,initialProgress:progress,todos,important:false,urgent:false,dueDate:null});
const bar=document.createElement('section');bar.className='height-lab';
bar.innerHTML=`<header><h1>卡片高度实验</h1><p>独立样机 · 使用真实卡片组件和临时任务，不写入你的仓库</p></header>
<div class="lab-controls" role="group" aria-label="高度方案">
<button data-mode="natural">自然高度</button><button data-mode="coarse">大单位 · 148 / 308 / 468</button><button data-mode="adaptive">动态小单位</button>
<div class="lab-scenes"><button data-scene="image">加载长图</button><button data-scene="text">增加长内容</button><button data-scene="guides" aria-pressed="false">对齐参考线</button><button data-scene="reset">重置实验</button></div></div>
<div class="lab-stats" aria-live="polite"></div>`;
document.body.prepend(bar);
let mode=new URLSearchParams(location.search).get('mode')||'adaptive';
if(!['natural','coarse','adaptive'].includes(mode))mode='adaptive';
let frame=0, imageAdded=false,textAdded=false;
const states=new Map();
const queue=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;layout()})};
const resize=new ResizeObserver(queue);
const root=document.querySelector('.view-content');
const toolbarResize=new ResizeObserver(()=>document.documentElement.style.setProperty('--lab-toolbar',`${bar.offsetHeight}px`));toolbarResize.observe(bar);
function bindGrids(){
 for(const grid of root.querySelectorAll('.wt-board .wt-card-grid')){
  if(states.has(grid))continue;
  const items=[...grid.children];states.set(grid,{items,count:0});resize.observe(grid);
  for(const card of items.filter(el=>el.matches('.wt-card'))){card.classList.add('lab-card');resize.observe(card.querySelector('.wt-card-body'))}
 }
 for(const [grid,state]of states)if(!grid.isConnected){resize.unobserve(grid);for(const card of state.items){const body=card.querySelector('.wt-card-body');if(body)resize.unobserve(body)}states.delete(grid)}
 const body=root.querySelector('.wt-board .wt-card .wt-card-body');
 if(body&&imageAdded&&!body.querySelector('.lab-image')){
  const image=document.createElement('img');image.className='lab-image';image.alt='实验长图：页面结构示意';
  image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#e5eee8"/><rect x="38" y="40" width="524" height="72" rx="10" fill="#356c55"/><g fill="#b9cec0"><rect x="38" y="146" width="248" height="300" rx="10"/><rect x="312" y="146" width="250" height="186" rx="10"/><rect x="312" y="360" width="250" height="340" rx="10"/><rect x="38" y="476" width="248" height="360" rx="10"/></g></svg>');
  body.insertBefore(image,body.querySelector('.wt-card-footer'));image.decode().then(queue);
 }
 if(body&&textAdded&&!body.querySelector('.lab-long-content')){
  const text=document.createElement('p');text.className='lab-long-content';text.textContent='增加一段完整验收记录，确认窄窗口中内容会自然换行，卡片自动升到下一档高度，其他列的位置保持稳定。'.repeat(8);body.insertBefore(text,body.querySelector('.wt-card-footer'));
 }
}
function layout(){
 bindGrids();let count=0,totalSlack=0,maxSlack=0,unitSeen=0;
 for(const [grid,state]of states){
  const gap=parseFloat(getComputedStyle(grid).columnGap)||12;
  const tracks=getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length;
  const columns=Math.min(tracks,state.items.length);
  if(columns!==state.count){
   state.count=columns;const focus=document.activeElement;
   const wrappers=Array.from({length:columns},()=>{const div=document.createElement('div');div.className='lab-column';return div});
   state.items.forEach((item,index)=>wrappers[index%columns].append(item));grid.replaceChildren(...wrappers);
   if(focus&&grid.contains(focus))focus.focus({preventScroll:true});
  }
  const width=state.items[0]?.getBoundingClientRect().width||260;
  // Lock the unit to a width band: content edits never change the whole group's unit.
  const unit=mode==='coarse'?148:width<290?24:width<340?28:32;
  grid.style.setProperty('--lab-pitch',`${unit+gap}px`);
  for(const card of state.items.filter(el=>el.matches('.wt-card'))){
   const body=card.querySelector('.wt-card-body');
   const expanded=card.classList.contains('is-expanded');
   const prior=expanded?0:Number(card.dataset.slack||0);
   const natural=body.getBoundingClientRect().height+2-prior;
   const steps=Math.ceil((natural+gap-.01)/(unit+gap));
   const height=mode==='natural'?natural:steps*(unit+gap)-gap;
   const slack=Math.max(0,height-natural);
   card.dataset.slack=String(expanded?0:slack);
   card.style.setProperty('--lab-slack',`${expanded?0:slack}px`);
   card.style.height=`${height}px`;
   card.dataset.heightLabel=mode==='natural'?`${Math.round(height)} px`:`${steps}格 · ${Math.round(height)} px`;
   card.dataset.naturalHeight=String(natural);card.dataset.extraHeight=String(slack);card.dataset.unit=String(unit);
   count++;totalSlack+=slack;maxSlack=Math.max(maxSlack,slack);unitSeen=unit;
  }
 }
 bar.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
 bar.querySelector('.lab-stats').innerHTML=`<span>排列：<strong>稳定列，不跨列跳动</strong></span><span>单位：<strong>${mode==='natural'?'无取整':unitSeen+' px + 12 px 间距'}</strong></span><span>平均额外留白：<strong>${(totalSlack/Math.max(1,count)).toFixed(1)} px</strong></span><span>最大额外留白：<strong>${maxSlack.toFixed(1)} px</strong></span><span>点击任意卡片可展开 / 收起</span>`;
}
new MutationObserver(queue).observe(root,{childList:true,subtree:true});
bar.addEventListener('click',async(event)=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.mode){mode=button.dataset.mode;history.replaceState(null,'',`?mode=${mode}`);layout();return}
 if(button.dataset.scene==='image'&&!imageAdded){
  imageAdded=true;button.setAttribute('aria-pressed','true');layout();
 }else if(button.dataset.scene==='text'&&!textAdded){
  textAdded=true;button.setAttribute('aria-pressed','true');layout();
 }else if(button.dataset.scene==='guides'){const on=root.classList.toggle('lab-guide');button.setAttribute('aria-pressed',String(on))}
 else if(button.dataset.scene==='reset')location.reload();
});
layout();
