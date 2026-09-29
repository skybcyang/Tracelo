/** Stack cards in stable columns, regrouping only when the column count changes.
 * Keep the original task order for reflow; DOM/focus order follows each column.
 * Heights stay entirely in normal CSS flow, including async Markdown and images.
 */
export function mountMasonryColumns(grid: HTMLElement): () => void {
  const initialItems = Array.from(grid.children) as HTMLElement[];
  const win = grid.ownerDocument.defaultView;
  if (!win || !initialItems.some(item => item.matches('.wt-card'))) return () => {};
  // Reading-mode refreshes can replace a card without remounting the grid.
  // Retain the stable order by identity, not the detached card DOM nodes.
  const order = initialItems.map(item => item.dataset.taskId ?? item);
  let columnCount = 0;
  const reflow = () => {
    if (!grid.isConnected || grid.clientWidth === 0) return;
    const current = new Map(Array.from(grid.querySelectorAll<HTMLElement>(':scope > .wt-card[data-task-id], :scope > .wt-masonry-column > .wt-card[data-task-id]'), item => [item.dataset.taskId!, item]));
    const items = order.map(key => typeof key === 'string' ? current.get(key) : key).filter((item): item is HTMLElement => Boolean(item && grid.contains(item)));
    if (!items.length) return;
    const tracks = win.getComputedStyle(grid).gridTemplateColumns;
    const count = Math.min(items.length, tracks === 'none' ? 1 : tracks.trim().split(/\s+/).length);
    if (count === columnCount) return;
    columnCount = count;
    const active = grid.ownerDocument.activeElement;
    const focused = active && grid.contains(active) ? active as HTMLElement : null;
    const columns = Array.from({ length: count }, () => {
      const column = grid.ownerDocument.createElement('div');
      column.className = 'wt-masonry-column';
      return column;
    });
    items.forEach((item, index) => columns[index % count]!.appendChild(item));
    grid.replaceChildren(...columns);
    focused?.focus({ preventScroll: true });
  };
  const observer = new ResizeObserver(reflow);
  observer.observe(grid);
  reflow();
  return () => observer.disconnect();
}
