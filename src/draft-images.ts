export interface DraftImage { id: string; name: string; type: string; data: string; state: 'processing' | 'ready' | 'failed'; error?: string }
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export function imageReference(image: DraftImage) { return `![${image.name.replace(/[\[\]\\\r\n]/g, '')}](<tracelo-draft:${image.id}>)`; }
export function usedImages(notes: string, images: DraftImage[]): DraftImage[] {
  return images.filter(image => notes.includes(`tracelo-draft:${image.id}`)).sort((a, b) => notes.indexOf(`tracelo-draft:${a.id}`) - notes.indexOf(`tracelo-draft:${b.id}`));
}
export function prepareImages(notes: string, images: DraftImage[]) {
  const attachments = usedImages(notes, images).map(image => {
    if (image.state !== 'ready' || !IMAGE_TYPES.includes(image.type) || !/^[-a-zA-Z0-9]+$/.test(image.id)) throw Error('图片尚未就绪，请重试或移除');
    const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.slice(6);
    const name = `image-${image.id}.${extension}`;
    const prefix = `data:${image.type};base64,`;
    if (!image.data.startsWith(prefix)) throw Error('图片数据无效，请重新添加');
    const base64 = image.data.slice(prefix.length);
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw Error('每张图片需小于 10 MB');
    notes = notes.replaceAll(`tracelo-draft:${image.id}`, name);
    return { name, base64, bytes };
  });
  if (notes.includes('tracelo-draft:')) throw Error('草稿图片缺失，请重新添加');
  return { notes, attachments };
}

