# Tracelo 当前待办

本文件只保留未完成工作与验收边界。历史实施、确认稿与分阶段安装记录见 [历史记录](docs/task-history.md)。当前 0.9.7 的范围、升级与验证见 [发布说明](docs/releases/0.9.7.md)和 [本轮验收](docs/validation/2026-10-08-release-097.md)。历史 0.9.5 记录保持原日期与版本。

2026-10-06 四项 AGENTS 行为差异已修复并完成全量回归；项目插件已更新并重载，本机快捷应用已更新并运行。备份、哈希、实机入口和未测边界见 [一致性修复验收](docs/validation/2026-10-06-agents-consistency.md)。

后续已将一句话并入新建页，插件与快捷工具共享“手动填写／一句话整理”，详见 [合并创建入口验收](docs/validation/2026-10-06-unified-create.md)。

工作对话首版已实现并安装：只替换右侧下方时间轴，保留日期、周历与当日截止；支持多轮整理、@卡片及确认后创建／修改。自动回归、真实模型与 Obsidian 入口检查见 [工作对话验收](docs/validation/2026-10-06-work-conversation.md)。

2026-10-07 已批准的 32 项 UI 修改随 0.9.5 正式发布；三平台候选和正式检查通过，七个附件校验完成，项目插件已重载为 0.9.5、快捷程序已更新并重启。详见 [发布验收](docs/validation/2026-10-07-release-095.md)。

0.9.7 五项修复、代码整合、本地安装与正式发布已完成，七个下载附件通过校验。授权清单与完成记录移入 [历史记录](docs/task-history.md)，本轮证据见 [验收记录](docs/validation/2026-10-08-release-097.md)。

## 尚待实机验收

- [ ] 工作对话：真实中文候选窗、全主题／缩放实机矩阵；0.9.5 时快捷程序窗口自动化连接超时；0.9.7 已更新至正式发布 app，原生冒烟通过，仍需复核安装版快捷键及新建／进展切换。
- [ ] 展示模式：真实 Obsidian 全量矩阵，覆盖分组／四象限、布局偏好、主题、窄窗口、缩放、长内容、图文、多待办、空内容及大量卡片。自动矩阵已有覆盖，见 [展示模式记录](docs/validation/2026-09-30-presentation.md)。
- [ ] 动效与快捷进展：真实中文输入法候选窗、快捷键冲突、跨应用焦点恢复、多屏／全屏定位、长内容与大量卡片性能。macOS 原生冒烟不替代系统交互验收；Windows GUI 仍需设备。见 [五项改进验证](docs/validation/2026-10-06-smart-capture-improvements.md)。
- [ ] 截止日历：隔离真实 Obsidian 的六组视口与 Escape 焦点已通过；仍需手动调整原生窗口及系统缩放矩阵；跨月、空日期、今天和任务跳转已有验证。见 [实现验证](docs/validation/2026-09-29-all-tasks.md)。
- [ ] 图文创建：补齐 Obsidian、macOS、Windows 的真实剪贴板、文件选择与拖入验收，以及图片容量上限下的真机性能；自动生命周期验证已有覆盖。见 [图文设计与边界](docs/design/create-task-images.md)。
- [ ] 一句话录入：系统听写麦克风及 Windows WebView2／原生文件对话框实机验收；不得用模型接口成功替代听写验收。

## 当前说明入口

- [产品规则](docs/requirements.md)、[可编辑存档](docs/editable-tasks.md)、[一句话录入](docs/smart-capture.md)。
- [桌面安装与构建](desktop/README.md)、[发布手册](docs/releasing.md)。
