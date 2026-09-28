import { App, Modal, getIconIds, setIcon } from 'obsidian';

const COMMON_ICONS: Record<string, string> = {
  'circle-dot': '圆点', layers: '图层', code: '代码', 'file-text': '文档', target: '目标',
  briefcase: '工作', 'book-open': '学习', lightbulb: '想法', 'message-square': '沟通',
  calendar: '计划', 'check-check': '检查', bug: '问题', 'flask-conical': '实验',
  palette: '设计', rocket: '发布', 'chart-no-axes-combined': '分析',
};

const shortIconId = (id: string) => id.replace(/^lucide-/, '');
export const availableIconIds = () => [...new Set(getIconIds().map(shortIconId))];

export class IconPickerModal extends Modal {
  private saving = false;

  constructor(
    app: App,
    private readonly heading: string,
    private readonly current: string | null | undefined,
    private readonly chooseIcon: (icon: string | null | undefined) => Promise<void>,
    private readonly options: { inheritedIcon?: string; returnFocus?: () => void } = {},
  ) { super(app); }

  onOpen(): void {
    this.setTitle(this.heading);
    this.modalEl.addClass('wt-modal');
    this.modalEl.addClass('wt-icon-picker');
    const field = this.contentEl.createEl('label', { cls: 'wt-field' });
    field.createSpan({ text: '搜索图标', cls: 'wt-field-label' });
    const search = field.createEl('input', { type: 'search', cls: 'wt-icon-search', attr: { 'aria-label': '搜索图标', placeholder: '常用中文分类或图标英文名称' } });
    const modes = this.contentEl.createDiv({ cls: 'wt-icon-modes' });
    const results = this.contentEl.createDiv({ cls: 'wt-icon-results' });
    const status = this.contentEl.createEl('p', { cls: 'wt-icon-result-count', attr: { role: 'status' } });
    const error = this.contentEl.createEl('p', { cls: 'wt-form-error', attr: { role: 'alert' } });
    const footer = this.contentEl.createDiv({ cls: 'wt-modal-actions' });
    footer.createEl('button', { text: '取消', attr: { type: 'button' } }).onclick = () => this.close();
    const select = async (icon: string | null | undefined) => {
      if (this.saving) return;
      this.saving = true;
      error.empty();
      const controls = this.contentEl.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input');
      controls.forEach(el => el.disabled = true);
      try { await this.chooseIcon(icon); this.close(); }
      catch (reason) {
        error.setText(reason instanceof Error ? reason.message : '无法保存图标，请重试');
        controls.forEach(el => el.disabled = false);
      } finally { this.saving = false; }
    };
    const choice = (container: HTMLElement, icon: string | null | undefined, preview: string, text: string, cls: string, label = text) => {
      const current = typeof this.current === 'string' ? shortIconId(this.current) : this.current;
      const button = container.createEl('button', { cls, attr: { type: 'button', 'aria-label': label, title: label, 'aria-pressed': String(current === icon) } });
      setIcon(button.createSpan({ attr: { 'aria-hidden': 'true' } }), preview);
      button.createSpan({ text });
      button.onclick = () => void select(icon);
    };
    if (this.options.inheritedIcon) {
      choice(modes, undefined, this.options.inheritedIcon, '继承分组图标', 'wt-icon-mode');
      choice(modes, null, 'minus', '隐藏图标', 'wt-icon-mode');
    }
    const available = new Set(availableIconIds());
    const ids = [...new Set([...(this.current ? [shortIconId(this.current)] : []), ...Object.keys(COMMON_ICONS), ...available])].filter(id => available.has(id));
    const render = () => {
      const query = search.value.trim().toLowerCase();
      const matches = ids.filter(id => `${id} ${COMMON_ICONS[id] ?? ''}`.toLowerCase().includes(query));
      results.empty();
      for (const id of matches.slice(0, 80)) {
        const name = COMMON_ICONS[id] ?? id;
        choice(results, id, id, name, 'wt-icon-choice', COMMON_ICONS[id] ? `${name} · ${id}` : id);
      }
      status.setText(!matches.length ? '没有匹配的图标' : matches.length > 80 ? `显示前 80 个，共 ${matches.length} 个；输入名称缩小范围` : `${matches.length} 个图标`);
    };
    search.oninput = render;
    this.modalEl.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault(); event.stopPropagation();
        if (!this.saving) this.close();
      }
    });
    render();
    search.focus();
  }

  onClose(): void { this.contentEl.empty(); this.options.returnFocus?.(); }
}
