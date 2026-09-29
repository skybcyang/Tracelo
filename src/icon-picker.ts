import { App, Modal } from 'obsidian';
import { contentIcons, normalizeContentIcon, setContentIcon } from './content-icons';

export const availableIconIds = () => contentIcons.map(icon => icon.id);

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
    this.contentEl.createEl('p', { text: 'Noto Emoji · 彩色图标', cls: 'wt-icon-library-label' });
    const field = this.contentEl.createEl('label', { cls: 'wt-field' });
    field.createSpan({ text: '搜索图标', cls: 'wt-field-label' });
    const search = field.createEl('input', { type: 'search', cls: 'wt-icon-search', attr: { 'aria-label': '搜索图标', placeholder: '常用中文分类或图标英文名称' } });
    const modes = this.contentEl.createDiv({ cls: 'wt-icon-modes' });
    const results = this.contentEl.createDiv({ cls: 'wt-icon-results' });
    const more = this.contentEl.createEl('button', { text: '显示更多', cls: 'wt-icon-more', attr: { type: 'button' } });
    const status = this.contentEl.createEl('p', { cls: 'wt-icon-result-count', attr: { role: 'status' } });
    const error = this.contentEl.createEl('p', { cls: 'wt-form-error', attr: { role: 'alert' } });
    const footer = this.contentEl.createDiv({ cls: 'wt-modal-actions' });
    footer.createEl('button', { text: '取消', cls: 'wt-secondary-action', attr: { type: 'button' } }).onclick = () => this.close();
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
      const current = typeof this.current === 'string' ? normalizeContentIcon(this.current) : this.current;
      const button = container.createEl('button', { cls, attr: { type: 'button', 'aria-label': label, title: label, 'aria-pressed': String(current === icon) } });
      if (typeof icon === 'string') button.setAttribute('data-icon', icon);
      setContentIcon(button.createSpan({ attr: { 'aria-hidden': 'true' } }), preview);
      button.createSpan({ text });
      button.onclick = () => void select(icon);
    };
    if (this.options.inheritedIcon) {
      choice(modes, undefined, this.options.inheritedIcon, '继承分组图标', 'wt-icon-mode');
      choice(modes, null, 'noto:prohibited', '隐藏图标', 'wt-icon-mode');
    }
    const currentId = this.current ? normalizeContentIcon(this.current) : null;
    const icons = [...contentIcons].sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId));
    let visible = 80;
    const render = (append = false) => {
      const query = search.value.trim().toLowerCase();
      const matches = icons.filter(icon => icon.search.includes(query));
      const start = append ? results.childElementCount : 0;
      if (!append) { results.empty(); results.scrollTop = 0; }
      for (const icon of matches.slice(start, visible)) {
        choice(results, icon.id, icon.id, icon.label, 'wt-icon-choice', `${icon.label} · ${icon.id}`);
      }
      more.hidden = matches.length <= visible;
      status.setText(!matches.length ? '没有匹配的图标，试试常用中文词或英文名称' : `已显示 ${Math.min(visible, matches.length)} / ${matches.length} 个图标`);
    };
    more.onclick = () => { visible += 80; render(true); };
    search.oninput = () => { visible = 80; render(); };
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
