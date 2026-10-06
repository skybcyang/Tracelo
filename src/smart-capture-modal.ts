import type { Modal as ObsidianModal, App } from 'obsidian';
import { captureId } from './capture-id';
import { dayKey, quadrantId, type WorkGroup, type WorkTask } from './domain';
import { mountNewTaskForm, type NewTaskDraft, type NewTaskValues } from './new-task-form';
import { type CaptureContext, type CapturePlan, type CaptureConfig, parseCapture, validateEndpoint, validateApiKey } from './smart-capture';

export interface SmartCaptureHost {
  groups: WorkGroup[]; tasks: WorkTask[];
  config: CaptureConfig;
  readDraft(scope: string): string;
  writeDraft(scope: string, value: string): void;
  flushDraft(): Promise<void>;
  configure(config: CaptureConfig): Promise<void>;
  testConnection(config: CaptureConfig): Promise<void>;
  pickKeyFile(): Promise<string | null>;
  extract(text: string, context: CaptureContext): Promise<CapturePlan>;
  create(values: NewTaskValues): Promise<unknown>;
  progress(plan: Extract<CapturePlan, { mode: 'progress' }>, operationId: string): Promise<void | 'queued'>;
}

export interface SmartCaptureMount {
  container: HTMLElement;
  onClose(saved: boolean): void;
}

