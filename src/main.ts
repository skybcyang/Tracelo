import {
  App,
  FileSystemAdapter,
  ItemView,
  Menu,
  MarkdownRenderer,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Platform,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

import { AGENT_RULE } from "./agent-rule";
import { IconPickerModal, availableIconIds } from "./icon-picker";
import { mountMasonryColumns } from "./card-layout";
import { normalizePluginState, type PluginState } from "./archive";
import { ArchiveStore } from "./archive-store";
import { MATERIALS_DIRECTORY, relocateTaskReferences, safeSegment } from "./storage-names";
import { exportBundle, importBundle, MAX_PACKAGE_BYTES, parseBundle, planImport, recoverInterruptedImport, type TransferBundle } from "./transfer";
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
  setTaskNotes,
  setTaskIcon,
  taskIcon,
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
  notes_changed: "详情变更",
  icon_changed: "图标变更",
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

function dueState(task: WorkTask, today = dayKey(new Date())): string {
  if (!task.dueDate || task.status !== "active") return "";
  return task.dueDate < today ? "is-overdue" : task.dueDate === today ? "is-today" : "";
}

function cardDueLabel(task: WorkTask): string {
  const state = dueState(task);
  if (state === "is-today") return "今天截止";
  const date = task.dueDate!;
  const short = `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
  return state === "is-overdue" ? `${short} · 已逾期` : short;
}

function isPropertyEvent(event: TaskEvent): boolean {
  return ["renamed", "group_changed", "quadrant_changed", "todo_added", "todo_done", "todo_undone", "todo_edited", "todo_removed", "todo_restored", "due_changed", "notes_changed", "icon_changed"].includes(event.kind);
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

interface NewTaskContext {
  groupId?: string | null;
  quadrant?: QuadrantId;
}

class NewTaskModal extends Modal {
  private quadrant: QuadrantId | null = null;

  constructor(
    app: App,
    private readonly groups: WorkGroup[],
    private readonly submitTask: (values: NewTaskValues) => Promise<void>,
    private readonly context: NewTaskContext = {},
    private readonly returnFocus?: HTMLElement,
  ) {
    super(app);
    this.quadrant = context.quadrant ?? "not_important_not_urgent";
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
    const detailsLabel = form.createEl("label", { cls: "wt-field" });
    const detailsHeading = detailsLabel.createSpan({ cls: "wt-field-heading" });
    detailsHeading.createSpan({ text: "详情", cls: "wt-field-label" });
    detailsHeading.createSpan({ text: "可选", cls: "wt-optional" });
    const details = detailsLabel.createEl("textarea", {
      attr: { rows: "4", "aria-label": "任务详情", placeholder: "任务目标、具体要求或参考资料，支持 Markdown" },
    });
    const groupLabel = form.createEl("label", { cls: "wt-field" });
    groupLabel.createSpan({ text: "任务分组", cls: "wt-field-label" });
    const group = groupLabel.createEl("select", { attr: { "aria-label": "任务分组" } });
    group.createEl("option", { text: UNGROUPED_TASKS, value: "" });
    for (const item of this.groups) group.createEl("option", { text: item.name, value: item.id });
    group.value = this.context.groupId ?? "";

    const quadrantField = form.createEl("fieldset", { cls: "wt-quadrant-picker", attr: { tabindex: "-1" } });
    const legend = quadrantField.createEl("legend");
    legend.createSpan({ text: "任务象限", cls: "wt-field-label" });
    for (const item of QUADRANTS) {
      const label = quadrantField.createEl("label", { cls: `wt-quadrant-option is-${item.id}` });
      const input = label.createEl("input", { type: "radio", attr: { name: "quadrant", value: item.id } });
      input.checked = item.id === this.quadrant;
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
          notes: details.value,
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
    requestAnimationFrame(() => {
      if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    });
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
    input.addEventListener("keydown", rawEvent => {
      const event = rawEvent as KeyboardEvent;
      if (event.key === "Enter" && event.isComposing) event.preventDefault();
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); this.close(); }
    });
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
      iconButton(actions, group.icon ?? "circle-dot", "设置分组图标").onclick = () => new IconPickerModal(
        this.app, "分组图标", group.icon ?? "circle-dot",
        async value => { if (value) { await this.plugin.changeGroupIcon(group.id, value); this.renderGroups(); } },
        { returnFocus: () => this.contentEl.querySelectorAll<HTMLElement>('[aria-label="设置分组图标"]')[index]?.focus() },
      ).open();
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

class TransferModal extends Modal {
  constructor(app: App, private readonly plugin: WorkTimelinePlugin) { super(app); }
  onOpen(): void {
    this.setTitle("导入与导出");
    this.modalEl.addClass("wt-modal");
    this.modalEl.addClass("wt-transfer-modal");
    const body = this.contentEl;
    body.createEl("p", { text: "将卡片、待办、截止日期、完整历史、分组、草稿和材料打包，带到另一个 Obsidian 仓库。", cls: "wt-modal-description" });
    const exportSection = body.createEl("section", { cls: "wt-transfer-section" });
    exportSection.createEl("h3", { text: "导出备份" });
    exportSection.createEl("p", { text: "包含已有材料和空文件夹，不包含插件程序。单个导出包上限 100 MB。" });
    const exportButton = exportSection.createEl("button", { text: "导出全部数据", cls: "wt-secondary-action", attr: { type: "button" } });
    const importSection = body.createEl("section", { cls: "wt-transfer-section" });
    importSection.createEl("h3", { text: "导入数据" });
    importSection.createEl("p", { text: "先预览再导入。已存在的卡片会跳过并保留本地内容；不同卡片即使同名也会分别保留。" });
    const label = importSection.createEl("label", { cls: "wt-field" });
    label.createSpan({ text: "选择 Tracelo 导出包", cls: "wt-field-label" });
    const file = label.createEl("input", { cls: "wt-transfer-file", attr: { type: "file", accept: ".json,.tracelo.json,application/json" } });
    const preview = importSection.createDiv({ cls: "wt-transfer-preview" });
    const status = body.createEl("p", { cls: "wt-transfer-status", attr: { role: "status", "aria-live": "polite" } });
    const actions = body.createDiv({ cls: "wt-modal-actions" });
    const close = actions.createEl("button", { text: "关闭", cls: "wt-secondary-action", attr: { type: "button" } });
    const confirm = actions.createEl("button", { text: "确认导入", cls: "wt-primary-action", attr: { type: "button" } });
    let bundle: TransferBundle | null = null;
    confirm.disabled = true;
    const busy = (value: boolean) => {
      exportButton.disabled = value; file.disabled = value; confirm.disabled = value || !bundle; close.disabled = value;
      body.setAttr("aria-busy", String(value));
    };
    const failure = (reason: unknown) => { status.setText(reason instanceof Error ? reason.message : "操作失败，请重试"); status.setAttr("role", "alert"); };
    close.addEventListener("click", () => this.close());
    exportButton.addEventListener("click", async () => {
      busy(true); status.setAttr("role", "status"); status.setText("正在读取任务和材料，生成导出包…");
      let url: string | null = null;
      try {
        const data = await this.plugin.createExport();
        url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
        const link = body.createEl("a", { attr: { href: url, download: `Tracelo ${dayKey(new Date())} ${new Date().toTimeString().slice(0, 8).replace(/:/g, "-")}.tracelo.json` } });
        link.click(); link.remove();
        status.setText(`已生成导出包：${data.tasks.length} 张卡片、${data.materials.filter(e => e.type === "file").length} 个材料文件。请在下载位置保存备份。`);
      } catch (reason) { failure(reason); }
      finally { if (url) window.setTimeout(() => URL.revokeObjectURL(url!), 60_000); busy(false); }
    });
    file.addEventListener("change", async () => {
      bundle = null; preview.empty(); confirm.disabled = true;
      const selected = file.files?.[0]; if (!selected) return;
      busy(true); status.setAttr("role", "status"); status.setText("正在校验导入包和材料…");
      try {
        if (selected.size > MAX_PACKAGE_BYTES) throw new Error("导入包超过 100 MB");
        bundle = await parseBundle(await selected.text());
        const plan = planImport(bundle, this.plugin.tasks, this.plugin.groupArchive);
        preview.createEl("p", { text: `将新增 ${plan.tasks.length} 张卡片，跳过 ${plan.skipped} 张已有卡片。` });
        preview.createEl("p", { text: `新增 ${plan.groups.groups.length - this.plugin.groups.length} 个分组，带入 ${plan.materials.filter(e => e.type === "file").length} 个材料文件。` });
        status.setText("校验通过。导入前会备份当前数据，同日同名任务自动追加序号。");
      } catch (reason) { bundle = null; failure(reason); }
      finally { busy(false); }
    });
    confirm.addEventListener("click", async () => {
      if (!bundle) return;
      busy(true); status.setAttr("role", "status"); status.setText("正在导入，请等待完成…");
      try {
        const result = await this.plugin.applyImport(bundle);
        status.setText(`导入完成：新增 ${result.imported} 张卡片，跳过 ${result.skipped} 张已有卡片。`);
        bundle = null; file.value = ""; preview.empty();
      } catch (reason) { failure(reason); }
      finally { busy(false); }
    });
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
  private masonryCleanups: Array<() => void> = [];
  private openHistoryChanges = new Set<string>();
  private openCompletedTodos = new Set<string>();
  private editingNotes = new Set<string>();
  private uploadingNoteForms = new Map<string, HTMLFormElement>();
  private recordedTaskId: string | null = null;

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
  async onClose(): Promise<void> {
    this.cardObserver?.disconnect();
    this.masonryCleanups.forEach(cleanup => cleanup());
    this.masonryCleanups = [];
  }

  taskRecorded(taskId: string): void {
    this.recordedTaskId = taskId;
    window.setTimeout(() => {
      if (this.recordedTaskId !== taskId) return;
      this.recordedTaskId = null;
      this.contentEl.querySelector('.wt-recorded-feedback')?.remove();
    }, 3500);
    if (this.expandedTaskId === taskId) this.expandedTaskId = null;
    this.render();
  }

  openNewTask(context: NewTaskContext = {}, returnFocus?: HTMLElement): void {
    new NewTaskModal(this.app, this.plugin.groups, async (values) => {
      const id = await this.plugin.addTask(values);
      this.selectedTaskId = id;
      this.expandedTaskId = id;
      this.searchQuery = "";
      this.render();
      requestAnimationFrame(() => this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${id}"] .wt-card-open`)?.focus());
    }, context, returnFocus).open();
  }

  render(displayOnly = false): void {
    const root = this.contentEl;
    const existingShell = displayOnly ? root.querySelector<HTMLElement>(".wt-shell") : null;
    const endedOpen = root.querySelector<HTMLDetailsElement>(".wt-ended-section")?.open ?? false;
    const taskScrollTop = root.querySelector(".wt-task-column")?.scrollTop ?? 0;
    const layoutScrollTop = root.querySelector(".wt-layout")?.scrollTop ?? 0;
    this.cardObserver?.disconnect();
    this.masonryCleanups.forEach(cleanup => cleanup());
    this.masonryCleanups = [];
    if (!existingShell) root.empty();
    root.addClass("work-timeline-view");
    const shell = existingShell ?? root.createDiv({ cls: "wt-shell" });
    shell.inert = this.plugin.storageBusy;
    shell.setAttr("aria-busy", String(this.plugin.storageBusy));
    const header = shell.querySelector<HTMLElement>(".wt-header");
    header?.empty();
    this.renderHeader(shell, header ?? undefined);
    const layout = shell.querySelector<HTMLElement>(".wt-layout") ?? shell.createDiv({ cls: "wt-layout" });
    const tasks = layout.querySelector<HTMLElement>(".wt-task-column") ?? layout.createEl("main", { cls: "wt-task-column" });
    tasks.empty();
    this.renderTasks(tasks);
    const ended = root.querySelector<HTMLDetailsElement>(".wt-ended-section");
    if (ended) ended.open = endedOpen;
    if (this.plugin.state.cardLayout === "masonry") {
      this.masonryCleanups = Array.from(tasks.querySelectorAll<HTMLElement>('.wt-card-grid'), mountMasonryColumns);
    }
    this.cardObserver = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        const body = target as HTMLElement;
        const card = body.parentElement;
        if (!card) continue;
        const truncated = !card.classList.contains('is-expanded') && Array.from(
          body.querySelectorAll<HTMLElement>('.wt-card-title, .wt-card-latest, .wt-todo-label span'),
        ).some(el => el.scrollHeight > el.clientHeight + 1);
        card.classList.toggle('has-truncated-content', truncated);
      }
    });
    tasks.querySelectorAll<HTMLElement>(".wt-card-body").forEach((body) => this.cardObserver?.observe(body));
    if (!existingShell) this.renderTimeline(layout.createEl("aside", { cls: "wt-timeline-column" }));
    tasks.scrollTop = taskScrollTop;
    layout.scrollTop = layoutScrollTop;
  }

  private renderHeader(shell: HTMLElement, existingHeader?: HTMLElement): void {
    const header = existingHeader ?? shell.createEl("header", { cls: "wt-header" });
    const brand = header.createDiv({ cls: "wt-brand" });
    brand.createSpan({ cls: "wt-brand-mark", attr: { "aria-hidden": "true" } });
    const identity = brand.createDiv();
    identity.createEl("h1", { text: this.plugin.manifest.name });
    const active = this.plugin.tasks.filter(({ status }) => status === "active").length;
    identity.createEl("p", { text: `${active} 项进行中 · 今天 ${eventsForDay(this.plugin.tasks, dayKey(new Date())).length} 条记录` });

    const viewTools = header.createDiv({ cls: "wt-view-tools", attr: { role: "group", "aria-label": "看板显示设置" } });
    const viewSwitch = viewTools.createDiv({ cls: "wt-view-switch", attr: { role: "group", "aria-label": "任务视图" } });
    for (const [mode, label] of [["group", "分组"], ["quadrant", "四象限"]] as const) {
      const button = viewSwitch.createEl("button", {
        text: label,
        cls: this.plugin.state.viewMode === mode ? "is-active" : "",
        attr: { type: "button", "aria-pressed": String(this.plugin.state.viewMode === mode) },
      });
      button.addEventListener("click", async () => {
        await this.plugin.setViewMode(mode);
        this.contentEl.querySelector<HTMLButtonElement>('.wt-view-switch button[aria-pressed="true"]')?.focus({ preventScroll: true });
      });
    }
    this.renderBoardControls(viewTools);

    const actions = header.createDiv({ cls: "wt-header-actions" });
    iconButton(actions, "archive", "导入与导出").addEventListener("click", () => this.plugin.openTransfer());
    iconButton(actions, "folders", "管理分组").addEventListener("click", () => new GroupManagerModal(this.app, this.plugin).open());
    const create = actions.createEl("button", { cls: "wt-new-task-button", attr: { type: "button" } });
    setIcon(create, "plus");
    create.createSpan({ text: "新建任务" });
    create.addEventListener("click", () => this.openNewTask());
  }

  private renderTasks(container: HTMLElement): void {
    const heading = container.createDiv({ cls: "wt-task-toolbar" });
    heading.createEl("h2", { text: "当前任务" });
    const zoom = this.plugin.state.boardZoom;
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
    board.style.setProperty("zoom", String(zoom / 100));
    for (const section of sections) this.renderSection(board, section);

    const ended = matches.filter(isTaskEnded).sort((left, right) =>
      (right.events.at(-1)?.at ?? "").localeCompare(left.events.at(-1)?.at ?? ""),
    );
    const endedSection = container.createEl("details", { cls: "wt-ended-section" });
    endedSection.style.setProperty("zoom", String(zoom / 100));
    const summary = endedSection.createEl("summary");
    summary.createSpan({ text: "已结束" });
    summary.createSpan({ text: `已完成 ${ended.filter(({ status }) => status === "completed").length} · 异常关闭 ${ended.filter(({ status }) => status === "closed").length}` });
    const endedGrid = endedSection.createDiv({ cls: "wt-card-grid" });
    if (!ended.length) endedGrid.createEl("p", { text: "暂无已结束任务", cls: "wt-empty" });
    for (const task of ended) this.renderCard(endedGrid, task, "ended");
  }

  private renderBoardControls(shell: HTMLElement): void {
    const controls = shell.createDiv({ cls: "wt-board-controls" });
    const presentation = controls.createEl("button", { cls: "wt-presentation-toggle", attr: { type: "button", "aria-pressed": String(this.plugin.state.presentationMode) } });
    setIcon(presentation.createSpan({ attr: { "aria-hidden": "true" } }), "panel-top");
    presentation.createSpan({ text: "展示模式" });
    presentation.onclick = async () => {
      await this.plugin.setPresentationMode(!this.plugin.state.presentationMode);
      this.contentEl.querySelector<HTMLButtonElement>(".wt-presentation-toggle")?.focus({ preventScroll: true });
    };
    const group = controls.createDiv({ cls: "wt-zoom-controls", attr: { role: "group", "aria-label": "看板缩放" } });
    group.createSpan({ text: "看板缩放", cls: "wt-zoom-label", attr: { "aria-hidden": "true" } });
    const stepper = group.createDiv({ cls: "wt-zoom-stepper" });
    const zoom = this.plugin.state.boardZoom;
    const changeZoom = async (value: number, selector: string) => {
      await this.plugin.setBoardZoom(value);
      const target = this.contentEl.querySelector<HTMLButtonElement>(selector);
      (target?.disabled ? this.contentEl.querySelector<HTMLButtonElement>(".wt-zoom-reset") : target)?.focus({ preventScroll: true });
    };
    const smaller = iconButton(stepper, "minus", "缩小看板", "wt-icon-button wt-zoom-out");
    smaller.disabled = zoom <= 60;
    smaller.title = "缩小看板（每次 5%）";
    smaller.onclick = () => void changeZoom(zoom - 5, ".wt-zoom-out");
    const reset = stepper.createEl("button", {
      text: `${zoom}%`, cls: "wt-zoom-reset",
      attr: { type: "button", "aria-label": "恢复看板缩放为100%", "aria-description": `当前缩放 ${zoom}%`, title: `当前 ${zoom}%，点击恢复 100%` },
    });
    reset.onclick = () => void changeZoom(100, ".wt-zoom-reset");
    const larger = iconButton(stepper, "plus", "放大看板", "wt-icon-button wt-zoom-in");
    larger.disabled = zoom >= 120;
    larger.title = "放大看板（每次 5%）";
    larger.onclick = () => void changeZoom(zoom + 5, ".wt-zoom-in");
  }

  private renderSection(container: HTMLElement, section: TaskGroup): void {
    const area = section.id ?? "ungrouped";
    const wrapper = container.createEl("section", {
      cls: `wt-task-section${this.plugin.state.viewMode === "quadrant" ? ` is-${area}` : ""}`,
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
    for (const task of section.tasks) this.renderCard(grid, task, area);
    const create = grid.createEl("button", {
      cls: "wt-card-create",
      attr: { type: "button", "aria-label": `在${section.name}中新建任务` },
    });
    setIcon(create.createSpan({ cls: "wt-card-create-icon", attr: { "aria-hidden": "true" } }), "plus");
    create.createSpan({ text: "新建任务", cls: "wt-card-create-label" });
    create.createSpan({ text: section.tasks.length
      ? (this.plugin.state.viewMode === "group" ? "添加到此分组" : "添加到此象限")
      : "也可拖动任务到这里", cls: "wt-card-create-hint" });
    const context: NewTaskContext = this.plugin.state.viewMode === "group"
      ? { groupId: section.id }
      : { quadrant: QUADRANTS.find(item => item.id === section.id)!.id };
    create.addEventListener("click", () => this.openNewTask(context, create));
  }

  private renderCard(container: HTMLElement, task: WorkTask, area: string): void {
    const selected = this.selectedTaskId === task.id;
    const editing = this.expandedTaskId === task.id;
    const expanded = editing || this.plugin.state.presentationMode;
    const card = container.createEl("article", {
      cls: `wt-card${selected ? " is-selected" : ""}${isTaskEnded(task) ? " is-ended" : ""}${expanded ? " is-expanded" : ""}${this.plugin.state.presentationMode ? " is-presenting" : ""}${editing ? " is-editing" : ""}`,
      attr: { "data-task-id": task.id, draggable: String(task.status === "active") },
    });
    const body = card.createDiv({ cls: "wt-card-body" });
    const heading = body.createDiv({ cls: "wt-card-heading" });
    const icon = taskIcon(task, this.plugin.groups);
    if (icon) iconButton(heading, icon, `更换图标：${task.title}`, 'wt-task-icon').onclick = () => this.openIconPicker(task);
    const open = heading.createEl("button", {
      cls: "wt-card-open",
      attr: { type: "button", "aria-expanded": String(expanded), "aria-label": `${task.status === "active" ? "查看并记录" : "查看任务"}：${task.title}` },
    });
    open.createSpan({ text: task.title, cls: "wt-card-title" });
    iconButton(heading, "pencil", `编辑标题：${task.title}`, "wt-card-rename").onclick = () => new TextPromptModal(
      this.app, "任务改名", task.title, "任务名称", false, value => this.plugin.renameTask(task.id, value),
    ).open();
    const actions = heading.createDiv({ cls: 'wt-card-heading-actions' });
    actions.appendChild(heading.querySelector('.wt-card-rename')!);
    iconButton(actions, "more-horizontal", `任务操作：${task.title}`, "wt-card-menu")
      .addEventListener("click", (event) => this.showTaskMenu(event, task));
    const tools = body.createDiv({ cls: 'wt-card-tools' });
    if (this.plugin.hasTaskFolder(task.id)) {
      const folder = iconButton(tools, "folder-open", `打开文件夹：${task.title}`, "wt-card-folder");
      folder.disabled = !this.plugin.canOpenTaskFolder || this.plugin.openingTaskFolders.has(task.id);
      folder.setAttr("title", this.plugin.canOpenTaskFolder ? "打开任务文件夹" : "请在桌面端打开任务文件夹");
      folder.addEventListener("click", async () => {
        folder.disabled = true;
        folder.setAttr("aria-busy", "true");
        try { await this.plugin.accessTaskFolder(task.id); }
        catch (reason) { new Notice(reason instanceof Error ? reason.message : "无法打开任务文件夹"); }
        finally { folder.disabled = !this.plugin.canOpenTaskFolder; folder.removeAttribute("aria-busy"); }
      });
    }
    this.renderNotes(body, task);
    const latest = [...task.events].reverse().find(({ kind }) => kind === "progress");
    if (latest) {
      body.createEl("span", { text: "最新进展", cls: "wt-latest-label" });
      body.createEl("p", { text: latest.text, cls: "wt-card-latest" });
    }
    if (this.recordedTaskId === task.id) body.createSpan({ text: "✓ 进展已记录", cls: "wt-recorded-feedback", attr: { role: "status" } });
    const footer = body.createEl("footer", { cls: "wt-card-footer" });
    const statusRow = footer.createDiv({ cls: 'wt-card-status-row' });
    if (task.todos?.length || task.dueDate) {
      const summary = statusRow.createDiv({ cls: "wt-card-summary" });
      if (task.todos?.length) {
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
          this.selectedTaskId = task.id;
          this.expandedTaskId = task.id;
          this.render();
          requestAnimationFrame(() => this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${task.id}"] ${task.status === "active" ? ".wt-todo-check" : ".wt-card-open"}`)?.focus());
        });
      }
      if (task.dueDate) {
        const due = summary.createEl("button", { cls: `wt-summary-chip wt-due-chip ${dueState(task)}`, attr: { type: "button", "aria-label": `修改截止日期：${dueLabel(task)}`, title: dueLabel(task) } });
        setIcon(due, "calendar-days");
        due.querySelector("svg")?.setAttribute("aria-hidden", "true");
        due.createSpan({ text: cardDueLabel(task) });
        due.addEventListener("click", () => this.openDueDate(task));
      }
    }
    const meta = footer.createDiv({ cls: "wt-card-meta" });
    const properties = meta.createDiv({ cls: "wt-card-properties" });
    if (this.plugin.state.viewMode === "quadrant" || isTaskEnded(task)) properties.createSpan({ text: task.groupName });
    if ((this.plugin.state.viewMode === "group" || isTaskEnded(task)) && (task.important || task.urgent)) {
      const priority = task.important && task.urgent ? "重要且紧急" : task.important ? "重要" : "紧急";
      properties.createSpan({ text: priority, cls: `wt-tag is-${task.important && task.urgent ? "important-urgent" : task.important ? "important" : "urgent"}` });
    }
    if (task.status !== "active") properties.createSpan({ text: task.status === "completed" ? "已完成" : "异常关闭", cls: `wt-status is-${task.status}` });
    const updated = latest ?? task.events[0]!;
    meta.createEl("time", { text: updated.day === dayKey(new Date()) ? formatTime(updated.at) : formatDateTime(updated.at), cls: "wt-card-time", attr: { datetime: updated.at } });
    if (tools.childElementCount) (statusRow.childElementCount ? statusRow : meta).appendChild(tools); else tools.remove();
    if (!statusRow.childElementCount) statusRow.remove();
    open.addEventListener("click", () => {
      this.selectedTaskId = task.id;
      this.expandedTaskId = editing ? null : task.id;
      if (expanded) this.addingTodoTaskId = null;
      this.render();
      this.focusCard(task.id, this.plugin.state.presentationMode && !editing);
    });
    if (!expanded) {
      const more = meta.createEl('button', { text: '展开完整内容', cls: 'wt-read-more', attr: { type: 'button' } });
      more.onclick = () => open.click();
    }
    let pointerStart: { x: number; y: number } | null = null;
    let dragged = false;
    card.addEventListener("pointerdown", (event) => { pointerStart = { x: event.clientX, y: event.clientY }; dragged = false; });
    card.addEventListener("click", (event) => {
      if (event.button !== 0 || event.defaultPrevented || dragged || this.editingNotes.has(task.id)) return;
      if (editing && this.plugin.state.drafts[task.id]?.trim()) return;
      if ((event.target as Element).closest("button, a, img, input, textarea, select, label, [contenteditable], .wt-card-todos, .wt-card-composer, .wt-optional-actions")) return;
      if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
      const selection = card.ownerDocument.getSelection();
      if (selection && !selection.isCollapsed && card.contains(selection.anchorNode)) return;
      this.selectedTaskId = task.id;
      this.expandedTaskId = this.plugin.state.presentationMode ? task.id : editing ? null : task.id;
      this.render();
      this.focusCard(task.id, this.plugin.state.presentationMode);
    });
    card.addEventListener("contextmenu", (event) => {
      if ((event.target as Element).closest("input, textarea, [contenteditable]")) return;
      event.preventDefault();
      this.showTaskMenu(event, task);
    });
    card.addEventListener("keydown", (event) => {
      if (!(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
      if ((event.target as Element).closest("input, textarea, [contenteditable]")) return;
      event.preventDefault();
      const bounds = open.getBoundingClientRect();
      this.showTaskMenu(new MouseEvent("contextmenu", { clientX: bounds.left, clientY: bounds.bottom }), task);
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
        if (moving && moving !== task.id) void this.plugin.dropTask(moving, this.plugin.state.viewMode, area, task.id);
      });
    }
    this.renderTodoDetails(body, task, editing, expanded);
    const checklist = body.querySelector('.wt-card-todos');
    if (checklist) body.insertBefore(checklist, footer);
    if (task.status === "active" && editing) this.renderComposer(body, task);
  }

  private focusCard(taskId: string, composer = false): void {
    requestAnimationFrame(() => {
      const card = this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${taskId}"]`);
      card?.querySelector<HTMLElement>(composer ? '.wt-card-composer textarea' : '.wt-card-open')?.focus({ preventScroll: true });
      const title = card?.querySelector('.wt-card-heading')?.getBoundingClientRect();
      const pane = this.contentEl.querySelector('.wt-task-column')?.getBoundingClientRect();
      if (title && pane && title.bottom < pane.top) card?.scrollIntoView({ block: 'nearest' });
    });
  }

  private renderNotes(body: HTMLElement, task: WorkTask): void {
    const edit = this.editingNotes.has(task.id);
    const pending = Object.prototype.hasOwnProperty.call(this.plugin.state.noteDrafts, task.id);
    const empty = !task.notes && !pending && !edit;
    const section = empty ? body.querySelector<HTMLElement>('.wt-card-tools')! : body.createDiv({ cls: "wt-task-notes" });
    const heading = empty ? section : section.createDiv({ cls: "wt-details-heading" });
    if (!empty) heading.createEl("h4", { text: "详情" });
    const entry = empty
      ? iconButton(section, 'file-plus', '添加详情', 'wt-notes-entry is-empty')
      : heading.createEl("button", { text: pending ? "详情 · 有未保存内容" : "编辑详情", cls: "wt-notes-entry", attr: { type: "button" } });
    entry.onclick = () => {
      this.selectedTaskId = task.id;
      this.expandedTaskId = task.id;
      this.editingNotes.add(task.id);
      this.render();
      this.contentEl.querySelector<HTMLTextAreaElement>(`.wt-card[data-task-id="${task.id}"] .wt-notes-editor textarea`)?.focus({ preventScroll: true });
    };
    // Creating the first attachment folder emits vault events and redraws the card.
    // Keep the live editor (selection, disabled state and async callbacks) intact.
    const uploadingForm = this.uploadingNoteForms.get(task.id);
    if (uploadingForm) { section.appendChild(uploadingForm); return; }
    if (!edit) {
      if (task.notes) {
        const preview = section.createDiv({ cls: "wt-notes-preview" });
        void MarkdownRenderer.render(this.app, task.notes, preview, this.plugin.taskArchivePath(task.id), this).catch(() => preview.setText(task.notes ?? ""));
        preview.addEventListener("click", event => {
          if (!(event.target instanceof HTMLImageElement)) return;
          event.preventDefault(); event.stopPropagation();
          const modal = new Modal(this.app);
          modal.setTitle("详情图片");
          const image = modal.contentEl.createEl("img", { attr: { src: event.target.src, alt: event.target.alt || "详情图片" } });
          image.style.cssText = "max-width:100%;max-height:80vh;object-fit:contain";
          modal.open();
        });
      }
      return;
    }
    const form = section.createEl("form", { cls: "wt-notes-editor" });
    const input = form.createEl("textarea", { attr: { "aria-label": "任务详情", rows: "6", placeholder: "记录长期上下文，支持 Markdown、链接与图片" } });
    input.value = this.plugin.state.noteDrafts[task.id] ?? task.notes ?? "";
    const remember = () => this.plugin.updateNoteDraft(task.id, input.value);
    input.oninput = remember;
    const status = form.createDiv({ attr: { role: "status" } });
    const actions = form.createDiv({ cls: "wt-notes-actions" });
    const upload = actions.createEl("input", { type: "file", attr: { accept: "image/*", multiple: "", "aria-label": "插入详情图片" } });
    let uploading = false;
    const insertFiles = async (files: File[]) => {
      if (uploading) return;
      uploading = true; submit.disabled = true; input.disabled = true;
      this.uploadingNoteForms.set(task.id, form);
      status.setText("图片上传中…");
      try {
        for (const file of files.filter(file => file.type.startsWith('image/'))) {
          const path = await this.plugin.addNoteAttachment(task.id, file.name || '截图.png', await file.arrayBuffer());
          const start = input.selectionStart;
          const value = `![${file.name.replace(/[\[\]\\]/g, '') || '截图'}](<${path}>)`;
          input.setRangeText(value, start, input.selectionEnd, 'end'); remember();
        }
        status.setText("图片已插入，请保存详情");
      } catch (reason) { status.setText(`上传失败：${reason instanceof Error ? reason.message : String(reason)}`); }
      finally { this.uploadingNoteForms.delete(task.id); uploading = false; submit.disabled = false; input.disabled = false; }
    };
    upload.onchange = () => void insertFiles(Array.from(upload.files ?? []));
    input.addEventListener('paste', event => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.some(file => file.type.startsWith('image/'))) { event.preventDefault(); void insertFiles(files); }
    });
    form.addEventListener('dragover', event => event.preventDefault());
    form.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); void insertFiles(Array.from(event.dataTransfer?.files ?? [])); });
    const cancel = actions.createEl("button", { text: "取消详情编辑", attr: { type: "button" } });
    cancel.onclick = () => { if (uploading) return; this.editingNotes.delete(task.id); this.plugin.clearNoteDraft(task.id); this.render(); this.focusCard(task.id); };
    const submit = actions.createEl("button", { text: "保存详情", attr: { type: "submit" } });
    form.onsubmit = async event => {
      event.preventDefault(); if (uploading) return;
      remember(); submit.disabled = cancel.disabled = input.disabled = true; status.setText("保存中…");
      try {
        await this.plugin.saveTaskNotes(task.id, input.value);
        this.editingNotes.delete(task.id); this.render(); this.focusCard(task.id);
      } catch (reason) { status.setText(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`); submit.disabled = cancel.disabled = input.disabled = false; }
    };
  }

  private openDueDate(task: WorkTask): void {
    new DueDateModal(this.app, task.dueDate, (date) => this.plugin.setTaskDueDate(task.id, date)).open();
  }

  private renderTodoDetails(card: HTMLElement, task: WorkTask, editing: boolean, expanded: boolean): void {
    const showChecklist = Boolean(task.todos?.length) || this.addingTodoTaskId === task.id;
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
            completedSection.open = this.openCompletedTodos.has(task.id);
            completedSection.createEl('summary', { text: `已完成 ${completed.length} 项` });
            completedSection.addEventListener('toggle', () => {
              if (!completedSection?.isConnected) return;
              if (completedSection.open) this.openCompletedTodos.add(task.id); else this.openCompletedTodos.delete(task.id);
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
            await this.plugin.toggleTaskTodo(task.id, item.id, check.checked);
            requestAnimationFrame(() => {
              const card = this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${task.id}"]`);
              const input = card?.querySelector<HTMLElement>(`.wt-todo-check[aria-label="${CSS.escape(item.text)}"]`);
              const folded = input?.closest('details');
              (input && (!folded || folded.open) ? input : card?.querySelector<HTMLElement>('.wt-progress-chip'))?.focus({ preventScroll: true });
            });
          } catch (reason) {
            check.checked = item.done;
            check.disabled = false;
            new Notice(reason instanceof Error ? reason.message : "未能保存，请重试");
          }
        });
        if (task.status === "active" && editing) {
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
      if (!expanded && pending.length > 3) {
        const more = section.createEl('button', { text: `还有 ${pending.length - 3} 项待办`, cls: 'wt-more-todos', attr: { type: 'button' } });
        more.onclick = () => { this.selectedTaskId = task.id; this.expandedTaskId = task.id; this.render(); this.focusCard(task.id); };
      }
    }
    if (task.status !== "active" || !editing) return;
    if (section) {
      const form = section.createEl("form", { cls: "wt-add-todo" });
      const input = form.createEl("input", { type: "text", attr: { "aria-label": "新增待办", placeholder: "添加下一步要做的事", maxlength: "160", required: "" } });
      const submit = iconButton(form, "plus", "添加待办", "wt-add-todo-submit");
      submit.setAttr("type", "submit");
      if (!task.todos?.length) {
        const cancel = () => { this.addingTodoTaskId = null; this.render(); this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${task.id}"] .wt-optional-actions button`)?.focus(); };
        iconButton(form, "x", "取消添加待办").addEventListener("click", cancel);
        input.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } });
      }
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
          this.addingTodoTaskId = null;
          await this.plugin.addTaskTodo(task.id, input.value);
          this.contentEl.querySelector<HTMLInputElement>(`.wt-card[data-task-id="${task.id}"] .wt-add-todo input`)?.focus();
        } catch (reason) { submit.disabled = false; new Notice(reason instanceof Error ? reason.message : "未能保存，请重试"); }
      });
    }
    if (!showChecklist || !task.dueDate) {
      const actions = card.createDiv({ cls: "wt-optional-actions" });
      if (!showChecklist) {
        const add = actions.createEl("button", { attr: { type: "button" } });
        setIcon(add.createSpan({ attr: { "aria-hidden": "true" } }), "plus");
        add.createSpan({ text: "添加待办" });
        add.addEventListener("click", () => { this.addingTodoTaskId = task.id; this.render(); this.contentEl.querySelector<HTMLInputElement>(`.wt-card[data-task-id="${task.id}"] .wt-add-todo input`)?.focus(); });
      }
      if (!task.dueDate) {
        const due = actions.createEl("button", { attr: { type: "button" } });
        setIcon(due.createSpan({ attr: { "aria-hidden": "true" } }), "calendar-days");
        due.createSpan({ text: "设置截止日期" });
        due.addEventListener("click", () => this.openDueDate(task));
      }
    }
  }

  private renderComposer(card: HTMLElement, task: WorkTask): void {
    const form = card.createEl("form", { cls: "wt-card-composer" });
    const label = form.createEl("label");
    label.createSpan({ text: "记录当前进展" });
    const input = label.createEl("textarea", {
      attr: { rows: "3", maxlength: "2000", placeholder: "记录已经推进的事…", required: "" },
    });
    input.value = this.plugin.state.drafts[task.id] ?? "";
    input.addEventListener("input", () => this.plugin.updateDraft(task.id, input.value));
    const footer = form.createDiv({ cls: "wt-composer-footer" });
    footer.createSpan({ text: "切换卡牌保留草稿", cls: "wt-draft-state" });
    const close = footer.createEl('button', { text: '收起', cls: 'wt-composer-close', attr: { type: 'button', 'aria-label': '关闭进展输入' } });
    close.onclick = () => { this.expandedTaskId = null; this.render(); this.focusCard(task.id); };
    input.addEventListener("keydown", event => {
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); this.expandedTaskId = null; this.render(); this.focusCard(task.id); }
    });
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

  private openIconPicker(task: WorkTask): void {
    new IconPickerModal(this.app, '卡片图标', task.icon, icon => this.plugin.changeTaskIcon(task.id, icon), {
      inheritedIcon: this.plugin.groups.find(group => group.id === task.groupId)?.icon ?? 'circle-dot',
      returnFocus: () => this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${task.id}"] .wt-task-icon, .wt-card[data-task-id="${task.id}"] .wt-card-menu`)?.focus({ preventScroll: true }),
    }).open();
  }

  private showTaskMenu(event: MouseEvent, task: WorkTask): void {
    event.stopPropagation();
    const menu = new Menu();
    const exists = this.plugin.hasTaskFolder(task.id);
    menu.addItem((item) => item.setTitle(this.plugin.canOpenTaskFolder ? (exists ? "打开文件夹" : "创建文件夹") : "任务文件夹（仅桌面端）")
      .setIcon(exists ? "folder-open" : "folder-plus")
      .setDisabled(!this.plugin.canOpenTaskFolder || this.plugin.openingTaskFolders.has(task.id))
      .onClick(() => void this.plugin.accessTaskFolder(task.id, !exists).catch((reason) => new Notice(reason instanceof Error ? reason.message : "无法打开任务文件夹"))));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('更换图标…').setIcon('shapes').onClick(() => this.openIconPicker(task)));
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
        const due = title.createDiv({ cls: `wt-task-due ${dueState(task)}` });
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
        const row = due.createEl("button", { cls: `wt-due-row ${dueState(item)}`, attr: { type: "button" } });
        row.createSpan({ text: item.title });
        row.createSpan({ text: item.status === "completed" ? "已完成" : item.status === "closed" ? "已关闭" : this.selectedDay < dayKey(new Date()) ? "已逾期" : "进行中" });
        row.addEventListener("click", () => { this.selectedTaskId = item.id; this.render(); });
      }
    }
    const body = container.createDiv({ cls: "wt-timeline-scroll" });
    const entries = eventsForDay(this.plugin.tasks, this.selectedDay);
    if (!entries.length) body.createEl("p", { text: "这一天还没有记录", cls: "wt-empty" });
    this.renderEventStream(body, entries, true);
    this.scrollTimeline(body);
  }

  private renderEvents(container: HTMLElement, events: TaskEvent[], showTask: boolean): void {
    this.renderEventStream(container, events.map(event => ({ event })), showTask);
  }

  private renderEventStream(container: HTMLElement, entries: { event: TaskEvent; taskId?: string }[], showTask: boolean): void {
    let list: HTMLElement | null = null;
    let propertyRun: HTMLElement | null = null;
    let summary: HTMLElement | null = null;
    let count = 0;
    for (const { event, taskId } of entries) {
      if (isPropertyEvent(event)) {
        if (!propertyRun) {
          const key = `${showTask ? "day" : this.selectedTaskId}:${event.id}`;
          const details = container.createEl("details", { cls: "wt-event-changes" });
          details.open = this.openHistoryChanges.has(key);
          details.addEventListener("toggle", () => {
            if (!details.isConnected) return;
            if (details.open) this.openHistoryChanges.add(key);
            else this.openHistoryChanges.delete(key);
          });
          summary = details.createEl("summary");
          propertyRun = details.createEl("ol", { cls: "wt-event-list" });
          count = 0;
        }
        summary!.textContent = `${++count} 条属性变更`;
        this.renderEvent(propertyRun, event, showTask, taskId);
        list = null;
      } else {
        propertyRun = null;
        list ??= container.createEl("ol", { cls: "wt-event-list" });
        this.renderEvent(list, event, showTask, taskId);
      }
    }
  }

  private renderEvent(list: HTMLElement, event: TaskEvent, showTask: boolean, taskId?: string): void {
    const muted = isPropertyEvent(event);
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
    new Setting(this.containerEl)
      .setName("卡片布局")
      .setDesc("顶部对齐：卡片按行排列，每行顶部齐平。瀑布流：卡片等宽，每列独立向下排列，展开时不跨列移动。")
      .addDropdown(dropdown => {
        dropdown.selectEl.setAttribute("aria-label", "卡片布局");
        dropdown.addOption("aligned", "顶部对齐（默认）")
          .addOption("masonry", "瀑布流")
          .setValue(this.timeline.state.cardLayout)
          .onChange(async value => {
            try { await this.timeline.setCardLayout(value === "masonry" ? "masonry" : "aligned"); }
            catch (reason) {
              dropdown.setValue(this.timeline.state.cardLayout);
              new Notice(reason instanceof Error ? reason.message : "无法保存卡片布局");
            }
          });
      });
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
      .setName("导入与导出")
      .setDesc("备份或迁移卡片、分组、草稿和材料；导入前预览，已有任务保留。")
      .addButton(button => button.setButtonText("导入与导出").onClick(() => this.timeline.openTransfer()));
    new Setting(this.containerEl)
      .setName("备份策略")
      .setDesc("每次正式写入同步备份任务与附件，保留最近 7 个备份日期；升级和迁移备份不会自动清理。也可使用完整导出包迁移。") ;
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
  readonly openingTaskFolders = new Set<string>();
  storageBusy = false;

  get canOpenTaskFolder(): boolean { return Platform.isDesktopApp && this.app.vault.adapter instanceof FileSystemAdapter; }

  private taskFolderPath(taskId: string): string {
    const task = this.tasks.find(task => task.id === taskId);
    if (!task) throw new Error("没有找到这个任务");
    return this.store.taskFolderPath(task);
  }

  hasTaskFolder(taskId: string): boolean {
    return this.app.vault.getAbstractFileByPath(this.taskFolderPath(taskId)) instanceof TFolder;
  }

  async accessTaskFolder(taskId: string, create = false): Promise<void> {
    if (!this.canOpenTaskFolder) throw new Error("请在桌面端打开任务文件夹");
    if (this.openingTaskFolders.has(taskId)) return;
    this.openingTaskFolders.add(taskId);
    try { await this.enqueueWrite(() => this.performFolderAccess(taskId, create)); }
    finally { this.openingTaskFolders.delete(taskId); this.renderViews(); }
  }

  private async performFolderAccess(taskId: string, create: boolean): Promise<void> {
    let path = this.taskFolderPath(taskId);
    const hadFolder = this.hasTaskFolder(taskId);
    try {
      if (create) {
        const task = await this.store.ensureTaskFolder(this.requireTask(taskId));
        this.tasks = this.tasks.map(current => current.id === taskId ? task : current);
        path = this.taskFolderPath(taskId);
      }
      if (!this.hasTaskFolder(taskId)) throw new Error("任务文件夹已被移动或删除，请从菜单重新创建，或将原目录移回原位置");
      if (create && this.requireTask(taskId).materialFolder !== path) {
        const task = { ...this.requireTask(taskId), materialFolder: path };
        await this.persistTask(task);
        this.tasks = this.tasks.map(t => t.id === taskId ? task : t);
      }
      const fullPath = (this.app.vault.adapter as FileSystemAdapter).getFullPath(path);
      try {
        if (Platform.isWin) {
          // Electron's renderer shell.openPath can leave Explorer behind Obsidian on Windows.
          // Launch directly with a literal argument, never through cmd.exe or a shell string.
          const { spawn } = require("node:child_process") as typeof import("node:child_process");
          await new Promise<void>((resolve, reject) => {
            const child = spawn("explorer.exe", [fullPath], { shell: false, windowsHide: false, stdio: "ignore" });
            child.once("error", reject);
            // Explorer may reuse an existing process; its exit code does not describe navigation.
            child.once("spawn", () => { child.unref(); resolve(); });
          });
        } else {
          const { shell } = require("electron") as { shell: { openPath(path: string): Promise<string> } };
          const failure = await shell.openPath(fullPath);
          if (failure) throw new Error(failure);
        }
      } catch (reason) {
        throw new Error(`文件夹已保留，但无法打开：${reason instanceof Error ? reason.message : String(reason)}`);
      }
    } finally {
      if (!hadFolder || !this.hasTaskFolder(taskId)) this.renderViews();
    }
  }

  get groups(): WorkGroup[] { return this.groupArchive.groups; }

  async onload(): Promise<void> {
    const raw = await this.loadData();
    this.state = normalizePluginState(raw);
    const previouslyInitialized = this.state.initialized;
    this.store = this.createStore(this.state.taskDirectory);
    const recoveredState = await recoverInterruptedImport(this.app.vault.adapter, this.store, state => this.saveData(state));
    if (recoveredState) { this.state = recoveredState; new Notice("上次导入未完成，已恢复导入前的数据"); }
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
    this.addCommand({ id: "transfer-work-timeline", name: "导入与导出", callback: () => this.openTransfer() });
    this.addCommand({ id: "create-work-task", name: "新建工作任务", callback: async () => {
      await this.activateView();
      this.currentView()?.openNewTask();
    } });
    this.addSettingTab(new WorkTimelineSettingTab(this.app, this));
    this.watchArchive();
    const refreshFolder = (path: string) => {
      if (path === this.state.taskDirectory || path.startsWith(`${this.state.taskDirectory}/`)
        || path === MATERIALS_DIRECTORY || path.startsWith(`${MATERIALS_DIRECTORY}/`)) this.renderViews();
    };
    this.registerEvent(this.app.vault.on("create", file => { if (file instanceof TFolder) refreshFolder(file.path); }));
    this.registerEvent(this.app.vault.on("delete", file => { if (file instanceof TFolder) refreshFolder(file.path); }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => { if (file instanceof TFolder) { refreshFolder(oldPath); refreshFolder(file.path); } }));
  }

  async onunload(): Promise<void> {
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    await this.saveData(this.state);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  private createStore(directory: string): ArchiveStore {
    const backup = `${this.app.vault.configDir}/plugins/${this.manifest.id}/backups`;
    return new ArchiveStore(this.app.vault.adapter, directory, backup, AGENT_RULE, path => this.guardWrite(path));
  }

  private async loadArchive(): Promise<void> {
    const loaded = await this.store.loadTasksSafe();
    this.tasks = loaded.tasks;
    await this.store.migrateTaskNames(this.tasks);
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
    return this.enqueueWrite(async () => {
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
    });
  }

  updateDraft(taskId: string, value: string): void {
    this.state.drafts[taskId] = value;
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => {
      this.draftTimer = null;
      void this.saveData(this.state).catch(() => new Notice("进展草稿暂存在内存中，未能写入草稿备份。请提交后再关闭插件。"));
    }, 250);
  }

  async recordProgress(taskId: string, text: string): Promise<void> {
    const task = await this.updateTask(taskId, (current) => addProgress(current, text, new Date(), makeId()));
    delete this.state.drafts[taskId];
    this.state.orders = pinTask(this.state.orders, task);
    try { await this.persistState(); }
    catch { new Notice("进展已保存，但界面状态保存失败；请勿重复提交进展。"); }
    this.renderViews(taskId);
  }

  async renameTask(taskId: string, title: string): Promise<void> {
    await this.updateTask(taskId, (task) => renameTask(task, title, new Date(), makeId()));
    this.renderViews();
  }

  taskArchivePath(taskId: string): string { return this.store.taskPath(taskId); }

  updateNoteDraft(taskId: string, value: string): void {
    this.state.noteDrafts[taskId] = value;
    void this.persistState().catch(() => new Notice("详情草稿暂存在内存中，但未能写入草稿备份。请保存详情后再关闭插件。"));
  }

  clearNoteDraft(taskId: string): void {
    delete this.state.noteDrafts[taskId];
    void this.persistState().catch(() => new Notice("未能更新草稿状态，重载后可能仍显示旧草稿。"));
  }

  async saveTaskNotes(taskId: string, notes: string): Promise<void> {
    await this.updateTask(taskId, task => setTaskNotes(task, notes, new Date(), makeId()));
    delete this.state.noteDrafts[taskId];
    try { await this.persistState(); }
    catch { new Notice("详情已保存，但未能更新界面状态。重载后可能仍显示旧草稿。"); }
  }

  async changeTaskIcon(taskId: string, icon: string | null | undefined): Promise<void> {
    await this.updateTask(taskId, task => setTaskIcon(task, icon, new Date(), makeId()));
    this.renderViews();
  }

  async addNoteAttachment(taskId: string, filename: string, data: ArrayBuffer): Promise<string> {
    return this.enqueueWrite(async () => {
      const saved = await this.store.saveNoteAttachment(this.requireTask(taskId), filename, data);
      this.tasks = this.tasks.map(task => task.id === taskId ? saved.task : task);
      return saved.path;
    });
  }

  async setBoardZoom(value: number): Promise<void> {
    this.state.boardZoom = Math.min(120, Math.max(60, Math.round(value / 5) * 5));
    await this.persistState(); this.renderViews(undefined, true);
  }

  async setPresentationMode(value: boolean): Promise<void> {
    this.state.presentationMode = value;
    await this.persistState(); this.renderViews(undefined, true);
  }

  async setCardLayout(value: PluginState["cardLayout"]): Promise<void> {
    return this.enqueueWrite(async () => {
      const previous = this.state.cardLayout;
      this.state.cardLayout = value;
      try { await this.persistState(); }
      catch (reason) { this.state.cardLayout = previous; throw reason; }
      this.renderViews(undefined, true);
    });
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
    return this.enqueueWrite(async () => {
      this.state.viewMode = mode;
      await this.persistState();
      this.renderViews(undefined, true);
    });
  }

  async addGroup(name: string): Promise<void> {
    return this.enqueueWrite(async () => {
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
    });
  }

  async renameGroup(groupId: string, name: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const current = this.groups.find(({ id }) => id === groupId);
      if (!current) throw new Error("没有找到这个分组");
      const renamed = { ...current, ...createGroup(name, groupId, this.groups.filter(({ id }) => id !== groupId)) };
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
    });
  }

  async changeGroupIcon(groupId: string, icon: string): Promise<void> {
    if (!availableIconIds().includes(icon.trim().replace(/^lucide-/, ''))) throw new Error("请选择有效的 Obsidian 图标");
    await this.enqueueWrite(async () => {
      const archive = { ...this.groupArchive, groups: this.groups.map(group => group.id === groupId ? { ...group, icon: icon.trim() } : group) };
      await this.persistGroups(archive); this.groupArchive = archive; this.renderViews();
    });
  }

  async reorderGroup(groupId: string, direction: -1 | 1): Promise<void> {
    return this.enqueueWrite(async () => {
      const index = this.groups.findIndex(({ id }) => id === groupId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= this.groups.length) return;
      const groups = [...this.groups];
      [groups[index], groups[target]] = [groups[target]!, groups[index]!];
      const archive = { ...this.groupArchive, groups };
      await this.persistGroups(archive);
      this.groupArchive = archive;
      this.renderViews();
    });
  }

  async deleteGroup(groupId: string): Promise<void> {
    return this.enqueueWrite(async () => {
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
    });
  }

  async changeTaskDirectory(value: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const directory = value.trim().replace(/\/+$/g, "");
      if (!directory || !directory.split("/").every(safeSegment)) throw new Error("请选择仓库内的有效相对目录");
      if (directory === this.state.taskDirectory) return;
      if (directory.startsWith(`${this.state.taskDirectory}/`) || directory === this.app.vault.configDir || directory.startsWith(`${this.app.vault.configDir}/`)
        || directory === MATERIALS_DIRECTORY || directory.startsWith(`${MATERIALS_DIRECTORY}/`)) throw new Error("任务目录不能位于原任务目录、材料目录或插件配置目录内");
      if (await this.app.vault.adapter.exists(directory)) {
        if ((await this.app.vault.adapter.stat(directory))?.type !== "folder") throw new Error("目标路径不是目录");
        const listing = await this.app.vault.adapter.list(directory);
        if (listing.files.length || listing.folders.length) throw new Error("目标目录不是空目录，请使用导入功能合并已有任务");
      }
      await this.store.backupLegacy({ state: this.state, tasks: this.tasks, groups: this.groupArchive });
      const previous = this.store;
      const next = this.createStore(directory);
      await next.initialize();
      const copied = structuredClone(this.tasks);
      const nextState = { ...this.state, taskDirectory: directory };
      try {
        const adapter = this.app.vault.adapter;
        const copyMaterials = async (source: string, destination: string, archivePath: string): Promise<void> => {
          await adapter.mkdir(destination);
          const contents = await adapter.list(source);
          for (const path of contents.files) {
            if (path === archivePath) continue;
            const target = `${destination}/${path.slice(path.lastIndexOf('/') + 1)}`;
            const bytes = await adapter.readBinary(path);
            await adapter.writeBinary(target, bytes);
            const written = new Uint8Array(await adapter.readBinary(target));
            if (written.byteLength !== bytes.byteLength || written.some((byte, index) => byte !== new Uint8Array(bytes)[index])) throw new Error("材料迁移校验失败");
          }
          for (const folder of contents.folders) await copyMaterials(folder, `${destination}/${folder.slice(folder.lastIndexOf('/') + 1)}`, archivePath);
        };
        for (const task of copied) {
          if (task.materialFolder) {
            const source = task.materialFolder;
            const target = `${directory}/${task.archiveName ?? task.id}`;
            await copyMaterials(source, target, previous.taskPath(task.id));
            task.materialFolder = target;
            if (task.notes !== undefined) task.notes = relocateTaskReferences(task.notes, source, target);
          }
          await next.saveTask(task);
        }
        await next.saveGroups(this.groupArchive);
        await this.saveData(nextState);
      } catch (reason) {
        // Original files and settings remain authoritative until the destination is fully saved.
        new Notice("迁移未完成，原目录已保留。目标目录中可能有副本，请检查后重试。");
        throw reason;
      }
      this.store = next; this.state = nextState; this.tasks = copied;
      try {
        for (const path of [...this.tasks.map(t => previous.taskPath(t.id)), ...["agent.md", "_groups.md"].map(name => `${previous.taskDirectory}/${name}`)]) {
          this.guardWrite(path);
          if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.remove(path);
        }
      } catch { new Notice("任务已迁移；部分旧文件未能移除，已保留在原目录。"); }
      this.renderViews();
    });
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
    return this.enqueueWrite(async () => {
      const current = this.requireTask(taskId);
      const next = transform(current);
      if (next === current) return current;
      await this.persistTask(next);
      this.tasks = this.tasks.map((task) => task.id === taskId ? next : task);
      return next;
    });
  }

  private enqueueWrite<T>(run: () => Promise<T>): Promise<T> {
    if (this.storageBusy) return Promise.reject(new Error("正在导入或导出，请等待完成"));
    const operation = this.writeQueue.then(run);
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
    const ingest = (file: TFile) => {
      if (this.internalWrites.has(file.path)) return;
      void this.enqueueWrite(async () => {
        const task = await this.store.ingestTaskFile(file.path);
        if (!task || this.tasks.some(current => current.id === task.id)) return;
        this.tasks = [...this.tasks, task];
        this.state.orders = pinTask(this.state.orders, task);
        await this.persistState(); this.renderViews();
      }).catch(reason => new Notice(`无法接入新任务：${reason instanceof Error ? reason.message : String(reason)}`));
    };
    this.registerEvent(this.app.vault.on("create", file => { if (file instanceof TFile) ingest(file); }));
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
      else if (!taskId && file instanceof TFile) ingest(file);
    }));
  }

  private taskIdFromPath(path: string): string | null {
    return this.store.taskIdFromPath(path);
  }

  openTransfer(): void { new TransferModal(this.app, this).open(); }

  private async transferOperation<T>(run: () => Promise<T>): Promise<T> {
    return this.enqueueWrite(async () => {
      this.storageBusy = true;
      if (this.draftTimer !== null) { window.clearTimeout(this.draftTimer); this.draftTimer = null; }
      this.renderViews();
      try {
        if (this.lockedTasks.size) throw new Error("存在无法恢复的任务，请先处理存档错误再导入或导出");
        return await run();
      } finally { this.storageBusy = false; this.renderViews(); }
    });
  }

  createExport(): Promise<TransferBundle> {
    return this.transferOperation(() => exportBundle(this.app.vault.adapter, this.tasks, this.groupArchive, this.state, this.state.taskDirectory));
  }

  applyImport(bundle: TransferBundle): Promise<{ imported: number; skipped: number }> {
    return this.transferOperation(async () => {
      const result = await importBundle(this.app.vault.adapter, this.store, bundle, this.tasks, this.groupArchive, this.state, state => this.saveData(state));
      this.tasks = result.tasks; this.groupArchive = result.groups; this.state = result.state;
      return { imported: result.imported, skipped: result.skipped };
    });
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

  private renderViews(recordedTaskId?: string, displayOnly = false): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (!(leaf.view instanceof WorkTimelineView)) continue;
      if (recordedTaskId) leaf.view.taskRecorded(recordedTaskId);
      else leaf.view.render(displayOnly);
    }
  }

  private currentView(): WorkTimelineView | undefined {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    return view instanceof WorkTimelineView ? view : undefined;
  }
}
