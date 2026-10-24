import { setIcon } from 'obsidian';
import { defaultStageLayout, insertStageModule, removeStageModule, resizeStagePair, type StageLayout, type StageModule } from './stage-layout';
const names: Record<StageModule,string>={progress:'进展',todos:'待办',details:'详情',files:'目录'};
/** Reparents existing card sections; never replaces the editor or its draft model. */
export function mountStagePanel(body:HTMLElement, modules:Record<StageModule,HTMLElement>, initial:StageLayout, files:boolean,
 save:(value:StageLayout|null)=>Promise<void>, composing:()=>boolean):void {
 let layout=structuredClone(initial), undo:StageLayout|null=null, busy=false, arranging=false;
 const bar=body.createDiv({cls:'wt-stage-layout-bar'});
 const toggle=bar.createEl('button',{text:'调整布局',attr:{type:'button','aria-pressed':'false'}});
 const revert=bar.createEl('button',{text:'撤销布局',attr:{type:'button'}}); revert.disabled=true;
 const reset=bar.createEl('button',{text:'恢复默认布局',attr:{type:'button'}});
 const status=bar.createSpan({cls:'wt-layout-status',attr:{role:'status'}});
 body.querySelector('.wt-card-heading-actions')?.prepend(bar);
 const area=body.createDiv({cls:'wt-stage-area'});
 const shelf=area.createDiv({cls:'wt-module-shelf',attr:{'aria-label':'内容模块'}});
 const canvas=area.createDiv({cls:'wt-stage-canvas',attr:{'aria-label':'展示台卡片布局'}});
 const parking=body.createDiv({cls:'wt-module-parking'});parking.hidden=true;
 const preview=area.createDiv({cls:'wt-module-preview',attr:{role:'tooltip'}});preview.hidden=true;
 let dragged:StageModule|null=null;
 let cancelResize:(()=>void)|null=null;
 let previewTimer:ReturnType<typeof setTimeout>|undefined;
 const hidePreview=()=>{clearTimeout(previewTimer);preview.hidden=true;};
 const clearDrop=()=>canvas.querySelectorAll('.is-drop-target').forEach(e=>e.classList.remove('is-drop-target'));
 const endDrag=()=>{dragged=null;area.removeClass('is-dragging');clearDrop();};
 const bindDrag=(node:HTMLElement,id:StageModule)=>{
  node.draggable=true;node.dataset.dragModule=id;
  node.ondragstart=event=>{if(busy||composing()){event.preventDefault();return;}event.stopPropagation();dragged=id;event.dataTransfer?.setData('application/x-tracelo-module',id);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';hidePreview();area.addClass('is-dragging');};
  node.ondragend=endDrag;
 };
 const markDrop=(col:number,row:number,newColumn:boolean)=>{
  positionSlots();
  clearDrop();
  canvas.querySelector<HTMLElement>(`[data-insert-col="${col}"][data-insert-row="${row}"][data-insert-kind="${newColumn?'column':'row'}"]`)?.addClass('is-drop-target');
 };
 const drop=(event:DragEvent,col:number,row:number,newColumn:boolean)=>{
  if(!dragged||busy||composing())return;event.preventDefault();event.stopPropagation();const id=dragged;endDrag();void commit(insertStageModule(layout,id,col,row,newColumn));
 };
 const focusState=()=>{ const node=body.ownerDocument.activeElement; return node instanceof HTMLElement&&body.contains(node)?node:null; };
 const commit=async(next:StageLayout|null)=> {
  if(busy||composing())return;
  const previous=structuredClone(layout); busy=true; status.textContent='保存布局…';
  try { await save(next); undo=previous;layout=structuredClone(next??defaultStageLayout(files));render();status.textContent='布局已保存'; }
  catch {layout=previous;applyRatios();status.textContent='布局未保存，请重试';}
  finally {busy=false;revert.disabled=!undo;}
 };
 const reveal=(id:StageModule,button:HTMLElement)=> {
  preview.empty(); preview.createEl('strong',{text:names[id]});
  // Plain text only: preview cannot trigger a task write or duplicate interactive controls.
  const copy=modules[id].cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.wt-directory-tree button').forEach(button=>button.replaceWith(document.createTextNode(`${button.textContent} `)));
  copy.querySelectorAll('button,form,textarea,input,select,.wt-card-composer,.wt-optional-actions,.wt-module-drag-icon').forEach(e=>e.remove());
  const text=(copy.textContent||'暂无内容').replace(/\s+/g,' ').slice(0,600);
  preview.createEl('p',{text});preview.hidden=false;
  preview.style.top=`${Math.min(button.offsetTop,Math.max(0,area.clientHeight-180))}px`;
 };
 for(const id of Object.keys(names) as StageModule[]) {
  const button=shelf.createEl('button',{cls:'wt-module-thumb',attr:{type:'button',draggable:'true','data-module':id,'aria-label':`${names[id]}模块，悬停预览或拖入展示台`}});
  const mini=button.createSpan({cls:`wt-module-mini mini-${id}`,attr:{'aria-hidden':'true'}});for(let i=0;i<4;i++)mini.createEl('i');
  const label=button.createSpan({cls:'wt-module-thumb-label',text:names[id]});label.createEl('small');
  button.onmouseenter=()=>{hidePreview();previewTimer=setTimeout(()=>{if(!dragged)reveal(id,button);},320);};button.onmouseleave=hidePreview;
  button.onfocus=()=>{if(!dragged)reveal(id,button);};button.onblur=hidePreview;
  button.onclick=()=>{const card=canvas.querySelector<HTMLElement>(`[data-stage-module="${id}"]`);if(card){card.focus({preventScroll:true});card.scrollIntoView({block:'nearest',inline:'nearest'});}};
  bindDrag(button,id);
 }
 const insert=(container:HTMLElement,col:number,row:number,newColumn:boolean)=> {
  const slot=container.createDiv({cls:`wt-stage-insert ${newColumn?'is-column':'is-row'}`,attr:{'data-insert-col':String(col),'data-insert-row':String(row),'data-insert-kind':newColumn?'column':'row'}});
  const add=slot.createEl('button',{text:'+',attr:{type:'button','aria-label':newColumn?`在第${col+1}列位置增加一列`:`在第${col+1}列第${row+1}行位置增加一行`}});
  add.onclick=()=> {
   if(busy||composing())return;
   hidePreview();canvas.querySelectorAll('.wt-module-picker').forEach(e=>e.remove());
   const picker=slot.createDiv({cls:'wt-module-picker',attr:{role:'group','aria-label':'选择内容模块'}});
   for(const id of Object.keys(names) as StageModule[]) {
    const choice=picker.createEl('button',{attr:{type:'button'}});choice.createSpan({text:names[id]});choice.createEl('small',{text:layout.columns.some(c=>c.rows.some(r=>r.module===id))?'移动已有卡片':'加入展示台'});
    choice.onclick=()=>void commit(insertStageModule(layout,id,col,row,newColumn));
   }
   const close=picker.createEl('button',{text:'取消',attr:{type:'button'}});close.onclick=()=>{picker.remove();add.focus();};
   picker.onkeydown=event=>{if(event.key==='Escape'){event.stopPropagation();picker.remove();add.focus();}};
   picker.querySelector('button')?.focus();
  };
  slot.createSpan({cls:'wt-drop-caption',text:newColumn?'放为新列':'放为新行',attr:{'aria-hidden':'true'}});
  slot.ondragover=event=>{if(!dragged||busy||composing())return;event.preventDefault();event.stopPropagation();markDrop(col,row,newColumn);};
  slot.ondragleave=()=>slot.removeClass('is-drop-target');
  slot.ondrop=event=>drop(event,col,row,newColumn);
  return slot;
 };
 const separator=(mount:HTMLElement,col:number,row:number|null)=> {
  const horizontal=row!==null;
  const handle=mount.createDiv({cls:`wt-stage-resizer ${horizontal?'is-row':'is-column'}`,attr:{role:'separator',tabindex:'0','aria-label':horizontal?'调整卡片高度':'调整列宽','aria-orientation':horizontal?'horizontal':'vertical','aria-valuemin':'15','aria-valuemax':'85','data-resize-col':String(col),'data-resize-row':String(row)}});
  const percentage=()=>{const a=row===null?layout.columns[col].width:layout.columns[col].rows[row].height;const b=row===null?layout.columns[col+1].width:layout.columns[col].rows[row!+1].height;return a/(a+b)*100;};
  handle.setAttribute('aria-valuenow',String(Math.round(percentage())));
  const revealInsert=(show:boolean)=>canvas.querySelector<HTMLElement>(`[data-insert-col="${horizontal?col:col+1}"][data-insert-row="${horizontal?row!+1:0}"][data-insert-kind="${horizontal?'row':'column'}"]`)?.classList.toggle('is-revealed',show);
  handle.onpointerenter=()=>{positionSlots();revealInsert(true);};handle.onpointerleave=()=>revealInsert(false);
  handle.onkeydown=event=>{
   if(busy||composing())return;
   const keys=horizontal?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight'];
   if(keys.includes(event.key)){event.preventDefault();void commit(resizeStagePair(layout,col,row,(event.key===keys[0]?-1:1)*.03));}
   else if(event.key==='Home'){event.preventDefault(); const a=row===null?layout.columns[col].width:layout.columns[col].rows[row!].height,b=row===null?layout.columns[col+1].width:layout.columns[col].rows[row!+1].height;void commit(resizeStagePair(layout,col,row,(b-a)/2));}
  };
  handle.onpointerdown=event=>{
   if(event.button!==0||busy||composing())return;
   event.preventDefault();hidePreview();handle.focus({preventScroll:true});handle.setPointerCapture(event.pointerId);
   const start=horizontal?event.clientY:event.clientX,base=structuredClone(layout);
   const bounds=(horizontal?handle.parentElement!:canvas).getBoundingClientRect();
   const length=horizontal?bounds.height:bounds.width;
   const move=(e:PointerEvent)=>{layout=resizeStagePair(base,col,row,((horizontal?e.clientY:e.clientX)-start)/length);applyRatios();handle.setAttribute('aria-valuenow',String(Math.round(percentage())));};
   const clear=()=>{handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;handle.onlostpointercapture=null;cancelResize=null;if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);};
   const finish=()=>{clear();const next=layout;layout=base;void commit(next);};
   cancelResize=()=>{clear();layout=base;applyRatios();handle.setAttribute('aria-valuenow',String(Math.round(percentage())));};
   handle.onpointermove=move;handle.onpointerup=finish;handle.onpointercancel=cancelResize;handle.onlostpointercapture=cancelResize;
  };
  return handle;
 };
 function applyRatios(){
  canvas.style.gridTemplateColumns=layout.columns.map(c=>`minmax(0,${c.width}fr)`).join(' 10px ');
  const columns=Array.from(canvas.querySelectorAll<HTMLElement>(':scope > .wt-stage-column'));
  const viewport=body.closest<HTMLElement>('.wt-task-stage-scroll');
  const bounded=getComputedStyle(canvas).display==='grid' && !!viewport;
  // The viewport owns the height; long text no longer enlarges every sibling card.
  // Keep room for headings/actions and a readable body when rows become very short.
  let height=0;
  if(bounded){
   const stage=viewport.querySelector<HTMLElement>('.wt-task-stage')!;
   const inset=area.getBoundingClientRect().top-viewport.getBoundingClientRect().top+viewport.scrollTop;
   height=viewport.clientHeight-inset-parseFloat(getComputedStyle(stage).paddingBottom)-1;
  }
  columns.forEach((column,i)=>{
   const rows=layout.columns[i].rows;
   const gaps=10*(rows.length-1);
   for(const [r,module] of Array.from(column.querySelectorAll<HTMLElement>(':scope > [data-stage-module]')).entries()){
    const scroll=module.querySelector<HTMLElement>('.wt-stage-module-scroll');
    if(!scroll)continue;
    const chrome=module.getBoundingClientRect().height-scroll.getBoundingClientRect().height;
    const minimum=chrome+(parseFloat(getComputedStyle(scroll).getPropertyValue('--wt-stage-reading-min'))||48);
    height=Math.max(height,minimum/rows[r].height+gaps);
   }
  });
  canvas.style.height=bounded?`${Math.max(120,Math.floor(height))}px`:'auto';
  columns.forEach((column,i)=>{
   column.style.gridTemplateRows=layout.columns[i].rows.map(r=>`minmax(0,${r.height}fr)`).join(' 10px ');
  });
  positionSlots();
 }
 function positionSlots(){
  const box=canvas.getBoundingClientRect();
  canvas.querySelectorAll<HTMLElement>(':scope > .wt-stage-insert.is-column').forEach(slot=>{
   const index=Number(slot.dataset.insertCol),handle=canvas.querySelector<HTMLElement>(`[data-resize-col="${index-1}"][data-resize-row="null"]`);
   const rect=handle?.getBoundingClientRect();slot.style.left=`${index===0?0:index===layout.columns.length?box.width:rect?rect.left+rect.width/2-box.left:0}px`;
  });
  canvas.querySelectorAll<HTMLElement>(':scope > .wt-stage-column').forEach((column,c)=>{
   const bounds=column.getBoundingClientRect();
   column.querySelectorAll<HTMLElement>(':scope > .wt-stage-insert.is-row').forEach(slot=>{
    const index=Number(slot.dataset.insertRow),handle=column.querySelector<HTMLElement>(`[data-resize-row="${index-1}"]`),rect=handle?.getBoundingClientRect();
    slot.style.top=`${index===0?0:index===layout.columns[c].rows.length?bounds.height:rect?rect.top+rect.height/2-bounds.top:0}px`;
   });
  });
 }
 function render(){
  hidePreview();
  const reading=Object.values(modules).map(module=>{const scroll=module.querySelector<HTMLElement>('.wt-stage-module-scroll');return {scroll,top:scroll?.scrollTop??0};});
  const active=focusState();
  const removedModule=active?.closest<HTMLElement>('[data-stage-module]')?.dataset.stageModule;
  const resizeKey=active?.classList.contains('wt-stage-resizer')?{col:active.dataset.resizeCol,row:active.dataset.resizeRow}:null;
  for(const m of Object.values(modules))parking.append(m);
  canvas.empty();
  layout.columns.forEach((column,c)=>{
   if(c)separator(canvas,c-1,null);
   const col=canvas.createDiv({cls:'wt-stage-column',attr:{'data-stage-column':String(c)}});
   column.rows.forEach((row,r)=>{
    if(r)separator(col,c,r-1);
    const module=modules[row.module];module.dataset.stageModule=row.module;
    module.tabIndex=-1;
    const heading=module.querySelector<HTMLElement>('h2,h4');
    if(heading){heading.addClass('wt-module-drag');heading.title='拖动调整视图位置';bindDrag(heading,row.module);if(!heading.querySelector('.wt-module-drag-icon')){const grip=document.createElement('span');grip.className='wt-module-drag-icon';grip.setAttribute('aria-hidden','true');setIcon(grip,'grip-vertical');heading.append(grip);}}
    const target=(event:DragEvent)=>{const rect=module.getBoundingClientRect(),edge=Math.min(45,rect.width*.15);return event.clientX<rect.left+edge?{col:c,row:0,newColumn:true}:event.clientX>rect.right-edge?{col:c+1,row:0,newColumn:true}:{col:c,row:r+(event.clientY>rect.top+rect.height/2?1:0),newColumn:false};};
    module.ondragover=event=>{if(!dragged||busy||composing())return;event.preventDefault();event.stopPropagation();const t=target(event);markDrop(t.col,t.row,t.newColumn);};
    module.ondrop=event=>{const t=target(event);drop(event,t.col,t.row,t.newColumn);};
    module.querySelector('.wt-module-remove')?.remove();
    const remove=module.createEl('button',{cls:'wt-module-remove',attr:{type:'button','aria-label':`删除${names[row.module]}视图`,title:`删除${names[row.module]}视图（保留内容）`}});setIcon(remove,'x');
    remove.onclick=()=>void commit(removeStageModule(layout,row.module));
    col.append(module);
   });
   // Insertion controls are absolutely positioned and do not affect the equal row grid.
   column.rows.forEach((_,r)=>{const slot=insert(col,c,r,false);slot.style.top=`${column.rows.slice(0,r).reduce((s,r)=>s+r.height,0)*100}%`;});
   const last=insert(col,c,column.rows.length,false);last.style.top='100%';
  });
  if(!layout.columns.length){const empty=canvas.createDiv({cls:'wt-stage-empty',text:'从左侧拖入内容，或选择视图加入展示台'});empty.ondragover=event=>{if(dragged){event.preventDefault();markDrop(0,0,true);}};empty.ondrop=event=>drop(event,0,0,true);}
  for(let c=0;c<=layout.columns.length;c++){
   const slot=insert(canvas,c,0,true);slot.style.left=`${layout.columns.slice(0,c).reduce((s,c)=>s+c.width,0)*100}%`;
  }
  shelf.querySelectorAll<HTMLElement>('[data-module]').forEach(b=>{const placed=layout.columns.some(c=>c.rows.some(r=>r.module===b.dataset.module));b.classList.toggle('is-placed',placed);b.querySelector('small')!.textContent=placed?'已放入':'拖入展示台';});
  applyRatios();for(const {scroll,top} of reading)if(scroll)scroll.scrollTop=top;
  if(active?.isConnected)active.focus({preventScroll:true});
  else if(resizeKey)canvas.querySelector<HTMLElement>(`[data-resize-col="${resizeKey.col}"][data-resize-row="${resizeKey.row}"]`)?.focus({preventScroll:true});
  else if(removedModule)shelf.querySelector<HTMLElement>(`[data-module="${removedModule}"]`)?.focus({preventScroll:true});
 }
 area.addEventListener('keydown',event=>{if(event.key==='Escape'&&cancelResize){event.preventDefault();event.stopPropagation();cancelResize();}});
 toggle.onclick=()=>{arranging=!arranging;area.classList.toggle('is-arranging',arranging);toggle.setAttribute('aria-pressed',String(arranging));toggle.textContent=arranging?'完成布局':'调整布局';};
 revert.onclick=()=>{if(undo)void commit(undo);};reset.onclick=()=>void commit(null);
 render();
 const observer=new ResizeObserver(()=>{if(!body.isConnected){observer.disconnect();return;}applyRatios();});
 observer.observe(canvas);observer.observe(body);const viewport=body.closest('.wt-task-stage-scroll');if(viewport)observer.observe(viewport);
 for(const module of Object.values(modules))observer.observe(module);
}
