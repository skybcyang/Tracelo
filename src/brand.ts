// A centered T and its next trace point on a quiet silver plate. Shared neutral
// tokens adapt to light/dark surfaces without taking on the user's accent color.
export function setBrandMark(element: HTMLElement): void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '32');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('wt-brand-icon');
  const shapes: [string, Record<string, string>][] = [
    ['rect', { x: '.5', y: '.5', width: '31', height: '31', rx: '9', fill: 'var(--wt-brand-plate, #edf0f2)', stroke: 'var(--wt-brand-rim, #ffffff)', 'stroke-width': '.75' }],
    ['path', { d: 'M9.5 10H22.5M16 10V18', fill: 'none', stroke: 'var(--wt-brand-ink, #45494e)', 'stroke-width': '2.4', 'stroke-linecap': 'round' }],
    ['circle', { cx: '16', cy: '23', r: '1.65', fill: 'var(--wt-brand-ink, #45494e)', opacity: '.58' }],
  ];
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(svg.namespaceURI, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    svg.append(shape);
  }
  element.replaceChildren(svg);
}
