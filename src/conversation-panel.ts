import { QUADRANTS, quadrantId, type WorkTask, type WorkGroup } from './domain';
import { captureId } from './capture-id';
import { mountNewTaskForm, type NewTaskDraft } from './new-task-form';
import { type ConversationMessage, type ConversationProposal, type ConversationReply } from './work-conversation';

interface Session { id:string; messages:ConversationMessage[]; refs:string[]; draft:string; pending:ConversationProposal|null; formDraft?:NewTaskDraft }
interface Book { version:1; active:string; sessions:Session[] }
export interface ConversationHost {
  tasks:WorkTask[]; groups:WorkGroup[]; directory:string;
  read:()=>string; write:(value:string)=>Promise<void>;
  ask:(messages:ConversationMessage[],refs:string[])=>Promise<ConversationReply>;
  apply:(proposal:ConversationProposal)=>Promise<string>;
  settings:()=>void; history:(id:string|null)=>void; focus:(id:string)=>void;
  setIcon:(el:HTMLElement,name:string)=>void;
}
const newSession=():Session=>({id:captureId(),messages:[],refs:[],draft:'',pending:null});
const labels:Record<string,string>={progress:'追加进展',rename:'任务名称',notes:'任务详情',due:'截止日期',group:'分组',quadrant:'象限',todo_add:'新增待办',todo_toggle:'待办状态'};

