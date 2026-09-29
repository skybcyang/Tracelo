import { setIcon } from 'obsidian';

/** Keep the ordered leading groups on one line; move the remainder into a disclosure. */
export function mountGroupOverflow(nav: HTMLElement): () => void {
  const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>('.wt-group-tab'));
  const more = nav.createEl('details', { cls: 'wt-group-overflow' });
  const summary = more.createEl('summary', { attr: { 'aria-label': '更多分组', 'aria-expanded': 'false' } });
  const label = summary.createSpan({ text: '更多分组' });
  setIcon(summary.createSpan({ attr: { 'aria-hidden': 'true' } }), 'chevron-down');
  const panel = more.createDiv({ cls: 'wt-group-overflow-panel', attr: { role: 'group', 'aria-label': '更多分组' } });
  const doc = nav.ownerDocument;
  let disposed = false;
  const close = (focus = false) => { more.open = false; if (focus) summary.focus({ preventScroll: true }); };
  function positionPanel() {
    if (!more.open) return;
    const boundary = (nav.closest('.work-timeline-view') ?? nav).getBoundingClientRect();
    panel.style.maxWidth = `${Math.max(0, boundary.width - 16)}px`;
    const trigger = more.getBoundingClientRect();
    const left = Math.max(boundary.left + 8, Math.min(trigger.right - panel.offsetWidth, boundary.right - panel.offsetWidth - 8));
    panel.style.right = 'auto'; panel.style.left = `${left - trigger.left}px`;
  }
  function layout() {
    if (disposed || !nav.isConnected || !nav.clientWidth) return;
    const active = doc.activeElement;
    const selected = buttons.find(button => button.getAttribute('aria-pressed') === 'true');
    // Measure the original order, independent of the previous overflow partition.
    for (const button of buttons) nav.insertBefore(button, more);
    more.hidden = false;
    label.textContent = selected && selected !== buttons[0] ? selected.querySelector('span:not([class])')?.textContent ?? '更多分组' : '更多分组';
    const widths = buttons.map(button => button.getBoundingClientRect().width);
    const gap = parseFloat(getComputedStyle(nav).columnGap) || 0;
    const total = widths.reduce((sum, width) => sum + width, 0) + gap * (buttons.length - 1);
    let visible = buttons.length;
    if (total > nav.clientWidth) {
      const available = nav.clientWidth - more.getBoundingClientRect().width - gap;
      let used = widths[0] ?? 0;
      visible = 1;
      while (visible < buttons.length && used + gap + widths[visible]! <= available) used += gap + widths[visible++]!;
      for (const button of buttons.slice(visible)) panel.append(button);
    }
    more.hidden = visible === buttons.length;
    const selectedHidden = !!selected && panel.contains(selected);
    label.textContent = selectedHidden ? selected.querySelector('span:not([class])')?.textContent ?? '更多分组' : '更多分组';
    summary.classList.toggle('is-active', selectedHidden);
    summary.setAttribute('aria-label', selectedHidden ? `更多分组，当前：${label.textContent}` : '更多分组');
    if (more.hidden) close();
    if (more.hidden && active === summary) (selected ?? buttons[0])?.focus({ preventScroll: true });
    if (active instanceof HTMLElement && buttons.includes(active as HTMLButtonElement)) {
      (panel.contains(active) && !more.open ? summary : active).focus({ preventScroll: true });
    }
    positionPanel();
  }
  more.addEventListener('toggle', () => { summary.setAttribute('aria-expanded', String(more.open)); positionPanel(); });
  summary.addEventListener('click', event => {
    event.preventDefault(); more.open = !more.open;
    summary.setAttribute('aria-expanded', String(more.open)); positionPanel();
  });
  more.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    const items = Array.from(panel.querySelectorAll<HTMLButtonElement>('button'));
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !items.length) return;
    event.preventDefault(); more.open = true; positionPanel();
    const index = items.indexOf(doc.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) :
      (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  });
  const outside = (event: Event) => { if (event.target instanceof Node && !more.contains(event.target)) close(); };
  doc.addEventListener('pointerdown', outside);
  doc.addEventListener('focusin', outside);
  const observer = new ResizeObserver(layout);
  observer.observe(nav);
  layout();
  void doc.fonts.ready.then(() => { if (!disposed) layout(); });
  return () => {
    disposed = true; observer.disconnect();
    doc.removeEventListener('pointerdown', outside); doc.removeEventListener('focusin', outside);
  };
}
