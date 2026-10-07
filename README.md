# Tracelo

在 Obsidian 中管理任务，随手记录进展，让工作过程有迹可循。

Tracelo 将任务看板、工作对话与进展历史放在一起：用分组和四象限安排事情，用一条条进展保留过程。任务与历史以可编辑的 Markdown 保存在本地 Obsidian 仓库中。

## 你可以用它

- **安排任务**：按项目分组，设置优先级、待办清单和截止日期。
- **记录过程**：追加文字与图片进展，回看单项任务的完整历史。
- **回顾工作**：按日期浏览时间线，搜索任务和进展，查看截止安排。
- **随手捕捉**：通过 macOS 菜单栏或 Windows 托盘快速创建任务、记录进展。
- **自由整理**：调整主题、卡片密度与看板布局，导出任务及附件，保留本地备份。

## 开始使用

1. 从 [Releases](https://github.com/skybcyang/Tracelo/releases/latest) 下载插件包。
2. 将 `main.js`、`manifest.json` 和 `styles.css` 放入仓库的 `.obsidian/plugins/work-timeline/` 目录。
3. 重新加载 Obsidian，在第三方插件中启用 Tracelo，通过命令面板“打开工作时间线”开始使用。

桌面快捷工具的安装与配置见[使用说明](desktop/README.md)。升级时保留 `data.json` 和任务目录，并按对应版本的发布说明操作。

当前版本为 0.9.7，修复分组档案保护、文件移动同步、失效历史引用，并改善短窗口日历。更新与迁移说明见[发布说明](docs/releases/0.9.7.md)。

## 项目边界

此仓库维护 Tracelo Obsidian 插件与 macOS／Windows 桌面快捷工具，不包含独立的人生工作台与鸿蒙应用。

## 了解更多

桌面 Obsidian 支持“一句话创建任务／记录进展”；独立快捷工具提供一句话创建，进展直接输入。两端均可直接输入 API Key、测试连接、编辑确认与恢复草稿；独立工具进展收到插件回执后才确认写入。配置及隐私边界见[使用说明](docs/smart-capture.md)。不配置模型也能使用原有离线任务功能。

支持[直接编辑任务 Markdown](docs/editable-tasks.md)：属性使用 YAML，详情、待办和进展正文各保存一份；保存后自动刷新看板，双击卡片正文或通过右键菜单打开任务文件。旧格式先备份再迁移，请配套升级桌面工具。

右侧工作对话支持多轮讨论和 @卡片引用；修改建议由你确认后保存，活动记录和单任务历史仍有独立入口。详见[工作对话说明](docs/design/work-conversation.md)。

[版本更新](docs/releases/0.9.7.md) · [开发与文档](docs/development.md) · [问题反馈](https://github.com/skybcyang/Tracelo/issues)
