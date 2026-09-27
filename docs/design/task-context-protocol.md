# 任务上下文与跨端存档协议

本轮开发继续使用 `work-timeline-task:v1`。`src/archive.ts` 的 `serializeTaskMarkdown` 与 `parseTaskMarkdown` 是协议真值；外部工具只能新增正式任务，不得改写既有任务。

## 可选字段

| 字段 | 含义 | 旧数据默认值 |
| --- | --- | --- |
| `WorkTask.notes` | 原样保存的 Markdown 备注，支持文字与图片链接交错 | 无备注 |
| `WorkTask.icon` | Obsidian 图标名称；`null` 表示隐藏；缺省继承分组 | 继承分组 |
| `WorkGroup.icon` | 同组卡片的默认图标 | `circle-dot` |
| `PluginState.noteDrafts` | 按任务 ID 保存的未提交备注，空字符串也是有效草稿 | 空记录 |
| `PluginState.boardZoom` | 看板缩放百分比，60～120，步长 5 | 100 |
| `PluginState.presentationMode` | 完整显示卡片信息，编辑输入单独开启 | false |

更新备注追加 `notes_changed`，更新图标追加 `icon_changed`，均属于属性变更。备注事件记录修改前后文本；清空备注删除当前 `notes` 字段，但保留变更历史。不添加 `progress`，不改变最近进展时间，不自动置顶。搜索匹配当前备注，历史备注不会继续作为当前上下文被搜出。

## Markdown 投影

非空备注在任务属性之后、待办与时间线之前写入：

```markdown
## 备注

背景说明

![截图](image-唯一标识.png)

后续说明
```

内容保留空行、图片插入顺序和 Markdown 换行所需的尾随空格。备注图片与正式 MD 位于同一任务目录，使用相对文件名引用，目录整体移动和任务改名时无需重写该引用。无备注的旧任务不增加空正文区，保持原始序列化兼容。

## 桌面快捷创建约定

第一行去掉首尾空白后作为标题，后续行作为备注，不生成初始进展。默认未分组、不重要不紧急。创建事件保留 ISO 时间、本地日期、时区与偏移；任务 ID 和事件 ID 使用不同的唯一标识。

文件为 `<archiveName 或 task.id>.md`。首部 JSON 必须采用 `JSON.stringify(value, null, 2)` 等价表示，接续完全相同的 Markdown 投影；解析器会重序列化全文并逐字比较。UTF-8、LF、中文与斜线不额外转义，JSON 字符串中的控制字符按 JSON 规则转义。仅写普通 Markdown 不会被接受。

桌面实现和兼容性样例见 `desktop/`。发布前先在目标目录完整写入临时文件，再以不覆盖已有文件的原子操作发布正式文件。插件按 ID 去重并验证存档，再登记路径、备份和刷新视图。

## 验证边界

单元测试覆盖上下文变更、旧 v1 兼容、正文一致性、偏好校验与跨语言存档。浏览器夹具验证插件渲染和交互，不能替代真实 Obsidian 的 Markdown／附件行为，也不能替代 macOS 输入法、快捷键冲突、多屏和焦点恢复的实机验证。
