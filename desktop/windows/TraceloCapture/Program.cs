using System.Runtime.InteropServices;
using Tracelo;

namespace TraceloCapture;

internal static class Program {
    [STAThread]
    private static int Main(string[] args) {
        ApplicationConfiguration.Initialize();
        if (args.Length == 2 && args[0] == "--smoke-test") return SmokeTest.Run(args[1]);
        using var singleInstance = new Mutex(true, "Local\\Tracelo.Capture", out var first);
        if (!first) { MessageBox.Show("Tracelo 已在运行，请使用托盘图标或全局快捷键。", "Tracelo"); return 0; }
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tracelo", "Capture", "settings.json");
        try {
            using var context = new CaptureApplication(path);
            Application.Run(context);
            return 0;
        } catch (Exception error) {
            MessageBox.Show("无法启动 Tracelo：" + error.Message + "\n设置和草稿未被覆盖。\n" + path, "Tracelo", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

internal static class Native {
    [DllImport("user32.dll", SetLastError = true)] internal static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] internal static extern bool UnregisterHotKey(IntPtr window, int id);
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll")] internal static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
}

internal static class Theme {
    internal static readonly Color Background = Color.FromArgb(245, 247, 250);
    internal static readonly Color Text = Color.FromArgb(23, 32, 51);
    internal static readonly Color Muted = Color.FromArgb(82, 99, 119);
    internal static readonly Color Accent = Color.FromArgb(36, 91, 231);
    internal static readonly Color Error = Color.FromArgb(166, 39, 45);
    internal static void Apply(Form form, string title, Size size) {
        form.Text = title; form.ClientSize = size; form.MinimumSize = form.Size;
        form.AutoScaleMode = AutoScaleMode.Dpi; form.Font = new Font("Microsoft YaHei UI", 10);
        form.BackColor = Background; form.ForeColor = Text; form.StartPosition = FormStartPosition.CenterScreen;
    }
    internal static Button Button(string title, bool primary = false) {
        var button = new Button { Text = title, AutoSize = true, MinimumSize = new Size(96, 36), Cursor = Cursors.Hand,
            FlatStyle = FlatStyle.Flat, BackColor = primary ? Accent : Color.White, ForeColor = primary ? Color.White : Text, Margin = new Padding(8, 0, 0, 0) };
        button.FlatAppearance.BorderColor = primary ? Accent : Color.FromArgb(176, 189, 205);
        return button;
    }
    internal static Icon CreateIcon() {
        using var bitmap = new Bitmap(32, 32);
        using (var graphics = Graphics.FromImage(bitmap)) {
            graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var brush = new SolidBrush(Accent); graphics.FillEllipse(brush, 1, 1, 30, 30);
            using var pen = new Pen(Color.White, 2.5f); graphics.DrawLines(pen, new Point[] { new(9, 10), new(23, 10), new(16, 10), new(16, 23) });
        }
        var handle = bitmap.GetHicon();
        try { return (Icon)Icon.FromHandle(handle).Clone(); } finally { Native.DestroyIcon(handle); }
    }
}

internal sealed class CaptureEditor : TextBox {
    internal bool Composing { get; private set; }
    private long compositionEnded = long.MinValue;
    internal event Action? Submit;
    internal event Action? Dismiss;
    internal CaptureEditor() {
        Multiline = true; AcceptsReturn = true; ScrollBars = ScrollBars.Vertical;
        Dock = DockStyle.Fill; Font = new Font("Microsoft YaHei UI", 12); BorderStyle = BorderStyle.FixedSingle;
        AccessibleName = "任务标题和详情"; PlaceholderText = "第一行输入任务标题\r\n后续内容保存为详情";
    }
    protected override void WndProc(ref Message message) {
        if (message.Msg == 0x10D) Composing = true; // WM_IME_STARTCOMPOSITION
        if (message.Msg == 0x10E) { Composing = false; compositionEnded = Environment.TickCount64; }
        base.WndProc(ref message);
    }
    internal bool HandleInput(Keys keyData) {
        var composing = Composing || (compositionEnded != long.MinValue && Environment.TickCount64 - compositionEnded < 150);
        switch (InputBehavior.Action((int)(keyData & Keys.KeyCode), (keyData & Keys.Shift) != 0, composing)) {
            case InputAction.Submit: Submit?.Invoke(); return true;
            case InputAction.Dismiss: Dismiss?.Invoke(); return true;
            default: return false;
        }
    }
    protected override bool ProcessCmdKey(ref Message message, Keys keyData) => HandleInput(keyData) || base.ProcessCmdKey(ref message, keyData);
}

internal sealed class CaptureWindow : Form {
    internal readonly CaptureEditor Editor = new();
    internal readonly Button Create = Theme.Button("创建任务", true);
    internal readonly Label Destination = new() { Dock = DockStyle.Fill, ForeColor = Theme.Muted, AutoEllipsis = true, AccessibleName = "任务保存位置" };
    internal readonly Label Error = new() { Dock = DockStyle.Fill, ForeColor = Theme.Error, AutoSize = false, AccessibleName = "保存状态" };
    internal event Action? Submit;
    internal event Action? Dismiss;
    internal event Action? Settings;
    internal event Action? Hotkey;
    internal bool AllowClose;
    internal CaptureWindow() {
        Theme.Apply(this, "Tracelo · 创建任务", new Size(580, 342));
        TopMost = true; ShowInTaskbar = false; MaximizeBox = false; MinimizeBox = false;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24, 18, 24, 16), ColumnCount = 1, RowCount = 7 };
        foreach (var height in new[] { 26f, 26f, 26f }) layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        foreach (var height in new[] { 46f, 28f, 38f }) layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        layout.Controls.Add(new Label { Text = "任务内容", Dock = DockStyle.Fill, Font = new Font(Font, FontStyle.Bold), AutoSize = true });
        layout.Controls.Add(new Label { Text = "第一行作为标题，其余内容保存为详情", Dock = DockStyle.Fill, ForeColor = Theme.Muted });
        layout.Controls.Add(Destination);
        layout.Controls.Add(Editor); layout.Controls.Add(Error);
        layout.Controls.Add(new Label { Text = "Enter 创建 · Shift+Enter 换行 · Esc 保留草稿", Dock = DockStyle.Fill, ForeColor = Theme.Muted, Font = new Font(Font.FontFamily, 9) });
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft };
        Create.Click += (_, _) => Submit?.Invoke();
        var settings = Theme.Button("设置…"); settings.Click += (_, _) => Settings?.Invoke();
        buttons.Controls.Add(Create); buttons.Controls.Add(settings); layout.Controls.Add(buttons); Controls.Add(layout);
        Editor.Submit += () => Submit?.Invoke(); Editor.Dismiss += () => Dismiss?.Invoke();
        FormClosing += (_, e) => { if (!AllowClose) { e.Cancel = true; Dismiss?.Invoke(); } };
    }
    protected override void WndProc(ref Message message) {
        if (message.Msg == 0x312) Hotkey?.Invoke();
        base.WndProc(ref message);
    }
}

