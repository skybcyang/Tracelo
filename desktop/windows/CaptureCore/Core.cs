using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Tracelo;
public record CaptureDraft(string Title, string Notes) {
    public static CaptureDraft Parse(string text) {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var title = lines[0].Trim();
        if (title.Length == 0) throw new ArgumentException("第一行请输入任务标题");
        return new(title, string.Join("\n", lines.Skip(1)));
    }
}
public record CaptureConfiguration(string Vault, string TaskDirectory) {
    public string Destination() {
        var parts = TaskDirectory.Replace('\\', '/').Split('/');
        if (!Path.IsPathFullyQualified(Vault) || parts.Any(p => !CaptureRequest.SafeSegment(p)))
            throw new ArgumentException("请选择 vault，并填写 vault 内的相对任务目录");
        var current = Path.GetFullPath(Vault);
        if (!Directory.Exists(current)) throw new IOException("Vault 不存在，请重新选择");
        foreach (var part in parts) {
            current = Path.Combine(current, part);
            var info = new DirectoryInfo(current);
            if (!info.Exists) throw new IOException("任务目录不存在，请使用插件设置中的实际目录");
            // Reject links/junctions inside the vault, including those with an outside ancestor.
            if ((info.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("任务目录不能经过符号链接或目录联接，请选择 vault 内的实际目录");
        }
        return current;
    }
}
public record CaptureRequest(string Id, string Markdown) {
    public static bool SafeSegment(string value) => value.Length is > 0 and <= 180
        && !Regex.IsMatch(value, "[<>:\"/\\\\|?*\\x00-\\x1f]|[. ]$")
        && !Regex.IsMatch(value, @"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)", RegexOptions.IgnoreCase);

    // Deliberately match JSON.stringify rather than System.Text.Json's HTML/Unicode escaping.
    private static string Quote(string value) {
        var output = new StringBuilder("\"");
        foreach (var c in value) output.Append(c switch {
            '"' => "\\\"", '\\' => "\\\\", '\b' => "\\b", '\t' => "\\t", '\n' => "\\n", '\f' => "\\f", '\r' => "\\r",
            < ' ' => "\\u" + ((int)c).ToString("x4"), _ => c.ToString()
        });
        return output.Append('"').ToString();
    }
    private static string Inline(string value) => Regex.Replace(value.Replace("\r\n", "\n").Replace('\n', ' '), @"([\\`*_{}\[\]<>])", @"\$1");
    public static CaptureRequest Create(string text, string? id = null, string? eventId = null, DateTimeOffset? now = null, TimeZoneInfo? zone = null) {
        id ??= Guid.NewGuid().ToString();
        if (!SafeSegment(id)) throw new ArgumentException("任务 ID 无效");
        eventId ??= Guid.NewGuid().ToString();
        var draft = CaptureDraft.Parse(text);
        var instant = now ?? DateTimeOffset.UtcNow;
        zone ??= TimeZoneInfo.Local;
        var at = instant.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        var local = TimeZoneInfo.ConvertTime(instant, zone);
        var zoneId = TimeZoneInfo.TryConvertWindowsIdToIanaId(zone.Id, out var iana) ? iana : zone.Id;
        var fields = new List<string> {
            "  \"version\": 1", "  \"id\": " + Quote(id), "  \"title\": " + Quote(draft.Title),
            "  \"status\": \"active\"", "  \"groupId\": null", "  \"groupName\": \"未分组\"", "  \"important\": false", "  \"urgent\": false"
        };
        if (draft.Notes.Length > 0) fields.Add("  \"notes\": " + Quote(draft.Notes));
        var events = new (string, string)[] {
            ("id", Quote(eventId)), ("kind", Quote("created")), ("text", Quote("创建任务")), ("at", Quote(at)),
            ("day", Quote(local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))), ("timezone", Quote(zoneId)),
            ("offsetMinutes", ((int)local.Offset.TotalMinutes).ToString(CultureInfo.InvariantCulture)),
            ("title", Quote(draft.Title)), ("groupName", Quote("未分组")), ("important", "false"), ("urgent", "false")
        };
        fields.Add("  \"events\": [\n    {\n" + string.Join(",\n", events.Select(f => "      " + Quote(f.Item1) + ": " + f.Item2)) + "\n    }\n  ]");
        var notes = draft.Notes.Length == 0 ? "" : "\n\n## 详情\n\n" + draft.Notes;
        return new(id, "<!-- work-timeline-task:v1\n{\n" + string.Join(",\n", fields) + "\n}\n-->\n\n# " + Inline(draft.Title)
            + "\n\n- 状态：进行中\n- 分组：未分组\n- 象限：不重要 · 不紧急" + notes + "\n\n## 时间线\n\n- " + at + " · **创建** · 创建任务\n");
    }
    public static CaptureRequest Fixture(int index) {
        string[] examples = ["只有标题", "  中文 *任务* [链接] <tag> 😀  \n背景\n\n![图片](任务附件/截图.png)\nhttps://example.com/a/b\n尾行", "反斜线\\与\"引号\"\n\t制表\b\u0001\u2028分隔符\n<!-- 注释 -->"];
        return Create(examples[index], "desktop-fixture-" + index, "created-" + index,
            DateTimeOffset.FromUnixTimeMilliseconds(1790467200123), TimeZoneInfo.FindSystemTimeZoneById("Asia/Shanghai"));
    }
    public string Publish(string directory) {
        if (!SafeSegment(Id)) throw new ArgumentException("任务 ID 无效");
        var destination = Path.Combine(directory, Id + ".md");
        var temporary = Path.Combine(directory, ".tracelo-" + Guid.NewGuid() + ".tmp");
        var bytes = new UTF8Encoding(false, true).GetBytes(Markdown);
        try {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                stream.Write(bytes); stream.Flush(true);
            }
            try { File.Move(temporary, destination, false); }
            catch (IOException) when (File.Exists(destination)) {
                if (!File.ReadAllBytes(destination).SequenceEqual(bytes))
                    throw new IOException("同名文件已存在；没有覆盖，请重试");
            }
            return destination;
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
public enum InputAction { System, Submit, Dismiss }
public record WindowBounds(int X, int Y, int Width, int Height);
public static class WindowPlacement {
    public static WindowBounds Fit(int x, int y, int availableWidth, int availableHeight, int width, int height) {
        width = Math.Min(width, availableWidth); height = Math.Min(height, availableHeight);
        return new(x + (availableWidth - width) / 2, y + (availableHeight - height) / 2, width, height);
    }
}
public static class InputBehavior {
    public static InputAction Action(int key, bool shift, bool composing) => composing ? InputAction.System
        : key == 27 ? InputAction.Dismiss : key == 13 && !shift ? InputAction.Submit : InputAction.System;
}
public class CaptureSettings {
    public string Draft { get; set; } = "";
    public string Vault { get; set; } = "";
    public string TaskDirectory { get; set; } = "工作记录/任务";
    public uint HotkeyModifiers { get; set; } = 3; // Ctrl + Alt
    public uint HotkeyKey { get; set; } = 32; // Space
    public static CaptureSettings Load(string path) => !File.Exists(path) ? new()
        : JsonSerializer.Deserialize<CaptureSettings>(File.ReadAllText(path)) ?? throw new IOException("设置文件无效");
    public void Save(string path) {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid() + ".tmp";
        try {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                JsonSerializer.Serialize(stream, this, new JsonSerializerOptions { WriteIndented = true }); stream.Flush(true);
            }
            File.Move(temporary, path, true);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
