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
    private let preferences = CommandLine.arguments.contains("--smart-smoke-test") ? UserDefaults(suiteName: "app.tracelo.capture.qa.\(ProcessInfo.processInfo.processIdentifier)")! : Bundle.main.bundleIdentifier == "app.tracelo.capture"
        ? UserDefaults.standard : UserDefaults(suiteName: "app.tracelo.capture")!
    private var statusItem: NSStatusItem!
    private var panel: CapturePanel!
    private var surface: CaptureSurface!
    private var draft: CaptureFormDraft?
    private var draftLoadError: String?
    private var errorMessage = ""
    private var groupsSource: String?
    private let smartSmoke = CommandLine.arguments.contains("--smart-smoke-test")
    private let smoke = CommandLine.arguments.contains("--smoke-test") || CommandLine.arguments.contains("--smart-smoke-test")
    private var previousApp: NSRunningApplication?
    private var hotKey: EventHotKeyRef?
    private var progressHotKey: EventHotKeyRef?
    private var hotKeyHandler: EventHandlerRef?
    private var pending: CaptureRequest?
    private var pendingDraftData: Data?
    private var saving = false
    private let persistence = CommandLine.arguments.contains("--smart-smoke-test") ? CapturePersistence(root: FileManager.default.temporaryDirectory.appendingPathComponent("tracelo-smart-native-\(ProcessInfo.processInfo.processIdentifier)/drafts")) : CapturePersistence()
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        if smoke {
            if smartSmoke {
                do {
                    guard let index = CommandLine.arguments.firstIndex(of: "--key-file"), index + 1 < CommandLine.arguments.count else { throw CaptureError.invalid("请提供测试密钥文件路径") }
                    let vault = persistence.root.deletingLastPathComponent().appendingPathComponent("vault")
                    try FileManager.default.createDirectory(at: vault.appendingPathComponent("tasks"), withIntermediateDirectories: true)
                    preferences.set(vault.path, forKey: "vault"); preferences.set("tasks", forKey: "taskDirectory")
                    let config = ["baseUrl": ProcessInfo.processInfo.environment["TRACELO_AI_BASE_URL"] ?? "https://api.kimi.com/coding/v1", "model": ProcessInfo.processInfo.environment["TRACELO_AI_MODEL"] ?? "kimi-for-coding", "keyFile": CommandLine.arguments[index + 1]]
                    try persistence.save("smart." + workspaceKey, data: JSONSerialization.data(withJSONObject: ["config": config, "drafts": [:]]))
                } catch { fputs("Smart native QA setup failed\n", stderr); exit(1) }
            }
            buildPanel()
            panel.orderFront(nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + (smartSmoke ? 190 : 20)) { fputs("Capture WebKit test timed out\n", stderr); exit(1) }
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
        for (title, action) in [("创建任务", #selector(show)), ("记录进展", #selector(showProgress)), ("设置…", #selector(settings)), ("退出", #selector(quit))] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
            item.target = self
            menu.addItem(item)
        }
        statusItem.menu = menu
        buildPanel()
        var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let context else { return OSStatus(eventNotHandledErr) }
            let delegate = Unmanaged<AppDelegate>.fromOpaque(context).takeUnretainedValue()
            var identifier = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &identifier)
            if identifier.id == 2 { delegate.showProgress() } else { delegate.toggle() }
            return noErr
        }, 1, &event, Unmanaged.passUnretained(self).toOpaque(), &hotKeyHandler)
        let key = preferences.object(forKey: "shortcutKey") as? UInt32 ?? UInt32(kVK_Space)
        let modifiers = preferences.object(forKey: "shortcutModifiers") as? UInt32 ?? UInt32(controlKey | optionKey)
        if !register(key, modifiers) { alert("快捷键不可用", "该组合键已被占用或无法注册。仍可从菜单栏创建，并在设置中更换快捷键。") }
        if !registerProgress(preferences.object(forKey: "progressKey") as? UInt32 ?? UInt32(kVK_ANSI_P), preferences.object(forKey: "progressModifiers") as? UInt32 ?? UInt32(controlKey | optionKey)) { alert("进展快捷键不可用", "⌃⌥P 已被占用，仍可从菜单栏记录进展；请在设置中更换。") }
        Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in if self?.panel.isVisible == true { self?.refreshQuick() } }
        if CommandLine.arguments.contains("--show") { show() }
    }
    private func buildPanel() {
        panel = CapturePanel(contentRect: NSRect(x: 0, y: 0, width: 530, height: 360), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
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
        surface.view.frame = NSRect(x: 0, y: 0, width: 530, height: 360)
        surface.view.wantsLayer = true
        surface.view.layer?.cornerRadius = 10
        surface.view.layer?.masksToBounds = true
        panel.contentView = surface.view
        if !smoke {
            do {
                if let data = try persistence.load(draftKey) { draft = try CaptureFormDraft(data: data) }
                else if !preferences.bool(forKey: "scopedDraftMigrated"), let data = preferences.data(forKey: "captureDraftJSON") { draft = try CaptureFormDraft(data: data); try persistDraft(); preferences.set(true, forKey: "scopedDraftMigrated") }
                else if !preferences.bool(forKey: "scopedDraftMigrated"), let legacy = preferences.string(forKey: "captureDraft") ?? preferences.string(forKey: "draft"), !legacy.isEmpty {
                    draft = CaptureFormDraft(legacyText: legacy)
                    try persistDraft()
                }
            } catch { draftLoadError = "无法读取上次草稿，原数据已保留：\(error.localizedDescription)" }
        }
        surface.action = { [weak self] name, value in self?.receive(name, value) }
        do { try surface.load() }
        catch { fputs("Capture interface could not load: \(error)\n", stderr); if smoke { exit(1) }; alert("无法打开快捷记录", error.localizedDescription); NSApp.terminate(nil) }
        // Smoke tests supply isolated sample state after WebKit is ready.
        // Loading a real vault here can override their appearance and drafts.
        if !smoke { refreshSurface() }
    }
    private func receive(_ name: String, _ value: [String: Any]) {
        if ["change", "submit", "dismiss", "settings"].contains(name) {
            do {
                guard draftLoadError == nil else { throw CaptureError.invalid(draftLoadError!) }
                if let values = value["draft"] as? [String: Any] { draft = try CaptureFormDraft(json: values) }
                else if value["draft"] is NSNull { draft = nil }
                else { throw CaptureError.invalid("表单草稿未能读取，未更改保存内容") }
                try persistDraft()
                if pendingDraftData != draft?.data { pending = nil; pendingDraftData = nil }
                errorMessage = ""
            } catch { errorMessage = error.localizedDescription; refreshSurface(); return }
        }
        switch name {
        case "smart": receiveSmart(value)
        case "progressDraft":
            if let id = value["taskId"] as? String, let text = value["text"] as? String {
                do { var drafts = try readProgressDrafts(); drafts[id] = text; try persistence.save(progressDraftKey, data: JSONSerialization.data(withJSONObject: drafts)) }
                catch { surface.update(["quickError": "草稿未能保存：" + error.localizedDescription]) }
            }
        case "operation":
            do {
                guard let operation = value["operation"] as? [String: Any] else { throw CaptureError.invalid("快捷操作无效") }
                try QuickWorkspace(directory: configuration().destination()).enqueue(operation)
                refreshQuick()
            } catch {
                let id = (value["operation"] as? [String: Any])?["id"] as? String ?? ""
                surface.update(["receipts": [["id": id, "status": "failed", "message": error.localizedDescription]]])
            }
        case "progressDismiss", "progressComplete": if !smoke { dismiss() }
        case "openTaskFolder":
            if let requestedPath = value["path"] as? String, let tasks = try? QuickWorkspace(directory: configuration().destination()).tasks(),
                let task = tasks.first(where: { ($0["path"] as? String) == requestedPath }), let path = task["path"] as? String {
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
            }
        case "ready":
            if smoke {
                let index = CommandLine.arguments.firstIndex(of: "--screenshots")
                let path = index.flatMap { $0 + 1 < CommandLine.arguments.count ? URL(fileURLWithPath: CommandLine.arguments[$0 + 1]) : nil }
                if smartSmoke {
                    refreshSurface()
                    surface.smartSmokeTest(screenshots: path) { [weak self] passed in
                        guard let self else { exit(1) }
                        let workspace = try? QuickWorkspace(directory: self.configuration().destination())
                        let receipts = try? workspace?.receipts()
                        let queued = receipts?.contains { ($0["status"] as? String) == "queued" && (($0["operation"] as? [String: Any])?["kind"] as? String) == "smart_progress" } == true
                        self.preferences.removePersistentDomain(forName: "app.tracelo.capture.qa.\(ProcessInfo.processInfo.processIdentifier)")
                        print(passed && queued ? "PASS native WebKit: real model, confirmed task on disk, durable offline smart progress, draft recovery" : "FAIL native smart capture")
                        print("Isolated artifacts: " + self.persistence.root.deletingLastPathComponent().path)
                        exit(passed && queued ? 0 : 1)
                    }
                    return
                }
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
    private func persistDraft() throws {
        guard !smoke, draftLoadError == nil else { return }
        try persistence.save(draftKey, data: draft?.data)
        preferences.set(true, forKey: "scopedDraftMigrated")
    }
    private func receiveSmart(_ message: [String: Any]) {
        guard let id = message["id"] as? String, let method = message["method"] as? String,
              let params = message["params"] as? [String: Any] else { return }
        let reply: (Any?, String?) -> Void = { [weak self] result, error in
            self?.surface.update(["smartReply": ["id": id, "result": result ?? NSNull(), "error": error as Any? ?? NSNull()]])
        }
        do {
            guard message["workspace"] as? String == workspaceKey else { throw CaptureError.invalid("保存位置已变化，请重新打开一句话录入") }
            let key = "smart." + workspaceKey
            var state: [String: Any] = [:]
            if let data = try persistence.load(key) {
                guard let saved = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw CaptureError.invalid("一句话草稿无法读取，原数据已保留") }
                state = saved
            }
            switch method {
            case "read":
                if state["config"] == nil, let vault = preferences.string(forKey: "vault"),
                   let data = try? Data(contentsOf: URL(fileURLWithPath: vault).appendingPathComponent(".obsidian/plugins/work-timeline/data.json")),
                   let plugin = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let config = plugin["smartCapture"] as? [String: Any] {
                    state["config"] = try? SmartCaptureTransport.configuration(config)
                }
                reply(state, nil)
            case "draft":
                // Includes up to 40 MB of base64 images and a recoverable previous result.
                guard let scope = params["scope"] as? String, scope.count < 240, let value = params["value"] as? String, value.utf8.count < 160 * 1024 * 1024 else { throw CaptureError.invalid("草稿过大或格式无效") }
                var drafts = state["drafts"] as? [String: String] ?? [:]
                if value.isEmpty { drafts.removeValue(forKey: scope) } else { drafts[scope] = value }
                state["drafts"] = drafts
                try persistence.save(key, data: JSONSerialization.data(withJSONObject: state)); reply(nil, nil)
            case "configure":
                guard let config = params["config"] as? [String: Any] else { throw CaptureError.invalid("模型配置无效") }
                state["config"] = try SmartCaptureTransport.configuration(config)
                try persistence.save(key, data: JSONSerialization.data(withJSONObject: state)); reply(nil, nil)
            case "pickKey":
                let picker = NSOpenPanel(); picker.canChooseFiles = true; picker.canChooseDirectories = false; picker.allowsMultipleSelection = false
                picker.title = "选择密钥文件"; reply(picker.runModal() == .OK ? picker.url?.path : nil, nil)
            case "request":
                guard let config = params["config"] as? [String: Any], let request = params["request"] as? [String: Any] else { throw CaptureError.invalid("模型请求无效") }
                Task {
                    do { let response = try await SmartCaptureTransport().send(config: config, request: request); await MainActor.run { reply(response, nil) } }
                    catch { await MainActor.run { reply(nil, error.localizedDescription) } }
                }
            case "create":
                guard let request = params["request"] as? [String: Any], let taskId = request["id"] as? String, let markdown = request["markdown"] as? String else { throw CaptureError.invalid("新建任务数据无效") }
                guard try configuration().groupsSource() == params["groupsSource"] as? String else { throw CaptureError.invalid("分组已变化，请关闭并重新确认后保存") }
                _ = try CaptureRequest(id: taskId, markdown: markdown).publish(to: configuration().destination(), attachments: request["attachments"] as? [[String: String]] ?? [])
                reply(nil, nil); refreshQuick()
            case "progress":
                guard let operation = params["operation"] as? [String: Any], operation["kind"] as? String == "smart_progress" else { throw CaptureError.invalid("进展操作无效") }
                try QuickWorkspace(directory: configuration().destination()).enqueue(operation)
                reply("queued", nil)
            default: throw CaptureError.invalid("不支持的一句话操作")
            }
        } catch { reply(nil, error.localizedDescription) }
    }
    private var workspaceKey: String { (preferences.string(forKey: "vault") ?? "") + "\n" + (preferences.string(forKey: "taskDirectory") ?? "工作记录/任务") }
    private var draftKey: String { "creationDraft." + Data(workspaceKey.utf8).base64EncodedString() }
    private var progressDraftKey: String { "progressDraft." + Data(workspaceKey.utf8).base64EncodedString() }
    private func readProgressDrafts() throws -> [String: String] {
        guard let data = try persistence.load(progressDraftKey) else { return [:] }
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: String] else { throw CaptureError.invalid("进展草稿无法读取，原数据已保留") }
        return value
    }
    private func refreshQuick() {
        do {
            let workspace = try QuickWorkspace(directory: configuration().destination())
            surface.update(["tasks": try workspace.tasks(), "receipts": try workspace.receipts(), "uiSettings": workspace.uiSettings(), "dark": NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua])
        } catch { surface.update(["quickError": error.localizedDescription]) }
    }
    private func configuration() -> CaptureConfiguration {
        CaptureConfiguration(vault: preferences.string(forKey: "vault") ?? "", taskDirectory: preferences.string(forKey: "taskDirectory") ?? "工作记录/任务")
    }
    private func refreshSurface() {
        var configured = false
        var configurationError = ""
        var progressDrafts: [String: String] = [:]
        var progressError = ""
        do { progressDrafts = try readProgressDrafts() }
        catch { progressError = "进展草稿未能读取，原数据已保留：" + error.localizedDescription }
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
            "workspace": workspaceKey, "progressDrafts": progressDrafts, "progressError": progressError,
            "location": configured ? URL(fileURLWithPath: preferences.string(forKey: "vault")!).lastPathComponent : "设置保存位置…",
            "directory": preferences.string(forKey: "taskDirectory") ?? "",
            "groupsSource": groupsSource as Any? ?? NSNull(),
            "error": draftLoadError ?? (errorMessage.isEmpty ? configurationError : errorMessage),
            "restored": draft != nil,
            "dark": NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua])
        refreshQuick()
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
        surface.update(["mode": "create", "focus": true, "restored": draft != nil])
    }
    @objc func showProgress() { show(); surface.update(["mode": "progress"]) }
    private func dismiss() {
        do { try persistDraft() } catch { errorMessage = "草稿未能保存：" + error.localizedDescription; refreshSurface(); return }
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
            var attachments = request["attachments"] as? [[String: String]] ?? []
            if let bytes = try persistence.load(draftKey + ".pending"), let saved = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                saved["draft"] as? String == draft?.data.base64EncodedString(), let stored = saved["request"] as? [String: Any], let storedId = stored["id"] as? String, let source = stored["markdown"] as? String {
                pending = try CaptureRequest(id: storedId, markdown: source); pendingDraftData = draft?.data
                attachments = stored["attachments"] as? [[String: String]] ?? []
            }
            if pending == nil || pendingDraftData != draft?.data {
                pending = incoming
                pendingDraftData = draft?.data
            }
            let savedRequest: [String: Any] = ["id": pending!.id, "markdown": pending!.markdown, "attachments": attachments]
            try persistence.save(draftKey + ".pending", data: JSONSerialization.data(withJSONObject: ["draft": draft?.data.base64EncodedString() ?? "", "request": savedRequest]))
            _ = try pending!.publish(to: destination, attachments: attachments)
            let previousDraft = draft; draft = nil
            do { try persistDraft() } catch { draft = previousDraft; throw error }
            try persistence.save(draftKey + ".pending", data: nil)
            pending = nil; pendingDraftData = nil
            errorMessage = ""
            surface.update(["draft": NSNull(), "error": "", "restored": false])
            // The shared form confirms this completed write, then requests dismissal.
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
    private func registerProgress(_ key: UInt32, _ modifiers: UInt32) -> Bool {
        var candidate: EventHotKeyRef?
        guard RegisterEventHotKey(key, modifiers, EventHotKeyID(signature: 0x5452434C, id: 2), GetApplicationEventTarget(), 0, &candidate) == noErr else { return false }
        if let old = progressHotKey { UnregisterEventHotKey(old) }; progressHotKey = candidate; return true
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
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 380, height: 108))
        let directory = NSTextField(string: preferences.string(forKey: "taskDirectory") ?? "工作记录/任务")
        directory.frame = NSRect(x: 0, y: 80, width: 380, height: 24)
        directory.setAccessibilityLabel("任务相对目录")
        let recorder = ShortcutRecorder(string: preferences.string(forKey: "shortcutLabel") ?? "⌃⌥空格")
        recorder.isEditable = false
        recorder.frame = NSRect(x: 0, y: 42, width: 380, height: 26)
        recorder.setAccessibilityLabel("全局快捷键，点击录入")
        var shortcut: (UInt32, UInt32, String)?
        recorder.recorded = { shortcut = ($0, $1, $2) }
        view.addSubview(directory); view.addSubview(recorder)
        let progressRecorder = ShortcutRecorder(string: preferences.string(forKey: "progressLabel") ?? "记录进展：⌃⌥P")
        progressRecorder.isEditable = false; progressRecorder.frame = NSRect(x: 0, y: 4, width: 380, height: 26)
        progressRecorder.setAccessibilityLabel("记录进展快捷键，点击录入")
        var progressShortcut: (UInt32, UInt32, String)?
        progressRecorder.recorded = { progressShortcut = ($0, $1, $2) }; view.addSubview(progressRecorder)
        sheet.accessoryView = view
        guard sheet.runModal() == .alertFirstButtonReturn else { return }
        do {
            _ = try CaptureConfiguration(vault: vault.path, taskDirectory: directory.stringValue).destination()
            if let (key, modifiers, label) = progressShortcut {
                guard registerProgress(key, modifiers) else { alert("快捷键冲突", "记录进展组合键无法注册，原设置已保留。"); return }
                preferences.set(key, forKey: "progressKey"); preferences.set(modifiers, forKey: "progressModifiers"); preferences.set(label, forKey: "progressLabel")
            }
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
            try persistDraft()
            preferences.set(vault.path, forKey: "vault")
            preferences.set(directory.stringValue, forKey: "taskDirectory")
            if destinationChanged {
                pending = nil; pendingDraftData = nil
                draft = try persistence.load(draftKey).map { try CaptureFormDraft(data: $0) }
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
        if (draft?.values["images"] as? [[String: Any]])?.contains(where: { $0["state"] as? String == "processing" }) == true { alert("图片正在处理", "请等待图片处理完成后退出，图文草稿会一起保存。"); return }
        do { try persistDraft() } catch { alert("草稿未能保存", error.localizedDescription); return }
        preferences.synchronize()
        NSApp.terminate(nil)
    }
}
let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
