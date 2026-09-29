import { QUADRANTS, UNGROUPED_TASKS, createTask, setDueDate, addTodo, addProgress, type CreateTaskInput, type QuadrantId, type WorkGroup } from './domain';
import { mountDraftImages, type DraftImage } from './draft-images';

export interface NewTaskValues extends CreateTaskInput { initialProgress: string; dueDate: string | null; todos: string[]; images?: DraftImage[]; creationId?: string }
export interface NewTaskContext { groupId?: string | null; quadrant?: QuadrantId }
export interface NewTaskDraft {
  title: string; notes: string; groupId: string; quadrant: QuadrantId; todos: string[];
  dueDate: string; initialProgress: string; expanded: { todos: boolean; due: boolean; progress: boolean };
  images?: DraftImage[]; creationId?: string;
}
function newId(): string {
  // Local WebKit/WebView2 documents lack randomUUID's secure-context exposure.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function buildNewTask(input: NewTaskValues, now = new Date(), id: () => string = newId) {
  let task = createTask(input, now, input.creationId ?? id(), id());
  let tick = 1;
  if (input.dueDate) task = setDueDate(task, input.dueDate, new Date(now.getTime() + tick++), id());
  for (const text of input.todos) task = addTodo(task, text, new Date(now.getTime() + tick++), id(), id());
  if (input.initialProgress.trim()) task = addProgress(task, input.initialProgress, new Date(now.getTime() + tick), id());
  return task;
}

interface Options {
  groups: Pick<WorkGroup, 'id' | 'name'>[]; draft?: Partial<NewTaskDraft> | null; context?: NewTaskContext;
  isWin?: boolean; setIcon: (element: HTMLElement, name: string) => void;
  onSubmit: (values: NewTaskValues, draft: NewTaskDraft) => Promise<void>;
  onCancel: () => void; onChange?: (draft: NewTaskDraft) => void; onResize?: () => void;
}

