# 快捷进展原型

当前方向：记录进展使用插件原展开卡片；新建任务保留原共享表单的字段、顺序和四象限结构，使用 `create-card.css` 套用卡片的背景、字号、边框及控件样式。两个入口宽度均为 600 px。只改 mockup，不改生产插件或桌面工具。

从仓库根目录生成原型：

```sh
node docs/design/quick-progress/build.mjs
python3 -m http.server 4178 --bind 127.0.0.1 --directory docs/design/quick-progress
```

打开 `http://127.0.0.1:4178/`，或通过 `?mode=create` 直接查看新建页。`mock-entry.mjs` 调用真实插件组件，借用现有浏览器测试宿主，将所有存档写入内存 Map。刷新即恢复示例数据。

`mock.js`、`shared.css` 是构建产物。`lucide.min.js` 来自 Lucide 0.468.0 的 UMD 发行文件，用于渲染与 Obsidian 相同的图标，文件内保留其 ISC 许可头。

验证范围见 `design-qa.md`，预览见 `preview.png`。
