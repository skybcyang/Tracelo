# 银灰玻璃工作台生产接入

2026-10-16 用户明确授权按确认 Mockup 实施，并追加两项要求：有任务材料目录时，展示台增加目录树一列；封面轮转可连续循环、没有首尾边界。实现、相关自动回归、生产画面、本地安装及解锁后的真实 Obsidian／快捷窗口检查已完成。系统全局快捷键仍待实体按键确认，不宣称完整人工矩阵通过。未提交、推送或发布。

## 本轮实现

- 默认进入当前任务工作台：左侧最新进展，右侧待办与详情，下方任务牌组。沿用现有记录、草稿、图文详情、待办和存档服务；不另存一份正式任务正文。
- 仅已有材料目录的任务显示第三列目录树；支持逐层展开、打开文件、目录变动刷新、读取失败重试。目录树渲染只读，不自动创建或修复材料目录；迟到的读取结果不能恢复旧任务内容。
- 封面流通过重复轨道与等价位置回移连续循环，支持滚轮、触控板、左右按钮与键盘。浏览只改变牌组位置，点击封面或回车才切换展示台，不隐式更改对话引用。
- 分组与象限联合筛选，全屏总览使用同一组封面；原完整卡片交互保留在“展开看板”。总览菜单的详情、进展和待办操作会打开对应任务的编辑区域。
- 日历、日期、整周及当日截止保留，右下保留工作对话、活动与任务历史入口。草稿、引用和阅读位置独立保留。浅深色玻璃、周边柔光、动效暂停及减少动态效果已接入生产样式。
- 窄窗口改为上下排列，修正旧版分栏样式导致助手被隐藏的问题；不以原型代替生产渲染。

主要实现：`src/task-workbench.ts`、`src/main.ts`、`src/task-card.ts`、`styles.css`。设计依据见[任务展示台](../design/task-stage.md)及[玻璃工作台确认稿](../design/glass-workbench/README.md)。负责人、提醒及智能行动仍只是[独立设计提案](../design/action-reminders.md)，本轮未实现。

## 自动验证

所有时间均为本机执行的北京时间。完整检查后仅修正展示台缓存、总览编辑入口和窄屏助手兼容，并复跑受影响构建、工作台、卡片及对话专项；解锁后另修复真实宿主的留白优先级，复跑构建及工作台专项。没有把早于最终修改的完整检查写成最终版本全量重跑。

| 检查 | 完成时间 | 结果与范围 |
| --- | --- | --- |
| `npm run check` | 04:14 | 通过；147 单元、生产构建、可编辑同步、图标、布局、工作台、共享表单、展示动效、智能录入、对话与可靠性；2 项 .NET 测试跳过 |
| `npm run build` | 09:35 | 宿主留白修复后的源码通过；仓库标准命令含 `--skipLibCheck` |
| `node tests/workbench.browser.mjs` | 09:36 | 最终通过，新增真实 Obsidian leaf 包装下 36px 留白断言；循环首尾、滚轮／键盘、浏览与选择分离、切卡草稿／引用、目录树与迟到读取、失败重试、总览菜单、联合筛选、浅深色、窄屏助手、100 卡、空／单／双卡 |
| `node tests/card-interactions.browser.mjs` | 04:31 | 最终 87 项真实组件渲染检查通过；旧卡片完整交互仍可达 |
| `node tests/work-conversation.browser.mjs` | 04:30 | 最终对话、确认写入、引用、草稿、历史、失败／取消和宽度检查通过 |
| `swift run --package-path desktop CaptureCoreTests` | 04:17 | 10 项核心测试通过 |
| macOS Universal 构建、签名及双架构检查 | 本轮构建；解锁后资源同步重签 | arm64／x86_64 编译、合并与签名验证通过；早先锁屏时打包内 WebKit 超时保留为历史失败 |
| 安装版 macOS 原生 WebKit 冒烟 | 10:05 | 退出码 0；共享创建表单浅深色、独立标题／详情、四象限、焦点／底栏，以及隔离原子写入／稳定重试通过 |

日志在本机 `.local/workbench-20261016/`：`check-final.log`、`build-final.log`、`workbench-final.log`、`cards-final.log`、`conversation-final.log`、`swift-core.log`、`macos-package.log`、`native-smoke.log`。早期精确完成时间保存在 `evidence-times.json`；解锁续验见 `build-unlocked.log`、`workbench-unlocked.log`、`host-gutter-red.log`、`native-unlocked-final.log` 及 `native-unlocked-result.json`。

回归先失败再修复：首次默认工作台缺失见 `red.log`；新增窄屏助手断言在 800px 失败见 `narrow-red.log`，修正后通过。解锁后发现宿主旧选择器的零留白覆盖新样式，补足真实 leaf 包装后先复现 `0px !== 36px`，再修正选择器并通过。卡片菜单测试补充关闭旧菜单，避免遮罩拦截后续点击；未放松生产校验。合成 composition 只验证节点与事件保护，不代表真实中文候选窗已测。

