import Foundation
import Darwin

public enum CaptureError: LocalizedError {
    case invalid(String)
    public var errorDescription: String? { if case let .invalid(message) = self { return message }; return nil }
}
public struct CaptureDraft {
    public let title: String
    public let notes: String
    public init(_ text: String) throws {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        title = (lines.first ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        notes = lines.dropFirst().joined(separator: "\n")
        guard !title.isEmpty else { throw CaptureError.invalid("第一行请输入任务标题") }
    }
}
// Keep the form's JSON intact: native code must not discard fields it does not
// render, or translate a failed group selection back into an ungrouped task.
public struct CaptureFormDraft {
    public let values: [String: Any]
    public let data: Data
    public init(json: [String: Any]) throws {
        guard JSONSerialization.isValidJSONObject(json) else { throw CaptureError.invalid("草稿格式无效，原草稿已保留") }
        data = try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
        values = json
    }
    public init(data: Data) throws {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw CaptureError.invalid("草稿格式无效，原草稿已保留") }
        try self.init(json: json)
    }
    public init(legacyText: String) {
        let lines = legacyText.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        let json: [String: Any] = ["title": (lines.first ?? "").trimmingCharacters(in: .whitespacesAndNewlines), "notes": lines.dropFirst().joined(separator: "\n")]
        values = json
        // These two string fields always form valid JSON.
        data = try! JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
    }
}
public enum InputAction { case system, submit, dismiss }
public func capturePanelSize(contentHeight: Double, available: CGSize) -> CGSize {
    CGSize(width: min(560, max(1, available.width - 32)), height: min(max(260, contentHeight + 160), 780, max(1, available.height - 32)))
}
public func inputAction(keyCode: UInt16, shift: Bool, marked: Bool) -> InputAction {
    if marked { return .system }
    if keyCode == 53 { return .dismiss }
    if (keyCode == 36 || keyCode == 76) && !shift { return .submit }
    return .system
}
public struct CaptureConfiguration {
    public let vault: String
    public let taskDirectory: String
    public init(vault: String, taskDirectory: String) { self.vault = vault; self.taskDirectory = taskDirectory }
    public func destination() throws -> URL {
        guard vault.hasPrefix("/"), !taskDirectory.isEmpty, !taskDirectory.hasPrefix("/"), !taskDirectory.components(separatedBy: "/").contains("..") else {
            throw CaptureError.invalid("请选择 vault，并填写 vault 内的相对任务目录")
        }
        let root = URL(fileURLWithPath: vault).resolvingSymlinksInPath().standardizedFileURL
        let target = root.appendingPathComponent(taskDirectory).resolvingSymlinksInPath().standardizedFileURL
        var isDirectory: ObjCBool = false
        guard (target.path == root.path || target.path.hasPrefix(root.path + "/")), FileManager.default.fileExists(atPath: target.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw CaptureError.invalid("任务目录不存在或位于 vault 外；请使用插件设置中的实际目录")
        }
        return target
    }
    public func groupsSource() throws -> String {
        let source = try destination().appendingPathComponent("_groups.md")
        do { return try String(contentsOf: source, encoding: .utf8) }
        catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError { return "" }
        catch { throw CaptureError.invalid("无法读取分组档案，已保留草稿和分组选择：\(error.localizedDescription)") }
    }
}

