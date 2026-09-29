# 最新开发版一致性与分支整合 · 2026-09-29

## 范围与版本口径

发布基线为标签 `0.9.0`，实际提交 `f5618409e21e9d560951f3bec7732eccfc9355e4`；开工时本地 `main` 为 `f2765e2`。插件、npm、锁文件、Windows 应用与 macOS 源配置统一为 0.9.0。本次整合仍是未发布开发构建，没有创建新版本标签或 Release。

最新界面此前位于独立工作树 `0c57/WorkAssistant`，其内容比主目录新，且尚未提交。核对最近的开发记录后，确定整合范围包含四主题、双层导航、恢复横向铺卡／瀑布流、图文快捷进展、Noto 选择器适配，以及任务搜索选择器再次点击收起。主目录独有的拖拽目标留白与历史实机验收记录同时保留。

## 分支与合并策略

| 来源 | 处理 |
| --- | --- |
| 主目录未提交开发改动 | 验证后保存为 `b55baf7`；保留分支 `codex/development-baseline-2026-09-29` |
| `codex/create-ui` | 唯一提交 `f867634` 的等价补丁已在主线；合并祖先关系，不重复应用旧界面 |
| `codex/timeline-ui` | `286ae41`、`7e12436` 的等价补丁已在主线；合并祖先关系 |
| `codex/windows-capture` | 三项提交的等价补丁已在主线；合并祖先关系 |
| `codex/release-0.7.0`、`codex/capture-shared-ui` | 原本就是主线祖先，无需重复合并 |
| 最新界面工作树 | 保存为 `codex/latest-interface-integration` / `13bc4a0`，合入本地 `main` |

旧分支通过 `git cherry main <branch>` 确认全部为 `-` 后，使用保留主线内容的祖先合并。新版重叠文件以最新实现为准，逐项核对主目录独有差异；保留拖拽高亮的 12px 留白，清除自动合并带入的旧图标 CSS 与无用导入，恢复被旧文档覆盖的本仓安装验收记录。保留所有原工作树、分支和设计历史，未删除用户文件。

## 修正的一致性问题

1. 缩放测试沿用单列实验时期的“列数不变”断言。最新需求已恢复分组内横向铺卡，60% 下 5 → 9 列符合要求；恢复“缩小后列数增加”的断言，同时保留工具栏／时间线不缩放检查。
2. `desktop/Info.plist` 仍写 0.8.0，其他元数据为 0.9.0。新增跨平台版本测试，先观察 0.8.0／0.9.0 失败，再统一两个 plist 版本字段并复测。
3. 四主题差异报告引用了错误的 0.9.0 提交号，改为实际标签提交 `f561840`。
4. README、桌面用法与需求说明混用发布版和开发版的卡片摘要、全部待办、时间线方向、快捷编辑器及窗口宽度。已按当前实现更新，并保留历史证据的阶段归属。
5. 协议文档补充 Noto、主题投影、图文进展附件与新偏好，删除仍把 `presentationMode` 描述为现有功能的条目，Markdown 示例改为当前 `## 详情`。

## 验证

合并前新版分支：16 个文件、94 项单元／跨语言测试全部通过，无跳过；完整 `npm run check` 通过。Swift 核心 10 项、C# 核心 17 项通过；macOS Universal 打包、签名与原生 WebKit 冒烟通过；Windows 交叉构建通过，0 warning、0 error。

合并后在主目录执行的最终检查：

| 命令／检查 | 结果 |
| --- | --- |
| `DOTNET_PATH=/tmp/tracelo-dotnet/dotnet PLAYWRIGHT_CHANNEL=chrome npm run check` | 17 个测试文件、95 项单元／跨语言测试全部通过，无跳过；类型检查、生产构建、图标／布局／快捷工具全部浏览器套件通过 |
| `swift run --package-path desktop CaptureCoreTests` | 10 项通过 |
| `/tmp/tracelo-dotnet/dotnet run --project desktop/windows/CaptureCore.Tests -c Release` | 17 项通过 |
| `bash desktop/package-macos.sh` | arm64／x86_64 Universal、ad-hoc 签名、原生 WebKit 深浅色表单、原子提交及重试通过 |
| `/tmp/tracelo-dotnet/dotnet build desktop/windows/TraceloCapture/TraceloCapture.csproj -c Release -p:EnableWindowsTargeting=true` | 构建成功，0 warning、0 error |
| `npm audit --omit=optional --audit-level=moderate` | 0 已知漏洞；两工作区依赖锁文件一致 |
| 文档链接 | 13 份当前文档的 96 个相对链接存在；代码示例中的示意图片不算文档链接 |
| 打包资源一致性 | macOS 包内共享脚本、宿主脚本、样式与主目录源产物 SHA-256 一致 |
| `git diff --check`、`git diff --cached --check` | 通过 |

浏览器套件包括四主题×深浅色、导航与分组筛选、27 项布局、27 项瀑布流、87 项卡片交互、78 项内容检查、16 项图标层级、41 项可读性，以及日历、图文草稿、快捷任务切换、命令回执和搜索／输入法组合事件。浏览器模拟宿主不等同于完整实机验收。

真实仓库以只读适配器验证，回导仅在系统临时目录运行：12 个任务、8 份材料严格解析、导入／导出及重载一致；重复导入跳过全部 12 项；26 个源文件前后哈希不变。命令为 `node tests/verify-vault-roundtrip.mjs /Users/skybcyang/SkybcWork/projects/WorkAssistant`。

## 安装、远端与实机边界

本次只整合源码、文档及本地验证产物，未替换已安装应用或重载 Obsidian。逐文件哈希确认本仓已安装插件的 `main.js`／`styles.css` 和 `/Applications/Tracelo Capture.app` 的共享脚本／样式均与最新构建不同。旧安装记录描述的是当时的开发构建，不能当作当前源码安装成功的证明。

GitHub HTTPS 读取在本轮返回空响应或连接超时，`git fetch origin` 未成功，因此远端当前状态未核实；未推送。`origin/main` 的本地缓存仍指向 `f2765e2`。恢复连接后需先 fetch 核对差异，再同步，不能把本地合并称作远端合并。

Windows 仅验证 C# 核心与交叉构建；没有本轮 Windows WebView2 实机结果。完整中文输入法候选、原生剪贴板、多屏／DPI、系统快捷键冲突和跨应用焦点矩阵仍待补齐，`task.md` 对应综合验收不勾选。

历史记录：[四组任务](2026-09-29-all-tasks.md) · [新版 Noto](2026-09-29-noto-current-theme.md) · [任务切换](quick-picker/README.md) · [0.9.0 发布](2026-09-28-release-090.md)。
