import Foundation
import Darwin

/// Desktop hosts publish commands, never replace task snapshots. The plugin owns mutation.
public struct QuickWorkspace {
    public let directory: URL
    public init(directory: URL) { self.directory = directory }
    private var queue: URL { directory.appendingPathComponent(".tracelo-operations", isDirectory: true) }
    public func uiSettings() -> [String: Any] {
        let path = directory.appendingPathComponent(".tracelo-ui.json")
        guard safeFile(path), let data = try? Data(contentsOf: path), data.count < 4096,
            let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return settings
    }
    private func safeFile(_ path: URL) -> Bool {
        let resolved = path.resolvingSymlinksInPath().standardizedFileURL.path
        return resolved.hasPrefix(directory.resolvingSymlinksInPath().standardizedFileURL.path + "/")
            && resolved == path.standardizedFileURL.path
    }
    public func tasks() throws -> [[String: Any]] {
        let files = FileManager.default
        var candidates: [URL] = []
        for path in try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey]) {
            guard safeFile(path), !path.lastPathComponent.hasPrefix(".") else { continue }
            if (try path.resourceValues(forKeys: [.isDirectoryKey])).isDirectory == true {
                candidates.append(path.appendingPathComponent(path.lastPathComponent + ".md"))
            } else if path.pathExtension == "md", !path.lastPathComponent.hasPrefix("_") { candidates.append(path) }
        }
        return candidates.compactMap { path in
            guard safeFile(path), let source = try? String(contentsOf: path, encoding: .utf8), source.hasPrefix("<!-- work-timeline-task:v1\n") else { return nil }
            var images: [String: String] = [:]
            let pattern = try! NSRegularExpression(pattern: #"!\[[^\]]*\]\(<?([^>\n)]+)>?\)"#)
            for match in pattern.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
                guard let range = Range(match.range(at: 1), in: source) else { continue }
                let name = String(source[range]); let image = path.deletingLastPathComponent().appendingPathComponent(name).standardizedFileURL
                let types = ["png": "png", "jpg": "jpeg", "jpeg": "jpeg", "webp": "webp", "gif": "gif", "bmp": "bmp"]
                guard safeFile(image), let type = types[image.pathExtension.lowercased()], let size = try? image.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 10 * 1024 * 1024, let data = try? Data(contentsOf: image) else { continue }
                images[name] = "data:image/\(type);base64," + data.base64EncodedString()
            }
            return ["markdown": source, "images": images, "path": path.path]
        }
    }
    public func enqueue(_ operation: [String: Any]) throws {
        guard let id = operation["id"] as? String, id.range(of: #"^quick-[a-f0-9]{32}$"#, options: .regularExpression) != nil,
            operation["version"] as? Int == 1, let task = operation["taskId"] as? String, !task.isEmpty else { throw CaptureError.invalid("快捷操作格式无效") }
        guard safeFile(queue) else { throw CaptureError.invalid("快捷操作目录不能是符号链接") }
        try FileManager.default.createDirectory(at: queue, withIntermediateDirectories: true)
        let destination = queue.appendingPathComponent(id + ".request.json")
        let data = try JSONSerialization.data(withJSONObject: operation, options: [.sortedKeys])
        if FileManager.default.fileExists(atPath: destination.path) {
            guard safeFile(destination), try Data(contentsOf: destination) == data else { throw CaptureError.invalid("快捷操作 ID 冲突") }
        } else {
            let stage = queue.appendingPathComponent(UUID().uuidString + ".tmp")
            try data.write(to: stage, options: .withoutOverwriting)
            defer { try? FileManager.default.removeItem(at: stage) }
            let handle = try FileHandle(forWritingTo: stage); try handle.synchronize(); try handle.close()
            if link(stage.path, destination.path) != 0 { throw CaptureError.invalid("暂存失败，草稿已保留") }
        }
        let result = queue.appendingPathComponent(id + ".result.json")
        if safeFile(result), let source = try? Data(contentsOf: result), let receipt = try? JSONSerialization.jsonObject(with: source) as? [String: Any], receipt["status"] as? String == "failed" { try FileManager.default.removeItem(at: result) }
    }
    public func receipts() throws -> [[String: Any]] {
        guard safeFile(queue), FileManager.default.fileExists(atPath: queue.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: queue, includingPropertiesForKeys: nil).filter { $0.lastPathComponent.hasSuffix(".request.json") && safeFile($0) }.compactMap { path in
            guard let data = try? Data(contentsOf: path), let op = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = op["id"] as? String else { return nil }
            let result = queue.appendingPathComponent(id + ".result.json")
            if safeFile(result), let bytes = try? Data(contentsOf: result), var value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] { value["operation"] = op; return value }
            return ["id": id, "status": "queued", "message": "已暂存，打开 Obsidian 后写入任务", "operation": op]
        }
    }
}
