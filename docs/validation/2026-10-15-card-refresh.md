# 2026-10-15 卡片前端优化

## 范围

依据用户本轮实际反馈优化卡片的阅读层级、表面、记录入口和保存反馈，设计说明见[卡片优化](../design/card-refresh.md)。在现有 `main` 工作区保留全部既有修改与同期 HTTP 模型支持；本轮产品修改集中于 `src/task-card.ts` 和 `styles.css`，没有改正式任务或存档协议。版本仍为 0.9.7 本地开发版，没有提交、推送或发布。

## 检查

以下时间为 2026-10-15，时区 +08:00；日志位于 `.local/card-refresh-20261015/`。

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| `npm run build` | 19:30 通过，类型及生产构建 | `build.log` |
| `npm run test:layout` | 19:34 完整通过；含五主题／明暗、分组／四象限、尺寸／缩放、瀑布流、交互、历史与草稿 | `layout.log` |
| `npm run test:presentation` | 19:31 通过，含100卡阅读锚点、快速切换、输入节点和真实写入后的反馈 | `presentation.log` |
| `npm run test:capture` | 19:32 通过，共享表单、图片、快捷进展及保存／失败状态 | `capture.log` |
| 最终快捷样式定向复验 | 快捷进展及反馈两套通过 | `quick-final.log` |
| `bash desktop/package-macos.sh` | Universal 双架构、签名及真实 WebKit 表单冒烟通过 | `macos-package.log` |
| 安装版原生冒烟 | 19:37 通过，共享创建表单、浅／深色、焦点、原子写入及稳定重试；使用隔离目录 | `installed-smoke.log` |
| 真实项目 Obsidian | 19:36 重载后确认标题14px／正文12px、图标入口、原位展开／收起、日历和对话；16张已有任务，无正式写入 | `live-host.json`、`installed-board.png`、`installed-expanded.png` |
| 安装与数据保护 | 插件三件套及应用逐文件哈希一致，正式任务／附件、配置、快捷程序偏好与草稿保留 | `install-before.json`、`install-after.json` |
| 系统快捷键 | 19:37 现有新建／进展快捷键唤起 Capture，Esc 恢复 Codex 前台；没有文字录入 | `focus-after.json` |

首轮布局检查发现选中边框被调淡，与既有明确主题色约束不符；已恢复原选中色并重跑完整布局套件。人工看图发现两行截断区的底部 padding 露出第三行边缘，改用保留空间的底边避免漏字，没有放松测试断言。最终保存提示仅在底部出现，不额外染色正文。

## 视觉证据

截图使用当前生产组件与隔离的内存任务夹具，不是设计稿。主 Agent 已查看原图、深浅色、展开、700×560短窗口、快捷进展及真实安装画面。证据在 `test-results/card-refresh/`：

- `before/page.png` 与 `after/page.png`：1440×900 前后对照。
- `dark/page.png`、`expanded/page-1440x900.png`、`expanded/page-700x560.png`、`zoom/page-@2x.png`：明暗、展开、短窗口和2倍渲染。2倍截图不是系统文字缩放验收。
- `capture/page.png`：最终快捷进展阅读区域。
- `motion-final/`：从记录入口展开、输入、保存到真实夹具回执的连续帧与开始／中间／结束图。最终36帧，无 ffmpeg，未生成视频或测帧率。早期 `motion/` 的选择器解析有误，未触发保存，不能用作保存成功证据。

本轮为局部卡片深化，由主 Agent 自检，未做独立设计评审。没有测量用户长期推进意愿的变化，不能把主观目标记为已通过。

## 安装

安装前备份至 `.local/card-refresh-20261015/install-backup/`，含原插件、正式任务及附件、macOS App、配置和草稿；其中可能含凭证，只留本机。恢复说明见该目录 `RESTORE.md`，不能覆盖后续编辑。

已安装本项目 `.obsidian/plugins/work-timeline/` 的 `main.js`、`styles.css`、`manifest.json`；已替换并重启 `/Applications/Tracelo Capture.app`。真实 Obsidian 重载后恢复普通启动，安装后再次检查文件哈希与数据保留。包含同期完成的 HTTP 模型支持，没有回退另一对话的工作。

Windows 原生运行、真实中文候选、多屏／全屏、系统缩放与听写未在本轮复验，保留[现有人工边界](../../task.md#既有人工验收边界)。本轮执行相关套件，未额外重复全部 `npm run check`。
