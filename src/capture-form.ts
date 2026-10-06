export { mountNewTaskForm, buildNewTask } from './new-task-form';
export { parseGroupArchive, serializeLegacyTaskMarkdown as serializeTaskMarkdown } from './archive';
export { prepareImages } from './draft-images';
export { mountQuickProgress } from './desktop-progress';
export { revealQuickContent, leaveQuickContent } from './quick-feedback';
export { setBrandMark } from './brand';
export { normalizeTheme } from './appearance';
export { mountDesktopSmartCapture } from './desktop-smart-capture';

import { createElement, icons } from 'lucide';
import { setContentIcon } from './content-icons';

// Resolve the same Lucide names accepted by Obsidian's setIcon.
export function setCaptureIcon(element: HTMLElement, name: string) {
  if (name.startsWith('noto:')) { setContentIcon(element, name); return; }
  const key = name.replace(/^lucide-/, '').replace(/(^|-)(\w)/g, (_, _separator, letter: string) => letter.toUpperCase());
  const node = icons[key as keyof typeof icons] ?? icons.Circle;
  element.replaceChildren(createElement(node, { width: '24', height: '24', 'aria-hidden': 'true', class: 'svg-icon' }));
}
