import {
  App,
  ItemView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

import { AGENT_RULE } from "./agent-rule";
import { normalizePluginState, type PluginState } from "./archive";
import { ArchiveStore } from "./archive-store";
import {
  QUADRANTS,
  UNGROUPED_TASKS,
  addProgress,
  addTodo,
  applyGroupRename,
  changeTaskGroup,
  changeTaskQuadrant,
  closeTask,
  completeTask,
  createGroup,
  createTask,
  dayKey,
  dueTasksForDay,
  editTodo,
  eventsByDay,
  eventsForDay,
  groupEvent,
  groupTasks,
  isTaskEnded,
  moveTaskOrder,
  pinTask,
  quadrantId,
  quadrantName,
  quadrantTasks,
  renameTask,
  removeTodo,
  reopenTask,
  restoreTodo,
  searchTasks,
  setDueDate,
  toggleTodo,
  type CreateTaskInput,
  type GroupArchive,
  type QuadrantId,
  type TaskEvent,
  type TaskTodo,
  type TaskGroup,
  type ViewMode,
  type WorkGroup,
  type WorkTask,
} from "./domain";

const VIEW_TYPE = "work-timeline-view";

const EVENT_LABELS: Record<TaskEvent["kind"], string> = {
  created: "创建",
  renamed: "改名",
  progress: "进展",
  completed: "完成",
  closed: "异常关闭",
  reopened: "重新打开",
  group_changed: "分组变更",
  quadrant_changed: "象限变更",
  todo_added: "添加待办",
  todo_done: "完成待办",
  todo_undone: "恢复待办",
  todo_edited: "编辑待办",
  todo_removed: "删除待办",
  todo_restored: "恢复待办",
  due_changed: "截止日期变更",
};

function makeId(): string {
  return globalThis.crypto.randomUUID();
}

function formatTime(at: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
}

function formatDateTime(at: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
}

function formatDay(day: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" })
    .format(new Date(`${day}T12:00:00`));
}

function dueLabel(task: WorkTask, today = dayKey(new Date())): string {
  const date = task.dueDate!;
  const label = `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日截止`;
  if (task.status !== "active") return label;
  if (date < today) return `${label} · 已逾期`;
  if (date === today) return `${label} · 今天`;
  return label;
}

function iconButton(container: HTMLElement, icon: string, label: string, cls = "wt-icon-button"): HTMLButtonElement {
  const button = container.createEl("button", {
    cls: `clickable-icon ${cls}`,
    attr: { type: "button", "aria-label": label, "data-tooltip-position": "top" },
  });
  setIcon(button, icon);
  button.querySelector("svg")?.setAttribute("aria-hidden", "true");
  return button;
}

interface NewTaskValues extends CreateTaskInput {
  initialProgress: string;
  dueDate: string | null;
  todos: string[];
}

class NewTaskModal extends Modal {
  private quadrant: QuadrantId | null = null;

  constructor(
    app: App,
    private readonly groups: WorkGroup[],
    private readonly submitTask: (values: NewTaskValues) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("新建任务");
    this.modalEl.addClass("wt-modal");
    this.modalEl.addClass("wt-new-task-modal");
    const form = this.contentEl.createEl("form", { cls: "wt-modal-form" });
    const titleLabel = form.createEl("label", { cls: "wt-field wt-title-field" });
    titleLabel.createSpan({ text: "任务名称", cls: "wt-field-label" });
    const title = titleLabel.createEl("input", {
      type: "text",
      cls: "wt-modal-title",
      attr: { placeholder: "例如：验证自动备份", maxlength: "160", required: "" },
    });
    const groupLabel = form.createEl("label", { cls: "wt-field" });
    groupLabel.createSpan({ text: "任务分组", cls: "wt-field-label" });
    const group = groupLabel.createEl("select", { attr: { "aria-label": "任务分组" } });
    group.createEl("option", { text: UNGROUPED_TASKS, value: "" });
    for (const item of this.groups) group.createEl("option", { text: item.name, value: item.id });

    const quadrantField = form.createEl("fieldset", { cls: "wt-quadrant-picker", attr: { tabindex: "-1" } });
    const legend = quadrantField.createEl("legend");
    legend.createSpan({ text: "任务象限", cls: "wt-field-label" });
    legend.createSpan({ text: "必选", cls: "wt-required" });
    for (const item of QUADRANTS) {
      const label = quadrantField.createEl("label", { cls: `wt-quadrant-option is-${item.id}` });
      const input = label.createEl("input", { type: "radio", attr: { name: "quadrant", value: item.id } });
      label.createSpan({ cls: "wt-quadrant-marker", attr: { "aria-hidden": "true" } });
      label.createSpan({ text: item.name, cls: "wt-quadrant-name" });
      input.addEventListener("change", () => {
        this.quadrant = item.id;
        quadrantField.removeClass("has-error");
        error.setText("");
      });
    }

    const optional = form.createDiv({ cls: "wt-new-optional" });
    const todoButton = optional.createEl("button", { text: "添加待办", cls: "wt-secondary-action", attr: { type: "button" } });
    const todoList = form.createDiv({ cls: "wt-new-todos" });
    todoButton.addEventListener("click", () => {
      const row = todoList.createDiv({ cls: "wt-new-todo-row" });
      const field = row.createEl("input", { type: "text", attr: { "aria-label": "待办内容", placeholder: "待办内容", maxlength: "160" } });
      iconButton(row, "x", "移除待办").addEventListener("click", () => row.remove());
      field.focus();
    });
    const dateButton = optional.createEl("button", { text: "设置截止日期", cls: "wt-secondary-action", attr: { type: "button" } });
    const dueField = form.createEl("label", { cls: "wt-field wt-new-due" });
    dueField.hidden = true;
    dueField.createSpan({ text: "截止日期", cls: "wt-field-label" });
    const due = dueField.createEl("input", { type: "date" });
    dateButton.addEventListener("click", () => { dueField.hidden = false; due.focus(); });
    const progressLabel = form.createEl("label", { cls: "wt-field" });
    const progressHeading = progressLabel.createSpan({ cls: "wt-field-heading" });
    progressHeading.createSpan({ text: "初始进展", cls: "wt-field-label" });
    progressHeading.createSpan({ text: "可选", cls: "wt-optional" });
    const progress = progressLabel.createEl("textarea", {
      attr: { rows: "3", maxlength: "2000", placeholder: "例如：已完成需求梳理，准备开始实现" },
    });
    const error = form.createEl("p", { cls: "wt-form-error", attr: { role: "alert" } });
    const actions = form.createDiv({ cls: "wt-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消", cls: "wt-secondary-action", attr: { type: "button" } });
    const submit = actions.createEl("button", { cls: "wt-primary-action", attr: { type: "submit" } });
    setIcon(submit, "plus");
    const submitLabel = submit.createSpan({ text: "创建任务" });
    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!this.quadrant) {
        error.setText("请选择任务象限");
        quadrantField.addClass("has-error");
        quadrantField.focus();
        return;
      }
      const quadrant = QUADRANTS.find(({ id }) => id === this.quadrant)!;
      const selectedGroup = this.groups.find(({ id }) => id === group.value);
      submit.disabled = true;
      submit.setAttr("aria-busy", "true");
      submitLabel.setText("创建中…");
      try {
        await this.submitTask({
          title: title.value,
          groupId: selectedGroup?.id ?? null,
          groupName: selectedGroup?.name ?? UNGROUPED_TASKS,
          important: quadrant.important,
          urgent: quadrant.urgent,
          initialProgress: progress.value,
          dueDate: due.value || null,
          todos: [...todoList.querySelectorAll<HTMLInputElement>("input")].map((field) => field.value.trim()).filter(Boolean),
        });
        this.close();
      } catch (reason) {
        submit.disabled = false;
        submit.setAttr("aria-busy", "false");
        submitLabel.setText("创建任务");
        error.setText(reason instanceof Error ? reason.message : "无法创建任务");
      }
    });
    requestAnimationFrame(() => title.focus());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class TextPromptModal extends Modal {
  constructor(
    app: App,
    private readonly heading: string,
    private readonly initialValue: string,
    private readonly placeholder: string,
    private readonly multiline: boolean,
    private readonly submitValue: (value: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.heading);
    this.modalEl.addClass("wt-modal");
    this.modalEl.addClass("wt-prompt-modal");
    const form = this.contentEl.createEl("form", { cls: "wt-modal-form" });
    const field = form.createEl("label", { cls: "wt-field" });
    const fieldName = this.heading === "异常关闭" ? "关闭原因"
      : this.heading === "删除分组" ? "确认分组名称"
      : this.heading.includes("分组") ? "分组名称" : this.heading.includes("待办") ? "待办内容" : "任务名称";
    field.createSpan({ text: fieldName, cls: "wt-field-label" });
    const input = this.multiline
      ? field.createEl("textarea", { attr: { rows: "4", maxlength: "2000", placeholder: this.placeholder, required: "" } })
      : field.createEl("input", { type: "text", attr: { maxlength: "160", placeholder: this.placeholder, required: "" } });
    input.value = this.initialValue;
    const error = form.createEl("p", { cls: "wt-form-error", attr: { role: "alert" } });
    const actions = form.createDiv({ cls: "wt-modal-actions" });
    actions.createEl("button", { text: "取消", cls: "wt-secondary-action", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    const submit = actions.createEl("button", { text: "确认", cls: "wt-primary-action", attr: { type: "submit" } });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      submit.setAttr("aria-busy", "true");
      submit.setText("保存中…");
      try {
        await this.submitValue(input.value);
        this.close();
      } catch (reason) {
        submit.disabled = false;
        submit.setAttr("aria-busy", "false");
        submit.setText("确认");
        error.setText(reason instanceof Error ? reason.message : "操作失败");
      }
    });
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class DueDateModal extends Modal {
  constructor(app: App, private readonly current: string | undefined, private readonly save: (day: string | null) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("截止日期");
    this.modalEl.addClass("wt-modal");
    const form = this.contentEl.createEl("form", { cls: "wt-modal-form" });
    const field = form.createEl("label", { cls: "wt-field" });
    field.createSpan({ text: "截止日期", cls: "wt-field-label" });
    const input = field.createEl("input", { type: "date", attr: { required: "" } });
    input.value = this.current ?? "";
    const shortcuts = form.createDiv({ cls: "wt-date-shortcuts" });
    for (const [label, offset] of [["今天", 0], ["明天", 1]] as const) {
      shortcuts.createEl("button", { text: label, attr: { type: "button" } }).addEventListener("click", () => {
        const date = new Date();
        date.setDate(date.getDate() + offset);
        input.value = dayKey(date);
      });
    }
    const error = form.createEl("p", { cls: "wt-form-error", attr: { role: "alert" } });
    const actions = form.createDiv({ cls: "wt-modal-actions" });
    const run = async (day: string | null, button: HTMLButtonElement) => {
      button.disabled = true;
      try { await this.save(day); this.close(); }
      catch (reason) { error.setText(reason instanceof Error ? reason.message : "未能保存，请重试"); button.disabled = false; }
    };
    if (this.current) actions.createEl("button", { text: "清除日期", cls: "wt-secondary-action", attr: { type: "button" } })
      .addEventListener("click", (event) => void run(null, event.currentTarget as HTMLButtonElement));
    actions.createEl("button", { text: "取消", cls: "wt-secondary-action", attr: { type: "button" } }).addEventListener("click", () => this.close());
    const submit = actions.createEl("button", { text: "保存日期", cls: "wt-primary-action", attr: { type: "submit" } });
    form.addEventListener("submit", (event) => { event.preventDefault(); void run(input.value, submit); });
    requestAnimationFrame(() => input.focus());
  }

  onClose(): void { this.contentEl.empty(); }
}

class CompleteTaskModal extends Modal {
  constructor(app: App, private readonly remaining: number, private readonly finish: () => Promise<void>) { super(app); }

  onOpen(): void {
    this.setTitle("完成任务");
    this.modalEl.addClass("wt-modal");
    this.contentEl.createEl("p", { text: `还有 ${this.remaining} 条待办未完成。仍然完成任务？`, cls: "wt-confirm-copy" });
    const error = this.contentEl.createEl("p", { cls: "wt-form-error", attr: { role: "alert" } });
    const actions = this.contentEl.createDiv({ cls: "wt-modal-actions" });
    actions.createEl("button", { text: "返回处理", cls: "wt-secondary-action", attr: { type: "button" } }).addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { text: "仍然完成", cls: "wt-primary-action", attr: { type: "button" } });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try { await this.finish(); this.close(); }
      catch (reason) { error.setText(reason instanceof Error ? reason.message : "未能保存，请重试"); confirm.disabled = false; }
    });
    requestAnimationFrame(() => confirm.focus());
  }

  onClose(): void { this.contentEl.empty(); }
}

