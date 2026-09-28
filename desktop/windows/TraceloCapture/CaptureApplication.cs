using System.Text.Json;
using Tracelo;

namespace TraceloCapture;

internal sealed class CaptureWindow : Form {
    internal readonly CaptureSurface Surface;
    internal event Action? Dismiss;
    internal event Action? Hotkey;
    internal bool AllowClose;
    internal CaptureWindow(string profileDirectory) {
        Theme.Apply(this, "Tracelo · 新建任务", new Size(560, 540));
        Surface = new CaptureSurface(profileDirectory); Controls.Add(Surface);
        TopMost = true; ShowInTaskbar = false; MaximizeBox = false; MinimizeBox = false;
        FormClosing += (_, e) => { if (!AllowClose) { e.Cancel = true; Dismiss?.Invoke(); } };
        Shown += async (_, _) => await Surface.LoadAsync();
    }
    protected override void WndProc(ref Message message) {
        if (message.Msg == 0x312) Hotkey?.Invoke();
        if (message.Msg == 0x1A && Surface != null) { Theme.Refresh(this); Surface.Update(new() { ["dark"] = Theme.Dark }); }
        base.WndProc(ref message);
    }
}

internal sealed class CaptureApplication : ApplicationContext {
    internal readonly CaptureWindow Window;
    internal CaptureSettings State { get; private set; }
    private readonly string settingsPath;
    private readonly NotifyIcon tray;
    private readonly Icon icon = Theme.CreateIcon();
    private IntPtr previousWindow;
    private int hotkeyId;
    private bool saving;
    private bool dismissing;
    private string shortcutError = "";
    private int desiredHeight = 540;
    internal CaptureApplication(string settingsPath, bool smoke = false) {
        this.settingsPath = settingsPath; State = CaptureSettings.Load(settingsPath);
        Window = new CaptureWindow(Path.Combine(Path.GetDirectoryName(settingsPath)!, "WebView2")) { Icon = icon };
        _ = Window.Handle;
        Window.Dismiss += Dismiss;
        Window.Hotkey += () => { if (Window.Visible) Dismiss(); else Show(); };
        Window.Surface.Action += OnAction;
        var menu = new ContextMenuStrip();
        menu.Items.Add("创建任务", null, (_, _) => Show());
        menu.Items.Add("设置…", null, (_, _) => ShowSettings());
        menu.Items.Add(new ToolStripSeparator()); menu.Items.Add("退出", null, (_, _) => Quit());
        tray = new NotifyIcon { Text = "Tracelo · 快捷创建", Icon = icon, Visible = !smoke, ContextMenuStrip = menu };
        tray.DoubleClick += (_, _) => Show();
        if (Native.RegisterHotKey(Window.Handle, 1, State.HotkeyModifiers | 0x4000, State.HotkeyKey)) hotkeyId = 1;
        else shortcutError = "快捷键已被占用。请打开设置更换，仍可通过托盘创建任务。";
        if (!smoke && (State.Vault.Length == 0 || hotkeyId == 0)) Show();
    }
    private void OnAction(string action, JsonElement message) {
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
            (int)(560 * Window.DeviceDpi / 96d) + border.Width, (int)(desiredHeight * Window.DeviceDpi / 96d) + border.Height);
        var bounds = new Rectangle(fit.X, fit.Y, fit.Width, fit.Height);
        if (Window.Bounds != bounds) Window.Bounds = bounds;
    }
    internal void Show() {
        if (!Window.Visible) previousWindow = Native.GetForegroundWindow();
        Theme.Refresh(Window); Fit(); Window.Show(); Fit(); Window.Activate(); Native.SetForegroundWindow(Window.Handle);
        UpdateState(focus: true);
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
            CaptureRequest.FromSharedForm(State.PendingRequest.Id, State.PendingRequest.Markdown).Publish(destination);
            var oldDraft = State.FormDraft; var oldPending = State.PendingRequest;
            State.FormDraft = null; State.Draft = ""; State.PendingRequest = null;
            try { State.Save(settingsPath); }
            catch { State.FormDraft = oldDraft; State.PendingRequest = oldPending; throw; }
            Window.Surface.Update(new() { ["draft"] = null, ["saving"] = false, ["error"] = "", ["restored"] = false });
            saving = false; HideWindow();
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
        if (changed && !Native.RegisterHotKey(Window.Handle, candidateId, candidate.HotkeyModifiers | 0x4000, candidate.HotkeyKey))
            throw new IOException("该快捷键已被占用或无法注册。原快捷键和设置已保留，请换一个组合。");
        var targetChanged = candidate.CopyDraftFrom(State);
        try { candidate.Save(settingsPath); }
        catch { if (changed) Native.UnregisterHotKey(Window.Handle, candidateId); throw; }
        if (changed) { if (hotkeyId != 0) Native.UnregisterHotKey(Window.Handle, hotkeyId); hotkeyId = candidateId; }
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
            ["location"] = configured ? Path.GetFileName(Path.TrimEndingDirectorySeparator(State.Vault)) : "设置保存位置…",
            ["directory"] = State.TaskDirectory, ["dark"] = Theme.Dark, ["saving"] = saving, ["error"] = error,
            ["restored"] = State.FormDraft != null || State.Draft.Length > 0, ["focus"] = focus, ["resetPending"] = resetPending
        });
    }
    private async void ShowSettings() {
        try { await SnapshotDraftAsync(); }
        catch (Exception error) { Window.Surface.Update(new() { ["error"] = "草稿未能保存：" + error.Message }); return; }
        using var dialog = new SettingsWindow(State, ApplySettings); dialog.ShowDialog(Window.Visible ? Window : null);
        if (Window.Visible) Window.Surface.Update(new() { ["focus"] = true });
    }
    private async void Quit() {
        if (saving) return;
        try { await SnapshotDraftAsync(); }
        catch (Exception error) { MessageBox.Show("草稿未能保存，请重试：" + error.Message, "Tracelo"); return; }
        ExitThread();
    }
    protected override void Dispose(bool disposing) {
        if (disposing) {
            if (hotkeyId != 0) Native.UnregisterHotKey(Window.Handle, hotkeyId);
            tray.Visible = false; tray.ContextMenuStrip?.Dispose(); tray.Dispose();
            Window.AllowClose = true; Window.Dispose(); icon.Dispose();
        }
        base.Dispose(disposing);
    }
}
