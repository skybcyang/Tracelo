# 工作台底部对齐与设置统一

2026-10-16。用户要求任务牌组贴近窗口底部、与工作侧栏底部对齐；顶栏低频操作收进设置，保留图标配文字；明确独立快捷程序也统一风格。

## 实现

- 宽窗口以牌组作为底部导航，与右侧栏共用底部 24px 留白。上方任务阅读区整体滚动，各模块保持自然内容高度；窄窗口继续上下排列，保证内容可达。
- 背景设置、背景动效收入设置；深浅外观使用设置中的既有选择器。顶栏保留截止日历、设置、工作助手、新建任务，并提供可见文字。删除旧版隐藏设置副本。
- 界面设置、背景与模型设置使用工作台的银灰／深蓝灰主题、磨砂分层、圆角控件和一致主次按钮。深色输入提示采用插件次级文字色。
- macOS／Windows 快捷程序使用共用的保存位置／快捷键设置页面，取代系统 Alert／WinForms 表单；文件夹选择、目录校验、快捷键注册与配置持久化继续交给原生层。更换快捷键失败保留原注册及输入；取消不改配置和任务草稿。macOS 在切换目录前先读取目标草稿，避免读取失败后已更换配置。

## 视觉证据

以下为当前生产组件与隔离数据，不是设计原型，也没有写入正式任务。

- [工作台：1280×900](assets/ui-polish-20261016/workbench-light.png)
- [设置：1280×900](assets/ui-polish-20261016/settings-light.png)
- [快捷程序设置：560×650 深色](assets/ui-polish-20261016/capture-settings-dark.png)

完整浅深色及两端画面保留在 `test-results/ui-polish/`。设置与快捷程序在 390／360 宽、400／320 高视口检查底部按钮可达。独立视觉评审实际查看八张浅深色截图，唯一必要反馈为深色输入提示偏暗，已修正；没有改换视觉方向。静态评审未评价动效。

## 验证与安装

前期回归曾按真实计算尺寸复现牌组底部不齐。缩放及导入导出测试改为从设置弹窗的真实入口操作，保留错误、焦点、草稿和写盘断言。原生共享设置覆盖按键录入、保存失败后重试、取消与创建草稿保留。

本轮没有提交、推送或发布新版本。Windows 本机无 .NET SDK／GUI，不能把浏览器桥接检查写为真实 Windows 验收。真实中文候选、听写、多屏和系统快捷键冲突完整矩阵仍保留原验收边界。

### 本轮结果（2026-10-16 15:10，UTC+08:00）

- 自动检查：`npm run check` 中 303 单元通过、4 项跳过（本机无 .NET SDK）；生产构建、可编辑同步、图标、完整布局、工作台前三套通过。新增展示台拖拽用例初次失败，最终单独复跑 28 项通过，见 `.local/ui-polish-stage-final.log`。没有把初次中断写成整条命令一次成功。
- 其后独立执行 `npm run test:capture`、`npm run test:presentation`、智能录入插件／桌面、工作对话／历史、`npm run test:reliability`，全部通过；完整记录分别为 `.local/ui-polish-capture-final.log`、`ui-polish-presentation.log`、`ui-polish-smart-plugin.log`、`ui-polish-smart.log`、`ui-polish-conversation.log`、`ui-polish-history.log`、`ui-polish-reliability.log`，均在 `.local/`。最终生产构建见 `.local/ui-polish-build-final.log`。
- 尺寸：1280×900 时牌组和侧栏底部均为 876px，距窗口底部 24px；1728×1080 同样对齐。浅深色和短窄窗口按钮检查通过，见 `.local/ui-polish-shots.log`、`.local/ui-polish-workbench-settled.log`。
- macOS：`swift run --package-path desktop CaptureCoreTests` 10 项通过；`bash desktop/package-macos.sh` 完成 Universal、签名及原生 WebKit 检查，含共享快捷键设置、失败保留及重试、草稿保留；安装版再次运行 `--smoke-test --screenshots` 成功。证据为 `.local/ui-polish-core.log`、`.local/ui-polish-macos-final.log`、`.local/ui-polish-installed-native.log` 及 `test-results/ui-polish/native/`。这使用隔离数据，没有创建正式任务。
- 安装：插件同步到本项目 `.obsidian/plugins/work-timeline/`；本机 `/Applications/Tracelo Capture.app` 已更新重启。安装前备份在 `.local/ui-polish-install/install-backup/`（含私人配置，不提交）；安装产物哈希、正式任务／附件字节、配置、偏好和草稿保留检查通过，见 `.local/ui-polish-install-verify-final.log`。
- 实际宿主：CUA 在 `Tracelo - WorkAssistant - Obsidian 1.14.4` 完成重载，实际截图确认牌组与工作侧栏同底线、四个顶栏操作均配文字；打开设置确认背景／动效已迁入，关闭设置返回原画面。未点击任务保存或修改正式档案。
- 真实快捷窗口：安装进程运行中，发送默认唤起组合键后 CUA 读取快捷程序返回 `timeoutReached (-10005)`，该程序也不在 CUA 应用清单中。因此实际全局快捷键、正式窗口和 Esc 焦点返回未验收，不用原生隔离冒烟代替此项。

收尾再次核对共享工作区的最新样式：生产构建、工作台与两端共享表单专项复跑通过（`.local/ui-polish-build-final.log`、`.local/ui-polish-workbench-final.log`、`.local/ui-polish-capture-shell-final.log`），再次安装并核对哈希和数据保留。实际宿主最后重载并打开 Tracelo，确认插件启用、任务阅读区／牌组／工作侧栏及收紧后的顶栏均存在。
