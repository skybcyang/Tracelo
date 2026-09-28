# Tracelo 快捷创建 · Windows

Windows 10 / 11 x64 原生托盘工具，使用 .NET WinForms。Release 提供自带运行时的 `TraceloCapture.exe`，无需安装 .NET，也不需要 Obsidian 正在运行。任务仍需由已配置相同目录的 Tracelo 插件读取。

## 使用

1. 解压发布包，运行 `TraceloCapture.exe`。首次打开会提示设置保存位置。
2. 点“设置”，选择 Obsidian vault，再填写插件实际使用的任务相对目录，例如 `工作记录/任务`。目录必须已经存在，不能使用符号链接或目录联接。
3. 默认全局快捷键为 **Ctrl + Alt + Space**。设置中的快捷键输入框可录入含 Ctrl 或 Alt 的组合；冲突时会保留原快捷键和设置。
4. 第一行填写标题，后续行原样保存为详情。**Enter** 或“创建任务”保存；**Shift + Enter** 换行；**Esc** 和关闭窗口保留草稿。中文输入法选词期间 Enter / Esc 交给输入法。
5. 托盘双击可打开输入框；右键菜单提供创建、设置与退出。窗口默认出现在鼠标所在屏幕，关闭后尝试恢复此前应用焦点。

新任务为未分组、不重要、不紧急，仅生成一次 `created` 事件，详情不会转成进展。文件先完整写入临时文件并刷新，再以不覆盖方式发布；同名不同内容会报错并保留输入。保存失败、快捷键冲突及未配置位置都有明确的文字反馈。

窗口遵循 Windows 应用浅色／深色偏好与高对比度系统颜色，支持每显示器 DPI 缩放，并将捕获窗口限制在当前屏幕的可用区域内。

设置与草稿保存在 `%LOCALAPPDATA%\Tracelo\Capture\settings.json`。关闭窗口不退出托盘进程；从托盘退出也保留草稿。应用不自动修改开机启动，也不访问网络。发行包若未签名，Windows 可能显示来源确认提示。

## 构建与检查

开发需要 .NET 8 SDK。发布包不需要 SDK。核心测试在 macOS、Linux 和 Windows 上均可运行，不依赖额外测试包：

```sh
dotnet run --project desktop/windows/CaptureCore.Tests -c Release
dotnet publish desktop/windows/TraceloCapture/TraceloCapture.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o dist/windows
```

从仓库根目录运行跨语言严格协议测试（先 `npm ci`；`dotnet` 在 PATH，或设置 `DOTNET_PATH` 为绝对路径）：

```sh
npx vitest run desktop/windows/archive-compat.test.ts
```

该测试使用与 Swift 相同的 3 组固定输入、ID、时间与时区，验证 C# 输出通过 `src/archive.ts` 的严格解析，并与 TypeScript 序列化结果逐字节一致。没有 SDK 时该项显示跳过，不能视为通过；CI 应安装 .NET SDK。

Windows PowerShell 一次执行核心测试、发布和原生 smoke test：

```powershell
./desktop/windows/scripts/verify.ps1 -OutputDirectory ./dist/windows-verification -Version 0.7.0
```

单独测试已发布可执行文件：

```powershell
$result = Start-Process ./dist/windows/TraceloCapture.exe -ArgumentList '--smoke-test', 'C:\tracelo-smoke' -Wait -PassThru
if ($result.ExitCode -ne 0) { throw 'Native smoke test failed' }
Get-Content C:\tracelo-smoke\smoke-result.txt
```

Smoke test 只使用指定输出目录下新建的临时 vault 和偏好文件，完成后清理测试数据。它检查真实 WinForms 窗口与焦点、屏幕边界、热键消息处理、实际热键注册冲突、模拟 IME 消息的提交保护、Esc/重启草稿恢复、成功创建及失败保留，并生成 `capture-smoke.png`、`settings-smoke.png` 及对应的 `*-dark-smoke.png` 浅／深色界面截图。它不替代真实中文输入法选词、多屏及其他应用焦点恢复的人工作业验收。

## 验证边界

macOS 上可以运行核心测试、严格协议测试和 Windows 交叉编译；不能在 macOS 上运行 `.exe`。Windows runner 应执行上述 smoke test，保留日志和截图作为发布证据。真实输入法候选、多屏切换、第三方应用焦点及不同 Windows 缩放比例仍需实机检查，不把模拟事件测试描述为实机验收。
