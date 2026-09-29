using System.Text.Json;
using System.Text.RegularExpressions;

namespace Tracelo;
public sealed class QuickWorkspace(string directory) {
    private string Queue => Path.Combine(directory, ".tracelo-operations");
    public object UiSettings() {
        var path = Path.Combine(directory, ".tracelo-ui.json");
        try {
            if (!File.Exists(path) || !Plain(path) || new FileInfo(path).Length >= 4096) return new { };
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            return document.RootElement.Clone();
        } catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException) { return new { }; }
    }
    private static bool Plain(string path) => (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0;
    public object[] Tasks() {
        var candidates = new List<string>();
        foreach (var path in Directory.EnumerateFileSystemEntries(directory)) {
            if (!Plain(path) || Path.GetFileName(path).StartsWith('.')) continue;
            if (Directory.Exists(path)) candidates.Add(Path.Combine(path, Path.GetFileName(path) + ".md"));
            else if (path.EndsWith(".md", StringComparison.OrdinalIgnoreCase) && !Path.GetFileName(path).StartsWith('_')) candidates.Add(path);
        }
        var output = new List<object>();
        foreach (var path in candidates) {
            if (!File.Exists(path) || !Plain(path)) continue;
            var source = File.ReadAllText(path);
            if (!source.StartsWith("<!-- work-timeline-task:v1\n", StringComparison.Ordinal)) continue;
            var images = new Dictionary<string, string>();
            foreach (Match match in Regex.Matches(source, @"!\[[^\]]*\]\(<?([^>\n)]+)>?\)")) {
                var name = match.Groups[1].Value;
                try {
                    var image = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(path)!, name));
                    if (!image.StartsWith(Path.GetFullPath(directory) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(image) || !Plain(image) || new FileInfo(image).Length > 10 * 1024 * 1024) continue;
                    // Reject links/junctions in any ancestor as well as the file itself.
                    var ancestor = Path.GetDirectoryName(image)!; var safe = true;
                    while (ancestor.Length >= directory.Length) { if (!Plain(ancestor)) { safe = false; break; } ancestor = Path.GetDirectoryName(ancestor) ?? ""; }
                    if (!safe) continue;
                    var type = Path.GetExtension(image).ToLowerInvariant() switch { ".png" => "png", ".jpg" or ".jpeg" => "jpeg", ".webp" => "webp", ".gif" => "gif", ".bmp" => "bmp", _ => null };
                    if (type != null) images[name] = "data:image/" + type + ";base64," + Convert.ToBase64String(File.ReadAllBytes(image));
                } catch (Exception error) when (error is IOException or ArgumentException or UnauthorizedAccessException) { /* Unavailable image keeps its original Markdown reference. */ }
            }
            output.Add(new { markdown = source, images, path });
        }
        return output.ToArray();
    }
    public void Enqueue(JsonElement operation) {
        var id = operation.GetProperty("id").GetString()!;
        if (!Regex.IsMatch(id, "^quick-[a-f0-9]{32}$") || operation.GetProperty("version").GetInt32() != 1 || string.IsNullOrEmpty(operation.GetProperty("taskId").GetString())) throw new ArgumentException("快捷操作无效");
        if (Directory.Exists(Queue) && !Plain(Queue)) throw new IOException("快捷操作目录不能是符号链接");
        Directory.CreateDirectory(Queue);
        var destination = Path.Combine(Queue, id + ".request.json");
        var sorted = new SortedDictionary<string, JsonElement>(operation.EnumerateObject().ToDictionary(p => p.Name, p => p.Value), StringComparer.Ordinal);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(sorted);
        if (File.Exists(destination)) {
            if (!Plain(destination) || !File.ReadAllBytes(destination).SequenceEqual(bytes)) throw new IOException("快捷操作 ID 冲突");
        } else {
            var temporary = Path.Combine(Queue, Guid.NewGuid() + ".tmp");
            try {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { stream.Write(bytes); stream.Flush(true); }
                File.Move(temporary, destination, false);
            } finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        var result = Path.Combine(Queue, id + ".result.json");
        if (File.Exists(result) && Plain(result)) {
            using var receipt = JsonDocument.Parse(File.ReadAllText(result));
            if (receipt.RootElement.GetProperty("status").GetString() == "failed") File.Delete(result);
        }
    }
    public object[] Receipts() {
        if (!Directory.Exists(Queue) || !Plain(Queue)) return [];
        var output = new List<object>();
        foreach (var path in Directory.EnumerateFiles(Queue, "*.request.json")) {
            if (!Plain(path)) continue;
            try {
                using var operation = JsonDocument.Parse(File.ReadAllText(path));
                var id = operation.RootElement.GetProperty("id").GetString()!;
                if (!Regex.IsMatch(id, "^quick-[a-f0-9]{32}$")) continue;
                var result = Path.Combine(Queue, id + ".result.json");
                var status = "queued"; var message = "已暂存，打开 Obsidian 后写入任务";
                if (File.Exists(result) && Plain(result)) { using var receipt = JsonDocument.Parse(File.ReadAllText(result)); status = receipt.RootElement.GetProperty("status").GetString()!; message = receipt.RootElement.GetProperty("message").GetString()!; }
                output.Add(new { id, status, message, operation = operation.RootElement.Clone() });
            } catch (JsonException) { /* A result may still be in the process of being written. */ }
        }
        return output.ToArray();
    }
}
