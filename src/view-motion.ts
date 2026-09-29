/** Visual continuity across the view's synchronous DOM replacement. Never owns task state. */
interface CardMotionState {
  top: number;
  height: number;
  opacity: number;
  status: string;
  ring: string | undefined;
  complete: boolean;
  sections: Set<string>;
  todos: Map<string, boolean>;
}

export interface ViewMotionSnapshot {
  cards: Map<string, CardMotionState>;
  eventIds: Set<string> | undefined;
}

const roots = new WeakMap<HTMLElement, { eventIds: Set<string>; animations: Set<Animation> }>();
const sections = ['.wt-task-notes', '.wt-card-todos', '.wt-card-composer'];
const easing = 'cubic-bezier(.22,.7,.25,1)';
const duration = 240;

function todoStates(card: HTMLElement): Map<string, boolean> {
  return new Map(Array.from(card.querySelectorAll<HTMLElement>('[data-todo-id]'), row => [
    row.dataset.todoId!, Boolean(row.querySelector('.is-done')),
  ]));
}

function status(card: HTMLElement): string {
  return `${card.classList.contains('is-ended')}:${card.querySelector('.wt-status')?.textContent ?? ''}`;
}

export function captureViewMotion(root: HTMLElement): ViewMotionSnapshot {
  const view = root.ownerDocument.defaultView;
  const cards = new Map<string, CardMotionState>();
  const paneBounds = new Map<Element, DOMRect>();
  if (view) for (const card of root.querySelectorAll<HTMLElement>('.wt-card[data-task-id]')) {
    const rect = card.getBoundingClientRect();
    const pane = card.closest('.wt-task-column') ?? root;
    if (!paneBounds.has(pane)) paneBounds.set(pane, pane.getBoundingClientRect());
    const clip = paneBounds.get(pane)!;
    if (!rect.width || !rect.height || rect.bottom <= Math.max(0, clip.top) || rect.top >= Math.min(view.innerHeight, clip.bottom)
      || rect.right <= Math.max(0, clip.left) || rect.left >= Math.min(view.innerWidth, clip.right)) continue;
    const style = view.getComputedStyle(card);
    const ring = card.querySelector<SVGCircleElement>('.wt-progress-value');
    cards.set(card.dataset.taskId!, {
      top: rect.top,
      // Computed height includes an interrupted WAAPI height and excludes CSS zoom.
      height: Number.parseFloat(style.height), opacity: Number(style.opacity), status: status(card),
      ring: ring ? view.getComputedStyle(ring).strokeDasharray : undefined,
      complete: Boolean(card.querySelector('.wt-progress-chip.is-complete')),
      sections: new Set(sections.filter(selector => Boolean(card.querySelector<HTMLElement>(selector)?.offsetHeight))),
      todos: todoStates(card),
    });
  }
  const state = roots.get(root);
  // Read-only: the host still needs the same geometry to capture its reading anchor.
  return { cards, eventIds: state?.eventIds };
}