/** No disk writes here. Serializable image bytes have exactly the text draft's lifetime. */
export function mountDraftImages(input: HTMLTextAreaElement, parent: HTMLElement, change: () => void) {
  const doc = input.ownerDocument;
  let images: DraftImage[] = [], selection = [input.value.length, input.value.length], undoText: string | null = null;
  const files = new Map<string, File>();
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
    const node = doc.createElement(tag); node.className = cls; node.textContent = text; return node;
  }
  function button(text: string, label: string, action: () => void) {
    const node = el('button', 'wt-secondary-action', text); node.type = 'button'; node.setAttribute('aria-label', label); node.onclick = action; return node;
  }
  const tools = el('div', 'wt-image-tools'); parent.append(tools);
  const file = el('input'); file.type = 'file'; file.accept = IMAGE_TYPES.join(','); file.multiple = true; file.hidden = true; file.setAttribute('aria-label', '添加详情图片'); tools.append(file);
  const add = button('添加图片', '添加图片', () => file.click()); tools.append(add);
  tools.append(el('span', 'wt-image-hint', '支持粘贴或拖入 · 每张 ≤10 MB，共 ≤40 MB'));
  const status = el('div', 'wt-image-status'); status.setAttribute('aria-live', 'polite'); parent.append(status);
  const list = el('div', 'wt-draft-images'); parent.append(list);
  const undo = button('撤销移除图片', '撤销移除图片', () => { if (undoText !== null) { input.value = undoText; undoText = null; undo.hidden = true; change(); render(); } });
  undo.hidden = true; parent.append(undo);
  const remember = () => { selection = [input.selectionStart, input.selectionEnd]; };
  input.addEventListener('select', remember); input.addEventListener('keyup', remember); input.addEventListener('click', remember); input.addEventListener('blur', remember);
  function insert(text: string, start: number, end: number) {
    input.focus(); input.setSelectionRange(start, end);
    // Native editing preserves the textarea undo stack in Chromium and WebKit.
    if (!doc.execCommand('insertText', false, text)) input.setRangeText(text, start, end, 'end');
    remember(); change(); render();
  }
  async function process(image: DraftImage) {
    image.state = 'processing'; image.error = undefined; render(); change();
    try {
      const source = files.get(image.id);
      if (!IMAGE_TYPES.includes(image.type)) throw Error('支持 PNG、JPG、WebP、GIF、BMP');
      if (source && source.size > MAX_IMAGE_BYTES) throw Error('每张图片需小于 10 MB');
      const referenced = new Set(usedImages(input.value, images));
      const total = images.reduce((size, current) => size + (current.data ? Math.ceil(current.data.length * 3 / 4) : referenced.has(current) ? files.get(current.id)?.size ?? 0 : 0), 0);
      if (total > 40 * 1024 * 1024) throw Error('草稿图片（含可撤销图片）合计需小于 40 MB，请清空草稿后减少图片');
      if (source) image.data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error('图片读取失败，请重试')); reader.readAsDataURL(source);
      });
      if (!image.data) throw Error('图片读取中断，请移除后重新添加');
      const preview = new Image(); preview.src = image.data;
      await preview.decode().catch(() => { throw Error('图片无法解码，请检查格式或重新选择'); });
      image.state = 'ready';
    } catch (reason) { image.state = 'failed'; image.error = reason instanceof Error ? reason.message : '图片读取失败'; }
    render(); change(); doc.dispatchEvent(new CustomEvent('tracelo-image-ready', { detail: image.id }));
  }
  function receive(incoming: File[], start: number, end: number, text = '') {
    const accepted = incoming.filter(file => file.type.startsWith('image/'));
    if (!accepted.length) return;
    const added = accepted.map(source => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const image: DraftImage = { id: [...bytes].map(v => v.toString(16).padStart(2, '0')).join(''), name: source.name || '截图.png', type: source.type, data: '', state: 'processing' };
      images.push(image); files.set(image.id, source); return image;
    });
    const content = [text, ...added.map(imageReference)].filter(Boolean).join('\n');
    insert((start && input.value[start - 1] !== '\n' ? '\n' : '') + content + (input.value[end] !== '\n' ? '\n' : ''), start, end);
    for (const image of added) void process(image);
  }
  file.onchange = () => { if (doc.activeElement === input) remember(); receive([...file.files ?? []], selection[0]!, selection[1]!); file.value = ''; };
  input.addEventListener('paste', event => {
    const incoming = [...event.clipboardData?.files ?? []];
    if (incoming.some(file => file.type.startsWith('image/'))) {
      event.preventDefault(); receive(incoming, input.selectionStart, input.selectionEnd, event.clipboardData?.getData('text/plain') ?? '');
    } else if (event.clipboardData?.getData('text/html').includes('<img')) {
      status.textContent = '部分图片未导入，可单独粘贴或添加图片';
    }
  });
  input.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); input.classList.add('is-image-drop'); } });
  input.addEventListener('dragleave', () => input.classList.remove('is-image-drop'));
  input.addEventListener('drop', event => { const incoming = [...event.dataTransfer?.files ?? []]; if (!incoming.some(file => file.type.startsWith('image/'))) return; event.preventDefault(); event.stopPropagation(); input.classList.remove('is-image-drop'); receive(incoming, input.value.length, input.value.length); });
  function preview(image: DraftImage, trigger: HTMLElement) {
    const dialog = el('dialog', 'wt-image-preview'); dialog.setAttribute('aria-label', image.name);
    const close = () => { dialog.close(); dialog.remove(); trigger.focus(); };
    dialog.append(button('关闭', '关闭图片预览', close));
    const picture = el('img'); picture.src = image.data; picture.alt = image.name; dialog.append(picture);
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
    doc.body.append(dialog); dialog.showModal();
  }
  function render() {
    list.replaceChildren();
    const used = usedImages(input.value, images), pending = used.filter(image => image.state === 'processing').length;
    status.textContent = pending ? `正在处理 ${pending} 张图片` : used.length ? `共 ${used.length} 张图片` : '';
    for (const image of used) {
      const item = el('div', 'wt-draft-image'); list.append(item);
      const show = button('', `预览图片：${image.name}`, () => preview(image, show)); show.disabled = image.state !== 'ready';
      const picture = el('img'); picture.src = image.data; picture.alt = image.name; show.append(picture); item.append(show);
      item.append(el('span', 'wt-draft-image-name', image.name));
      if (image.state !== 'ready') item.append(el('span', 'wt-image-hint', image.error ?? '处理中…'));
      if (image.state === 'failed') item.append(button('重试', `重试图片：${image.name}`, () => void process(image)));
      item.append(button('移除', `移除图片：${image.name}`, () => {
        undoText = input.value; undo.hidden = false;
        const pattern = new RegExp('!\\[[^\\]]*\\]\\(<tracelo-draft:' + image.id + '>\\)');
        const match = pattern.exec(input.value);
        if (match) insert('', match.index, match.index + match[0].length);
      }));
    }
    list.hidden = !used.length;
  }
  input.addEventListener('input', render);
  const ready = () => { if (parent.isConnected) { render(); change(); } };
  doc.addEventListener('tracelo-image-ready', ready);
  return { read: () => images, set: (value: DraftImage[] = []) => { images = value; selection = [input.value.length, input.value.length]; render(); }, render,
    destroy: () => doc.removeEventListener('tracelo-image-ready', ready),
    blocked: () => usedImages(input.value, images).some(image => image.state !== 'ready') };
}
