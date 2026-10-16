import { setIcon } from 'obsidian';
import { defaultStageLayout, insertStageModule, removeStageModule, resizeStagePair, type StageLayout, type StageModule } from './stage-layout';
const names: Record<StageModule,string>={progress:'进展',todos:'待办',details:'详情',files:'目录'};
const icons: Record<StageModule,string>={progress:'message-square',todos:'list-checks',details:'file-text',files:'folder'};
/** Reparents existing card sections; never replaces the editor or its draft model. */
export function mountStagePanel(body:HTMLElement, modules:Record<StageModule,HTMLElement>, initial:StageLayout, files:boolean,
 save:(value:StageLayout|null)=>Promise<void>, composing:()=>boolean):void {
 let layout=structuredClone(initial), undo:StageLayout|null=null, busy=false, arranging=false;
 const bar=body.createDiv({cls:'wt-stage-layout-bar'});
 const toggle=bar.createEl('button',{text:'调整布局',attr:{type:'button','aria-pressed':'false'}});
 const revert=bar.createEl('button',{text:'撤销布局',attr:{type:'button'}}); revert.disabled=true;
 const reset=bar.createEl('button',{text:'恢复默认布局',attr:{type:'button'}});
 const status=bar.createSpan({cls:'wt-layout-status',attr:{role:'status'}});
 const area=body.createDiv({cls:'wt-stage-area'});
 const shelf=area.createDiv({cls:'wt-module-shelf',attr:{'aria-label':'内容模块'}});
 const canvas=area.createDiv({cls:'wt-stage-canvas',attr:{'aria-label':'展示台卡片布局'}});
 const parking=body.createDiv({cls:'wt-module-parking'});parking.hidden=true;
 const preview=area.createDiv({cls:'wt-module-preview',attr:{role:'tooltip'}});preview.hidden=true;
 let dragged:StageModule|null=null;
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
  const text=(modules[id].innerText||'暂无内容').replace(/\s+/g,' ').slice(0,260);
  preview.createEl('p',{text});preview.hidden=false;
  preview.style.top=`${Math.min(button.offsetTop,Math.max(0,area.clientHeight-180))}px`;
 };
 for(const id of Object.keys(names) as StageModule[]) {
  const button=shelf.createEl('button',{cls:'wt-module-thumb',attr:{type:'button',draggable:'true','data-module':id,'aria-label':`${names[id]}模块，悬停预览或拖入展示台`}});
  setIcon(button.createSpan({cls:'wt-module-mini'}),icons[id]);button.createSpan({text:names[id]});
  button.onmouseenter=()=>reveal(id,button);button.onmouseleave=()=>preview.hidden=true;
  button.onfocus=()=>reveal(id,button);button.onblur=()=>preview.hidden=true;
  button.ondragstart=event=>{if(composing()){event.preventDefault();return;} dragged=id;event.dataTransfer?.setData('application/x-tracelo-module',id);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';preview.hidden=true;area.addClass('is-dragging');};
  button.ondragend=()=>{dragged=null;area.removeClass('is-dragging');};
 }
 const insert=(container:HTMLElement,col:number,row:number,newColumn:boolean)=> {
  const slot=container.createDiv({cls:`wt-stage-insert ${newColumn?'is-column':'is-row'}`});
  const add=slot.createEl('button',{text:'+',attr:{type:'button','aria-label':newColumn?`在第${col+1}列位置增加一列`:`在第${col+1}列第${row+1}行位置增加一行`}});
  add.onclick=()=> {
   if(busy||composing())return;
   slot.querySelector('.wt-module-picker')?.remove();
   const picker=slot.createDiv({cls:'wt-module-picker',attr:{role:'group','aria-label':'选择内容模块'}});
   for(const id of Object.keys(names) as StageModule[]) picker.createEl('button',{text:names[id],attr:{type:'button'}}).onclick=()=>void commit(insertStageModule(layout,id,col,row,newColumn));
   const close=picker.createEl('button',{text:'取消',attr:{type:'button'}});close.onclick=()=>{picker.remove();add.focus();};
   picker.onkeydown=event=>{if(event.key==='Escape'){event.stopPropagation();picker.remove();add.focus();}};
   picker.querySelector('button')?.focus();
  };
  slot.ondragover=event=>{if(!dragged)return;event.preventDefault();slot.addClass('is-drop-target');};
  slot.ondragleave=()=>slot.removeClass('is-drop-target');
  slot.ondrop=event=>{if(!dragged)return;event.preventDefault();event.stopPropagation();const id=dragged;dragged=null;area.removeClass('is-dragging');void commit(insertStageModule(layout,id,col,row,newColumn));};
  return slot;
 };
 const separator=(mount:HTMLElement,col:number,row:number|null)=> {
  const horizontal=row!==null;
  const handle=mount.createDiv({cls:`wt-stage-resizer ${horizontal?'is-row':'is-column'}`,attr:{role:'separator',tabindex:'0','aria-label':horizontal?'调整卡片高度':'调整列宽','aria-orientation':horizontal?'horizontal':'vertical','aria-valuemin':'15','aria-valuemax':'85','data-resize-col':String(col),'data-resize-row':String(row)}});
  const percentage=()=>{const a=row===null?layout.columns[col].width:layout.columns[col].rows[row].height;const b=row===null?layout.columns[col+1].width:layout.columns[col].rows[row!+1].height;return a/(a+b)*100;};
  handle.setAttribute('aria-valuenow',String(Math.round(percentage())));
  handle.onkeydown=event=>{
   if(busy||composing())return;
   const keys=horizontal?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight'];
   if(keys.includes(event.key)){event.preventDefault();void commit(resizeStagePair(layout,col,row,(event.key===keys[0]?-1:1)*.03));}
   else if(event.key==='Home'){event.preventDefault(); const a=row===null?layout.columns[col].width:layout.columns[col].rows[row!].height,b=row===null?layout.columns[col+1].width:layout.columns[col].rows[row!+1].height;void commit(resizeStagePair(layout,col,row,(b-a)/2));}
  };
  handle.onpointerdown=event=>{
   if(event.button!==0||busy||composing())return;
   event.preventDefault();handle.setPointerCapture(event.pointerId);
   const start=horizontal?event.clientY:event.clientX,base=structuredClone(layout);
   const bounds=(horizontal?handle.parentElement!:canvas).getBoundingClientRect();
   const length=horizontal?bounds.height:bounds.width;
   const move=(e:PointerEvent)=>{layout=resizeStagePair(base,col,row,((horizontal?e.clientY:e.clientX)-start)/length);applyRatios();handle.setAttribute('aria-valuenow',String(Math.round(percentage())));};
   const finish=()=>{handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;const next=layout;layout=base;void commit(next);};
   handle.onpointermove=move;handle.onpointerup=finish;handle.onpointercancel=()=>{handle.onpointermove=null;layout=base;applyRatios();};
  };
  return handle;
 };
 function applyRatios(){
  canvas.style.gridTemplateColumns=layout.columns.map(c=>`minmax(0,${c.width}fr)`).join(' 10px ');
  canvas.querySelectorAll<HTMLElement>(':scope > .wt-stage-column').forEach((c,i)=>{
   c.style.gridTemplateRows=layout.columns[i].rows.map(r=>`minmax(min-content,${r.height}fr)`).join(' 10px ');
  });
 }
 function render(){
  const active=focusState();
  const resizeKey=active?.classList.contains('wt-stage-resizer')?{col:active.dataset.resizeCol,row:active.dataset.resizeRow}:null;
  for(const m of Object.values(modules))parking.append(m);
  canvas.empty();
  layout.columns.forEach((column,c)=>{
   if(c)separator(canvas,c-1,null);
   const col=canvas.createDiv({cls:'wt-stage-column',attr:{'data-stage-column':String(c)}});
   column.rows.forEach((row,r)=>{
    if(r)separator(col,c,r-1);
    const module=modules[row.module];module.dataset.stageModule=row.module;
    module.querySelector('.wt-module-remove')?.remove();
    const remove=module.createEl('button',{cls:'wt-module-remove',attr:{type:'button','aria-label':`收回${names[row.module]}模块`}});setIcon(remove,'x');
    remove.onclick=()=>void commit(removeStageModule(layout,row.module));
    remove.disabled=layout.columns.flatMap(c=>c.rows).length<=1;
    col.append(module);
   });
   // Insertion controls are absolutely positioned and do not affect the equal row grid.
   column.rows.forEach((_,r)=>{const slot=insert(col,c,r,false);slot.style.top=`${column.rows.slice(0,r).reduce((s,r)=>s+r.height,0)*100}%`;});
   const last=insert(col,c,column.rows.length,false);last.style.top='100%';
  });
  for(let c=0;c<=layout.columns.length;c++){
   const slot=insert(canvas,c,0,true);slot.style.left=`${layout.columns.slice(0,c).reduce((s,c)=>s+c.width,0)*100}%`;
  }
  shelf.querySelectorAll<HTMLElement>('[data-module]').forEach(b=>b.classList.toggle('is-placed',layout.columns.some(c=>c.rows.some(r=>r.module===b.dataset.module))));
  applyRatios();if(active?.isConnected)active.focus({preventScroll:true});
  else if(resizeKey)canvas.querySelector<HTMLElement>(`[data-resize-col="${resizeKey.col}"][data-resize-row="${resizeKey.row}"]`)?.focus({preventScroll:true});
 }
 toggle.onclick=()=>{arranging=!arranging;area.classList.toggle('is-arranging',arranging);toggle.setAttribute('aria-pressed',String(arranging));toggle.textContent=arranging?'完成布局':'调整布局';};
 revert.onclick=()=>{if(undo)void commit(undo);};reset.onclick=()=>void commit(null);
 render();
}
