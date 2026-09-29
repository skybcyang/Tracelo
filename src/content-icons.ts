import noto from '@iconify-json/noto/icons.json';

interface IconData { body: string; width?: number; height?: number; hidden?: boolean }
const assets: Record<string, IconData> = noto.icons;
export const DEFAULT_CONTENT_ICON = 'noto:bookmark-tabs';

// Keep old archives intact; resolve their Lucide identifiers only at the display boundary.
const LEGACY_ICONS: Record<string, string> = {
  'circle-dot': 'bookmark-tabs', circle: 'blue-circle', layers: 'books', code: 'laptop',
  'file-text': 'page-facing-up', file: 'page-facing-up', target: 'bullseye',
  folder: 'file-folder', folders: 'card-index-dividers', 'folder-open': 'open-file-folder',
  'briefcase-business': 'briefcase', 'code-2': 'laptop', route: 'compass', 'notebook-pen': 'memo', 'messages-square': 'speech-balloon', briefcase: 'briefcase', 'book-open': 'open-book', lightbulb: 'light-bulb',
  'message-square': 'speech-balloon', 'message-circle': 'speech-balloon',
  calendar: 'calendar', 'calendar-days': 'calendar', 'check-check': 'check-mark-button',
  check: 'check-mark-button', 'circle-check': 'check-mark-button', bug: 'bug',
  'flask-conical': 'test-tube', palette: 'artist-palette', rocket: 'rocket',
  'chart-no-axes-combined': 'chart-increasing', 'bar-chart': 'bar-chart',
  'bar-chart-3': 'bar-chart', 'trending-up': 'chart-increasing',
  home: 'house', house: 'house', users: 'busts-in-silhouette', user: 'bust-in-silhouette',
  heart: 'red-heart', star: 'star', flag: 'triangular-flag', bookmark: 'bookmark',
  clock: 'alarm-clock', timer: 'stopwatch', history: 'mantelpiece-clock',
  image: 'framed-picture', camera: 'camera', music: 'musical-note', video: 'movie-camera',
  mail: 'envelope', phone: 'telephone', globe: 'globe-with-meridians',
  link: 'link', paperclip: 'paperclip', lock: 'locked', key: 'key', shield: 'shield',
  settings: 'gear', wrench: 'wrench', hammer: 'hammer', database: 'card-file-box',
  laptop: 'laptop', monitor: 'desktop-computer', smartphone: 'mobile-phone',
  terminal: 'desktop-computer', 'git-branch': 'deciduous-tree', zap: 'high-voltage',
  coffee: 'hot-beverage', gift: 'wrapped-gift', trophy: 'trophy', flame: 'fire',
  sun: 'sun', moon: 'crescent-moon', cloud: 'cloud', mountain: 'mountain',
  compass: 'compass', map: 'world-map', pin: 'pushpin', 'map-pin': 'round-pushpin',
  archive: 'card-file-box', pencil: 'pencil', 'graduation-cap': 'graduation-cap',
};

