/** Stack cards in stable columns, regrouping only when the column count changes.
 * Keep the original task order for reflow; DOM/focus order follows each column.
 * Heights stay entirely in normal CSS flow, including async Markdown and images.
 */
export function mountMasonryColumns(grid: HTMLElement): () => void {
  const items = Array.from(grid.children) as HTMLElement[];
  const win = grid.ownerDocument.defaultView;
  if (!win || !items.some(item => item.matches('.wt-card'))) return () => {};
  let columnCount = 0;
  const reflow = () => {
    if (!grid.isConnected || grid.clientWidth === 0) return;
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