class GroupManagerModal extends Modal {
  constructor(app: App, private readonly plugin: WorkTimelinePlugin) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("管理分组");
    this.modalEl.addClass("wt-modal");
    this.modalEl.addClass("wt-group-manager-modal");
    this.renderGroups();
  }

  private renderGroups(): void {
    this.contentEl.empty();
    const add = this.contentEl.createEl("form", { cls: "wt-group-add" });
    add.createSpan({ text: "新建分组", cls: "wt-group-add-label wt-field-label" });
    const input = add.createEl("input", { type: "text", attr: { placeholder: "分组名称", maxlength: "60", required: "", "aria-label": "分组名称" } });
    const submit = add.createEl("button", { text: "新建", cls: "wt-primary-action", attr: { type: "submit" } });
    const error = add.createEl("p", { cls: "wt-form-error wt-group-error", attr: { role: "alert" } });
    add.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      submit.setText("创建中…");
      try {
        await this.plugin.addGroup(input.value);
        this.renderGroups();
      } catch (reason) {
        submit.disabled = false;
        submit.setText("新建");
        error.setText(reason instanceof Error ? reason.message : "无法新建分组");
      }
    });

    const list = this.contentEl.createDiv({ cls: "wt-group-manager-list" });
    if (!this.plugin.groups.length) list.createEl("p", { text: "还没有分组", cls: "wt-group-empty" });
    this.plugin.groups.forEach((group, index) => {
      const row = list.createDiv({ cls: "wt-group-manager-row" });
      const copy = row.createDiv({ cls: "wt-group-copy" });
      copy.createSpan({ text: group.name, cls: "wt-group-name" });
      copy.createSpan({
        text: `${this.plugin.tasks.filter(({ groupId }) => groupId === group.id).length} 项任务`,
        cls: "wt-group-count",
      });
      const actions = row.createDiv({ cls: "wt-row-actions" });
      const up = iconButton(actions, "arrow-up", "上移分组");
      const down = iconButton(actions, "arrow-down", "下移分组");
      const rename = iconButton(actions, "pencil", "分组改名");
      const remove = iconButton(actions, "trash-2", "删除分组");
      remove.addClass("is-danger");
      up.disabled = index === 0;
      down.disabled = index === this.plugin.groups.length - 1;
      up.addEventListener("click", async () => { await this.plugin.reorderGroup(group.id, -1); this.renderGroups(); });
      down.addEventListener("click", async () => { await this.plugin.reorderGroup(group.id, 1); this.renderGroups(); });
      rename.addEventListener("click", () => new TextPromptModal(
        this.app, "分组改名", group.name, "分组名称", false,
        async (value) => { await this.plugin.renameGroup(group.id, value); this.renderGroups(); },
      ).open());
      remove.addEventListener("click", () => new TextPromptModal(
        this.app, "删除分组", "", `输入“${group.name}”确认，任务将归入未分组`, false,
        async (value) => {
          if (value.trim() !== group.name) throw new Error("确认名称不匹配");
          await this.plugin.deleteGroup(group.id);
          this.renderGroups();
        },
      ).open());
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class WorkTimelineView extends ItemView {
  private selectedDay = dayKey(new Date());
  private currentDay = this.selectedDay;
  private selectedTaskId: string | null = null;
  private expandedTaskId: string | null = null;
  private searchQuery = "";
  private addingTodoTaskId: string | null = null;
  private cardObserver: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: WorkTimelinePlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return this.plugin.manifest.name; }
  getIcon(): string { return "history"; }
  async onOpen(): Promise<void> {
    this.render();
    this.registerInterval(window.setInterval(() => {
      const today = dayKey(new Date());
      if (today === this.currentDay) return;
      if (this.selectedDay === this.currentDay) this.selectedDay = today;
      this.currentDay = today;
      this.render();
    }, 60_000));
  }
  async onClose(): Promise<void> { this.cardObserver?.disconnect(); }

  taskRecorded(taskId: string): void {
    if (this.expandedTaskId === taskId) this.expandedTaskId = null;
    this.render();
  }

  openNewTask(): void {
    new NewTaskModal(this.app, this.plugin.groups, async (values) => {
      const id = await this.plugin.addTask(values);
      this.selectedTaskId = id;
      this.expandedTaskId = id;
      this.render();
    }).open();
  }

  render(): void {
    const root = this.contentEl;
    const taskScrollTop = root.querySelector(".wt-task-column")?.scrollTop ?? 0;
    const layoutScrollTop = root.querySelector(".wt-layout")?.scrollTop ?? 0;
    this.cardObserver?.disconnect();
    root.empty();
    root.addClass("work-timeline-view");
    const shell = root.createDiv({ cls: "wt-shell" });
    this.renderHeader(shell);
    const layout = shell.createDiv({ cls: "wt-layout" });
    const tasks = layout.createEl("main", { cls: "wt-task-column" });
    this.renderTasks(tasks);
    this.cardObserver = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        const body = target as HTMLElement;
        const card = body.parentElement;
        const grid = card?.parentElement;
        if (!card || !grid) continue;
        const style = getComputedStyle(grid);
        const row = parseFloat(style.gridAutoRows);
        const gap = parseFloat(style.rowGap);
        if (row > 0) card.style.gridRowEnd = `span ${Math.max(1, Math.ceil((body.scrollHeight + 2 + gap) / (row + gap)))}`;
      }
    });
    tasks.querySelectorAll<HTMLElement>(".wt-card-body").forEach((body) => this.cardObserver?.observe(body));
    this.renderTimeline(layout.createEl("aside", { cls: "wt-timeline-column" }));
    tasks.scrollTop = taskScrollTop;
    layout.scrollTop = layoutScrollTop;
  }

  private renderHeader(shell: HTMLElement): void {
    const header = shell.createEl("header", { cls: "wt-header" });
    const brand = header.createDiv({ cls: "wt-brand" });
    brand.createSpan({ cls: "wt-brand-mark", attr: { "aria-hidden": "true" } });
    const identity = brand.createDiv();
    identity.createEl("h1", { text: this.plugin.manifest.name });
    const active = this.plugin.tasks.filter(({ status }) => status === "active").length;
    identity.createEl("p", { text: `${active} 项进行中 · 今天 ${eventsForDay(this.plugin.tasks, dayKey(new Date())).length} 条记录` });

    const viewSwitch = header.createDiv({ cls: "wt-view-switch", attr: { role: "group", "aria-label": "任务视图" } });
    for (const [mode, label] of [["group", "分组"], ["quadrant", "四象限"]] as const) {
      const button = viewSwitch.createEl("button", {
        text: label,
        cls: this.plugin.state.viewMode === mode ? "is-active" : "",
        attr: { type: "button", "aria-pressed": String(this.plugin.state.viewMode === mode) },
      });
      button.addEventListener("click", () => void this.plugin.setViewMode(mode));
    }

    const actions = header.createDiv({ cls: "wt-header-actions" });
    iconButton(actions, "folders", "管理分组").addEventListener("click", () => new GroupManagerModal(this.app, this.plugin).open());
    const create = actions.createEl("button", { cls: "wt-new-task-button", attr: { type: "button" } });
    setIcon(create, "plus");
    create.createSpan({ text: "新建任务" });
    create.addEventListener("click", () => this.openNewTask());
  }

  private renderTasks(container: HTMLElement): void {
    const heading = container.createDiv({ cls: "wt-task-toolbar" });
    heading.createEl("h2", { text: "当前任务" });
    const search = heading.createEl("label", { cls: "wt-search" });
    setIcon(search.createSpan(), "search");
    const input = search.createEl("input", {
      type: "search",
      attr: { placeholder: "搜索任务和进展", "aria-label": "搜索任务和进展" },
    });
    input.value = this.searchQuery;
    input.addEventListener("input", () => {
      this.searchQuery = input.value;
      const cursor = input.selectionStart ?? input.value.length;
      this.render();
      requestAnimationFrame(() => {
        const next = this.contentEl.querySelector<HTMLInputElement>(".wt-search input");
        next?.focus();
        next?.setSelectionRange(cursor, cursor);
      });
    });

    const matches = searchTasks(this.plugin.tasks, this.searchQuery);
    const sections = this.plugin.state.viewMode === "group"
      ? groupTasks(matches, this.plugin.groups, this.plugin.state.orders.group)
      : quadrantTasks(matches, this.plugin.state.orders.quadrant);
    const board = container.createDiv({ cls: `wt-board is-${this.plugin.state.viewMode}` });
    for (const section of sections) this.renderSection(board, section);

    const ended = matches.filter(isTaskEnded).sort((left, right) =>
      (right.events.at(-1)?.at ?? "").localeCompare(left.events.at(-1)?.at ?? ""),
    );
    const endedSection = container.createEl("details", { cls: "wt-ended-section" });
    const summary = endedSection.createEl("summary");
    summary.createSpan({ text: "已结束" });
    summary.createSpan({ text: `已完成 ${ended.filter(({ status }) => status === "completed").length} · 异常关闭 ${ended.filter(({ status }) => status === "closed").length}` });
    const endedGrid = endedSection.createDiv({ cls: "wt-card-grid" });
    if (!ended.length) endedGrid.createEl("p", { text: "暂无已结束任务", cls: "wt-empty" });
    for (const task of ended) this.renderCard(endedGrid, task, "ended");
  }

  private renderSection(container: HTMLElement, section: TaskGroup): void {
    const area = section.id ?? "ungrouped";
    const wrapper = container.createEl("section", {
      cls: "wt-task-section",
      attr: { "data-area": area, "aria-label": section.name },
    });
    const heading = wrapper.createDiv({ cls: "wt-section-heading" });
    heading.createEl("h3", { text: section.name });
    heading.createSpan({ text: String(section.tasks.length) });
    const grid = wrapper.createDiv({ cls: "wt-card-grid" });
    grid.addEventListener("dragover", (event) => { event.preventDefault(); grid.addClass("is-drag-over"); });
    grid.addEventListener("dragleave", () => grid.removeClass("is-drag-over"));
    grid.addEventListener("drop", (event) => {
      event.preventDefault();
      grid.removeClass("is-drag-over");
      const taskId = event.dataTransfer?.getData("text/plain");
      if (taskId) void this.plugin.dropTask(taskId, this.plugin.state.viewMode, area, null);
    });
    if (!section.tasks.length) grid.createEl("p", { text: "拖动任务到这里", cls: "wt-empty" });
    for (const task of section.tasks) this.renderCard(grid, task, area);
  }

  private renderCard(container: HTMLElement, task: WorkTask, area: string): void {
    const selected = this.selectedTaskId === task.id;
    const expanded = this.expandedTaskId === task.id;
    const card = container.createEl("article", {
      cls: `wt-card${selected ? " is-selected" : ""}${isTaskEnded(task) ? " is-ended" : ""}${expanded ? " is-expanded" : ""}`,
      attr: { "data-task-id": task.id, draggable: String(task.status === "active") },
    });
    const body = card.createDiv({ cls: "wt-card-body" });
    const open = body.createEl("button", {
      cls: "wt-card-open",
      attr: { type: "button", "aria-expanded": String(expanded), "aria-label": `${task.status === "active" ? "查看并记录" : "查看任务"}：${task.title}` },
    });
    const top = open.createSpan({ cls: "wt-card-top" });
    top.createSpan({ text: task.title, cls: "wt-card-title" });
    if (task.status !== "active") top.createSpan({ text: task.status === "completed" ? "已完成" : "异常关闭", cls: `wt-status is-${task.status}` });
    const latest = [...task.events].reverse().find(({ kind }) => kind === "progress") ?? task.events[0]!;
    open.createSpan({ text: latest.text, cls: "wt-card-latest" });
    if (task.todos?.length || task.dueDate) {
      const summary = body.createDiv({ cls: "wt-card-summary" });
      if (task.todos?.length) {
        const count = task.todos.filter(({ done }) => done).length;
        const todo = summary.createEl("button", { cls: "wt-summary-chip", attr: { type: "button", "aria-label": `查看待办，已完成 ${count}/${task.todos.length}` } });
        setIcon(todo, "list-checks");
        todo.createSpan({ text: `待办 ${count}/${task.todos.length}` });
        todo.addEventListener("click", () => {
          this.selectedTaskId = task.id;
          this.expandedTaskId = task.id;
          this.render();
          requestAnimationFrame(() => this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${task.id}"] ${task.status === "active" ? ".wt-todo-check" : ".wt-card-open"}`)?.focus());
        });
      }
      if (task.dueDate) {
        const due = summary.createEl("button", { cls: `wt-summary-chip wt-due-chip${task.status === "active" && task.dueDate < dayKey(new Date()) ? " is-overdue" : ""}`, attr: { type: "button", "aria-label": `修改截止日期：${dueLabel(task)}` } });
        setIcon(due, "calendar-days");
        due.createSpan({ text: dueLabel(task) });
        due.addEventListener("click", () => this.openDueDate(task));
      }
    }
    const meta = body.createDiv({ cls: "wt-card-meta" });
    meta.createSpan({ text: task.groupName });
    if (task.urgent) meta.createSpan({ text: "紧急", cls: "wt-tag is-urgent" });
    if (task.important) meta.createSpan({ text: "重要", cls: "wt-tag is-important" });
    meta.createSpan({ text: formatDateTime(task.events.at(-1)!.at), cls: "wt-card-time" });
    open.addEventListener("click", () => {
      this.selectedTaskId = task.id;
      this.expandedTaskId = expanded ? null : task.id;
      if (expanded) this.addingTodoTaskId = null;
      this.render();
      requestAnimationFrame(() => this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${task.id}"] ${!expanded && task.status === "active" ? ".wt-card-composer textarea" : ".wt-card-open"}`)?.focus());
    });
    iconButton(card, "more-horizontal", `任务操作：${task.title}`, "wt-card-menu")
      .addEventListener("click", (event) => this.showTaskMenu(event, task));

    if (task.status === "active") {
      card.addEventListener("dragstart", (event) => {
        if ((event.target as HTMLElement).closest("input, textarea, button, label")) { event.preventDefault(); return; }
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
        if (moving && moving !== task.id) void this.plugin.dropTask(moving, this.plugin.state.viewMode, area, task.id);
      });
    }
    if (expanded) {
      this.renderTodoDetails(body, task);
      if (task.status === "active") this.renderComposer(body, task);
    }
  }

  private openDueDate(task: WorkTask): void {
    new DueDateModal(this.app, task.dueDate, (date) => this.plugin.setTaskDueDate(task.id, date)).open();
  }

  private renderTodoDetails(card: HTMLElement, task: WorkTask): void {
    if (task.todos?.length) {
      const section = card.createEl("section", { cls: "wt-card-todos", attr: { "aria-label": "待办" } });
      section.createEl("h4", { text: "待办" });
      for (const item of task.todos) {
        const row = section.createDiv({ cls: "wt-todo-row" });
        const label = row.createEl("label", { cls: "wt-todo-label" });
        const check = label.createEl("input", { type: "checkbox", cls: "wt-todo-check", attr: { "aria-label": item.text } });
        check.checked = item.done;
        check.disabled = task.status !== "active";
        label.createSpan({ text: item.text, cls: item.done ? "is-done" : "" });
        check.addEventListener("change", async () => {
          check.disabled = true;
          try {
            await this.plugin.toggleTaskTodo(task.id, item.id, check.checked);
            requestAnimationFrame(() => this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${task.id}"] .wt-todo-check[aria-label="${CSS.escape(item.text)}"]`)?.focus());
          } catch (reason) {
            check.checked = item.done;
            check.disabled = false;
            new Notice(reason instanceof Error ? reason.message : "未能保存，请重试");
          }
        });
        if (task.status === "active") {
          iconButton(row, "pencil", `编辑待办：${item.text}`).addEventListener("click", () => new TextPromptModal(
            this.app, "编辑待办", item.text, "待办内容", false, (value) => this.plugin.editTaskTodo(task.id, item.id, value),
          ).open());
          iconButton(row, "trash-2", `删除待办：${item.text}`).addEventListener("click", async () => {
            try {
              const removed = await this.plugin.removeTaskTodo(task.id, item.id);
              const notice = new Notice("待办已删除", 8000);
              const undo = notice.messageEl.createEl("button", { text: "撤销", cls: "wt-undo-button", attr: { type: "button" } });
              undo.addEventListener("click", async () => {
                undo.disabled = true;
                try { await this.plugin.restoreTaskTodo(task.id, removed.todo, removed.index); notice.hide(); }
                catch (reason) { undo.disabled = false; new Notice(reason instanceof Error ? reason.message : "未能恢复，请重试"); }
              });
            } catch (reason) { new Notice(reason instanceof Error ? reason.message : "未能保存，请重试"); }
          });
        }
      }
    }
    if (task.status !== "active") return;
    const actions = card.createDiv({ cls: "wt-optional-actions" });
    const add = actions.createEl("button", { text: "添加待办", attr: { type: "button" } });
    setIcon(add, "plus");
    add.addEventListener("click", () => { this.addingTodoTaskId = task.id; this.render(); this.contentEl.querySelector<HTMLInputElement>(`.wt-card[data-task-id="${task.id}"] .wt-add-todo input`)?.focus(); });
    if (!task.dueDate) {
      const due = actions.createEl("button", { text: "设置截止日期", attr: { type: "button" } });
      setIcon(due, "calendar-days");
      due.addEventListener("click", () => this.openDueDate(task));
    }
    if (this.addingTodoTaskId === task.id) {
      const form = card.createEl("form", { cls: "wt-add-todo" });
      const input = form.createEl("input", { type: "text", attr: { "aria-label": "新增待办", placeholder: "输入待办并按回车", maxlength: "160", required: "" } });
      const submit = form.createEl("button", { text: "添加", attr: { type: "submit" } });
      iconButton(form, "x", "取消添加待办").addEventListener("click", () => { this.addingTodoTaskId = null; this.render(); });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
          await this.plugin.addTaskTodo(task.id, input.value);
          this.contentEl.querySelector<HTMLInputElement>(`.wt-card[data-task-id="${task.id}"] .wt-add-todo input`)?.focus();
        } catch (reason) { submit.disabled = false; new Notice(reason instanceof Error ? reason.message : "未能保存，请重试"); }
      });
    }
  }

  private renderComposer(card: HTMLElement, task: WorkTask): void {
    const form = card.createEl("form", { cls: "wt-card-composer" });
    const label = form.createEl("label");
    label.createSpan({ text: "记录当前进展" });
    const input = label.createEl("textarea", {
      attr: { rows: "3", maxlength: "2000", placeholder: "例如：已确认缓存键未按租户隔离……", required: "" },
    });
    input.value = this.plugin.state.drafts[task.id] ?? "";
    input.addEventListener("input", () => this.plugin.updateDraft(task.id, input.value));
    const footer = form.createDiv({ cls: "wt-composer-footer" });
    footer.createSpan({ text: "草稿已自动保存", cls: "wt-draft-state" });
    const submit = footer.createEl("button", { text: "记录进展", cls: "mod-cta", attr: { type: "submit" } });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = input.disabled = true;
      try {
        await this.plugin.recordProgress(task.id, input.value);
        this.expandedTaskId = null;
        this.render();
      } catch (reason) {
        submit.disabled = input.disabled = false;
        new Notice(reason instanceof Error ? reason.message : "无法记录进展");
      }
    });
  }

  private showTaskMenu(event: MouseEvent, task: WorkTask): void {
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("改名").setIcon("pencil").onClick(() => new TextPromptModal(
      this.app, "任务改名", task.title, "任务名称", false, (value) => this.plugin.renameTask(task.id, value),
    ).open()));
    for (const group of [...this.plugin.groups, { id: "", name: UNGROUPED_TASKS }]) {
      menu.addItem((item) => item.setTitle(`分组 · ${group.name}`).setIcon("folder")
        .setChecked((task.groupId ?? "") === group.id)
        .onClick(() => void this.plugin.changeGroup(task.id, group.id || null)));
    }
    menu.addSeparator();
    for (const quadrant of QUADRANTS) {
      menu.addItem((item) => item.setTitle(`象限 · ${quadrant.name}`).setIcon("layout-grid")
        .setChecked(quadrantId(task) === quadrant.id)
        .onClick(() => void this.plugin.changeQuadrant(task.id, quadrant.id)));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(task.dueDate ? "修改截止日期" : "设置截止日期").setIcon("calendar-days")
      .onClick(() => this.openDueDate(task)));
    menu.addSeparator();
    if (task.status === "active") {
      menu.addItem((item) => item.setTitle("完成").setIcon("check").onClick(() => {
        const remaining = task.todos?.filter(({ done }) => !done).length ?? 0;
        if (remaining) new CompleteTaskModal(this.app, remaining, () => this.plugin.finishTask(task.id)).open();
        else void this.plugin.finishTask(task.id).catch((reason) => new Notice(reason instanceof Error ? reason.message : "未能保存，请重试"));
      }));
      menu.addItem((item) => item.setTitle("异常关闭").setIcon("circle-slash-2").onClick(() => new TextPromptModal(
        this.app, "异常关闭", "", "填写关闭原因", true, (value) => this.plugin.closeTask(task.id, value),
      ).open()));
    } else {
      menu.addItem((item) => item.setTitle("重新打开").setIcon("rotate-ccw").onClick(() => void this.plugin.reopenTask(task.id)));
    }
    menu.showAtMouseEvent(event);
  }

  private renderTimeline(container: HTMLElement): void {
    const task = this.selectedTaskId ? this.plugin.tasks.find(({ id }) => id === this.selectedTaskId) : undefined;
    const header = container.createDiv({ cls: "wt-timeline-header" });
    if (task) {
      const title = header.createDiv();
      title.createSpan({ text: "进展时间线", cls: "wt-eyebrow" });
      title.createEl("h2", { text: task.title });
      title.createEl("p", { text: `${task.groupName} · ${quadrantName(task)}` });
      if (task.dueDate) {
        const due = title.createDiv({ cls: "wt-task-due" });
        due.createSpan({ text: dueLabel(task) });
        due.createEl("button", { text: "查看截止日", attr: { type: "button" } }).addEventListener("click", () => {
          this.selectedDay = task.dueDate!;
          this.selectedTaskId = null;
          this.render();
        });
      }
      const back = header.createEl("button", { text: "返回每日时间线", cls: "wt-back-button", attr: { type: "button" } });
      back.addEventListener("click", () => { this.selectedTaskId = null; this.render(); });
      const body = container.createDiv({ cls: "wt-timeline-scroll" });
      for (const section of eventsByDay(task.events)) {
        const day = body.createEl("section", { cls: "wt-timeline-day" });
        day.createEl("h3", { text: formatDay(section.day) });
        this.renderEvents(day, section.events, false);
      }
      this.scrollTimeline(body);
      return;
    }

    const title = header.createDiv();
    title.createSpan({ text: "每日时间线", cls: "wt-eyebrow" });
    title.createEl("h2", { text: formatDay(this.selectedDay) });
    const controls = header.createDiv({ cls: "wt-date-controls" });
    const date = controls.createEl("input", { type: "date", attr: { "aria-label": "选择时间线日期" } });
    date.value = this.selectedDay;
    date.addEventListener("change", () => { if (date.value) { this.selectedDay = date.value; this.render(); } });
    if (this.selectedDay !== dayKey(new Date())) {
      controls.createEl("button", { text: "今天", attr: { type: "button" } }).addEventListener("click", () => {
        this.selectedDay = dayKey(new Date());
        this.render();
      });
    }
    const dueTasks = dueTasksForDay(this.plugin.tasks, this.selectedDay);
    if (dueTasks.length) {
      const due = container.createEl("section", { cls: "wt-timeline-due", attr: { "aria-label": "当日截止" } });
      due.createEl("h3", { text: `当日截止 · ${dueTasks.length}` });
      for (const item of dueTasks) {
        const row = due.createEl("button", { cls: "wt-due-row", attr: { type: "button" } });
        row.createSpan({ text: item.title });
        row.createSpan({ text: item.status === "completed" ? "已完成" : item.status === "closed" ? "已关闭" : this.selectedDay < dayKey(new Date()) ? "已逾期" : "进行中" });
        row.addEventListener("click", () => { this.selectedTaskId = item.id; this.render(); });
      }
    }
    const body = container.createDiv({ cls: "wt-timeline-scroll" });
    const entries = eventsForDay(this.plugin.tasks, this.selectedDay);
    if (!entries.length) body.createEl("p", { text: "这一天还没有记录", cls: "wt-empty" });
    const list = body.createEl("ol", { cls: "wt-event-list" });
    for (const entry of entries) this.renderEvent(list, entry.event, true, entry.taskId);
    this.scrollTimeline(body);
  }

  private renderEvents(container: HTMLElement, events: TaskEvent[], showTask: boolean): void {
    const list = container.createEl("ol", { cls: "wt-event-list" });
    for (const event of events) this.renderEvent(list, event, showTask);
  }

  private renderEvent(list: HTMLElement, event: TaskEvent, showTask: boolean, taskId?: string): void {
    const muted = ["renamed", "group_changed", "quadrant_changed", "todo_added", "todo_edited", "todo_removed", "todo_restored", "due_changed"].includes(event.kind);
    const item = list.createEl("li", { cls: `is-${event.kind}${muted ? " is-muted" : ""}` });
    item.createEl("time", { text: formatTime(event.at), attr: { datetime: event.at } });
    const body = item.createDiv({ cls: "wt-event-body" });
    body.createSpan({ text: EVENT_LABELS[event.kind], cls: "wt-event-kind" });
    if (showTask && taskId) {
      const link = body.createEl("button", { text: event.title, cls: "wt-event-task", attr: { type: "button" } });
      link.addEventListener("click", () => { this.selectedTaskId = taskId; this.render(); });
    }
    body.createEl("p", { text: event.text, cls: "wt-event-text" });
  }

  private scrollTimeline(body: HTMLElement): void {
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  }
}

class WorkTimelineSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly timeline: WorkTimelinePlugin) {
    super(app, timeline);
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: this.timeline.manifest.name });
    let nextDirectory = this.timeline.state.taskDirectory;
    new Setting(this.containerEl)
      .setName("任务目录")
      .setDesc("任务 Markdown、分组记录和 agent.md 的保存位置")
      .addText((text) => text.setValue(nextDirectory).onChange((value) => { nextDirectory = value; }))
      .addButton((button) => button.setButtonText("迁移").onClick(async () => {
        try {
          await this.timeline.changeTaskDirectory(nextDirectory);
          new Notice("任务目录已迁移");
          this.display();
        } catch (reason) {
          new Notice(reason instanceof Error ? reason.message : "无法迁移任务目录");
        }
      }));
    new Setting(this.containerEl)
      .setName("备份策略")
      .setDesc("每次正式写入同步生成当日备份，自动保留最近 7 天；升级前备份不会自动清理。");
  }
}

export default class WorkTimelinePlugin extends Plugin {
  tasks: WorkTask[] = [];
  groupArchive: GroupArchive = { version: 1, groups: [], events: [] };
  state: PluginState = normalizePluginState(null);
  private store!: ArchiveStore;
  private readonly lockedTasks = new Set<string>();
  private readonly internalWrites = new Set<string>();
  private draftTimer: number | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  get groups(): WorkGroup[] { return this.groupArchive.groups; }

