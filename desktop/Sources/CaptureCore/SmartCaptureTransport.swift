import Foundation

/// HTTP stays in the native process. Redirects never receive authorization.
public final class SmartCaptureTransport: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    public static func readKey(_ source: String) throws -> String {
        let plain = source.trimmingCharacters(in: .whitespacesAndNewlines)
        let labelled = try NSRegularExpression(pattern: #"(?m)^[\t ]*(?:API_KEY|api_key|apiKey)[\t ]*[:=][\t ]*([^\r\n]*)"#)
        let matches = labelled.matches(in: source, range: NSRange(source.startIndex..., in: source))
        if matches.count == 1, let range = Range(matches[0].range(at: 1), in: source) {
            var key = String(source[range]).trimmingCharacters(in: .whitespacesAndNewlines)
            if key.count >= 2, let first = key.first, "`\"'".contains(first), key.last == first { key.removeFirst(); key.removeLast() }
            return key
        }
        if !plain.contains("\n") && !plain.contains("\r") { return plain }
        var keys = Set<String>()
        for (pattern, group) in [(#"\bsk-[A-Za-z0-9_-]{16,}\b"#, 0)] {
            let expression = try NSRegularExpression(pattern: pattern)
            for match in expression.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
                if let range = Range(match.range(at: group), in: source) { keys.insert(String(source[range])) }
            }
        }
        return keys.count == 1 ? keys.first! : plain
    }
    public static func endpoint(_ base: String) throws -> URL {
        guard let parts = URLComponents(string: base), (parts.scheme == "https" || parts.scheme == "http"), parts.host != nil,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil else { throw CaptureError.invalid("请填写不含账号或参数的 HTTP 或 HTTPS 服务地址") }
        var normalized = base
        while normalized.hasSuffix("/") { normalized.removeLast() }
        if !normalized.hasSuffix("/chat/completions") { normalized += "/chat/completions" }
        guard let url = URL(string: normalized) else { throw CaptureError.invalid("服务地址无效") }
        return url
    }
    public static func configuration(_ value: [String: Any]) throws -> [String: String] {
        guard let base = value["baseUrl"] as? String, let model = value["model"] as? String, !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw CaptureError.invalid("请填写服务地址和模型名称") }
        _ = try endpoint(base)
        let apiKey = (value["apiKey"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let keyFile = value["keyFile"] as? String ?? ""
        if apiKey.isEmpty, !keyFile.isEmpty, !keyFile.hasPrefix("/") { throw CaptureError.invalid("旧密钥文件须使用绝对路径") }
        return ["baseUrl": base, "model": model.trimmingCharacters(in: .whitespacesAndNewlines), "apiKey": apiKey, "keyFile": apiKey.isEmpty ? keyFile : ""]
    }
    public func send(config: [String: Any], request: [String: Any]) async throws -> [String: Any] {
        let config = try Self.configuration(config), url = try Self.endpoint(config["baseUrl"]!)
        guard let body = request["body"] as? String, body.utf8.count < 200000, let data = body.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any], payload["model"] as? String == config["model"] else { throw CaptureError.invalid("模型请求无效") }
        var key = config["apiKey"] ?? ""
        if key.isEmpty, let keyFile = config["keyFile"], !keyFile.isEmpty { do {
            let file = URL(fileURLWithPath: keyFile)
            key = try Self.readKey(String(contentsOf: file, encoding: .utf8))
        } catch { throw CaptureError.invalid("旧密钥无法读取，请在模型设置中重新输入 API Key") } }
        var message = URLRequest(url: url); message.httpMethod = "POST"; message.httpBody = data; message.timeoutInterval = 60
        message.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !key.isEmpty { message.setValue("Bearer " + key, forHTTPHeaderField: "Authorization") }
        message.setValue("Tracelo/0.9.3", forHTTPHeaderField: "User-Agent")
        let configuration = URLSessionConfiguration.ephemeral; configuration.timeoutIntervalForResource = 60
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            let (bytes, response) = try await session.data(for: message)
            guard bytes.count <= 200000, let response = response as? HTTPURLResponse else { throw CaptureError.invalid("模型响应无效或过大") }
            return ["status": response.statusCode, "text": response.statusCode == 200 ? String(data: bytes, encoding: .utf8) ?? "" : ""]
        } catch { throw CaptureError.invalid("无法连接模型或响应超时，请检查服务地址后重试") }
    }
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