/** One form for Obsidian and desktop hosts; hosts own persistence, windows and storage. */
export function mountNewTaskForm(container: HTMLElement, options: Options) {
  function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls = '', text = '', attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
    const node = container.ownerDocument.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    parent.append(node); return node;
  }
  const context = options.context ?? {};
  let groups = options.groups, saving = false, available = true, composing = false;
  const expanded = { todos: false, due: false, progress: false };
  const form = el(container, 'form', 'wt-modal-form');
  const body = el(form, 'div', 'wt-new-task-body');
  const draftRow = el(body, 'div', 'wt-new-draft-row');
  const draftStatus = el(draftRow, 'span', 'wt-new-draft-status', '关闭后保留本次草稿', { role: 'status' });
  const clear = el(draftRow, 'button', 'wt-new-clear', '清空草稿', { type: 'button' });
  let cleared: NewTaskDraft | null = null, creationId = newId();
  const undoClear = el(draftRow, 'button', 'wt-new-clear', '撤销清空草稿', { type: 'button' }); undoClear.hidden = true;
  const field = (parent: HTMLElement, name: string, optional = false, cls = '') => {
    const label = el(parent, 'label', `wt-field ${cls}`.trim());
    const heading = optional ? el(label, 'span', 'wt-field-heading') : label;
    el(heading, 'span', 'wt-field-label', name);
    if (optional) el(heading, 'span', 'wt-optional', '可选');
    return label;
  };
  const title = el(field(body, '任务名称', false, 'wt-title-field'), 'input', 'wt-modal-title', '', { id: 'task-title', type: 'text', placeholder: '例如：验证自动备份', maxlength: '160', required: '' });
  const details = el(field(body, '详情', true), 'textarea', '', '', { id: 'task-details', rows: '2', 'aria-label': '任务详情', placeholder: '补充目标、要求或参考资料，可直接粘贴图片' });
  const metadata = el(body, 'div', 'wt-capture-meta');
  const groupControl = el(field(metadata, '任务分组'), 'span', 'wt-select-control');
  const group = el(groupControl, 'select', '', '', { 'aria-label': '任务分组' });
  options.setIcon(el(groupControl, 'span', 'wt-select-icon', '', { 'aria-hidden': 'true' }), 'chevron-down');
  const quadrant = el(body, 'fieldset', 'wt-quadrant-picker');
  el(el(quadrant, 'legend'), 'span', 'wt-field-label', '任务象限');
  const quadrantInputs = QUADRANTS.map(item => {
    const label = el(quadrant, 'label', `wt-quadrant-option is-${item.id}`);
    const input = el(label, 'input', '', '', { type: 'radio', name: 'quadrant', value: item.id });
    el(label, 'span', 'wt-quadrant-marker', '', { 'aria-hidden': 'true' });
    el(label, 'span', 'wt-quadrant-name', item.name);
    return input;
  });
  const selectedQuadrantId = () => (quadrantInputs.find(input => input.checked)?.value ?? '') as QuadrantId;
  const advanced = el(body, 'details', 'wt-capture-extra');
  el(advanced, 'summary', '', '待办与初始进展');
  const extraBody = el(advanced, 'div', 'wt-capture-extra-body');
  const optional = el(extraBody, 'div', 'wt-new-optional');
  const action = (parent: HTMLElement, text = '') => el(parent, 'button', 'wt-secondary-action', text, { type: 'button' });
  const todoButton = action(optional);
  const todoSection = el(extraBody, 'div', 'wt-new-todo-section');
  const todoList = el(todoSection, 'div', 'wt-new-todos');
  function addTodoRow(value = '') {
    const row = el(todoList, 'div', 'wt-new-todo-row');
    const input = el(row, 'input', '', '', { type: 'text', 'aria-label': '待办内容', placeholder: '待办内容', maxlength: '160' });
    input.value = value;
    const remove = el(row, 'button', 'clickable-icon wt-icon-button', '', { type: 'button', 'aria-label': '移除待办' });
    options.setIcon(remove, 'x');
    remove.onclick = () => { row.remove(); changed(); todoButton.focus(); };
    return input;
  }
  action(todoSection, '再加一条').onclick = () => { const input = addTodoRow(); changed(); input.focus(); };
  const dateControl = el(metadata, 'div', 'wt-date-field');
  el(dateControl, 'span', 'wt-field-label', '截止日期');
  const dateButton = action(dateControl);
  const dueField = field(dateControl, '选择截止日期', false, 'wt-new-due');
  const due = el(dueField, 'input', '', '', { type: 'date', 'aria-label': '截止日期' });
  const progressButton = action(optional);
  const progressField = field(extraBody, '初始进展', true);
  const progress = el(progressField, 'textarea', '', '', { rows: '3', 'aria-label': '初始进展', maxlength: '2000', placeholder: '例如：已完成需求梳理，准备开始实现' });
  const imageHost = el(body, 'div', 'wt-new-images');
  metadata.before(imageHost);
  const images = mountDraftImages(details, imageHost, changed);
  advanced.addEventListener('toggle', () => options.onResize?.());
  const footer = el(form, 'div', 'wt-new-task-footer');
  footer.append(draftRow);
  extraBody.append(clear);
  const error = el(footer, 'p', 'wt-form-error', '', { role: 'alert' });
  const actions = el(footer, 'div', 'wt-modal-actions');
  el(actions, 'span', 'wt-new-shortcut', options.isWin ? 'Ctrl Enter 创建' : '⌘ Enter 创建');
  const cancel = action(actions, '取消');
  const submit = el(actions, 'button', 'wt-primary-action', '', { id: 'submit', type: 'submit' });
  options.setIcon(submit, 'plus');
  const submitLabel = el(submit, 'span', '', '创建任务');
  const read = (): NewTaskDraft => ({ title: title.value, notes: details.value, groupId: group.value, quadrant: selectedQuadrantId(),
    todos: [...todoList.querySelectorAll('input')].map(input => input.value), dueDate: due.value, initialProgress: progress.value, expanded: { ...expanded }, images: images.read(), creationId });
  function refresh() {
    const count = read().todos.filter(value => value.trim()).length;
    todoButton.textContent = count ? `待办 · ${count}` : '添加待办';
    dateButton.textContent = due.value ? `截止 · ${due.value}` : '截止日期';
    progressButton.textContent = progress.value.trim() ? '初始进展 · 已填写' : '初始进展';
    for (const [button, panel, open] of [[todoButton, todoSection, expanded.todos], [dateButton, dueField, expanded.due], [progressButton, progressField, expanded.progress]] as const) {
      panel.hidden = !open; button.setAttribute('aria-expanded', String(open));
    }
    body.inert = saving; cancel.disabled = saving;
    submit.disabled = saving || images.blocked() || !available || !title.value.trim();
    submit.setAttribute('aria-busy', String(saving));
    submitLabel.textContent = saving ? '创建中…' : '创建任务';
    options.onResize?.();
  }
  function changed() { error.textContent = ''; if (container.isConnected) options.onChange?.(read()); refresh(); }
  function setGroups(items: Options['groups'], selected = group.value) {
    groups = items; group.replaceChildren();
    el(group, 'option', '', UNGROUPED_TASKS, { value: '' });
    for (const item of groups) el(group, 'option', '', item.name, { value: item.id });
    // A removed/unreadable group must never silently turn into Ungrouped.
    if (selected && !groups.some(item => item.id === selected)) el(group, 'option', '', '原分组不可用，请重新选择', { value: selected });
    group.value = selected;
  }
  function setDraft(draft?: Partial<NewTaskDraft> | null) {
    title.value = draft?.title ?? ''; details.value = draft?.notes ?? '';
    creationId = draft?.creationId ?? newId(); images.set(draft?.images ?? []);
    setGroups(groups, draft?.groupId ?? context.groupId ?? '');
    for (const input of quadrantInputs) input.checked = input.value === (draft?.quadrant ?? context.quadrant ?? 'not_important_not_urgent');
    due.value = draft?.dueDate ?? ''; progress.value = draft?.initialProgress ?? '';
    todoList.replaceChildren(); for (const value of draft?.todos ?? []) addTodoRow(value);
    Object.assign(expanded, { todos: false, due: false, progress: false }, draft?.expanded);
    advanced.open = Boolean(draft && (draft.todos?.length || draft.initialProgress || draft.images?.length || draft.expanded?.todos || draft.expanded?.progress));
    draftStatus.textContent = draft ? '已恢复草稿' : '关闭后保留本次草稿';
    refresh();
  }
  todoButton.onclick = () => { expanded.todos = !expanded.todos; if (expanded.todos && !todoList.childElementCount) addTodoRow(); changed(); if (expanded.todos) todoList.querySelector('input')?.focus(); };
  dateButton.onclick = () => { expanded.due = !expanded.due; changed(); if (expanded.due) due.focus(); };
  progressButton.onclick = () => { expanded.progress = !expanded.progress; changed(); if (expanded.progress) progress.focus(); };
  clear.onclick = () => { cleared = read(); setDraft(null); undoClear.hidden = false; draftStatus.textContent = '草稿已清空'; changed(); title.focus(); };
  undoClear.onclick = () => { setDraft(cleared); cleared = null; undoClear.hidden = true; changed(); };
  form.addEventListener('input', changed); form.addEventListener('change', changed);
  form.addEventListener('compositionstart', () => { composing = true; });
  form.addEventListener('compositionend', () => { composing = false; options.onChange?.(read()); });
  form.addEventListener('keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.requestSubmit(); }
  });
  cancel.onclick = () => { if (!saving) options.onCancel(); };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || images.blocked() || !available || composing || !title.value.trim()) return;
    const selectedQuadrant = QUADRANTS.find(item => item.id === selectedQuadrantId());
    const selectedGroup = groups.find(item => item.id === group.value);
    if (!selectedQuadrant || (group.value && !selectedGroup)) { error.textContent = '分组或象限不可用，请重新选择'; return; }
    saving = true; error.textContent = ''; options.onChange?.(read()); refresh();
    try {
      await options.onSubmit({ title: title.value, notes: details.value, groupId: selectedGroup?.id ?? null, groupName: selectedGroup?.name ?? UNGROUPED_TASKS,
        important: selectedQuadrant.important, urgent: selectedQuadrant.urgent, dueDate: due.value || null,
        initialProgress: progress.value, todos: read().todos.map(value => value.trim()).filter(Boolean), images: images.read(), creationId }, read());
    } catch (reason) { error.textContent = reason instanceof Error ? reason.message : '无法创建任务'; }
    finally { saving = false; refresh(); }
  });
  setDraft(options.draft);
  return { form, body, footer, read, setDraft, setGroups, focus: () => title.focus({ preventScroll: true }),
    destroy: () => images.destroy(),
    isSaving: () => saving, isComposing: () => composing,
    setAvailable: (value: boolean) => { available = value; refresh(); },
    setError: (value: string) => { error.textContent = value; refresh(); },
    setSaving: (value: boolean) => { saving = value; refresh(); } };
}
