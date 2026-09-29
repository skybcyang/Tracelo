using System.Reflection;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TraceloCapture;

internal sealed class CaptureSurface : UserControl {
    internal readonly WebView2 Browser = new() { Dock = DockStyle.Fill, AccessibleName = "Tracelo 新建任务表单" };
    internal event Action<string, JsonElement>? Action;
    internal bool Ready { get; private set; }
    internal string? LoadError { get; private set; }
    internal readonly List<string> Diagnostics = new();
    private readonly Dictionary<string, object?> pending = new();
    private readonly string profileDirectory;
    private bool started;
    internal CaptureSurface(string profileDirectory) {
        this.profileDirectory = profileDirectory; Dock = DockStyle.Fill; Browser.DefaultBackgroundColor = Theme.Background; Controls.Add(Browser);
    }
    internal async Task LoadAsync() {
        if (started) return;
        started = true;
        try {
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profileDirectory);
            await Browser.EnsureCoreWebView2Async(environment);
            var core = Browser.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            var html = LoadHtml();
            // NavigateToString reports its embedded data URI to NavigationStarting
            // on newer runtimes, while the resulting document origin is about:blank.
            var embeddedUri = "data:text/html;charset=utf-8;base64," + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(html));
            core.NavigationStarting += (_, e) => {
                var allowed = e.Uri == "about:blank" || e.Uri == embeddedUri;
                if (Diagnostics.Count < 30) Diagnostics.Add($"Navigation starting: embedded={e.Uri == embeddedUri}, allowed={allowed}");
                if (!allowed) e.Cancel = true;
            };
            core.NavigationCompleted += (_, e) => Diagnostics.Add($"Navigation completed: {e.IsSuccess}, {e.WebErrorStatus}, source {core.Source}");
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) => e.Response = environment.CreateWebResourceResponse(Stream.Null, 403, "Blocked", "");
            core.WebMessageReceived += (_, e) => {
                if (!Ready && Diagnostics.Count < 30) Diagnostics.Add("Message source: " + e.Source);
                if (e.Source != "about:blank" || e.WebMessageAsJson.Length > 160 * 1024 * 1024) return;
                try {
                    using var document = JsonDocument.Parse(e.WebMessageAsJson);
                    var message = document.RootElement.Clone();
                    if (message.ValueKind != JsonValueKind.Object || !message.TryGetProperty("action", out var name) || name.ValueKind != JsonValueKind.String) return;
                    if (name.GetString() == "ready") { Ready = true; Flush(); }
                    Action?.Invoke(name.GetString()!, message);
                } catch (JsonException) { /* Invalid messages never reach disk operations. */ }
            };
            await core.AddScriptToExecuteOnDocumentCreatedAsync("window.captureErrors = []; window.addEventListener('error', event => window.captureErrors.push(event.message)); window.chrome.webview.addEventListener('message', event => { if (window.capture) window.capture.update(event.data); });");
            core.NavigateToString(html);
        } catch (Exception error) {
            LoadError = error.Message; Browser.Visible = false;
            var help = new LinkLabel { Dock = DockStyle.Fill, Padding = new Padding(24), AutoSize = false,
                Text = "无法加载任务表单。请安装 Microsoft Edge WebView2 Runtime 后重新打开 Tracelo。\n\n下载 WebView2 Runtime\n\n" + error.Message };
            help.Links.Clear(); help.Links.Add(help.Text.IndexOf("下载", StringComparison.Ordinal), "下载 WebView2 Runtime".Length);
            help.LinkClicked += (_, _) => System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true });
            Controls.Add(help); help.BringToFront();
        }
    }
    private static string LoadHtml() {
        static string Read(string name) {
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Capture." + name)
                ?? throw new IOException("共享表单资源缺失：" + name);
            using var reader = new StreamReader(stream); return reader.ReadToEnd();
        }
        return Read("capture.html").Replace("/*PLUGIN_STYLES*/", Read("styles.css"))
            .Replace("/*CAPTURE_STYLES*/", Read("capture.css"))
            .Replace("/*CREATE_TASK_SCRIPT*/", Read("create-task.js"))
            .Replace("/*CAPTURE_SCRIPT*/", Read("capture.js"));
    }
    internal void Update(Dictionary<string, object?> values) {
        foreach (var value in values) pending[value.Key] = value.Value;
        Flush();
    }
    private void Flush() {
        if (!Ready || pending.Count == 0) return;
        Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(pending)); pending.Clear();
    }
    internal Task<string> EvaluateAsync(string script) => Browser.CoreWebView2.ExecuteScriptAsync(script);
    internal async Task SnapshotAsync(string path) {
        await using var file = new FileStream(path, FileMode.Create, FileAccess.Write);
        await Browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, file);
    }
}
