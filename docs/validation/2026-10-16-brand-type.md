# 品牌、字体与操作图标适配

执行日期：2026-10-16，完成核对时间为 15:24（Asia/Shanghai）。用户确认按银灰玻璃工作台的方向适配品牌和界面；设计规则见[品牌与字体](../design/brand-type.md)。

## 改动范围

- 品牌由黑底改为半透明中性银灰底，保留 T 与轨迹点，减轻边框及内部笔画；浅深色分别保持对比。
- Tracelo 字标减重、调整字距及图标比例；界面使用共享字体／字重 token，保留宿主界面字体偏好及正常正文重量。
- 共用操作图标统一线宽、圆头和圆角连接；高对比度偏好加强线条。快捷工具同步相同品牌与文字层级。
- 在 `codex/stage-interaction-parity` 的现有未提交工作上进行局部修改，已有设置、布局、待办及原生修改全部保留。没有提交、推送、改版本或发布。

## 本轮检查

| 检查 | 结果与范围 | 本机证据 |
| --- | --- | --- |
| `npm run build` | 通过类型检查与生产构建 | `.local/brand-adaptation-20261016/build.log` |
| `npm run check` | 完整执行通过：303项单元通过，4项.NET相关检查因缺少SDK跳过；包含图标、布局、工作台、共享表单、展示、智能录入、对话与可靠性浏览器套件 | `.local/brand-adaptation-20261016/check.log` |
| 当前生产组件截图和尺寸 | 五种主题×浅深色，品牌颜色中性且操作图标线宽一致；1728、1280、800、390宽未发现横向溢出。已实际看过浅深色、窄窗、快捷表单截图 | `.local/brand-adaptation-20261016/inspection.json` |
| 补充可读性核对 | 高对比度浅深色线条增强、宿主自定义字体保留、深色宿主下显式浅色外观通过 | `.local/brand-adaptation-20261016/accessibility.json` |
| `bash desktop/package-macos.sh` | Universal双架构、严格签名、实际WebKit浅深色及表单／幂等提交冒烟通过；最终资源重新打包 | `.local/brand-adaptation-20261016/macos-package-final.log` |
| 安装版原生冒烟 | `/Applications/Tracelo Capture.app` 的实际WebKit检查通过，已看过隔离原生截图 | `.local/brand-adaptation-20261016/installed-native.log` |
| 安装哈希及保留数据 | 插件三件套与应用文件哈希一致；重载后复核正式任务／附件、配置、插件草稿、快捷偏好与草稿均保留 | `.local/brand-adaptation-20261016/install-verify-final.log` |

截图使用隔离夹具和合成任务，不是旧设计稿：[浅色工作台](assets/brand-adaptation/workbench-light.png)、[深色工作台](assets/brand-adaptation/workbench-dark.png)、[窄窗口](assets/brand-adaptation/workbench-narrow.png)、[快捷表单](assets/brand-adaptation/capture-dark.png)、[原生WebKit浅色](assets/brand-adaptation/native-light.png)。

## 安装与实机

已备份并安装到本项目 vault 的 `.obsidian/plugins/work-timeline/`，同步 `main.js`、`styles.css`、`manifest.json`。本机 `/Applications/Tracelo Capture.app` 已更新、重启且确认进程运行。安装前的插件、正式任务目录、应用、偏好与草稿备份在 `.local/brand-adaptation-20261016/install/install-backup/`；含私人配置，不上传，恢复时不得覆盖后续编辑。

通过本轮 CUA 在实际 WorkAssistant／Obsidian 1.14.4 窗口重载并打开 Tracelo，截图确认银灰品牌、字标和操作图标已生效。仅打开工作台阅读，没有输入／保存正式任务。含正式内容的宿主截图未复制入仓。

创建全局快捷键已发出，但 CUA 获取实际快捷程序窗口返回 `timeoutReached (-10005)`，因此实体快捷键、正式快捷窗口交互与 Esc 焦点返回仍为 **not_run**，不以安装版隔离冒烟替代。Windows原生GUI、真实中文候选窗、全设备缩放／多屏矩阵未运行；浏览器Windows桥接通过只证明共享页面行为。
