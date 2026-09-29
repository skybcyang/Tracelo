# Noto 图标选择器：新版界面适配

验证日期：2026-09-29。
实现与截图均来自 /Users/skybcyang/.codex/worktrees/0c57/WorkAssistant 的当前源码，
包括双行导航、分组筛选、横向卡片布局与常驻时间线。package.json 仍标为 0.9.0，
这不是界面代码版本的判定依据。此次没有安装插件或重启桌面应用。

## 实现

- 仅打包 @iconify-json/noto 1.2.9，共 3,729 个可选择图标，离线可用。
- 选择器使用当前主题的背景、面板、强调色和两档圆角；固定搜索与底栏，图标区域独立滚动。
- evergreen、graphite、glacier、vermilion 均支持浅色、深色，跟随系统也保持一致。
- 卡片、分组标题、分组管理、快捷记录目标与任务列表显示同一套 Noto 图标。
- 保留搜索、分页、当前选择、继承、隐藏、保存失败重试、Escape 和焦点归还。
- 旧 Lucide 内容图标只在显示时映射，不重写用户的历史任务数据。操作按钮沿用原有图标。
- SVG 的局部定义 ID 在渲染时添加唯一前缀。Apache 2.0 声明收录于 licenses/noto-emoji.txt，
  同时随插件和桌面表单的构建产物分发。

## 验证结果

- 单元测试：92 通过，2 跳过；TypeScript 与生产构建通过。
- 图标浏览器测试：离线搜索与保存、中文/英文检索、旧 ID 兼容、分组标题、
  继承/隐藏、分页和 SVG ID 唯一性通过。
- 四主题 × 深浅色 × 1100×820、390×640、720×420 窗口通过；
  额外验证宿主深浅色与显式设置相反时，控件仍遵循所选主题。
- 16 项卡片层级/图标选择检查通过，包含保存失败与重试、Escape 和焦点归还。
- 新版导航、主题、卡片布局、瀑布流、滚动、内容、可读性、详情、任务验收、
  时间线、创建与搜索检查通过。快捷记录与桌面表单浏览器检查通过，
  desktop/build-form.mjs 构建通过。

完整 npm run check 未全绿：card-interactions 的看板缩放检查要求缩至 60% 后仍保留
5 列，当前新版布局实际增加到 9 列。用内存构建恢复旧图标渲染并去掉新增选择器 CSS，
结果仍为 5 → 9；Noto 渲染也是 5 → 9。因此没有在此次图标任务中修改该布局或其断言。
在这项检查中断后，其余测试脚本已单独执行通过。

## 当前源码截图

- [Evergreen 浅色](noto-current-theme/icons-evergreen-light-1100.png)
- [Evergreen 深色](noto-current-theme/icons-evergreen-dark-1100.png)
- [Graphite 窄屏深色](noto-current-theme/icons-graphite-dark-390.png)
- [Glacier 浅色](noto-current-theme/icons-glacier-light-1100.png)
- [Vermilion 深色](noto-current-theme/icons-vermilion-dark-1100.png)

完整主题截图由 TRACELO_QA_OUTPUT=docs/validation/noto-current-theme npm run test:icons 生成。