  async onload(): Promise<void> {
    const raw = await this.loadData();
    this.state = normalizePluginState(raw);
    const previouslyInitialized = this.state.initialized;
    this.store = this.createStore(this.state.taskDirectory);
    if (!this.state.initialized) {
      if (raw !== null && raw !== undefined) await this.store.backupLegacy(raw);
      await this.store.initialize();
      this.state.initialized = true;
      await this.saveData(this.state);
    }
    await this.loadArchive();
    if (previouslyInitialized && this.state.pluginVersion !== this.manifest.version) {
      await this.store.backupUpgrade(this.tasks, this.groupArchive, this.state, this.manifest.version);
    }
    const today = dayKey(new Date());
    if (this.state.lastDailyBackup !== today) {
      for (const task of this.tasks) await this.store.saveTask(task);
      await this.store.saveGroups(this.groupArchive);
      this.state.lastDailyBackup = today;
    }
    this.state.pluginVersion = this.manifest.version;
    await this.saveData(this.state);
    this.registerView(VIEW_TYPE, (leaf) => new WorkTimelineView(leaf, this));
    this.addRibbonIcon("history", "打开 Tracelo", () => void this.activateView());
    this.addCommand({ id: "open-work-timeline", name: "打开 Tracelo", callback: () => void this.activateView() });
    this.addCommand({ id: "create-work-task", name: "新建工作任务", callback: async () => {
      await this.activateView();
      this.currentView()?.openNewTask();
    } });
    this.addSettingTab(new WorkTimelineSettingTab(this.app, this));
    this.watchArchive();
  }

