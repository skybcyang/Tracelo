# Tracelo 快捷创建 · Windows

发布基线为 0.9.0；当前本地 `main` 已整合四主题、图文进展、Noto 任务图标及任务选择器切换，尚未发布新版本。下面编号步骤描述发布版创建入口，开发版增量见后文及[一致性记录](../../docs/validation/2026-09-29-consistency-integration.md)。

Windows 10 / 11 x64 原生托盘工具，使用 .NET WinForms 宿主和 WebView2 共享表单。发布构建自带 .NET 运行时，不需要 Obsidian 正在运行；还需要 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。缺失时窗口提供安装入口，不会自动下载或修改系统。任务需由已配置相同目录的 Tracelo 插件读取。

## 使用

1. 解压发布包，运行 `TraceloCapture.exe`。首次打开会提示设置保存位置。
2. 点“设置”，选择 Obsidian vault，再填写插件实际使用的任务相对目录，例如 `工作记录/任务`。目录必须已经存在，不能使用符号链接或目录联接。
3. 默认全局快捷键为 **Ctrl + Alt + Space**。设置中的快捷键输入框可录入含 Ctrl 或 Alt 的组合；冲突时会保留原快捷键和设置。
4. 使用与插件一致的完整新建表单：任务名称、详情、分组、四象限，以及可展开的待办、截止日期、初始进展。**Ctrl + Enter** 或“创建任务”保存；文本区 Enter 换行；**Esc** 和关闭窗口保留全部字段。中文输入法选词期间 Enter / Esc 交给输入法。
5. 托盘双击可打开输入框；右键菜单提供创建、设置与退出。窗口默认出现在鼠标所在屏幕，关闭后尝试恢复此前应用焦点。

分组从任务目录的 `_groups.md` 读取；缺少该文件时可用“未分组”，读取或严格解析失败会提示错误。默认象限为不重要、不紧急。共享 TypeScript 模块使用插件相同的任务域模型和存档序列化生成请求；详情不会转成进展，填写初始进展才生成对应事件。Windows 宿主验证任务 ID 和元数据对应关系，将完整文件刷新后以不覆盖方式发布；同名不同内容会报错并保留所有输入。

提交前会重新读取分组档案。若分组被改名或删除，本次创建会停止、保留完整草稿并刷新选项，确认后可重新创建。草稿与待重试请求按 vault／任务目录隔离，切换后只恢复对应目标的记录；只改快捷键不会清除可安全重试的请求。

开发版快捷进展入口默认 **Ctrl+Alt+P**，可在设置中单独修改，托盘亦提供“记录进展”。先搜索选择已有任务，再使用共享快捷编辑区；点击当前任务展开搜索，再点一次收起。图文进展草稿按任务和仓库持久保存。插件关闭时命令状态为“已暂存”，插件确认写入后才清空对应草稿并收起。新建详情和进展支持多选、粘贴和拖入图片，每张 10 MB、草稿合计 40 MB，支持 PNG/JPEG/WebP/GIF/BMP；创建时整体发布 Markdown 和附件。主题从同仓库 `.tracelo-ui.json` 读取。新增能力需要同时升级插件和 Windows 工具，详见[未发布更新](../../docs/releases/unreleased-2026-09-29.md)。

浮窗直接嵌入 macOS 共享页面、脚本及根目录 `styles.css`，没有独立的 Windows 表单样式副本。窗口遵循 Windows 应用浅色／深色偏好，原生设置遵循高对比度颜色，支持每显示器 DPI 缩放，并将浮窗限制在屏幕可用区域内。

设置、结构化草稿和待写入请求保存在 `%LOCALAPPDATA%\Tracelo\Capture\settings.json`；旧版本的一段式草稿会迁移为名称和详情。写入前保存请求 ID 与原始字节，失败或重启后的重试保持幂等。关闭窗口不退出托盘进程；从托盘退出也保留草稿。WebView2 配置缓存位于同目录 `WebView2` 子目录；表单页面不允许外部网络请求、导航、下载或浏览器权限。应用不自动修改开机启动。发行包若未签名，Windows 可能显示来源确认提示。

## 构建与检查

开发需要 .NET 8 SDK、Node.js 和 `npm ci` 安装的项目依赖。先生成共享 `create-task.js`，然后发布；五份共享资源直接嵌入可执行文件，不依赖源码目录。核心测试在 macOS、Linux 和 Windows 上均可运行，不依赖额外测试包：

```sh
npm ci
node desktop/build-form.mjs
dotnet run --project desktop/windows/CaptureCore.Tests -c Release
dotnet publish desktop/windows/TraceloCapture/TraceloCapture.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o dist/windows
```

Windows 项目在每次构建前自动调用同一 `desktop/build-form.mjs`，避免表单 bundle 与源码不同步；单独运行上述命令可提前检查前端依赖。

从仓库根目录运行跨语言严格协议测试（先 `npm ci`；`dotnet` 在 PATH，或设置 `DOTNET_PATH` 为绝对路径）：

```sh
npx vitest run desktop/windows/archive-compat.test.ts
```

该测试保留与 Swift 相同的 3 组旧协议固定样例，还将包含分组、象限、详情、待办、截止日期和初始进展的共享表单请求实际交给 C# 发布，验证输出通过 `src/archive.ts` 严格解析、逐字节一致、重试幂等且不覆盖冲突文件。没有 SDK 时显示跳过，不能视为通过；CI 应安装 .NET SDK。

Windows PowerShell 一次执行核心测试、发布和原生 smoke test：

```powershell
./desktop/windows/scripts/verify.ps1 -OutputDirectory ./dist/windows-verification -Version 0.9.0
```

单独测试已发布可执行文件：

```powershell
$result = Start-Process ./dist/windows/TraceloCapture.exe -ArgumentList '--smoke-test', 'C:\tracelo-smoke' -Wait -PassThru
if ($result.ExitCode -ne 0) { throw 'Native smoke test failed' }
Get-Content C:\tracelo-smoke\smoke-result.txt
```

Smoke test 在指定输出目录创建隔离 vault、WebView2 配置和偏好，完成后清理；若 WebView2 子进程尚未释放文件，会明确记录保留的测试目录。测试实际加载共享页面，检查完整草稿、分组读取、热键冲突、模拟输入法事件、取消保留、含待办／日期／初始进展的任务发布及失败保留，并生成 `capture-smoke.png`、`settings-smoke.png` 及对应的 `*-dark-smoke.png`。它不替代真实中文输入法选词、多屏及其他应用焦点恢复的人工验收。

## 验证边界

macOS 上可以运行核心测试、严格协议测试和 Windows 交叉编译；不能在 macOS 上运行 `.exe`。Windows runner 应执行上述 smoke test，保留日志和截图作为发布证据。真实输入法候选、多屏切换、第三方应用焦点及不同 Windows 缩放比例仍需实机检查，不把模拟事件测试描述为实机验收。
