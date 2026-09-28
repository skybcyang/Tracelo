import CaptureCore
import AppKit
import Carbon

final class CaptureTextView: NSTextView {
    var submit: (() -> Void)?
    var dismiss: (() -> Void)?
    override func keyDown(with event: NSEvent) {
        switch inputAction(keyCode: event.keyCode, shift: event.modifierFlags.contains(.shift), marked: hasMarkedText()) {
        case .submit: submit?()
        case .dismiss: dismiss?()
        case .system: super.keyDown(with: event)
        }
    }
}
final class CapturePanel: NSPanel {
    override var canBecomeKey: Bool { true }
}
final class ShortcutRecorder: NSTextField {
    var recorded: ((UInt32, UInt32, String) -> Void)?
    override var acceptsFirstResponder: Bool { true }
    override func mouseDown(with event: NSEvent) { window?.makeFirstResponder(self); stringValue = "请按组合键…" }
    override func keyDown(with event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard flags.contains(.command) || flags.contains(.control) || flags.contains(.option) else { stringValue = "请包含 ⌘、⌃ 或 ⌥"; return }
        var modifiers: UInt32 = 0
        if flags.contains(.command) { modifiers |= UInt32(cmdKey) }
        if flags.contains(.control) { modifiers |= UInt32(controlKey) }
        if flags.contains(.option) { modifiers |= UInt32(optionKey) }
        if flags.contains(.shift) { modifiers |= UInt32(shiftKey) }
        let label = (flags.contains(.control) ? "⌃" : "") + (flags.contains(.option) ? "⌥" : "") + (flags.contains(.shift) ? "⇧" : "") + (flags.contains(.command) ? "⌘" : "") + (event.charactersIgnoringModifiers ?? "?").uppercased()
        stringValue = label
        recorded?(UInt32(event.keyCode), modifiers, label)
    }
}
final class AppDelegate: NSObject, NSApplicationDelegate, NSTextViewDelegate, NSWindowDelegate {
    // Bundled builds already use this domain; keep CLI builds compatible with it.
    private let preferences = Bundle.main.bundleIdentifier == "app.tracelo.capture"
        ? UserDefaults.standard : UserDefaults(suiteName: "app.tracelo.capture")!
    private var statusItem: NSStatusItem!
    private var panel: CapturePanel!
    private var editor: CaptureTextView!
    private var hint: NSTextField!
    private var locationButton: NSButton!
    private var createButton: NSButton!
    private var previousApp: NSRunningApplication?
    private var hotKey: EventHotKeyRef?
    private var hotKeyHandler: EventHandlerRef?
    private var pending: CaptureRequest?
    private var pendingText: String?
    private var saving = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        if CommandLine.arguments.contains("--smoke-test") {
            buildPanel()
            precondition(panel.contentView!.bounds.width <= 560)
            precondition(createButton.title == "创建任务 ↵")
            precondition(editor.submit != nil && editor.dismiss != nil)
            print("macOS packaged app: startup, panel, input actions passed")
            exit(0)
        }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "square.and.pencil", accessibilityDescription: "Tracelo 快捷创建")
        let menu = NSMenu()
        for (title, action) in [("创建任务", #selector(show)), ("设置…", #selector(settings)), ("退出", #selector(quit))] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
            item.target = self
            menu.addItem(item)
        }
        statusItem.menu = menu
        buildPanel()
        var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, context in
            guard let context else { return OSStatus(eventNotHandledErr) }
            let delegate = Unmanaged<AppDelegate>.fromOpaque(context).takeUnretainedValue()
            delegate.toggle()
            return noErr
        }, 1, &event, Unmanaged.passUnretained(self).toOpaque(), &hotKeyHandler)
        let key = preferences.object(forKey: "shortcutKey") as? UInt32 ?? UInt32(kVK_Space)
        let modifiers = preferences.object(forKey: "shortcutModifiers") as? UInt32 ?? UInt32(controlKey | optionKey)
        if !register(key, modifiers) { alert("快捷键不可用", "该组合键已被占用或无法注册。仍可从菜单栏创建，并在设置中更换快捷键。") }
    }
    private func buildPanel() {
        panel = CapturePanel(contentRect: NSRect(x: 0, y: 0, width: 560, height: 260), styleMask: [.titled, .closable, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Tracelo · 快速创建"
        panel.delegate = self
        panel.isReleasedWhenClosed = false
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 560, height: 260))
        let label = NSTextField(labelWithString: "任务内容 · 第一行标题，其余内容保存为详情")
        label.font = .systemFont(ofSize: 12)
        label.textColor = .secondaryLabelColor
        label.frame = NSRect(x: 20, y: 224, width: 520, height: 20)
        label.autoresizingMask = [.width, .minYMargin]
        content.addSubview(label)
        let scroll = NSScrollView(frame: NSRect(x: 20, y: 108, width: 520, height: 108))
        scroll.autoresizingMask = [.width, .height]
        scroll.hasVerticalScroller = true
        scroll.borderType = .noBorder
        scroll.drawsBackground = false
        editor = CaptureTextView(frame: scroll.bounds)
        editor.isRichText = false
        editor.font = .systemFont(ofSize: 20, weight: .medium)
        editor.drawsBackground = false
        editor.textColor = .labelColor
        editor.setAccessibilityLabel("任务内容，第一行标题，其余内容保存为详情")
        editor.textContainerInset = NSSize(width: 0, height: 8)
        editor.isVerticallyResizable = true
        editor.isHorizontallyResizable = false
        editor.autoresizingMask = [.width]
        editor.textContainer?.widthTracksTextView = true
        editor.isAutomaticQuoteSubstitutionEnabled = false
        editor.isAutomaticDashSubstitutionEnabled = false
        editor.delegate = self
        editor.string = preferences.string(forKey: "draft") ?? ""
        editor.submit = { [weak self] in self?.submit() }
        editor.dismiss = { [weak self] in self?.dismiss() }
        scroll.documentView = editor
        content.addSubview(scroll)
        hint = NSTextField(wrappingLabelWithString: "")
        hint.font = .systemFont(ofSize: 12)
        hint.textColor = .secondaryLabelColor
        hint.frame = NSRect(x: 20, y: 66, width: 520, height: 34)
        hint.autoresizingMask = [.width]
        content.addSubview(hint)
        let separator = NSBox(frame: NSRect(x: 20, y: 58, width: 520, height: 1))
        separator.boxType = .separator
        separator.autoresizingMask = [.width]
        content.addSubview(separator)
        locationButton = NSButton(title: "设置保存位置", target: self, action: #selector(settings))
        locationButton.isBordered = false
        locationButton.alignment = .left
        locationButton.font = .systemFont(ofSize: 12)
        locationButton.frame = NSRect(x: 16, y: 33, width: 360, height: 22)
        locationButton.autoresizingMask = [.width]
        content.addSubview(locationButton)
        let keys = NSTextField(labelWithString: "⇧↵ 换行 · Esc 保留草稿")
        keys.font = .systemFont(ofSize: 12)
        keys.textColor = .secondaryLabelColor
        keys.frame = NSRect(x: 20, y: 12, width: 360, height: 18)
        keys.autoresizingMask = [.width]
        content.addSubview(keys)
        createButton = NSButton(title: "创建任务 ↵", target: self, action: #selector(submit))
        createButton.bezelStyle = .rounded
        createButton.contentTintColor = .white
        createButton.bezelColor = NSColor(srgbRed: 0.141, green: 0.357, blue: 0.906, alpha: 1)
        createButton.frame = NSRect(x: 400, y: 12, width: 140, height: 40)
        createButton.autoresizingMask = [.minXMargin]
        content.addSubview(createButton)
        panel.contentView = content
        refreshEditor()
    }
    func textDidChange(_ notification: Notification) {
        preferences.set(editor.string, forKey: "draft")
        if pendingText != editor.string { pending = nil; pendingText = nil }
        hint.stringValue = ""
        refreshEditor()
    }
    private func refreshEditor() {
        let configured = (try? CaptureConfiguration(vault: preferences.string(forKey: "vault") ?? "", taskDirectory: preferences.string(forKey: "taskDirectory") ?? "工作记录/任务").destination()) != nil
        locationButton.title = configured ? "\(URL(fileURLWithPath: preferences.string(forKey: "vault")!).lastPathComponent) · 未分组" : "设置保存位置…"
        locationButton.toolTip = preferences.string(forKey: "taskDirectory")
        createButton.isEnabled = configured && !saving && (try? CaptureDraft(editor.string)) != nil
        guard !editor.hasMarkedText() else { return }
        if let storage = editor.textStorage {
            let full = NSRange(location: 0, length: storage.length)
            storage.beginEditing()
            storage.addAttributes([.font: NSFont.systemFont(ofSize: 15), .foregroundColor: NSColor.labelColor], range: full)
            let title = (editor.string as NSString).lineRange(for: NSRange(location: 0, length: 0))
            storage.addAttribute(.font, value: NSFont.systemFont(ofSize: 20, weight: .medium), range: title)
            storage.endEditing()
        }
        if let layout = editor.layoutManager, let container = editor.textContainer {
            layout.ensureLayout(for: container)
            let available = (panel.screen ?? NSScreen.main)?.visibleFrame.size ?? CGSize(width: 1440, height: 900)
            let size = capturePanelSize(contentHeight: layout.usedRect(for: container).height, available: available)
            panel.setContentSize(size)
        }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { dismiss(); return false }
    func toggle() { if panel.isVisible { dismiss() } else { show() } }
    @objc func show() {
        if !panel.isVisible { previousApp = NSWorkspace.shared.frontmostApplication }
        let mouse = NSEvent.mouseLocation
        if let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) ?? NSScreen.main {
            let bounds = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: bounds.midX - panel.frame.width / 2, y: bounds.midY - panel.frame.height / 2))
        }
        panel.makeKeyAndOrderFront(nil)
        refreshEditor()
        if !editor.string.isEmpty { hint.stringValue = "已恢复草稿"; hint.textColor = .secondaryLabelColor }
        NSApp.activate(ignoringOtherApps: true)
        panel.makeFirstResponder(editor)
    }
    private func dismiss() {
        preferences.set(editor.string, forKey: "draft")
        panel.orderOut(nil)
        if previousApp?.processIdentifier != ProcessInfo.processInfo.processIdentifier { previousApp?.activate(options: []) }
        previousApp = nil
    }
    @objc private func submit() {
        guard !saving, !editor.hasMarkedText(), panel.isVisible else { return }
        saving = true
        defer { saving = false; refreshEditor() }
        do {
            let destination = try CaptureConfiguration(vault: preferences.string(forKey: "vault") ?? "", taskDirectory: preferences.string(forKey: "taskDirectory") ?? "工作记录/任务").destination()
            if pending == nil || pendingText != editor.string {
                pending = try CaptureRequest(text: editor.string)
                pendingText = editor.string
            }
            _ = try pending!.publish(to: destination)
            editor.string = ""
            preferences.removeObject(forKey: "draft")
            pending = nil; pendingText = nil
            hint.stringValue = ""
            dismiss()
        } catch { hint.stringValue = error.localizedDescription; hint.textColor = .systemRed }
    }
    private func register(_ key: UInt32, _ modifiers: UInt32) -> Bool {
        var candidate: EventHotKeyRef?
        let result = RegisterEventHotKey(key, modifiers, EventHotKeyID(signature: 0x5452434C, id: 1), GetApplicationEventTarget(), 0, &candidate)
        guard result == noErr else { return false }
        if let old = hotKey { UnregisterEventHotKey(old) }
        hotKey = candidate
        return true
    }
    @objc func settings() {
        let open = NSOpenPanel()
        open.title = "选择 Obsidian vault"
        open.canChooseDirectories = true; open.canChooseFiles = false
        if let vault = preferences.string(forKey: "vault") { open.directoryURL = URL(fileURLWithPath: vault) }
        NSApp.activate(ignoringOtherApps: true)
        guard open.runModal() == .OK, let vault = open.url else { return }
        let sheet = NSAlert()
        sheet.messageText = "任务目录与全局快捷键"
        sheet.informativeText = "填写插件设置中的实际任务目录（相对于 vault，目录须已存在）。默认：未分组、不重要不紧急。点击快捷键栏可录入新组合。"
        sheet.addButton(withTitle: "保存"); sheet.addButton(withTitle: "取消")
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 380, height: 70))
        let directory = NSTextField(string: preferences.string(forKey: "taskDirectory") ?? "工作记录/任务")
        directory.frame = NSRect(x: 0, y: 42, width: 380, height: 24)
        directory.setAccessibilityLabel("任务相对目录")
        let recorder = ShortcutRecorder(string: preferences.string(forKey: "shortcutLabel") ?? "⌃⌥空格")
        recorder.isEditable = false
        recorder.frame = NSRect(x: 0, y: 4, width: 380, height: 26)
        recorder.setAccessibilityLabel("全局快捷键，点击录入")
        var shortcut: (UInt32, UInt32, String)?
        recorder.recorded = { shortcut = ($0, $1, $2) }
        view.addSubview(directory); view.addSubview(recorder)
        sheet.accessoryView = view
        guard sheet.runModal() == .alertFirstButtonReturn else { return }
        do {
            _ = try CaptureConfiguration(vault: vault.path, taskDirectory: directory.stringValue).destination()
            if let (key, modifiers, label) = shortcut {
                let oldKey = preferences.object(forKey: "shortcutKey") as? UInt32 ?? UInt32(kVK_Space)
                let oldModifiers = preferences.object(forKey: "shortcutModifiers") as? UInt32 ?? UInt32(controlKey | optionKey)
                if key != oldKey || modifiers != oldModifiers {
                    guard register(key, modifiers) else { alert("快捷键冲突", "该组合键无法注册，原快捷键和设置已保留。"); return }
                    preferences.set(key, forKey: "shortcutKey"); preferences.set(modifiers, forKey: "shortcutModifiers")
                    preferences.set(label, forKey: "shortcutLabel")
                }
            }
            preferences.set(vault.path, forKey: "vault")
            preferences.set(directory.stringValue, forKey: "taskDirectory")
            refreshEditor()
        } catch { alert("设置未保存", error.localizedDescription) }
    }
    private func alert(_ title: String, _ message: String) {
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = message; alert.runModal()
    }
    @objc func quit() { NSApp.terminate(nil) }
}
let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