  async onunload(): Promise<void> {
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    await this.saveData(this.state);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  private createStore(directory: string): ArchiveStore {
    const backup = `${this.app.vault.configDir}/plugins/${this.manifest.id}/backups`;
    return new ArchiveStore(this.app.vault.adapter, directory, backup, AGENT_RULE);
  }

  private async loadArchive(): Promise<void> {
    const loaded = await this.store.loadTasksSafe();
    this.tasks = loaded.tasks;
    for (const failure of loaded.errors) {
      this.lockedTasks.add(failure.taskId);
      new Notice(`${failure.path} 无法恢复，已暂停该任务写入`);
    }
    try {
      this.groupArchive = await this.store.loadGroups();
      const groups = new Map(this.groups.map((group) => [group.id, group.name]));
      const reconciled: WorkTask[] = [];
      for (const task of this.tasks) {
        const name = task.groupId ? groups.get(task.groupId) : UNGROUPED_TASKS;
        if (task.groupId && !name) {
          const changed = changeTaskGroup(task, null, UNGROUPED_TASKS, new Date(), makeId(), "分组不存在");
          await this.persistTask(changed);
          reconciled.push(changed);
        } else if (name && task.groupName !== name) {
          const changed = { ...task, groupName: name };
          await this.persistTask(changed);
          reconciled.push(changed);
        } else {
          reconciled.push(task);
        }
      }
      this.tasks = reconciled;
    } catch (reason) {
      new Notice(reason instanceof Error ? reason.message : "无法读取分组档案");
    }
  }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async addTask(input: NewTaskValues): Promise<string> {
    const now = new Date();
    let task = createTask(input, now, makeId(), makeId());
    let tick = 1;
    if (input.dueDate) task = setDueDate(task, input.dueDate, new Date(now.getTime() + tick++), makeId());
    for (const text of input.todos) task = addTodo(task, text, new Date(now.getTime() + tick++), makeId(), makeId());
    if (input.initialProgress.trim()) task = addProgress(task, input.initialProgress, new Date(now.getTime() + tick), makeId());
    await this.persistTask(task);
    this.tasks = [...this.tasks, task];
    this.state.orders = pinTask(this.state.orders, task);
    await this.persistState();
    this.renderViews();
    return task.id;
  }

  updateDraft(taskId: string, value: string): void {
    this.state.drafts[taskId] = value;
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => {
      this.draftTimer = null;
      void this.saveData(this.state);
    }, 250);
  }

