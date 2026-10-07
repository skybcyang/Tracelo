# 开发与文档

## 本地开发

要求 Node.js ≥ 22.12。

```sh
npm ci
npm test              # 单元与契约测试
npm run build         # 类型检查与插件构建
npm run test:layout   # 布局、滚动与卡片交互
npm run test:capture  # 共享桌面表单、日历、图片及快捷命令
npm run test:icons    # 离线图标与四主题深浅色
npm run test:presentation # 等高卡片、展示模式、动效与异步边界
npm run check         # 依次执行以上全部
```

完整浏览器套件需要 Playwright Chromium，先运行 `npx playwright install chromium`（Linux CI 使用 `--with-deps`）。部分脚本支持 `PLAYWRIGHT_CHANNEL=chrome`，但顶栏与展示模式等脚本仍直接启动 Chromium，因此该变量不能替代完整套件的浏览器安装。完整跨语言检查还需 macOS Swift 和 .NET 8 SDK；`dotnet` 不在 PATH 时，可通过 `DOTNET_PATH` 指定可执行文件。缺少原生工具导致的跳过不算通过。

桌面应用构建见[桌面工具文档](../desktop/README.md)。`tests/notion-interface.browser.mjs` 是旧设计实验，当前主题由 `collection-interface` 和 `header-navigation` 测试覆盖。

## 发布

下次发布先读[发布操作手册](releasing.md)：版本预检、GitHub 网络通道、三平台候选构建、冻结提交与标签发布，以及附件验收。经验来源见 [0.9.1 发布复盘](validation/2026-09-30-release-091.md#发布复盘)。

## 当前基线

- [0.9.7 发布说明](releases/0.9.7.md)：当前功能、下载与升级说明。
- [0.9.7 发布验收](validation/2026-10-08-release-097.md)：本地检查、候选构建与远端发布结果。
- [展示模式与动效验证](validation/2026-09-30-presentation.md)和[导航与菜单验证](validation/2026-09-30-navigation.md)：本轮实现与实机边界。

## 0.9.1 整合历史

- [0.9.1 发布说明](releases/0.9.1.md)与[发布验收](validation/2026-09-30-release-091.md)。
- [发布前开发记录](releases/unreleased-2026-09-29.md)：整合及本地安装历史。
- [一致性与分支整合](validation/2026-09-29-consistency-integration.md)：合并记录和自动检查证据。
- [界面一致性审查](validation/2026-09-29-interface-consistency.md)：实际截图、剩余差异及未覆盖范围。
- [相对 0.9.0 的界面变化](releases/plugin-collection-vs-0.9.0.md)：四主题、导航、卡片和快捷入口。

## 产品与实现

- [需求与验收基线](requirements.md)
- [任务上下文协议](design/task-context-protocol.md)
- [展示模式与偏好兼容](design/presentation-mode.md)
- [命名、迁移与导入导出](design/storage-transfer.md)
- [卡片操作与任务文件夹](design/task-folders.md)
- [可选待办与截止日期](design/optional-task-details.md)
- [Agent 只读规则模板](templates/agent.md)

## 历史记录

- [0.9.0 发布说明](releases/0.9.0.md)与[发布验收](validation/2026-09-28-release-090.md)
- [已完成任务与实施记录](completed-tasks.md)
- [历次卡片规则](design/content-adaptive-cards.md)与[紧凑设计规范](design/compact-ui.md)：保留用于理解演变，旧尺寸不代表当前设计。

正式任务和历史默认保存在 `工作记录/任务/`；草稿、排序和界面偏好保存在插件数据中。请通过插件修改正式任务。升级与回退应阅读对应发布说明，保留升级前完整备份。

文档口径：`requirements.md` 描述当前业务行为，`design/task-context-protocol.md` 描述协议；`releases/<版本>.md` 和 `validation/` 是对应时点的记录，不回写为新版本的验收。早期设计稿保留历史规则时，以页首声明和当前需求为准。
