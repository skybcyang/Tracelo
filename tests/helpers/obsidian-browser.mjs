// Host boundary only: real plugin rendering, domain operations and archive storage run unchanged.
// setIcon deliberately models Obsidian 1.13.7's first-child replacement behavior.
HTMLElement.prototype.createEl = function (tag, options = {}) {
  const el = document.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text !== undefined) el.textContent = options.text;
  if (options.type) el.setAttribute("type", options.type);
  for (const [key, value] of Object.entries(options.attr || {})) el.setAttribute(key, value);
  this.appendChild(el);
  return el;
};
HTMLElement.prototype.createDiv = function (options) { return this.createEl("div", options); };
HTMLElement.prototype.createSpan = function (options) { return this.createEl("span", options); };
HTMLElement.prototype.empty = function () { this.replaceChildren(); };
HTMLElement.prototype.addClass = function (name) { this.classList.add(name); };
HTMLElement.prototype.removeClass = function (name) { this.classList.remove(name); };
HTMLElement.prototype.setText = function (text) { this.textContent = text; };
HTMLElement.prototype.setAttr = function (name, value) { this.setAttribute(name, value); };

export function setIcon(el, name) {
  el.firstChild?.remove();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", name);
  svg.setAttribute("viewBox", "0 0 24 24");
  el.appendChild(svg);
}
export class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
  async loadData() { return this.data ?? null; }
  async saveData(data) { this.data = structuredClone(data); }
  registerView(type, factory) { this.app.factories.set(type, factory); }
  addRibbonIcon() {}
  addCommand() {}
  addSettingTab() {}
  registerEvent() {}
}
export class ItemView {
  constructor(leaf) {
    this.app = leaf.app;
    this.contentEl = document.body.createDiv({ cls: "view-content" });
  }
  registerInterval() {}
}
export class Modal {
  constructor(app) {
    this.app = app;
    this.containerEl = document.createElement("div");
    this.containerEl.className = "modal-container";
    this.containerEl.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:100;background:rgba(15,23,42,.25)";
    this.modalEl = document.createElement("div");
    this.modalEl.className = "modal";
    this.containerEl.append(this.modalEl);
    this.titleEl = this.modalEl.createEl("h2", { cls: "modal-title" });
    this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
  }
  setTitle(title) { this.titleEl.textContent = title; }
  open() { document.body.append(this.containerEl); this.onOpen(); }
  close() { this.onClose?.(); this.containerEl.remove(); }
}
export class Notice {
  constructor(text) { this.messageEl = document.body.createDiv({ cls: "notice", text }); }
  hide() { this.messageEl.remove(); }
}
export class PluginSettingTab { constructor(app) { this.app = app; } }
export class App {}
export class WorkspaceLeaf {}
export class TFile {}
export class TFolder { constructor(path) { this.path = path; } }
export class FileSystemAdapter { getFullPath(path) { return '/test-vault/' + path; } }
export const Platform = { isDesktopApp: true };
export class Setting {}
export class Menu {
  constructor() { this.el = document.createElement('div'); this.el.setAttribute('role', 'menu'); }
  addItem(build) {
    const button = this.el.createEl('button', { attr: { role: 'menuitem' } });
    const item = {
      setTitle(text) { button.textContent = text; return item; },
      setIcon() { return item; }, setChecked() { return item; },
      setDisabled(value) { button.disabled = value; return item; },
      onClick(callback) { button.onclick = () => { button.closest('[role=menu]').remove(); callback(); }; return item; },
    };
    build(item); return this;
  }
  addSeparator() { return this; }
  showAtMouseEvent() { document.querySelector('[role=menu]')?.remove(); document.body.append(this.el); }
}

export function createApp() {
  const files = new Map();
  const folders = new Set();
  const leaves = [];
  const listeners = new Map();
  const emit = (name, ...args) => (listeners.get(name) || []).forEach(fn => fn(...args));
  const app = {
    factories: new Map(),
    vault: {
      configDir: ".obsidian",
      on(name, fn) { listeners.set(name, [...(listeners.get(name) || []), fn]); },
      getAbstractFileByPath(path) { return folders.has(path) ? new TFolder(path) : files.has(path) ? Object.assign(new TFile(), { path }) : null; },
      async createFolder(path) { if (await this.adapter.exists(path)) throw new Error('Already exists'); await this.adapter.mkdir(path); const folder = new TFolder(path); emit('create', folder); return folder; },
      adapter: {
        getFullPath(path) { return '/test-vault/' + path; },
        async exists(path) { return files.has(path) || folders.has(path); },
        async read(path) { if (!files.has(path)) throw new Error("Missing " + path); return files.get(path); },
        async write(path, source) { files.set(path, source); },
        async stat(path) { return files.has(path) ? { type: 'file', size: files.get(path).length ?? files.get(path).byteLength } : folders.has(path) ? { type: 'folder', size: 0 } : null; },
        async readBinary(path) { const value = files.get(path); if (value === undefined) throw new Error('Missing ' + path); return typeof value === 'string' ? new TextEncoder().encode(value).buffer : value; },
        async writeBinary(path, bytes) { files.set(path, bytes); },
        async rename(path, next) {
          if (await this.exists(next)) throw new Error('Already exists');
          for (const [key, value] of [...files]) if (key === path || key.startsWith(path + '/')) { files.set(next + key.slice(path.length), value); files.delete(key); }
          for (const key of [...folders]) if (key === path || key.startsWith(path + '/')) { folders.add(next + key.slice(path.length)); folders.delete(key); }
        },
        async mkdir(path) { folders.add(path); },
        async list(path) {
          const direct = (candidate) => candidate.startsWith(path + "/") && !candidate.slice(path.length + 1).includes("/");
          return { files: [...files.keys()].filter(direct), folders: [...folders].filter(direct) };
        },
        async remove(path) { files.delete(path); },
        async rmdir(path) {
          for (const key of files.keys()) if (key.startsWith(path + "/")) files.delete(key);
          for (const key of folders) if (key === path || key.startsWith(path + "/")) folders.delete(key);
        },
      },
    },
    workspace: {
      getLeavesOfType(type) { return leaves.filter((leaf) => leaf.type === type); },
      getLeaf() {
        const leaf = {
          app,
          async setViewState({ type }) {
            this.type = type;
            this.view = app.factories.get(type)(this);
            await this.view.onOpen();
          },
        };
        leaves.push(leaf);
        return leaf;
      },
      async revealLeaf() {},
      detachLeavesOfType() {},
    },
  };
  Object.setPrototypeOf(app.vault.adapter, FileSystemAdapter.prototype);
  app.openedFolders = [];
  window.require = (name) => { if (name !== 'electron') throw new Error(name); return { shell: { openPath: async (path) => { app.openedFolders.push(path); return app.openError || ''; } } }; };
  return app;
}
