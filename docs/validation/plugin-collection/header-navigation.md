# 双层导航实现与安装验收 · 2026-09-29

设计依据：`docs/design/header-navigation/`，用户确认“全局工具在上、任务工作区在下”。

- 顶层保留品牌、全局搜索、快捷记录、截止日历、界面设置。键盘访问顺序与视觉顺序一致。
- 下层放分组看板／四象限、全部／各分组／未分组标签、分组管理、新建任务。标签显示进行中数量；不足一行时展开换行。
- 分组筛选在切换视图后保留；从当前分组新建时带入分组，创建后仍能看到新卡片。
- 原有今天截止筛选保留为下层的日历时钟按钮，可与分组筛选组合；顶层日历继续打开完整截止日历。
- 搜索仍搜索全局；搜索定位当前任务时清除会遮挡目标任务的分组和截止筛选。
- A/D/E/F 共用导航结构；每日时间线保持原有位置，窄窗口继续提供任务／时间线切换。

## 验证

- 新增 `tests/header-navigation.browser.mjs`：先确认旧代码因缺少分组导航失败；实现后通过。覆盖直接筛选、切换四象限保留筛选、当前分组创建、未分组创建、全局搜索、多分组在 1440/960/560/390px 可见且不横向溢出。
- 16 个测试文件、90 项单元／协议测试通过；TypeScript 和生产构建通过。
- 全部布局、卡片交互、主题、搜索、时间线、创建、快捷工具、图片、队列浏览器检查通过。旧测试改为使用“分组看板”和当前设置弹窗，不再人为展开旧设置面板后点击被遮挡的按钮。
- 本机 Obsidian 重新启用后确认上层全局工具、下层实际分组名称及数量、产品研发直达和右侧时间线。

## 安装

已复制构建产物 `main.js`、`styles.css` 到 `/Users/skybcyang/SkybcWork/projects/WorkAssistant/.obsidian/plugins/work-timeline`，逐文件 SHA-256 与工作区产物一致。未覆盖 `data.json`、任务文件或 manifest。

旧产物备份：`/Users/skybcyang/.codex/backups/tracelo-header-5zVI9b`。

实际代码预览：http://127.0.0.1:4179/?collection&theme=evergreen&mode=light

截图：`header-navigation.png`（示例数据预览）、`header-navigation-installed.png`（本机安装）。
