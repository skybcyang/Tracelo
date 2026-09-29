import { Menu } from 'obsidian';

/** Keep Obsidian's menu behavior, with palette scoped to this menu and its submenus. */
export function themeMenu(menu: Menu, source: HTMLElement): Menu {
  menu.setUseNativeMenu(false);
  // Obsidian's DOM menu element is not part of its public typings. If unavailable,
  // retain the host menu rather than applying styles to unrelated host menus.
  const dom = (menu as Menu & { dom?: HTMLElement }).dom;
  if (dom) {
    dom.classList.add('wt-themed-menu');
    const style = source.ownerDocument.defaultView!.getComputedStyle(source);
    for (const token of ['card', 'raised', 'text', 'muted', 'line', 'tint', 'accent', 'accent-text', 'red', 'radius', 'small-radius']) {
      dom.style.setProperty(`--wt-${token}`, style.getPropertyValue(`--wt-${token}`));
    }
    dom.style.colorScheme = style.colorScheme;
    dom.style.fontFamily = style.fontFamily;
  }
  return menu;
}
