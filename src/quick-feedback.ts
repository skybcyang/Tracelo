/** Short, cancelable feedback shared by the plugin and both native webviews. */
export function prefersReducedQuickMotion(element: HTMLElement): boolean {
  return element.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? true;
}

const animations = new WeakMap<HTMLElement, Animation>();
export function revealQuickContent(element: HTMLElement): void {
  animations.get(element)?.cancel();
  if (prefersReducedQuickMotion(element) || !element.animate) return;
  // Whole form bodies include fixed footers: opacity keeps their controls in bounds.
  const animation = element.animate([{ opacity: 0.45 }, { opacity: 1 }],
    { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' });
  animations.set(element, animation);
  void animation.finished.catch(() => {}).finally(() => { if (animations.get(element) === animation) animations.delete(element); });
}

export async function leaveQuickContent(element: HTMLElement): Promise<void> {
  animations.get(element)?.cancel();
  if (prefersReducedQuickMotion(element) || !element.animate) return;
  const animation = element.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(3px)' }],
    { duration: 100, easing: 'ease-in' });
  animations.set(element, animation);
  await animation.finished.catch(() => {});
  if (animations.get(element) === animation) animations.delete(element);
}

export function confirmQuickSave(element: HTMLElement): Promise<void> {
  revealQuickContent(element);
  return new Promise(resolve => setTimeout(resolve, prefersReducedQuickMotion(element) ? 0 : 280));
}
