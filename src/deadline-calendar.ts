import { dayKey, type WorkTask } from './domain';

/** Local-noon arithmetic avoids DST and UTC date shifts. Weeks start on Monday. */
export function monthDays(year: number, month: number): string[] {
  const first = new Date(year, month, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const count = Math.ceil((offset + new Date(year, month + 1, 0, 12).getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, i) => dayKey(new Date(year, month, 1 - offset + i, 12)));
}

export function mountDeadlineCalendar(root: HTMLElement, tasks: () => WorkTask[], openTask: (id: string) => void, close: () => void) {
  const doc = root.ownerDocument;
  let today = dayKey(new Date()), selected = today, month = today.slice(0, 7), fingerprint = '';
  function el(tag: string, parent: HTMLElement, cls = '', text = '') {
    const node = doc.createElement(tag); node.className = cls; node.textContent = text; parent.append(node); return node;
  }
  function button(parent: HTMLElement, text: string, action: () => void, label = text) {
    const node = el('button', parent, '', text) as HTMLButtonElement;
    node.type = 'button'; node.setAttribute('aria-label', label); node.onclick = action; return node;
  }
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '截止日历');
  const toolbar = el('div', root, 'wt-calendar-toolbar');
  const heading = el('h3', toolbar, 'wt-calendar-month');
  function shift(delta: number) {
    const date = new Date(`${month}-01T12:00:00`); date.setMonth(date.getMonth() + delta);
    month = dayKey(date).slice(0, 7); render();
  }
  button(toolbar, '‹', () => shift(-1), '上个月');
  button(toolbar, '今天', () => { today = dayKey(new Date()); selected = today; month = today.slice(0, 7); render(); });
  button(toolbar, '›', () => shift(1), '下个月');
  const dismiss = button(toolbar, '×', close, '关闭截止日历');
  const layout = el('div', root, 'wt-calendar-layout');
  const calendar = el('div', layout, 'wt-calendar-grid'); calendar.setAttribute('aria-label', '月历');
  const aside = el('section', layout, 'wt-calendar-list'); aside.setAttribute('aria-live', 'polite');
  function render() {
    const focusDay = (doc.activeElement as HTMLElement)?.dataset.day;
    const values = tasks();
    fingerprint = JSON.stringify(values);
    const [year, number] = month.split('-').map(Number);
    heading.textContent = `${year}年${number}月`;
    calendar.replaceChildren(); aside.replaceChildren();
    const byDay = new Map<string, WorkTask[]>();
    for (const task of values) if (task.dueDate) byDay.set(task.dueDate, [...byDay.get(task.dueDate) ?? [], task]);
    for (const label of ['一', '二', '三', '四', '五', '六', '日']) el('span', calendar, 'wt-calendar-weekday', label);
    const days = monthDays(year!, number! - 1);
    calendar.style.setProperty('--wt-calendar-weeks', String(days.length / 7));
    for (const day of days) {
      const items = byDay.get(day) ?? [];
      const cell = button(calendar, '', () => { selected = day; render(); calendar.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus(); }, `${day}，${items.length} 项截止任务`);
      cell.className = `wt-calendar-day${day.slice(0, 7) !== month ? ' is-outside' : ''}`;
      cell.dataset.day = day; cell.setAttribute('aria-pressed', String(day === selected));
      if (day === today) cell.setAttribute('aria-current', 'date');
      el('span', cell, 'wt-calendar-number', String(Number(day.slice(8))));
      for (const task of items.slice(0, 2)) el('span', cell, `wt-calendar-summary${task.status !== 'active' ? ' is-ended' : ''}`, task.title);
      if (items.length > 2) el('span', cell, 'wt-calendar-more', `+${items.length - 2} 项`);
    }
    el('h3', aside, '', new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${selected}T12:00:00`)));
    const items = byDay.get(selected) ?? [];
    if (items.length) el('p', aside, 'wt-calendar-help', `${items.length} 项截止任务`);
    if (!items.length) el('p', aside, 'wt-empty', '这一天没有截止任务');
    for (const task of items) {
      const row = button(aside, '', () => openTask(task.id), `查看任务：${task.title}`);
      row.className = `wt-calendar-task${task.status !== 'active' ? ' is-ended' : ''}`;
      el('span', row, '', task.title);
      el('small', row, '', `${task.groupName} · ${task.status === 'completed' ? '已完成' : task.status === 'closed' ? '已关闭' : selected < today ? '已逾期' : '进行中'}`);
    }
    if (focusDay) calendar.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus({ preventScroll: true });
  }
  root.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      const nodes = [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (event.shiftKey && doc.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && doc.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    }
  });
  render(); dismiss.focus();
  const timer = window.setInterval(() => {
    const next = dayKey(new Date());
    if (next !== today || fingerprint !== JSON.stringify(tasks())) { today = next; render(); }
  }, 1000);
  return () => window.clearInterval(timer);
}
