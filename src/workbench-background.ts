import { Modal, type App } from 'obsidian';
import type { WorkbenchBackground } from './stage-layout';
const photos={mountains:'https://images.unsplash.com/photo-1774112034535-f037b32b5884?auto=format&fit=crop&w=2400&q=85',architecture:'https://images.unsplash.com/photo-1706249609225-03cd345882f9?auto=format&fit=crop&w=2400&q=85'};
export function applyWorkbenchBackground(root:HTMLElement,value:WorkbenchBackground):void {
 let layer=root.querySelector<HTMLElement>(':scope > .wt-workbench-background');
 if(!layer){layer=document.createElement('div');layer.className='wt-workbench-background';layer.setAttribute('aria-hidden','true');root.prepend(layer);}
 const source=value.preset==='custom'?value.image:value.preset==='abstract'?'':photos[value.preset];
 if(layer.dataset.source!==source){
  layer.dataset.source=source;
  if(source)layer.style.backgroundImage='none';else layer.style.removeProperty('background-image');
  if(source){const img=new Image();img.onload=()=>{if(layer?.dataset.source===source)layer.style.backgroundImage=`url("${source}")`;};img.onerror=()=>{if(layer?.dataset.source===source)layer.style.backgroundImage='none';};img.src=source;}
 }
 layer.style.setProperty('--wt-background-brightness',String(value.brightness/100));
 layer.style.setProperty('--wt-background-blur',`${value.blur}px`);
 root.dataset.background=value.preset;
}
export class WorkbenchBackgroundModal extends Modal {
 private revision=0;private busy=false;
 constructor(app:App,private value:WorkbenchBackground,private save:(v:WorkbenchBackground)=>Promise<void>){super(app);this.value={...value};}
 onOpen():void {
  this.modalEl.addClass('wt-modal','wt-background-modal','wt-workbench-dialog');this.setTitle('背景设置');
  const content=this.contentEl;
  const label=content.createEl('label',{text:'背景'});
  const select=label.createEl('select',{attr:{'aria-label':'工作台背景'}});
  for(const [id,name] of [['abstract','银灰光影'],['mountains','雾蓝山景'],['architecture','建筑光影'],['custom','自定义图片']])select.createEl('option',{text:name,attr:{value:id}});
  select.value=this.value.preset;
  const file=content.createEl('input',{type:'file',attr:{accept:'image/png,image/jpeg,image/webp,image/avif','aria-label':'选择自定义背景图片'}});
  content.createEl('p',{text:'PNG、JPG、WebP 或 AVIF，最大 8 MB。',cls:'wt-background-hint'});
  const status=content.createEl('p',{attr:{role:'status'}});
  const update=async(next:WorkbenchBackground)=>{
   if(this.busy)return false;this.busy=true;status.textContent='正在保存…';
   try {await this.save(next);this.value={...next};status.textContent='背景已保存';return true;}
   catch{status.textContent='背景未保存，原背景已保留，请重试';return false;}
   finally{this.busy=false;select.value=this.value.preset;}
  };
  select.onchange=()=>{
   this.revision++;
   if(select.value==='custom'&&!this.value.image){select.value=this.value.preset;file.click();return;}
   void update({...this.value,preset:select.value as WorkbenchBackground['preset']});
  };
  file.onchange=()=>void (async()=>{
   const selected=file.files?.[0],revision=++this.revision;file.value='';if(!selected)return;
   if(this.busy){status.textContent='请等待当前背景保存完成';return;}
   if(selected.size>8*1024*1024||!['image/png','image/jpeg','image/webp','image/avif'].includes(selected.type)){status.textContent='请选择 8 MB 以内的 PNG、JPG、WebP 或 AVIF 图片';return;}
   status.textContent='正在读取图片…';
   try {
    const image=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(selected);});
    await new Promise<void>((resolve,reject)=>{const img=new Image();img.onload=()=>img.naturalWidth&&img.naturalHeight?resolve():reject(new Error('empty'));img.onerror=reject;img.src=image;});
    if(revision!==this.revision||!this.contentEl.isConnected)return;
    await update({...this.value,preset:'custom',image});
   }catch{if(revision===this.revision)status.textContent='无法读取图片，原背景已保留';}
  })();
  for(const [key,name,min,max] of [['brightness','明暗',55,130],['blur','柔焦',0,24]] as const){
   const row=content.createEl('label',{text:name});const input=row.createEl('input',{type:'range',attr:{'aria-label':`背景${name}`,min:String(min),max:String(max),step:'1'}});input.value=String(this.value[key]);
   const output=row.createEl('output',{text:input.value});input.oninput=()=>output.textContent=input.value;
   input.onchange=()=>void update({...this.value,[key]:Number(input.value)}).then(()=>{input.value=String(this.value[key]);output.textContent=input.value;});
  }
  const actions=content.createDiv({cls:'wt-background-actions'});
  actions.createEl('button',{text:'恢复银灰背景',attr:{type:'button'}}).onclick=()=>void update({...this.value,preset:'abstract',brightness:100,blur:4});
  actions.createEl('button',{text:'完成',cls:'wt-primary-action',attr:{type:'button'}}).onclick=()=>{if(!this.busy)this.close();};
 }
 onClose():void{this.revision++;this.contentEl.empty();}
}
