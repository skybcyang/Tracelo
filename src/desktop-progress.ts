import { parseTaskMarkdown, normalizePluginState } from './archive';
import { QUADRANTS, dayKey, taskIcon, type WorkTask, type WorkGroup } from './domain';
import { setContentIcon } from './content-icons';
import { renderCardTodos, renderCardComposer, cardDueLabel, formatDateTime, formatTime, type CardHost } from './task-card';
import type { QuickOperation } from './quick-operations';
import MarkdownIt from 'markdown-it';
import { mountDraftImages, prepareImages, type DraftImage } from './draft-images';
import { confirmQuickSave, revealQuickContent } from './quick-feedback';

/** The native webview supplies the small DOM convenience API used by shared cards. */
function installCardDOM() {
  const prototype = HTMLElement.prototype;
  if (Reflect.has(prototype, 'createEl')) return;
  prototype.createEl = function(this: HTMLElement, tag: string, options: { cls?: string; text?: string; type?: string; attr?: Record<string, string> } = {}) {
    const node = this.ownerDocument.createElement(tag);
    if (options.cls) node.className = options.cls;
    if (options.text !== undefined) node.textContent = options.text;
    if (options.type) node.setAttribute('type', options.type);
    for (const [name, value] of Object.entries(options.attr ?? {})) node.setAttribute(name, value);
    this.append(node); return node;
  } as typeof prototype.createEl;
  prototype.createDiv = function(options) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); };
  prototype.createSpan = function(options) { return this.createEl('span', typeof options === 'string' ? { cls: options } : options); };
  prototype.addClass = function(...names) { this.classList.add(...names); };
  prototype.removeClass = function(...names) { this.classList.remove(...names); };
  prototype.setAttr = function(name, value) { if (value === null) this.removeAttribute(name); else this.setAttribute(name, String(value)); };
}
type Receipt = { id: string; status: 'queued' | 'applied' | 'failed'; message: string; operation?: QuickOperation };
type TaskSource = { markdown: string; images?: Record<string, string>; path?: string };
interface Options { send(value: Record<string, unknown>): void; setIcon(element: HTMLElement, name: string): void; resize(): void; isWin?: boolean; getLocation?(): string; openSettings?(): void }
export function mountQuickProgress(container: HTMLElement, options: Options) {
  installCardDOM();
  let tasks: WorkTask[] = [], groups: WorkGroup[] = [], images = new Map<string, Record<string, string>>();
  const paths = new Map<string, string>();
  const state = normalizePluginState(null);
  // Quick capture always edits its single selected card, independently of board presentation.
  state.presentationMode = false;
  const draftImages = new Map<string, DraftImage[]>();
  const pending = new Map<string, { operation: QuickOperation; resolve(): void; reject(reason: Error): void }>();
  const confirming = new Set<string>();
  const attempts = new Map<string, QuickOperation>();
  let active = false, sourcesKey = '', workspace = '', choosing = false;
  let renderedTarget = '', feedback: 'idle' | 'saving' | 'queued' | 'success' | 'failed' = 'idle';
  let composing = false, visibility = 0;
  const expandedExtras = new Set<string>();
  const handled = new Set<string>();
  const toolbar = container.createDiv({ cls: 'wt-quick-toolbar' });
  const back = toolbar.createEl('button', { text: '返回记录', attr: { type: 'button' } });
  back.hidden = true;
  const search = toolbar.createEl('input', { type: 'search', attr: { placeholder: '搜索任务、分组或进展', 'aria-label': '搜索已有任务' } });
  const status = container.createDiv({ cls: 'wt-quick-status', attr: { role: 'status', 'aria-live': 'polite' } });
  const body = container.createDiv({ cls: 'wt-quick-body' });
  function setFeedback(value: typeof feedback, message: string) {
    feedback = value; container.dataset.feedback = value; status.textContent = message;
    status.setAttribute('aria-busy', String(value === 'saving'));
    const cancel = body.querySelector<HTMLButtonElement>('.wt-progress-cancel');
    if (cancel) cancel.disabled = pending.size > 0 || confirming.size > 0;
    options.resize();
  }
  function setDraft(id: string, text: string) {
    state.drafts[id] = text;
    if (!text) draftImages.delete(id);
    const images = draftImages.get(id);
    options.send({ action: 'progressDraft', taskId: id, text: images?.length ? JSON.stringify({ format:'tracelo-progress-draft-v1',text,images }) : text });
  }
  function matchesDraft(op: QuickOperation) {
    try { return prepareImages(state.drafts[op.taskId] ?? '', draftImages.get(op.taskId) ?? []).notes === op.text; } catch { return false; }
  }
  function notice(message: string) { status.textContent = message; options.resize(); return { messageEl: status, hide: () => setFeedback('idle', '') }; }
  function perform(taskId: string, kind: QuickOperation['kind'], values: Partial<QuickOperation> = {}): Promise<void> {
    const key = JSON.stringify({ taskId, kind, ...values });
    let op = attempts.get(key);
    if (!op) { op = { version: 1, id: 'quick-' + [...crypto.getRandomValues(new Uint8Array(16))].map(v => v.toString(16).padStart(2, '0')).join(''), taskId, kind, ...values }; attempts.set(key, op); }
    const operation = op;
    if (pending.has(op.id)) return Promise.reject(Error('此操作正在等待写入，请勿重复提交'));
    return new Promise((resolve, reject) => {
      pending.set(operation.id, { operation, resolve, reject });
      setFeedback('saving', '正在保存…'); options.send({ action: 'operation', operation });
    });
  }
  function prompt(heading: string, initial: string, placeholder: string, multiline: boolean, submitValue: (value: string) => Promise<void>) {
    const dialog = document.createElement('dialog'); dialog.className = 'wt-modal wt-quick-prompt';
    dialog.createEl('h3', { text: heading });
    const form = dialog.createEl('form');
    const input = multiline ? form.createEl('textarea', { attr: { 'aria-label': heading, placeholder, rows: '6' } }) : form.createEl('input', { type: 'text', attr: { 'aria-label': heading, placeholder } });
    input.value = initial;
    const feedback = form.createDiv({ attr: { role: 'status' } });
    const cancel = form.createEl('button', { text: '取消', attr: { type: 'button' } });
    const submit = form.createEl('button', { text: '保存', attr: { type: 'submit' } });
    let saving = false, composing = false;
    const close = () => { dialog.close(); dialog.remove(); };
    cancel.onclick = close;
    dialog.addEventListener('cancel', event => { if (saving || composing) event.preventDefault(); });
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); if (!event.isComposing && !composing && event.keyCode !== 229) { event.preventDefault(); if (!saving) close(); } } });
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener('keydown', raw => { const event = raw as KeyboardEvent; if ((event.isComposing || composing || event.keyCode === 229) && event.key === 'Enter') event.preventDefault(); });
    form.onsubmit = async event => {
      event.preventDefault(); if (saving || composing) return; saving = true; submit.disabled = cancel.disabled = input.disabled = true; feedback.textContent = '正在保存；Obsidian 未运行时将暂存';
      try { await submitValue(input.value); close(); render(); }
      catch (error) { feedback.textContent = String(error); saving = false; submit.disabled = cancel.disabled = input.disabled = false; input.focus(); }
    };
    document.body.append(dialog); dialog.showModal(); input.focus();
  }
  function taskMenu(event: MouseEvent, task: WorkTask) {
    event.stopPropagation(); const menu = document.createElement('dialog'); menu.className = 'wt-modal wt-quick-menu'; menu.setAttribute('aria-label', '任务操作');
    const add = (label: string, action: () => void) => { const b = menu.createEl('button', { text: label, attr: { type: 'button' } }); b.onclick = () => { menu.close(); menu.remove(); action(); }; };
    const ask = (label: string, initial: string, kind: QuickOperation['kind'], multiline = false) => add(label, () => prompt(label, initial, '', multiline, text => perform(task.id, kind, { text })));
    add('打开任务文件夹', () => options.send({ action: 'openTaskFolder', taskId: task.id, path: paths.get(task.id) }));
    ask('改名', task.title, 'rename'); ask('编辑详情', task.notes ?? '', 'notes', true);
    ask('设置截止日期', task.dueDate ?? '', 'due');
    for (const group of [...groups, { id: '', name: '未分组' }]) add(`移到分组：${group.name}`, () => { void perform(task.id, 'group', { text: group.id }).catch(error => notice(String(error))); });
    for (const quadrant of QUADRANTS) add(quadrant.name, () => { void perform(task.id, 'quadrant', { text: quadrant.id }).catch(error => notice(String(error))); });
    ask('更换图标（Lucide 名称）', task.icon ?? '', 'icon');
    if (task.status === 'active') { add('完成任务', () => { void perform(task.id, 'complete').catch(error => notice(String(error))); }); ask('异常关闭', '', 'close', true); }
    else add('重新打开', () => { void perform(task.id, 'reopen').catch(error => notice(String(error))); });
    add('取消', () => {});
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.close(); menu.remove(); } });
    document.body.append(menu); menu.showModal();
  }
  const host: CardHost = {
    plugin: {
      get groups() { return groups; }, state,
      dropTask: async () => {},
      toggleTaskTodo: (id, todoId, done) => perform(id, 'todo_toggle', { todoId, done }),
      editTaskTodo: (id, todoId, text) => perform(id, 'todo_edit', { todoId, text }),
      addTaskTodo: (id, text) => perform(id, 'todo_add', { text }),
      removeTaskTodo: async (id, todoId) => { const task = tasks.find(t => t.id === id)!; const index = task.todos!.findIndex(t => t.id === todoId), todo = task.todos![index]!; await perform(id, 'todo_remove', { todoId }); return { todo, index }; },
      restoreTaskTodo: (id, todo, index) => perform(id, 'todo_restore', { todo, index }),
      updateDraft: setDraft,
      recordProgress: async (id, text) => {
        const currentVisibility = visibility;
        const prepared = prepareImages(text, draftImages.get(id) ?? []);
        await perform(id, 'progress', { text: prepared.notes, ...(prepared.attachments.length ? { attachments: prepared.attachments.map(({name,base64}) => ({name,base64})) } : {}) });
        if (state.drafts[id] === text) {
          setDraft(id, '');
          // Only an applied receipt resolves perform; queued commands never reach here.
          await confirmQuickSave(status);
          if (active && visibility === currentVisibility && host.selectedTaskId === id && !state.drafts[id] && feedback === 'success') options.send({ action: 'progressComplete' });
        }
        confirming.delete(id);
      },
    },
    selectedTaskId: null, expandedTaskId: null, addingTodoTaskId: null, recordedTaskId: null,
    editingNotes: new Set(), openCompletedTodos: new Set(), contentEl: body,
    setIcon: options.setIcon,
    iconButton: (parent, icon, label, cls = 'wt-icon-button') => { const b = parent.createEl('button', { cls, attr: { type: 'button', 'aria-label': label } }); options.setIcon(b, icon); return b; },
    showTaskMenu: taskMenu,
    showTodoMenu: (anchor, actions) => {
      const menu = document.createElement('dialog');
      menu.className = 'wt-modal wt-quick-menu'; menu.setAttribute('aria-label', '待办操作');
      const close = () => { menu.close(); menu.remove(); if (anchor.isConnected) anchor.focus(); };
      for (const action of actions) {
        const button = menu.createEl('button', { attr: { type: 'button' } });
        options.setIcon(button.createSpan({ attr: { 'aria-hidden': 'true' } }), action.icon);
        button.createSpan({ text: action.title });
        button.onclick = () => { close(); void action.run(); };
      }
      menu.createEl('button', { text: '取消', attr: { type: 'button' } }).onclick = close;
      menu.addEventListener('cancel', event => { event.preventDefault(); close(); });
      menu.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
      document.body.append(menu); menu.showModal();
    },
    openDueDate: task => prompt('截止日期（YYYY-MM-DD，留空清除）', task.dueDate ?? '', 'YYYY-MM-DD', false, text => perform(task.id, 'due', { text })),
    collapseCard: () => { if (!pending.size && !confirming.size && !composing) options.send({ action: 'progressDismiss' }); },
    focusCard: () => body.querySelector<HTMLTextAreaElement>('.wt-card-composer textarea')?.focus(),
    render, notice, prompt,
    renderNotes: (parent, task) => {
      if (!task.notes) return;
      const section = parent.createDiv({ cls: 'wt-task-notes' }), preview = section.createDiv({ cls: 'wt-notes-preview' });
      const markdown = new MarkdownIt({ html: false, breaks: true });
      markdown.renderer.rules.image = (tokens, index) => {
        const token = tokens[index]!, source = token.attrGet('src') ?? '';
        const data = images.get(task.id)?.[source];
        const escape = markdown.utils.escapeHtml;
        return data ? `<img src="${escape(data)}" alt="${escape(token.content)}" tabindex="0" role="button">` : escape(`![${token.content}](${source})`);
      };
      preview.innerHTML = markdown.render(task.notes);
      for (const image of preview.querySelectorAll('img')) {
        const open = () => {
          const dialog = document.createElement('dialog'); dialog.className = 'wt-image-preview';
          const close = () => { dialog.close(); dialog.remove(); image.focus(); };
          const b = dialog.createEl('button', { text: '关闭' }); b.onclick = close;
          dialog.createEl('img', { attr: { src: image.src, alt: image.alt } });
          dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
          document.body.append(dialog); dialog.showModal();
        };
        image.onclick = open;
        image.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
      }
    },
  };
  function render() {
    body.replaceChildren();
    // Reopen the last task, or the most recently updated active task on first use.
    // The picker is an explicit secondary state, never an extra mandatory step.
    let task = tasks.find(task => task.id === host.selectedTaskId);
    if (!task && !choosing) task = tasks.filter(task => task.status === 'active').sort((a, b) => b.events.at(-1)!.at.localeCompare(a.events.at(-1)!.at))[0];
    if (task) host.selectedTaskId = host.expandedTaskId = task.id;
    const nextTarget = `${task?.id ?? ''}:${choosing}`;
    const reveal = nextTarget !== renderedTarget;
    renderedTarget = nextTarget;
    toolbar.hidden = !!task && !choosing;
    back.hidden = !task;
    search.hidden = false;
    container.classList.toggle('is-choosing', choosing || !task);
    const togglePicker = () => {
      choosing = !choosing;
      if (choosing) search.value = '';
      render();
      if (choosing) search.focus();
      else body.querySelector<HTMLButtonElement>('.wt-quick-target')?.focus();
    };
    if (task) {
      const card = body.createEl('article', { cls: 'wt-card wt-quick-editor is-expanded', attr: { 'data-task-id': task.id } });
      const cardBody = card.createDiv({ cls: 'wt-card-body' });
      const target = cardBody.createDiv({ cls: 'wt-record-target' });
      const title = target.createEl('button', { cls: 'wt-quick-target', attr: { type: 'button', 'aria-label': `切换任务：${task.title}`, 'aria-expanded': String(choosing) } });
      const selectedIcon = taskIcon(task, groups);
      if (selectedIcon) setContentIcon(title.createSpan({ cls: 'wt-task-icon', attr: { 'aria-hidden': 'true' } }), selectedIcon);
      const targetCopy = title.createSpan({ cls: 'wt-quick-target-copy' });
      targetCopy.createEl('strong', { text: task.title });
      targetCopy.createEl('small', { text: [task.groupName, task.dueDate ? cardDueLabel(task) : ''].filter(Boolean).join(' · ') });
      options.setIcon(title.createSpan({ cls: 'wt-target-switch', attr: { 'aria-hidden': 'true' } }), 'chevrons-up-down');
      title.onclick = togglePicker;
      if (choosing) {
        const picker = cardBody.createDiv({ cls: 'wt-inline-picker' });
        picker.append(toolbar);
        renderCandidates(picker);
      } else container.prepend(toolbar);
      const latest = [...task.events].reverse().find(event => event.kind === 'progress');
      const context = cardBody.createDiv({ cls: 'wt-quick-context' });
      const today = dayKey(new Date());
      context.createEl('small', { text: latest ? `上次进展 / ${latest.day === today ? formatTime(latest.at) : formatDateTime(latest.at)}` : '上次进展' });
      context.createEl('p', { text: latest?.text ?? '暂无进展' });
      // Share editing and persistence behavior, not the board card's navigation/layout.
      renderCardComposer(host, cardBody, task);
      const form = cardBody.querySelector<HTMLFormElement>('.wt-card-composer')!;
      form.id = 'quick-progress-form';
      form.querySelector('label > span')!.textContent = '本次进展';
      form.querySelector('textarea')!.setAttribute('aria-label','这次推进了什么？');
      form.querySelector('textarea')!.placeholder = '记下结果、问题，或下一步要做的事';
      const input = form.querySelector('textarea')!;
      const imageHost = form.createDiv({ cls: 'wt-progress-images' });
      let imagesReady = false;
      const editor = mountDraftImages(input, imageHost, () => {
        if (!imagesReady) return;
        draftImages.set(task!.id, editor.read()); setDraft(task!.id, input.value); options.resize();
      });
      editor.set(draftImages.get(task.id) ?? []); imagesReady = true;
      const extras = cardBody.createEl('details', { cls: 'wt-quick-extras' });
      const summary = extras.createEl('summary', { text: '待办 ' });
      summary.createSpan({ cls: 'wt-quick-todo-count', text: `${task.todos?.filter(todo => todo.done).length ?? 0}/${task.todos?.length ?? 0}` });
      extras.open = expandedExtras.has(task.id);
      renderCardTodos(host, extras, task, true, true);
      host.renderNotes(extras, task);
      const menu = extras.createEl('button', { cls: 'wt-quick-more', text: '更多任务操作', attr: { type: 'button' } });
      menu.onclick = event => taskMenu(event, task);
      extras.addEventListener('toggle', () => { if (extras.open) { expandedExtras.add(task.id); for (const child of extras.children) if (child !== summary) revealQuickContent(child as HTMLElement); } else expandedExtras.delete(task.id); options.resize(); });
      const footer = form.querySelector<HTMLElement>('.wt-composer-footer')!;
      const cancel = footer.querySelector<HTMLButtonElement>('.wt-composer-close')!;
      cancel.className = 'wt-secondary-action wt-progress-cancel';
      cancel.textContent = '取消';
      cancel.setAttribute('aria-label', '取消');
      cancel.title = '关闭并保留草稿';
      const submit = footer.querySelector<HTMLButtonElement>('button[type=submit]')!;
      submit.setAttribute('form', form.id);
      submit.setAttribute('aria-label', '记录进展');
      const location = footer.createEl('button', { cls: 'wt-quick-location', text: options.getLocation?.() || '工作记录', attr: { type: 'button', 'aria-label': '设置保存位置' } });
      location.onclick = () => options.openSettings?.();
      footer.prepend(location);
      card.append(footer);
      if (task.status !== 'active') {
        form.querySelector('label > span')!.textContent = '任务已结束，可在更多任务操作中重新打开';
        form.querySelector('textarea')!.disabled = submit.disabled = true;
      }
      if (confirming.has(task.id) || [...pending.values()].some(item => item.operation.taskId === task.id)) {
        cancel.disabled = true;
        submit.disabled = input.disabled = true;
        submit.setAttribute('aria-busy', 'true');
      }
    } else { container.prepend(toolbar); renderCandidates(body); }
    if (reveal) revealQuickContent(body);
    options.resize();
  }
  function renderCandidates(parent: HTMLElement) {
      const list = parent.querySelector<HTMLElement>('.wt-quick-results') ?? parent.createDiv({ cls: 'wt-quick-results', attr: { role: 'group', 'aria-label': '可切换的任务' } });
      list.replaceChildren();
      const query = search.value.toLocaleLowerCase();
      const candidates = tasks.filter(task => (query || task.status === 'active') && [task.title, task.groupName, ...task.events.filter(e => e.kind === 'progress').map(e => e.text)].join('\n').toLocaleLowerCase().includes(query)).sort((a,b) => b.events.at(-1)!.at.localeCompare(a.events.at(-1)!.at));
      if (!candidates.length) list.createEl('p', { text: tasks.length ? '没有匹配的任务' : '当前目录还没有任务', cls: 'wt-empty', attr: { role: 'status' } });
      for (const item of candidates) {
        const b = list.createEl('button', { cls: 'wt-quick-task', attr: { type: 'button', 'aria-label': `选择任务：${item.title}` } });
        const iconSlot = b.createSpan({ cls: 'wt-quick-task-icon', attr: { 'aria-hidden': 'true' } });
        const itemIcon = taskIcon(item, groups);
        if (itemIcon) setContentIcon(iconSlot, itemIcon);
        const copy = b.createSpan({ cls: 'wt-quick-task-copy' });
        copy.createSpan({ cls: 'wt-quick-task-title', text: item.title });
        copy.createEl('small', { text: `${item.groupName} · ${item.status === 'active' ? '进行中' : item.status === 'completed' ? '已完成' : '已关闭'}` });
        if (item.id === host.selectedTaskId) {
          b.setAttribute('aria-current', 'true');
          options.setIcon(b.createSpan({ cls: 'wt-quick-task-check', attr: { 'aria-hidden': 'true' } }), 'check');
        }
        b.onclick = () => { choosing = false; host.selectedTaskId = host.expandedTaskId = item.id; render(); host.focusCard(item.id); };
      }
  }
  // Keep the search field mounted so filtering preserves focus and IME composition.
  search.oninput = () => { renderCandidates(search.closest<HTMLElement>('.wt-inline-picker') ?? body); options.resize(); };
  container.addEventListener('keydown', event => {
    if (event.isComposing || !['ArrowDown','ArrowUp'].includes(event.key) || toolbar.hidden) return;
    const list = [...body.querySelectorAll<HTMLButtonElement>('.wt-quick-task')];
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (list.length) { event.preventDefault(); list[(index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }
  });
  container.addEventListener('compositionstart', () => { composing = true; });
  container.addEventListener('compositionend', () => { composing = false; });
  back.onclick = () => { choosing = false; render(); if (host.selectedTaskId) host.focusCard(host.selectedTaskId); };
  return {
    setError: (message: string) => { setFeedback('failed', message); },
    isSaving: () => pending.size > 0,
    isComposing: () => composing,
    show: () => { visibility++; active = true; choosing = false; container.hidden = false; render(); if (host.selectedTaskId) host.focusCard(host.selectedTaskId); else search.focus(); },
    hide: () => { visibility++; active = false; container.hidden = true; },
    update(value: { workspace?: string; location?: string; quickError?: string; tasks?: TaskSource[]; groups?: WorkGroup[]; progressDrafts?: Record<string,string>; receipts?: Receipt[] }) {
      if (value.workspace !== undefined && value.workspace !== workspace) {
        workspace = value.workspace; state.drafts = {}; draftImages.clear(); tasks = []; sourcesKey = ''; images.clear(); attempts.clear(); handled.clear();
        for (const item of pending.values()) item.reject(Error('保存位置已切换，原草稿保留在原仓库'));
        pending.clear(); confirming.clear(); choosing = false; host.selectedTaskId = host.expandedTaskId = null; setFeedback('idle', '');
        if (active) render();
      }
      if (value.quickError) { setFeedback('failed', value.quickError); tasks = []; sourcesKey = ''; if (active) render(); }
      if (value.progressDrafts) {
        state.drafts = { ...value.progressDrafts }; draftImages.clear();
        for (const [id, source] of Object.entries(value.progressDrafts)) {
          try {
            const draft = JSON.parse(source);
            if (draft?.format === 'tracelo-progress-draft-v1' && typeof draft.text === 'string' && Array.isArray(draft.images)) {
              state.drafts[id] = draft.text;
              draftImages.set(id, draft.images.map((image: DraftImage) => image.state === 'processing' ? { ...image, state:'failed',error:'图片处理已中断，请重试' } : image));
            }
          } catch { /* Existing plain-text drafts remain readable. */ }
        }
      }
      if (value.groups) groups = value.groups;
      let changed = !!value.groups || value.location !== undefined;
      const savedTodos: string[] = [];
      if (value.tasks && JSON.stringify(value.tasks) !== sourcesKey) {
        sourcesKey = JSON.stringify(value.tasks); images = new Map(); tasks = []; paths.clear();
        for (const item of value.tasks) { try { const task = parseTaskMarkdown(item.markdown); if (!tasks.some(t => t.id === task.id)) { tasks.push(task); images.set(task.id, item.images ?? {}); if (item.path) paths.set(task.id, item.path); } } catch { notice('部分任务无法读取，请在插件中检查存档'); } }
        changed = true;
      }
      for (const receipt of value.receipts ?? []) {
        const operation = pending.get(receipt.id);
        if (!operation) {
          const op = receipt.operation;
          if (!op || handled.has(receipt.id)) continue;
          if (receipt.status === 'queued') {
            // Reopened hosts attach to durable commands rather than enqueueing a duplicate.
            const key = JSON.stringify({ taskId: op.taskId, kind: op.kind, ...Object.fromEntries(Object.entries(op).filter(([key]) => !['version','id','taskId','kind'].includes(key))) });
            attempts.set(key, op); setFeedback('queued', receipt.message);
            pending.set(op.id, { operation: op, resolve: () => { if (op.kind === 'progress' && matchesDraft(op)) setDraft(op.taskId, ''); confirming.delete(op.taskId); }, reject: error => notice(error.message) });
            changed = true;
          } else {
            handled.add(receipt.id);
            if (receipt.status === 'applied' && op.kind === 'progress' && matchesDraft(op)) { setDraft(op.taskId, ''); setFeedback('success', receipt.message); }
            else if (receipt.status === 'failed') setFeedback('failed', receipt.message);
          }
          continue;
        }
        setFeedback(receipt.status === 'applied' ? 'success' : receipt.status === 'failed' ? 'failed' : 'queued', receipt.message);
        if (receipt.status === 'applied') {
          pending.delete(receipt.id); handled.add(receipt.id);
          for (const [key, value] of attempts) if (value.id === receipt.id) attempts.delete(key);
          if (operation.operation.kind === 'progress') confirming.add(operation.operation.taskId);
          if (operation.operation.kind === 'todo_toggle' && operation.operation.todoId) savedTodos.push(operation.operation.todoId);
          operation.resolve(); changed = true;
        }
        else if (receipt.status === 'failed') { pending.delete(receipt.id); handled.add(receipt.id); operation.reject(Error(receipt.message)); changed = true; }
      }
      if (active && changed) { const focused = document.activeElement?.className; render(); if (focused === '') body.querySelector<HTMLTextAreaElement>('.wt-card-composer textarea')?.focus(); }
      for (const id of savedTodos) {
        const row = body.querySelector<HTMLElement>(`[data-todo-id="${CSS.escape(id)}"]`);
        if (row) revealQuickContent(row);
      }
    },
  };
}
