(() => {
  const shared = TraceloCreateTask;
  shared.setBrandMark(document.querySelector('.capture-brand-icon'));
  const post = message => {
    if (window.chrome?.webview) window.chrome.webview.postMessage(message);
    else window.webkit.messageHandlers.capture.postMessage(message);
  };
  let closing = false, completing = false, visibility = 0;
  const shell = document.querySelector('.capture-modal');
  async function closeSurface(message) {
    if (closing) return;
    closing = true; shell.inert = true;
    const current = visibility;
    await shared.leaveQuickContent(shell);
    if (current === visibility) post(message);
  }
  const send = message => {
    if (message.action === 'progressComplete' || message.action === 'progressDismiss') void closeSurface(message);
    else post(message);
  };
  let pending = null, resolveSubmit, rejectSubmit, configured = false, groupError = '', resizeScheduled = false, groupsSource, taskDirectory = '工作记录/任务', mode = 'create';
  let modeRevision = 0, smartReturnMode = 'create', activeSmartTask;
  function resize() {
    if (resizeScheduled) return;
    resizeScheduled = true;
    let delivered = false, timer;
    const measure = () => {
      if (delivered) return;
      delivered = true; clearTimeout(timer); resizeScheduled = false;
      const modal = document.querySelector('.capture-modal');
      if (nativeSettingsDialog) { send({action:'resize',height:620}); return; }
      const smartSurface = [...document.querySelectorAll('dialog.wt-smart-modal[open],dialog.wt-smart-settings[open]')].at(-1);
      if (smartSurface) {
        const body = smartSurface.querySelector('.wt-smart-body,.wt-smart-settings-body');
        const bodyTop = body.getBoundingClientRect().top;
        const bottom = Math.max(bodyTop, ...[...body.children].filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect().bottom));
        const headingHeight = smartSurface.classList.contains('wt-smart-panel') ? document.querySelector('.wt-capture-tabs').offsetHeight + methods.offsetHeight : smartSurface.querySelector('.modal-title').offsetHeight;
        const confirmationBody = body.querySelector('.is-confirming-create .wt-new-task-body');
        const extra = confirmationBody ? Math.max(0, confirmationBody.scrollHeight - confirmationBody.clientHeight) : 0;
        const height = 47 + headingHeight + bottom - bodyTop + body.scrollTop + extra + parseFloat(getComputedStyle(body).paddingBottom) + (smartSurface.querySelector('.wt-smart-footer,.wt-modal-actions')?.offsetHeight ?? 0);
        send({action:'resize',height:Math.ceil(height + 2)}); return;
      }
      const outerHeight = (element, natural = false) => {
        if (!element || !element.getClientRects().length) return 0;
        const style = getComputedStyle(element);
        const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        return (natural ? element.scrollHeight + borders : element.offsetHeight)
          + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      };
      const header = document.querySelector('.modal-title');
      const tabs = document.querySelector('.wt-capture-tabs');
      const style = getComputedStyle(modal);
      const quick = document.querySelector('.wt-quick-progress');
      const quickBody = quick?.querySelector('.wt-quick-body');
      const editor = quickBody?.querySelector('.wt-quick-editor');
      const editorHeight = editor ? outerHeight(editor.querySelector('.wt-card-body'), true) + outerHeight(editor.querySelector('.wt-composer-footer')) : 0;
      const quickHeight = quickBody ? (editor ? editorHeight : [...quickBody.children].reduce((height, node) => height + node.scrollHeight + 8, 0))
        + quick.querySelector('.wt-quick-toolbar').offsetHeight + quick.querySelector('.wt-quick-status').offsetHeight : 0;
      const contentHeight = mode === 'progress' ? quickHeight + 16 : outerHeight(controller.body, true) + outerHeight(controller.footer);
      send({ action: 'resize', height: Math.ceil(outerHeight(header) + outerHeight(tabs) + outerHeight(methods) + contentHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2) });
    };
    // Hidden native WebKit windows may suspend animation frames. Keep measurement
    // bounded so a background state update can still prepare the next opening.
    timer = setTimeout(measure, 100); requestAnimationFrame(measure);
  }
  const controller = shared.mountNewTaskForm(document.querySelector('.modal-content'), {
    groups: [], isWin: !!window.chrome?.webview, setIcon: shared.setCaptureIcon,
    onResize: resize,
    onChange: draft => { if (pending && pending.key !== JSON.stringify(draft)) pending = null; send({ action: 'change', draft }); },
    onCancel: dismiss,
    onSubmit: (values, draft) => {
      const key = JSON.stringify(draft);
      if (!pending || pending.key !== key) {
        const prepared = shared.prepareImages(values.notes || '', values.images || []);
        const task = shared.buildNewTask({ ...values, creationId: undefined, notes: prepared.notes });
        if (prepared.attachments.length) { task.archiveName = task.id; task.materialFolder = taskDirectory + '/' + task.id; }
        pending = { key, request: { id: task.id, markdown: shared.serializeTaskMarkdown(task), attachments: prepared.attachments.map(({ name, base64 }) => ({ name, base64 })) } };
      }
      return new Promise((resolve, reject) => {
        resolveSubmit = resolve; rejectSubmit = reject;
        send({ action: 'submit', draft, request: pending.request });
      });
    },
  });
  controller.setAvailable(false);
  const content = document.querySelector('.modal-content');
  const tabs = document.createElement('div'); tabs.className = 'wt-capture-tabs'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '快捷入口');
  content.before(tabs);
  const methods = document.createElement('div'); methods.className='wt-create-methods'; methods.setAttribute('role','group'); methods.setAttribute('aria-label','新建方式'); content.before(methods);
  const quickContainer = document.createElement('div'); quickContainer.className = 'work-timeline-view wt-quick-progress'; content.append(quickContainer); quickContainer.hidden = true;
  const progress = shared.mountQuickProgress(quickContainer, {
    send, setIcon: shared.setCaptureIcon, resize, isWin: !!window.chrome?.webview,
    getLocation: () => document.querySelector('#location').textContent,
    openSettings: () => send({ action: 'settings', draft: controller.read() }),
  });
  const smart = shared.mountDesktopSmartCapture({send, setIcon:shared.setCaptureIcon, isWin:!!window.chrome?.webview, container:content, onResize:resize,
    onClose:()=> { if(mode==='smart') applyMode(smartReturnMode); }});
  function applyMode(value) {
    const changed = value !== mode;
    mode = value; controller.form.hidden = mode !== 'create';
    document.querySelector('.capture-modal').classList.toggle('is-progress-mode', mode === 'progress');
    if (mode === 'progress') progress.show(); else { progress.hide(); if(mode==='create') controller.focus(); }
    const topMode = mode === 'smart' ? activeSmartTask ? 'progress' : 'create' : mode;
    methods.hidden = topMode !== 'create';
    tabs.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === topMode)));
    methods.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    document.title = topMode === 'progress' ? 'Tracelo · 记录进展' : 'Tracelo · 新建任务'; resize();
    if (changed && mode!=='smart') shared.revealQuickContent(mode === 'progress' ? quickContainer : controller.body);
  }
  async function setMode(value, taskId) {
    if (controller.isSaving() || progress.isSaving() || completing || controller.isComposing() || progress.isComposing()) return;
    const revision = ++modeRevision; smart.cancelOpen();
    if (mode==='smart' && (value!=='smart' || taskId!==activeSmartTask || smart.isClosing())) {
      if (!await smart.close() || revision!==modeRevision) return;
    }
    if (value!=='smart') { applyMode(value); return; }
    if (mode==='smart' && taskId===activeSmartTask) return;
    const returnMode = taskId ? 'progress' : 'create';
    try {
      if (await smart.open(taskId,()=>revision===modeRevision)) {
        smartReturnMode=returnMode; activeSmartTask=taskId; applyMode('smart');
      }
    } catch(error) {
      if(revision===modeRevision) { if(mode==='progress') progress.setError(error.message); else controller.setError(error.message); }
    }
  }
  for (const [value, text] of [['create', '新建任务'], ['progress', '记录进展']]) {
    const button = document.createElement('button'); button.type = 'button'; const icon = document.createElement('span'); shared.setCaptureIcon(icon, value === 'create' ? 'square-pen' : 'message-square-plus'); button.append(icon, text); button.dataset.mode = value; button.setAttribute('aria-pressed', String(value === mode)); button.onclick = () => setMode(value); tabs.append(button);
  }
  function dismiss() {
    if (completing || closing) return;
    modeRevision++; smart.cancelOpen();
    if (mode==='smart') {
      const revision=modeRevision;
      void smart.close().then(closed=> { if(closed && revision===modeRevision) void closeSurface({action:'dismiss',draft:controller.read()}); }); return;
    }
    if (mode === 'progress') { if (!progress.isComposing()) send({ action: 'progressDismiss' }); return; }
    if (!controller.isSaving() && !controller.isComposing()) void closeSurface({ action: 'dismiss', draft: controller.read() });
  }
  for (const [value, text] of [['create','手动填写'],['smart','一句话整理']]) {
    const button = document.createElement('button'); button.type='button'; button.textContent=text;
    button.dataset.mode=value; button.setAttribute('aria-pressed',String(value===mode));
    button.onclick=()=>setMode(value); methods.append(button);
  }
  document.addEventListener('keydown', event => {
    if (nativeSettingsDialog) return;
    if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229 && !controller.isComposing()) { event.preventDefault(); dismiss(); }
  });
  document.querySelector('#close').onclick = dismiss;
  document.querySelector('#location').onclick = () => send({ action: 'settings', draft: controller.read() });
  let nativeSettingsDialog;
  function openNativeSettings(value) {
    if (nativeSettingsDialog) return;
    const previousFocus = document.activeElement;
    let settingsComposing = false;
    const dialog = document.createElement('dialog');
    nativeSettingsDialog = dialog;
    dialog.className = 'wt-modal wt-workbench-dialog wt-settings-modal wt-native-settings';
    dialog.setAttribute('aria-label', '快捷工具设置');
    dialog.innerHTML = `<h2 class="modal-title">快捷工具设置</h2><form class="modal-content">
      <div class="wt-settings-body"><section class="wt-settings-section"><h3>保存位置</h3>
      <label class="wt-native-field">Obsidian vault<div class="wt-native-vault"><input aria-label="Obsidian vault" autocomplete="off"><button type="button" data-browse>选择文件夹</button></div></label>
      <label class="wt-native-field">任务目录<input aria-label="任务目录" autocomplete="off"></label>
      <p class="wt-settings-help">填写相对于 vault 的已有目录，与插件保持一致。</p></section>
      <section class="wt-settings-section"><h3>全局快捷键</h3><div class="wt-settings-shortcut"><span>新建任务</span><button type="button" aria-label="新建任务快捷键" data-shortcut="shortcut"></button></div>
      <div class="wt-settings-shortcut"><span>记录进展</span><button type="button" aria-label="记录进展快捷键" data-shortcut="progressShortcut"></button></div>
      <p class="wt-settings-help">点击按键后，按下新的组合键。</p></section><p class="wt-form-error" role="alert"></p></div>
      <div class="wt-settings-footer"><button type="button" data-cancel>取消</button><button type="submit" class="wt-primary-action">保存设置</button></div></form>`;
    const vault = dialog.querySelector('[aria-label="Obsidian vault"]'), directory = dialog.querySelector('[aria-label="任务目录"]');
    vault.value = value.vault; directory.value = value.directory;
    const error = dialog.querySelector('[role=alert]');
    const isWin = !!window.chrome?.webview;
    const shortcuts = {shortcut:{...value.shortcut},progressShortcut:{...value.progressShortcut}};
    const macKeys = {KeyA:0,KeyS:1,KeyD:2,KeyF:3,KeyH:4,KeyG:5,KeyZ:6,KeyX:7,KeyC:8,KeyV:9,KeyB:11,KeyQ:12,KeyW:13,KeyE:14,KeyR:15,KeyY:16,KeyT:17,Digit1:18,Digit2:19,Digit3:20,Digit4:21,Digit6:22,Digit5:23,Equal:24,Digit9:25,Digit7:26,Minus:27,Digit8:28,Digit0:29,BracketRight:30,KeyO:31,KeyU:32,BracketLeft:33,KeyI:34,KeyP:35,Enter:36,KeyL:37,KeyJ:38,Quote:39,KeyK:40,Semicolon:41,Backslash:42,Comma:43,Slash:44,KeyN:45,KeyM:46,Period:47,Tab:48,Space:49,Backquote:50,Backspace:51,Escape:53,ArrowLeft:123,ArrowRight:124,ArrowDown:125,ArrowUp:126};
    const drawKeys = button => {
      const shortcut = shortcuts[button.dataset.shortcut]; button.replaceChildren(); button.classList.add('wt-settings-keys');
      const parts = shortcut.label.match(/[⌃⌥⇧⌘]|[^⌃⌥⇧⌘+]+/g) || [shortcut.label];
      for (const part of parts) { const kbd = document.createElement('kbd'); kbd.textContent = part.trim(); button.append(kbd); }
    };
    for (const button of dialog.querySelectorAll('[data-shortcut]')) {
      drawKeys(button);
      button.onclick = () => { button.dataset.recording = 'true'; button.textContent = '请按组合键…'; };
      button.onblur = () => { delete button.dataset.recording; drawKeys(button); };
      button.onkeydown = event => {
        if (event.isComposing || button.dataset.recording !== 'true') return;
        event.preventDefault(); event.stopPropagation();
        if (['Control','Alt','Shift','Meta'].includes(event.key)) return;
        if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey) { delete button.dataset.recording; drawKeys(button); return; }
        if (!(event.ctrlKey || event.altKey || (!isWin && event.metaKey))) { error.textContent = isWin ? '请包含 Ctrl 或 Alt。' : '请包含 ⌃、⌥ 或 ⌘。'; return; }
        if (isWin && event.metaKey) { error.textContent = '请使用 Ctrl、Alt 或 Shift 组合。'; return; }
        const key = isWin ? event.keyCode : macKeys[event.code];
        if (key === undefined || !Number.isInteger(key) || (isWin && key === 0)) { error.textContent = '暂不支持此按键，请选择字母、数字或空格。'; return; }
        const modifiers = isWin ? (event.altKey?1:0)|(event.ctrlKey?2:0)|(event.shiftKey?4:0) : (event.metaKey?256:0)|(event.shiftKey?512:0)|(event.altKey?2048:0)|(event.ctrlKey?4096:0);
        const name = event.code === 'Space' ? 'Space' : event.code.replace(/^(Key|Digit)/,'');
        const label = isWin ? [event.ctrlKey&&'Ctrl',event.altKey&&'Alt',event.shiftKey&&'Shift',name].filter(Boolean).join(' + ') : (event.ctrlKey?'⌃':'')+(event.altKey?'⌥':'')+(event.shiftKey?'⇧':'')+(event.metaKey?'⌘':'')+name;
        shortcuts[button.dataset.shortcut] = {key,modifiers,label}; error.textContent = ''; delete button.dataset.recording; drawKeys(button);
      };
    }
    dialog.querySelector('[data-browse]').onclick = () => post({action:'browseSettingsVault',vault:vault.value});
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.addEventListener('compositionstart', () => { settingsComposing = true; });
    dialog.addEventListener('compositionend', () => { settingsComposing = false; });
    dialog.oncancel = event => { if (settingsComposing || dialog.querySelector('[type=submit]').disabled) event.preventDefault(); };
    dialog.onclose = () => { dialog.remove(); nativeSettingsDialog = undefined; previousFocus?.focus(); resize(); };
    dialog.querySelector('form').onsubmit = event => {
      event.preventDefault(); if (settingsComposing) return; error.textContent = '';
      dialog.querySelectorAll('button,input').forEach(el => el.disabled = true);
      post({action:'saveSettings',vault:vault.value.trim(),directory:directory.value.trim(),...shortcuts});
    };
    document.body.append(dialog); dialog.showModal();
    post({action:'resize',height:620});
    dialog.updateSettings = state => {
      if ('settingsVault' in state) vault.value = state.settingsVault;
      if (state.nativeSettingsError) { error.textContent = state.nativeSettingsError; dialog.querySelectorAll('button,input').forEach(el => el.disabled = false); }
      if (state.nativeSettingsSaved) dialog.close();
    };
  }

  window.capture = {
    getDraft: controller.read, dismiss,
    update(state) {
      smart.update(state);
      nativeSettingsDialog?.updateSettings(state);
      if (state.nativeSettings) openNativeSettings(state.nativeSettings);
      if (state.focus || state.mode || state.error || state.progressError || state.quickError) {
        visibility++; closing = false; shell.inert = false;
        if (state.focus || state.mode) completing = false;
        if (state.focus) shared.revealQuickContent(shell);
      }
      if (state.uiSettings) {
        const ui = state.uiSettings;
        document.body.dataset.traceloTheme = shared.normalizeTheme(ui.theme);
        document.body.dataset.traceloAppearance = ['light','dark'].includes(ui.appearance) ? ui.appearance : 'system';
      }
      if ('location' in state) {
        const location = document.querySelector('#location'); location.textContent = state.location; location.title = state.directory || state.location;
        document.querySelector('.capture-workspace').textContent = state.location;
      }
      if ('directory' in state && state.directory) taskDirectory = state.directory;
      if (state.mode) setMode(state.mode);
      progress.update(state);
      if (state.progressError) progress.setError(state.progressError);
      if (state.resetPending) pending = null;
      if ('groupsSource' in state) {
        if (groupsSource !== state.groupsSource) pending = null;
        groupsSource = state.groupsSource;
        try { const groups = state.groupsSource ? shared.parseGroupArchive(state.groupsSource).groups : []; controller.setGroups(groups); progress.update({ groups }); groupError = ''; }
        catch { groupError = '无法读取分组，请在插件中检查分组文件后重试'; }
      }
      if ('draft' in state && JSON.stringify(state.draft) !== JSON.stringify(controller.read())) {
        const restored = state.draft && { ...state.draft, images: (state.draft.images || []).map(image => {
          if (image.state !== 'processing') return image;
          const live = (controller.read().images || []).find(current => current.id === image.id);
          return live || { ...image, state: 'failed', error: '上次图片处理已中断，请重试或移除后重新添加' };
        }) };
        controller.setDraft(restored);
      }
      if ('configured' in state) configured = state.configured;
      controller.setAvailable(configured && !groupError);
      if ('dark' in state) document.body.classList.toggle('theme-dark', state.dark);
      if (state.error || groupError) {
        const message = state.error || groupError;
        if (mode === 'progress') progress.setError(message);
        if (rejectSubmit) { rejectSubmit(new Error(message)); resolveSubmit = rejectSubmit = null; }
        controller.setError(message);
      } else if ('error' in state) controller.setError('');
      if (state.draft === null && resolveSubmit) {
        const resolve = resolveSubmit; resolveSubmit = rejectSubmit = null; pending = null; completing = true;
        const currentVisibility = visibility;
        // Native hosts send draft:null only after the atomic publish and draft cleanup succeed.
        void controller.confirmSaved().then(async () => {
          completing = false; resolve();
          if (currentVisibility === visibility) await closeSurface({ action: 'dismiss', draft: null });
        });
      }
      if ('saving' in state) {
        controller.setSaving(state.saving);
        document.querySelector('#close').disabled = document.querySelector('#location').disabled = state.saving;
      }
      if (state.focus && mode === 'create' && !nativeSettingsDialog) controller.focus();
    },
  };
  window.addEventListener('resize', resize);
  send({ action: 'ready' });
})();
