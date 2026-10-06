import type { Modal, App } from 'obsidian';
import { createSmartCaptureModal } from './smart-capture-modal';
import { CONNECTION_TEST_TEXT, connectionTestContext, extractCapture, normalizeCaptureConfig, type CaptureConfig } from './smart-capture';
import { parseGroupArchive, parseTaskMarkdown, serializeLegacyTaskMarkdown } from './archive';
import { buildNewTask } from './new-task-form';
import type { WorkTask, WorkGroup } from './domain';
import { captureId } from './capture-id';
import { prepareImages } from './draft-images';
import { setBrandMark } from './brand';

/** Native hosts own persistence and HTTP; the shared settings form edits credentials. */
export function mountDesktopSmartCapture(options: { send(message: Record<string, unknown>): void; setIcon(el: HTMLElement, icon: string): void; isWin: boolean; container: HTMLElement; onResize?(): void; onClose?(): void }) {
  class NativeModal {
    modalEl = document.createElement('dialog');
    titleEl = this.modalEl.createEl('h2', { cls: 'modal-title' });
    contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
    private returnFocus = document.activeElement as HTMLElement | null;
    private observer = new MutationObserver(() => options.onResize?.());
    constructor(_app: unknown) {
      this.modalEl.className = 'modal wt-modal'; this.modalEl.setAttribute('aria-modal', 'true');
      const chrome = document.createElement('div'); chrome.className = 'wt-smart-chrome';
      setBrandMark(chrome.createSpan({ cls: 'capture-brand-icon', attr: { 'aria-hidden':'true' } }));
      chrome.createSpan({ text:'Tracelo' });
      const close = chrome.createEl('button', { cls:'modal-close-button', text:'×', attr:{type:'button','aria-label':'关闭当前页面'} });
      close.onclick = () => this.close(); this.modalEl.prepend(chrome);
    }
    setTitle(title: string) { this.titleEl.textContent = title; this.modalEl.setAttribute('aria-label', title); }
    onOpen() {}
    onClose() {}
    open() {
      const embedded = this.modalEl.classList.contains('wt-smart-panel');
      (embedded ? options.container : document.body).append(this.modalEl);
      if (embedded) { this.modalEl.removeAttribute('aria-modal'); this.modalEl.setAttribute('role','region'); this.modalEl.show(); }
      else this.modalEl.showModal();
      this.onOpen();
      this.observer.observe(this.modalEl, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['hidden','class'] }); options.onResize?.();
      this.modalEl.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
      if (!embedded) this.modalEl.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); if (!event.isComposing && event.keyCode !== 229) this.close(); } });
    }
    close() { if (!this.modalEl.isConnected) return; this.observer.disconnect(); this.onClose(); this.modalEl.close(); this.modalEl.remove(); this.returnFocus?.focus(); if(this.modalEl.classList.contains('wt-smart-panel')) options.onClose?.(); options.onResize?.(); }
  }
  const SmartModal = createSmartCaptureModal(NativeModal as unknown as typeof Modal, { isWin: options.isWin }, options.setIcon);
  let workspace = '', configured = false, groupsSource = '', groups: WorkGroup[] = [], tasks: WorkTask[] = [];
  let modal: InstanceType<typeof SmartModal> | undefined;
  let generation = 0, opening = 0;
  // Retain unacknowledged edits if the native host changes location mid-write.
  const unsaved = new Map<string, Record<string,string>>();
  const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  function transport(scope: string, method: string, params: Record<string,unknown> = {}): Promise<any> {
    const id = captureId();
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('快捷工具响应超时，内容已保留，请重试。')); }, 70000);
      pending.set(id,{resolve,reject,timer}); options.send({action:'smart',id,method,params,workspace:scope});
    });
  }
  async function open(taskId?: string, shouldOpen: () => boolean = () => true): Promise<boolean> {
    if (modal?.modalEl.isConnected) return true;
    const attempt = ++opening;
    if (!configured) throw Error('请先设置有效的任务保存位置。');
    const scope = workspace;
    const sessionGeneration = generation;
    const guard = () => { if (sessionGeneration !== generation) throw Error('保存位置已变化，草稿仍保留在原位置。'); };
    const rpc = async (method: string, params: Record<string,unknown> = {}) => {
      guard();
      const result = await transport(scope, method, params);
      guard(); return result;
    };
    const saved = await rpc('read');
    if (attempt !== opening || !shouldOpen()) return false;
    let config = normalizeCaptureConfig(saved.config);
    const dirty = unsaved.get(scope) ?? {};
    unsaved.set(scope, dirty);
    const drafts: Record<string,string> = { ...saved.drafts, ...dirty };
    let writeQueue = Promise.resolve(), writeError: Error | undefined;
    const saveDraft = async (key: string, value: string) => {
      guard();
      await rpc('draft', {scope:key,value});
      if (dirty[key] === value) delete dirty[key];
    };
    const flush = async () => { await writeQueue; if (writeError) throw writeError; };
    const extract = (text: string, context: Parameters<typeof extractCapture>[1], candidate: CaptureConfig) =>
      extractCapture(text,context,candidate,'',request=>rpc('request',{config:candidate,request}));
    const sessionModal = new SmartModal({} as App, {
      get config() { return config; }, get groups() { return groups; }, get tasks() { return tasks; },
      readDraft: key => drafts[key] ?? '',
      writeDraft: (key,value) => {
        guard();
        let requestKey = '';
        if (key === 'create' && !value) {
          try { const id = JSON.parse(drafts[key] || '{}').requestId; if (id) requestKey = 'createRequest:' + id; } catch { /* Keep malformed retry data for recovery. */ }
        }
        drafts[key] = value; dirty[key] = value;
        writeQueue = writeQueue.then(async () => { await saveDraft(key,value); writeError = undefined; }).catch(() => {
          writeError = Error('草稿尚未保存到磁盘，请保持窗口开启后重试。');
          const alert = sessionModal.contentEl.querySelector('[role=alert]'); if(alert) alert.textContent = writeError.message;
        });
        if (requestKey) writeQueue = writeQueue.then(async () => {
          if (writeError) return;
          try { guard(); dirty[requestKey]=''; await saveDraft(requestKey,''); delete drafts[requestKey]; }
          catch { /* The task is saved; retaining retry data is safe if cleanup fails. */ }
        });
      },
      flushDraft: flush,
      configure: async candidate => { guard(); await rpc('configure',{config:candidate}); config = candidate; },
      pickKeyFile: () => rpc('pickKey'),
      testConnection: async candidate => { await extract(CONNECTION_TEST_TEXT, connectionTestContext(), candidate); },
      extract: (text,context) => { guard(); return extract(text,context,config); },
      create: async values => {
        guard(); await flush(); guard();
        if (values.groupId && !groups.some(g=>g.id===values.groupId)) throw Error('分组已变化，请重新选择。');
        const key = 'createRequest:' + values.creationId;
        const fingerprint = JSON.stringify(values);
        let attempt = drafts[key] ? JSON.parse(drafts[key]!) : undefined;
        if (attempt && attempt.fingerprint !== fingerprint) throw Error('此草稿已有保存尝试，请恢复原内容后重试，或重新开始。');
        if (!attempt) {
          const prepared = prepareImages(values.notes ?? '', values.images ?? []);
          const task = buildNewTask({...values,notes:prepared.notes});
          attempt = {fingerprint,request:{id:task.id,markdown:serializeLegacyTaskMarkdown(task),attachments:prepared.attachments.map(({name,base64})=>({name,base64}))}};
          drafts[key] = JSON.stringify(attempt); dirty[key] = drafts[key]!; await saveDraft(key,drafts[key]!);
        }
        await rpc('create',{request:attempt.request,groupsSource});
      },
      progress: async (plan,id) => {
        guard(); await flush(); guard();
        return rpc('progress',{operation:{version:1,id:'quick-'+id.replaceAll('-',''),taskId:plan.taskId,kind:'smart_progress',text:plan.text,completedTodoIds:plan.completedTodoIds}});
      },
    },taskId);
    modal = sessionModal;
    // Retry edits retained from a location change only after returning to that location.
    for (const [key,value] of Object.entries(dirty)) {
      writeQueue = writeQueue.then(() => saveDraft(key,value)).catch(error => { writeError = error; });
    }
    modal.modalEl.classList.add('wt-smart-panel');
    modal.open(); return true;
  }
  return {
    open,
    cancelOpen() { opening++; },
    isClosing: () => modal?.isClosing() ?? false,
    close: () => modal?.modalEl.isConnected ? modal.requestClose() : Promise.resolve(true),
    update(state: Record<string,any>) {
      if (state.smartReply) {
        const reply=state.smartReply, request=pending.get(reply.id);
        if(request) { pending.delete(reply.id); clearTimeout(request.timer); reply.error ? request.reject(Error(reply.error)) : request.resolve(reply.result); }
      }
      if ('workspace' in state && state.workspace !== workspace) {
        generation++; workspace=state.workspace;
        modal?.invalidateWorkspace(); modal=undefined;
        for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error('保存位置已变化，请重新打开。')); }
        pending.clear();
      }
      if ('configured' in state) configured=state.configured;
      if ('groupsSource' in state) { groupsSource=state.groupsSource ?? ''; try {groups=groupsSource?parseGroupArchive(groupsSource).groups:[];} catch {configured=false;} }
      if (state.tasks) tasks=state.tasks.flatMap((source:{markdown:string})=>{try{return [parseTaskMarkdown(source.markdown)];}catch{return [];}});
      for (const receipt of state.receipts ?? []) {
        if(receipt.operation?.kind!=='smart_progress') continue;
        const id=receipt.id.replace(/^quick-(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
        modal?.settleProgress(id,receipt.status,receipt.message);
      }
    },
  };
}
