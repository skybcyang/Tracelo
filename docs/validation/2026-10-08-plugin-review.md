# 2026-10-08 插件审查

本轮仅审查、复现和记录，没有修改产品源码、正式任务或安装文件，没有调用真实模型或执行发布。结论：下一轮应优先处理数据保护、文件同步和对话恢复缺陷；日历与原生验收继续收尾。此优先级是审查建议，尚未成为用户确认的开发任务。

## 实际版本与范围

- 主目录仍为本地 `main` 的 `2549d4a`，manifest 为 0.9.3，且保留大量已有未提交修改；根 README、task.md 和此前 PROJECT_STATE 尚未反映后续工作。
- 本仓已安装插件为 **0.9.5**。对应源码在 `/Users/skybcyang/.codex/worktrees/release-0-9-5/WorkAssistant`，审查时 HEAD 与本地 origin/main 均为 `8b480e135a7bb7b27fda653293582ec6f205b850`，工作树干净。
- 该工作树的 main.js、styles.css、manifest.json 与本仓 `.obsidian/plugins/work-timeline/` 三件套 SHA-256 逐项一致。重新构建后再次核对仍一致；这证明产物对应关系，不证明正在运行的 Obsidian 已重新加载。
- `/Applications/Tracelo Capture.app` 的版本元数据为 0.9.5。本轮没有重新运行快捷键、v2 任务发现或原生 GUI 验收。
- 最新功能包含工作对话、统一的新建／一句话整理、可编辑存档和 UI 精简。0.9.5 发布及同版本更新有最新工作树内的工程记录，本轮未复核远端 Release。

安装核对证据：[installation.json](../../test-results/review-2026-10-08/installation.json)，核对时间为 2026-10-08T00:57:26+08:00。

## 本轮确认的缺陷

### 1. 优先处理：损坏分组文件被空档案覆盖

隔离夹具中让 `_groups.md` 无法解析，并设置当日备份尚未执行，然后重新加载插件。插件提示“分组文件格式无效”，却将原文件及当日分组备份写成空分组／空历史。

原因是 `loadArchive()` 捕获分组读取错误后只通知，保留默认的空 `groupArchive`；`onload()` 随后不区分读取失败，仍执行 `saveGroups()`。任务文件本身未在此复现中丢失，但分组定义、排序和分组历史的原文被覆盖；旧备份可能还能恢复，不能以此代替源文件保护。

源码：[分组读取](</Users/skybcyang/.codex/worktrees/release-0-9-5/WorkAssistant/src/main.ts:1942>)、[启动备份](</Users/skybcyang/.codex/worktrees/release-0-9-5/WorkAssistant/src/main.ts:1875>)。建议将分组读失败与有效空分组区分，暂停相关写入，保留原文并提供显式恢复路径。

### 2. 文件移出任务目录后残留卡片

将已知任务 Markdown 从任务目录移动到仓库其他目录，发出 rename 事件并等待刷新。原文件已经不存在，但卡片仍在看板；继续保存进展时报“任务文件已有变化”，无法正常操作。删除文件及目录内改名的既有回归不能覆盖这个情况。

原因是 watcher 只根据新路径判断是否属于任务目录，移出时直接返回，没有处理原路径已登记的任务。源码：[watchArchive](</Users/skybcyang/.codex/worktrees/release-0-9-5/WorkAssistant/src/main.ts:2448>)。建议按原路径与新路径共同判断移入、移出、改名，处理卡片及路径映射，不恢复用户已移走的文件。

### 3. 删除引用任务后旧对话无法继续

先在工作对话引用一张卡片并完成一轮讨论；随后删除该任务文件，等待卡片移除，再点击“移除引用”。当前引用已为零，继续发送无关讨论仍报“引用任务已移除，请移除引用或新建对话”，消息无法发送。新会话可绕开，但“移除引用”的提示不能解决旧会话的问题。

原因是每次发送都合并全部历史消息的引用 ID，当前标签移除不会移除历史引用；宿主对任一已不存在的 ID 直接拒绝整次请求。源码：[合并引用](</Users/skybcyang/.codex/worktrees/release-0-9-5/WorkAssistant/src/conversation-panel.ts:154>)、[引用检查](</Users/skybcyang/.codex/worktrees/release-0-9-5/WorkAssistant/src/main.ts:1764>)。建议保留历史记录，同时将失效对象排除于可操作上下文，并明确说明对象已移除；不要让历史引用阻断无关讨论。

以上三项均在与已安装产物对应的 0.9.5 源码上复现。复现脚本的断言检查“缺陷仍存在”，所以脚本退出 0 **不表示上述产品行为通过验收**。脚本及输出：[edge-repro.mjs](../../test-results/review-2026-10-08/edge-repro.mjs)、[edge-repro-095.log](../../test-results/review-2026-10-08/edge-repro-095.log)。

## 已有待办与建议顺序

1. 先修复上面三项，补充对应的异常路径回归。
2. 处理短窗口截止日历最后一行的视觉裁切。这是最新版本已记载的边界，本轮没有重新采集日历截图，也不把视觉裁切扩大为操作不可达。
3. 补真实中文候选窗、跨应用焦点、多屏／全屏、剪贴板／拖入、Windows GUI 和系统听写验收；自动浏览器事件不能替代这些检查。快捷键基础唤起已有 2026-10-07 更新验收，不能继续引用更早的连接超时作为当前失败。
4. 明确后续开发入口并同步主目录状态。最新源码已在本地 origin/main；主目录还有旧开发改动，不能直接用 reset／覆盖同步，更不能将这里的 0.9.3 构建误装为最新插件。

完整现有待办查最新工作树的 [task.md](</Users/skybcyang/.codex/worktrees/release-0-9-5/WorkAssistant/task.md>)；日历问题查 [UI 验收](</Users/skybcyang/.codex/worktrees/release-0-9-5/WorkAssistant/docs/validation/2026-10-07-approved-ui.md>)；较新的安装／发布边界查 [0.9.5 同版本更新验收](</Users/skybcyang/.codex/worktrees/release-0-9-5/WorkAssistant/docs/validation/2026-10-07-release-095-refresh.md>)。本轮没有新增正式需求；提醒、批量操作、状态操作和长历史检索属于另行讨论的增强。

## 本轮验证

- 在上述 0.9.5 工作树执行完整 `npm run check`，退出 0：**132 项单元测试通过，2 项 .NET 跨语言测试跳过**；类型检查／生产构建、可编辑文件同步、图标、全套布局、创建／快捷进展、展示模式、一句话及工作对话浏览器回归通过。开始时间为北京时间 2026-10-08 00:54:45，完成结果在本轮 00:58 后确认。完整输出见 [check-095.log](../../test-results/review-2026-10-08/check-095.log)。
- .NET 检测不可用导致跳过，本轮没有 Windows 实机。单元套件中包含 Swift／TypeScript 兼容检查，不等同于已安装 macOS GUI 验收。
- 两个目录的 `git diff --check` 退出 0。旧主目录的完整检查也通过，但其输出不能用于替代 0.9.5 验证。
- 三项额外异常路径复现确认失败行为。没有修改正式任务；浏览器夹具使用内存存档，模型回复为模拟数据。
- 未重新进行 Obsidian GUI、桌面 GUI、真实模型、麦克风、安装或发布验证。现有常规测试全部通过与额外发现缺陷可以同时成立。
