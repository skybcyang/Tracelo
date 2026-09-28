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
    internal static bool Dark { get; private set; } = SystemDark();
    internal static Color Background => SystemInformation.HighContrast ? SystemColors.Window : Dark ? Color.FromArgb(23, 32, 51) : Color.FromArgb(245, 247, 250);
    internal static Color Surface => SystemInformation.HighContrast ? SystemColors.Window : Dark ? Color.FromArgb(31, 43, 64) : Color.White;
    internal static Color Text => SystemInformation.HighContrast ? SystemColors.WindowText : Dark ? Color.FromArgb(236, 241, 248) : Color.FromArgb(23, 32, 51);
    internal static Color Muted => SystemInformation.HighContrast ? SystemColors.WindowText : Dark ? Color.FromArgb(179, 194, 214) : Color.FromArgb(82, 99, 119);
    internal static Color Accent => SystemInformation.HighContrast ? SystemColors.Highlight : Color.FromArgb(36, 91, 231);
    internal static Color Error => SystemInformation.HighContrast ? SystemColors.WindowText : Dark ? Color.FromArgb(255, 170, 177) : Color.FromArgb(166, 39, 45);
    private static bool SystemDark() {
        try { return Microsoft.Win32.Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) is int mode && mode == 0; }
        catch { return false; }
    }
    internal static void Refresh(Form form, bool? dark = null) {
        Dark = dark ?? SystemDark();
        void Paint(Control control) {
            if (control is Microsoft.Web.WebView2.WinForms.WebView2) return;
            control.BackColor = control is TextBox ? Surface : Background;
            control.ForeColor = control.Tag as string == "error" ? Error : control.Tag as string == "muted" ? Muted : Text;
            if (control is Button button) {
                var primary = button.Tag as string == "primary";
                button.BackColor = primary ? Accent : Surface;
                button.ForeColor = primary ? SystemInformation.HighContrast ? SystemColors.HighlightText : Color.White : Text;
                button.FlatAppearance.BorderColor = primary ? Accent : Muted;
            }
            foreach (Control child in control.Controls) Paint(child);
        }
        Paint(form);
    }
    internal static void Apply(Form form, string title, Size size) {
        form.Text = title; form.ClientSize = size;
        form.AutoScaleMode = AutoScaleMode.Dpi; form.Font = new Font("Microsoft YaHei UI", 10);
        form.BackColor = Background; form.ForeColor = Text; form.StartPosition = FormStartPosition.CenterScreen;
    }
    internal static Button Button(string title, bool primary = false) {
        var button = new Button { Text = title, AutoSize = true, MinimumSize = new Size(96, 36), Cursor = Cursors.Hand,
            FlatStyle = FlatStyle.Flat, BackColor = primary ? Accent : Surface, ForeColor = primary ? Color.White : Text, Margin = new Padding(8, 0, 0, 0), Tag = primary ? "primary" : "secondary" };
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
