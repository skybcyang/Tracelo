using Tracelo;
using System.Text.Json;

Console.OutputEncoding = new System.Text.UTF8Encoding(false);
if (args.Length == 2 && args[0] == "--fixture") {
    Console.Write(CaptureRequest.Fixture(int.Parse(args[1])).Markdown);
    return;
}
var passed = 0;
void Test(string name, Action action) { action(); Console.WriteLine($"PASS {name}"); passed++; }
void Equal<T>(T actual, T expected) { if (!Equals(actual, expected)) throw new Exception($"Expected {expected}, got {actual}"); }
void Reject(Action action) { try { action(); } catch (Exception e) when (e is ArgumentException or IOException) { return; } throw new Exception("Expected rejection"); }
var root = Path.Combine(Path.GetTempPath(), "tracelo-tests-" + Guid.NewGuid());
Directory.CreateDirectory(Path.Combine(root, "工作记录", "任务"));
try {
    Test("first line is title, CRLF normalizes, notes preserve blank lines", () => {
        var draft = CaptureDraft.Parse("  中文 *标题*  \r\n详情\r\n\r\n尾行");
        Equal(draft.Title, "中文 *标题*"); Equal(draft.Notes, "详情\n\n尾行");
        Reject(() => CaptureDraft.Parse(" \nnotes"));
    });
    Test("strict protocol preserves Unicode, control characters, and escaping", () => {
        for (var i = 0; i < 3; i++) {
            var source = CaptureRequest.Fixture(i).Markdown;
            var json = source.Split("\n-->\n\n")[0].Split("\n", 2)[1];
            var task = JsonDocument.Parse(json).RootElement;
            Equal(task.GetProperty("id").GetString(), "desktop-fixture-" + i);
            Equal(task.GetProperty("events")[0].GetProperty("offsetMinutes").GetInt32(), 480);
            Equal(task.GetProperty("events")[0].GetProperty("at").GetString(), "2026-09-27T00:00:00.123Z");
            Equal(source.Contains("\r"), false);
            Equal(task.TryGetProperty("notes", out _), i != 0);
        }
    });
    Test("task IDs obey portable filename rules", () => {
        foreach (var id in new[] { "..", "../escape", "NUL", "com1.md", "trailing.", "bad:name", "bad\u0001", new string('x', 181) })
            Reject(() => CaptureRequest.Create("title", id));
    });
    Test("configuration rejects missing, absolute, and traversing directories", () => {
        Equal(new CaptureConfiguration(root, "工作记录/任务").Destination(), Path.Combine(root, "工作记录", "任务"));
        foreach (var dir in new[] { "", "../escape", "工作记录/../任务", "/tmp", "C:\\escape", "工作记录/不存在" })
            Reject(() => new CaptureConfiguration(root, dir).Destination());
        Reject(() => new CaptureConfiguration("relative", "工作记录/任务").Destination());
    });
    Test("configuration rejects symbolic links leaving vault", () => {
        var link = Path.Combine(root, "outside");
        try { Directory.CreateSymbolicLink(link, Path.GetTempPath()); }
        catch (UnauthorizedAccessException) { Console.WriteLine("SKIP symlink creation requires OS permission"); return; }
        Reject(() => new CaptureConfiguration(root, "outside").Destination());
    });
    Test("atomic publish is idempotent and never overwrites another task", () => {
        var directory = new CaptureConfiguration(root, "工作记录/任务").Destination();
        var request = CaptureRequest.Fixture(1);
        var path = request.Publish(directory);
        Equal(File.ReadAllText(path), request.Markdown);
        Equal(request.Publish(directory), path);
        Reject(() => CaptureRequest.Create("different", request.Id).Publish(directory));
        Equal(File.ReadAllText(path), request.Markdown);
        Equal(Directory.GetFiles(directory, "*.tmp").Length, 0);
    });
    Test("IME confirmation does not submit or dismiss", () => {
        Equal(InputBehavior.Action(13, false, true), InputAction.System);
        Equal(InputBehavior.Action(27, false, true), InputAction.System);
        Equal(InputBehavior.Action(13, true, false), InputAction.System);
        Equal(InputBehavior.Action(13, false, false), InputAction.Submit);
        Equal(InputBehavior.Action(27, false, false), InputAction.Dismiss);
    });
    Test("draft survives restart and empty draft clears persistently", () => {
        var path = Path.Combine(root, "state", "settings.json");
        var state = new CaptureSettings { Draft = "任务\n详情", Vault = root };
        state.Save(path);
        Equal(CaptureSettings.Load(path).Draft, state.Draft);
        state.Draft = ""; state.Save(path);
        Equal(CaptureSettings.Load(path).Draft, "");
    });
    Console.WriteLine($"{passed} tests passed");
} finally { Directory.Delete(root, true); }
