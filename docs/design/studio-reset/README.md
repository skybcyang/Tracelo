# Tracelo 完整 UI Mockup

2026-09-29。独立设计提案，使用虚构示例数据；刷新页面恢复初始状态。

## 预览

从仓库根目录运行：

```sh
python3 -m http.server 4186 --bind 127.0.0.1 --directory docs/design
```

- [工作台](http://127.0.0.1:4186/studio-reset/?theme=light)
- [深色工作台](http://127.0.0.1:4186/studio-reset/?theme=dark)
- [四象限](http://127.0.0.1:4186/studio-reset/?theme=light&view=quadrant)
- [任务详情](http://127.0.0.1:4186/studio-reset/?theme=light&screen=detail)
- [新建任务](http://127.0.0.1:4186/studio-reset/?theme=light&screen=create)
- [快捷记录](http://127.0.0.1:4186/studio-reset/?theme=light&screen=quick)
- [搜索](http://127.0.0.1:4186/studio-reset/?theme=light&screen=search)
- [每日时间线](http://127.0.0.1:4186/studio-reset/?theme=light&page=timeline)
- [已结束](http://127.0.0.1:4186/studio-reset/?theme=light&page=archive)
- [设置](http://127.0.0.1:4186/studio-reset/?theme=light&page=settings)
- [分组管理](http://127.0.0.1:4186/studio-reset/?theme=light&screen=groups)
- [导入导出](http://127.0.0.1:4186/studio-reset/?theme=light&screen=transfer)

## 设计方向

面向每天反复查看、追加进展的个人工作台。保留 Tracelo 的任务、分组、四象限、待办、截止日期、详情、追加历史与快捷记录功能，重新组织视图和视觉体系。

本次明确解除既有蓝灰风格限制。已阅读 `design-taste-frontend`，使用其重新审视简报、统一配色、控制圆角、拒绝无目的动画和交付前检查的原则。该技能明确排除高密度产品 UI，故官网大标题、摄影、滚动叙事等规则不套入工作台；产品表单与导航由 UI/UX Pro Max 的通用可用性规则校准。

设计参数：DESIGN_VARIANCE 5 / MOTION_INTENSITY 4 / VISUAL_DENSITY 6。

- 颜色：石墨正文 `#29352f`，浅矿物灰背景 `#f5f6f5`，松绿操作色 `#356a56`，轻绿选中态 `#e3eee8`。红、琥珀仅表示紧急和截止，分组用低饱和色作辅助辨识。
- 字体：DM Sans 用于拉丁字符，中文使用系统 PingFang SC / Microsoft YaHei。字体网络不可用时回落到系统字体。
- 圆角：徽标 5px、按钮输入框 8px、任务卡片 12px、弹窗 16px；抽屉保持全高直边。
- 布局：侧栏负责导航，中央承载任务，右栏展示每日时间线。任务详情从右侧展开，固定进展输入区。窄窗口以任务／时间线切换替代挤压双栏。
- 动效：按钮按压 98% 缩放，状态悬停 160ms，弹窗入场 220ms，任务抽屉 280ms。减少动态效果偏好下全部关闭。无自动循环动画。

原界面观察：看板和时间线的核心关系有用，但重复的蓝色边框、辅助标签与同等权重的信息使阅读较重。新版用中性底色、标题和进展文本层级分开信息，历史在详情中完整保留。

参考的是 [shadcn/ui](https://ui.shadcn.com/) 的清晰组件层次、[Motion](https://motion.dev/docs/react) 的状态转换思路，以及 [Magic UI](https://magicui.design/)、[Aceternity UI](https://ui.aceternity.com/) 的组合方式；没有照搬首页特效。

## 可体验的操作

- 切换分组／四象限；筛选、排序、缩放；分组导航；拖动任务改变分组／象限。
- 新建任务：独立名称、详情、分组、四象限、截止日期、待办、初始进展、图片上传／粘贴／拖入；关闭保留会话草稿。
- 任务详情：改名、换图标、修改分组／优先级／截止日期、编辑详情、增改待办、追加进展、查完整历史。
- 完成任务（有未完成待办时确认）、异常关闭、重新打开。
- 快捷记录：选择任务、查看最近进展、录入、提交、切换到新建。
- 搜索名称、详情和历史，点击命中可定位具体记录。⌘K / Ctrl+K 搜索，N 新建，⌘Enter / Ctrl+Enter 提交，Esc 关闭。
- 分组增加、改名、排序、图标、删除后任务归入未分组。
- 示例 JSON 导出、格式检查、导入预览与同 ID 跳过。
- 深浅色、列数、详情摘要、缩放设置。

## 边界

这是原生 HTML/CSS/JS 高保真交互原型，未安装 React 或声明已接入 shadcn/Motion。Lucide 复用项目已有文件，保留原许可。没有修改生产插件、桌面程序、依赖文件或真实任务数据。

设计评审用，非功能迁移实现：真实 Obsidian 文件夹操作、存档协议、备份、目录迁移、桌面全局快捷键不接入；Markdown 在原型中以纯文本保留，图片独立预览；完整原生图标库、卡片独立展开和真实瀑布流尚未迁移。界面设计保留这些上下文，正式实施需另行映射现有功能。

所有记录只在页面内存中，刷新即重置。日期固定为 2026-09-29，用户追加记录沿演示时间递增，以保证示例时间线顺序。导出格式为 `tracelo-studio-mock-v1`，不与正式插件导出文件互通。

## 文件

- `index.html`：入口。
- `studio.css`：完整视觉、响应式与主题。
- `studio.js`：独立示例数据与交互。
- `review.html`：整套界面的截图总览（截图完成后可查看）。
- `verification.md`：实际执行的验证及限制。