  async recordProgress(taskId: string, text: string): Promise<void> {
    const task = await this.updateTask(taskId, (current) => addProgress(current, text, new Date(), makeId()));
    delete this.state.drafts[taskId];
    this.state.orders = pinTask(this.state.orders, task);
    await this.persistState();
    this.renderViews(taskId);
  }

  async renameTask(taskId: string, title: string): Promise<void> {
    await this.updateTask(taskId, (task) => renameTask(task, title, new Date(), makeId()));
    this.renderViews();
  }

  async setTaskDueDate(taskId: string, date: string | null): Promise<void> {
    await this.updateTask(taskId, (task) => setDueDate(task, date, new Date(), makeId()));
    this.renderViews();
  }

  async addTaskTodo(taskId: string, text: string): Promise<void> {
    await this.updateTask(taskId, (task) => addTodo(task, text, new Date(), makeId(), makeId()));
    this.renderViews();
  }

  async toggleTaskTodo(taskId: string, todoId: string, done: boolean): Promise<void> {
    await this.updateTask(taskId, (task) => toggleTodo(task, todoId, done, new Date(), makeId()));
    this.renderViews();
  }

  async editTaskTodo(taskId: string, todoId: string, text: string): Promise<void> {
    await this.updateTask(taskId, (task) => editTodo(task, todoId, text, new Date(), makeId()));
    this.renderViews();
  }