// Common work icons lead the catalog. Remaining Noto icons remain searchable by English name.
const LABELS: Record<string, string> = {
  'bookmark-tabs': '任务', 'file-folder': '文件夹', 'open-file-folder': '打开文件夹',
  'card-index-dividers': '分组', 'briefcase': '工作', 'books': '书籍', 'open-book': '学习',
  'page-facing-up': '文档', 'memo': '笔记', 'clipboard': '清单', 'calendar': '日历',
  'spiral-calendar': '计划', 'alarm-clock': '闹钟', 'stopwatch': '计时',
  'bullseye': '目标', 'rocket': '火箭', 'light-bulb': '想法', 'artist-palette': '设计',
  'laptop': '电脑', 'desktop-computer': '桌面电脑', 'mobile-phone': '手机',
  'bug': '问题', 'test-tube': '实验', 'microscope': '研究', 'gear': '设置',
  'wrench': '工具', 'hammer-and-wrench': '开发', 'toolbox': '工具箱',
  'speech-balloon': '沟通', 'busts-in-silhouette': '团队', 'handshake': '合作',
  'envelope': '邮件', 'telephone': '电话', 'megaphone': '通知', 'bell': '提醒',
  'chart-increasing': '增长', 'chart-decreasing': '下降', 'bar-chart': '统计',
  'card-file-box': '归档', 'package': '交付', 'check-mark-button': '完成',
  'warning': '警告', 'construction': '进行中', 'hourglass-not-done': '等待',
  'star': '星星', 'glowing-star': '亮星', 'sparkles': '灵感', 'fire': '火焰',
  'red-heart': '爱心', 'trophy': '奖杯', '1st-place-medal': '金牌',
  'graduation-cap': '毕业', 'school': '学校', 'office-building': '公司',
  'house': '家庭', 'hospital': '健康', 'bank': '银行', 'money-bag': '预算',
  'credit-card': '支付', 'money-with-wings': '费用', 'receipt': '票据',
  'globe-with-meridians': '网络', 'world-map': '地图', 'compass': '方向',
  'airplane': '出行', 'automobile': '汽车', 'train': '火车', 'bicycle': '骑行',
  'camera': '摄影', 'framed-picture': '图片', 'movie-camera': '视频',
  'musical-note': '音乐', 'headphone': '耳机', 'video-game': '游戏',
  'hot-beverage': '咖啡', 'teacup-without-handle': '茶', 'fork-and-knife': '用餐',
  'wrapped-gift': '礼物', 'birthday-cake': '生日', 'party-popper': '庆祝',
  'seedling': '成长', 'deciduous-tree': '树木', 'sunflower': '向日葵',
  'cherry-blossom': '樱花', 'cactus': '仙人掌', 'four-leaf-clover': '幸运',
  'sun': '太阳', 'crescent-moon': '月亮', 'cloud': '云', 'rainbow': '彩虹',
  'snowflake': '雪花', 'mountain': '山峰', 'water-wave': '海浪',
  'cat-face': '猫咪', 'dog-face': '小狗', 'panda': '熊猫', 'butterfly': '蝴蝶',
  'smiling-face-with-smiling-eyes': '开心', 'thinking-face': '思考',
  'smiling-face-with-sunglasses': '酷', 'face-with-tears-of-joy': '大笑',
  'thumbs-up': '赞', 'clapping-hands': '鼓掌', 'flexed-biceps': '加油',
  'pushpin': '置顶', 'link': '链接', 'paperclip': '附件', 'bookmark': '书签',
  'locked': '锁定', 'key': '钥匙', 'shield': '安全', 'pencil': '编辑',
};

const KEYWORDS: Record<string, string> = {
  face: '表情 脸', heart: '爱心 喜欢', cat: '猫 动物', dog: '狗 动物',
  book: '学习 阅读 书籍', flag: '旗帜', clock: '时间 时钟', flower: '花 植物',
  tree: '树 植物', fruit: '水果', food: '食物', person: '人物', woman: '女性 人物',
  man: '男性 人物', skin: '肤色', hand: '手势', arrow: '箭头', star: '星星',
};

export function normalizeContentIcon(value: string | null | undefined): string {
  if (!value) return DEFAULT_CONTENT_ICON;
  if (value.startsWith('noto:')) return Object.hasOwn(assets, value.slice(5)) ? value : DEFAULT_CONTENT_ICON;
  const old = value.replace(/^lucide-/, '');
  const name = LEGACY_ICONS[old] ?? old;
  return Object.hasOwn(assets, name) ? `noto:${name}` : DEFAULT_CONTENT_ICON;
}

export interface ContentIcon { id: string; label: string; search: string }
export const contentIcons: ContentIcon[] = [...new Set([...Object.keys(LABELS), ...Object.keys(assets)])]
  .filter(name => Object.hasOwn(assets, name) && !assets[name].hidden)
  .map(name => ({
    id: `noto:${name}`,
    label: LABELS[name] ?? name.replaceAll('-', ' '),
    search: `${name} ${name.replaceAll('-', ' ')} ${LABELS[name] ?? ''} ${name.split('-').map(word => KEYWORDS[word] ?? '').join(' ')}`,
  }));

let instance = 0;
export function setContentIcon(element: HTMLElement, value: string): void {
  const id = normalizeContentIcon(value);
  const icon = assets[id.slice(5)];
  // SVG definitions are document-global: every rendered copy needs its own gradient/filter IDs.
  const prefix = `wt-noto-${++instance}-`;
  const body = icon.body.replace(/\bid="([^"]+)"/g, (_, name: string) => `id="${prefix}${name}"`)
    .replace(/url\(#([^)]+)\)/g, (_, name: string) => `url(#${prefix}${name})`)
    .replace(/(href=")#([^"]+)/g, (_, attr: string, name: string) => `${attr}#${prefix}${name}`);
  // Only bundled, trusted SVG bodies enter the parser; saved/user input selects an ID, never markup.
  const svg = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${icon.width ?? noto.width} ${icon.height ?? noto.height}" width="24" height="24" fill="none" aria-hidden="true" focusable="false" class="wt-color-icon" data-icon="${id}">${body}</svg>`, 'image/svg+xml').documentElement;
  element.replaceChildren(element.ownerDocument.importNode(svg, true));
}