export function animateViewMotion(root: HTMLElement, snapshot: ViewMotionSnapshot, options?: { eventIds: Iterable<string>; anchorTaskId?: string }): void {
  const view = root.ownerDocument.defaultView;
  const eventIds = new Set(options?.eventIds ?? Array.from(root.querySelectorAll<HTMLElement>('[data-event-id]'), item => item.dataset.eventId!));
  const animations = new Set<Animation>();
  // Cancel after the host has captured/restored reading state and replaced the old card DOM.
  roots.get(root)?.animations.forEach(animation => animation.cancel());
  roots.set(root, { eventIds, animations });
  if (!view || !root.isConnected || typeof root.animate !== 'function') return;
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return;

  const stop = (): void => { if (reduced.matches) animations.forEach(animation => animation.cancel()); };
  reduced.addEventListener('change', stop);
  const play = (element: Element, frames: Keyframe[], timing: KeyframeAnimationOptions = {}): Animation => {
    const animation = element.animate(frames, { duration, easing, ...timing });
    animations.add(animation);
    void animation.finished.catch(() => {}).then(() => {
      animations.delete(animation);
      if (!animations.size) reduced.removeEventListener('change', stop);
    });
    return animation;
  };

  // Read every destination before starting height animations, avoiding interleaved layout reads/writes.
  const targets = Array.from(root.querySelectorAll<HTMLElement>('.wt-card[data-task-id]')).filter(card => snapshot.cards.has(card.dataset.taskId!)).map(card => {
    const style = view.getComputedStyle(card);
    const ring = card.querySelector<SVGCircleElement>('.wt-progress-value');
    return { card, height: Number.parseFloat(style.height), opacity: Number(style.opacity), background: style.backgroundColor,
      ring, ringValue: ring ? view.getComputedStyle(ring).strokeDasharray : undefined };
  });
  const anchorTop = options?.anchorTaskId ? snapshot.cards.get(options.anchorTaskId)?.top : undefined;
  for (const { card, height, opacity, background, ring, ringValue } of targets) {
    const old = snapshot.cards.get(card.dataset.taskId!);
    if (!old) continue;
    // Earlier cards settle before the host restores its reading anchor. Never animate them back up.
    if ((anchorTop === undefined || old.top >= anchorTop - .5)
      && Number.isFinite(old.height) && Number.isFinite(height) && Math.abs(old.height - height) > .5) {
      play(card, [{ height: `${old.height}px`, minHeight: '0' }, { height: `${height}px`, minHeight: '0' }]);
      if (height > old.height) for (const selector of sections) {
        const section = card.querySelector<HTMLElement>(selector);
        if (section?.offsetHeight && !old.sections.has(selector)) {
          play(section, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, delay: 35, fill: 'backwards' });
        }
      }
    }
    if (Math.abs(old.opacity - opacity) > .001) play(card, [{ opacity: old.opacity }, { opacity }], { duration: 180 });
    if (old.status !== status(card)) {
      play(card, [{ backgroundColor: 'color-mix(in srgb, var(--wt-accent, #356d54) 12%, transparent)' }, { backgroundColor: background }]);
    }
    if (ring && old.ring && ringValue && old.ring !== ringValue) {
      play(ring, [{ strokeDasharray: old.ring }, { strokeDasharray: ringValue }], { duration: 260 });
    }
    const chip = card.querySelector('.wt-progress-chip.is-complete');
    if (chip && !old.complete) play(chip, [{ transform: 'scale(1)' }, { transform: 'scale(1.045)', offset: .45 }, { transform: 'scale(1)' }], { duration: 280 });
    for (const row of card.querySelectorAll<HTMLElement>('[data-todo-id]')) {
      const done = Boolean(row.querySelector('.is-done'));
      if (old.todos.has(row.dataset.todoId!) && old.todos.get(row.dataset.todoId!) !== done) {
        play(row, [{ backgroundColor: 'color-mix(in srgb, var(--wt-accent, #356d54) 12%, transparent)' }, { backgroundColor: 'transparent' }]);
      }
    }
  }

  // The complete event ledger distinguishes actual writes from viewing an older task/date.
  if (snapshot.eventIds) for (const item of root.querySelectorAll<HTMLElement>('[data-event-id]')) {
    if (snapshot.eventIds.has(item.dataset.eventId!)) continue;
    const body = item.querySelector('.wt-event-body') ?? item;
    play(body, [{ opacity: .25, transform: 'translateY(-5px)' }, { opacity: 1, transform: 'none' }], { duration: 280 });
    play(item, [{ transform: 'scale(.55)' }, { transform: 'scale(1)' }], { duration: 240, pseudoElement: '::before' });
    // Overlay only the new node's line segment; the existing history line never replays.
    const line = item.ownerDocument.createElement('span');
    line.setAttribute('aria-hidden', 'true');
    line.className = 'wt-motion-connector';
    Object.assign(line.style, { position: 'absolute', pointerEvents: 'none', left: '7px', top: '13px', bottom: '0', width: '1px', background: 'var(--wt-accent)', transformOrigin: 'top' });
    item.append(line);
    const lineAnimation = play(line, [{ transform: 'scaleY(0)', opacity: .7 }, { transform: 'scaleY(1)', opacity: 0 }], { duration: 320 });
    void lineAnimation.finished.catch(() => {}).then(() => line.remove());
  }
  if (!animations.size) reduced.removeEventListener('change', stop);
}
