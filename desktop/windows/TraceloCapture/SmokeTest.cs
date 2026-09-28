using Tracelo;

namespace TraceloCapture;

// Runs inside the published Windows executable; never reads or modifies user preferences.
internal static class SmokeTest {
    internal static int Run(string outputDirectory) {
        Directory.CreateDirectory(outputDirectory);
        var root = Path.Combine(outputDirectory, "smoke-" + Guid.NewGuid());
        Directory.CreateDirectory(Path.Combine(root, "tasks"));
        var path = Path.Combine(root, "settings.json");
        var log = new List<string>();
        void Check(bool condition, string name) { if (!condition) throw new Exception(name); log.Add("PASS " + name); }
        try {
            new CaptureSettings { Vault = root, TaskDirectory = "tasks", HotkeyModifiers = 3, HotkeyKey = (uint)Keys.F11 }.Save(path);
            using (var app = new CaptureApplication(path, smoke: true)) {
                app.Show(); Application.DoEvents();
                Check(app.Window.Visible && app.Window.Editor.Focused, "native capture window opens and focuses editor");
                app.Window.Editor.Text = "保留草稿\r\n详情";
                app.Window.Editor.HandleInput(Keys.Escape); Application.DoEvents();
                Check(!app.Window.Visible && CaptureSettings.Load(path).Draft.Contains("详情"), "Escape hides window and persists draft");
                Native.SendMessage(app.Window.Handle, 0x312, (IntPtr)1, IntPtr.Zero); Application.DoEvents();
                Check(app.Window.Visible, "WM_HOTKEY reopens capture window");
                Native.SendMessage(app.Window.Editor.Handle, 0x10D, IntPtr.Zero, IntPtr.Zero);
                Check(!app.Window.Editor.HandleInput(Keys.Enter), "IME Enter remains a composition key");
                Check(!app.Window.Editor.HandleInput(Keys.Escape), "IME Escape remains a composition key");
                Check(Directory.GetFiles(Path.Combine(root, "tasks"), "*.md").Length == 0, "IME confirmation never creates a task");
                Native.SendMessage(app.Window.Editor.Handle, 0x10E, IntPtr.Zero, IntPtr.Zero);
                Check(!app.Window.Editor.HandleInput(Keys.Enter), "IME end confirmation guard remains active");
                // Test a genuine registration collision while preserving the existing shortcut.
                using var occupied = new Form(); _ = occupied.Handle;
                Check(Native.RegisterHotKey(occupied.Handle, 97, 0x4003, (uint)Keys.F12), "test reserves competing shortcut");
                try {
                    var rejected = false;
                    try { app.ApplySettings(new CaptureSettings { Vault = root, TaskDirectory = "tasks", HotkeyModifiers = 3, HotkeyKey = (uint)Keys.F12 }); }
                    catch (IOException) { rejected = true; }
                    Check(rejected && app.State.HotkeyKey == (uint)Keys.F11, "shortcut conflict retains original settings");
                } finally { Native.UnregisterHotKey(occupied.Handle, 97); }
                Check(!app.Window.Editor.HandleInput(Keys.Shift | Keys.Enter), "Shift+Enter stays in the editor");
                app.Submit(); Application.DoEvents();
                Check(!app.Window.Visible && app.Window.Editor.Text == "", "successful submit clears draft and hides window");
                Check(Directory.GetFiles(Path.Combine(root, "tasks"), "*.md").Length == 1, "submit publishes exactly one task");
                app.Show(); app.State.TaskDirectory = "missing"; app.Window.Editor.Text = "失败时保留"; app.Submit();
                Check(app.Window.Visible && app.Window.Editor.Text == "失败时保留" && app.Window.Error.Text.Length > 0, "save failure retains draft and visible error");
                using var capture = new Bitmap(app.Window.Width, app.Window.Height);
                app.Window.DrawToBitmap(capture, new Rectangle(Point.Empty, capture.Size));
                capture.Save(Path.Combine(outputDirectory, "capture-smoke.png"));
                using var settings = new SettingsWindow(app.State, _ => { }); settings.Show(); Application.DoEvents();
                using var settingsImage = new Bitmap(settings.Width, settings.Height);
                settings.DrawToBitmap(settingsImage, new Rectangle(Point.Empty, settingsImage.Size));
                settingsImage.Save(Path.Combine(outputDirectory, "settings-smoke.png")); settings.Close();
                app.Dismiss();
            }
            using (var restarted = new CaptureApplication(path, smoke: true))
                Check(restarted.Window.Editor.Text == "失败时保留", "process restart restores persistent draft");
            File.WriteAllLines(Path.Combine(outputDirectory, "smoke-result.txt"), log.Append("Windows native smoke test passed"));
            return 0;
        } catch (Exception failure) {
            File.WriteAllLines(Path.Combine(outputDirectory, "smoke-result.txt"), log.Append(failure.ToString()));
            return 1;
        } finally { Directory.Delete(root, true); }
    }
}
