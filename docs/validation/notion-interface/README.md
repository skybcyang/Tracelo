# Notion Cards 实装验收

日期：2026-09-29。设计依据：`docs/design/notion-cards/` 中已经确认的 mockup。

## 已实现

- 项目分组卡片、全部／今天／分组筛选、分组与四象限视图、始终可用的搜索入口。
- 卡片原处展开、最新进展时间、待办摘要、完成任务与撤销；历史改为按需打开的弹窗，关闭后恢复焦点与看板位置。
- 新建任务直接展示标题、详情、分组、截止日期和 2×2 四象限点选区；待办、初始进展和附件折叠收纳。
- 桌面快捷新建与快捷进展使用同一套灰白／深色主题和共享组件，浮窗宽度为 530px。
- 保留现有数据模型、草稿、图片、导入导出、日历、搜索定位、同步与回执流程。

## 实际代码预览

运行 `node tests/helpers/ui-review-server.mjs` 后打开：

- 主界面：<http://127.0.0.1:4179/?showcase>
- 深色：<http://127.0.0.1:4179/?showcase&dark>
- 快捷新建：<http://127.0.0.1:4179/capture?mode=create>
- 快捷进展：<http://127.0.0.1:4179/capture?mode=progress>

以上预览调用实际组件，使用内存中的演示仓库，不写入真实 Obsidian 仓库。

## 验证结果

- `npm run check` 通过：87 项单元测试通过、2 项跳过；TypeScript、插件构建、界面和快捷工具回归通过。
- 最终窄窗标题高度调整后，重新通过 `card-polish`、`notion-interface` 和 `card-content` 三组界面测试。
- `swift run --package-path desktop CaptureCoreTests`：10 项通过。
- `node desktop/build-form.mjs` 与 `swift build --package-path desktop` 通过。
- `desktop/.build/debug/TraceloCapture --smoke-test` 通过，覆盖实际 macOS WebKit 表单、主题、焦点、底部操作以及原子提交与重试。
- 浏览器目视检查：桌面三列、430px 窄窗、深色、卡片展开、历史弹窗、快捷新建和快捷进展。
- Windows 共享界面和消息协议已由回归覆盖；当前环境没有 Windows/.NET，原生窗口尚未运行验收。

当前改动已在本工作区构建，未安装到用户真实 Obsidian 仓库。

## 截图

- [主界面](main-light.png)
- [深色主界面](main-dark.png)
- [深色窄窗](main-narrow-dark.png)
- [卡片展开](expanded-light.png)
- [历史弹窗](history-light.png)
- [快捷新建（四象限常显修正版）](quick-create-corrected.png)
- [快捷进展（按 mockup 修正版）](quick-progress-corrected.png)

## 快捷工具修正

根据用户对实装与 mockup 偏差的反馈，快捷推进不再复用整个看板卡片：直接进入最近任务的编辑界面，保留上次选择，点击“记录到”下的任务标题进入选择器。界面依次显示任务和分组／截止信息、上次进展、本次输入、带计数的待办与附件折叠区。保存位置和带快捷键提示的提交按钮放在独立底栏，长内容滚动时底栏始终可见。

此次验证：87 项单元测试、全部布局回归通过；底栏修正后重新通过构建及全部 `test:capture`，覆盖直接进入、切换任务独立草稿、2×2 象限、360px/530px 底栏、中文输入法和持久化回执。重新生成桌面资源，macOS 构建和原生表单 smoke test 通过。Windows 原生运行仍未验收。

旧版快捷截图保留用于追溯，以上两个修正版链接为当前实现。原 mockup 不作覆盖修改。

早期独立应用设计归档保留，`docs/design/archives/2026-09-29-standalone.zip` 的 SHA-256 仍为 `e43943eb33028fc95331ca3f1f0c36c5b3a7b8d925538d0404c3adb4fec01421`。
