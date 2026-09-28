using System.Text.Json;
using Tracelo;

namespace TraceloCapture;

// Tests the published WebView2 surface against an isolated vault and settings only.
internal static class SmokeTest {
    internal static int Run(string outputDirectory) {
        Directory.CreateDirectory(outputDirectory);
        var root = Path.Combine(outputDirectory, "smoke-" + Guid.NewGuid());
        var tasks = Path.Combine(root, "tasks"); Directory.CreateDirectory(tasks);
        var path = Path.Combine(root, "settings.json");
        var log = new List<string>(); var exitCode = 1;
        void Check(bool value, string description) { if (!value) throw new Exception(description); log.Add("PASS " + description); }
        var draft = JsonSerializer.SerializeToElement(new {
            title = "整理本周工作进展", notes = "补充目标与参考资料\n\n保留 Markdown。", groupId = "smoke-group",
            quadrant = "important_urgent", todos = new[] { "核对验收清单" }, dueDate = "2026-10-01", initialProgress = "已完成资料收集",
            expanded = new { todos = true, due = true, progress = true }
        });
        File.WriteAllText(Path.Combine(tasks, "_groups.md"), "<!-- work-timeline-groups:v1\n{\n  \"version\": 1,\n  \"groups\": [\n    {\n      \"id\": \"smoke-group\",\n      \"name\": \"产品\"\n    }\n  ],\n  \"events\": []\n}\n-->\n\n# 任务分组\n\n1. 产品\n\n## 变更记录\n\n暂无记录\n");
        new CaptureSettings { Vault = root, TaskDirectory = "tasks", HotkeyModifiers = 3, HotkeyKey = (uint)Keys.F11, FormDraft = draft }.Save(path);
        try {
            using var app = new CaptureApplication(path, smoke: true);
            app.Show();
            app.Window.BeginInvoke(async () => {
                try {
                    async Task WaitFor(Func<Task<bool>> condition, string description) {
                        var deadline = DateTime.UtcNow.AddSeconds(20);
                        while (!await condition()) {
                            if (app.Window.Surface.LoadError is string error) throw new Exception(error);
                            if (DateTime.UtcNow >= deadline) throw new TimeoutException(description);
                            await Task.Delay(50);
                        }
                    }
                    async Task<bool> Js(string code) => await app.Window.Surface.EvaluateAsync(code) == "true";
                    await WaitFor(() => Task.FromResult(app.Window.Surface.Ready), "shared form did not become ready");
                    await WaitFor(() => Js("window.capture.getDraft().title === '整理本周工作进展' && !document.querySelector('#submit').disabled"), "initial state was not restored");
                    Check(Screen.FromControl(app.Window).WorkingArea.Contains(app.Window.Bounds), "shared form fits monitor work area");
                    Check(await Js("window.capture.getDraft().groupId === 'smoke-group' && Array.from(document.querySelectorAll('option')).some(o=>o.textContent.includes('产品'))"), "group dropdown loads strict vault archive");
                    Check(await Js("window.capture.getDraft().todos[0] === '核对验收清单' && window.capture.getDraft().initialProgress === '已完成资料收集'"), "complete structured draft restored");
                    Check(await Js("getComputedStyle(document.querySelector('.wt-modal')).backgroundColor === 'rgb(246, 249, 253)' || document.body.classList.contains('theme-dark')"), "surface uses shared plugin stylesheet");
                    await app.Window.Surface.EvaluateAsync("Array.from(document.querySelectorAll('button')).find(button => button.textContent === '取消').click()");
                    await WaitFor(() => Task.FromResult(!app.Window.Visible), "cancel did not dismiss");
                    Check(CaptureSettings.Load(path).RestoredDraft().GetProperty("dueDate").GetString() == "2026-10-01", "cancel persists all form fields");
                    Native.SendMessage(app.Window.Handle, 0x312, (IntPtr)1, IntPtr.Zero);
                    Check(app.Window.Visible, "native hotkey reopens shared form");
                    using (var occupied = new Form()) {
                        _ = occupied.Handle;
                        Check(Native.RegisterHotKey(occupied.Handle, 97, 0x4003, (uint)Keys.F12), "reserve competing shortcut");
                        try {
                            var rejected = false;
                            try { app.ApplySettings(new CaptureSettings { Vault = root, TaskDirectory = "tasks", HotkeyModifiers = 3, HotkeyKey = (uint)Keys.F12 }); }
                            catch (IOException) { rejected = true; }
                            Check(rejected && app.State.HotkeyKey == (uint)Keys.F11, "shortcut conflict retains original settings");
                        } finally { Native.UnregisterHotKey(occupied.Handle, 97); }
                    }
                    await app.Window.Surface.EvaluateAsync("document.querySelector('#task-title').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})); document.querySelector('#task-title').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,isComposing:true}));");
                    Check(Directory.GetFiles(tasks, "*.md").Length == 1, "IME confirmation does not publish task");
                    await app.Window.Surface.EvaluateAsync("document.querySelector('input').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));");
                    await Task.Delay(180);
                    foreach (var dark in new[] { false, true }) {
                        app.Window.Surface.Update(new() { ["dark"] = dark });
                        await WaitFor(() => Js($"document.body.classList.contains('theme-dark') === {dark.ToString().ToLowerInvariant()}"), "theme not updated");
                        await Task.Delay(180);
                        await app.Window.Surface.SnapshotAsync(Path.Combine(outputDirectory, dark ? "capture-dark-smoke.png" : "capture-smoke.png"));
                    }
                    var groupPath = Path.Combine(tasks, "_groups.md");
                    File.WriteAllText(groupPath, File.ReadAllText(groupPath).Replace("产品", "产品新版"));
                    await app.Window.Surface.EvaluateAsync("document.querySelector('form').requestSubmit()");
                    await WaitFor(() => Js("document.querySelector('.wt-form-error').textContent.includes('分组档案已更新')"), "stale group archive was not rejected");
                    Check(Directory.GetFiles(tasks, "*.md").Length == 1, "group rename rejects stale request before writing");
                    Check(await Js("window.capture.getDraft().title === '整理本周工作进展' && window.capture.getDraft().groupId === 'smoke-group' && Array.from(document.querySelectorAll('option')).some(o=>o.textContent==='产品新版')"), "group refresh retains draft and updates dropdown");
                    await app.Window.Surface.EvaluateAsync("document.querySelector('form').requestSubmit()");
                    await WaitFor(() => Task.FromResult(!app.Window.Visible), "form did not publish");
                    var created = Directory.GetFiles(tasks, "*.md").Single(file => Path.GetFileName(file) != "_groups.md");
                    var markdown = File.ReadAllText(created);
                    var end = markdown.IndexOf("\n-->\n\n", StringComparison.Ordinal);
                    using var metadata = JsonDocument.Parse(markdown["<!-- work-timeline-task:v1\n".Length..end]);
                    var task = metadata.RootElement;
                    Check(task.GetProperty("groupId").GetString() == "smoke-group" && task.GetProperty("groupName").GetString() == "产品新版" && task.GetProperty("important").GetBoolean() && task.GetProperty("urgent").GetBoolean(), "shared form retry saves refreshed group and quadrant");
                    Check(task.GetProperty("dueDate").GetString() == "2026-10-01" && task.GetProperty("todos")[0].GetProperty("text").GetString() == "核对验收清单", "shared form saves due date and todos");
                    Check(task.GetProperty("events").EnumerateArray().Any(e => e.GetProperty("kind").GetString() == "progress"), "initial progress saved as its own event");
                    Check(CaptureSettings.Load(path).FormDraft == null, "successful creation clears persistent draft");
                    app.Show(); app.Window.Surface.Update(new() { ["draft"] = draft });
                    await WaitFor(() => Js("window.capture.getDraft().title === '整理本周工作进展'"), "draft did not reach browser");
                    app.State.TaskDirectory = "missing";
                    await app.Window.Surface.EvaluateAsync("document.querySelector('form').requestSubmit()");
                    await WaitFor(() => Js("document.querySelector('.wt-form-error').textContent.length > 0"), "save failure not reported");
                    Check(app.Window.Visible && app.State.RestoredDraft().GetProperty("title").GetString() == "整理本周工作进展", "save failure retains complete draft");
                    using var settings = new SettingsWindow(app.State, _ => { }); settings.Show();
                    foreach (var dark in new[] { false, true }) {
                        Theme.Refresh(settings, dark); settings.Refresh();
                        using var image = new Bitmap(settings.Width, settings.Height);
                        settings.DrawToBitmap(image, new Rectangle(Point.Empty, image.Size));
                        image.Save(Path.Combine(outputDirectory, dark ? "settings-dark-smoke.png" : "settings-smoke.png"));
                    }
                    settings.Close(); app.Dismiss();
                    await WaitFor(() => Task.FromResult(!app.Window.Visible), "native dismiss did not snapshot the final draft");
                    exitCode = 0;
                } catch (Exception error) {
                    log.Add(error.ToString());
                    log.AddRange(app.Window.Surface.Diagnostics);
                    try {
                        log.Add(await app.Window.Surface.EvaluateAsync("JSON.stringify({url:location.href,ready:document.readyState,body:document.body.innerText,shared:typeof TraceloCreateTask,capture:typeof window.capture,errors:window.captureErrors})"));
                        await app.Window.Surface.SnapshotAsync(Path.Combine(outputDirectory, "failed-smoke.png"));
                    } catch (Exception diagnosticError) { log.Add(diagnosticError.ToString()); }
                }
                finally { Application.ExitThread(); }
            });
            Application.Run(app);
        } catch (Exception error) { log.Add(error.ToString()); }
        finally {
            // WebView2 shuts down its isolated browser process asynchronously.
            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (Directory.Exists(root)) {
                try { Directory.Delete(root, true); }
                catch (IOException) when (DateTime.UtcNow < deadline) { Thread.Sleep(50); }
                catch (UnauthorizedAccessException) when (DateTime.UtcNow < deadline) { Thread.Sleep(50); }
                catch (Exception error) { log.Add("Test profile retained at " + root + ": " + error.Message); break; }
            }
            log.Add(exitCode == 0 ? "Windows shared-form native smoke test passed" : "Windows shared-form native smoke test failed");
            File.WriteAllLines(Path.Combine(outputDirectory, "smoke-result.txt"), log);
        }
        return exitCode;
    }
}
