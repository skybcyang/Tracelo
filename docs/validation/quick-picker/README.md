# 任务切换与快捷记录页面统一

2026-09-29。对应松绿新版工作区 `0c57/WorkAssistant`，保留既有主题及同期彩色图标改动。

- 任务选择行明确覆盖宿主默认按钮外观；普通行使用透明底，当前任务使用主题浅底和勾选标识。
- 搜索框、任务选择器与进展输入区统一字号、边界、圆角和焦点反馈；长标题、分组信息按内容排版。
- 搜索只更新结果区域，避免重新挂载输入框而丢失连续输入及输入法焦点。
- 当前任务选择框点一次展开搜索，再点一次收起；保留当前任务和进展草稿，键盘 Enter 同样可切换。
- 列表独立滚动；表单区保留统一间距，展开待办时不挤压列表；插件和桌面表单均保持底部操作可见。

验证：

- `npm run build`、`node desktop/build-form.mjs`、`git diff --check` 通过。
- `npm test`：92 项通过，2 项跳过（15 个测试文件通过、1 个跳过）。
- `tests/quick-progress.browser.mjs`：选中标识、连续搜索、无结果、键盘选择、浅深色、窄窗口、独立草稿、输入法与写入回执通过。
- `tests/collection-interface.browser.mjs`：Obsidian 宿主默认按钮不再覆盖任务行，展开列表时底部记录按钮仍可见；现有四主题与响应式回归通过。
- `tests/capture-shell.browser.mjs`、`tests/create-images.browser.mjs`、`tests/quick-sync.browser.mjs` 通过。

截图：`picker-light.png`、`picker-dark.png`、`quick-light.png`、`quick-dark.png`。均为临时测试任务。

本轮更新源码、插件构建和共享桌面表单 bundle；未安装或重启用户正在运行的 Obsidian／桌面应用，未改动真实任务数据。

后续已合入本地 `main`，最终回归与安装差异见[一致性与合并记录](../2026-09-29-consistency-integration.md)。
