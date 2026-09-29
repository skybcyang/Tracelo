import Foundation
import CryptoKit

/// Large image drafts belong on disk, not in UserDefaults. Scope includes vault and directory.
public struct CapturePersistence {
    public let root: URL
    public init(root: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("TraceloCapture/Drafts", isDirectory: true)) { self.root = root }
    private func path(_ key: String) -> URL {
        root.appendingPathComponent(SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined() + ".json")
    }
    public func load(_ key: String) throws -> Data? {
        let url = path(key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try Data(contentsOf: url)
    }
    public func save(_ key: String, data: Data?) throws {
        let url = path(key)
        guard let data else { if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }; return }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        let handle = try FileHandle(forWritingTo: url); try handle.synchronize(); try handle.close()
        guard try Data(contentsOf: url) == data else { throw CaptureError.invalid("草稿保存校验失败") }
    }
}
