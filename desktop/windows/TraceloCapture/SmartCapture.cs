using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tracelo;

namespace TraceloCapture;
internal sealed partial class CaptureApplication {
    private async void ReceiveSmart(JsonElement message) {
        var id = message.GetProperty("id").GetString();
        void Reply(object? result = null, string? error = null) {
            if (!Window.IsDisposed) Window.Surface.Update(new() { ["smartReply"] = new { id, result, error } });
        }
        try {
            if (message.GetProperty("workspace").GetString() != State.WorkspaceKey) throw new IOException("保存位置已变化，请重新打开一句话录入");
            var method = message.GetProperty("method").GetString(); var parameters = message.GetProperty("params");
            var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(State.WorkspaceKey)));
            var path = Path.Combine(Path.GetDirectoryName(settingsPath)!, "SmartCapture", digest + ".json");
            var state = File.Exists(path) ? JsonNode.Parse(File.ReadAllText(path))!.AsObject() : new JsonObject();
            void Save() {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                var temporary = path + "." + Guid.NewGuid() + ".tmp";
                try {
                    using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { JsonSerializer.Serialize(stream, state); stream.Flush(true); }
                    File.Move(temporary, path, true);
                } finally { if (File.Exists(temporary)) File.Delete(temporary); }
            }
            switch (method) {
                case "read":
                    if (state["config"] == null) {
                        var pluginPath = Path.Combine(State.Vault, ".obsidian", "plugins", "work-timeline", "data.json");
                        if (File.Exists(pluginPath)) {
                            using var plugin = JsonDocument.Parse(File.ReadAllText(pluginPath));
                            if (plugin.RootElement.TryGetProperty("smartCapture", out var config)) {
                                try { state["config"] = JsonSerializer.SerializeToNode(SmartCaptureTransport.Configuration(config)); } catch (ArgumentException) { }
                            }
                        }
                    }
                    Reply(state); break;
                case "draft":
                    var scope = parameters.GetProperty("scope").GetString()!; var value = parameters.GetProperty("value").GetString()!;
                    // Includes up to 40 MB of base64 images and a recoverable previous result.
                    if (scope.Length >= 240 || Encoding.UTF8.GetByteCount(value) >= 160 * 1024 * 1024) throw new IOException("草稿过大或格式无效");
                    var drafts = state["drafts"]?.AsObject() ?? new JsonObject();
                    if (state["drafts"] == null) state["drafts"] = drafts;
                    if (value.Length == 0) drafts.Remove(scope); else drafts[scope] = value;
                    Save(); Reply(); break;
                case "configure":
                    state["config"] = JsonSerializer.SerializeToNode(SmartCaptureTransport.Configuration(parameters.GetProperty("config")));
                    Save(); Reply(); break;
                case "pickKey":
                    using (var picker = new OpenFileDialog { Title = "选择密钥文件", Multiselect = false, CheckFileExists = true }) Reply(picker.ShowDialog(Window) == DialogResult.OK ? picker.FileName : null);
                    break;
                case "request":
                    Reply(await SmartCaptureTransport.SendAsync(parameters.GetProperty("config"), parameters.GetProperty("request"))); break;
                case "create":
                    var directory = new CaptureConfiguration(State.Vault, State.TaskDirectory).Destination();
                    if ((CaptureConfiguration.ReadGroupsArchive(directory) ?? "") != parameters.GetProperty("groupsSource").GetString()) throw new IOException("分组已变化，请关闭并重新确认后保存");
                    var request = parameters.GetProperty("request");
                    CaptureRequest.FromSharedForm(request.GetProperty("id").GetString()!, request.GetProperty("markdown").GetString()!).Publish(directory, request.TryGetProperty("attachments", out var attachments) ? attachments : null);
                    Reply(); RefreshQuick(); break;
                case "progress":
                    var operation = parameters.GetProperty("operation");
                    if (operation.GetProperty("kind").GetString() != "smart_progress") throw new IOException("进展操作无效");
                    new QuickWorkspace(new CaptureConfiguration(State.Vault, State.TaskDirectory).Destination()).Enqueue(operation);
                    Reply("queued"); break;
                default: throw new IOException("不支持的一句话操作");
            }
        } catch (Exception error) { Reply(error: error is IOException or ArgumentException ? error.Message : "操作未完成，内容已保留，请检查配置后重试。"); }
    }
}
