# 等高卡片、展示模式与动效验证

日期：2026-09-30。基线：当前 0.9.1 源码，保留开始前 `styles.css`、`task.md`、`tests/card-masonry.browser.mjs` 中未提交的布局与需求变更。本轮未安装、未发布，也未修改正式任务或草稿。

## 交付内容

- 默认卡片等高：标题固定单行，分类／截止日期横排，最新进展固定两行；空白、短内容、长内容底部对齐。根据截图反馈取消原先多余的第二行标题和日期占位。
- 工具栏新增展示模式，偏好可恢复；旧紧凑设置迁移后只保存一组选择。分组、象限、筛选、缩放互相独立。
- 全部内容阅读与单卡编辑分离。展示模式下结束编辑保留完整内容和任务历史；关闭模式保留正在编辑的临时展开卡片。
- 模式切换原位更新非编辑卡片，编辑输入节点保持连接；中文候选、未提交待办、保存锁、草稿和选择范围不被重建。
- 动效覆盖轻聚焦、连续高度、分层淡入、待办与进度环、新时间线节点；减少动态效果时直接呈现最终状态。100 卡场景只动画可见卡片，阅读锚点与稳定列顺序保持。
- 插件和桌面共享表单提供提交中／待同步／成功／失败反馈；实际写入或 applied 回执后才确认成功。旧成功延迟不会关闭新打开的会话。

依赖、实现和取舍见[展示模式设计](../design/presentation-mode.md)、[动效说明](../design/card-motion-implementation.md)、[快捷反馈说明](../design/quick-feedback-motion.md)。

## 自动验证

以下命令本轮实际执行：

| 验证 | 结果 |
| --- | --- |
| `DOTNET_PATH=/tmp/tracelo-dotnet/dotnet npm run check` | 最终整套检查退出码 0；包含单元测试、生产构建、图标、布局、快捷反馈与展示模式全部回归 |
| `DOTNET_PATH=/tmp/tracelo-dotnet/dotnet npm test` | 17 个文件、96 项全部通过，无跳过；使用本机已有 SDK 补齐 Windows C# 兼容测试 |
| `npm run build` | TypeScript 检查、生产打包通过 |
| `npm run test:icons` | Noto 图标回归通过 |
| `npm run test:layout` | 全部通过；含 45 项瀑布流／对齐布局、87 项卡片操作、78 项内容、41 项可读性、77 项辅助主题等 |
| `npm run test:capture` | 全部通过；包含 macOS／Windows 消息桥模拟、创建／图片／快捷进展／持久同步、新增真实反馈状态回归 |
| `npm run test:presentation` | 100 项卡片显示矩阵、模式集成、11 项异步边界、9 项动效、14 项稳定瀑布流更新通过 |
| `node desktop/build-form.mjs` | 桌面共享页面打包通过 |
| `swift build --package-path desktop -c release` | 通过 |
| `desktop/.build/release/CaptureCoreTests` | 10 项通过；本项目核心测试是可执行目标，不使用 `swift test` |
| `/tmp/tracelo-dotnet/dotnet build desktop/windows/TraceloCapture/TraceloCapture.csproj -c Release -p:EnableWindowsTargeting=true` | Windows 交叉编译通过，0 警告、0 错误 |

首次整套检查发现旧瀑布流测试在临时时间线连接线动画结束前比较 HTML，已改为等待实际有限动画结束，保留节点身份、内容、滚动与顺序断言；随后完整布局、快捷、展示三套检查通过。

## 本轮复现并修复的边界

1. 全部展开使阅读卡片偏移超过一屏：按可见卡片锚点恢复位置，锚点上方不播放高度动画。
2. 模式切换清空新增待办文字、替换中文输入节点：保留当前编辑卡片和输入 DOM。
3. 进展／详情写入中切模式使表单重新启用：保留原表单保存闭包，防止重复提交。
4. 保存成功后焦点落到页面根、旧详情保存完成抢新卡片焦点：只对仍在当前卡的会话恢复焦点。
5. 瀑布流缩放重新插入已替换的旧卡片：保持任务身份顺序，重排时读取当前 DOM。
6. 快捷确认期间重复提交、旧成功回调关闭新会话：保存锁与会话代次保护，失败保稿和重试身份保持。

## 视觉证据与原型

使用真实组件的隔离原型：`node tests/helpers/ui-review-server.mjs` → `http://127.0.0.1:4179/?collection`。数据仅在内存测试仓，不写正式仓。

已逐张检查：[紧凑浅色](2026-09-30-presentation/compact-light.png)、[完整展示](2026-09-30-presentation/presentation-light.png)、[窄屏完整展示](2026-09-30-presentation/presentation-narrow.png)、[深色完整展示](2026-09-30-presentation/presentation-dark.png)。截图使用包含空白、长标题、长分组、长进展和多待办的边界数据。

截图反馈后的紧凑版见[单行标题与横排标签](2026-09-30-presentation/compact-spacing-light.png)：标题区由约 47px 收紧至 26px，标签区由 44px 收紧至 20px，标题下间距由 11px 改为 8px；100% 缩放下每张卡片约减少 48px 高度，最新进展仍保留两行。

此修正补充了现有显示矩阵的单行标题与标签／日期同排断言，分别复现失败后修复。重新运行 `npm run test:presentation`、78 项内容、41 项可读性、45 项布局／瀑布流检查及 `npm run build` 均通过；`git diff --check` 通过。

## 实机边界

- macOS：全新隔离 SwiftPM release 构建与真实 WebKit 冒烟通过，覆盖浅／深色、焦点、页脚、共享提交、原子写入和幂等重试。它不覆盖真实中文输入法候选、多屏、系统快捷键冲突、其他应用焦点恢复的完整人工矩阵。
- Obsidian：本轮测试使用真实插件代码与宿主边界模拟；未把新构建安装到正式 vault，所以不将此轮记作完整 Obsidian 实机验收。
- Windows：跨语言协议测试、消息桥模拟及交叉编译通过；没有 Windows 实机，尚未运行原生 WebView2 窗口。
- 拖拽沿用既有落点预览、搜索沿用定位高亮；跨区归位和图片共享元素放大明确暂缓，理由见动效说明。

`task.md` 中含完整实机要求的组合验收项继续保持未勾选。

### macOS 复核过程

既有 `desktop/.build/debug` 和 `desktop/.build/release` 的冒烟复跑均出现 20 秒 WebKit 启动超时。隔离加载当前全部资源能收到 ready，同一份原始源码直接编译及全新 SwiftPM release 均通过。失败局限于既有构建产物／运行环境，尚未确定更细根因；没有通过修改正式配置或结束已安装应用规避。

通过的干净构建命令：

```sh
swift build --package-path desktop --scratch-path /tmp/tracelo-webkit-check.deJw1V/swift-release -c release --product TraceloCapture
/tmp/tracelo-webkit-check.deJw1V/swift-release/release/TraceloCapture --smoke-test
```

原生契约复核还发现共享页面的创建成功退出缺少 macOS 要求的 `draft` 字段。已补为 `draft:null` 并加入红绿回归，确保先清稿再退出，不把已提交内容复存为草稿。
