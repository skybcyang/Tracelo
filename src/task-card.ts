import { dayKey, isTaskEnded, taskIcon, type WorkTask } from './domain';
import { setContentIcon } from './content-icons';
import type WorkTimelinePlugin from './main';
export interface CardHost {
  plugin: Pick<WorkTimelinePlugin, 'groups' | 'state' | 'dropTask' | 'toggleTaskTodo' | 'editTaskTodo' | 'removeTaskTodo' | 'restoreTaskTodo' | 'addTaskTodo' | 'updateDraft' | 'recordProgress'>;
  selectedTaskId: string | null; expandedTaskId: string | null; addingTodoTaskId: string | null; recordedTaskId: string | null;
  editingNotes: Set<string>; openCompletedTodos: Set<string>; contentEl: HTMLElement;
  setIcon(element: HTMLElement, name: string): void;
  iconButton(container: HTMLElement, icon: string, label: string, cls?: string): HTMLButtonElement;
  showTaskMenu(event: MouseEvent, task: WorkTask): void;
  openDueDate(task: WorkTask): void; collapseCard(id: string): void; focusCard(id: string): void; render(): void;
  renderNotes(body: HTMLElement, task: WorkTask): void;
  notice(message: string, duration?: number): { messageEl: HTMLElement; hide(): void };
  prompt(heading: string, initial: string, placeholder: string, multiline: boolean, submit: (value: string) => Promise<void>): void;
}
export function formatTime(at: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
}

export function formatDateTime(at: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
}

export function dueLabel(task: WorkTask, today = dayKey(new Date())): string {
  const date = task.dueDate!;
  const label = `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日截止`;
  if (task.status !== "active") return label;
  if (date < today) return `${label} · 已逾期`;
  if (date === today) return `${label} · 今天`;
  return label;
}

export function dueState(task: WorkTask, today = dayKey(new Date())): string {
  if (!task.dueDate || task.status !== "active") return "";
  return task.dueDate < today ? "is-overdue" : task.dueDate === today ? "is-today" : "";
}

