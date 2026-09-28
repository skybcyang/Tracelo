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
public enum InputAction { case system, submit, dismiss }
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
    public init(text: String, id: String = UUID().uuidString.lowercased(), eventID: String = UUID().uuidString.lowercased(), now: Date = Date(), timezone: TimeZone = .current) throws {
        guard !id.isEmpty, id != ".", id != "..", id.rangeOfCharacter(from: CharacterSet(charactersIn: "/\\:\n\r")) == nil else { throw CaptureError.invalid("任务 ID 无效") }
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
