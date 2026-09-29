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
npm run check         # 依次执行以上全部
```

浏览器测试需要 Playwright 浏览器；使用已安装的 Chrome 时运行 `PLAYWRIGHT_CHANNEL=chrome npm run check`。完整跨语言检查还需 macOS Swift 和 .NET 8 SDK；`dotnet` 不在 PATH 时，可通过 `DOTNET_PATH` 指定可执行文件。缺少原生工具导致的跳过不算通过。

桌面应用构建见[桌面工具文档](../desktop/README.md)。`tests/notion-interface.browser.mjs` 是旧设计实验，当前主题由 `collection-interface` 和 `header-navigation` 测试覆盖。

## 当前基线

- [0.9.1 发布说明](releases/0.9.1.md)：当前功能、下载与升级说明。
- [0.9.1 发布验收](validation/2026-09-30-release-091.md)：检查、打包与远端发布结果。
- [发布前开发记录](releases/unreleased-2026-09-29.md)：整合及本地安装历史。
- [一致性与分支整合](validation/2026-09-29-consistency-integration.md)：合并记录和自动检查证据。
- [界面一致性审查](validation/2026-09-29-interface-consistency.md)：实际截图、剩余差异及未覆盖范围。
- [相对 0.9.0 的界面变化](releases/plugin-collection-vs-0.9.0.md)：四主题、导航、卡片和快捷入口。

## 产品与实现

- [需求与验收基线](requirements.md)
- [任务上下文协议](design/task-context-protocol.md)
- [命名、迁移与导入导出](design/storage-transfer.md)
- [卡片操作与任务文件夹](design/task-folders.md)
- [可选待办与截止日期](design/optional-task-details.md)
- [Agent 只读规则模板](templates/agent.md)

## 历史记录

- [0.9.0 发布说明](releases/0.9.0.md)与[发布验收](validation/2026-09-28-release-090.md)
- [已完成任务与实施记录](completed-tasks.md)
- [历次卡片规则](design/content-adaptive-cards.md)与[紧凑设计规范](design/compact-ui.md)：保留用于理解演变，旧尺寸不代表当前设计。

正式任务和历史默认保存在 `工作记录/任务/`；草稿、排序和界面偏好保存在插件数据中。请通过插件修改正式任务。升级与回退应阅读对应发布说明，保留升级前完整备份。
