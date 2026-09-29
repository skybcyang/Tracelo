# Noto 彩色图标接入验证

## 结果

- 仅新增 `@iconify-json/noto` 1.2.9，已移除本轮临时加入的 Fluent Color / Fluent Emoji 依赖。
- 图库提供 3,729 个非隐藏图标，完整 SVG 数据随插件及桌面共享脚本打包，不访问外部图标服务。
- 任务、分组使用 Noto，支持常用中文词／英文名称搜索、每次追加 80 项、当前选择置顶、隐藏、继承分组。
- 旧 Lucide 图标名在显示时映射，未知名称退回默认任务图标，不改写存档或历史。工具栏操作图标保持原有实现。
- 每个 SVG 实例独立命名渐变、滤镜和引用 ID，避免重复图标颜色串扰。
- Noto Apache-2.0 许可及来源说明存于 `licenses/noto-emoji.txt`，并嵌入两个构建脚本的输出头部。

## 验证

- `npm test`：91 passed / 2 skipped（14 个测试文件通过，1 个原生兼容测试文件按现有配置跳过）。
- `npm run build`：通过；`node desktop/build-form.mjs`：通过。
- `npm run check` 初次执行在旧 `card-polish` 图标断言处失败，原因是测试仍查找 Lucide 名称与 SVG 类名。已更新为 Noto 选择及实际渲染结果，保留原有保存失败重试、取消、Esc 焦点恢复、分组继承和任务覆盖验证。
- 布局检查前半段通过：27 布局、27 瀑布流、独立滚动、87 真实卡片交互、78 内容自适应检查。
- 修正后 `node tests/card-polish.browser.mjs`：16 项通过。
- 剩余布局脚本单独完成：41 可读性、4 视图隔离、18 任务验收、7 时间线、6 创建表单、13 搜索导航检查全部通过。
- `npm run test:capture`：全部通过，包括两种宿主表单、错误入口、日历、图片、快捷进展、命令同步。快捷卡片额外验证默认图标与 `noto:rocket` 渲染。
- `node tests/color-icons.browser.mjs`：通过。覆盖断网选择、中文／英文搜索、Markdown 持久化、旧图标映射且不改原值、继承／隐藏、分批加载、无结果、深浅色及 390/1100px 布局、SVG ID 唯一性。
- 视觉检查发现“显示更多”按钮继承宿主浅色背景而深色文字已变化；增加失败断言后，为按钮指定与图库一致的背景、边框及文字，复测通过。
- `git diff --check`：通过。

## 体积与边界

`main.js` 24,606,608 bytes（约 23.5 MiB），桌面共享 `create-task.js` 25,144,224 bytes（约 24 MiB）。本轮选择完整内置 Noto，以确保全部可选图标离线可用；使用 SVG 而非系统 Emoji 字体以保持跨平台一致。

本轮构建项目文件，未重新安装或重启用户的 Obsidian / 桌面应用；未发布版本。浏览器夹具验证不能替代真实 Obsidian、macOS WebKit 与 Windows WebView2 的实机验收。

## 预览

- [浅色桌面](noto-icons/icons-light-1100.png)
- [深色桌面](noto-icons/icons-dark-1100.png)
- [浅色窄屏](noto-icons/icons-light-390.png)
- [深色窄屏](noto-icons/icons-dark-390.png)