export function cardDueLabel(task: WorkTask): string {
  const state = dueState(task);
  if (state === "is-today") return "今天截止";
  const date = task.dueDate!;
  const short = `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
  return state === "is-overdue" ? `已逾期 · ${short}` : `${short}截止`;
}

export function renderTaskCard(host: CardHost, container: HTMLElement, task: WorkTask, area: string): void {
    const selected = host.selectedTaskId === task.id;
    const editing = host.expandedTaskId === task.id;
    const expanded = editing;
    const card = container.createEl("article", {
      cls: `wt-card${selected ? " is-selected" : ""}${isTaskEnded(task) ? " is-ended" : ""}${expanded ? " is-expanded" : ""}${editing ? " is-editing" : ""}`,
      attr: { "data-task-id": task.id, draggable: String(task.status === "active") },
    });
    const body = card.createDiv({ cls: "wt-card-body" });
    if (selected) body.createSpan({ text: "正在查看历史", cls: "wt-card-selection" });
    const heading = body.createDiv({ cls: "wt-card-heading" });
    const icon = taskIcon(task, host.plugin.groups);
    if (icon) setContentIcon(heading.createSpan({ cls: 'wt-task-icon', attr: { 'aria-hidden': 'true' } }), icon);
    const open = heading.createEl("button", {
      cls: "wt-card-open",
      attr: { type: "button", "aria-expanded": String(expanded), "aria-label": `${task.status === "active" ? "查看并记录" : "查看任务"}：${task.title}` },
    });
    open.createSpan({ text: task.title, cls: "wt-card-title" });
    const actions = heading.createDiv({ cls: 'wt-card-heading-actions' });
    host.iconButton(actions, "more-horizontal", `任务操作：${task.title}`, "wt-card-menu")
      .addEventListener("click", (event) => host.showTaskMenu(event, task));
    if (task.dueDate) {
      const deadline = body.createDiv({ cls: "wt-card-deadline" });
      const due = deadline.createEl("button", { cls: `wt-summary-chip wt-due-chip ${dueState(task)}`, attr: { type: "button", "aria-label": `修改截止日期：${dueLabel(task)}`, title: dueLabel(task) } });
      host.setIcon(due, "calendar-days");
      due.querySelector("svg")?.setAttribute("aria-hidden", "true");
      due.createSpan({ text: cardDueLabel(task) });
      due.addEventListener("click", () => host.openDueDate(task));
    }
    const latest = [...task.events].reverse().find(({ kind }) => kind === "progress");
    const today = dayKey(new Date());
    if (latest) {
      const isToday = latest.day === today;
      body.createEl("span", { text: isToday ? "最新进展 · 今天" : "最新进展", cls: `wt-latest-label${isToday ? " is-today" : ""}` });
      body.createEl("p", { text: latest.text, cls: "wt-card-latest" });
    }
    if (host.recordedTaskId === task.id) body.createSpan({ text: "✓ 进展已记录", cls: "wt-recorded-feedback", attr: { role: "status" } });
    host.renderNotes(body, task);
    const footer = body.createEl("footer", { cls: "wt-card-footer" });
    const statusRow = footer.createDiv({ cls: 'wt-card-status-row' });
    if (task.todos?.length) {
      const summary = statusRow.createDiv({ cls: "wt-card-summary" });
      const count = task.todos.filter(({ done }) => done).length;
      const label = `查看待办，已完成 ${count}/${task.todos.length}`;
      const todo = summary.createEl("button", { cls: `wt-summary-chip wt-progress-chip${count === task.todos.length ? " is-complete" : count === 0 ? " is-empty" : ""}`, attr: { type: "button", "aria-label": label, title: label } });
      const ring = todo.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
      ring.setAttribute("viewBox", "0 0 20 20");
      ring.setAttribute("aria-hidden", "true");
      for (const cls of ["wt-progress-track", "wt-progress-value"]) {
        const circle = todo.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "circle");
        for (const [key, value] of Object.entries({ cx: "10", cy: "10", r: "7", fill: "none", "stroke-width": "2.5", pathLength: "100", class: cls })) circle.setAttribute(key, value);
        if (cls === "wt-progress-value") circle.setAttribute("stroke-dasharray", `${100 * count / task.todos.length} 100`);
        ring.append(circle);
      }
      todo.append(ring);
      todo.createSpan({ text: `${count}/${task.todos.length}` });
      todo.addEventListener("click", () => {
        host.selectedTaskId = task.id;
        host.expandedTaskId = task.id;
        host.render();
        requestAnimationFrame(() => host.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${task.id}"] ${task.status === "active" ? ".wt-todo-check" : ".wt-card-open"}`)?.focus());
      });
    }
    const meta = footer.createDiv({ cls: "wt-card-meta" });
    const context = meta.createDiv({ cls: "wt-card-context" });
    const properties = context.createDiv({ cls: "wt-card-properties" });
    if (host.plugin.state.viewMode === "quadrant" || isTaskEnded(task)) properties.createSpan({ text: task.groupName });
    if ((host.plugin.state.viewMode === "group" || isTaskEnded(task)) && (task.important || task.urgent)) {
      const priority = task.important && task.urgent ? "重要且紧急" : task.important ? "重要" : "紧急";
      properties.createSpan({ text: priority, cls: `wt-tag is-${task.important && task.urgent ? "important-urgent" : task.important ? "important" : "urgent"}` });
    }
    if (task.status !== "active") properties.createSpan({ text: task.status === "completed" ? "已完成" : "异常关闭", cls: `wt-status is-${task.status}` });
    if (!properties.childElementCount) properties.remove();
    if (!context.childElementCount) context.remove();
    const updated = latest ?? task.events[0]!;
    const timeText = updated.day === today ? `今天 ${formatTime(updated.at)}` : formatDateTime(updated.at);
    meta.createEl("time", { text: `${latest ? "进展" : "创建"} · ${timeText}`, cls: "wt-card-time", attr: { datetime: updated.at, title: `${latest ? "最近进展" : "创建时间"}：${formatDateTime(updated.at)}` } });
    if (!statusRow.childElementCount) statusRow.remove();
    const toggleCard = (): void => {
      if (editing) { host.collapseCard(task.id); return; }
      host.selectedTaskId = task.id;
      host.expandedTaskId = task.id;
      host.render();
      host.focusCard(task.id);
    };
    open.addEventListener("click", toggleCard);
    if (!expanded) {
      const more = meta.createEl('button', { text: '展开完整内容', cls: 'wt-read-more', attr: { type: 'button' } });
      more.onclick = () => open.click();
    }
    let pointerStart: { x: number; y: number } | null = null;
    let dragged = false;
    card.addEventListener("pointerdown", (event) => { pointerStart = { x: event.clientX, y: event.clientY }; dragged = false; });
    card.addEventListener("click", (event) => {
      if (event.button !== 0 || event.defaultPrevented || dragged || host.editingNotes.has(task.id)) return;
      if (editing && host.plugin.state.drafts[task.id]?.trim()) return;
      if ((event.target as Element).closest("button, a, img, input, textarea, select, label, [contenteditable], .wt-card-todos, .wt-card-composer, .wt-optional-actions")) return;
      if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
      const selection = card.ownerDocument.getSelection();
      if (selection && !selection.isCollapsed && card.contains(selection.anchorNode)) return;
      toggleCard();
    });
    card.addEventListener("contextmenu", (event) => {
      if ((event.target as Element).closest("input, textarea, [contenteditable]")) return;
      event.preventDefault();
      host.showTaskMenu(event, task);
    });
    card.addEventListener("keydown", (event) => {
      if (!(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
      if ((event.target as Element).closest("input, textarea, [contenteditable]")) return;
      event.preventDefault();
      const bounds = open.getBoundingClientRect();
      host.showTaskMenu(new MouseEvent("contextmenu", { clientX: bounds.left, clientY: bounds.bottom }), task);
    });

    if (task.status === "active") {
      card.addEventListener("dragstart", (event) => {
        if ((event.target as HTMLElement).closest("input, textarea, button, label")) { event.preventDefault(); return; }
        dragged = true;
        event.dataTransfer?.setData("text/plain", task.id);
        card.addClass("is-dragging");
      });
      card.addEventListener("dragend", () => card.removeClass("is-dragging"));
      card.addEventListener("dragover", (event) => { event.preventDefault(); event.stopPropagation(); card.addClass("is-drag-over"); });
      card.addEventListener("dragleave", () => card.removeClass("is-drag-over"));
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        card.removeClass("is-drag-over");
        const moving = event.dataTransfer?.getData("text/plain");
        if (moving && moving !== task.id) void host.plugin.dropTask(moving, host.plugin.state.viewMode, area, task.id).catch(reason => { host.notice(String(reason)); });
      });
    }
    renderCardTodos(host, body, task, editing, expanded);
    const checklist = body.querySelector('.wt-card-todos');
    if (checklist) body.insertBefore(checklist, footer);
    if (task.status === "active" && editing) renderCardComposer(host, body, task);
  }

