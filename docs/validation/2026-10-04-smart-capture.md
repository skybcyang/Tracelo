# 一句话录入验收记录

日期：2026-10-04。范围：桌面 Obsidian 插件，当前工作区开发构建。保留工作区原有素白主题、品牌与鸿蒙改动；随后按用户要求安装到本文件夹 WorkAssistant，未发布，也未替换日常 SkybcWork 的插件。

## 本文件夹安装

- 目标：`/Users/skybcyang/SkybcWork/projects/WorkAssistant/.obsidian/plugins/work-timeline/`。三份插件文件与开发构建 SHA-256 一致。
- 旧版 `main.js`、`styles.css`、`manifest.json` 及 `data.json` 已备份到 `/Users/skybcyang/Library/Application Support/TraceloCapture/Backups/smart-capture-20261004-ZjN0QH/`。
- 原有配置字段逐项比较一致，仅新增 `smartCapture` 与 `smartDrafts`；模型设置关联用户提供的密钥文件路径，不复制密钥内容。
- 真实 WorkAssistant 窗口（Obsidian 1.13.7）已加载新版，确认“一句话”按钮存在、录入弹窗可打开、模型设置已保存。安装检查未创建测试任务；真实模型写入测试仍使用下述独立临时仓库。

## 结果

- `npm run check` 完整通过：111 项单元测试通过、2 项原有测试跳过；生产构建、图标、全量布局、快捷创建／进展、展示模式和一句话浏览器测试通过。
- 新增 16 项提取与边界测试：字段校验、日期有效性、已有分组约束、最小上下文、未知待办拒绝、已结束任务拒绝、不可变／幂等进展、密钥解析、配置不保存密钥、HTTPS 地址检查、服务错误脱敏与超时。
- 一句话浏览器测试通过：模型失败保留原文，关闭重开恢复，取消后忽略迟到响应，确认前不写任务，修改后的表单恢复，磁盘失败可重试，指定任务进展／待办保存与重复提交保护，设置校验，深色截图，390px 与短窗口可达性。
- 三组真实 Kimi Code 测试通过：相对日期／分组／优先级／待办／首条进展提取；未说明的事实留空；指定任务的进展提取与待办勾选。真实 User-Agent 为 `Tracelo/0.9.3`，未伪装其他客户端。
- 真实 macOS Obsidian v1.9.14 通过：独立配置目录和临时 vault，实际读取本地密钥文件，经 Obsidian `requestUrl` 调用 Kimi，确认创建任务，再追加进展及完成待办，最后读取磁盘 Markdown 验证历史。最新一轮测试仓库为 `/var/folders/7z/5dcj6kmx005b6sm35w8tnnl80000gn/T/tracelo-smart-qa-VVbYxu/vault`。
- 检查密钥不出现在构建、源码、文档中；`harmony/kimi-api-key.md` 已被 Git 忽略。测试和截图没有密钥内容。

## 本轮修正

- 新入口放在视图切换旁边，避免让 390px 窄窗口的任务操作栏多占一行；搜索／时间线切换与九宽度顶栏检查通过。
- 将一个旧回归测试的绿色常量改为读取当前主题强调色，兼容工作区已有的素白默认主题；未更改既有主题行为。
- 根 Vitest 排除使用 Node test runner 的 `harmony/` 测试，避免两套测试运行器混跑；鸿蒙继续使用自己的测试入口。
- 原生测试使用 Chromium 调试端口连接独立 Obsidian 进程，等待首次仓库信任流程和插件加载后再操作；不会连接或关闭用户正在运行的个人仓库。

## 证据

截图位于本地 `test-results/smart-capture/`：

- `create-preview.png`、`progress-preview.png`：浏览器创建／进展确认。
- `dark-preview.png`：深色与表单布局。
- `native-create.png`、`native-progress.png`：真实 Obsidian 与真实模型返回结果。

测试脚本：`tests/smart-capture.test.ts`、`tests/smart-capture.browser.mjs`、`tests/smart-capture.live.mjs`、`tests/smart-capture.native.mjs`。

## 边界

原生验证只覆盖 macOS Obsidian；Windows 新 AI 功能尚无原生验收。系统听写的真实麦克风效果未测。没有实现后台监听、跨任务自动匹配、多任务自动拆分、定时提醒或自动免确认保存。HarmonyOS 与独立菜单栏／托盘工具尚未接入。Kimi 真实例句通过不代表任意自然语言都能正确提取，确认编辑仍是正式保存前的步骤。

详细配置与复跑命令见[使用说明](../smart-capture.md)。
