# 任务上下文与跨端存档协议

继续使用 `work-timeline-task:v1`。`src/archive.ts` 的 `serializeTaskMarkdown` 与 `parseTaskMarkdown` 是协议真值；外部工具可以新增正式任务，修改既有任务须提交下述命令，由插件串行应用，不能覆盖旧任务快照。

## 可选字段

| 字段 | 含义 | 旧数据默认值 |
| --- | --- | --- |
| `WorkTask.notes` | 原样保存的 Markdown 详情，支持文字与图片链接交错 | 无详情 |
| `WorkTask.icon` | `noto:<name>` 彩色图标标识，兼容旧 Obsidian/Lucide 名称；`null` 表示隐藏；缺省继承分组 | 继承分组 |
| `WorkGroup.icon` | 同组卡片的默认图标 | `circle-dot` |
| `PluginState.noteDrafts` | 按任务 ID 保存的未提交备注，空字符串也是有效草稿 | 空记录 |
| `PluginState.boardZoom` | 看板缩放百分比，60～120，步长 5 | 100 |
| `PluginState.cardLayout` | 顶部对齐 `aligned`／稳定瀑布流 `masonry` | `aligned` |
| `PluginState.theme` | `evergreen`／`graphite`／`glacier`／`vermilion` | `evergreen` |
| `PluginState.appearance` | `system`／`light`／`dark` | `system` |
| `PluginState.compactCards` | 收起卡片隐藏详情与待办 | false |
| `PluginState.quickDrafts` | 按任务 ID 保存的快捷进展草稿 | 空记录 |

`presentationMode` 已在 0.9.0 移除；旧偏好或导入包中的该字段忽略。

图标选择器仅提供随包内置的 Noto Emoji（`@iconify-json/noto` 1.2.9，3,729 个非隐藏图标）。旧 `circle-dot` 默认显示为 `noto:bookmark-tabs`，常见旧名称映射到语义对应的 Noto 图标，无法匹配时使用默认图标。映射只发生在渲染层，不批量改写任务或追加历史。插件卡片与桌面快捷卡片共用渲染器，不需要联网。仅对常用图标提供中文标签，其余可按英文名称搜索。

更新备注追加 `notes_changed`，更新图标追加 `icon_changed`，均属于属性变更。备注事件记录修改前后文本；清空备注删除当前 `notes` 字段，但保留变更历史。不添加 `progress`，不改变最近进展时间，不自动置顶。搜索匹配当前备注，历史备注不会继续作为当前上下文被搜出。

## Markdown 投影

非空详情在任务属性之后、待办与时间线之前写入；内部字段仍为 `notes`，兼容读取旧 `## 备注` 正文：

```markdown
## 详情

背景说明

![截图](image-唯一标识.png)

后续说明
```

内容保留空行、图片插入顺序和 Markdown 换行所需的尾随空格。备注图片与正式 MD 位于同一任务目录，使用相对文件名引用，目录整体移动和任务改名时无需重写该引用。无备注的旧任务不增加空正文区，保持原始序列化兼容。

## 桌面快捷创建约定

桌面与插件共用完整创建表单；名称、详情、分组、象限、待办、截止日与初始进展分别传入领域模型。默认未分组、不重要不紧急。旧的一段式草稿迁移时第一行为标题，其余为详情。创建事件保留 ISO 时间、本地日期、时区与偏移；任务 ID 和事件 ID 使用不同的唯一标识。

文件为 `<archiveName 或 task.id>.md`。首部 JSON 必须采用 `JSON.stringify(value, null, 2)` 等价表示，接续完全相同的 Markdown 投影；解析器会重序列化全文并逐字比较。UTF-8、LF、中文与斜线不额外转义，JSON 字符串中的控制字符按 JSON 规则转义。仅写普通 Markdown 不会被接受。

桌面实现和兼容性样例见 `desktop/`。发布前先在目标目录完整写入临时文件，再以不覆盖已有文件的原子操作发布正式文件。插件按 ID 去重并验证存档，再登记路径、备份和刷新视图。

## 快捷修改命令 v1（尚未发布）

桌面读取当前目录的正式 Markdown，以稳定任务 ID 选定任务。写入 `<任务目录>/.tracelo-operations/quick-<32位十六进制>.request.json`，字段为 `version: 1`、`id`、`taskId`、`kind` 及操作参数。原生宿主完整写入并同步临时文件，再原子发布请求；同 ID 不同内容拒绝写入。

`src/quick-operations.ts` 定义命令：进展、待办增删改／勾选／恢复、改名、详情、截止日、分组、象限、图标、完成、关闭与重开。插件与自身卡片修改共用写入队列，按当前任务状态调用领域函数，追加事件并保存完整历史。事件保存命令 ID 与内容签名，回执丢失后重复处理不会追加第二次；身份冲突报错。结束任务不能直接追加进展。

结果写入同名 `.result.json`，`status` 为 `applied` 或 `failed`，另含 `version`、`id`、`message`。没有结果表示 `queued`，桌面显示“已暂存，打开 Obsidian 后写入任务”。只有 `applied` 才清除相应进展草稿并收起；失败保留输入。重试只移除对应失败回执，保留原请求。当前实现保留命令／回执文件用于恢复，不自动清理。

这是当前仓库内插件为单写入者的协议，不提供多设备同时运行插件的分布式锁。同步软件造成的跨设备并发冲突仍需通过现有存档保护处理；桌面不会把缓存的任务快照覆盖回磁盘。

图文进展使用 `attachments: [{ name, base64, sha256? }]`。插件校验文件名、容量与摘要后，以稳定名称保存附件，再写入事件；事件签名只保留名称和 SHA-256，不保存 Base64。重试校验已有字节并复用同一命令 ID，回执丢失不重复追加进展。

## 桌面显示偏好（尚未发布）

插件把 `{ version: 1, theme, appearance }` 写入 `<任务目录>/.tracelo-ui.json`，macOS 与 Windows 宿主读取后交给共享表单。此文件仅为显示偏好投影，不是正式任务，不进入任务历史；源偏好仍由插件数据保存。未知主题回退 `evergreen`，未知外观回退 `system`，不修改图文草稿或进展队列。

## 创建前图片

草稿存储 `id/name/type/data/state`，正文以 `tracelo-draft:<id>` 临时引用；正式提交时替换为相对 `image-<id>.<扩展名>`。PNG、JPEG、WebP、GIF、BMP 经宿主解码验证，每张最多 10 MB，草稿含撤销保留图片合计最多 40 MB。不下载普通 URL，不执行内嵌 HTML。

插件将图片与 Markdown 写入自有备份暂存目录，校验后整体移动到任务目录；桌面在目标目录内暂存并整体发布图片任务文件夹。只有所有字节校验及发布成功才清空草稿。故障清理仅删除本次自有暂存文件；用户原图不变。处理过程异常退出的图片恢复为可重试失败状态，无法恢复的字节需重新添加。

插件新建草稿按 App／任务目录保留到本次 vault 会话结束。macOS 图文与进展草稿保存在 Application Support 的作用域文件；Windows 保存在本地设置的作用域记录。图片字节与文字同存，不依赖临时预览 URL。退出前尚在处理的图片要求先处理完成。

## 验证边界

单元测试覆盖上下文变更、旧 v1 兼容、正文一致性、偏好校验与跨语言存档。浏览器夹具验证插件渲染和交互，不能替代真实 Obsidian 的 Markdown／附件行为，也不能替代 macOS 输入法、快捷键冲突、多屏和焦点恢复的实机验证。
