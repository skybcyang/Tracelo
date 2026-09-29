import { parseTaskMarkdown, normalizePluginState } from './archive';
import { QUADRANTS, type WorkTask, type WorkGroup } from './domain';
import { renderTaskCard, type CardHost } from './task-card';
import type { QuickOperation } from './quick-operations';
import MarkdownIt from 'markdown-it';

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
type TaskSource = { markdown: string; images?: Record<string, string> };
interface Options { send(value: Record<string, unknown>): void; setIcon(element: HTMLElement, name: string): void; resize(): void }
export function mountQuickProgress(container: HTMLElement, options: Options) {
  installCardDOM();
  let tasks: WorkTask[] = [], groups: WorkGroup[] = [], images = new Map<string, Record<string, string>>();
  const state = normalizePluginState(null);
  const pending = new Map<string, { operation: QuickOperation; resolve(): void; reject(reason: Error): void }>();
  const attempts = new Map<string, QuickOperation>();
  let active = false, sourcesKey = '', workspace = '';
  const handled = new Set<string>();
  const toolbar = container.createDiv({ cls: 'wt-quick-toolbar' });
  const back = toolbar.createEl('button', { text: '切换任务', attr: { type: 'button' } });
  back.hidden = true;
  const search = toolbar.createEl('input', { type: 'search', attr: { placeholder: '搜索任务、分组或进展', 'aria-label': '搜索已有任务' } });
  const status = container.createDiv({ cls: 'wt-quick-status', attr: { role: 'status', 'aria-live': 'polite' } });
  const body = container.createDiv({ cls: 'wt-quick-body' });
  function setDraft(id: string, text: string) { state.drafts[id] = text; options.send({ action: 'progressDraft', taskId: id, text }); }
  function notice(message: string) { status.textContent = message; return { messageEl: status, hide: () => { status.textContent = ''; } }; }
  function perform(taskId: string, kind: QuickOperation['kind'], values: Partial<QuickOperation> = {}): Promise<void> {
    const key = JSON.stringify({ taskId, kind, ...values });
    let op = attempts.get(key);
    if (!op) { op = { version: 1, id: 'quick-' + [...crypto.getRandomValues(new Uint8Array(16))].map(v => v.toString(16).padStart(2, '0')).join(''), taskId, kind, ...values }; attempts.set(key, op); }
    const operation = op;
    if (pending.has(op.id)) return Promise.reject(Error('此操作正在等待写入，请勿重复提交'));
    return new Promise((resolve, reject) => {
      pending.set(operation.id, { operation, resolve, reject });
      status.textContent = '正在保存…'; options.send({ action: 'operation', operation });
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
    const close = () => { dialog.close(); dialog.remove(); };
    cancel.onclick = close;
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); if (!event.isComposing) { event.preventDefault(); close(); } } });
    input.addEventListener('keydown', raw => { const event = raw as KeyboardEvent; if (event.isComposing && event.key === 'Enter') event.preventDefault(); });
    form.onsubmit = async event => {
      event.preventDefault(); if (submit.disabled) return; submit.disabled = true; feedback.textContent = '正在保存；Obsidian 未运行时将暂存';
      try { await submitValue(input.value); close(); render(); }
      catch (error) { feedback.textContent = String(error); submit.disabled = false; }
    };
    document.body.append(dialog); dialog.showModal(); input.focus();
  }
  function taskMenu(event: MouseEvent, task: WorkTask) {
    event.stopPropagation(); const menu = document.createElement('dialog'); menu.className = 'wt-modal wt-quick-menu'; menu.setAttribute('aria-label', '任务操作');
    const add = (label: string, action: () => void) => { const b = menu.createEl('button', { text: label, attr: { type: 'button' } }); b.onclick = () => { menu.close(); menu.remove(); action(); }; };
    const ask = (label: string, initial: string, kind: QuickOperation['kind'], multiline = false) => add(label, () => prompt(label, initial, '', multiline, text => perform(task.id, kind, { text })));
    add('打开任务文件夹', () => options.send({ action: 'openTaskFolder', taskId: task.id }));
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
        await perform(id, 'progress', { text });
        if (state.drafts[id] === text) { setDraft(id, ''); if (active && host.selectedTaskId === id) options.send({ action: 'progressComplete' }); }
      },
    },
    selectedTaskId: null, expandedTaskId: null, addingTodoTaskId: null, recordedTaskId: null,
    editingNotes: new Set(), openCompletedTodos: new Set(), contentEl: body,
    setIcon: options.setIcon,
    iconButton: (parent, icon, label, cls = 'wt-icon-button') => { const b = parent.createEl('button', { cls, attr: { type: 'button', 'aria-label': label } }); options.setIcon(b, icon); return b; },
    showTaskMenu: taskMenu,
    openDueDate: task => prompt('截止日期（YYYY-MM-DD，留空清除）', task.dueDate ?? '', 'YYYY-MM-DD', false, text => perform(task.id, 'due', { text })),
    collapseCard: () => options.send({ action: 'progressDismiss' }),
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
    body.replaceChildren(); back.hidden = !host.selectedTaskId; search.hidden = !!host.selectedTaskId;
    const task = tasks.find(task => task.id === host.selectedTaskId);
    if (task) {
      renderTaskCard(host, body, task, 'quick');
      body.querySelector<HTMLElement>('.wt-card')?.setAttribute('draggable', 'false');
      if (pending.size) body.querySelectorAll<HTMLButtonElement>('.wt-card-composer button[type=submit]').forEach(button => { button.disabled = true; });
    } else {
      const query = search.value.toLocaleLowerCase();
      const candidates = tasks.filter(task => (query || task.status === 'active') && [task.title, task.groupName, ...task.events.filter(e => e.kind === 'progress').map(e => e.text)].join('\n').toLocaleLowerCase().includes(query)).sort((a,b) => b.events.at(-1)!.at.localeCompare(a.events.at(-1)!.at));
      if (!candidates.length) body.createEl('p', { text: tasks.length ? '没有匹配的任务' : '当前目录还没有任务', cls: 'wt-empty' });
      for (const item of candidates) {
        const b = body.createEl('button', { cls: 'wt-quick-task', attr: { type: 'button', 'aria-label': `选择任务：${item.title}` } });
        b.createSpan({ text: item.title }); b.createEl('small', { text: `${item.groupName} · ${item.status === 'active' ? '进行中' : item.status === 'completed' ? '已完成' : '已关闭'}` });
        b.onclick = () => { host.selectedTaskId = host.expandedTaskId = item.id; render(); host.focusCard(item.id); };
      }
    }
    options.resize();
  }
  search.oninput = () => render();
  container.addEventListener('keydown', event => {
    if (event.isComposing || !['ArrowDown','ArrowUp'].includes(event.key) || host.selectedTaskId) return;
    const list = [...body.querySelectorAll<HTMLButtonElement>('.wt-quick-task')];
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (list.length) { event.preventDefault(); list[(index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }
  });
  back.onclick = () => { host.selectedTaskId = host.expandedTaskId = null; render(); search.focus(); };
  return {
    setError: (message: string) => { status.textContent = message; },
    show: () => { active = true; container.hidden = false; host.selectedTaskId = host.expandedTaskId = null; render(); search.focus(); },
    hide: () => { active = false; container.hidden = true; },
    update(value: { workspace?: string; quickError?: string; tasks?: TaskSource[]; groups?: WorkGroup[]; progressDrafts?: Record<string,string>; receipts?: Receipt[] }) {
      if (value.workspace !== undefined && value.workspace !== workspace) {
        workspace = value.workspace; state.drafts = {}; tasks = []; sourcesKey = ''; images.clear(); attempts.clear(); handled.clear();
        for (const item of pending.values()) item.reject(Error('保存位置已切换，原草稿保留在原仓库'));
        pending.clear(); host.selectedTaskId = host.expandedTaskId = null; status.textContent = '';
        if (active) render();
      }
      if (value.quickError) { status.textContent = value.quickError; tasks = []; sourcesKey = ''; if (active) render(); }
      if (value.progressDrafts) state.drafts = { ...value.progressDrafts };
      if (value.groups) groups = value.groups;
      let changed = false;
      if (value.tasks && JSON.stringify(value.tasks) !== sourcesKey) {
        sourcesKey = JSON.stringify(value.tasks); images = new Map(); tasks = [];
        for (const item of value.tasks) { try { const task = parseTaskMarkdown(item.markdown); if (!tasks.some(t => t.id === task.id)) { tasks.push(task); images.set(task.id, item.images ?? {}); } } catch { notice('部分任务无法读取，请在插件中检查存档'); } }
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
            attempts.set(key, op); status.textContent = receipt.message;
            pending.set(op.id, { operation: op, resolve: () => { if (op.kind === 'progress' && state.drafts[op.taskId] === op.text) setDraft(op.taskId, ''); }, reject: error => notice(error.message) });
          } else {
            handled.add(receipt.id);
            if (receipt.status === 'applied' && op.kind === 'progress' && state.drafts[op.taskId] === op.text) { setDraft(op.taskId, ''); status.textContent = receipt.message; }
          }
          continue;
        }
        status.textContent = receipt.message;
        if (receipt.status === 'applied') {
          pending.delete(receipt.id); handled.add(receipt.id);
          for (const [key, value] of attempts) if (value.id === receipt.id) attempts.delete(key);
          operation.resolve(); changed = true;
        }
        else if (receipt.status === 'failed') { pending.delete(receipt.id); handled.add(receipt.id); operation.reject(Error(receipt.message)); }
      }
      if (active && changed) { const focused = document.activeElement?.className; render(); if (focused === '') body.querySelector<HTMLTextAreaElement>('.wt-card-composer textarea')?.focus(); }
    },
  };
}
