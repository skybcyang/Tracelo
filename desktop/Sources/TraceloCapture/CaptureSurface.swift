import AppKit
import WebKit
import CaptureCore
import UniformTypeIdentifiers

// The native host owns shortcuts, preferences and disk access. This local-only
// WebKit surface renders the same form implementation and styles as the plugin.
final class CaptureSurface: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let view: WKWebView
    var action: ((String, [String: Any]) -> Void)?
    private var ready = false
    private var pending: [String: Any] = [:]
    private var smokeSubmission: (([String: Any]) -> Void)?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        view = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        configuration.userContentController.add(self, name: "capture")
        view.navigationDelegate = self
        view.uiDelegate = self
        view.setValue(false, forKey: "drawsBackground")
        view.autoresizingMask = [.width, .height]
        view.setAccessibilityLabel("Tracelo 新建任务")
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard frame.isMainFrame else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .webP, .gif, .bmp]
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false; panel.canChooseFiles = true
        panel.begin { result in completionHandler(result == .OK ? panel.urls : nil) }
    }

    func load() throws {
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        let bundled = Bundle.main.resourceURL!
        let resources = FileManager.default.fileExists(atPath: bundled.appendingPathComponent("capture.html").path)
            ? bundled : source.appendingPathComponent("Resources")
        let bundledStyles = resources.appendingPathComponent("styles.css")
        let styles = FileManager.default.fileExists(atPath: bundledStyles.path)
            ? bundledStyles : source.appendingPathComponent("../../../styles.css").standardizedFileURL
        var html = try String(contentsOf: resources.appendingPathComponent("capture.html"), encoding: .utf8)
        for (marker, file) in [("PLUGIN_STYLES", styles), ("CAPTURE_STYLES", resources.appendingPathComponent("capture.css")), ("CREATE_TASK_SCRIPT", resources.appendingPathComponent("create-task.js")), ("CAPTURE_SCRIPT", resources.appendingPathComponent("capture.js"))] {
            html = html.replacingOccurrences(of: "/*\(marker)*/", with: try String(contentsOf: file, encoding: .utf8))
        }
        view.loadHTMLString(html, baseURL: nil)
    }

    func update(_ values: [String: Any]) {
        pending.merge(values) { _, new in new }
        guard ready else { return }
        let state = pending
        pending.removeAll()
        view.callAsyncJavaScript("window.capture.update(state)", arguments: ["state": state], in: nil, in: .page) { _ in }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let value = message.body as? [String: Any], let name = value["action"] as? String else { return }
        if name == "ready" { ready = true; update([:]) }
        if name == "submit", let verify = smokeSubmission {
            smokeSubmission = nil
            verify(value)
            return
        }
        action?(name, value)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.navigationType == .other && navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
    }

    func smokeTest(screenshots: URL?, completion: @escaping (Bool) -> Void) {
        // This legacy palette regression intentionally verifies the evergreen tokens.
        update(["uiSettings": ["theme": "evergreen", "appearance": "system"]])
        update(["draft": ["title": "整理本周工作进展", "notes": "补充目标、要求或参考资料，支持 Markdown。", "groupId": "", "quadrant": "important_urgent", "todos": [], "dueDate": "", "initialProgress": "", "expanded": ["todos": false, "due": false, "progress": false]], "groupsSource": "", "configured": true, "saving": false, "error": "", "location": "示例仓库", "dark": false, "focus": true])
        view.callAsyncJavaScript("""
          const check = (ok, message) => { if (!ok) throw new Error(message); };
          const input = document.querySelector('input#task-title.wt-modal-title');
          const details = document.querySelector('textarea#task-details');
          const group = document.querySelector('select[aria-label="任务分组"]');
          const quadrant = document.querySelector('.wt-quadrant-picker');
          const button = document.querySelector('#submit');
          const footer = document.querySelector('.wt-new-task-footer');
          const body = document.querySelector('.wt-new-task-body');
          check(input && details && group && quadrant && button && footer, 'shared form controls are missing');
          const deadline = performance.now() + 2500;
          while ((button.getBoundingClientRect().bottom > innerHeight || body.scrollHeight > body.clientHeight + 1 || document.activeElement !== input || getComputedStyle(button).backgroundColor !== 'rgb(53, 109, 84)') && performance.now() < deadline) {
            await new Promise(resolve => requestAnimationFrame(resolve));
          }
          check(getComputedStyle(document.querySelector('.wt-modal')).backgroundColor === 'rgb(252, 253, 252)', 'light modal does not use plugin styles');
          check(getComputedStyle(button).backgroundColor === 'rgb(53, 109, 84)', 'primary action does not use plugin accent: '+getComputedStyle(button).backgroundColor);
          check(input.value === '整理本周工作进展' && details.value === '补充目标、要求或参考资料，支持 Markdown。', 'title and details must be independent fields');
          check(document.activeElement === input, 'title did not receive focus');
          const values = ['important_urgent', 'important_not_urgent', 'not_important_urgent', 'not_important_not_urgent'];
          const radios = [...quadrant.querySelectorAll('input[type="radio"]')];
          check(JSON.stringify(radios.map(option => option.value)) === JSON.stringify(values), 'all four quadrants must be available');
          for (const value of values) {
            radios.find(input => input.value === value).closest('label').click();
            check(window.capture.getDraft().quadrant === value, 'quadrant selection was not retained');
          }
          radios[0].closest('label').click();
          check(window.capture.getDraft().title === input.value && window.capture.getDraft().notes === details.value, 'changing quadrant altered independent title or details');
          check(group.options.length >= 1 && !group.disabled, 'task group control is unavailable');
          check(group.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 1 && quadrant.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 1, 'group and quadrant selectors are clipped before resize completes: ' + JSON.stringify({group:group.getBoundingClientRect().bottom,quadrant:quadrant.getBoundingClientRect().bottom,body:body.getBoundingClientRect().bottom,bodyScrollHeight:body.scrollHeight,bodyHeight:body.clientHeight,window:innerHeight}));
          check(footer.getBoundingClientRect().bottom <= innerHeight + 1 && button.getBoundingClientRect().bottom <= innerHeight + 1 && !button.disabled, 'form footer is clipped or disabled');
          return true;
          """, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self, case .success(let value) = result, (value as? Bool) == true else { fputs("Shared form light smoke failed: \(result)\n", stderr); completion(false); return }
            self.snapshot(screenshots?.appendingPathComponent("shared-form-light.png")) {
                self.update(["dark": true])
                self.view.callAsyncJavaScript("""
                  const deadline = performance.now() + 2000;
                  while ((getComputedStyle(document.querySelector('.wt-modal')).backgroundColor !== 'rgb(32, 45, 37)' || getComputedStyle(document.querySelector('#task-details')).backgroundColor !== 'rgb(41, 57, 46)') && performance.now() < deadline) {
                    await new Promise(resolve => requestAnimationFrame(resolve));
                  }
                  const style = { modal:getComputedStyle(document.querySelector('.wt-modal')).backgroundColor, details:getComputedStyle(document.querySelector('#task-details')).backgroundColor, title:getComputedStyle(document.querySelector('#task-title')).backgroundColor, footer:document.querySelector('.wt-new-task-footer').getBoundingClientRect().bottom, height:innerHeight };
                  if (style.modal !== 'rgb(32, 45, 37)' || style.details !== 'rgb(41, 57, 46)' || style.title !== 'rgba(0, 0, 0, 0)' || style.footer > style.height + 1) throw new Error(JSON.stringify(style));
                  return true;
                  """, arguments: [:], in: nil, in: .page) { result in
                    guard case .success(let value) = result, (value as? Bool) == true else { fputs("Shared form dark smoke failed: \(result)\n", stderr); completion(false); return }
                    self.snapshot(screenshots?.appendingPathComponent("shared-form-dark.png")) { self.verifySmokeSubmission(completion: completion) }
                }
            }
        }
    }

    private func verifySmokeSubmission(completion: @escaping (Bool) -> Void) {
        // Exercise the real form -> buildNewTask -> serialize -> WebKit message
        // path. Only this isolated temporary directory is ever written.
        smokeSubmission = { value in
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("tracelo-native-submit-\(UUID().uuidString)", isDirectory: true)
            do {
                guard let request = value["request"] as? [String: Any], let id = request["id"] as? String,
                    UUID(uuidString: id) != nil, let markdown = request["markdown"] as? String,
                    let draft = value["draft"] as? [String: Any], draft["title"] as? String == "原生提交验证",
                    draft["notes"] as? String == "独立详情\n保持第二行", draft["quadrant"] as? String == "important_urgent"
                else { throw CaptureError.invalid("WebKit 没有生成有效的共享表单请求") }
                let shared = try CaptureRequest(id: id, markdown: markdown)
                let prefix = "<!-- work-timeline-task:v1\n"
                let json = markdown.dropFirst(prefix.count).components(separatedBy: "\n-->\n\n")[0]
                guard let task = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
                    task["notes"] as? String == "独立详情\n保持第二行", task["dueDate"] as? String == "2026-10-01",
                    (task["todos"] as? [[String: Any]])?.count == 2,
                    (task["events"] as? [[String: Any]])?.map({ $0["kind"] as? String }) == ["created", "due_changed", "todo_added", "todo_added", "progress"]
                else { throw CaptureError.invalid("共享表单提交丢失字段或事件") }
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
                defer { try? FileManager.default.removeItem(at: directory) }
                let first = try shared.publish(to: directory)
                let retry = try shared.publish(to: directory)
                guard first == retry, try Data(contentsOf: first) == Data(markdown.utf8),
                    try FileManager.default.contentsOfDirectory(atPath: directory.path).count == 1
                else { throw CaptureError.invalid("原生提交字节不一致或重复创建") }
                print("macOS native submit: generated UUID, full shared archive, byte-identical atomic publish and retry passed")
                completion(true)
            } catch { fputs("Shared form native submit failed: \(error)\n", stderr); completion(false) }
        }
        view.callAsyncJavaScript("""
          window.capture.update({ configured: true, saving: false, error: '', draft: {
            title: '原生提交验证', notes: '独立详情\\n保持第二行', groupId: '', quadrant: 'important_urgent',
            todos: ['第一项', '第二项'], dueDate: '2026-10-01', initialProgress: '已开始推进',
            expanded: { todos: true, due: true, progress: true }
          }});
          document.querySelector('form').requestSubmit();
          """, arguments: [:], in: nil, in: .page) { [weak self] result in
            if case .failure(let error) = result, self?.smokeSubmission != nil {
                self?.smokeSubmission = nil
                fputs("Shared form submit JavaScript failed: \(error)\n", stderr)
                completion(false)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, self.smokeSubmission != nil else { return }
            self.smokeSubmission = nil
            self.view.callAsyncJavaScript("return document.querySelector('.wt-form-error')?.textContent", arguments: [:], in: nil, in: .page) { result in
                fputs("Shared form did not submit: \(result)\n", stderr)
                completion(false)
            }
        }
    }

    func smartSmokeTest(screenshots: URL?, completion: @escaping (Bool) -> Void) {
        view.callAsyncJavaScript("""
          const wait = async (predicate, label, ms=80000) => { const deadline=Date.now()+ms; while(!predicate()) {if(Date.now()>deadline) throw Error(label+': '+[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent).join(';')); await new Promise(r=>setTimeout(r,50));} };
          const button = (root,text) => [...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
          const fill=(input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
          button(document,'一句话整理').click();
          await wait(()=>document.querySelector('.wt-smart-input'),'open');
          let modal=document.querySelector('.wt-smart-modal');
          fill(modal.querySelector('.wt-smart-input'),'创建一个任务叫原生一句话验收，待办只有抓日志。没有其他进展。');
          button(modal,'整理成任务').click();
          await wait(()=>modal.querySelector('#task-title'),'extract-create');
          fill(modal.querySelector('#task-title'),'原生一句话验收');
          button(modal,'创建任务').click();
          await wait(()=>!document.querySelector('.wt-smart-modal'),'save-create');
          button(document,'记录进展').click();
          await wait(()=>document.querySelector('.wt-card-composer textarea'),'task-loaded');
          if(button(document,'一句话记录进展')) throw Error('removed AI progress entry remains');
          const progress=document.querySelector('.wt-card-composer textarea');
          fill(progress,'日志已经抓完，发现初始化耗时偏高。');
          document.querySelector('.wt-card-composer').requestSubmit();
          await wait(()=>document.querySelector('.wt-quick-status').textContent.includes('已暂存'),'queued-direct-progress');
          if(progress.value!=='日志已经抓完，发现初始化耗时偏高。') throw Error('queued progress draft lost');
          if(document.querySelector('.wt-quick-progress .wt-composer-footer').getBoundingClientRect().bottom>innerHeight) throw Error('footer clipped');
          return true;
          """, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self, case .success(let value) = result, (value as? Bool) == true else {
                fputs("Native smart UI failed: \(result)\n", stderr)
                self?.snapshot(screenshots?.appendingPathComponent("smart-failure.png")) { completion(false) }; return
            }
            self.snapshot(screenshots?.appendingPathComponent("smart-light.png")) {
                self.update(["uiSettings": ["theme": "monochrome", "appearance": "dark"]])
                self.snapshot(screenshots?.appendingPathComponent("smart-dark.png")) { completion(true) }
            }
        }
    }

    private func snapshot(_ path: URL?, completion: @escaping () -> Void) {
        guard let path else { completion(); return }
        let configuration = WKSnapshotConfiguration()
        configuration.afterScreenUpdates = true
        view.takeSnapshot(with: configuration) { image, error in
            guard let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else {
                fputs("Capture screenshot failed: \(String(describing: error))\n", stderr); exit(1)
            }
            do { try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true); try png.write(to: path) }
            catch { fputs("\(error)\n", stderr); exit(1) }
            completion()
        }
    }
}
