# 快捷工具的一句话直接切换

日期：2026-10-06。延续密钥输入与样式统一后的用户要求：新建、进展、一句话属于同一窗口内的三个入口。

## 行为

- 一句话挂载在现有内容区，保留品牌顶栏、三个切换入口、保存位置和当前选中下划线；移除其重复标题与窗口外壳。模型设置仍单独弹出。
- 普通新建、普通进展和一句话各自保留草稿。切出一句话等待草稿写盘，失败时停留原页；中文组合输入及正式保存期间保护当前编辑。
- 配置读取迟到不覆盖最新选择；切出尚未完成又点回一句话时，以最后一次选择为准。关闭窗口同样先保存一句话草稿。
- 内嵌内容独立滚动，短窗口底栏保持可达。沿用既有视觉样式，不另做视觉方向探索；已补入 AGENTS 与使用说明。

## 证据

先补回归并确认旧实现失败：一句话仍为 modal；另外复现了等待草稿写入时再次点回原标签被忽略的问题。修复后相关检查通过。

- `npm run check`：126 项单元测试，无跳过，生产构建及全部浏览器检查通过。
- 最终 `npm run build`、`npm run test:smart` 通过；桌面浏览器覆盖三入口切换、三份独立草稿、选中状态、迟到读取、连续点击、IME、失败写盘、短窗口和模型设置。
- `npm run test:capture` 通过，新建、图片、普通进展、离线回执与焦点未回退。
- macOS Universal 打包、签名与原生 WKWebView 冒烟通过；Windows Release 构建通过，0 警告、0 错误。
- 已查看生产代码截图，保存在 `test-results/smart-tabs/`，包含 mac/windows 模拟宿主的输入、模型设置、深色及排队状态。
- 已在安装后的真实 macOS 窗口验证“一句话 → 记录进展 → 新建任务”，顶栏始终可见，选中状态跟随内容，原新建草稿恢复。随后收起窗口，后台程序保留运行。

## 本地安装

安装前备份位于 `/Users/skybcyang/Library/Application Support/TraceloCapture/Backups/smart-tabs-20261006-3tTSUI/`，包含旧插件与配置、任务目录、旧应用、桌面草稿及偏好。

插件更新在项目 vault `/Users/skybcyang/SkybcWork/projects/WorkAssistant/.obsidian/plugins/work-timeline/`，真实 Obsidian 已停用／启用重载。macOS 应用更新在 `/Applications/Tracelo Capture.app` 并重启，完整 Contents 与打包产物一致。

- main.js SHA-256：`6806599b9be014b30f7b214dab83156dd5d39a081bc63c462ae7da3d82b58d72`
- 快捷工具共享表单 SHA-256：`f972d2d72fae4b41b4ed956791e4d8d7c5e4c5d8db3695213b8849d8dba41563`

本轮没有编辑正式任务或替换用户 API Key。安装前后任务目录的 18 个文件逐文件哈希一致，插件配置不变。未提交、推送或发布。

Windows GUI、物理中文候选窗、全局硬件快捷键和真实模型调用未在本轮验证；浏览器模拟及构建不视为这些实机证据。
