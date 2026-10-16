# 风格候选检查

执行时间：2026-10-15 19:51–19:55（Asia/Shanghai）。这是候选 HTML 的检查，不是生产插件验收。

- 已运行 oil-ui `shoot.mjs`，三个候选分别检查 1280×900 和 800×650。结果：无控制台错误、页面横向溢出和失败图片；报告见 `shots/tactile-final/report.json`、`shots/editorial-final/report.json`、`shots/pearl-final/report.json`。
- 已查看三个方向的桌面截图、三个窄窗口截图，以及触感方案最终着色截图。窄窗口标题／进展按两行紧凑策略截断，宋体方案可见字数更少，属于已知设计取舍；未验证展开后完整正文。
- 已在 Codex 浏览器手动打开触感方案第一张卡，输入中文文字，观察输入区域原位出现且右侧对话仍保留。截图工具的 `shots/expanded/page.png` 实际仍为收起态，因此该图不作为展开／输入证据；交互结论仅依据上述浏览器操作与当时观察。这里的输入不是中文 IME 候选窗验证。
- 初次截图的唯一加载错误是 favicon.ico 404。增加空 favicon 后上述复查通过；初次报告保留在不带 `-final` 的目录。
- 对比页用官方生成器成功组装，内嵌候选和基线，可离线打开。预览服务返回 HTTP 200：`http://127.0.0.1:5687/style-explorer.html`。
- 未运行产品测试／生产构建／安装；本轮没有产品代码改动。未检查深色、四象限、展示模式、真实 Obsidian、macOS／Windows 快捷工具，未验证完整动画与全部无障碍行为。未进行独立评审或评分。

重新打开本机预览：在仓库根运行 `python3 -m http.server 5687 --bind 127.0.0.1 --directory docs/design/style-research-20261015`，再访问上述地址。也可直接打开同目录 `style-explorer.html`，无需网络。