  async removeTaskTodo(taskId: string, todoId: string): Promise<{ todo: TaskTodo; index: number }> {
    const current = this.requireTask(taskId);
    const index = current.todos?.findIndex(({ id }) => id === todoId) ?? -1;
    if (index < 0) throw new Error("没有找到这条待办");
    const todo = { ...current.todos![index]! };
    await this.updateTask(taskId, (task) => removeTodo(task, todoId, new Date(), makeId()));
    this.renderViews();
    return { todo, index };
  }

  async restoreTaskTodo(taskId: string, todo: TaskTodo, index: number): Promise<void> {
    await this.updateTask(taskId, (task) => restoreTodo(task, todo, index, new Date(), makeId()));
    this.renderViews();
  }

  async finishTask(taskId: string): Promise<void> {
    await this.updateTask(taskId, (task) => completeTask(task, new Date(), makeId()));
    this.renderViews();
  }

  async closeTask(taskId: string, reason: string): Promise<void> {
    await this.updateTask(taskId, (task) => closeTask(task, reason, new Date(), makeId()));
    this.renderViews();
  }

  async reopenTask(taskId: string): Promise<void> {
    const task = await this.updateTask(taskId, (current) => reopenTask(current, new Date(), makeId()));
    this.state.orders = pinTask(this.state.orders, task);
    await this.persistState();
    this.renderViews();
  }

  async changeGroup(taskId: string, groupId: string | null): Promise<void> {
    const group = this.groups.find(({ id }) => id === groupId);
    const task = await this.updateTask(taskId, (current) => changeTaskGroup(
      current, group?.id ?? null, group?.name ?? UNGROUPED_TASKS, new Date(), makeId(), "任务操作",
    ));
    this.state.orders = moveTaskOrder(this.state.orders, "group", task.groupId ?? "ungrouped", task.id, null);
    await this.persistState();
    this.renderViews();
  }

  async changeQuadrant(taskId: string, target: QuadrantId): Promise<void> {
    const quadrant = QUADRANTS.find(({ id }) => id === target)!;
    const task = await this.updateTask(taskId, (current) => changeTaskQuadrant(
      current, quadrant.important, quadrant.urgent, new Date(), makeId(),
    ));
    this.state.orders = moveTaskOrder(this.state.orders, "quadrant", target, task.id, null);
    await this.persistState();
    this.renderViews();
  }

  async dropTask(taskId: string, mode: ViewMode, area: string, beforeId: string | null): Promise<void> {
    let task = this.requireTask(taskId);
    if (mode === "group") {
      const group = this.groups.find(({ id }) => id === area);
      const groupId = area === "ungrouped" ? null : group?.id;
      if (area !== "ungrouped" && !groupId) throw new Error("没有找到目标分组");
      if (task.groupId !== groupId) task = await this.updateTask(taskId, (current) => changeTaskGroup(
        current, groupId ?? null, group?.name ?? UNGROUPED_TASKS, new Date(), makeId(), "跨区域拖动",
      ));
    } else {
      const quadrant = QUADRANTS.find(({ id }) => id === area);
      if (!quadrant) throw new Error("没有找到目标象限");
      if (quadrantId(task) !== quadrant.id) task = await this.updateTask(taskId, (current) => changeTaskQuadrant(
        current, quadrant.important, quadrant.urgent, new Date(), makeId(),
      ));
    }
    this.state.orders = moveTaskOrder(this.state.orders, mode, area, task.id, beforeId);
    await this.persistState();
    this.renderViews();
  }

  async setViewMode(mode: ViewMode): Promise<void> {
    this.state.viewMode = mode;
    await this.persistState();
    this.renderViews();
  }

  async addGroup(name: string): Promise<void> {
    const now = new Date();
    const group = createGroup(name, makeId(), this.groups);
    const archive: GroupArchive = {
      version: 1,
      groups: [...this.groups, group],
      events: [...this.groupArchive.events, groupEvent("group_created", group.id, now, makeId(), { name: group.name })],
    };
    await this.persistGroups(archive);
    this.groupArchive = archive;
    this.renderViews();
  }

