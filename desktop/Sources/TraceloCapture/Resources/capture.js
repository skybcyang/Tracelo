(() => {
  const shared = TraceloCreateTask;
  const send = message => {
    if (window.chrome?.webview) window.chrome.webview.postMessage(message);
    else window.webkit.messageHandlers.capture.postMessage(message);
  };
  let pending = null, resolveSubmit, rejectSubmit, configured = false, groupError = '', resizeScheduled = false, groupsSource;
  function resize() {
    if (resizeScheduled) return;
    resizeScheduled = true;
    requestAnimationFrame(() => {
      resizeScheduled = false;
      const modal = document.querySelector('.capture-modal');
      const header = document.querySelector('.modal-title');
      const context = document.querySelector('.capture-context');
      const style = getComputedStyle(modal);
      send({ action: 'resize', height: Math.ceil(header.offsetHeight + 12 + controller.body.scrollHeight + controller.footer.offsetHeight + context.offsetHeight + 8 + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2) });
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
        const task = shared.buildNewTask(values);
        pending = { key, request: { id: task.id, markdown: shared.serializeTaskMarkdown(task) } };
      }
      return new Promise((resolve, reject) => {
        resolveSubmit = resolve; rejectSubmit = reject;
        send({ action: 'submit', draft, request: pending.request });
      });
    },
  });
  controller.setAvailable(false);
  function dismiss() {
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
      if (state.resetPending) pending = null;
      if ('groupsSource' in state) {
        if (groupsSource !== state.groupsSource) pending = null;
        groupsSource = state.groupsSource;
        try { controller.setGroups(state.groupsSource ? shared.parseGroupArchive(state.groupsSource).groups : []); groupError = ''; }
        catch { groupError = '无法读取分组，请在插件中检查分组文件后重试'; }
      }
      if ('draft' in state && JSON.stringify(state.draft) !== JSON.stringify(controller.read())) controller.setDraft(state.draft);
      if ('configured' in state) configured = state.configured;
      controller.setAvailable(configured && !groupError);
      if ('dark' in state) document.body.classList.toggle('theme-dark', state.dark);
      if ('location' in state) { const location = document.querySelector('#location'); location.textContent = state.location; location.title = state.directory || state.location; }
      if (state.error || groupError) {
        const message = state.error || groupError;
        if (rejectSubmit) { rejectSubmit(new Error(message)); resolveSubmit = rejectSubmit = null; }
        controller.setError(message);
      } else if ('error' in state) controller.setError('');
      if (state.draft === null && resolveSubmit) { resolveSubmit(); resolveSubmit = rejectSubmit = null; pending = null; }
      if ('saving' in state) {
        controller.setSaving(state.saving);
        document.querySelector('#close').disabled = document.querySelector('#location').disabled = state.saving;
      }
      if (state.focus) controller.focus();
    },
  };
  window.addEventListener('resize', resize);
  send({ action: 'ready' });
})();
