(() => {
  const shared = TraceloCreateTask;
  const send = message => {
    if (window.chrome?.webview) window.chrome.webview.postMessage(message);
    else window.webkit.messageHandlers.capture.postMessage(message);
  };
  let pending = null, resolveSubmit, rejectSubmit, configured = false, groupError = '', resizeScheduled = false, groupsSource, taskDirectory = '工作记录/任务', mode = 'create';
  function resize() {
    if (resizeScheduled) return;
    resizeScheduled = true;
    requestAnimationFrame(() => {
      resizeScheduled = false;
      const modal = document.querySelector('.capture-modal');
      const header = document.querySelector('.modal-title');
      const context = document.querySelector('.capture-context');
      const style = getComputedStyle(modal);
      send({ action: 'resize', height: mode === 'progress' ? 760 : Math.ceil(header.offsetHeight + 52 + controller.body.scrollHeight + controller.footer.offsetHeight + context.offsetHeight + 8 + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2) });
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
  const progress = shared.mountQuickProgress(quickContainer, { send, setIcon: shared.setCaptureIcon, resize });
  function setMode(value) {
    if (controller.isSaving()) return;
    mode = value; controller.form.hidden = mode !== 'create';
    if (mode === 'progress') progress.show(); else { progress.hide(); controller.focus(); }
    tabs.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    document.querySelector('.modal-title').textContent = mode === 'progress' ? '记录进展' : '新建任务'; resize();
  }
  for (const [value, text] of [['progress', '记录进展'], ['create', '新建任务']]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.dataset.mode = value; button.setAttribute('aria-pressed', String(value === mode)); button.onclick = () => setMode(value); tabs.append(button);
  }
  function dismiss() {
    if (mode === 'progress') { send({ action: 'progressDismiss' }); return; }
    if (!controller.isSaving() && !controller.isComposing()) send({ action: 'dismiss', draft: controller.read() });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229 && !controller.isComposing()) { event.preventDefault(); dismiss(); }
  });
  document.querySelector('#close').onclick = dismiss;
  document.querySelector('#location').onclick = () => send({ action: 'settings', draft: controller.read() });
  window.capture = {
    getDraft: controller.read, dismiss,
    update(state) {
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
      if ('location' in state) { const location = document.querySelector('#location'); location.textContent = state.location; location.title = state.directory || state.location; }
      if (state.error || groupError) {
        const message = state.error || groupError;
        if (mode === 'progress') progress.setError(message);
        if (rejectSubmit) { rejectSubmit(new Error(message)); resolveSubmit = rejectSubmit = null; }
        controller.setError(message);
      } else if ('error' in state) controller.setError('');
      if (state.draft === null && resolveSubmit) { resolveSubmit(); resolveSubmit = rejectSubmit = null; pending = null; }
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