/** A stable DOM island: board redraws must not replace a composing text node. */
export class ConversationPanel {
  readonly element:HTMLElement;
  readonly directory:string;
  private book:Book;
  private stream:HTMLElement;
  private input:HTMLTextAreaElement;
  private refsEl:HTMLElement;
  private picker:HTMLElement;
  private status:HTMLElement;
  private sessions:HTMLSelectElement;
  private sendButton:HTMLButtonElement;
  private stopButton:HTMLButtonElement;
  private busy=false;
  private saving=false;
  private composing=false;
  private epoch=0;
  private closed=false;
  private invalid=false;
  private persistQueue:Promise<void>=Promise.resolve();
  private createEditor?:ReturnType<typeof mountNewTaskForm>;
  constructor(private host:ConversationHost,doc:Document) {
    this.directory=host.directory;
    const s=newSession();this.book={version:1,active:s.id,sessions:[s]};
    try {
      const raw=host.read();if(raw){const b=JSON.parse(raw) as Book;
        if(b.version!==1||!Array.isArray(b.sessions)||!b.sessions.length||!b.sessions.some(s=>s.id===b.active)||b.sessions.some(s=>typeof s.draft!=='string'||!Array.isArray(s.refs)||s.refs.some(r=>typeof r!=='string')||!Array.isArray(s.messages)||s.messages.some(m=>!['user','assistant'].includes(m.role)||typeof m.text!=='string'||!Array.isArray(m.refs))))throw Error();
        this.book=b;
      }
    }catch{this.invalid=true;}
    this.element=doc.createElement('section');this.element.className='wt-conversation';this.element.setAttribute('aria-label','工作对话');
    const head=this.el(this.element,'header','wt-chat-header');this.el(head,'strong','','工作对话');
    const tools=this.el(head,'div','wt-chat-tools');
    this.button(tools,'活动记录',()=>host.history(null));
    this.button(tools,'模型设置',()=>host.settings());
    this.button(tools,'新对话',()=>{if(this.saving||this.composing)return;this.stop();const s=newSession();this.book.sessions.unshift(s);this.book.active=s.id;this.refresh();this.remember();this.input.focus();});
    this.sessions=this.el(this.element,'select','wt-chat-sessions');this.sessions.setAttribute('aria-label','选择会话');
    this.sessions.onchange=()=>{if(this.saving||this.composing){this.sessions.value=this.book.active;return;}this.stop();this.book.active=this.sessions.value;this.refresh();this.remember();};
    this.stream=this.el(this.element,'div','wt-chat-stream');this.stream.setAttribute('role','log');this.stream.setAttribute('aria-label','对话记录');
    const composer=this.el(this.element,'div','wt-chat-composer');
    this.refsEl=this.el(composer,'div','wt-chat-refs');
    const box=this.el(composer,'div','wt-chat-inputbox');
    this.picker=this.el(box,'div','wt-chat-picker');this.picker.hidden=true;
    this.input=this.el(box,'textarea');this.input.setAttribute('aria-label','对话内容');this.input.placeholder='整理想法，或 @卡片继续推进';this.input.maxLength=6000;this.input.rows=3;
    this.element.addEventListener('compositionstart',()=>this.composing=true);this.element.addEventListener('compositionend',()=>this.composing=false);
    this.input.oninput=()=>{this.session.draft=this.input.value;this.remember();if(/@[^@\n]*$/.test(this.input.value))this.showPicker();else this.picker.hidden=true;};
    this.input.onkeydown=e=>{if(e.isComposing||this.composing)return;if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();void this.send();}if(e.key==='Escape')this.picker.hidden=true;};
    const row=this.el(box,'div','wt-chat-sendrow');this.button(row,'@ 卡片',()=>this.showPicker());
    this.stopButton=this.button(row,'停止',()=>this.stop());this.stopButton.hidden=true;
    this.sendButton=this.button(row,'发送',()=>void this.send(),'wt-primary-action');
    const scope=this.el(composer,'details','wt-chat-scope');this.el(scope,'summary','','发送范围');this.el(scope,'p','','发送当前会话、分组名称及已引用卡片的属性、详情和最近 30 条历史；不读取整个仓库或上传附件。Enter 换行，⌘ / Ctrl Enter 发送。');
    this.status=this.el(composer,'div','wt-chat-status');this.status.setAttribute('role','alert');
    this.refresh();if(this.invalid){this.status.textContent='会话存档无法读取，已保留原数据。请先检查配置备份。';this.sendButton.disabled=true;}
  }
  private el<K extends keyof HTMLElementTagNameMap>(parent:HTMLElement,tag:K,cls='',text=''):HTMLElementTagNameMap[K]{const e=parent.ownerDocument.createElement(tag);e.className=cls;e.textContent=text;parent.append(e);return e;}
  private button(parent:HTMLElement,text:string,click:()=>void,cls='wt-secondary-action'){const b=this.el(parent,'button',cls,text);b.type='button';b.onclick=click;return b;}
  private get session(){return this.book.sessions.find(s=>s.id===this.book.active)!;}
  private async persist(){if(this.invalid)return;const value=JSON.stringify(this.book);const save=this.persistQueue.then(()=>this.host.write(value));this.persistQueue=save.catch(()=>{});try{await save;}catch{this.status.textContent='草稿暂存在当前窗口，写盘失败；请保持窗口打开并重试。';throw Error('对话草稿未能写盘');}}
  private remember(){void this.persist().catch(()=>{});}
  private refresh(){
    this.createEditor?.destroy();this.createEditor=undefined;
    this.sessions.replaceChildren();for(const s of this.book.sessions){const o=this.el(this.sessions,'option','',s.messages.find(m=>m.role==='user')?.text.slice(0,32)||'未命名会话');o.value=s.id;}this.sessions.value=this.book.active;
    this.input.value=this.session.draft;this.renderRefs();this.renderMessages();this.picker.hidden=true;this.status.textContent='';
  }
  private renderRefs(){this.refsEl.replaceChildren();for(const id of this.session.refs){const t=this.host.tasks.find(t=>t.id===id);const chip=this.el(this.refsEl,'span','wt-chat-ref');this.button(chip,'@'+(t?.title??'任务已移除'),()=>this.host.history(id));const remove=this.button(chip,'×',()=>{this.session.refs=this.session.refs.filter(r=>r!==id);this.renderRefs();this.remember();});remove.setAttribute('aria-label','移除引用');}}
  addReference(id:string){if(!this.host.tasks.some(t=>t.id===id))return;if(!this.session.refs.includes(id)){this.session.refs.push(id);this.renderRefs();this.remember();}this.input.focus();}
  private showPicker(){
    const query=this.input.value.match(/@([^@\n]*)$/)?.[1]?.trim()??'';this.picker.replaceChildren();this.picker.hidden=false;
    const results=this.host.tasks.filter(t=>`${t.title} ${t.groupName}`.includes(query)).slice(0,30);
    for(const t of results){const b=this.button(this.picker,`${t.title} · ${t.groupName} · ${t.status==='active'?'进行中':'已结束'} · ${t.id.slice(0,6)}`,()=>{this.input.value=this.input.value.replace(/@[^@\n]*$/,'');this.session.draft=this.input.value;this.addReference(t.id);this.picker.hidden=true;});b.title=t.title;}
    if(!results.length)this.el(this.picker,'p','','没有找到卡片');
  }
  private renderMessages(){
    const top=this.stream.scrollTop;this.stream.replaceChildren();
    if(!this.session.messages.length)this.el(this.stream,'p','wt-chat-empty','暂无消息');
    for(const m of this.session.messages){const message=this.el(this.stream,'div',`wt-chat-message is-${m.role}`);this.el(message,'div','wt-chat-byline',m.role==='user'?'你':'Tracelo');this.el(message,'div','wt-chat-text',m.text);if(m.refs.length){const refs=this.el(message,'div','wt-chat-sources');for(const id of m.refs){const t=this.host.tasks.find(t=>t.id===id);this.button(refs,t?.title??'任务已移除',()=>this.host.history(id));}}}
    if(this.session.pending)this.renderProposal(this.session.pending);
    this.stream.scrollTop=top;
  }
  private renderProposal(p:ConversationProposal){
    const card=this.el(this.stream,'section','wt-chat-proposal');this.el(card,'strong','',p.type==='create'?'新建任务 · 待确认':`${p.title} · 待确认`);
    const body=this.el(card,'div','wt-chat-proposal-body');
    if(p.type==='create'){
      const v=p.values;this.el(body,'h3','',v.title);
      for(const [name,text] of [['详情',v.notes],['分组',this.host.groups.find(g=>g.id===v.groupId)?.name??'未分组'],['象限',QUADRANTS.find(q=>q.important===v.important&&q.urgent===v.urgent)?.name],['截止日期',v.dueDate||'未设置'],['待办',v.todos.join('\n')],['初始进展',v.initialProgress]])if(text){this.el(body,'small','',name);this.el(body,'p','',text);}
    }else{
      const task=this.host.tasks.find(t=>t.id===p.taskId);
      for(const a of p.actions){this.el(body,'small','',labels[a.kind]??a.kind);let text=a.text??'';
        if(a.kind==='group')text=this.host.groups.find(g=>g.id===a.text)?.name??'未分组';
        if(a.kind==='quadrant')text=QUADRANTS.find(q=>q.id===a.text)?.name??text;
        if(a.kind==='todo_toggle')text=`${task?.todos?.find(t=>t.id===a.todoId)?.text??'待办已变化'} → ${a.done?'完成':'未完成'}`;
        const before=a.kind==='due'?task?.dueDate||'未设置':a.kind==='rename'?task?.title:a.kind==='group'?task?.groupName:a.kind==='quadrant'&&task?QUADRANTS.find(q=>q.id===quadrantId(task))?.name:undefined;
        this.el(body,'p','',before?`${before} → ${text||'清除'}`:text||'清空');
      }
    }
    const actions=this.el(card,'div','wt-chat-proposal-actions');
    this.button(actions,'不采用',()=>{if(this.saving)return;this.session.pending=null;this.session.formDraft=undefined;this.session.messages.push({role:'assistant',text:'此提议未采用，没有修改任务。',refs:[]});this.renderMessages();this.remember();});
    this.button(actions,'修改内容',()=>{if(this.saving)return;this.editProposal(p,body);});
    const apply=this.button(actions,p.type==='create'?'确认创建':'确认应用',()=>void this.apply(p),'wt-primary-action');apply.disabled=this.saving;
  }
  private editProposal(p:ConversationProposal,body:HTMLElement){
    body.replaceChildren();
    if(p.type==='create'){
      const v=p.values;const draft=this.session.formDraft??{...v,groupId:v.groupId??'',quadrant:quadrantId({important:!!v.important,urgent:!!v.urgent}),dueDate:v.dueDate??'',expanded:{todos:!!v.todos.length,due:!!v.dueDate,progress:!!v.initialProgress},creationId:p.id};
      this.createEditor?.destroy();this.createEditor=mountNewTaskForm(body,{groups:this.host.groups,draft,setIcon:this.host.setIcon,onChange:d=>{
        this.session.formDraft=d;
        const q=QUADRANTS.find(q=>q.id===d.quadrant)!;
        p.values={title:d.title,notes:d.notes,groupId:d.groupId||null,groupName:this.host.groups.find(g=>g.id===d.groupId)?.name??'未分组',important:q.important,urgent:q.urgent,dueDate:d.dueDate||null,todos:d.todos,initialProgress:d.initialProgress,images:d.images,creationId:p.id};
        this.remember();
      },onCancel:()=>{this.createEditor?.destroy();this.createEditor=undefined;this.renderMessages();},onSubmit:async values=>{p.values={...values,creationId:p.id};if(!await this.apply(p))throw Error(this.status.textContent||'保存失败');}});
      body.parentElement?.querySelector<HTMLElement>('.wt-chat-proposal-actions')?.setAttribute('hidden','');return;
    }
    for(const a of p.actions){const label=this.el(body,'label','wt-field',labels[a.kind]);
      if(a.kind==='group'||a.kind==='quadrant'||a.kind==='todo_toggle'){
        const select=this.el(label,'select');const options=a.kind==='group'?[['','未分组'],...this.host.groups.map(g=>[g.id,g.name])]:a.kind==='quadrant'?QUADRANTS.map(q=>[q.id,q.name]):[['true','完成'],['false','未完成']];
        for(const [id,name]of options){const o=this.el(select,'option','',name);o.value=id!;}select.value=a.kind==='todo_toggle'?String(a.done):a.text??'';select.onchange=()=>{if(a.kind==='todo_toggle')a.done=select.value==='true';else a.text=select.value;this.remember();};
      }else{const input=a.kind==='due'?this.el(label,'input'):this.el(label,'textarea');if(input instanceof HTMLInputElement)input.type='date';input.value=a.text??'';input.oninput=()=>{a.text=input.value;this.remember();};}
    }
  }
  private async apply(p:ConversationProposal){
    if(this.saving||this.closed||this.invalid||this.composing)return;this.saving=true;this.element.classList.add('is-saving');this.sessions.disabled=true;this.status.textContent='正在保存…';
    const session=this.session;
    try{
      await this.persist();const id=await this.host.apply(p);
      session.pending=null;session.formDraft=undefined;session.messages.push({role:'assistant',text:p.type==='create'?'已创建任务':'已更新任务',refs:[id]});
      this.renderMessages();this.status.textContent='';await this.persist();this.stream.scrollTop=this.stream.scrollHeight;
      return true;
    }catch(e){this.status.textContent=e instanceof Error?e.message:'保存失败，内容仍保留。';}
    finally{this.saving=false;this.element.classList.remove('is-saving');this.sessions.disabled=false;}
  }
  private async send(){
    if(this.busy||this.saving||this.composing||this.closed||this.invalid||!this.input.value.trim())return;
    if(this.session.pending){this.status.textContent='请先确认当前提议，或点“不采用”后继续讨论。';return;}
    if(/@[^@\n]*$/.test(this.input.value)){this.status.textContent='请先从候选中选择卡片，或移除未完成的 @引用。';this.showPicker();return;}
    const session=this.session,text=this.input.value.trim();const msg:ConversationMessage={role:'user',text,refs:[...session.refs]};
    const messages=[...session.messages,msg],ids=[...new Set(messages.flatMap(m=>m.refs))];
    this.busy=true;const token=++this.epoch;this.stopButton.hidden=false;this.sendButton.disabled=true;this.status.textContent='正在整理…';
    try{
      await this.persist();if(token!==this.epoch)return;
      const response=await this.host.ask(messages,ids);if(this.closed||token!==this.epoch)return;
      session.messages.push(msg,{role:'assistant',text:response.reply,refs:ids});session.pending=response.proposal;
      const option=Array.from(this.sessions.options).find(o=>o.value===session.id);if(option)option.textContent=session.messages.find(m=>m.role==='user')!.text.slice(0,32);
      if(session.draft===text||this.input.value===text){session.draft='';this.input.value='';}
      this.renderMessages();this.status.textContent='';await this.persist();this.stream.scrollTop=this.stream.scrollHeight;
    }catch(e){if(token===this.epoch)this.status.textContent=e instanceof Error?e.message:'连接失败，输入已保留。';}
    finally{if(token===this.epoch){this.busy=false;this.stopButton.hidden=true;this.sendButton.disabled=false;}}
  }
  private stop(){this.epoch++;if(this.busy)this.status.textContent='已停止，输入已保留。';this.busy=false;this.stopButton.hidden=true;this.sendButton.disabled=this.invalid;}
  async dispose(){this.closed=true;this.stop();this.createEditor?.destroy();await this.persist().catch(()=>{});}
}
