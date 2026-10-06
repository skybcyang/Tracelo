// A centered T and its next trace point. Fixed neutral fills keep the identity
// consistent across themes; the fine outline also separates it on dark surfaces.
export function setBrandMark(element: HTMLElement): void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '32');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('wt-brand-icon');
  const shapes: [string, Record<string, string>][] = [
    ['rect', { x: '.5', y: '.5', width: '31', height: '31', rx: '8', fill: '#242424', stroke: '#727272' }],
    ['path', { d: 'M9 9.5H23M16 9.5V18', fill: 'none', stroke: '#ffffff', 'stroke-width': '3', 'stroke-linecap': 'round' }],
    ['circle', { cx: '16', cy: '23', r: '2', fill: '#a6a6a6' }],
  ];
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(svg.namespaceURI, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    svg.append(shape);
  }
  element.replaceChildren(svg);
}
