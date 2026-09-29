import {
  App,
  FileSystemAdapter,
  ItemView,
  Menu,
  type MenuItem,
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
import { renderTaskCard, formatTime, dueLabel, dueState } from "./task-card";
import { mountDeadlineCalendar } from './deadline-calendar';
import { prepareImages } from './draft-images';
import { applyQuickOperation, decodeQuickImages, QUICK_DIRECTORY, type QuickOperation } from './quick-operations';
import { findTaskMatches, searchExcerpt, type TaskMatch } from "./search";
import { IconPickerModal, availableIconIds } from "./icon-picker";
import { setContentIcon } from './content-icons';
import { mountMasonryColumns } from "./card-layout";
import { mountNewTaskForm, buildNewTask, type NewTaskValues, type NewTaskContext, type NewTaskDraft } from "./new-task-form";
import { normalizePluginState, serializeTaskMarkdown, type PluginState } from "./archive";
import { mountQuickProgress } from './desktop-progress';
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
  toggleTodo,
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

function submenuFor(item: MenuItem): Menu {
  // Obsidian uses this native submenu API internally but omits it from public typings.
  const host = item as MenuItem & { setSubmenu?: () => Menu };
  if (host.setSubmenu) return host.setSubmenu();
  const submenu = new Menu();
  item.onClick(event => {
    if (event instanceof MouseEvent) submenu.showAtMouseEvent(event);
    else {
      const bounds = event.target instanceof HTMLElement ? event.target.getBoundingClientRect() : null;
      submenu.showAtPosition({ x: bounds?.right ?? 0, y: bounds?.top ?? 0 });
    }
  });
  return submenu;
}

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


function formatDay(day: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" })
    .format(new Date(`${day}T12:00:00`));
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

// A draft belongs to this vault session, never another App or a persisted archive.
const newTaskDrafts = new WeakMap<App, Map<string, NewTaskDraft>>();

class NewTaskModal extends Modal {
  private controller?: ReturnType<typeof mountNewTaskForm>;
  constructor(
    app: App, private readonly groups: WorkGroup[],
    private readonly submitTask: (values: NewTaskValues) => Promise<void>,
    private readonly context: NewTaskContext = {}, private readonly returnFocus?: HTMLElement,
    private readonly draftScope = '',
    private readonly openProgress?: () => void,
  ) { super(app); }

  onOpen(): void {
    this.setTitle("Tracelo");
    this.modalEl.addClass("wt-modal");
    this.modalEl.addClass("wt-new-task-modal");
    this.modalEl.addClass('wt-capture-dialog');
    const brand = this.titleEl.createSpan({cls:'wt-capture-brand'}); setIcon(brand,'workflow'); this.titleEl.prepend(brand);
    const tabs = this.contentEl.createDiv({cls:'wt-capture-tabs'});
    for (const [label, icon, active] of [['新建任务','square-pen',true],['记录进展','message-square-plus',false]] as const) {
      const button = tabs.createEl('button',{attr:{type:'button','aria-pressed':String(active)}});
      setIcon(button.createSpan(),icon); button.createSpan({text:label});
      if (!active) { button.disabled = !this.openProgress; button.onclick = () => { this.close(); this.openProgress?.(); }; }
    }
    let drafts = newTaskDrafts.get(this.app);
    if (!drafts) { drafts = new Map(); newTaskDrafts.set(this.app, drafts); }
    const scopedDrafts = drafts;
    this.controller = mountNewTaskForm(this.contentEl, {
      groups: this.groups, context: this.context, draft: scopedDrafts.get(this.draftScope),
      isWin: Platform.isWin, setIcon,
      onChange: draft => {
        const empty = !draft.title && !draft.notes && !draft.todos.some(Boolean) && !draft.dueDate && !draft.initialProgress
          && draft.groupId === (this.context.groupId ?? '') && draft.quadrant === (this.context.quadrant ?? 'not_important_not_urgent');
        if (empty) scopedDrafts.delete(this.draftScope); else scopedDrafts.set(this.draftScope, draft);
      },
      onCancel: () => this.close(),
      onSubmit: async values => {
        await this.submitTask(values);
        scopedDrafts.delete(this.draftScope);
        super.close();
      },
    });
    requestAnimationFrame(() => {
      if (this.modalEl.isConnected && !this.modalEl.contains(this.modalEl.ownerDocument.activeElement)) this.controller?.focus();
    });
  }
  close(): void { if (!this.controller?.isSaving()) super.close(); }
  onClose(): void {
    this.controller?.destroy();
    this.contentEl.empty();
    requestAnimationFrame(() => { if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true }); });
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
      shortcuts.createEl("button", { text: label, cls: "wt-secondary-action", attr: { type: "button" } }).addEventListener("click", () => {
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

async function runWithNotice(action: () => Promise<unknown>): Promise<void> {
  try { await action(); }
  catch (reason) { new Notice(reason instanceof Error ? reason.message : "未能保存，请重试"); }
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
      const iconControl = iconButton(actions, "circle-dot", "设置分组图标");
      setContentIcon(iconControl, group.icon ?? "circle-dot");
      iconControl.onclick = () => new IconPickerModal(
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
      up.addEventListener("click", () => void runWithNotice(async () => { await this.plugin.reorderGroup(group.id, -1); this.renderGroups(); }));
      down.addEventListener("click", () => void runWithNotice(async () => { await this.plugin.reorderGroup(group.id, 1); this.renderGroups(); }));
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

interface TimelineReading {
  key: string;
  top: number;
  nearStart: boolean;
  eventIds: Set<string>;
  anchorId?: string;
  anchorOffset: number;
  pendingProgress: boolean;
}

class WorkTimelineView extends ItemView {
  private selectedDay = dayKey(new Date());
  private currentDay = this.selectedDay;
  private selectedTaskId: string | null = null;
  private expandedTaskId: string | null = null;
  private searchQuery = "";
  private boardFilter = 'all';
  private dueTodayOnly = false;
  private narrowPane: 'tasks' | 'history' = 'tasks';
  private taskScrollTop = 0;
  private hiddenTimelineReading?: TimelineReading;
  private searchTarget?: { eventId: string; query: string };
  private addingTodoTaskId: string | null = null;
  private cardObserver: ResizeObserver | null = null;
  private masonryCleanups: Array<() => void> = [];
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
    const groupId = this.boardFilter === 'all' || this.boardFilter === 'ungrouped' ? null : this.boardFilter;
    context = { groupId, ...context };
    new NewTaskModal(this.app, this.plugin.groups, async (values) => {
      const id = await this.plugin.addTask(values);
      this.selectedTaskId = id;
      this.expandedTaskId = id;
      if (this.boardFilter !== 'all') this.boardFilter = values.groupId ?? 'ungrouped';
      this.dueTodayOnly = false;
      this.searchQuery = "";
      this.searchTarget = undefined;
      this.narrowPane = 'tasks';
      this.render();
      requestAnimationFrame(() => this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${id}"] .wt-card-open`)?.focus());
    }, context, returnFocus, this.plugin.state.taskDirectory, () => this.openQuickRecord()).open();
  }

  render(displayOnly = false): void {
    const root = this.contentEl;
    const existingShell = displayOnly ? root.querySelector<HTMLElement>(".wt-shell") : null;
    const endedOpen = root.querySelector<HTMLDetailsElement>(".wt-ended-section")?.open ?? false;
    const optionsOpen = root.querySelector<HTMLDetailsElement>('.wt-board-options')?.open ?? false;
    const taskPane = root.querySelector<HTMLElement>(".wt-task-column");
    const taskScrollTop = taskPane?.clientHeight ? taskPane.scrollTop : this.taskScrollTop;
    const layoutScrollTop = root.querySelector(".wt-layout")?.scrollTop ?? 0;
    const timelineReading = existingShell ? undefined : this.captureTimelineReading();
    this.cardObserver?.disconnect();
    this.masonryCleanups.forEach(cleanup => cleanup());
    this.masonryCleanups = [];
    if (!existingShell) root.empty();
    root.addClass("work-timeline-view");
    root.classList.toggle('is-compact-cards', this.plugin.state.compactCards);
    const shell = existingShell ?? root.createDiv({ cls: "wt-shell" });
    shell.dataset.pane = this.narrowPane;
    shell.inert = this.plugin.storageBusy;
    shell.setAttr("aria-busy", String(this.plugin.storageBusy));
    const header = shell.querySelector<HTMLElement>(".wt-header");
    header?.empty();
    this.renderHeader(shell, header ?? undefined);
    if (!shell.querySelector('.wt-pane-switch')) {
      const panes = shell.createDiv({ cls: 'wt-pane-switch' });
      for (const [pane, label] of [['tasks', '任务看板'], ['history', '时间线']] as const) {
        const button = panes.createEl('button', { text: label, attr: { type: 'button', 'aria-pressed': String(this.narrowPane === pane) } });
        button.onclick = () => this.showPane(pane);
      }
    }
    const options = shell.querySelector<HTMLDetailsElement>('.wt-board-options');
    if (options) options.open = optionsOpen;
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
    if (!existingShell) {
      const history = layout.createEl('aside', { cls: 'wt-timeline-column', attr: { 'aria-label': this.selectedTaskId ? '任务历史' : '每日时间线' } });
      this.renderTimeline(history, timelineReading);
      history.createDiv({ cls: 'wt-history-foot', text: '记录按时间保留，变化有迹可循' });
    }
    tasks.scrollTop = taskScrollTop;
    layout.scrollTop = layoutScrollTop;
  }

  private showPane(pane: 'tasks' | 'history'): void {
    const tasks = this.contentEl.querySelector<HTMLElement>('.wt-task-column');
    if (tasks?.clientHeight) this.taskScrollTop = tasks.scrollTop;
    this.narrowPane = pane;
    this.render();
  }

  private openHistory(taskId: string | null): void {
    this.selectedTaskId = taskId;
    this.showPane('history');
  }

  private renderHeader(shell: HTMLElement, existingHeader?: HTMLElement): void {
    if (!['all', 'ungrouped', ...this.plugin.groups.map(group => group.id)].includes(this.boardFilter)) this.boardFilter = 'all';
    const header = existingHeader ?? shell.createEl("header", { cls: "wt-header" });
    const brand = header.createDiv({ cls: "wt-brand" });
    setIcon(brand.createSpan({ cls: "wt-brand-mark", attr: { "aria-hidden": "true" } }), 'workflow');
    const identity = brand.createDiv();
    identity.createEl("h1", { text: 'Tracelo' });
    const activeTasks = this.plugin.tasks.filter(({ status }) => status === "active");
    identity.createEl("p", { text: '工作时间线' });

    const viewTools = header.createDiv({ cls: "wt-view-tools", attr: { role: "group", "aria-label": "看板显示设置" } });
    const viewSwitch = viewTools.createDiv({ cls: "wt-view-switch", attr: { role: "group", "aria-label": "任务视图" } });
    for (const [mode, label] of [["group", "分组看板"], ["quadrant", "四象限"]] as const) {
      const button = viewSwitch.createEl("button", {
        text: label,
        cls: this.plugin.state.viewMode === mode ? "is-active" : "",
        attr: { type: "button", "aria-pressed": String(this.plugin.state.viewMode === mode) },
      });
      const mark = button.createSpan(); setIcon(mark, mode === 'group' ? 'columns-3' : 'grid-2x2'); button.prepend(mark);
      button.addEventListener("click", () => void runWithNotice(async () => {
        await this.plugin.setViewMode(mode);
        this.contentEl.querySelector<HTMLButtonElement>('.wt-view-switch button[aria-pressed="true"]')?.focus({ preventScroll: true });
      }));
    }

    viewTools.createSpan({ cls: 'wt-navigation-divider', attr: { 'aria-hidden': 'true' } });
    const filters = viewTools.createEl('nav', { cls: 'wt-group-navigation', attr: { 'aria-label': '按分组筛选任务' } });
    const groups = [{ id: 'all', name: '全部' }, ...this.plugin.groups, { id: 'ungrouped', name: UNGROUPED_TASKS }];
    groups.forEach((group, index) => {
      const count = group.id === 'all' ? activeTasks.length : activeTasks.filter(task => (task.groupId ?? 'ungrouped') === group.id).length;
      const button = filters.createEl('button', { cls: 'wt-group-tab', attr: { type:'button', 'data-group-id':group.id, 'aria-pressed':String(this.boardFilter === group.id), 'aria-label':`${group.name} ${count}` } });
      if (group.id !== 'all') {
        const dot = button.createSpan({ cls:'wt-group-dot', attr:{'aria-hidden':'true'} });
        dot.style.backgroundColor = group.id === 'ungrouped' ? 'var(--wt-muted)' : ['var(--wt-g1)','var(--wt-g2)','var(--wt-g3)'][(index - 1) % 3]!;
      }
      button.createSpan({ text:group.name }); button.createSpan({ cls:'wt-group-count', text:String(count) });
      button.onclick = () => {
        this.boardFilter = group.id; this.searchQuery = ''; this.searchTarget = undefined;
        this.selectedTaskId = null; this.narrowPane = 'tasks'; this.taskScrollTop = 0;
        const pane = this.contentEl.querySelector('.wt-task-column'); if (pane) pane.scrollTop = 0;
        this.render();
        this.contentEl.querySelector<HTMLButtonElement>('.wt-group-tab[aria-pressed="true"]')?.focus({preventScroll:true});
      };
    });
    const contextActions = viewTools.createDiv({ cls:'wt-context-actions' });
    const today = iconButton(contextActions, 'calendar-clock', '仅看今天截止');
    today.addClass('wt-due-filter'); today.setAttr('aria-pressed',String(this.dueTodayOnly));
    today.onclick = () => { this.dueTodayOnly = !this.dueTodayOnly; this.searchQuery = ''; this.render(); this.contentEl.querySelector<HTMLButtonElement>('.wt-due-filter')?.focus({preventScroll:true}); };
    const manage = contextActions.createEl('button', { cls:'wt-manage-groups', attr:{type:'button','aria-label':'管理分组',title:'管理分组'} });
    setIcon(manage.createSpan(),'folder-cog'); manage.createSpan({text:'管理分组'});
    manage.onclick = () => new GroupManagerModal(this.app, this.plugin).open();

    const actions = header.createDiv({ cls: "wt-header-actions", attr:{'aria-label':'全局工具'} });
    header.insertBefore(actions, viewTools);
    const calendar = iconButton(actions, 'calendar-days', '截止日历');
    calendar.addClass('wt-calendar-trigger');
    calendar.addEventListener('click', () => {
      const modal = new Modal(this.app);
      modal.setTitle('截止日历'); modal.modalEl.addClass('wt-modal'); modal.modalEl.addClass('wt-calendar-modal');
      let dispose: (() => void) | undefined;
      let navigating = false;
      modal.onOpen = () => {
        dispose = mountDeadlineCalendar(modal.contentEl, () => this.plugin.tasks, id => {
          navigating = true; modal.close(); this.selectedTaskId = id; this.narrowPane = 'history'; this.render();
          this.contentEl.querySelector<HTMLButtonElement>('.wt-back-button')?.focus();
        }, () => modal.close());
        modal.containerEl.addEventListener('click', event => { if (event.target === modal.containerEl || (event.target as HTMLElement).classList.contains('modal-bg')) modal.close(); });
      };
      modal.onClose = () => { dispose?.(); if (!navigating) requestAnimationFrame(() => this.contentEl.querySelector<HTMLButtonElement>('[aria-label="截止日历"]')?.focus({ preventScroll: true })); };
      modal.open();
    });
    const quick = iconButton(actions, 'zap', '快捷记录'); quick.onclick = () => this.openQuickRecord(); actions.insertBefore(quick, calendar);
    const more = actions.createEl('details', { cls: 'wt-board-options' });
    const summary = more.createEl('summary', { attr: { 'aria-label': '界面与工具设置' } }); setIcon(summary, 'settings-2');
    const tools = more.createDiv({ cls: 'wt-board-options-body' });
    this.plugin.renderAppearanceControls(tools);
    this.renderBoardControls(tools);
    tools.createEl('button', { text: '导入与导出', attr: { type: 'button' } }).onclick = () => { more.open = false; this.plugin.openTransfer(); };
    summary.onclick = event => {
      event.preventDefault();
      const modal = new Modal(this.app); modal.setTitle('界面与快捷工具'); modal.modalEl.addClass('wt-modal','wt-settings-modal');
      const body = modal.contentEl.createDiv({cls:'wt-settings-body'});
      const display = body.createEl('section', {cls:'wt-settings-section',attr:{'aria-label':'界面显示'}});
      display.createEl('h3',{text:'界面显示'});
      this.plugin.renderAppearanceControls(display);
      display.querySelectorAll('select').forEach(select => {
        const control = document.createElement('span'); control.className = 'wt-settings-select';
        select.before(control); control.append(select);
        setIcon(control.createSpan({attr:{'aria-hidden':'true'}}),'chevron-down');
      });
      const board = body.createEl('section', {cls:'wt-settings-section',attr:{'aria-label':'任务看板'}});
      board.createEl('h3',{text:'任务看板'});
      const compact = board.createEl('label', {cls:'wt-collection-setting'});
      const compactCopy = compact.createDiv(); compactCopy.createEl('strong',{text:'紧凑任务卡片'}); compactCopy.createEl('p',{text:'减少辅助内容，优先显示最新进展'});
      const compactToggle = compact.createEl('input',{type:'checkbox',attr:{'aria-label':'紧凑任务卡片'}}); compactToggle.checked = this.plugin.state.compactCards;
      compactToggle.onchange = () => void runWithNotice(async () => {
        const previous = this.plugin.state.compactCards; this.plugin.state.compactCards = compactToggle.checked;
        try { await this.plugin.persistState(); } catch(error) { this.plugin.state.compactCards = previous; compactToggle.checked = previous; throw error; }
        this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => { if (leaf.view instanceof WorkTimelineView) leaf.view.render(); });
      });
      this.renderBoardControls(board);
      const shortcuts = body.createEl('section', {cls:'wt-settings-section wt-settings-shortcuts',attr:{'aria-label':'桌面快捷键'}});
      shortcuts.createEl('h3',{text:'桌面快捷键'});
      for (const [label, key] of [['新建任务','Space'],['记录进展','P']]) {
        const row = shortcuts.createDiv({cls:'wt-settings-shortcut'}); row.createSpan({text:label});
        const keys = row.createSpan({cls:'wt-settings-keys',attr:{'aria-label':`Control + ${Platform.isWin ? 'Alt' : 'Option'} + ${key}`}});
        for (const text of [Platform.isWin ? 'Ctrl' : '⌃', Platform.isWin ? 'Alt' : '⌥', key!]) keys.createEl('kbd',{text,attr:{'aria-hidden':'true'}});
      }
      shortcuts.createEl('p',{cls:'wt-settings-help',text:'以上为默认快捷键，可在桌面工具设置中修改。'});
      const footer = modal.contentEl.createDiv({cls:'wt-settings-footer'});
      const transfer = footer.createEl('button', {cls:'wt-settings-transfer',attr:{type:'button'}});
      setIcon(transfer.createSpan({attr:{'aria-hidden':'true'}}),'arrow-right-left'); transfer.createSpan({text:'导入与导出'});
      transfer.onclick = () => { modal.close(); this.plugin.openTransfer(); };
      footer.createEl('button', {text:'完成', cls:'wt-primary-action',attr:{type:'button'}}).onclick = () => modal.close();
      modal.open();
    };
    more.addEventListener('keydown', event => { if (event.key === 'Escape') { more.open = false; summary.focus(); } });
    const create = contextActions.createEl("button", { cls: "wt-new-task-button", attr: { type: "button", "aria-label": "新建任务" } });
    setIcon(create, "plus");
    create.createSpan({ text: "新建任务" });
    create.addEventListener("click", () => this.openNewTask({}, create));
  }

  private openQuickRecord(): void {
    const modal = new Modal(this.app);
    modal.setTitle('Tracelo'); modal.modalEl.addClass('wt-modal', 'wt-quick-modal', 'wt-capture-dialog');
    const brand = modal.titleEl.createSpan({cls:'wt-capture-brand'}); setIcon(brand,'workflow'); modal.titleEl.prepend(brand);
    const tabs = modal.contentEl.createDiv({ cls: 'wt-capture-tabs' });
    const createTab = tabs.createEl('button', { attr: { type:'button', 'aria-pressed':'false' } });
    setIcon(createTab.createSpan(),'square-pen'); createTab.createSpan({text:'新建任务'}); createTab.onclick = () => { modal.close(); this.openNewTask(); };
    const progressTab = tabs.createEl('button', { attr: { type:'button', 'aria-pressed':'true' } });
    setIcon(progressTab.createSpan(),'message-square-plus'); progressTab.createSpan({text:'记录进展'});
    const content = modal.contentEl.createDiv({ cls: 'work-timeline-view wt-quick-progress' });
    const controller = mountQuickProgress(content, {
      setIcon, resize: () => {}, isWin: Platform.isWin, getLocation: () => this.plugin.state.taskDirectory,
      openSettings: () => this.plugin.openTransfer(),
      send: message => {
        if (message.action === 'progressDismiss' || message.action === 'progressComplete') modal.close();
        if (message.action === 'progressDraft') {
          this.plugin.state.quickDrafts[String(message.taskId)] = String(message.text);
          void this.plugin.persistState().catch(() => controller.setError('草稿未能保存，请保留窗口并重试'));
        }
        if (message.action === 'operation') {
          const operation = message.operation as QuickOperation;
          void this.plugin.submitQuickOperation(operation).then(() => controller.update({
            tasks: this.plugin.tasks.map(task => ({ markdown: serializeTaskMarkdown(task) })),
            receipts: [{ id:operation.id, status:'applied', message:'已写入任务' }],
          }), error => controller.update({ receipts:[{id:operation.id,status:'failed',message:String(error)}] }));
        }
        if (message.action === 'openTaskFolder') void runWithNotice(() => this.plugin.accessTaskFolder(String(message.taskId), true));
      },
    });
    controller.update({ groups:this.plugin.groups, tasks:this.plugin.tasks.map(task => ({markdown:serializeTaskMarkdown(task)})), progressDrafts:this.plugin.state.quickDrafts });
    modal.open(); controller.show();
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
    this.contentEl.querySelector('.wt-header-actions')?.prepend(search);
    let composing = false;
    const updateSearch = () => {
      if (composing || !input.isConnected || this.searchQuery === input.value) return;
      this.searchQuery = input.value;
      this.searchTarget = undefined;
      const cursor = input.selectionStart ?? input.value.length;
      this.render();
      const next = this.contentEl.querySelector<HTMLInputElement>(".wt-search input");
      next?.focus();
      next?.setSelectionRange(cursor, cursor);
    };
    // Replacing the input while the IME owns it cancels candidate selection.
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => {
      composing = false;
      updateSearch();
    });
    input.addEventListener("input", event => {
      if (!(event as InputEvent).isComposing) updateSearch();
    });

    if (this.searchQuery.trim()) {
      this.renderSearchResults(container);
      return;
    }

    const matches = searchTasks(this.plugin.tasks, this.searchQuery).filter(task =>
      (this.boardFilter === 'all' || (task.groupId ?? 'ungrouped') === this.boardFilter) && (!this.dueTodayOnly || task.dueDate === dayKey(new Date())));
    const sections = this.plugin.state.viewMode === "group"
      ? groupTasks(matches, this.plugin.groups, this.plugin.state.orders.group)
      : quadrantTasks(matches, this.plugin.state.orders.quadrant);
    const board = container.createDiv({ cls: `wt-board is-${this.plugin.state.viewMode}${this.boardFilter !== 'all' ? ' is-filtered-group' : ''}` });
    if (this.dueTodayOnly && !matches.some(task => task.status === 'active')) {
      const empty = container.createEl('p', { text: '今天没有到期的进行中任务。', cls: 'wt-filter-empty', attr: { role: 'status' } });
      board.before(empty);
    }
    board.style.setProperty("zoom", String(zoom / 100));
    for (const section of sections) {
      if (this.plugin.state.viewMode === 'group' && this.boardFilter === 'all' && section.id === null && !section.tasks.length && this.plugin.groups.length >= 3) continue;
      if (this.plugin.state.viewMode === 'group' && this.boardFilter !== 'all' && (section.id ?? 'ungrouped') !== this.boardFilter) continue;
      this.renderSection(board, section);
    }

    const ended = matches.filter(isTaskEnded).sort((left, right) =>
      (right.events.at(-1)?.at ?? "").localeCompare(left.events.at(-1)?.at ?? ""),
    );
    const endedSection = container.createEl("details", { cls: "wt-ended-section" });
    endedSection.style.setProperty("zoom", String(zoom / 100));
    const summary = endedSection.createEl("summary");
    summary.createSpan({ text: "已结束" });
    summary.createSpan({ text: `已完成 ${ended.filter(({ status }) => status === "completed").length} · 异常关闭 ${ended.filter(({ status }) => status === "closed").length}` });
    summary.onclick = event => {
      event.preventDefault();
      const modal = new Modal(this.app); modal.setTitle('已结束的任务'); modal.modalEl.addClass('wt-modal','wt-archive-modal');
      const renderArchive = () => {
        modal.contentEl.empty();
        modal.contentEl.createEl('p',{text:'完成和关闭的任务保留详情与历史。',cls:'wt-settings-help'});
        const tasks = this.plugin.tasks.filter(isTaskEnded).sort((a,b)=>(b.events.at(-1)?.at ?? '').localeCompare(a.events.at(-1)?.at ?? ''));
        if (!tasks.length) modal.contentEl.createEl('p',{text:'暂无已结束任务',cls:'wt-empty'});
        for (const task of tasks) {
          const row = modal.contentEl.createDiv({cls:'wt-archive-row'}); setIcon(row.createSpan(),task.status === 'completed' ? 'circle-check' : 'circle-x');
          const copy = row.createDiv();
          const title = copy.createEl('button',{text:task.title,attr:{type:'button','aria-label':`查看已结束任务：${task.title}`}});
          title.onclick = () => {
            modal.close(); this.boardFilter = 'all'; this.dueTodayOnly = false; this.searchQuery = ''; this.narrowPane = 'tasks'; this.render();
            const section = this.contentEl.querySelector<HTMLDetailsElement>('.wt-ended-section'); if(section) section.open = true;
            requestAnimationFrame(() => { const card = this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${task.id}"]`); card?.scrollIntoView({block:'nearest'}); card?.querySelector<HTMLElement>('.wt-card-open')?.focus({preventScroll:true}); });
          };
          copy.createEl('small',{text:`${task.status === 'completed' ? '已完成' : '异常关闭'} · ${formatDay(task.events.at(-1)!.day)}`});
          const restore = row.createEl('button',{text:'重新打开',attr:{type:'button','aria-label':`重新打开：${task.title}`}});
          restore.onclick = () => void runWithNotice(async () => { restore.disabled = true; try { await this.plugin.reopenTask(task.id); renderArchive(); } finally {restore.disabled = false;} });
        }
        modal.contentEl.createEl('button',{text:'完成',cls:'wt-primary-action',attr:{type:'button'}}).onclick = () => modal.close();
      };
      renderArchive(); modal.open();
    };
    const endedGrid = endedSection.createDiv({ cls: "wt-card-grid" });
    if (!ended.length) endedGrid.createEl("p", { text: "暂无已结束任务", cls: "wt-empty" });
    for (const task of ended) this.renderCard(endedGrid, task, "ended");
    const history = container.createEl('button', { text: '全部进展', cls: 'wt-all-history', attr: { type: 'button' } });
    history.onclick = () => this.openHistory(null);
  }

  private clearSearch(): void {
    this.searchQuery = '';
    this.searchTarget = undefined;
    this.render();
    this.contentEl.querySelector<HTMLInputElement>('.wt-search input')?.focus();
  }

  private renderSearchResults(container: HTMLElement): void {
    const results = this.plugin.tasks.map(task => ({ task, matches: findTaskMatches(task, this.searchQuery) })).filter(result => result.matches.length);
    const summary = container.createDiv({ cls: 'wt-search-summary' });
    summary.createSpan({ text: `${results.length} 个任务匹配 · 包含已结束任务`, attr: { role: 'status' } });
    summary.createEl('button', { text: '清除搜索', attr: { type: 'button' } }).onclick = () => this.clearSearch();
    if (!results.length) {
      const empty = container.createDiv({ cls: 'wt-search-empty', attr: { role: 'status' } });
      empty.createEl('h3', { text: `未找到“${this.searchQuery.trim()}”的相关记录` });
      empty.createEl('p', { text: '已搜索全部任务的当前名称、详情、历史名称和进展。试试更短的关键词，或清除搜索查看全部任务。' });
    }
    for (const { task, matches } of results) {
      const result = container.createEl('section', { cls: 'wt-search-result' });
      result.createEl('h3', { text: task.title });
      result.createEl('p', { cls: 'wt-search-result-meta', text: `${task.groupName} · ${task.status === 'active' ? '进行中' : task.status === 'completed' ? '已完成' : '异常关闭'} · ${matches.length} 处匹配` });
      let extra: HTMLElement | undefined;
      matches.forEach((match, index) => {
        if (index === 3) {
          extra = result.createEl('details', { cls: 'wt-search-more' });
          extra.createEl('summary', { text: `显示其余 ${matches.length - 3} 处匹配` });
        }
        const button = (extra ?? result).createEl('button', { cls: 'wt-search-match', attr: { type: 'button' } });
        const label = { title: '当前名称', notes: '当前详情', progress: '进展', 'historical-title': '历史名称' }[match.source];
        button.createSpan({ cls: 'wt-search-source', text: `${label}${match.day ? ` · ${match.day}` : ''} · ${match.eventId ? '查看原记录' : '查看任务'}` });
        this.renderSearchText(button.createSpan({ cls: 'wt-search-excerpt' }), match.text);
        button.onclick = () => this.openSearchMatch(task, match);
      });
    }
  }

  private renderSearchText(container: HTMLElement, text: string): void {
    const excerpt = searchExcerpt(text, this.searchQuery);
    container.append(excerpt.before);
    if (excerpt.match) container.createEl('mark', { text: excerpt.match });
    container.append(excerpt.after);
  }

  private openSearchMatch(task: WorkTask, match: TaskMatch): void {
    this.selectedTaskId = task.id;
    if (!match.eventId) {
      this.boardFilter = 'all';
      this.dueTodayOnly = false;
      this.expandedTaskId = task.id;
      this.searchQuery = '';
      this.searchTarget = undefined;
      this.narrowPane = 'tasks';
      this.render();
      const ended = this.contentEl.querySelector<HTMLDetailsElement>('.wt-ended-section');
      if (ended && isTaskEnded(task)) ended.open = true;
      const card = Array.from(this.contentEl.querySelectorAll<HTMLElement>('.wt-card')).find(el => el.dataset.taskId === task.id);
      const target = card?.querySelector<HTMLElement>(match.source === 'notes' ? '.wt-notes-preview' : '.wt-card-open');
      if (target) {
        if (match.source === 'notes') target.tabIndex = -1;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    this.searchTarget = { eventId: match.eventId, query: this.searchQuery };
    this.showPane('history');
    this.render();
    const target = Array.from(this.contentEl.querySelectorAll<HTMLElement>('[data-event-id]')).find(el => el.dataset.eventId === match.eventId);
    const body = target?.closest<HTMLElement>('.wt-timeline-scroll');
    if (target && body) {
      target.tabIndex = -1;
      target.classList.add('is-search-target');
      target.focus({ preventScroll: true });
      body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
    }
  }

  private renderBoardControls(shell: HTMLElement): void {
    const controls = shell.createDiv({ cls: "wt-board-controls" });
    const group = controls.createDiv({ cls: "wt-zoom-controls", attr: { role: "group", "aria-label": "看板缩放" } });
    group.createSpan({ text: "看板缩放", cls: "wt-zoom-label", attr: { "aria-hidden": "true" } });
    const stepper = group.createDiv({ cls: "wt-zoom-stepper" });
    const zoom = this.plugin.state.boardZoom;
    const changeZoom = (value: number, selector: string) => runWithNotice(async () => {
      await this.plugin.setBoardZoom(value);
      const scope = shell.closest('.wt-settings-modal') ? shell : this.contentEl;
      if (scope === shell) {
        smaller.disabled = this.plugin.state.boardZoom <= 60; larger.disabled = this.plugin.state.boardZoom >= 120;
        reset.textContent = `${this.plugin.state.boardZoom}%`;
      }
      const target = scope.querySelector<HTMLButtonElement>(selector);
      (target?.disabled ? scope.querySelector<HTMLButtonElement>(".wt-zoom-reset") : target)?.focus({ preventScroll: true });
    });
    const smaller = iconButton(stepper, "minus", "缩小看板", "wt-icon-button wt-zoom-out");
    smaller.disabled = zoom <= 60;
    smaller.title = "缩小看板（每次 5%）";
    smaller.onclick = () => void changeZoom(this.plugin.state.boardZoom - 5, ".wt-zoom-out");
    const reset = stepper.createEl("button", {
      text: `${zoom}%`, cls: "wt-zoom-reset",
      attr: { type: "button", "aria-label": "恢复看板缩放为100%", "aria-description": `当前缩放 ${zoom}%`, title: `当前 ${zoom}%，点击恢复 100%` },
    });
    reset.onclick = () => void changeZoom(100, ".wt-zoom-reset");
    const larger = iconButton(stepper, "plus", "放大看板", "wt-icon-button wt-zoom-in");
    larger.disabled = zoom >= 120;
    larger.title = "放大看板（每次 5%）";
    larger.onclick = () => void changeZoom(this.plugin.state.boardZoom + 5, ".wt-zoom-in");
  }

  private renderSection(container: HTMLElement, section: TaskGroup): void {
    const area = section.id ?? "ungrouped";
    const wrapper = container.createEl("section", {
      cls: `wt-task-section${this.plugin.state.viewMode === "quadrant" ? ` is-${area}` : ""}`,
      attr: { "data-area": area, "aria-label": section.name },
    });
    const heading = wrapper.createDiv({ cls: "wt-section-heading" });
    const index = section.id ? Math.max(0, this.plugin.groups.findIndex(group => group.id === section.id)) : this.plugin.groups.length;
    const quadrantStyle: Record<string, [string, string]> = { important_urgent: ['red', 'flame'], important_not_urgent: ['accent', 'flag'], not_important_urgent: ['warning', 'timer'], not_important_not_urgent: ['muted', 'coffee'] };
    const quadrant = this.plugin.state.viewMode === 'quadrant' ? quadrantStyle[area] : undefined;
    wrapper.style.setProperty('--wt-group', `var(--wt-${quadrant?.[0] ?? `g${index % 3 + 1}`})`);
    const groupIcon = heading.createSpan({ cls: 'wt-group-icon' });
    if (quadrant) setIcon(groupIcon, quadrant[1]!);
    else setContentIcon(groupIcon, this.plugin.groups.find(group => group.id === section.id)?.icon ?? ['briefcase-business', 'code-2', 'coffee'][index % 3]!);
    heading.createEl("h3", { text: section.name });
    heading.createSpan({ text: String(section.tasks.length) });
    const add = iconButton(heading, 'plus', `向${section.name}添加任务`);
    const grid = wrapper.createDiv({ cls: "wt-card-grid" });
    grid.addEventListener("dragover", (event) => { event.preventDefault(); grid.addClass("is-drag-over"); });
    grid.addEventListener("dragleave", () => grid.removeClass("is-drag-over"));
    grid.addEventListener("drop", (event) => {
      event.preventDefault();
      grid.removeClass("is-drag-over");
      const taskId = event.dataTransfer?.getData("text/plain");
      if (taskId) void runWithNotice(() => this.plugin.dropTask(taskId, this.plugin.state.viewMode, area, null));
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
    add.onclick = () => this.openNewTask(context, add);
  }

  private renderCard(container: HTMLElement, task: WorkTask, area: string): void {
    const view = this;
    renderTaskCard({
      plugin: this.plugin, contentEl: this.contentEl, editingNotes: this.editingNotes, openCompletedTodos: this.openCompletedTodos,
      get selectedTaskId() { return view.selectedTaskId; }, set selectedTaskId(value) { view.selectedTaskId = value; },
      get expandedTaskId() { return view.expandedTaskId; }, set expandedTaskId(value) { view.expandedTaskId = value; },
      get addingTodoTaskId() { return view.addingTodoTaskId; }, set addingTodoTaskId(value) { view.addingTodoTaskId = value; },
      get recordedTaskId() { return view.recordedTaskId; }, set recordedTaskId(value) { view.recordedTaskId = value; },
      setIcon, iconButton, notice: (message, duration) => new Notice(message, duration),
      prompt: (heading, initial, placeholder, multiline, submit) => new TextPromptModal(this.app, heading, initial, placeholder, multiline, submit).open(),
      showTaskMenu: (event, task) => this.showTaskMenu(event, task), openDueDate: task => this.openDueDate(task),
      collapseCard: id => this.collapseCard(id), focusCard: id => this.focusCard(id, true), render: () => this.render(),
      renderNotes: (body, task) => this.renderNotes(body, task),
      openHistory: task => this.openHistory(task.id),
      completeTask: task => this.confirmComplete(task),
    }, container, task, area);
  }

  private confirmComplete(task: WorkTask): void {
    const finish = async () => {
      await this.plugin.finishTask(task.id);
      const notice = new Notice('任务已完成', 8000);
      const undo = notice.messageEl.createEl('button', { text: '撤销', cls: 'wt-undo-button' });
      undo.onclick = () => void runWithNotice(async () => { await this.plugin.reopenTask(task.id); notice.hide(); });
    };
    const remaining = task.todos?.filter(todo => !todo.done).length ?? 0;
    if (remaining) new CompleteTaskModal(this.app, remaining, finish).open();
    else void runWithNotice(finish);
  }

  private collapseCard(taskId: string): void {
    this.expandedTaskId = null;
    this.selectedTaskId = null;
    this.addingTodoTaskId = null;
    this.render();
    this.focusCard(taskId);
  }

  private focusCard(taskId: string, composer = false): void {
    requestAnimationFrame(() => {
      const card = this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${taskId}"]`);
      card?.querySelector<HTMLElement>(composer ? '.wt-card-composer textarea' : '.wt-card-open')?.focus({ preventScroll: true });
      const title = card?.querySelector('.wt-card-heading')?.getBoundingClientRect();
      const pane = this.contentEl.querySelector('.wt-task-column')?.getBoundingClientRect();
      if (title && pane && title.top < pane.top) card?.scrollIntoView({ block: 'start' });
    });
  }

  private openNotes(task: WorkTask): void {
    this.selectedTaskId = task.id;
    this.expandedTaskId = task.id;
    this.editingNotes.add(task.id);
    this.render();
    this.contentEl.querySelector<HTMLTextAreaElement>(`.wt-card[data-task-id="${task.id}"] .wt-notes-editor textarea`)?.focus({ preventScroll: true });
  }

  private renderNotes(body: HTMLElement, task: WorkTask): void {
    const edit = this.editingNotes.has(task.id);
    const pending = Object.prototype.hasOwnProperty.call(this.plugin.state.noteDrafts, task.id);
    if (!task.notes && !pending && !edit) return;
    const section = body.createDiv({ cls: "wt-task-notes" });
    if (pending && !edit) section.createSpan({ text: '详情有未保存内容', cls: 'wt-notes-draft-status', attr: { role: 'status' } });
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
          modal.modalEl.addClass("wt-modal");
          modal.setTitle("详情图片");
          const image = modal.contentEl.createEl("img", { attr: { src: event.target.src, alt: event.target.alt || "详情图片" } });
          image.style.cssText = "max-width:100%;max-height:80vh;object-fit:contain";
          modal.open();
        });
      }
      return;
    }
    const form = section.createEl("form", { cls: "wt-notes-editor" });
    const input = form.createEl("textarea", { attr: { "aria-label": "任务详情", rows: "6", placeholder: "补充任务背景、链接或说明…" } });
    input.value = this.plugin.state.noteDrafts[task.id] ?? task.notes ?? "";
    const remember = () => this.plugin.updateNoteDraft(task.id, input.value);
    input.oninput = remember;
    form.createDiv({ cls: 'wt-notes-help', text: '支持 Markdown · 可粘贴或拖入图片' });
    const status = form.createDiv({ cls: 'wt-notes-status', attr: { role: "status", 'aria-live': 'polite' } });
    const actions = form.createDiv({ cls: "wt-notes-actions" });
    const upload = actions.createEl("input", { type: "file", attr: { accept: "image/*", multiple: "", "aria-label": "插入详情图片" } });
    upload.hidden = true;
    const insert = actions.createEl('button', { cls: 'wt-notes-insert', attr: { type: 'button' } });
    setIcon(insert, 'image'); insert.createSpan({ text: '插入图片' });
    insert.onclick = () => upload.click();
    const group = actions.createDiv({ cls: 'wt-notes-save-actions' });
    let uploading = false, saving = false;
    const insertFiles = async (files: File[]) => {
      if (uploading || saving) return;
      uploading = true; submit.disabled = true; input.disabled = true;
      this.uploadingNoteForms.set(task.id, form);
      insert.disabled = true; status.setText("正在插入图片…");
      try {
        for (const file of files.filter(file => file.type.startsWith('image/'))) {
          const path = await this.plugin.addNoteAttachment(task.id, file.name || '截图.png', await file.arrayBuffer());
          const start = input.selectionStart;
          const value = `![${file.name.replace(/[\[\]\\]/g, '') || '截图'}](<${path}>)`;
          input.setRangeText(value, start, input.selectionEnd, 'end'); remember();
        }
        status.setText("图片已插入，请保存详情");
      } catch (reason) { status.setText(`上传失败：${reason instanceof Error ? reason.message : String(reason)}`); }
      finally { this.uploadingNoteForms.delete(task.id); uploading = false; insert.disabled = false; submit.disabled = false; input.disabled = false; upload.value = ''; }
    };
    upload.onchange = () => void insertFiles(Array.from(upload.files ?? []));
    input.addEventListener('paste', event => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.some(file => file.type.startsWith('image/'))) { event.preventDefault(); void insertFiles(files); }
    });
    form.addEventListener('dragover', event => event.preventDefault());
    form.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); void insertFiles(Array.from(event.dataTransfer?.files ?? [])); });
    const cancel = group.createEl("button", { text: "取消", cls: 'wt-secondary-action', attr: { type: "button" } });
    cancel.onclick = () => { if (uploading || saving) return; this.editingNotes.delete(task.id); this.plugin.clearNoteDraft(task.id); this.render(); this.focusCard(task.id); };
    const submit = group.createEl("button", { text: "保存详情", cls: 'wt-primary-action', attr: { type: "submit" } });
    form.onsubmit = async event => {
      event.preventDefault(); if (uploading || saving) return;
      saving = true; remember(); submit.disabled = cancel.disabled = input.disabled = insert.disabled = true; status.setText("保存中…");
      try {
        await this.plugin.saveTaskNotes(task.id, input.value);
        this.editingNotes.delete(task.id); this.render(); this.focusCard(task.id);
      } catch (reason) { saving = false; status.setText(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`); submit.disabled = cancel.disabled = input.disabled = insert.disabled = false; }
    };
  }

  private openDueDate(task: WorkTask): void {
    new DueDateModal(this.app, task.dueDate, (date) => this.plugin.setTaskDueDate(task.id, date)).open();
  }



  private openIconPicker(task: WorkTask): void {
    new IconPickerModal(this.app, '卡片图标', task.icon, icon => this.plugin.changeTaskIcon(task.id, icon), {
      inheritedIcon: this.plugin.groups.find(group => group.id === task.groupId)?.icon ?? 'circle-dot',
      returnFocus: () => this.contentEl.querySelector<HTMLElement>(`.wt-card[data-task-id="${task.id}"] .wt-card-menu`)?.focus({ preventScroll: true }),
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
    const hasNotes = Boolean(task.notes) || Object.prototype.hasOwnProperty.call(this.plugin.state.noteDrafts, task.id);
    menu.addItem(item => item.setTitle(hasNotes ? '编辑详情' : '添加详情').setIcon('file-pen-line').onClick(() => this.openNotes(task)));
    if (task.status === 'active') {
      menu.addItem(item => item.setTitle('记录进展').setIcon('message-square-plus').onClick(() => {
        this.selectedTaskId = task.id; this.expandedTaskId = task.id; this.render(); this.focusCard(task.id, true);
      }));
      menu.addItem(item => item.setTitle('添加待办').setIcon('list-plus').onClick(() => {
        this.selectedTaskId = task.id; this.expandedTaskId = task.id; this.addingTodoTaskId = task.id; this.render();
        this.contentEl.querySelector<HTMLInputElement>(`.wt-card[data-task-id="${task.id}"] .wt-add-todo input`)?.focus();
      }));
    }
    menu.addSeparator();
    menu.addItem(item => {
      const groups = submenuFor(item.setTitle('分组').setIcon('folder'));
      for (const group of [...this.plugin.groups, { id: '', name: UNGROUPED_TASKS }]) {
        groups.addItem(choice => choice.setTitle(group.name)
          .setChecked((task.groupId ?? '') === group.id)
          .onClick(() => void runWithNotice(() => this.plugin.changeGroup(task.id, group.id || null))));
      }
    });
    menu.addItem(item => {
      const quadrants = submenuFor(item.setTitle('象限').setIcon('layout-grid'));
      for (const quadrant of QUADRANTS) {
        quadrants.addItem(choice => choice.setTitle(quadrant.name)
          .setChecked(quadrantId(task) === quadrant.id)
          .onClick(() => void runWithNotice(() => this.plugin.changeQuadrant(task.id, quadrant.id))));
      }
    });
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
      menu.addItem((item) => item.setTitle("重新打开").setIcon("rotate-ccw").onClick(() => void runWithNotice(() => this.plugin.reopenTask(task.id))));
    }
    menu.showAtMouseEvent(event);
  }

  private renderTimeline(container: HTMLElement, reading?: TimelineReading): void {
    const task = this.selectedTaskId ? this.plugin.tasks.find(({ id }) => id === this.selectedTaskId) : undefined;
    const header = container.createDiv({ cls: `wt-timeline-header${task ? " is-task-history" : ""}` });
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
      back.addEventListener("click", () => {
        this.selectedTaskId = null;
        this.render();
        this.contentEl.querySelector<HTMLInputElement>('.wt-date-controls input')?.focus({ preventScroll: true });
      });
      const body = container.createDiv({ cls: "wt-timeline-scroll", attr: { "data-timeline-key": `task:${task.id}`, tabindex: "-1", "aria-label": "任务历史" } });
      const stream = body.createDiv({ cls: "wt-event-stream" });
      for (const section of eventsByDay(task.events).reverse()) {
        const day = stream.createEl("section", { cls: "wt-timeline-day" });
        day.createEl("h3", { text: formatDay(section.day) });
        this.renderEvents(day, section.events, false);
      }
      if (!task.events.length) body.createEl("p", { text: "这个任务还没有记录", cls: "wt-empty" });
      this.restoreTimelineReading(body, reading);
      return;
    }

    const title = header.createDiv();
    title.createSpan({ text: "每日时间线", cls: "wt-eyebrow" });
    title.createEl("h2", { text: formatDay(this.selectedDay) });
    const controls = header.createDiv({ cls: "wt-date-controls" });
    const shiftDay = (delta: number, label: string): void => {
      const date = new Date(`${this.selectedDay}T12:00:00`);
      date.setDate(date.getDate() + delta);
      this.selectedDay = dayKey(date);
      this.render();
      this.contentEl.querySelector<HTMLButtonElement>(`.wt-date-controls button[aria-label="${label}"]`)?.focus({ preventScroll: true });
    };
    iconButton(controls, "chevron-left", "前一天").addEventListener("click", () => shiftDay(-1, "前一天"));
    const date = controls.createEl("input", { type: "date", attr: { "aria-label": "选择时间线日期" } });
    date.value = this.selectedDay;
    date.addEventListener("change", () => {
      if (date.value) {
        this.selectedDay = date.value;
        this.render();
        this.contentEl.querySelector<HTMLInputElement>('.wt-date-controls input')?.focus({ preventScroll: true });
      }
    });
    iconButton(controls, "chevron-right", "后一天").addEventListener("click", () => shiftDay(1, "后一天"));
    const today = controls.createEl("button", { text: "今天", attr: { type: "button", "aria-label": "今天" } });
    today.disabled = this.selectedDay === dayKey(new Date());
    today.addEventListener("click", () => {
      this.selectedDay = dayKey(new Date());
      this.render();
      this.contentEl.querySelector<HTMLInputElement>('.wt-date-controls input')?.focus({ preventScroll: true });
    });
    const week = header.createDiv({ cls: 'wt-week', attr: { 'aria-label': '本周日期' } });
    const monday = new Date(`${this.selectedDay}T12:00:00`);
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday); day.setDate(day.getDate() + i);
      const key = dayKey(day);
      const button = week.createEl('button', { cls: key === this.selectedDay ? 'is-active' : '', attr: { type: 'button', 'aria-label': key, 'aria-pressed': String(key === this.selectedDay) } });
      button.createSpan({ text: ['一','二','三','四','五','六','日'][i] }); button.createEl('b', { text: String(day.getDate()) });
      button.onclick = () => { this.selectedDay = key; this.render(); this.contentEl.querySelector<HTMLButtonElement>(`.wt-week button[aria-label="${key}"]`)?.focus(); };
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
    const body = container.createDiv({ cls: "wt-timeline-scroll", attr: { "data-timeline-key": `day:${this.selectedDay}`, tabindex: "-1", "aria-label": "每日记录" } });
    const entries = eventsForDay(this.plugin.tasks, this.selectedDay);
    if (!entries.length) body.createEl("p", { text: "这一天还没有记录", cls: "wt-empty" });
    this.renderEventStream(body.createDiv({ cls: "wt-event-stream" }), entries, true);
    this.restoreTimelineReading(body, reading);
  }

  private renderEvents(container: HTMLElement, events: TaskEvent[], showTask: boolean): void {
    this.renderEventStream(container, events.map(event => ({ event })), showTask);
  }

  private renderEventStream(container: HTMLElement, entries: { event: TaskEvent; taskId?: string }[], showTask: boolean): void {
    const list = container.createEl("ol", { cls: "wt-event-list" });
    for (const { event, taskId } of [...entries].reverse()) {
      this.renderEvent(list, event, showTask, taskId);
    }
  }

  private renderEvent(list: HTMLElement, event: TaskEvent, showTask: boolean, taskId?: string): void {
    const muted = isPropertyEvent(event);
    const item = list.createEl("li", { cls: `is-${event.kind}${muted ? " is-muted" : ""}`, attr: { "data-event-id": event.id } });
    if (event.kind === "completed") {
      const mark = item.createSpan({ cls: "wt-event-completed", attr: { "aria-hidden": "true" } });
      setIcon(mark, "check");
    }
    const body = item.createDiv({ cls: "wt-event-body" });
    const meta = body.createDiv({ cls: "wt-event-meta" });
    meta.createEl("time", { text: formatTime(event.at), attr: { datetime: event.at } });
    meta.createSpan({ text: EVENT_LABELS[event.kind], cls: "wt-event-kind" });
    if (showTask && taskId) {
      const link = body.createEl("button", { text: event.title, cls: "wt-event-task", attr: { type: "button" } });
      link.addEventListener("click", () => {
        this.selectedTaskId = taskId;
        this.render();
        this.contentEl.querySelector<HTMLButtonElement>('.wt-back-button')?.focus({ preventScroll: true });
      });
    }
    const text = body.createEl("p", { cls: "wt-event-text" });
    if (this.searchTarget?.eventId === event.id) {
      const value = event.kind === 'progress' ? event.text : `${event.title} · ${event.text}`;
      const query = this.searchTarget.query.trim();
      const start = value.toLocaleLowerCase('zh-CN').indexOf(query.toLocaleLowerCase('zh-CN'));
      if (start >= 0) {
        text.append(value.slice(0, start));
        text.createEl('mark', { text: value.slice(start, start + query.length) });
        text.append(value.slice(start + query.length));
      } else text.setText(value);
    } else if (event.kind === 'progress' && /!\[[^\]]*\]\(/.test(event.text)) {
      const task = this.plugin.tasks.find(task => task.id === (taskId ?? this.selectedTaskId));
      if (task) void MarkdownRenderer.render(this.app, event.text, text, this.plugin.taskArchivePath(task.id), this).catch(() => text.setText(event.text));
      else text.setText(event.text);
    } else text.setText(event.text);
  }

  private captureTimelineReading(): TimelineReading | undefined {
    const body = this.contentEl.querySelector<HTMLElement>(".wt-timeline-scroll");
    if (!body) return undefined;
    if (!body.clientHeight) return this.hiddenTimelineReading;
    const items = Array.from(body.querySelectorAll<HTMLElement>("[data-event-id]"));
    const top = body.getBoundingClientRect().top;
    const anchor = items.find(item => item.getBoundingClientRect().bottom > top);
    return {
      key: body.dataset.timelineKey ?? "",
      top: body.scrollTop,
      nearStart: body.scrollTop <= 48,
      eventIds: new Set(items.map(item => item.dataset.eventId!)),
      anchorId: anchor?.dataset.eventId,
      anchorOffset: anchor ? anchor.getBoundingClientRect().top - top : 0,
      pendingProgress: !!body.parentElement?.querySelector(".wt-new-progress"),
    };
  }

  private restoreTimelineReading(body: HTMLElement, reading?: TimelineReading): void {
    if (!body.clientHeight) {
      this.hiddenTimelineReading = reading;
      return;
    }
    // Read the previous DOM before replacement, then restore synchronously so a
    // later animation frame cannot override a user's scroll or another render.
    if (!reading || reading.key !== body.dataset.timelineKey) {
      body.scrollTop = 0;
      return;
    }
    const items = Array.from(body.querySelectorAll<HTMLElement>("[data-event-id]"));
    const newActivity = items.some(item => !item.classList.contains("is-muted") && !reading.eventIds.has(item.dataset.eventId!));
    if (newActivity && reading.nearStart) {
      body.scrollTop = 0;
      return;
    }
    const anchor = items.find(item => item.dataset.eventId === reading.anchorId);
    body.scrollTop = anchor
      ? body.scrollTop + anchor.getBoundingClientRect().top - body.getBoundingClientRect().top - reading.anchorOffset
      : reading.top;
    if (!reading.nearStart && (newActivity || reading.pendingProgress)) {
      const button = body.parentElement!.createEl("button", { cls: "wt-new-progress", attr: { type: "button", "aria-label": "有新进展" } });
      button.createSpan({ text: "有新进展", attr: { role: "status" } });
      setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), "arrow-up");
      button.addEventListener("click", () => {
        body.focus({ preventScroll: true });
        body.scrollTop = 0;
        button.remove();
      });
      body.addEventListener("scroll", () => {
        if (body.scrollTop <= 48) button.remove();
      }, { passive: true });
    }
  }
}

class WorkTimelineSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly timeline: WorkTimelinePlugin) {
    super(app, timeline);
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: this.timeline.manifest.name });
    this.timeline.renderAppearanceControls(this.containerEl);
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
      .setName("桌面快捷创建")
      .setDesc("macOS 菜单栏／Windows 托盘程序使用同一新建表单，默认 Control+Option/Alt+Space。请在快捷程序设置中选择当前仓库，并填写下方任务目录；迁移目录后也需同步更新快捷程序。无需让 Obsidian 保持打开。");
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
    this.applyAppearance();
    await this.publishAppearance().catch(() => new Notice('快捷工具主题暂未同步，插件主题已生效'));
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
    const quickTimer = window.setInterval(() => { void this.processQuickOperations().catch(() => {}); }, 1500);
    this.register(() => window.clearInterval(quickTimer));
    void this.processQuickOperations().catch(() => {});
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
    delete document.body.dataset.traceloTheme;
    delete document.body.dataset.traceloAppearance;
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
      if (input.creationId && this.tasks.some(task => task.id === input.creationId)) return input.creationId;
      const prepared = prepareImages(input.notes ?? '', input.images ?? []);
      const task = buildNewTask({ ...input, notes: prepared.notes }, new Date(), makeId);
      if (prepared.attachments.length) await this.store.createTaskWithAttachments(task, prepared.attachments);
      else await this.persistTask(task);
      this.tasks = [...this.tasks, task];
      this.state.orders = pinTask(this.state.orders, task);
      // The archive is the commit point. A preference failure must not invite
      // retrying creation after the task has already been safely written.
      try { await this.persistState(); }
      catch { new Notice("任务已创建，但排序偏好未保存；无需重复创建。请检查存储空间或权限。"); }
      this.renderViews();
      return task.id;
    });
  }

  async processQuickOperations(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const directory = `${this.state.taskDirectory}/${QUICK_DIRECTORY}`;
    if (!await adapter.exists(directory)) return;
    for (const path of (await adapter.list(directory)).files.filter(path => path.endsWith('.request.json')).sort()) {
      await this.enqueueWrite(async () => {
        if (`${this.state.taskDirectory}/${QUICK_DIRECTORY}` !== directory) return;
        const receipt = path.replace(/\.request\.json$/, '.result.json');
        if (await adapter.exists(receipt)) return;
        let op: QuickOperation;
        try { op = JSON.parse(await adapter.read(path)); }
        catch { return; } // Incomplete external files are retried after atomic publication.
        let result: { status: string; message: string };
        try {
          if (!op.id || path !== `${directory}/${op.id}.request.json`) throw Error('操作身份与文件名不匹配');
          const current = this.requireTask(op.taskId);
          const images = await decodeQuickImages(op);
          if (op.attachments) op = { ...op, attachments: op.attachments.map((image,i) => ({ ...image, sha256: images[i]!.sha256 })) };
          const next = applyQuickOperation(current, op, this.groups);
          if (next !== current) {
            if (images.length) await this.store.saveProgressAttachments(current, images);
            // Storage may have assigned a folder while migrating a legacy task.
            next.archiveName = current.archiveName; next.materialFolder = current.materialFolder;
            await this.persistTask(next);
            this.tasks = this.tasks.map(task => task.id === next.id ? next : task);
          }
          if (['progress', 'reopen'].includes(op.kind)) this.state.orders = pinTask(this.state.orders, next);
          await this.persistState().catch(() => {});
          this.renderViews(op.kind === 'progress' ? op.taskId : undefined);
          result = { status: 'applied', message: '已写入任务' };
        } catch (reason) { result = { status: 'failed', message: reason instanceof Error ? reason.message : '未能写入任务，草稿已保留' }; }
        await adapter.write(receipt, JSON.stringify({ version: 1, id: op.id, ...result }));
      });
    }
  }

  async submitQuickOperation(operation: QuickOperation): Promise<void> {
    if (!/^quick-[a-f0-9]{32}$/.test(operation.id)) throw Error('快捷操作身份无效');
    const directory = `${this.state.taskDirectory}/${QUICK_DIRECTORY}`;
    const adapter = this.app.vault.adapter;
    if (!await adapter.exists(directory)) await adapter.mkdir(directory);
    const request = `${directory}/${operation.id}.request.json`;
    const receipt = `${directory}/${operation.id}.result.json`;
    const source = JSON.stringify(operation);
    if (await adapter.exists(request) && await adapter.read(request) !== source) throw Error('快捷操作 ID 冲突');
    await adapter.write(request, source);
    if (await adapter.exists(receipt)) {
      const previous = JSON.parse(await adapter.read(receipt));
      if (previous.status === 'failed') await adapter.remove(receipt);
    }
    await this.processQuickOperations();
    const result = JSON.parse(await adapter.read(receipt));
    if (result.status !== 'applied') throw Error(result.message);
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
    if (!availableIconIds().includes(icon.trim())) throw new Error("请选择有效的 Noto 图标");
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
      await this.publishAppearance().catch(() => new Notice('任务已迁移，快捷工具主题暂未同步'));
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

  private applyAppearance(): void {
    document.body.dataset.traceloTheme = this.state.theme;
    document.body.dataset.traceloAppearance = this.state.appearance;
  }

  private async publishAppearance(): Promise<void> {
    await this.app.vault.adapter.write(`${this.state.taskDirectory}/.tracelo-ui.json`, JSON.stringify({ version: 1, theme: this.state.theme, appearance: this.state.appearance }));
  }

  async setAppearance(theme: PluginState['theme'], appearance: PluginState['appearance']): Promise<void> {
    const previous = { theme: this.state.theme, appearance: this.state.appearance };
    Object.assign(this.state, { theme, appearance });
    try { await this.persistState(); } catch (error) { Object.assign(this.state, previous); throw error; }
    this.applyAppearance();
    await this.publishAppearance().catch(() => new Notice('主题已保存，快捷工具同步失败；重新加载插件后重试'));
    this.renderViews();
  }

  renderAppearanceControls(container: HTMLElement): void {
    const fields = container.createDiv({ cls: 'wt-appearance-controls' });
    const theme = fields.createEl('label', { text: '主题' }).createEl('select', { attr: { 'aria-label': '界面主题' } });
    for (const [id, name] of [['evergreen','A 矿物绿'],['graphite','D 石墨紫'],['glacier','E 冰川蓝'],['vermilion','F 暖白朱砂']]) theme.createEl('option', { text: name, attr: { value: id! } });
    theme.value = this.state.theme;
    const mode = fields.createEl('label', { text: '外观' }).createEl('select', { attr: { 'aria-label': '界面外观' } });
    for (const [id, name] of [['system','跟随宿主'],['light','浅色'],['dark','深色']]) mode.createEl('option', { text: name, attr: { value: id! } });
    mode.value = this.state.appearance;
    const change = () => void runWithNotice(() => this.setAppearance(theme.value as PluginState['theme'], mode.value as PluginState['appearance']));
    theme.onchange = mode.onchange = change;
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
