export const THEMES = [
  ['monochrome', '素白'],
  ['evergreen', '矿物绿'],
  ['graphite', '石墨紫'],
  ['glacier', '冰川蓝'],
  ['vermilion', '暖白朱砂'],
] as const;

export type Theme = typeof THEMES[number][0];
export const DEFAULT_THEME: Theme = 'monochrome';

export function normalizeTheme(value: unknown): Theme {
  return THEMES.find(([id]) => id === value)?.[0] ?? DEFAULT_THEME;
}