export function renderCardTodos(host: CardHost, card: HTMLElement, task: WorkTask, editing: boolean, expanded: boolean): void {
    const showChecklist = Boolean(task.todos?.length) || host.addingTodoTaskId === task.id;
    let section: HTMLElement | undefined;
    if (showChecklist) {
      section = card.createEl("section", { cls: `wt-card-todos${expanded ? '' : ' is-summary'}`, attr: { "aria-label": "待办清单" } });
      const heading = section.createDiv({ cls: "wt-checklist-heading" });
      heading.createEl("h4", { text: "待办清单" });
      if (!task.todos?.length) heading.createSpan({ text: "按需添加", cls: "wt-checklist-count" });
      const pending = task.todos?.filter(item => !item.done) ?? [];
      const completed = task.todos?.filter(item => item.done) ?? [];
      const shown = expanded ? task.todos ?? [] : [...pending.slice(0, 3), ...completed];
      let completedSection: HTMLDetailsElement | undefined;
      for (const item of shown) {
        let parent: HTMLElement = section;
        if (!expanded && item.done) {
          if (!completedSection) {
            completedSection = section.createEl('details', { cls: 'wt-completed-todos' });
            completedSection.open = host.openCompletedTodos.has(task.id);
            completedSection.createEl('summary', { text: `已完成 ${completed.length} 项` });
            completedSection.addEventListener('toggle', () => {
              if (!completedSection?.isConnected) return;
              if (completedSection.open) host.openCompletedTodos.add(task.id); else host.openCompletedTodos.delete(task.id);
            });
          }
          parent = completedSection;
        }
        const row = parent.createDiv({ cls: "wt-todo-row" });
        const label = row.createEl("label", { cls: "wt-todo-label" });
        const check = label.createEl("input", { type: "checkbox", cls: "wt-todo-check", attr: { "aria-label": item.text } });
        check.checked = item.done;
        check.disabled = task.status !== "active";
        label.createSpan({ text: item.text, cls: item.done ? "is-done" : "" });
        check.addEventListener("change", async () => {
          check.disabled = true;
          try {
            await host.plugin.toggleTaskTodo(task.id, item.id, check.checked);
            requestAnimationFrame(() => {
              const card = host.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${task.id}"]`);
              const input = card?.querySelector<HTMLElement>(`.wt-todo-check[aria-label="${CSS.escape(item.text)}"]`);
              const folded = input?.closest('details');
              (input && (!folded || folded.open) ? input : card?.querySelector<HTMLElement>('.wt-progress-chip'))?.focus({ preventScroll: true });
            });
          } catch (reason) {
            check.checked = item.done;
            check.disabled = false;
            host.notice(reason instanceof Error ? reason.message : "未能保存，请重试");
          }
        });
        if (task.status === "active" && editing) {
          host.iconButton(row, "pencil", `编辑待办：${item.text}`).addEventListener("click", () => host.prompt( "编辑待办", item.text, "待办内容", false, (value) => host.plugin.editTaskTodo(task.id, item.id, value),
          ));
          host.iconButton(row, "trash-2", `删除待办：${item.text}`).addEventListener("click", async () => {
            try {
              const removed = await host.plugin.removeTaskTodo(task.id, item.id);
              const notice = host.notice("待办已删除", 8000);
              const undo = notice.messageEl.createEl("button", { text: "撤销", cls: "wt-undo-button", attr: { type: "button" } });
              undo.addEventListener("click", async () => {
                undo.disabled = true;
                try { await host.plugin.restoreTaskTodo(task.id, removed.todo, removed.index); notice.hide(); }
                catch (reason) { undo.disabled = false; host.notice(reason instanceof Error ? reason.message : "未能恢复，请重试"); }
              });
            } catch (reason) { host.notice(reason instanceof Error ? reason.message : "未能保存，请重试"); }
          });
        }
      }
      if (!expanded && pending.length > 3) {
        const more = section.createEl('button', { text: `还有 ${pending.length - 3} 项待办`, cls: 'wt-more-todos', attr: { type: 'button' } });
        more.onclick = () => { host.selectedTaskId = task.id; host.expandedTaskId = task.id; host.render(); host.focusCard(task.id); };
      }
    }
    if (task.status !== "active" || !editing) return;
    if (section) {
      const form = section.createEl("form", { cls: "wt-add-todo" });
      const input = form.createEl("input", { type: "text", attr: { "aria-label": "新增待办", placeholder: "添加下一步要做的事", maxlength: "160", required: "" } });
      let composing = false;
      input.addEventListener("compositionstart", () => { composing = true; });
      input.addEventListener("compositionend", () => { composing = false; });
      input.addEventListener("keydown", event => {
        if (event.key === "Enter" && (composing || event.isComposing || event.keyCode === 229)) event.preventDefault();
      });
      const submit = host.iconButton(form, "plus", "添加待办", "wt-add-todo-submit");
      submit.setAttr("type", "submit");
      if (!task.todos?.length) {
        const cancel = () => { host.addingTodoTaskId = null; host.render(); host.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${task.id}"] .wt-optional-actions button`)?.focus(); };
        host.iconButton(form, "x", "取消添加待办").addEventListener("click", cancel);
        input.addEventListener("keydown", (event) => {
          if (event.key === "Escape" && !composing && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); cancel(); }
        });
      }
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (composing || submit.disabled) return;
        submit.disabled = true;
        try {
          host.addingTodoTaskId = null;
          await host.plugin.addTaskTodo(task.id, input.value);
          host.contentEl.querySelector<HTMLInputElement>(`.wt-card[data-task-id="${task.id}"] .wt-add-todo input`)?.focus();
        } catch (reason) { submit.disabled = false; host.notice(reason instanceof Error ? reason.message : "未能保存，请重试"); }
      });
    }
    if (!showChecklist || !task.dueDate) {
      const actions = card.createDiv({ cls: "wt-optional-actions" });
      if (!showChecklist) {
        const add = actions.createEl("button", { attr: { type: "button" } });
        host.setIcon(add.createSpan({ attr: { "aria-hidden": "true" } }), "plus");
        add.createSpan({ text: "添加待办" });
        add.addEventListener("click", () => { host.addingTodoTaskId = task.id; host.render(); host.contentEl.querySelector<HTMLInputElement>(`.wt-card[data-task-id="${task.id}"] .wt-add-todo input`)?.focus(); });
      }
      if (!task.dueDate) {
        const due = actions.createEl("button", { attr: { type: "button" } });
        host.setIcon(due.createSpan({ attr: { "aria-hidden": "true" } }), "calendar-days");
        due.createSpan({ text: "设置截止日期" });
        due.addEventListener("click", () => host.openDueDate(task));
      }
    }
  }