// JSON.stringify-compatible string encoding: Unicode and slash remain literal.
private func quote(_ value: String) -> String {
    var result = "\""
    for scalar in value.unicodeScalars {
        switch scalar.value {
        case 34: result += "\\\""
        case 92: result += "\\\\"
        case 8: result += "\\b"
        case 9: result += "\\t"
        case 10: result += "\\n"
        case 12: result += "\\f"
        case 13: result += "\\r"
        case 0..<32: result += String(format: "\\u%04x", scalar.value)
        default: result.unicodeScalars.append(scalar)
        }
    }
    return result + "\""
}
private func inline(_ value: String) -> String {
    var result = ""
    for character in value.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\n", with: " ") {
        if "\\`*_{}[]<>".contains(character) { result += "\\" }
        result.append(character)
    }
    return result
}
public struct CaptureRequest {
    public let id: String
    public let markdown: String
    private static func validID(_ id: String) -> Bool {
        !id.isEmpty && id.utf16.count <= 180 && id != "." && id != ".."
            && id.range(of: #"[<>:"/\\|?*\x00-\x1f]|[. ]$"#, options: .regularExpression) == nil
            && id.range(of: #"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)"#, options: [.regularExpression, .caseInsensitive]) == nil
    }
    private static func isBoolean(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber else { return false }
        return CFGetTypeID(number) == CFBooleanGetTypeID()
    }
    private static func validEvents(_ events: [[String: Any]]) -> Bool {
        let kinds: Set<String> = ["created", "renamed", "progress", "completed", "closed", "reopened", "group_changed", "quadrant_changed", "todo_added", "todo_done", "todo_undone", "todo_edited", "todo_removed", "todo_restored", "due_changed", "notes_changed", "icon_changed"]
        let date = ISO8601DateFormatter()
        date.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var ids = Set<String>()
        var previous = ""
        for event in events {
            guard let id = event["id"] as? String, !id.isEmpty, ids.insert(id).inserted,
                let kind = event["kind"] as? String, kinds.contains(kind),
                let at = event["at"] as? String, date.date(from: at) != nil, at >= previous,
                let day = event["day"] as? String, day.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
                event["text"] is String, event["title"] is String, event["groupName"] is String, event["timezone"] is String,
                let offset = event["offsetMinutes"] as? NSNumber, CFGetTypeID(offset) != CFBooleanGetTypeID(),
                Self.isBoolean(event["important"]), Self.isBoolean(event["urgent"])
            else { return false }
            previous = at
        }
        return !events.isEmpty
    }
    public init(id: String, markdown: String) throws {
        guard Self.validID(id) else { throw CaptureError.invalid("任务 ID 无效") }
        let prefix = "<!-- work-timeline-task:v1\n"
        guard markdown.hasPrefix(prefix), let end = markdown.range(of: "\n-->\n\n"),
            end.lowerBound >= markdown.index(markdown.startIndex, offsetBy: prefix.count),
            let bytes = String(markdown[markdown.index(markdown.startIndex, offsetBy: prefix.count)..<end.lowerBound]).data(using: .utf8),
            let task = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
            let version = task["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1, task["id"] as? String == id,
            let title = task["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            task["groupId"] is String || task["groupId"] is NSNull, task["groupName"] is String,
            Self.isBoolean(task["important"]), Self.isBoolean(task["urgent"]),
            task["notes"] == nil || task["notes"] is String,
            task["status"] as? String == "active", let events = task["events"] as? [[String: Any]], !events.isEmpty,
            Self.validEvents(events)
        else { throw CaptureError.invalid("任务存档格式无效或 ID 不匹配；未写入文件") }
        self.id = id
        self.markdown = markdown
    }
    public init(text: String, id: String = UUID().uuidString.lowercased(), eventID: String = UUID().uuidString.lowercased(), now: Date = Date(), timezone: TimeZone = .current) throws {
        guard Self.validID(id) else { throw CaptureError.invalid("任务 ID 无效") }
        let draft = try CaptureDraft(text)
        self.id = id
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let at = iso.string(from: now)
        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.calendar = Calendar(identifier: .gregorian)
        day.timeZone = timezone
        day.dateFormat = "yyyy-MM-dd"
        var fields = ["  \"version\": 1", "  \"id\": \(quote(id))", "  \"title\": \(quote(draft.title))", "  \"status\": \"active\"", "  \"groupId\": null", "  \"groupName\": \"未分组\"", "  \"important\": false", "  \"urgent\": false"]
        if !draft.notes.isEmpty { fields.append("  \"notes\": \(quote(draft.notes))") }
        let eventFields = [("id", quote(eventID)), ("kind", quote("created")), ("text", quote("创建任务")), ("at", quote(at)), ("day", quote(day.string(from: now))), ("timezone", quote(timezone.identifier)), ("offsetMinutes", String(timezone.secondsFromGMT(for: now) / 60)), ("title", quote(draft.title)), ("groupName", quote("未分组")), ("important", "false"), ("urgent", "false")]
        fields.append("  \"events\": [\n    {\n" + eventFields.map { "      \(quote($0.0)): \($0.1)" }.joined(separator: ",\n") + "\n    }\n  ]")
        let notes = draft.notes.isEmpty ? "" : "\n\n## 详情\n\n\(draft.notes)"
        markdown = "<!-- work-timeline-task:v1\n{\n" + fields.joined(separator: ",\n") + "\n}\n-->\n\n# \(inline(draft.title))\n\n- 状态：进行中\n- 分组：未分组\n- 象限：不重要 · 不紧急\(notes)\n\n## 时间线\n\n- \(at) · **创建** · 创建任务\n"
    }
    public func publish(to directory: URL) throws -> URL {
        let destination = directory.appendingPathComponent(id + ".md")
        let temporary = directory.appendingPathComponent(".tracelo-\(UUID().uuidString).tmp")
        let data = Data(markdown.utf8)
        try data.write(to: temporary, options: .withoutOverwriting)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let handle = try FileHandle(forWritingTo: temporary)
        try handle.synchronize()
        try handle.close()
        // A hard link atomically publishes the complete inode; unlike rename it cannot replace a target.
        if link(temporary.path, destination.path) != 0 {
            let code = errno
            if code == EEXIST, (try? Data(contentsOf: destination)) == data { return destination }
            throw CaptureError.invalid(code == EEXIST ? "同名文件已存在；没有覆盖，请重试" : "保存失败：\(String(cString: strerror(code)))")
        }
        return destination
    }
}
