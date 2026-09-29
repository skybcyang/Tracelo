// Simulated Obsidian boundary for design review. All vault writes use Maps in memory.
export * from '../../../tests/helpers/obsidian-browser.mjs';
import {ItemView as HostView, Modal as HostModal, Menu as HostMenu} from '../../../tests/helpers/obsidian-browser.mjs';

export function setIcon(element,name){
  element.firstChild?.remove();
  const key=name.replace(/^lucide-/,'').split('-').map(part=>part[0].toUpperCase()+part.slice(1)).join('');
  const icon=window.lucide.icons[key] || window.lucide.icons.CircleDot;
  element.append(window.lucide.createElement(icon,{'stroke-width':1.7,'aria-hidden':'true'}));
}
export function getIconIds(){return Object.keys(window.lucide.icons).map(key=>key.replace(/([a-z0-9])([A-Z])/g,'$1-$2').toLowerCase());}
export class ItemView extends HostView{
  constructor(leaf){super(leaf);document.querySelector('#plugin-mount').append(this.contentEl);}
}
export class Modal extends HostModal{
  constructor(app){
    super(app);
    this.modalEl.setAttribute('role','dialog');this.modalEl.setAttribute('aria-modal','true');
    this.titleEl.id='modal-'+crypto.randomUUID();this.modalEl.setAttribute('aria-labelledby',this.titleEl.id);
    this.containerEl.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();}
      if(event.key==='Tab'){
        const controls=[...this.modalEl.querySelectorAll('button,input,textarea,select,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    });
  }
  open(){this.previewReturnFocus=document.activeElement;super.open();requestAnimationFrame(()=>{if(!this.modalEl.contains(document.activeElement))this.modalEl.querySelector('input,button,textarea,select')?.focus();});}
  close(){super.close();this.previewReturnFocus?.isConnected&&this.previewReturnFocus.focus();}
}
export class Menu extends HostMenu{
  showAtMouseEvent(event){
    super.showAtMouseEvent(event);this.el.classList.add('preview-menu');
    this.el.style.left=Math.min(event.clientX,innerWidth-240)+'px';
    this.el.style.top=Math.min(event.clientY,innerHeight-this.el.offsetHeight-12)+'px';
    this.el.querySelector('button')?.focus();
    this.el.addEventListener('keydown',e=>{if(e.key==='Escape')this.el.remove();});
    const outside=e=>{if(!this.el.contains(e.target)){this.el.remove();document.removeEventListener('pointerdown',outside);}};
    document.addEventListener('pointerdown',outside);
  }
}
