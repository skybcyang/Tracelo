using Tracelo;
using System.Text.Json;

Console.OutputEncoding = new System.Text.UTF8Encoding(false);
if (args.Length == 2 && args[0] == "--fixture") {
    Console.Write(CaptureRequest.Fixture(int.Parse(args[1])).Markdown);
    return;
}
if (args.Length == 3 && args[0] == "--publish-request") {
    try {
        using var json = JsonDocument.Parse(File.ReadAllText(args[1]));
        var request = json.RootElement;
        Console.Write(CaptureRequest.FromSharedForm(request.GetProperty("id").GetString()!, request.GetProperty("markdown").GetString()!).Publish(args[2]));
    } catch (Exception error) { Console.Error.WriteLine(error.Message); Environment.ExitCode = 1; }
    return;
}
var passed = 0;
void Test(string name, Action action) { action(); Console.WriteLine($"PASS {name}"); passed++; }
void Equal<T>(T actual, T expected) { if (!Equals(actual, expected)) throw new Exception($"Expected {expected}, got {actual}"); }
void Reject(Action action) { try { action(); } catch (Exception e) when (e is ArgumentException or IOException) { return; } throw new Exception("Expected rejection"); }
var root = Path.Combine(Path.GetTempPath(), "tracelo-tests-" + Guid.NewGuid());
Directory.CreateDirectory(Path.Combine(root, "工作记录", "任务"));
try {
    Test("smart capture accepts opaque credentials and validates HTTPS endpoints", () => {
        using var direct = JsonDocument.Parse("""{"baseUrl":"https://example.com/v1","model":"test","apiKey":"  test-direct-token-1234567890  ","keyFile":"/missing/legacy"}""");
        var config = SmartCaptureTransport.Configuration(direct.RootElement);
        Equal(config["apiKey"], "test-direct-token-1234567890");
        Equal(config["keyFile"], "");
        using var invalid = JsonDocument.Parse("""{"baseUrl":"https://example.com/v1","model":"test","apiKey":"invalid key","keyFile":"/missing/legacy"}""");
        Reject(() => SmartCaptureTransport.Configuration(invalid.RootElement));
        Equal(SmartCaptureTransport.ReadKey("opaque.Provider_token-1234567890"), "opaque.Provider_token-1234567890");
        Equal(SmartCaptureTransport.ReadKey("# Key\nAPI_KEY=opaque.Provider_token-1234567890"), "opaque.Provider_token-1234567890");
        Reject(() => SmartCaptureTransport.ReadKey("first-token-12345678\nsecond-token-12345678"));
        Equal(SmartCaptureTransport.Endpoint("https://example.com/v1/chat/completions/").AbsoluteUri, "https://example.com/v1/chat/completions");
        Reject(() => SmartCaptureTransport.Endpoint("http://example.com/v1"));
        Reject(() => SmartCaptureTransport.Endpoint("https://key@example.com/v1"));
    });
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
        catch (Exception error) when (error is UnauthorizedAccessException || error is IOException && (error.HResult & 0xffff) == 1314) {
            Console.WriteLine("SKIP symlink creation requires Windows Developer Mode or Create symbolic links permission"); return;
        }
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
    Test("capture bounds fit small and negative-origin monitor work areas", () => {
        Equal(WindowPlacement.Fit(-800, 20, 480, 260, 1160, 684), new WindowBounds(-800, 20, 480, 260));
        Equal(WindowPlacement.Fit(1920, 0, 1920, 1080, 580, 342), new WindowBounds(2590, 369, 580, 342));
    });
    Test("shared-form request rejects path injection and mismatching metadata", () => {
        var fixture = CaptureRequest.Fixture(0);
        Equal(CaptureRequest.FromSharedForm(fixture.Id, fixture.Markdown), fixture);
        Reject(() => CaptureRequest.FromSharedForm("../escape", fixture.Markdown));
        Reject(() => CaptureRequest.FromSharedForm("different-id", fixture.Markdown));
        Reject(() => CaptureRequest.FromSharedForm("valid-id", "ordinary markdown"));
    });
    Test("structured form draft and pending request survive restart without losing fields", () => {
        var path = Path.Combine(root, "structured-settings.json");
        var state = new CaptureSettings { Draft = "legacy title\nlegacy notes" };
        Equal(state.RestoredDraft().GetProperty("title").GetString(), "legacy title");
        state.FormDraft = JsonSerializer.SerializeToElement(new { title = "结构化标题", notes = "详情", groupId = "group-1", quadrant = "important_urgent", todos = new[] { "待办一" }, dueDate = "2026-10-01", initialProgress = "初始进展", expanded = new { todos = true, due = true, progress = true } });
        state.PendingRequest = CaptureRequest.Fixture(1);
        state.Save(path);
        var restored = CaptureSettings.Load(path);
        Equal(restored.RestoredDraft().GetProperty("dueDate").GetString(), "2026-10-01");
        Equal(restored.PendingRequest, state.PendingRequest);
    });
    Test("group archive reading returns raw strict archive without following links", () => {
        var directory = new CaptureConfiguration(root, "工作记录/任务").Destination();
        Equal(CaptureConfiguration.ReadGroupsArchive(directory), "");
        var source = "<!-- work-timeline-groups:v1\n{\"version\":1,\"groups\":[],\"events\":[]}\n-->\n\n";
        File.WriteAllText(Path.Combine(directory, "_groups.md"), source);
        Equal(CaptureConfiguration.ReadGroupsArchive(directory), source);
    });
    Test("equivalent draft JSON retains pending ID after settings reformat", () => {
        var state = new CaptureSettings { FormDraft = JsonDocument.Parse("{ \"title\": \"任务\", \"notes\": \"详情\" }").RootElement.Clone(), PendingRequest = CaptureRequest.Fixture(0) };
        state.SetDraft(JsonDocument.Parse("{\"notes\":\"详情\",\"title\":\"任务\"}").RootElement);
        Equal(state.PendingRequest?.Id, "desktop-fixture-0");
        state.SetDraft(JsonDocument.Parse("{\"title\":\"改名\",\"notes\":\"详情\"}").RootElement);
        Equal(state.PendingRequest, null);
    });
    Test("unreadable group path is an error rather than silently ungrouped", () => {
        var directory = Path.Combine(root, "invalid-groups"); Directory.CreateDirectory(Path.Combine(directory, "_groups.md"));
        Reject(() => CaptureConfiguration.ReadGroupsArchive(directory));
    });
    Test("group refresh invalidates stale request while preserving the complete draft", () => {
        var draft = JsonSerializer.SerializeToElement(new { title = "保留标题", groupId = "group-1", notes = "详情" });
        var state = new CaptureSettings { FormDraft = draft, GroupsSource = "old group archive", PendingRequest = CaptureRequest.Fixture(0) };
        Equal(state.UpdateGroupsSource("old group archive"), false);
        Equal(state.PendingRequest?.Id, "desktop-fixture-0");
        Equal(state.UpdateGroupsSource("renamed group archive"), true);
        Equal(state.PendingRequest, null);
        Equal(state.RestoredDraft().GetProperty("groupId").GetString(), "group-1");
        state.PendingRequest = CaptureRequest.Fixture(1);
        state.UpdateGroupsSource(null);
        Equal(state.PendingRequest, null);
    });
    Test("restart and return to a workspace restore only its own draft and pending request", () => {
        var path = Path.Combine(root, "retry-settings.json");
        var draft = JsonSerializer.SerializeToElement(new { title = "幂等重试", notes = "草稿" });
        var state = new CaptureSettings { Vault = root, TaskDirectory = "tasks", FormDraft = draft, GroupsSource = "groups", PendingRequest = CaptureRequest.Fixture(1) };
        state.Save(path);
        var restored = CaptureSettings.Load(path);
        restored.SetDraft(draft); restored.UpdateGroupsSource("groups");
        Equal(restored.PendingRequest, state.PendingRequest);
        var hotkeyOnly = new CaptureSettings { Vault = root, TaskDirectory = "tasks", HotkeyKey = 65 };
        Equal(hotkeyOnly.CopyDraftFrom(restored), false);
        Equal(hotkeyOnly.PendingRequest, state.PendingRequest);
        foreach (var changed in new[] { new CaptureSettings { Vault = root + "-other", TaskDirectory = "tasks" }, new CaptureSettings { Vault = root, TaskDirectory = "other-tasks" } }) {
            Equal(changed.CopyDraftFrom(restored), true);
            Equal(changed.PendingRequest, null);
            Equal(changed.RestoredDraft().GetProperty("title").GetString(), "");
            var returned = new CaptureSettings { Vault = root, TaskDirectory = "tasks" };
            returned.CopyDraftFrom(changed);
            Equal(returned.RestoredDraft().GetProperty("title").GetString(), "幂等重试");
            Equal(returned.PendingRequest, state.PendingRequest);
        }
    });
    Test("image publication is atomic and quick operations are durable and idempotent", () => {
        var directory = new CaptureConfiguration(root, "工作记录/任务").Destination();
        var request = CaptureRequest.Create("图片任务", "image-task");
        var images = JsonSerializer.SerializeToElement(new[] { new { name = "image-test.png", base64 = "AQID" } });
        var path = request.Publish(directory, images);
        Equal(request.Publish(directory, images), path);
        Equal(Convert.ToBase64String(File.ReadAllBytes(Path.Combine(Path.GetDirectoryName(path)!, "image-test.png"))), "AQID");
        var workspace = new QuickWorkspace(directory);
        var beforeEditable = workspace.Tasks().Length;
        var editable = "---\ntracelo: 2\nid: editable-task\n---\n\n# 可编辑任务\n";
        File.WriteAllText(Path.Combine(directory, "editable.md"), editable);
        Equal(workspace.Tasks().Length, beforeEditable + 1);
        var op = JsonSerializer.SerializeToElement(new { version = 1, id = "quick-" + new string('a',32), taskId = "image-task", kind = "progress", text = "离线进展" });
        workspace.Enqueue(op); workspace.Enqueue(op);
        Equal(workspace.Receipts().Length, 1);
        Equal(File.ReadAllText(path), request.Markdown);
        var changed = JsonSerializer.SerializeToElement(new { version = 1, id = "quick-" + new string('a',32), taskId = "image-task", kind = "progress", text = "不同内容" });
        Reject(() => workspace.Enqueue(changed));
    });
    Console.WriteLine($"{passed} tests passed");
} finally { Directory.Delete(root, true); }