export function renderCardComposer(host: CardHost, card: HTMLElement, task: WorkTask): void {
    const form = card.createEl("form", { cls: "wt-card-composer" });
    const label = form.createEl("label");
    label.createSpan({ text: "记录当前进展" });
    const input = label.createEl("textarea", {
      attr: { rows: "3", maxlength: "2000", placeholder: "记录已经推进的事…", required: "" },
    });
    input.value = host.plugin.state.drafts[task.id] ?? "";
    let composing = false, saving = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener("input", () => host.plugin.updateDraft(task.id, input.value));
    const footer = form.createDiv({ cls: "wt-composer-footer" });
    const close = footer.createEl('button', { text: '收起', cls: 'wt-composer-close', attr: { type: 'button', 'aria-label': '关闭进展输入' } });
    close.onclick = () => host.collapseCard(task.id);
    input.addEventListener("keydown", event => {
      if (event.isComposing || composing || event.keyCode === 229) return;
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.requestSubmit(); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); host.collapseCard(task.id); }
    });
    const submit = footer.createEl("button", { text: "记录进展", cls: "mod-cta", attr: { type: "submit" } });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saving || composing) return;
      saving = true;
      submit.disabled = input.disabled = true;
      try {
        await host.plugin.recordProgress(task.id, input.value);
        if (host.expandedTaskId === task.id) { host.expandedTaskId = null; host.render(); }
      } catch (reason) {
        saving = false;
        submit.disabled = input.disabled = false;
        host.notice(reason instanceof Error ? reason.message : "无法记录进展");
      }
    });
  }
