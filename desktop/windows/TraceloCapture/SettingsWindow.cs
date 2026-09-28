using Tracelo;

namespace TraceloCapture;

internal sealed class SettingsWindow : Form {
    private readonly TextBox vault = new() { Dock = DockStyle.Fill, AccessibleName = "Obsidian vault 路径" };
    private readonly TextBox directory = new() { Dock = DockStyle.Fill, AccessibleName = "任务相对目录" };
    private readonly TextBox shortcut = new() { Dock = DockStyle.Fill, ReadOnly = true, AccessibleName = "全局快捷键，聚焦后按组合键" };
    private uint modifiers;
    private uint key;
    internal SettingsWindow(CaptureSettings state, Action<CaptureSettings> apply) {
        Theme.Apply(this, "Tracelo · 设置", new Size(600, 400));
        MaximizeBox = false; MinimizeBox = false; ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;
        vault.Text = state.Vault; directory.Text = state.TaskDirectory;
        modifiers = state.HotkeyModifiers; key = state.HotkeyKey; shortcut.Text = ShortcutLabel();
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 9 };
        foreach (var height in new[] { 26f, 38f, 26f, 38f, 26f, 38f, 44f }) layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        layout.Controls.Add(Label("Obsidian vault"));
        var vaultRow = new TableLayoutPanel { ColumnCount = 2, Dock = DockStyle.Fill };
        vaultRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); vaultRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 104));
        vaultRow.Controls.Add(vault); var browse = Theme.Button("选择…"); vaultRow.Controls.Add(browse);
        browse.Click += (_, _) => {
            using var picker = new FolderBrowserDialog { Description = "选择 Obsidian vault", UseDescriptionForTitle = true, SelectedPath = vault.Text };
            if (picker.ShowDialog(this) == DialogResult.OK) vault.Text = picker.SelectedPath;
        };
        layout.Controls.Add(vaultRow); layout.Controls.Add(Label("任务目录（相对于 vault）")); layout.Controls.Add(directory);
        layout.Controls.Add(Label("全局快捷键（点击后按 Ctrl / Alt 组合键）")); layout.Controls.Add(shortcut);
        layout.Controls.Add(new Label { Text = "目录须已存在，并与插件设置一致。新任务默认为未分组、不重要、不紧急。", Dock = DockStyle.Fill, ForeColor = Theme.Muted });
        var error = new Label { Dock = DockStyle.Fill, ForeColor = Theme.Error, AccessibleName = "设置错误" }; layout.Controls.Add(error);
        shortcut.KeyDown += (_, e) => {
            e.SuppressKeyPress = true;
            if (e.KeyCode is Keys.ControlKey or Keys.ShiftKey or Keys.Menu or Keys.LWin or Keys.RWin) return;
            if (!e.Control && !e.Alt) { error.Text = "快捷键请至少包含 Ctrl 或 Alt。"; return; }
            modifiers = (uint)((e.Alt ? 1 : 0) | (e.Control ? 2 : 0) | (e.Shift ? 4 : 0));
            key = (uint)e.KeyCode; shortcut.Text = ShortcutLabel(); error.Text = "";
        };
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft };
        var save = Theme.Button("保存设置", true); var cancel = Theme.Button("取消");
        save.Click += (_, _) => {
            try {
                apply(new CaptureSettings { Vault = vault.Text.Trim(), TaskDirectory = directory.Text.Trim(), HotkeyKey = key, HotkeyModifiers = modifiers });
                DialogResult = DialogResult.OK; Close();
            } catch (Exception failure) { error.Text = failure.Message; }
        };
        cancel.Click += (_, _) => Close(); CancelButton = cancel;
        buttons.Controls.Add(save); buttons.Controls.Add(cancel); layout.Controls.Add(buttons); Controls.Add(layout);
    }
    private static Label Label(string text) => new() { Text = text, Dock = DockStyle.Fill, AutoSize = true };
    private string ShortcutLabel() => ((modifiers & 2) != 0 ? "Ctrl + " : "") + ((modifiers & 1) != 0 ? "Alt + " : "")
        + ((modifiers & 4) != 0 ? "Shift + " : "") + (key == 32 ? "Space" : ((Keys)key).ToString());
}