  async renameGroup(groupId: string, name: string): Promise<void> {
    const current = this.groups.find(({ id }) => id === groupId);
    if (!current) throw new Error("没有找到这个分组");
    const renamed = createGroup(name, groupId, this.groups.filter(({ id }) => id !== groupId));
    if (renamed.name === current.name) return;
    const tasks = applyGroupRename(this.tasks, groupId, renamed.name);
    for (const task of tasks.filter((task, index) => task !== this.tasks[index])) await this.persistTask(task);
    const archive: GroupArchive = {
      version: 1,
      groups: this.groups.map((group) => group.id === groupId ? renamed : group),
      events: [...this.groupArchive.events, groupEvent("group_renamed", groupId, new Date(), makeId(), {
        from: current.name, to: renamed.name,
      })],
    };
    await this.persistGroups(archive);
    this.tasks = tasks;
    this.groupArchive = archive;
    this.renderViews();
  }

  async reorderGroup(groupId: string, direction: -1 | 1): Promise<void> {
    const index = this.groups.findIndex(({ id }) => id === groupId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this.groups.length) return;
    const groups = [...this.groups];
    [groups[index], groups[target]] = [groups[target]!, groups[index]!];
    const archive = { ...this.groupArchive, groups };
    await this.persistGroups(archive);
    this.groupArchive = archive;
    this.renderViews();
  }

  async deleteGroup(groupId: string): Promise<void> {
    const group = this.groups.find(({ id }) => id === groupId);
    if (!group) throw new Error("没有找到这个分组");
    const updated = [...this.tasks];
    for (let index = 0; index < updated.length; index += 1) {
      if (updated[index]!.groupId !== groupId) continue;
      const task = changeTaskGroup(updated[index]!, null, UNGROUPED_TASKS, new Date(), makeId(), "原分组已删除");
      await this.persistTask(task);
      updated[index] = task;
    }
    const archive: GroupArchive = {
      version: 1,
      groups: this.groups.filter(({ id }) => id !== groupId),
      events: [...this.groupArchive.events, groupEvent("group_deleted", groupId, new Date(), makeId(), { name: group.name })],
    };
    await this.persistGroups(archive);
    this.tasks = updated;
    this.groupArchive = archive;
    this.renderViews();
  }

  async changeTaskDirectory(value: string): Promise<void> {
    const directory = value.trim().replace(/^\/+|\/+$/g, "");
    if (!directory) throw new Error("任务目录不能为空");
    if (directory === this.state.taskDirectory) return;
    await this.store.backupLegacy({ state: this.state, tasks: this.tasks, groups: this.groupArchive });
    const previous = this.store;
    const next = this.createStore(directory);
    await next.initialize();
    for (const task of this.tasks) await next.saveTask(task);
    await next.saveGroups(this.groupArchive);
    for (const task of this.tasks) {
      this.guardWrite(previous.taskPath(task.id));
      await this.app.vault.adapter.remove(previous.taskPath(task.id));
    }
    for (const name of ["agent.md", "_groups.md"]) {
      const path = `${previous.taskDirectory}/${name}`;
      if (await this.app.vault.adapter.exists(path)) {
        this.guardWrite(path);
        await this.app.vault.adapter.remove(path);
      }
    }
    this.store = next;
    this.state.taskDirectory = directory;
    await this.persistState();
  }

  async persistState(): Promise<void> {
    await this.saveData(this.state);
  }

  private requireTask(taskId: string): WorkTask {
    if (this.lockedTasks.has(taskId)) throw new Error("该任务因存档异常已暂停写入");
    const task = this.tasks.find(({ id }) => id === taskId);
    if (!task) throw new Error("没有找到这项任务");
    return task;
  }

  private updateTask(taskId: string, transform: (task: WorkTask) => WorkTask): Promise<WorkTask> {
    const operation = this.writeQueue.then(async () => {
      const current = this.requireTask(taskId);
      const next = transform(current);
      if (next === current) return current;
      await this.persistTask(next);
      this.tasks = this.tasks.map((task) => task.id === taskId ? next : task);
      return next;
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async persistTask(task: WorkTask): Promise<void> {
    const path = this.store.taskPath(task.id);
    this.guardWrite(path);
    await this.store.saveTask(task);
  }

  private async persistGroups(archive: GroupArchive): Promise<void> {
    this.guardWrite(`${this.state.taskDirectory}/_groups.md`);
    await this.store.saveGroups(archive);
  }

  private guardWrite(path: string): void {
    this.internalWrites.add(path);
    window.setTimeout(() => this.internalWrites.delete(path), 1500);
  }

  private watchArchive(): void {
    this.registerEvent(this.app.vault.on("modify", (file) => {
      const taskId = this.taskIdFromPath(file.path);
      if (taskId && file instanceof TFile && !this.internalWrites.has(file.path)) {
        void this.recoverExternalTask(taskId, file);
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      const taskId = this.taskIdFromPath(file.path);
      if (taskId && !this.internalWrites.has(file.path)) void this.recoverExternalTask(taskId);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      const taskId = this.taskIdFromPath(oldPath);
      if (taskId && !this.internalWrites.has(oldPath)) void this.recoverExternalTask(taskId, file instanceof TFile ? file : undefined, file.path);
    }));
  }

  private taskIdFromPath(path: string): string | null {
    const prefix = `${this.state.taskDirectory}/`;
    if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/") || !path.endsWith(".md")) return null;
    const name = path.slice(prefix.length, -3);
    return ["agent", "_groups"].includes(name) ? null : name;
  }

  private async recoverExternalTask(taskId: string, file?: TFile, renamedPath?: string): Promise<void> {
    try {
      const source = file ? await this.app.vault.read(file) : undefined;
      this.guardWrite(this.store.taskPath(taskId));
      const task = await this.store.recoverTask(taskId, source);
      if (renamedPath && renamedPath !== this.store.taskPath(taskId) && await this.app.vault.adapter.exists(renamedPath)) {
        this.guardWrite(renamedPath);
        await this.app.vault.adapter.remove(renamedPath);
      }
      this.tasks = this.tasks.some(({ id }) => id === taskId)
        ? this.tasks.map((entry) => entry.id === taskId ? task : entry)
        : [...this.tasks, task];
      this.lockedTasks.delete(taskId);
      new Notice(`已从最近有效备份恢复 ${taskId}.md，备份之后的修改可能未包含`);
      this.renderViews();
    } catch (reason) {
      this.lockedTasks.add(taskId);
      new Notice(reason instanceof Error ? reason.message : `任务 ${taskId} 无法恢复`);
    }
  }

  private renderViews(recordedTaskId?: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (!(leaf.view instanceof WorkTimelineView)) continue;
      if (recordedTaskId) leaf.view.taskRecorded(recordedTaskId);
      else leaf.view.render();
    }
  }

  private currentView(): WorkTimelineView | undefined {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    return view instanceof WorkTimelineView ? view : undefined;
  }
}
