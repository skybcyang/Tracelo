using System.Text.Json;
using Tracelo;

namespace TraceloCapture;

internal sealed class CaptureWindow : Form {
    internal readonly CaptureSurface Surface;
    internal event Action? Dismiss;
    internal event Action<int>? Hotkey;
    internal bool AllowClose;
    internal CaptureWindow(string profileDirectory) {
        Theme.Apply(this, "Tracelo · 新建任务", new Size(554, 540));
        Surface = new CaptureSurface(profileDirectory); Controls.Add(Surface);
        TopMost = true; ShowInTaskbar = false; MaximizeBox = false; MinimizeBox = false;
        FormClosing += (_, e) => { if (!AllowClose) { e.Cancel = true; Dismiss?.Invoke(); } };
        Shown += async (_, _) => await Surface.LoadAsync();
    }
    protected override void WndProc(ref Message message) {
        if (message.Msg == 0x312) Hotkey?.Invoke(message.WParam.ToInt32());
        if (message.Msg == 0x1A && Surface != null) { Theme.Refresh(this); Surface.Update(new() { ["dark"] = Theme.Dark }); }
        base.WndProc(ref message);
    }
}

internal sealed partial class CaptureApplication : ApplicationContext {
    internal readonly CaptureWindow Window;
    internal CaptureSettings State { get; private set; }
    private readonly string settingsPath;
    private readonly NotifyIcon tray;
    private readonly Icon icon = Theme.CreateIcon();
    private IntPtr previousWindow;
    private int hotkeyId;
    private int progressHotkeyId;
    private readonly System.Windows.Forms.Timer refreshTimer = new() { Interval = 2000 };
    private bool saving;
    private bool dismissing;
    private bool disposed;
    private string shortcutError = "";
    private int desiredHeight = 540;
    internal CaptureApplication(string settingsPath, bool smoke = false) {
        this.settingsPath = settingsPath; State = CaptureSettings.Load(settingsPath);
        Window = new CaptureWindow(Path.Combine(Path.GetDirectoryName(settingsPath)!, "WebView2")) { Icon = icon };
        _ = Window.Handle;
        Window.Dismiss += Dismiss;
        Window.Hotkey += id => { if (id == progressHotkeyId) ShowProgress(); else if (Window.Visible) Dismiss(); else Show(); };
        Window.Surface.Action += OnAction;
        var menu = new ContextMenuStrip();
        menu.Items.Add("创建任务", null, (_, _) => Show());
        menu.Items.Add("记录进展", null, (_, _) => ShowProgress());
        menu.Items.Add("设置…", null, (_, _) => ShowSettings());
        menu.Items.Add(new ToolStripSeparator()); menu.Items.Add("退出", null, (_, _) => Quit());
        tray = new NotifyIcon { Text = "Tracelo · 快捷创建", Icon = icon, Visible = !smoke, ContextMenuStrip = menu };
        tray.DoubleClick += (_, _) => Show();
        if (Native.RegisterHotKey(Window.Handle, 1, State.HotkeyModifiers | 0x4000, State.HotkeyKey)) hotkeyId = 1;
        else shortcutError = "快捷键已被占用。请打开设置更换，仍可通过托盘创建任务。";
        if (Native.RegisterHotKey(Window.Handle, 3, State.ProgressHotkeyModifiers | 0x4000, State.ProgressHotkeyKey)) progressHotkeyId = 3;
        else shortcutError += " 记录进展快捷键不可用，请在设置中更换。";
        refreshTimer.Tick += (_, _) => { if (Window.Visible) RefreshQuick(); }; refreshTimer.Start();
        if (!smoke && (State.Vault.Length == 0 || hotkeyId == 0)) Show();
    }
    private void OnAction(string action, JsonElement message) {
        if (action == "smart") { ReceiveSmart(message.Clone()); return; }
        try {
            if (action == "ready") { UpdateState(focus: Window.Visible); return; }
            if (action == "resize") {
                if (message.TryGetProperty("height", out var height) && height.TryGetDouble(out var value) && double.IsFinite(value)) {
                    desiredHeight = (int)Math.Clamp(value, 320, 760); Fit();
                }
                return;
            }
            if (saving) return;
            if (message.TryGetProperty("draft", out var draft) && draft.ValueKind == JsonValueKind.Object) SaveDraft(draft);
            switch (action) {
                case "progressDraft": State.ProgressDrafts()[message.GetProperty("taskId").GetString()!] = message.GetProperty("text").GetString()!; State.Save(settingsPath); break;
                case "operation":
                    var operation = message.GetProperty("operation");
                    try { new QuickWorkspace(new CaptureConfiguration(State.Vault, State.TaskDirectory).Destination()).Enqueue(operation); RefreshQuick(); }
                    catch (Exception failure) { Window.Surface.Update(new() { ["receipts"] = new[] { new { id = operation.GetProperty("id").GetString(), status = "failed", message = failure.Message } } }); }
                    break;
                case "progressDismiss": case "progressComplete": HideWindow(); break;
                case "openTaskFolder":
                    var sources = JsonSerializer.SerializeToElement(new QuickWorkspace(new CaptureConfiguration(State.Vault, State.TaskDirectory).Destination()).Tasks());
                    var requestedPath = message.GetProperty("path").GetString();
                    foreach (var source in sources.EnumerateArray()) {
                        if (source.GetProperty("path").GetString() != requestedPath) continue;
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(Path.GetDirectoryName(source.GetProperty("path").GetString()!)!) { UseShellExecute = true });
                        break;
                    }
                    break;
                case "change": break;
                case "dismiss": HideWindow(); break;
                case "settings": ShowSettings(); break;
                case "submit": Submit(message.GetProperty("request")); break;
            }
        } catch (Exception error) { Window.Surface.Update(new() { ["saving"] = false, ["error"] = error.Message }); }
    }
    private void SaveDraft(JsonElement draft) {
        State.SetDraft(draft); State.Save(settingsPath);
    }
    private void Fit() {
        if (Window.IsDisposed) return;
        var area = Screen.FromPoint(Cursor.Position).WorkingArea;
        var border = Window.Size - Window.ClientSize;
        var fit = WindowPlacement.Fit(area.Left, area.Top, area.Width, area.Height,
            (int)(554 * Window.DeviceDpi / 96d) + border.Width, (int)(desiredHeight * Window.DeviceDpi / 96d) + border.Height);
        var bounds = new Rectangle(fit.X, fit.Y, fit.Width, fit.Height);
        if (Window.Bounds != bounds) Window.Bounds = bounds;
    }
    internal void Show() {
        if (!Window.Visible) previousWindow = Native.GetForegroundWindow();
        Theme.Refresh(Window); Fit(); Window.Show(); Fit(); Window.Activate(); Native.SetForegroundWindow(Window.Handle);
        UpdateState(focus: true);
        Window.Surface.Update(new() { ["mode"] = "create" });
    }
    private void ShowProgress() { Show(); Window.Surface.Update(new() { ["mode"] = "progress" }); }
    private void RefreshQuick() {
        try { var workspace = new QuickWorkspace(new CaptureConfiguration(State.Vault, State.TaskDirectory).Destination()); Window.Surface.Update(new() { ["tasks"] = workspace.Tasks(), ["receipts"] = workspace.Receipts(), ["uiSettings"] = workspace.UiSettings() }); }
        catch (Exception error) { Window.Surface.Update(new() { ["quickError"] = error.Message }); }
    }
    private async Task SnapshotDraftAsync() {
        if (Window.Surface.Ready) {
            using var draft = JsonDocument.Parse(await Window.Surface.EvaluateAsync("window.capture.getDraft()"));
            State.SetDraft(draft.RootElement);
        }
        State.Save(settingsPath);
    }
    internal async void Dismiss() {
        if (saving || dismissing) return;
        dismissing = true;
        try { await SnapshotDraftAsync(); HideWindow(); }
        catch (Exception error) { Window.Surface.Update(new() { ["error"] = "草稿未能保存：" + error.Message }); }
        finally { dismissing = false; }
    }
    private void HideWindow() {
        Window.Hide();
        if (previousWindow != IntPtr.Zero && previousWindow != Window.Handle) Native.SetForegroundWindow(previousWindow);
        previousWindow = IntPtr.Zero;
    }
    private void Submit(JsonElement request) {
        if (saving || !Window.Visible) return;
        saving = true; Window.Surface.Update(new() { ["saving"] = true, ["error"] = "" });
        try {
            var destination = new CaptureConfiguration(State.Vault, State.TaskDirectory).Destination();
            var currentGroups = CaptureConfiguration.ReadGroupsArchive(destination);
            if (currentGroups != State.GroupsSource)
                throw new IOException("分组档案已更新，请确认当前分组后重新创建；草稿已保留");
            var candidate = CaptureRequest.FromSharedForm(request.GetProperty("id").GetString()!, request.GetProperty("markdown").GetString()!);
            State.PendingRequest ??= candidate;
            State.Save(settingsPath);
            CaptureRequest.FromSharedForm(State.PendingRequest.Id, State.PendingRequest.Markdown).Publish(destination, request.TryGetProperty("attachments", out var attachments) ? attachments : null);
            var oldDraft = State.FormDraft; var oldPending = State.PendingRequest;
            State.FormDraft = null; State.Draft = ""; State.PendingRequest = null;
            try { State.Save(settingsPath); }
            catch { State.FormDraft = oldDraft; State.PendingRequest = oldPending; throw; }
            Window.Surface.Update(new() { ["draft"] = null, ["saving"] = false, ["error"] = "", ["restored"] = false });
            // The shared form confirms this completed write, then requests dismissal.
            saving = false;
        } catch (Exception error) {
            saving = false;
            UpdateState(errorMessage: "创建未完成：" + error.Message);
        }
        finally { saving = false; }
    }
    internal void ApplySettings(CaptureSettings candidate) {
        _ = new CaptureConfiguration(candidate.Vault, candidate.TaskDirectory).Destination();
        var changed = hotkeyId == 0 || candidate.HotkeyKey != State.HotkeyKey || candidate.HotkeyModifiers != State.HotkeyModifiers;
        var candidateId = hotkeyId == 1 ? 2 : 1;
        var progressChanged = progressHotkeyId == 0 || candidate.ProgressHotkeyKey != State.ProgressHotkeyKey || candidate.ProgressHotkeyModifiers != State.ProgressHotkeyModifiers;
        var progressCandidateId = progressHotkeyId == 3 ? 4 : 3;
        if (changed && !Native.RegisterHotKey(Window.Handle, candidateId, candidate.HotkeyModifiers | 0x4000, candidate.HotkeyKey))
            throw new IOException("该快捷键已被占用或无法注册。原快捷键和设置已保留，请换一个组合。");
        if (progressChanged && !Native.RegisterHotKey(Window.Handle, progressCandidateId, candidate.ProgressHotkeyModifiers | 0x4000, candidate.ProgressHotkeyKey)) {
            if (changed) Native.UnregisterHotKey(Window.Handle, candidateId);
            throw new IOException("记录进展快捷键被占用，原设置已保留");
        }
        var targetChanged = candidate.CopyDraftFrom(State);
        try { candidate.Save(settingsPath); }
        catch { if (changed) Native.UnregisterHotKey(Window.Handle, candidateId); if (progressChanged) Native.UnregisterHotKey(Window.Handle, progressCandidateId); throw; }
        if (changed) { if (hotkeyId != 0) Native.UnregisterHotKey(Window.Handle, hotkeyId); hotkeyId = candidateId; }
        if (progressChanged) { if (progressHotkeyId != 0) Native.UnregisterHotKey(Window.Handle, progressHotkeyId); progressHotkeyId = progressCandidateId; }
        State = candidate; shortcutError = ""; UpdateState(focus: true, resetPending: targetChanged);
    }
    private void UpdateState(bool focus = false, string? errorMessage = null, bool resetPending = false) {
        var configured = false; var error = shortcutError; string? groups = null;
        try { var directory = new CaptureConfiguration(State.Vault, State.TaskDirectory).Destination(); groups = CaptureConfiguration.ReadGroupsArchive(directory); configured = true; }
        catch (Exception failure) { error = failure.Message; }
        resetPending |= State.UpdateGroupsSource(groups);
        if (errorMessage != null) error = errorMessage;
        Window.Surface.Update(new() {
            ["draft"] = State.RestoredDraft(), ["groupsSource"] = groups, ["configured"] = configured,
            ["workspace"] = State.WorkspaceKey, ["progressDrafts"] = State.ProgressDrafts(),
            ["location"] = configured ? Path.GetFileName(Path.TrimEndingDirectorySeparator(State.Vault)) : "设置保存位置…",
            ["directory"] = State.TaskDirectory, ["dark"] = Theme.Dark, ["saving"] = saving, ["error"] = error,
            ["restored"] = State.FormDraft != null || State.Draft.Length > 0, ["focus"] = focus, ["resetPending"] = resetPending
        });
        RefreshQuick();
    }
    private async void ShowSettings() {
        try { await SnapshotDraftAsync(); }
        catch (Exception error) { Window.Surface.Update(new() { ["error"] = "草稿未能保存：" + error.Message }); return; }
        using var dialog = new SettingsWindow(State, ApplySettings); dialog.ShowDialog(Window.Visible ? Window : null);
        if (Window.Visible) Window.Surface.Update(new() { ["focus"] = true });
    }
    private async void Quit() {
        if (saving) return;
        if (State.FormDraft is { ValueKind: JsonValueKind.Object } draft && draft.TryGetProperty("images", out var images) && images.ValueKind == JsonValueKind.Array
            && images.EnumerateArray().Any(image => image.TryGetProperty("state", out var state) && state.GetString() == "processing")) {
            Window.Surface.Update(new() { ["error"] = "图片正在处理，请等待完成后退出，图文草稿会一起保存。" }); Show(); return;
        }
        try { await SnapshotDraftAsync(); }
        catch (Exception error) { MessageBox.Show("草稿未能保存，请重试：" + error.Message, "Tracelo"); return; }
        ExitThread();
    }
    protected override void Dispose(bool disposing) {
        if (disposing && !disposed) {
            disposed = true;
            if (hotkeyId != 0 && Window.IsHandleCreated && !Window.IsDisposed) Native.UnregisterHotKey(Window.Handle, hotkeyId);
            if (progressHotkeyId != 0 && Window.IsHandleCreated && !Window.IsDisposed) Native.UnregisterHotKey(Window.Handle, progressHotkeyId);
            refreshTimer.Stop(); refreshTimer.Dispose();
            tray.Visible = false; tray.ContextMenuStrip?.Dispose(); tray.Dispose();
            Window.AllowClose = true; Window.Dispose(); icon.Dispose();
        }
        base.Dispose(disposing);
    }
}
