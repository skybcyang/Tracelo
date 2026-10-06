# 直接输入密钥与快捷界面统一

日期：2026-10-06。保留当前工作树其他未提交改动，版本标记仍为 0.9.3，未提交、推送或发布。

## 本轮修改

- 插件、macOS 与 Windows 共用的模型设置改为直接输入／粘贴 API Key，默认密码框，眼睛按钮切换显示／隐藏。保留连接测试及失败反馈；新 Key 保存后清除旧文件路径，旧配置留空时仍兼容使用。
- 凭证保存在本机配置，不进入任务、草稿或模型请求正文。不是系统钥匙串加密；具体存储和同步边界见[说明](../smart-capture.md)。
- 快捷工具的一句话使用完整窗口内容区及相同品牌顶栏，不再露出后方创建表单、重复底栏和遮罩。所有按钮使用共享样式；输入焦点为连续单圈。
- 窗口按内容调整高度，内容独立滚动、底部操作固定；模型设置同样支持短窗口。顶部关闭沿用草稿写盘成功后再退出的逻辑。
- 沿用 oil-ui 的存量局部优化流程，复用现有中性色、卡片主题变量和按钮，不引入新的视觉方向。用户的新决定已加入 AGENTS 和需求文档。

## 验证

先确认回归失败：旧配置标准化会丢弃直接 Key，原生配置不接受直接 Key，浏览器无 API Key 输入框。实现后相关回归通过。

- `npm run check`：126 项单元测试通过、无跳过；生产构建及可编辑同步、图标、布局、创建、快捷进展、展示、动效与一句话浏览器回归通过。使用本机临时 .NET SDK 执行跨平台兼容测试。
- 最后收紧设置滚动区域、顶部关闭及高度后，再运行 `npm run build`、`npm run test:smart`、`node tests/smart-desktop.browser.mjs`：全部通过。覆盖密码类型、显示／隐藏、直接 Key 不读取文件、配置持久保存、旧路径兼容、连接测试不发草稿、保存失败、稳定重试、迟到回调、目录隔离和短窗口。
- `swift run --package-path desktop CaptureCoreTests`：10 项通过，并补充原生直接 Key 的有效性及优先于旧路径检查。
- `dotnet run --project desktop/windows/CaptureCore.Tests -c Release`：18 项通过；Windows Release 构建 0 警告、0 错误。
- `bash desktop/package-macos.sh`：Universal 构建、签名校验、真实 WKWebView 原生冒烟通过。
- 截图检查：`test-results/smart-capture/desktop-{mac,windows}-{input,settings,dark-input,queued}.png`；覆盖内容自适应高度、390×450 短窄窗口、深浅色及底部按钮可达。实际 Obsidian 和已安装 macOS 应用通过系统 UI 工具检查了新输入框及界面。
- 初次同时启动两份 C# 构建发生输出文件竞争，改为串行后通过；这不是产品逻辑失败。`git diff --check` 通过。

## 本机交付

插件安装在项目实际 vault `/Users/skybcyang/SkybcWork/projects/WorkAssistant/.obsidian/plugins/work-timeline/`，同步 main.js、styles.css、manifest.json；通过真实 Obsidian 插件管理停用／启用完成重载，已看到 API Key 安全输入框和显示按钮。没有改写用户模型配置。

快捷应用更新在 `/Applications/Tracelo Capture.app`，已重启。实际打开新建、一句话、模型设置和记录进展入口，确认读取 WorkAssistant 的任务目录，顶部关闭可返回原新建草稿。应用完整 Contents 与打包产物一致，签名校验通过，后台进程持续运行。

安装前备份：`/Users/skybcyang/Library/Application Support/TraceloCapture/Backups/smart-ui-20261006-8RMrPT/`，包含旧插件与 data.json、任务目录、旧应用、桌面草稿和偏好设置。

安装后任务目录 18 个文件的逐文件 SHA-256 与备份完全一致；已有模型配置及草稿保留，仅模型配置标准化补上空 apiKey 字段。实机验收未输入替代凭证，未创建或修改正式任务。

| 产物 | SHA-256 |
| --- | --- |
| 插件 main.js | `9847006dded3981fbd4e065e9cc88fb37ae25027ee5ff27d69d821e6be7d1f37` |
| styles.css | `7660743f35d1a92779011caab3bb8de9ee1065d33f5b069a1de99ae31083995e` |
| macOS 二进制 | `b5027213378f0b69b4dd9e6f6621927a9009245c11c262280a8553861549382b` |
| macOS 共享表单 | `3548412bec369372633582e427857e10a91c5c38aa1287c54b27e4e058bf832a` |

本轮未重新调用付费模型、未运行 Windows GUI、未验收物理中文候选窗、麦克风和全局硬件快捷键；浏览器模拟与构建不代替这些实机证据。