internal sealed class CaptureApplication : ApplicationContext {
    internal readonly CaptureWindow Window = new();
    internal CaptureSettings State { get; private set; }
    private readonly string settingsPath;
    private readonly NotifyIcon tray;
    private readonly Icon icon = Theme.CreateIcon();
    private IntPtr previousWindow;
    private int hotkeyId;
    private CaptureRequest? pending;
    private string? pendingText;
    private bool saving;
    internal CaptureApplication(string settingsPath, bool smoke = false) {
        this.settingsPath = settingsPath; State = CaptureSettings.Load(settingsPath);
        Window.Icon = icon; Window.Editor.Text = State.Draft ?? "";
        UpdateState();
        if (Window.Editor.Text.Length > 0) Window.Error.Text = "已恢复上次草稿";
        _ = Window.Handle;
        Window.Editor.TextChanged += (_, _) => {
            if (pendingText != Window.Editor.Text) { pending = null; pendingText = null; }
            State.Draft = Window.Editor.Text;
            UpdateState();
            try { State.Save(settingsPath); Window.Error.Text = ""; }
            catch (Exception error) { Window.Error.Text = "草稿暂未保存：" + error.Message; }
        };
        Window.Submit += Submit; Window.Dismiss += Dismiss; Window.Settings += ShowSettings;
        Window.Hotkey += () => { if (Window.Visible) Dismiss(); else Show(); };
        var menu = new ContextMenuStrip();
        menu.Items.Add("创建任务", null, (_, _) => Show());
        menu.Items.Add("设置…", null, (_, _) => ShowSettings());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出", null, (_, _) => Quit());
        tray = new NotifyIcon { Text = "Tracelo · 快捷创建", Icon = icon, Visible = !smoke, ContextMenuStrip = menu };
        tray.DoubleClick += (_, _) => Show();
        if (Native.RegisterHotKey(Window.Handle, 1, State.HotkeyModifiers | 0x4000, State.HotkeyKey)) hotkeyId = 1;
        else Window.Error.Text = "快捷键已被占用。请打开设置更换，仍可通过托盘创建任务。";
        if (!smoke && (State.Vault.Length == 0 || hotkeyId == 0)) Show();
    }
    internal void Show() {
        if (!Window.Visible) previousWindow = Native.GetForegroundWindow();
        var area = Screen.FromPoint(Cursor.Position).WorkingArea;
        Window.Location = new Point(area.Left + (area.Width - Window.Width) / 2, area.Top + (area.Height - Window.Height) / 2);
        if (State.Vault.Length == 0) Window.Error.Text = "首次使用请打开设置，选择 Obsidian vault 和任务目录。";
        Window.Show(); Window.Activate(); Native.SetForegroundWindow(Window.Handle); Window.Editor.Focus();
    }
    internal void Dismiss() {
        try { State.Draft = Window.Editor.Text; State.Save(settingsPath); }
        catch (Exception error) { Window.Error.Text = "草稿未能保存：" + error.Message; return; }
        Window.Hide();
        if (previousWindow != IntPtr.Zero && previousWindow != Window.Handle) Native.SetForegroundWindow(previousWindow);
        previousWindow = IntPtr.Zero;
    }
    internal void Submit() {
        if (saving || Window.Editor.Composing || !Window.Visible) return;
        saving = true; Window.Create.Enabled = false; Window.Create.Text = "创建中…";
        try {
            var destination = new CaptureConfiguration(State.Vault, State.TaskDirectory).Destination();
            if (pending == null || pendingText != Window.Editor.Text) {
                pending = CaptureRequest.Create(Window.Editor.Text); pendingText = Window.Editor.Text;
            }
            pending.Publish(destination);
            State.Draft = "";
            try { State.Save(settingsPath); } catch { State.Draft = Window.Editor.Text; throw; }
            Window.Editor.Clear(); pending = null; pendingText = null; Window.Error.Text = "";
            Dismiss();
        } catch (Exception error) { Window.Error.Text = "创建未完成：" + error.Message; }
        finally { saving = false; Window.Create.Text = "创建任务"; UpdateState(); }
    }
    internal void ApplySettings(CaptureSettings candidate) {
        _ = new CaptureConfiguration(candidate.Vault, candidate.TaskDirectory).Destination();
        var changed = hotkeyId == 0 || candidate.HotkeyKey != State.HotkeyKey || candidate.HotkeyModifiers != State.HotkeyModifiers;
        var candidateId = hotkeyId == 1 ? 2 : 1;
        if (changed && !Native.RegisterHotKey(Window.Handle, candidateId, candidate.HotkeyModifiers | 0x4000, candidate.HotkeyKey))
            throw new IOException("该快捷键已被占用或无法注册。原快捷键和设置已保留，请换一个组合。");
        try { candidate.Draft = Window.Editor.Text; candidate.Save(settingsPath); }
        catch { if (changed) Native.UnregisterHotKey(Window.Handle, candidateId); throw; }
        if (changed) { if (hotkeyId != 0) Native.UnregisterHotKey(Window.Handle, hotkeyId); hotkeyId = candidateId; }
        State = candidate; Window.Error.Text = ""; UpdateState();
    }
    private void UpdateState() {
        Window.Create.Enabled = !saving && State.Vault.Length > 0 && Window.Editor.Text.Split('\n')[0].Trim().Length > 0;
        Window.Destination.Text = State.Vault.Length == 0 ? "尚未设置保存位置 · 请打开设置" : $"{Path.GetFileName(Path.TrimEndingDirectorySeparator(State.Vault))} · 未分组";
    }
    private void ShowSettings() {
        using var dialog = new SettingsWindow(State, ApplySettings);
        dialog.ShowDialog(Window.Visible ? Window : null);
        if (Window.Visible) Window.Editor.Focus();
    }
    private void Quit() {
        try { State.Draft = Window.Editor.Text; State.Save(settingsPath); }
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
