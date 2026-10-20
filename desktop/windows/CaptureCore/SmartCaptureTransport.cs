using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Tracelo;
public static class SmartCaptureTransport {
    public static string ReadKey(string source) {
        var plain = source.Trim();
        var labelled = Regex.Matches(source, @"(?m)^[\t ]*(?:API_KEY|api_key|apiKey)[\t ]*[:=][\t ]*([^\r\n]*)");
        if (labelled.Count == 1) {
            var key = labelled[0].Groups[1].Value.Trim();
            if (key.Length >= 2 && "`\"'".Contains(key[0]) && key[^1] == key[0]) key = key[1..^1];
            return key;
        }
        if (!plain.Contains('\n') && !plain.Contains('\r')) return plain;
        var keys = new HashSet<string>();
        foreach (Match match in Regex.Matches(source, @"\bsk-[A-Za-z0-9_-]{16,}\b")) keys.Add(match.Value);
        return keys.Count == 1 ? keys.Single() : plain;
    }
    public static Uri Endpoint(string value) {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var url) || (url.Scheme != "https" && url.Scheme != "http") || url.UserInfo.Length > 0 || url.Query.Length > 0 || url.Fragment.Length > 0) throw new ArgumentException("请填写不含账号或参数的 HTTP 或 HTTPS 服务地址");
        var normalized = url.AbsoluteUri.TrimEnd('/');
        return new Uri(normalized.EndsWith("/chat/completions", StringComparison.Ordinal) ? normalized : normalized + "/chat/completions");
    }
    public static Dictionary<string,string> Configuration(JsonElement value) {
        var result = new Dictionary<string,string>();
        foreach (var key in new[] {"baseUrl","model","apiKey","keyFile"}) result[key] = value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.String ? field.GetString()?.Trim() ?? "" : "";
        _ = Endpoint(result["baseUrl"]);
        if (result["model"].Length == 0) throw new ArgumentException("请填写模型名称");
        if (result["apiKey"].Length == 0 && result["keyFile"].Length > 0 && !Path.IsPathFullyQualified(result["keyFile"])) throw new ArgumentException("旧密钥文件须使用绝对路径");
        if (result["apiKey"].Length > 0) {
            result["keyFile"] = "";
        }
        return result;
    }
    public static async Task<object> SendAsync(JsonElement candidate, JsonElement request) {
        var config = Configuration(candidate); var endpoint = Endpoint(config["baseUrl"]);
        var body = request.GetProperty("body").GetString() ?? "";
        if (body.Length >= 200000) throw new ArgumentException("模型请求过大");
        using var payload = JsonDocument.Parse(body);
        if (payload.RootElement.GetProperty("model").GetString() != config["model"]) throw new ArgumentException("模型请求无效");
        var key = config["apiKey"];
        if (key.Length == 0 && config["keyFile"].Length > 0) { try {
            key = ReadKey(await File.ReadAllTextAsync(config["keyFile"]));
        } catch { throw new IOException("旧密钥无法读取，请在模型设置中重新输入 API Key"); } }
        using var handler = new HttpClientHandler { AllowAutoRedirect = false };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(60), MaxResponseContentBufferSize = 200000 };
        using var message = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        if (key.Length > 0) message.Headers.TryAddWithoutValidation("Authorization", "Bearer " + key);
        message.Headers.UserAgent.ParseAdd("Tracelo/0.9.3");
        try {
            using var response = await client.SendAsync(message);
            return new { status = (int)response.StatusCode, text = response.IsSuccessStatusCode ? await response.Content.ReadAsStringAsync() : "" };
        } catch { throw new IOException("无法连接模型或响应超时，请检查服务地址后重试"); }
    }
}