## 生产画面与交互证据

截图页面使用当前生产组件及样式，数据全部在内存隔离，不读取或修改正式任务。可运行预览：`http://127.0.0.1:4188/?workbench=1&state=directory`（仅本机服务器运行期间可用）。确认 Mockup 位于另一目录，未混作本轮实现证据。

- 默认、有目录、编辑、全屏、目录错误五种 1728×1080 画面：[截图与报告](../../test-results/workbench/production-shots/report.json)。检查无控制台错误、破图或横向溢出。
- 800／600／390px 窄窗口：[截图与报告](../../test-results/workbench/narrow/report.json)；自动交互另核对助手仍可访问。
- 深色 2 倍像素截图：[报告](../../test-results/workbench/zoom-dark/report.json)。主题过渡稳定后取图；2 倍像素不是宿主 200% 界面缩放。
- 动效开始／中间／结束帧与截图报告位于 `test-results/workbench/motion/`；本机无 ffmpeg，仅保留帧序列，未生成 MP4。
- 另有独立静态视觉复查，初评 8.2/10；已调整属性字号／对比、压缩牌组控件间距，并统一全屏封面。该初评分不能作为修改后的复评或实机交互结论。

![当前生产组件的目录展示台，使用隔离样本](../../test-results/workbench/production-shots/directory.png)

## 本地安装与数据保护

早先 04:32 完成首次安装；解锁后将包含同期 Emoji 精简与宿主留白修复的最新构建重新安装到本项目 vault 的 `.obsidian/plugins/work-timeline/`，同步 `main.js`、`styles.css`、`manifest.json`。已更新 `/Applications/Tracelo Capture.app` 并重启进程，实际偏好指向本项目 vault，任务目录与插件一致。

安装前完整备份本项目插件／配置、任务／附件、旧应用及快捷草稿／偏好，位置为 `.local/workbench-20261016/install-backup/`。它包含私人配置，只保留本机，不上传。回退提示见该目录 `RESTORE.md`；恢复配置或数据前应核对后续编辑，不能无条件覆盖。

安装后再次核对：插件三件套与源产物哈希一致；安装应用与最终构建逐文件一致；正式任务、附件、插件配置／草稿、快捷偏好及草稿保持。`install.log`、`install-unlocked.log`、`install-unlocked-verify.log`、`install-before.json`、`install-after.json` 与脱敏的 `installed-runtime.json` 保存本机证据。10:07 最终复核哈希、正式任务／附件、配置、偏好及所有草稿通过。版本仍为 0.9.7 本地开发构建，不能与公开 Release 混同；没有产出本轮发布包。

## 解锁后的真实宿主验收

用户回复“已解锁”后继续验证，最终实际项目窗口已重新加载：16 张任务、工作台与日历／工作对话均存在；首张向前为 16/16，再向后为 01/16，展示任务始终保留。重载后已确认宿主留白修复及同期 Emoji 精简生效。

本项目任务没有材料目录，因此在本机隔离 vault `.local/workbench-20261016/native-host/Workbench-QA` 创建三张合成任务及嵌套材料，未修改正式任务。真实 Obsidian 中选择目录任务、展开“参考资料”、打开“验收材料.md”并返回工作台通过；无目录任务不出现空目录列；03/03 向后循环为 01/03 时仍保留目录任务。此项依据原生可访问性树与实际点击状态；早期 `native/directory.png` 误捕为打开材料后的窄分栏，不作为目录布局截图证据。隔离 vault 文件及注册保留本机，验收窗口已关闭。

安装版快捷程序使用 `--show` 打开，确认新建／进展入口与项目目录；Esc 收起并返回 Obsidian，未提交正式任务。安装版原生冒烟在 10:05 退出码 0，覆盖共享表单浅深色及隔离写入。此前锁屏超时是历史失败，已由本轮解锁后的成功复验补齐。

![本项目真实 Obsidian 的最终安装版](../../test-results/workbench/native/project-host.png)

[安装版快捷进展截图](../../test-results/workbench/native/quick-progress.png)。脱敏范围记录位于 `.local/workbench-20261016/native-unlocked-result.json`。

系统全局快捷键仍未完成实体按键验证：CUA 面向应用注入组合键未取得可靠的系统唤起证据，不能据此断言快捷键已通过或存在产品故障。真实中文候选、麦克风、多屏／全屏、完整主题缩放矩阵与 Windows GUI 本轮未运行；Windows 本机无设备及 .NET SDK，2 项兼容测试已明确跳过。既有人工验收边界继续保留于 [task.md](../../task.md)。
