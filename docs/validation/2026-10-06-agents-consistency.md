# AGENTS 一致性修复

日期：2026-10-06。基于当前工作树开发版，保留已有未提交改动；版本标记仍为 0.9.3。

## 修复范围

- 桌面一句话 RPC 绑定打开时的目录和会话代次，发送及返回后均校验；切换目录使旧弹窗、待处理请求失效。未确认落盘的编辑按原目录保留，返回原目录时重试，迟到回调不污染新会话。
- 详情“取消”退出编辑并保存草稿，正式详情不变；再次编辑恢复输入。
- 外部文件刷新等重绘在中文 composition 结束和最终 input 之后执行，保留最终文本、选区、焦点；搜索框同样恢复输入位置。
- 桌面 `smart_progress` 采用普通进展的分组／象限置顶及记录反馈，其他任务相对顺序不变。
- `task.md` 只保留待办和未完成实机项；原始实施与设计记录移至 [历史文档](../task-history.md)，不删除历史证据。

## 回归过程

新增四组回归，在修复前分别确认：取消丢失详情、IME 节点被替换、智能进展不置顶、A 目录任务请求发往 B。修复后定向检查通过。

首次全量检查发现延迟刷新后搜索框失焦，随后修复并重跑：13 项搜索／导航检查通过，包含两种 compositionend 与最终 input 顺序。

验证入口：`tests/view-details.browser.mjs`、`tests/editable-sync.browser.mjs`、`tests/quick-sync.browser.mjs`、`tests/smart-desktop.browser.mjs`、`tests/search-navigation.browser.mjs`。

## 本机安装记录

安装目标为项目实际 vault `/Users/skybcyang/SkybcWork/projects/WorkAssistant` 的 `.obsidian/plugins/work-timeline/`，以及 `/Applications/Tracelo Capture.app`。

安装前备份位于 `/Users/skybcyang/Library/Application Support/TraceloCapture/Backups/agents-fixes-20261006-J3B6kF/`，包含旧插件及配置、完整任务目录、旧快捷应用、桌面草稿及 UserDefaults。保留原配置，不创建正式验收任务。

安装完成后：三个插件产物均与构建逐字节一致；已安装应用的全部 Contents 文件与 Universal 构建一致，签名校验通过。实际 Obsidian 通过插件管理停用／启用完成重载，确认“选择密钥文件”“测试连接”和新草稿控件出现；普通窗口刷新不足以卸载旧实例。

实际快捷应用运行路径为 `/Applications/Tracelo Capture.app/Contents/MacOS/TraceloCapture`。已打开创建、一句话及记录进展入口，确认读取本项目现有任务，随后收起窗口保留后台进程。已有创建草稿中的旧分组失效提示如实保留，未擅自改动。

安装前后任务目录均为 18 个文件，逐文件 SHA-256 完全一致；插件模型配置、进展草稿和详情草稿不变。一句话原文保留，检查时打开／关闭旧草稿使其新增新版序列化字段。没有创建、修改或删除正式验收任务。

| 产物 | SHA-256 |
| --- | --- |
| 插件 main.js | `d096ee7e17c1c173a02022ac54970f1676e228119fe604bd9df08185d091a231` |
| 插件 styles.css | `a5f8418b9d06de17e02773a9201bb39afbc4d2e0c94dde3ee8df9d68a97cc849` |
| 快捷应用二进制 | `e8ff5b5df0de1c6cc5e88e8b98e74526bfb08dd59fd1d10f6b3cccb177ab453f` |
| 快捷应用共享表单 | `6f433780543617a753377af7bd288c419c91a5f379fc1ccf1d9c6a765c9fc3b7` |

## 最终验证结果

- `npm run check` 最终退出码 0：126 项单元测试全部通过，无跳过；生产构建、可编辑同步、图标、全部布局／创建／快捷进展／展示／动效／一句话浏览器检查通过。通过 `DOTNET_PATH` 指定本机临时 SDK。
- macOS Universal 打包、签名校验及真实 WKWebView 普通创建／深浅色冒烟通过；Swift 核心 10 项通过。
- Windows Release 构建成功，0 警告、0 错误；C# 核心 18 项通过。
- 已检查当前代码渲染的详情草稿恢复截图（`test-results/agents-consistency/restored-notes.png`），并通过系统截图检查实际安装的 Obsidian 和快捷一句话界面。
- 当前待办与历史文档的相对链接检查通过；`git diff --check` 通过。未提交、推送或发布。

## 验证边界

浏览器模拟宿主验证目录竞态与 composition 生命周期，不等同于物理中文候选窗。Windows 构建／核心测试和模拟桥接不等同于 Windows GUI 实机。多屏、麦克风、真实剪贴板及完整人工矩阵仍见 [当前待办](../../task.md)。

本轮自动向 Obsidian 发送全局快捷组合键未唤起快捷窗口；通过应用的 `--show` 入口及真实窗口验证了创建／进展功能，进程持续运行，但全局快捷键是否收到真实硬件按键仍需人工确认，不计为通过。本轮未再次调用付费模型接口。
