import { quadrantName, type WorkTask } from './domain';
import type { ArchiveAdapter } from './archive-store';
import { cardDueLabel } from './task-card';

export interface CoverFlow {
  element: HTMLElement;
  select(id: string): void;
  move(delta: number): void;
  dispose(): void;
}

export function renderTaskCover(parent: HTMLElement, task: WorkTask, choose: (id: string) => void): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'wt-task-cover', attr: { type: 'button', 'data-cover-task': task.id, 'aria-label': `打开任务：${task.title}`, tabindex: '0' } });
    const top = button.createSpan({ cls: 'wt-cover-top' });
    const identity = top.createSpan({ cls: 'wt-cover-identity' });
    identity.createSpan({ text: task.groupName });
    top.createSpan({ cls: 'wt-cover-current', text: '当前任务' });
    button.createSpan({ cls: 'wt-cover-title', text: task.title });
    const bottom = button.createSpan({ cls: 'wt-cover-bottom' });
    bottom.createSpan({ cls: `wt-cover-quadrant is-${task.important ? task.urgent ? 'iu' : 'in' : task.urgent ? 'un' : 'nn'}`, text: quadrantName(task) });
    if (task.dueDate) bottom.createSpan({ cls: 'wt-cover-due', text: cardDueLabel(task).replace(/^已逾期 · /, '逾期 ') });
    button.onclick = () => choose(task.id);
    return button;
}

/** A single bounded track keeps each task visible only once. */
export function mountCoverFlow(parent: HTMLElement, tasks: WorkTask[], selected: string | null,
  choose: (id: string) => void, position: (index: number, total: number) => void): CoverFlow {
  const flow = parent.createDiv({ cls: 'wt-cover-flow', attr: { tabindex: '0', role: 'region', 'aria-label': '任务封面流，左右方向键浏览，回车选择' } });
  const count = tasks.length;
  let frame = 0, disposed = false, wheelTimer = 0;
  const cards: HTMLElement[] = [];
  for (const task of tasks) {
    const button = renderTaskCover(flow, task, choose);
    cards.push(button);
  }
  let centerIndex = Math.max(0, tasks.findIndex(t => t.id === selected));
  const center = (index: number, smooth: boolean) => {
    if (!count || disposed) return;
    centerIndex = Math.max(0, Math.min(count - 1, index));
    const card = cards[centerIndex];
    if (card) flow.scrollTo({ left: card.offsetLeft + card.offsetWidth / 2 - flow.clientWidth / 2,
      behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
  };
  const update = () => {
    if (!count || !flow.clientWidth || disposed) return;
    const x = flow.scrollLeft + flow.clientWidth / 2;
    let distance = Infinity;
    cards.forEach((card, i) => {
      const delta = card.offsetLeft + card.offsetWidth / 2 - x;
      if (Math.abs(delta) < distance) { distance = Math.abs(delta); centerIndex = i; }
      if (Math.abs(delta) < flow.clientWidth) {
        const edge = Math.max(0, (Math.abs(delta) / (flow.clientWidth / 2) - .42) / .58);
        card.style.setProperty('--cover-rotate', `${card.dataset.coverTask === selected ? 0 : -Math.sign(delta) * Math.min(edge, 1) * 8}deg`);
        card.style.setProperty('--cover-scale', String(1 - Math.min(edge, 1) * .045));
      }
    });
    position(centerIndex, count);
  };
  const select = (id: string) => {
    selected = id;
    for (const card of cards) {
      const current = card.dataset.coverTask === id;
      card.classList.toggle('is-current', current);
      card.setAttribute('aria-pressed', String(current));
      card.querySelector<HTMLElement>('.wt-cover-current')!.hidden = !current;
    }
    update();
  };
  flow.addEventListener('scroll', () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); }, { passive: true });
  flow.addEventListener('wheel', event => {
    if (count < 2 || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    flow.scrollLeft += raw * (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? flow.clientWidth : 1);
    update();
    clearTimeout(wheelTimer); wheelTimer = window.setTimeout(() => center(centerIndex, true), 140);
  }, { passive: false });
  flow.addEventListener('keydown', event => {
    if (event.target !== flow || event.isComposing) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); center(centerIndex + (event.key === 'ArrowRight' ? 1 : -1), true); }
    if (event.key === 'Enter' && tasks[centerIndex]) { event.preventDefault(); choose(tasks[centerIndex].id); }
  });
  const observer = new ResizeObserver(() => center(centerIndex, false)); observer.observe(flow);
  frame = requestAnimationFrame(() => { center(centerIndex, false); select(selected ?? ''); update(); });
  if (!count) position(0, 0);
  return { element: flow, select, move(delta) { if (count > 1) { update(); center(centerIndex + delta, false); update(); } },
    dispose() { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(wheelTimer); } };
}

/** Read-only, lazy directory listing. Rendering never creates or repairs folders. */
export function mountTaskDirectory(parent: HTMLElement, path: string, adapter: ArchiveAdapter,
  open: (path: string) => void, expanded: Set<string>, valid: () => boolean): void {
  const tree = parent.createDiv({ cls: 'wt-directory-tree', attr: { role: 'tree', 'aria-label': '任务目录' } });
  const load = async (mount: HTMLElement, directory: string) => {
    try {
      const listing = await adapter.list(directory);
      if (!valid() || !tree.isConnected) return;
      mount.empty();
      const collator = new Intl.Collator('zh-CN', { numeric: true });
      for (const folder of listing.folders.sort(collator.compare)) {
        const row = mount.createDiv({ cls: 'wt-directory-folder', attr: { role: 'treeitem' } });
        const button = row.createEl('button', { text: folder.split('/').at(-1), attr: { type: 'button', 'aria-label': folder.split('/').at(-1)!, 'aria-expanded': String(expanded.has(folder)) } });
        const children = row.createDiv({ cls: 'wt-directory-children', attr: { role: 'group' } });
        children.hidden = !expanded.has(folder);
        let loaded = false;
        const show = () => { if (!loaded) { loaded = true; void load(children, folder); } };
        button.onclick = () => {
          children.hidden = !children.hidden; button.setAttribute('aria-expanded', String(!children.hidden));
          if (children.hidden) expanded.delete(folder); else { expanded.add(folder); show(); }
        };
        if (!children.hidden) show();
      }
      for (const file of listing.files.sort(collator.compare)) {
        const row = mount.createDiv({ attr: { role: 'treeitem' } });
        row.createEl('button', { text: file.split('/').at(-1), attr: { type: 'button', title: file } }).onclick = () => open(file);
      }
      if (!listing.files.length && !listing.folders.length) mount.createEl('p', { text: '文件夹为空', cls: 'wt-directory-empty' });
    } catch {
      if (!valid() || !tree.isConnected) return;
      mount.empty(); mount.createEl('p', { text: '目录暂时无法读取', cls: 'wt-directory-error' });
      mount.createEl('button', { text: '重试', attr: { type: 'button' } }).onclick = () => void load(mount, directory);
    }
  };
  void load(tree, path);
}
