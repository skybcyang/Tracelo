using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Tracelo;
public static class SmartCaptureTransport {
    public static string ReadKey(string source) {
        if (source.Length > 65536) throw new ArgumentException("密钥文件过大");
        var plain = source.Trim();
        if (Regex.IsMatch(plain, @"^[A-Za-z0-9_./+~=-]{16,4096}$")) return plain;
        var keys = new HashSet<string>();
        foreach (Match match in Regex.Matches(source, "(?m)^\\s*(?:API_KEY|api_key|apiKey)\\s*[:=]\\s*[`\"']?([A-Za-z0-9_./+~=-]{16,4096})[`\"']?\\s*$")) keys.Add(match.Groups[1].Value);
        foreach (Match match in Regex.Matches(source, @"\bsk-[A-Za-z0-9_-]{16,}\b")) keys.Add(match.Value);
        if (keys.Count != 1) throw new ArgumentException("请使用一行密钥或 API_KEY= 格式，且只保留一个凭证");
        return keys.Single();
    }
    public static Uri Endpoint(string value) {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var url) || url.Scheme != "https" || url.UserInfo.Length > 0 || url.Query.Length > 0 || url.Fragment.Length > 0) throw new ArgumentException("请填写不含账号或参数的 HTTPS 服务地址");
        var normalized = url.AbsoluteUri.TrimEnd('/');
        return new Uri(normalized.EndsWith("/chat/completions", StringComparison.Ordinal) ? normalized : normalized + "/chat/completions");
    }
    public static Dictionary<string,string> Configuration(JsonElement value) {
        var result = new Dictionary<string,string>();
        foreach (var key in new[] {"baseUrl","model","apiKey","keyFile"}) result[key] = value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.String ? field.GetString()?.Trim() ?? "" : "";
        _ = Endpoint(result["baseUrl"]);
        if (result["model"].Length == 0) throw new ArgumentException("请填写模型名称");
        if (result["apiKey"].Length > 0) {
            if (!Regex.IsMatch(result["apiKey"], @"^[A-Za-z0-9_./+~=-]{16,4096}$")) throw new ArgumentException("请填写有效的 API Key，仅粘贴密钥本身");
            result["keyFile"] = "";
        } else if (!Path.IsPathFullyQualified(result["keyFile"])) throw new ArgumentException("请填写 API Key");
        return result;
    }
    public static async Task<object> SendAsync(JsonElement candidate, JsonElement request) {
        var config = Configuration(candidate); var endpoint = Endpoint(config["baseUrl"]);
        var body = request.GetProperty("body").GetString() ?? "";
        if (body.Length >= 200000) throw new ArgumentException("模型请求过大");
        using var payload = JsonDocument.Parse(body);
        if (payload.RootElement.GetProperty("model").GetString() != config["model"]) throw new ArgumentException("模型请求无效");
        var key = config["apiKey"];
        if (key.Length == 0) { try {
            if (new FileInfo(config["keyFile"]).Length > 65536) throw new IOException();
            key = ReadKey(await File.ReadAllTextAsync(config["keyFile"]));
        } catch { throw new IOException("旧密钥无法读取，请在模型设置中重新输入 API Key"); } }
        using var handler = new HttpClientHandler { AllowAutoRedirect = false };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(60), MaxResponseContentBufferSize = 200000 };
        using var message = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        message.Headers.UserAgent.ParseAdd("Tracelo/0.9.3");
        try {
            using var response = await client.SendAsync(message);
            return new { status = (int)response.StatusCode, text = response.IsSuccessStatusCode ? await response.Content.ReadAsStringAsync() : "" };
        } catch { throw new IOException("无法连接模型或响应超时，请检查服务地址后重试"); }
    }
}
