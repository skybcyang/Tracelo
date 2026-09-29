(() => {
  const shared = TraceloCreateTask;
  shared.setCaptureIcon(document.querySelector('.capture-brand-icon'), 'workflow');
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
  function resize() {
    if (resizeScheduled) return;
    resizeScheduled = true;
    requestAnimationFrame(() => {
      resizeScheduled = false;
      const modal = document.querySelector('.capture-modal');
      const header = document.querySelector('.modal-title');
      const tabs = document.querySelector('.wt-capture-tabs');
      const style = getComputedStyle(modal);
      const quick = document.querySelector('.wt-quick-progress');
      const quickBody = quick?.querySelector('.wt-quick-body');
      const editor = quickBody?.querySelector('.wt-quick-editor');
      const editorHeight = editor ? editor.querySelector('.wt-card-body').scrollHeight + editor.querySelector('.wt-composer-footer').offsetHeight : 0;
      const quickHeight = quickBody ? (editor ? editorHeight : [...quickBody.children].reduce((height, node) => height + node.scrollHeight + 8, 0))
        + quick.querySelector('.wt-quick-toolbar').offsetHeight + quick.querySelector('.wt-quick-status').offsetHeight : 0;
      const contentHeight = mode === 'progress' ? quickHeight + 16 : controller.body.scrollHeight + controller.footer.offsetHeight;
      send({ action: 'resize', height: Math.ceil(header.offsetHeight + tabs.offsetHeight + contentHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2) });
    });
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
  const quickContainer = document.createElement('div'); quickContainer.className = 'work-timeline-view wt-quick-progress'; content.append(quickContainer); quickContainer.hidden = true;
  const progress = shared.mountQuickProgress(quickContainer, {
    send, setIcon: shared.setCaptureIcon, resize, isWin: !!window.chrome?.webview,
    getLocation: () => document.querySelector('#location').textContent,
    openSettings: () => send({ action: 'settings', draft: controller.read() }),
  });
  function setMode(value) {
    if (controller.isSaving() || completing) return;
    const changed = value !== mode;
    mode = value; controller.form.hidden = mode !== 'create';
    document.querySelector('.capture-modal').classList.toggle('is-progress-mode', mode === 'progress');
    if (mode === 'progress') progress.show(); else { progress.hide(); controller.focus(); }
    tabs.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    document.title = mode === 'progress' ? 'Tracelo · 记录进展' : 'Tracelo · 新建任务'; resize();
    if (changed) shared.revealQuickContent(mode === 'progress' ? quickContainer : controller.body);
  }
  for (const [value, text] of [['create', '新建任务'], ['progress', '记录进展']]) {
    const button = document.createElement('button'); button.type = 'button'; const icon = document.createElement('span'); shared.setCaptureIcon(icon, value === 'create' ? 'square-pen' : 'message-square-plus'); button.append(icon, text); button.dataset.mode = value; button.setAttribute('aria-pressed', String(value === mode)); button.onclick = () => setMode(value); tabs.append(button);
  }
  function dismiss() {
    if (completing || closing) return;
    if (mode === 'progress') { if (!progress.isComposing()) send({ action: 'progressDismiss' }); return; }
    if (!controller.isSaving() && !controller.isComposing()) void closeSurface({ action: 'dismiss', draft: controller.read() });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229 && !controller.isComposing()) { event.preventDefault(); dismiss(); }
  });
  document.querySelector('#close').onclick = dismiss;
  document.querySelector('#location').onclick = () => send({ action: 'settings', draft: controller.read() });
  window.capture = {
    getDraft: controller.read, dismiss,
    update(state) {
      if (state.focus || state.mode || state.error || state.progressError || state.quickError) {
        visibility++; closing = false; shell.inert = false;
        if (state.focus || state.mode) completing = false;
        if (state.focus) shared.revealQuickContent(shell);
      }
      if (state.uiSettings) {
        const ui = state.uiSettings;
        document.body.dataset.traceloTheme = ['evergreen','graphite','glacier','vermilion'].includes(ui.theme) ? ui.theme : 'evergreen';
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
      if (state.focus && mode === 'create') controller.focus();
    },
  };
  window.addEventListener('resize', resize);
  send({ action: 'ready' });
})();
