# 一句话录入：五项改进验证

日期：2026-10-06。范围：当前 worktree 的开发源码，保留原有可编辑 Markdown、主题与布局改动。未提交、安装至日常应用或发布；版本标记仍为 0.9.3。

## 实现范围

| 项目 | 当前行为 |
| --- | --- |
| 模型配置 | 插件和独立工具支持选择密钥文件、固定句子连接测试、配置状态和失败反馈；测试不发送用户草稿。 |
| 编辑保护 | 改原文保留人工修改；重新整理前确认；成功后可恢复上一版；明确放弃需确认；关闭前等待写盘，失败保持编辑器打开。 |
| 使用验证 | 增补图片、窄／短窗口、持久化失败、重复提交、离线回执和真实 macOS 宿主验证；物理设备限制见下文。 |
| 原生接入 | 菜单栏／托盘提供一句话创建及选定任务进展；原生读密钥和发请求；已有任务通过持久队列交给插件，成功回执才清草稿。 |
| 兼容与语义 | 支持非 sk 前缀单行令牌、API_KEY 标注和完整 chat/completions 地址；增补跨月、跨年、闰日、模糊日期、未知分组、否定与多任务例句。 |

共享表单复用现有任务领域逻辑。独立工具创建使用原生发布器支持的 v1 传输格式，由新版插件按既有策略迁移为可编辑存档；不改动存档迁移实现。进展将文字和待办完成作为一个 `smart_progress` 操作提交，签名随任务存档持久化，重放不重复追加历史。

## 已获得的证据

- TypeScript：126 项单元测试通过，包含 Swift／C# 跨语言存档兼容测试；生产构建通过。
- 一句话专项：21 项单元测试；Obsidian 浏览器交互；macOS／Windows 两种宿主桥接的共享表单测试。覆盖文件选择、连接测试不泄漏草稿、编辑恢复、替换确认、取消迟到响应、写盘失败、图片附件、稳定创建 ID／字节重试、暂存状态、重新打开及成功回执。
- Swift 核心程序通过（现有摘要显示 10 项，并增加凭证与 HTTPS 断言）；macOS 应用构建通过。
- Windows WinForms Release 构建通过，0 警告／0 错误；C# 核心 18 项通过。使用临时 .NET SDK，没有改变系统安装。
- 真实 Kimi Code：10 组虚构语义例句通过，覆盖日期边界、模糊事实、未知分组、多任务、进展与否定。只读取本地凭证，不输出密钥。
- 真实 macOS WKWebView：经 Swift 读取本地密钥并调用模型，确认新任务实际写到临时磁盘；离线进展持久排队，关闭再开恢复等待状态。隔离目录：`/var/folders/7z/5dcj6kmx005b6sm35w8tnnl80000gn/T/tracelo-smart-native-48476`。
- 真实 macOS Obsidian：独立配置目录和临时 vault，验证密钥文件选择、连接测试、真实模型创建／进展、待办更新，以及处理离线 smart_progress 后生成回执和重放幂等。最新临时 vault：`/var/folders/7z/5dcj6kmx005b6sm35w8tnnl80000gn/T/tracelo-smart-qa-skftjp/vault`。

最终全量 `npm run check` 退出码为 0：126 项单元测试、生产构建、可编辑存档同步、图标、全部布局／快捷创建／进展／展示模式／动效以及两组一句话浏览器回归通过，没有跳过 .NET 兼容测试。展示边界 12 项、动效 9 项、稳定瀑布流刷新 14 项通过。`git diff --check` 通过。

## 本轮发现并修正

- 本地 WebKit 页面缺少 `crypto.randomUUID`，改用 `crypto.getRandomValues` 生成请求 ID。
- 独立页面没有 Obsidian 的 `.empty()` 扩展，共享弹窗改用标准 `replaceChildren()`。
- 原生发布器拒绝新版默认 Markdown 格式；桥接改为现有桌面发布协议，并加入断言。
- 草稿落盘失败时关闭丢失编辑入口；关闭现会等待成功，失败保留窗口。放弃失败同样保留内容并提示重试。
- 图文草稿大小上限与现有 40 MB 图片总限额不匹配；原生持久层留出 base64、上一版结果和重试记录空间，成功保存或主动放弃后清理创建重试记录。
- 原生主题冒烟原来固定假设矿物绿，现显式选择主题并等待颜色过渡完成。
- 全量回归暴露卡片的延迟初始聚焦竞态：用户已选择待办输入框时，下一帧仍强行切换到进展输入框。新增确定性失败用例，修正为保留用户最新焦点；12 项展示边界测试通过。

## 证据文件与复跑

本地 `test-results/smart-capture/` 保存创建、进展、深色和桌面待回执截图；`native-smart/smart-light.png`、`smart-dark.png` 来自真实 WKWebView。测试产物由 Git 忽略。

```sh
npm run check
npm run test:smart
swift run --package-path desktop CaptureCoreTests
dotnet run --project desktop/windows/CaptureCore.Tests -c Release
dotnet build desktop/windows/TraceloCapture -c Release
# 以下显式调用真实模型，只发送测试脚本内的虚构例句
npm run test:smart:live -- /absolute/path/to/key-file
node tests/smart-capture.native.mjs /absolute/path/to/key-file
node desktop/build-form.mjs
swift run --package-path desktop TraceloCapture --smart-smoke-test --key-file /absolute/path/to/key-file --screenshots test-results/smart-capture/native-smart
```

跨语言 Vitest 可用 `DOTNET_PATH` 指定临时 SDK；缺失 SDK 时对应测试会跳过。真实网络测试不纳入日常回归。

## 未覆盖的实机边界

- 没有 Windows 桌面设备：已编译的 WinForms、C# 核心测试及模拟桥接，不等同于 WebView2／系统文件对话框实机验收。
- 没有验证真实中文输入法候选窗、系统听写麦克风、跨应用焦点恢复及多显示器硬件。模拟 composition／键盘事件和显示器边界算法只能验证代码路径。
- 图片自动化覆盖上传、引用、确认保存与重试；未进行完整 40 MB 极限负载的真机性能测试。
- Kimi 通过不代表所有兼容模型或任意自然语言都准确；正式写入仍需人工确认。
- 菜单栏／托盘的一句话进展需与本轮新版插件配套，旧发布版尚不支持该命令。

第三项“补齐实机验证”已扩充当前机器能完成的覆盖，但上述硬件项目继续保留未验收，不以构建或模拟结果代替。
