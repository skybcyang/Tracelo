# Tracelo 桌面快捷创建

0.9.0 的插件、macOS 和 Windows 快捷窗口共用 `src/new-task-form.ts`：任务名称、详情、分组、重要／紧急四象限、待办、截止日期、初始进展及草稿采用同一表单和任务生成逻辑。名称与详情独立填写，象限使用四项直接可见的 2×2 选择区。macOS 使用系统 WebKit，Windows 使用 WebView2。截图与验证见[完整快捷创建](../docs/validation/2026-09-28-capture-shared-ui.md)。

0.9.0 提供 macOS Universal `.app` 压缩包和 Windows x64 自包含 `.exe` 压缩包，均与同版 Obsidian 插件配套使用。macOS 仅作本地 ad-hoc 签名，尚无开发者签名／公证；Windows 尚无代码签名。系统可能提示发布者未经验证。实际输入法选词、多屏和焦点恢复仍需实机复核，自动协议／输入策略测试不等同于全部系统交互验收。

## 下载与安装

从 [GitHub Releases](https://github.com/skybcyang/Tracelo/releases/latest) 下载对应平台的 ZIP，并核对 `SHA256SUMS.txt`。

- **macOS 13+（Intel / Apple Silicon）**：解压 `Tracelo-Capture-0.9.0-macos-universal.zip`，将 `Tracelo Capture.app` 放入应用程序目录并打开。通过菜单栏图标进入设置。应用不会自动注册开机启动。
- **Windows 10/11 x64**：解压 `Tracelo-Capture-0.9.0-windows-x64.zip`，运行 `TraceloCapture.exe`；无需另装 .NET，需安装 WebView2 Evergreen Runtime。通过托盘菜单进入设置，详见 [Windows 使用与开发](windows/README.md)。

选择 vault 后，填写插件设置中的实际任务相对目录。目录须存在；快捷工具只新增任务，不修改原有任务与插件状态。两个系统默认使用 Control+Alt/Option+Space，可在设置中更改。

## macOS 实现

独立的 Swift / AppKit / 系统 WebKit 菜单栏工具，macOS 13+，无第三方运行时依赖。NSPanel、鼠标所在屏幕定位和 Carbon 全局快捷键保持原生；页面完全本地加载，禁止外部导航和网络资源，不启动 HTTP 服务，也不要求 Obsidian 正在运行。

## 构建与运行

在仓库根目录执行：

```sh
node desktop/build-form.mjs
swift build --package-path desktop -c release
desktop/.build/release/TraceloCapture
```

程序运行后菜单栏出现「方框铅笔」图标，从「设置…」选择 vault，并填写插件设置中的实际任务目录，例如 `工作记录/任务`。目录必须已经存在，不会自动创建或改动 vault 结构。请先使用测试 vault 验证。该命令在前台运行；菜单栏「退出」结束程序。本项目不自动安装、不注册登录启动、不修改其他应用快捷键。

创建快捷键为 `Control+Option+Space`，记录进展为 `Control+Option+P`；菜单栏也提供两个入口。设置中可分别录入组合键，注册冲突时提示并保留原快捷键。设置保存在 `app.tracelo.capture` UserDefaults 域；图文创建与各任务进展草稿按仓库／任务目录隔离，原子保存于 `~/Library/Application Support/TraceloCapture/Drafts/`。旧草稿会迁移。

记录进展先搜索选择任务，再使用与插件共用的展开卡片。Enter 换行，⌘ Enter 提交。插件未运行时显示“已暂存，打开 Obsidian 后写入任务”，确认正式写入后才清空对应草稿。窗口中的两种模式可随时切换；待写入命令不会直接覆盖任务文件。此新增能力需要同时升级插件与桌面工具，详见[未发布更新](../docs/releases/unreleased-2026-09-29.md)。

## 输入行为

- 任务名称与 Markdown 详情分别填写。分组从当前任务目录的 `_groups.md` 读取，可选择四种重要／紧急组合。
- 待办、截止日期与初始进展按需展开，折叠不清除已填写内容。⌘ Enter（macOS）／Ctrl Enter（Windows）创建，详情与进展中的 Enter 正常换行；组合输入时不提交。
- Esc 收起并保留草稿，再次打开恢复。浮窗位于鼠标所在显示器的可见区域中心，并聚焦编辑框；收起后恢复此前应用焦点。
- 默认「未分组、不重要、不紧急」。详情不是进展；创建事件及所选待办、日期、初始进展事件与插件一致。完整字段和选择均保留在草稿中，可显式清空。
- 保存成功才清空输入并收起。错误在浮窗中提示，原输入和本次请求 ID 保留以供重试。

## 存档协议与安全发布

共用表单使用插件的领域函数及 `src/archive.ts` 直接生成 v1 存档，原生 `CaptureCore` 校验请求 ID 和协议头并原子发布。包含 JSON 注释、属性、可选 `## 详情`、待办和时间线。分组源变动时先刷新选项，请用户确认后再创建，避免把旧分组悄悄改成未分组。

0.7.0 将产品名称“备注”调整为“详情”。内部字段仍为 `notes`，插件继续严格兼容旧 `## 备注` 存档；应搭配 0.7.0 或更新插件，0.6.0 插件不支持新的正文标题。

纯文字任务文件名为唯一任务 UUID 加 `.md`。含图片任务整体发布为 UUID 文件夹，内含同名 Markdown 与相对引用的图片。创建草稿支持多选、粘贴和拖入 PNG/JPEG/WebP/GIF/BMP，每张 10 MB、合计 40 MB。快捷工具仅发布新任务或持久修改命令，既有任务修改由插件应用。配置拒绝 `..`、绝对任务路径及解析符号链接后逃出 vault 的路径。

先将完整 UTF-8 内容写到任务目录内的随机隐藏临时文件并同步，再通过 POSIX `link` 原子发布 `.md`，最后删除临时文件。硬链接不会覆盖现有目标；相同请求和完全一致内容的重试返回原文件，不同内容同名时报告错误。若目标文件系统不支持硬链接则保留草稿并提示失败，不退回非原子覆盖。突然退出可能留下 `.tracelo-*.tmp`；插件不会将其识别为任务。用户可在确认无工具写入时删除这些临时文件。

## 自动验证

```sh
swift run --package-path desktop CaptureCoreTests
npx vitest run tests/desktop-archive.test.ts
bash desktop/package-macos.sh
PLAYWRIGHT_CHANNEL=chrome npm run test:capture
```

原生测试不依赖 XCTest（仅安装 Command Line Tools 的环境也可运行），覆盖多行拆分、空标题、IME/Shift/Enter/Esc 输入策略、目录边界、原子不覆盖和相同请求重试。跨语言测试实际编译 Swift fixture，生成只有标题、中文/图片详情、Unicode/控制字符转义三类样例；由 TypeScript 严格解析并重新序列化，逐字节比较。仅 macOS 执行该跨语言测试。

核心与协议测试只使用临时目录，不写入真实 vault。打包脚本生成共享表单 bundle，同时构建 arm64/x86_64，合并 Universal 应用，复制插件样式表并验证签名与实际 WebKit 浅／深色界面；不注册真实快捷键，不修改用户草稿。可为二进制的 `--smoke-test` 追加 `--screenshots /tmp/tracelo-capture-preview` 输出真实 WebKit 渲染截图。Windows 构建同样生成并嵌入这些共享资源，运行需要 WebView2 Evergreen Runtime。

## 需要交互验收的项目

实际中文输入法选词、多屏与全屏应用定位、焦点恢复、快捷键冲突、浅色/深色可读性、文件权限失败后的草稿、真实 Obsidian 新文件即时接入需在测试 vault 中手工验收。自动测试覆盖输入策略与协议，不能替代这些桌面系统集成场景。
