import CaptureCore
import AppKit
import Carbon

final class CapturePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown, event.locationInWindow.y > frame.height - 50, event.locationInWindow.x < frame.width - 64 {
            performDrag(with: event)
        } else { super.sendEvent(event) }
    }
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
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    // Bundled builds already use this domain; keep CLI builds compatible with it.
    private let preferences = Bundle.main.bundleIdentifier == "app.tracelo.capture"
        ? UserDefaults.standard : UserDefaults(suiteName: "app.tracelo.capture")!
    private var statusItem: NSStatusItem!
    private var panel: CapturePanel!
    private var surface: CaptureSurface!
    private var draft: CaptureFormDraft?
    private var draftLoadError: String?
    private var errorMessage = ""
    private var groupsSource: String?
    private let smoke = CommandLine.arguments.contains("--smoke-test")
    private var previousApp: NSRunningApplication?
    private var hotKey: EventHotKeyRef?
    private var hotKeyHandler: EventHandlerRef?
    private var pending: CaptureRequest?
    private var pendingDraftData: Data?
    private var saving = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        if smoke {
            buildPanel()
            panel.orderFront(nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) { fputs("Capture WebKit startup timed out\n", stderr); exit(1) }
            return
        }
        let mainMenu = NSMenu()
        let applicationItem = NSMenuItem()
        let applicationMenu = NSMenu()
        let quitItem = NSMenuItem(title: "退出 Tracelo", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        applicationMenu.addItem(quitItem)
        applicationItem.submenu = applicationMenu
        mainMenu.addItem(applicationItem)
        let edit = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        for (title, selector, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: NSSelectorFromString(selector), keyEquivalent: key)
        }
        edit.submenu = editMenu; mainMenu.addItem(edit); NSApp.mainMenu = mainMenu
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
        if CommandLine.arguments.contains("--show") { show() }
    }
    private func buildPanel() {
        panel = CapturePanel(contentRect: NSRect(x: 0, y: 0, width: 560, height: 360), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Tracelo · 新建任务"
        panel.delegate = self
        panel.isReleasedWhenClosed = false
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        surface = CaptureSurface()
        surface.view.frame = NSRect(x: 0, y: 0, width: 560, height: 360)
        surface.view.wantsLayer = true
        surface.view.layer?.cornerRadius = 10
        surface.view.layer?.masksToBounds = true
        panel.contentView = surface.view
        if !smoke {
            do {
                if let data = preferences.data(forKey: "captureDraftJSON") { draft = try CaptureFormDraft(data: data) }
                else if let legacy = preferences.string(forKey: "captureDraft") ?? preferences.string(forKey: "draft"), !legacy.isEmpty {
                    draft = CaptureFormDraft(legacyText: legacy)
                    preferences.set(draft!.data, forKey: "captureDraftJSON")
                }
            } catch { draftLoadError = "无法读取上次草稿，原数据已保留：\(error.localizedDescription)" }
        }
        surface.action = { [weak self] name, value in self?.receive(name, value) }
        do { try surface.load() }
        catch { fputs("Capture interface could not load: \(error)\n", stderr); if smoke { exit(1) }; alert("无法打开快捷记录", error.localizedDescription); NSApp.terminate(nil) }
        refreshSurface()
    }
    private func receive(_ name: String, _ value: [String: Any]) {
        if ["change", "submit", "dismiss", "settings"].contains(name) {
            do {
                guard draftLoadError == nil else { throw CaptureError.invalid(draftLoadError!) }
                if let values = value["draft"] as? [String: Any] { draft = try CaptureFormDraft(json: values) }
                else if value["draft"] is NSNull { draft = nil }
                else { throw CaptureError.invalid("表单草稿未能读取，未更改保存内容") }
                persistDraft()
                if pendingDraftData != draft?.data { pending = nil; pendingDraftData = nil }
                errorMessage = ""
            } catch { errorMessage = error.localizedDescription; refreshSurface(); return }
        }
        switch name {
        case "ready":
            if smoke {
                let index = CommandLine.arguments.firstIndex(of: "--screenshots")
                let path = index.flatMap { $0 + 1 < CommandLine.arguments.count ? URL(fileURLWithPath: CommandLine.arguments[$0 + 1]) : nil }
                surface.smokeTest(screenshots: path) { passed in
                    print(passed ? "macOS shared form: independent title/details, four quadrants, group selector, plugin styles, light/dark, focus and footer passed" : "macOS capture interface verification failed")
                    exit(passed ? 0 : 1)
                }
            } else { refreshSurface(); surface.update(["focus": panel.isVisible]) }
        case "submit":
            if !smoke {
                guard let request = value["request"] as? [String: Any] else {
                    errorMessage = "表单未生成任务存档，草稿已保留"; refreshSurface(); return
                }
                submit(request)
            }
        case "dismiss": if !smoke { dismiss() }
        case "settings": if !smoke { settings() }
        case "resize":
            if let height = value["height"] as? Double, height.isFinite {
                let available = (panel.screen ?? NSScreen.main)?.visibleFrame.size ?? CGSize(width: 1440, height: 900)
                let size = capturePanelSize(contentHeight: max(0, min(height, 2000) - 160), available: available)
                if abs(panel.frame.height - size.height) > 1 || abs(panel.frame.width - size.width) > 1 {
                    panel.setContentSize(size)
                    constrainPanelToScreen()
                }
            }
        default: break
        }
    }
    private func persistDraft() {
        guard !smoke, draftLoadError == nil else { return }
        if let draft { preferences.set(draft.data, forKey: "captureDraftJSON") }
        else {
            preferences.removeObject(forKey: "captureDraftJSON")
            preferences.removeObject(forKey: "captureDraft")
            preferences.removeObject(forKey: "draft")
        }
    }
    private func configuration() -> CaptureConfiguration {
        CaptureConfiguration(vault: preferences.string(forKey: "vault") ?? "", taskDirectory: preferences.string(forKey: "taskDirectory") ?? "工作记录/任务")
    }
    private func refreshSurface() {
        var configured = false
        var configurationError = ""
        do {
            let latestGroups = try configuration().groupsSource()
            if groupsSource != latestGroups { pending = nil; pendingDraftData = nil }
            groupsSource = latestGroups
            configured = draftLoadError == nil
        } catch {
            groupsSource = nil
            if !(preferences.string(forKey: "vault") ?? "").isEmpty { configurationError = error.localizedDescription }
        }
        surface.update(["draft": draft?.values as Any? ?? NSNull(), "configured": configured, "saving": saving,
            "location": configured ? URL(fileURLWithPath: preferences.string(forKey: "vault")!).lastPathComponent : "设置保存位置…",
            "directory": preferences.string(forKey: "taskDirectory") ?? "",
            "groupsSource": groupsSource as Any? ?? NSNull(),
            "error": draftLoadError ?? (errorMessage.isEmpty ? configurationError : errorMessage),
            "restored": draft != nil,
            "dark": NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua])
    }
    private func constrainPanelToScreen() {
        guard let bounds = (panel.screen ?? NSScreen.main)?.visibleFrame else { return }
        let origin = NSPoint(x: min(max(panel.frame.minX, bounds.minX + 16), bounds.maxX - panel.frame.width - 16),
            y: min(max(panel.frame.minY, bounds.minY + 16), bounds.maxY - panel.frame.height - 16))
        panel.setFrameOrigin(origin)
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
        refreshSurface()
        if let screen = panel.screen {
            let bounds = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: bounds.midX - panel.frame.width / 2, y: bounds.midY - panel.frame.height / 2))
        }
        NSApp.activate(ignoringOtherApps: true)
        panel.makeFirstResponder(surface.view)
        surface.update(["focus": true, "restored": draft != nil])
    }
    private func dismiss() {
        persistDraft()
        panel.orderOut(nil)
        if previousApp?.processIdentifier != ProcessInfo.processInfo.processIdentifier { previousApp?.activate(options: []) }
        previousApp = nil
    }
    private func submit(_ request: [String: Any]) {
        guard !saving, panel.isVisible else { return }
        saving = true
        defer { saving = false; refreshSurface() }
        do {
            let destination = try configuration().destination()
            let currentGroups = try configuration().groupsSource()
            guard currentGroups == groupsSource else { throw CaptureError.invalid("分组档案已更新，请确认当前分组后重新创建；草稿已保留") }
            guard let id = request["id"] as? String, let markdown = request["markdown"] as? String else {
                throw CaptureError.invalid("任务存档请求无效，草稿已保留")
            }
            let incoming = try CaptureRequest(id: id, markdown: markdown)
            if pending == nil || pendingDraftData != draft?.data {
                pending = incoming
                pendingDraftData = draft?.data
            }
            _ = try pending!.publish(to: destination)
            draft = nil
            persistDraft()
            pending = nil; pendingDraftData = nil
            errorMessage = ""
            surface.update(["draft": NSNull(), "error": "", "restored": false])
            dismiss()
        } catch { errorMessage = error.localizedDescription }
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
        sheet.informativeText = "填写插件设置中的实际任务目录（相对于 vault，目录须已存在）。分组与任务字段由共享创建表单提供。点击快捷键栏可录入新组合。"
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
            let destinationChanged = preferences.string(forKey: "vault") != vault.path
                || (preferences.string(forKey: "taskDirectory") ?? "工作记录/任务") != directory.stringValue
            preferences.set(vault.path, forKey: "vault")
            preferences.set(directory.stringValue, forKey: "taskDirectory")
            if destinationChanged {
                pending = nil; pendingDraftData = nil
                surface.update(["resetPending": true])
            }
            errorMessage = ""
            refreshSurface()
        } catch { alert("设置未保存", error.localizedDescription) }
    }
    private func alert(_ title: String, _ message: String) {
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = message; alert.runModal()
    }
    @objc func quit() {
        persistDraft()
        preferences.synchronize()
        NSApp.terminate(nil)
    }
}
let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
