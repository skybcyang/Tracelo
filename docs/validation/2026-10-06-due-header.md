# 移除顶部今日截止按钮

用户决定：侧边栏已有截止提示，顶部不再重复提供“今天截止”按钮。

已移除顶部按钮及其专用筛选状态、空态与样式；保留侧边栏当日截止列表、卡片日期提示和截止日历。同步需求与 AGENTS.md，更新现有顶栏及展示模式检查的控件顺序。

验证通过：生产构建、顶栏导航（日夜主题与九种宽度）、截止日历、展示模式、搜索导航。已检查当前渲染截图 `test-results/due-header/header-1440.png`；真实 Obsidian 重载后，顶部仅保留展示模式、管理分组、新建任务，侧边栏仍显示“当日截止 · 4”。本次小改未重跑全套回归。

插件已安装到 `/Users/skybcyang/SkybcWork/projects/WorkAssistant/.obsidian/plugins/work-timeline/` 并重载，三件套哈希与最终构建一致。macOS 快捷程序 Universal 打包、签名与原生冒烟通过，已更新 `/Applications/Tracelo Capture.app` 并重启，核对创建及记录进展入口。

安装前备份：`/Users/skybcyang/Library/Application Support/TraceloCapture/Backups/due-header-20261006-7R4gwM/`，包含插件／配置、任务、应用、草稿和偏好。安装后 18 个任务目录文件的哈希及插件配置完全不变。

- main.js SHA-256：`30b921c5bd2c3b88431865d411a88be4420f02154f70738a45bd0139c9259f18`
- styles.css SHA-256：`1631358555d0070c7fa51553b734469747b784d755d76b5e2e0eb180d2de50c4`

未提交、推送或发布；本轮未做 Windows 实机验证。
