const $=s=>document.querySelector(s);
const presets={
 mountains:{src:'https://images.unsplash.com/photo-1774112034535-f037b32b5884?auto=format&fit=crop&w=2400&q=85'},
 architecture:{src:'https://images.unsplash.com/photo-1706249609225-03cd345882f9?auto=format&fit=crop&w=2400&q=85'}
};
const blankBackground='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22/%3E';
const preferenceKey='tracelo.modular-stage.background.v1';
let preferences={name:'abstract',brightness:100,blur:8},customAsset=null,customUrl=null,revision=0,notify=()=>{};
try{const saved=JSON.parse(localStorage.getItem(preferenceKey)||'null');if(saved){preferences.name=['abstract','mountains','architecture','custom'].includes(saved.name)?saved.name:'abstract';preferences.brightness=Math.max(50,Math.min(140,Number(saved.brightness)||100));preferences.blur=Math.max(0,Math.min(20,Number(saved.blur)||0));}}catch{}
let database;
function getDatabase(){return database??=new Promise((resolve,reject)=>{const request=indexedDB.open('tracelo-modular-stage-design',1);request.onupgradeneeded=()=>request.result.createObjectStore('assets');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function assetStorage(mode,value){const db=await getDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction('assets',mode),store=tx.objectStore('assets');const request=mode==='readonly'?store.get('custom-background'):store.put(value,'custom-background');tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Background transaction aborted'));});}
function persist(){try{localStorage.setItem(preferenceKey,JSON.stringify(preferences));return true;}catch{notify('背景暂时无法记住，当前画面会保留');return false;}}
function controls(){
 $('#background-select').value=preferences.name;
 document.querySelectorAll('[data-background-preset]').forEach(e=>e.setAttribute('aria-pressed',String(e.dataset.backgroundPreset===preferences.name)));
 $('#background-brightness').value=preferences.brightness;$('#background-brightness-value').value=preferences.brightness+'%';
 $('#background-blur').value=preferences.blur;$('#background-blur-value').value=Math.round(preferences.blur/20*100)+'%';
 const tuning=$('.background-tuning');tuning.classList.toggle('is-disabled',preferences.name==='abstract');tuning.querySelectorAll('input').forEach(e=>e.disabled=preferences.name==='abstract');
 $('#custom-background-name').textContent=customAsset?customAsset.name:'使用自己的图片';$('#choose-background-image').textContent=customAsset?'替换图片':'选择图片';
}
function adjustments(){document.body.style.setProperty('--photo-brightness',String(preferences.brightness/100));document.body.style.setProperty('--photo-blur',preferences.blur+'px');}
function selectBackground(name,{save=true}={}){
 revision++;const photo=$('#background-photo');
 if(name==='custom'&&!customAsset){$('#background-dialog').showModal();controls();return;}
 preferences.name=presets[name]||name==='custom'?name:'abstract';
 photo.onload=null;photo.onerror=()=>{photo.hidden=true;document.body.dataset.background='abstract';notify('背景暂时未能载入，已显示银灰背景');};
 document.body.dataset.background=preferences.name;photo.hidden=preferences.name==='abstract';
 if(preferences.name==='abstract')photo.src=blankBackground;else photo.src=preferences.name==='custom'?customUrl:presets[preferences.name].src;
 adjustments();controls();
 if(save){persist();const url=new URL(location.href);url.searchParams.set('background',preferences.name);history.replaceState(null,'',url);}
}
async function useFile(file){
 if(!file)return;const status=$('#custom-background-status'),button=$('#choose-background-image'),startRevision=revision;
 if(!['image/png','image/jpeg','image/webp','image/avif'].includes(file.type)){status.textContent='请选择 PNG、JPG、WebP 或 AVIF 图片。';return;}
 button.disabled=true;status.textContent='正在保存图片…';const candidateUrl=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=candidateUrl;await image.decode();if(!image.naturalWidth||!image.naturalHeight)throw Error('Invalid image');
  const record={name:file.name,blob:file,width:image.naturalWidth,height:image.naturalHeight};
  await assetStorage('readwrite',record);const saved=await assetStorage('readonly');if(!saved||saved.blob.size!==file.size)throw Error('Background readback failed');
  const previousUrl=customUrl;customAsset=saved;customUrl=candidateUrl;
  if(revision===startRevision)selectBackground('custom');else controls();
  if(previousUrl)URL.revokeObjectURL(previousUrl);status.textContent='图片已保存，可以随时替换或切回预设。';
 }catch{URL.revokeObjectURL(candidateUrl);status.textContent='图片未能保存，请换一张或重试，原背景仍保留。';}
 finally{button.disabled=false;$('#custom-background-file').value='';}
}
export async function initBackgrounds(query,toast){
 notify=toast;
 $('#background-settings').onclick=()=>{$('#background-dialog').showModal();controls();};
 $('#background-select').onchange=e=>selectBackground(e.target.value);
 document.querySelectorAll('[data-background-preset]').forEach(e=>e.onclick=()=>selectBackground(e.dataset.backgroundPreset));
 $('#choose-background-image').onclick=()=>$('#custom-background-file').click();
 $('#custom-background-file').onchange=e=>useFile(e.target.files[0]);
 $('#restore-background').onclick=()=>{preferences.brightness=100;preferences.blur=8;selectBackground('abstract');};
 for(const [id,key] of [['background-brightness','brightness'],['background-blur','blur']])$('#'+id).oninput=e=>{preferences[key]=Number(e.target.value);adjustments();controls();persist();};
 const initial=query.get('background')||preferences.name;
 if(initial!=='custom')selectBackground(initial,{save:false});else{document.body.dataset.background='abstract';controls();}
 const loadingRevision=revision;
 try{const stored=await assetStorage('readonly');if(stored){customAsset=stored;customUrl=URL.createObjectURL(stored.blob);controls();}if(revision===loadingRevision&&initial==='custom'){if(customAsset)selectBackground('custom',{save:false});else selectBackground('abstract',{save:false});}}
 catch{if(initial==='custom'){selectBackground('abstract',{save:false});$('#custom-background-status').textContent='无法读取自定义图片，请重新选择。';}}
}
export function getBackgroundSnapshot(){return {background:document.body.dataset.background,customBackground:!!customAsset,backgroundAdjustments:{brightness:preferences.brightness,blur:preferences.blur}};}