// Both the Obsidian modal and native <dialog> provide this small surface contract.
export function createSmartCaptureModal(Modal: typeof ObsidianModal, Platform: { isWin: boolean }, setIcon: (el: HTMLElement, icon: string) => void) {
return class SmartCaptureModal extends Modal {
  private busy = false;
  private saving = false;
  private closePromise?: Promise<boolean>;
  private composing = false;
  private epoch = 0;
  private controller?: ReturnType<typeof mountNewTaskForm>;
  private requestId = captureId();
  private raw = '';
  private plan?: CapturePlan;
  private formDraft?: NewTaskDraft;
  private progressText = '';
  private completed: string[] = [];
  private previous = '';
  private queued = false;
  private refreshView?: () => void;
  private readonly draftScope: string;

  constructor(app: App, private readonly host: SmartCaptureHost, private readonly taskId?: string, private readonly mount?: SmartCaptureMount) {
    super(app); this.draftScope = taskId ? `progress:${taskId}` : 'create';
  }
  open(): void {
    if (!this.mount) { super.open(); return; }
    this.modalEl.addClass('wt-smart-embedded');
    this.mount.container.append(this.modalEl);
    this.onOpen();
  }
  private finishClose(saved = false): void {
    if (!this.mount) { super.close(); return; }
    this.onClose(); this.modalEl.remove(); this.mount.onClose(saved);
  }
  private context(): CaptureContext {
    return { mode: this.taskId ? 'progress' : 'create', groups: this.host.groups,
      task: this.host.tasks.find(t => t.id === this.taskId), today: dayKey(new Date()), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }
  private persist(): void {
    this.host.writeDraft(this.draftScope, JSON.stringify({ raw: this.raw, requestId: this.requestId, plan: this.plan, formDraft: this.formDraft, progressText: this.progressText, completed: this.completed, previous: this.previous, queued: this.queued }));
  }
  private restore(): void {
    try {
      const saved = JSON.parse(this.host.readDraft(this.draftScope) || '{}');
      if (typeof saved.raw === 'string') this.raw = saved.raw.slice(0, 6000);
      this.previous = typeof saved.previous === 'string' ? saved.previous : '';
      this.queued = saved.queued === true;
      if (typeof saved.requestId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(saved.requestId)) this.requestId = saved.requestId;
      if (saved.plan?.mode === 'create' && !this.taskId) {
        const v = saved.plan.values;
        this.plan = parseCapture(JSON.stringify({ title: v.title, notes: v.notes, groupId: v.groupId, important: v.important, urgent: v.urgent,
          dueDate: v.dueDate, todos: v.todos, initialProgress: v.initialProgress, warnings: saved.plan.warnings }), this.context());
        const d = saved.formDraft;
        if (d && ['title','notes','groupId','quadrant','dueDate','initialProgress'].every(k => typeof d[k] === 'string')
          && Array.isArray(d.todos) && d.todos.every((t: unknown) => typeof t === 'string')) this.formDraft = d;
      } else if (saved.plan?.mode === 'progress' && this.taskId) {
        this.plan = parseCapture(JSON.stringify({ text: saved.progressText, completedTodoIds: saved.completed, warnings: saved.plan.warnings }), this.context());
        if (this.plan.mode === 'progress') { this.progressText = this.plan.text; this.completed = this.plan.completedTodoIds; }
      }
    } catch { this.plan = undefined; this.formDraft = undefined; }
  }
  onOpen(): void {
    this.restore();
    this.modalEl.addEventListener('compositionstart', () => { this.composing = true; });
    this.modalEl.addEventListener('compositionend', () => { this.composing = false; });
    this.setTitle(this.taskId ? '一句话记录进展' : '一句话创建任务');
    this.modalEl.addClass('wt-modal', 'wt-smart-modal');
    const body = this.contentEl.createDiv({ cls: 'wt-smart-body' });
    const source = body.createDiv({ cls: 'wt-smart-source' });
    const heading = source.createDiv({ cls: 'wt-smart-intro' });
    if (this.taskId) heading.createEl('p', { text: this.context().task?.title ?? '任务不可用' });
    const settings = heading.createEl('button', { text: '模型设置', cls: 'wt-secondary-action', attr: { type: 'button' } });
    const configStatus = source.createEl('p', { cls: 'wt-smart-help', attr: { role: 'status' } });
    if (!this.taskId) heading.prepend(configStatus);
    const showConfig = () => { configStatus.textContent = this.host.config.apiKey || this.host.config.keyFile ? this.host.config.model : '未配置模型'; };
    showConfig(); settings.onclick = () => this.openSettings(showConfig);
    const label = source.createEl('label', { cls: 'wt-field' });
    label.createSpan({ cls: 'wt-field-label', text: '说说要做的事' });
    const input = label.createEl('textarea', { cls: 'wt-smart-input', attr: { rows: '4', maxlength: '6000', 'aria-label': '说说要做的事', placeholder: this.taskId ? '例如：日志已经抓完，发现初始化耗时比较高。' : '例如：明天排查相机启动慢，先抓日志，再分析耗时，目前已经复现。' } });
    input.value = this.raw;
    source.createEl('p', { cls: 'wt-smart-help', text: '整理时将原文及必要的分组或任务信息发送给模型；确认前不修改任务。' });
    const controls = body.createDiv({ cls: 'wt-smart-controls' });
    const analyze = controls.createEl('button', { cls: 'wt-primary-action', attr: { type: 'button' } });
    setIcon(analyze.createSpan({ attr: { 'aria-hidden': 'true' } }), 'sparkles');
    const analyzeLabel = analyze.createSpan({ text: this.taskId ? '整理进展' : '整理成任务' });
    const cancel = controls.createEl('button', { text: '取消整理', cls: 'wt-secondary-action', attr: { type: 'button' } }); cancel.hidden = true;
    const status = controls.createSpan({ cls: 'wt-smart-help', attr: { role: 'status', 'aria-live': 'polite' } });
    const error = body.createEl('p', { cls: 'wt-form-error', attr: { role: 'alert' } });
    const preview = body.createDiv({ cls: 'wt-smart-preview wt-new-task-modal' });
    const footer = this.contentEl.createDiv({ cls: 'wt-smart-footer' });
    const close = footer.createEl('button', { text: '关闭', cls: 'wt-secondary-action', attr: { type: 'button' } }); close.onclick = () => this.close();
    const discard = footer.createEl('button', { text: '放弃草稿', cls: 'wt-secondary-action', attr: { type: 'button' } });
    const undo = footer.createEl('button', { text: '恢复上一版结果', cls: 'wt-secondary-action', attr: { type: 'button' } });
    const back = footer.createEl('button', { text: '返回原文', cls: 'wt-secondary-action', attr: { type: 'button' } });
    let showingResult = !!this.plan && !this.taskId;
    let resultBack: HTMLButtonElement | undefined;
    footer.append(analyze);
    const confirmation = body.createDiv({ cls: 'wt-smart-confirm', attr: { role: 'group', 'aria-label': '确认操作' } });
    let confirming = false;
    const confirm = (message: string, yes: string, no: string, action: () => void) => {
      confirming = true; confirmation.replaceChildren(); confirmation.createEl('p', { text: message });
      const accept = confirmation.createEl('button', { text: yes, cls: 'wt-primary-action', attr: { type: 'button' } });
      const cancel = confirmation.createEl('button', { text: no, cls: 'wt-secondary-action', attr: { type: 'button' } });
      const finish = () => { confirming = false; confirmation.replaceChildren(); refresh(); };
      accept.onclick = () => { finish(); action(); };
      cancel.onclick = () => { finish(); input.focus(); };
      refresh(); confirmation.scrollIntoView({ block: 'nearest' }); cancel.focus();
    };
    let composing = false;
    const refresh = () => {
      const result = showingResult && !!this.plan && !this.taskId;
      source.hidden = result; preview.hidden = !this.taskId && !result;
      footer.hidden = result;
      body.classList.toggle('is-confirming-create', result);
      back.hidden = !!this.taskId || !this.plan;
      back.textContent = result ? '返回原文' : '查看整理结果';
      back.disabled = this.busy || this.saving || confirming;
      if (resultBack) resultBack.disabled = this.busy || this.saving || confirming;
      analyze.hidden = result;
      analyze.disabled = this.busy || this.saving || this.queued || confirming || !this.raw.trim(); input.disabled = this.busy || this.saving || this.queued || confirming;
      settings.disabled = this.busy || this.saving || confirming; close.disabled = this.saving;
      discard.disabled = this.busy || this.saving || this.queued || confirming || !this.raw && !this.plan;
      undo.hidden = !this.previous; undo.disabled = this.busy || this.saving || this.queued || confirming;
      preview.inert = this.busy || this.saving || this.queued || confirming;
      analyze.classList.toggle('wt-primary-action', !this.plan); analyze.classList.toggle('wt-secondary-action', !!this.plan);
      if (this.queued) status.textContent = '已暂存，等待 Obsidian 写入。可以关闭窗口；收到回执前保留草稿。';
      cancel.hidden = !this.busy; analyzeLabel.textContent = this.busy ? '正在整理…' : this.taskId ? '整理进展' : '整理成任务';
    };
    back.onclick = () => {
      if (this.composing || this.saving || this.busy) return;
      showingResult = !showingResult; refresh();
      if (showingResult) this.controller?.focus(); else input.focus();
    };
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.oninput = () => {
      this.raw = input.value;
      error.textContent = ''; status.textContent = this.plan ? '原文已修改，当前确认结果仍保留。重新整理前会请你确认替换。' : ''; this.persist(); refresh();
    };
    cancel.onclick = () => { this.epoch++; this.busy = false; status.textContent = '已取消整理，原文已保留'; refresh(); };
    const renderPreview = () => {
      this.controller?.destroy(); this.controller = undefined; preview.replaceChildren();
      if (!this.plan) return;
      const previewHeading = preview.createDiv({cls:'wt-smart-result-heading'});
      previewHeading.createEl('h3', { text: '确认整理结果' });
      if (!this.taskId) {
        resultBack = previewHeading.createEl('button',{text:'返回原文',cls:'wt-secondary-action',attr:{type:'button'}});
        resultBack.onclick = () => {
          if (this.composing || this.saving || this.busy) return;
          showingResult = false; refresh(); input.focus();
        };
      }
      for (const warning of this.plan.warnings) preview.createEl('p', { cls: 'wt-smart-warning', text: warning });
      if (this.plan.mode === 'create') {
        const v = this.plan.values;
        const draft: NewTaskDraft = this.formDraft ?? { title: v.title, notes: v.notes ?? '', groupId: v.groupId ?? '', quadrant: quadrantId({ important: v.important === true, urgent: v.urgent === true }),
          dueDate: v.dueDate ?? '', initialProgress: v.initialProgress, todos: v.todos, expanded: { todos: !!v.todos.length, due: !!v.dueDate, progress: !!v.initialProgress }, creationId: this.requestId };
        draft.creationId = this.requestId;
        this.controller = mountNewTaskForm(preview, {
          groups: this.host.groups, draft, isWin: Platform.isWin, setIcon,
          onChange: value => { this.formDraft = value; this.persist(); }, onCancel: () => this.close(),
          onSubmit: async values => {
            this.saving = true; refresh();
            try {
              await this.host.create(values); this.host.writeDraft(this.draftScope, '');
              await this.controller?.confirmSaved(); this.saving = false; this.finishClose(true);
            } catch (reason) { this.saving = false; refresh(); throw reason; }
          },
        });
      } else {
        const plan = this.plan;
        const form = preview.createEl('form', { cls: 'wt-smart-progress-form' });
        const field = form.createEl('label', { cls: 'wt-field' }); field.createSpan({ cls: 'wt-field-label', text: '整理后的进展' });
        const text = field.createEl('textarea', { attr: { rows: '4', maxlength: '2000', required: '', 'aria-label': '整理后的进展' } });
        text.value = this.progressText;
        text.oninput = () => { this.progressText = text.value; this.persist(); };
        let progressComposing = false;
        text.addEventListener('compositionstart', () => { progressComposing = true; });
        text.addEventListener('compositionend', () => { progressComposing = false; });
        if (plan.completedTodoIds.length) form.createEl('p', { cls: 'wt-field-label', text: '同时标记以下待办完成' });
        const checks = plan.completedTodoIds.map(id => {
          const row = form.createEl('label', { cls: 'wt-smart-todo' });
          const checkbox = row.createEl('input', { attr: { type: 'checkbox', value: id } }); checkbox.checked = this.completed.includes(id);
          row.createSpan({ text: this.context().task?.todos?.find(t => t.id === id)?.text ?? '待办已移除' });
          checkbox.onchange = () => { this.completed = checks.filter(c => c.checked).map(c => c.value); this.persist(); };
          return checkbox;
        });
        const submit = form.createEl('button', { text: '保存进展', cls: 'wt-primary-action', attr: { type: 'submit' } });
        form.onsubmit = async event => {
          event.preventDefault(); if (this.saving || progressComposing || !text.value.trim()) return;
          this.saving = true; refresh(); submit.disabled = text.disabled = true; checks.forEach(c => { c.disabled = true; }); error.textContent = '';
          try {
            const result = await this.host.progress({ ...plan, text: text.value, completedTodoIds: this.completed }, this.requestId);
            if (result === 'queued') { this.queued = true; this.saving = false; this.persist(); refresh(); return; }
            this.host.writeDraft(this.draftScope, ''); this.saving = false; this.finishClose(true);
          } catch (reason) {
            error.textContent = reason instanceof Error ? reason.message : '未能保存，草稿已保留';
            this.saving = false; refresh(); submit.disabled = text.disabled = false; checks.forEach(c => { c.disabled = false; });
          }
        };
      }
    };
    const analyzeNow = async () => {
      if (this.busy || this.saving || composing || !this.raw.trim()) return;
      const epoch = ++this.epoch; this.busy = true; error.textContent = ''; status.textContent = '正在提取任务信息'; refresh(); this.persist();
      // Keep an existing preview intact on failure; disable it while a replacement is pending.
      preview.inert = true;
      try {
        const plan = await this.host.extract(this.raw, this.context());
        if (epoch !== this.epoch || !this.modalEl.isConnected) return;
        if (this.plan) this.previous = JSON.stringify({ plan: this.plan, formDraft: this.formDraft, progressText: this.progressText, completed: this.completed });
        this.plan = plan; this.formDraft = undefined;
        if (plan.mode === 'progress') { this.progressText = plan.text; this.completed = plan.completedTodoIds; }
        showingResult = !this.taskId;
        this.persist(); renderPreview(); refresh(); status.textContent = '已整理，请确认后保存';
        preview.scrollIntoView({ block: 'nearest' });
      } catch (reason) {
        if (epoch === this.epoch) { error.textContent = reason instanceof Error ? reason.message : '整理失败，原文已保留'; status.textContent = ''; }
      } finally {
        if (epoch === this.epoch) { this.busy = false; preview.inert = false; refresh(); }
      }
    };
    analyze.onclick = () => {
      if (this.busy || this.saving || this.queued || composing) return;
      if (this.plan) confirm('重新整理会替换当前结果和手动修改。成功后仍可恢复上一版。', '替换并重新整理', '保留当前结果', () => { void analyzeNow(); });
      else void analyzeNow();
    };
    discard.onclick = () => confirm('放弃后会清除本次原文和确认结果，正式任务不受影响。', '确认放弃', '继续编辑', () => {
      void (async () => {
        this.saving = true; refresh();
        try {
          this.host.writeDraft(this.draftScope, ''); await this.host.flushDraft();
          this.epoch++; this.raw = ''; this.plan = undefined; this.formDraft = undefined; this.progressText = ''; this.completed = []; this.previous = ''; this.requestId = captureId();
          input.value = ''; error.textContent = ''; status.textContent = '草稿已放弃，可以开始新的录入'; renderPreview();
        } catch {
          this.persist(); error.textContent = '未能清除磁盘上的草稿，当前内容仍保留，请重试。';
        } finally { this.saving = false; refresh(); input.focus(); }
      })();
    });
    undo.onclick = () => {
      try {
        const previous = JSON.parse(this.previous), current = JSON.stringify({ plan: this.plan, formDraft: this.formDraft, progressText: this.progressText, completed: this.completed });
        this.plan = previous.plan; this.formDraft = previous.formDraft; this.progressText = previous.progressText; this.completed = previous.completed;
        this.previous = current; showingResult = !this.taskId; this.persist(); renderPreview(); refresh(); status.textContent = '已恢复上一版结果，请检查后保存';
      } catch { error.textContent = '上一版结果无法恢复，当前内容已保留。'; }
    };
    this.refreshView = () => { renderPreview(); refresh(); };
    const cancelOriginal = cancel.onclick;
    cancel.onclick = event => { cancelOriginal?.call(cancel, event); preview.inert = false; };
    renderPreview(); refresh(); if (showingResult) this.controller?.focus(); else input.focus();
  }
  /** Detach an obsolete native workspace session without writing into the new one. */
  invalidateWorkspace(): void { this.finishClose(); }
  close(): void { void this.requestClose(); }
  isClosing(): boolean { return !!this.closePromise; }
  requestClose(): Promise<boolean> {
    if (this.closePromise) return this.closePromise;
    if (this.saving || this.composing || this.controller?.isSaving()) return Promise.resolve(false);
    this.epoch++; this.busy = false; this.contentEl.inert = true;
    this.closePromise = (async () => {
      try { this.persist(); await this.host.flushDraft(); this.finishClose(); return true; }
      catch {
        this.contentEl.inert = false; this.refreshView?.();
        const alert = this.contentEl.querySelector('[role=alert]');
        if (alert) alert.textContent = '草稿未能保存到磁盘，请保持窗口开启，检查存储空间或权限后重试。';
        return false;
      } finally { this.closePromise = undefined; }
    })();
    return this.closePromise;
  }
  onClose(): void { this.epoch++; this.controller?.destroy(); void this.host.flushDraft().catch(() => {}); this.contentEl.replaceChildren(); }

  settleProgress(id: string, status: string, message = ''): void {
    if (!this.queued || id !== this.requestId) return;
    if (status === 'applied') { this.host.writeDraft(this.draftScope, ''); this.queued = false; super.close(); }
    if (status === 'failed') { this.queued = false; this.persist(); this.refreshView?.(); const alert = this.contentEl.querySelector('[role=alert]'); if (alert) alert.textContent = message || '写入失败，草稿已保留，请检查后重试。'; }
  }

  openSettings(onSaved: () => void): void {
    const modal = new Modal(this.app); modal.setTitle('模型设置'); modal.modalEl.addClass('wt-modal', 'wt-smart-settings');
    const form = modal.contentEl.createEl('form', { cls: 'wt-modal-form' });
    const settingsBody = form.createDiv({ cls: 'wt-smart-settings-body' });
    const input = (label: string, value: string, placeholder: string) => {
      const field = settingsBody.createEl('label', { cls: 'wt-field' }); field.createSpan({ cls: 'wt-field-label', text: label });
      const control = field.createEl('input', { attr: { type: 'text', placeholder, required: '' } }); control.value = value; return control;
    };
    const base = input('服务地址', this.host.config.baseUrl, 'https://api.moonshot.cn/v1');
    const model = input('模型名称', this.host.config.model, '填写该服务支持的模型 ID');
    const key = input('API Key', this.host.config.apiKey ?? '', this.host.config.keyFile ? '已保留旧密钥，输入可替换' : '粘贴 API Key');
    key.type = 'password'; key.autocomplete = 'off'; key.spellcheck = false; key.maxLength = 4096; key.setAttribute('aria-label', 'API Key');
    key.required = !this.host.config.keyFile;
    const keyRow = key.parentElement!.createDiv({ cls: 'wt-smart-key' }); keyRow.append(key);
    const reveal = keyRow.createEl('button', { cls: 'wt-secondary-action', attr: { type: 'button', 'aria-label': '显示密钥', 'aria-pressed': 'false' } });
    const showKey = () => { const visible = key.type === 'text'; reveal.setAttribute('aria-label', visible ? '隐藏密钥' : '显示密钥'); reveal.setAttribute('aria-pressed', String(visible)); reveal.replaceChildren(); setIcon(reveal, visible ? 'eye-off' : 'eye'); };
    showKey(); reveal.onclick = () => { key.type = key.type === 'password' ? 'text' : 'password'; showKey(); };
    settingsBody.createEl('p', { cls: 'wt-smart-help', text: 'API Key 保存在本机配置中，不写入任务。支持 HTTPS Chat Completions 接口；测试连接只发送固定测试句，可能产生少量调用费用。' });
    const error = settingsBody.createEl('p', { cls: 'wt-form-error', attr: { role: 'alert' } });
    const status = settingsBody.createEl('p', { cls: 'wt-smart-help', attr: { role: 'status', 'aria-live': 'polite' } });
    const actions = form.createDiv({ cls: 'wt-modal-actions' });
    actions.createEl('button', { text: '取消', cls: 'wt-secondary-action', attr: { type: 'button' } }).onclick = () => modal.close();
    const save = actions.createEl('button', { text: '保存设置', cls: 'wt-primary-action', attr: { type: 'submit' } });
    const test = actions.createEl('button', { text: '测试连接', cls: 'wt-secondary-action', attr: { type: 'button' } });
    actions.append(save);
    let busy = false, revision = 0;
    const config = () => {
      validateEndpoint(base.value.trim());
      if (!model.value.trim()) throw Error('请填写模型名称。');
      const apiKey = key.value.trim() ? validateApiKey(key.value) : '';
      if (!apiKey && !this.host.config.keyFile) throw Error('请填写 API Key。');
      return { baseUrl: base.value.trim(), model: model.value.trim(), apiKey, keyFile: apiKey ? '' : this.host.config.keyFile };
    };
    for (const field of [base, model, key]) field.oninput = () => { revision++; status.textContent = '配置已修改，尚未测试连接'; error.textContent = ''; };
    test.onclick = async () => {
      if (busy) return;
      const current = revision;
      try { const candidate = config(); busy = true; test.disabled = save.disabled = true; error.textContent = ''; status.textContent = '正在测试连接…';
        await this.host.testConnection(candidate);
        if (modal.modalEl.isConnected && current === revision) status.textContent = '连接成功，模型可返回任务数据。保存设置后生效。';
      } catch (reason) { if (current === revision) { status.textContent = ''; error.textContent = reason instanceof Error ? reason.message : '连接失败，请检查配置后重试。'; } }
      finally { busy = false; test.disabled = save.disabled = false; }
    };
    form.onsubmit = async event => {
      event.preventDefault(); if (save.disabled) return;
      try {
        const candidate = config();
        save.disabled = true;
        await this.host.configure(candidate); onSaved(); modal.close();
      } catch (reason) { error.textContent = reason instanceof Error ? reason.message : '设置保存失败'; save.disabled = false; }
    };
    modal.open(); base.focus();
  }
}
}
