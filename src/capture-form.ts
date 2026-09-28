export { mountNewTaskForm, buildNewTask } from './new-task-form';
export { parseGroupArchive, serializeTaskMarkdown } from './archive';

// Lucide geometry, the same icons used by Obsidian's setIcon.
export function setCaptureIcon(element: HTMLElement, name: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '24', height: '24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', name === 'plus' ? 'M12 5v14M5 12h14' : name === 'chevron-down' ? 'm6 9 6 6 6-6' : 'M18 6 6 18M6 6l12 12');
  svg.append(path); element.append(svg);
}
