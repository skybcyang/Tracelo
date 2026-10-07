# 一句话录入 · 电脑端（0.9.5 起）

更新于 2026-10-07。0.9.5 支持桌面 Obsidian、独立 macOS 菜单栏和 Windows 托盘的一句话录入，以及直接输入 API Key、连接测试、草稿替换保护与恢复、原生模型请求和离线进展回执。快捷工具沿用新建／进展的内容区与按钮样式，不叠出另一层创建表单。历史安装和验收见[首次验收](validation/2026-10-04-smart-capture.md)、[改进验收](validation/2026-10-06-smart-capture-improvements.md)和[一致性修复](validation/2026-10-06-agents-consistency.md)。手机及人生工作台已拆至同级 Herein。

## 使用

1. 安装 0.9.5 或更新版本的插件和配套桌面工具；开发者也可运行 `npm run build` 安装构建产物。保留已有 `data.json` 和任务目录。
2. 打开 Tracelo，点击“新建任务”，切换到“一句话整理”；命令面板“Tracelo: 一句话创建任务”也会打开新建页的这一输入方式。
3. 点击“模型设置”，填写服务地址、模型名称，并直接粘贴 API Key（仅密钥本身）。输入框默认隐藏，可用眼睛按钮显示／隐藏。可先“测试连接”，再“保存设置”。测试只发送固定的虚构句子，不发送当前草稿，可能产生少量调用费用。默认开发测试使用 `https://api.kimi.com/coding/v1`、`kimi-for-coding`。旧文件配置仍可使用；输入新 Key 保存后清除旧路径，不再依赖文件，留空则保留旧配置。
4. 输入描述，或在输入框里使用电脑系统听写；点击“整理成任务”进入现有创建表单，检查并编辑名称、分组、日期、象限、待办和首条进展，再点“创建任务”。可“返回原文”，再“查看整理结果”，人工修改仍保留；重新整理前需确认替换。
5. 对已有任务，在卡片菜单中选择“一句话记录进展”。输入这次进展，检查整理后的文字及建议完成的待办，再点“保存进展”。不会自动结束整个任务。

独立快捷工具先设置 vault 和任务目录，再在“新建任务”里选择“一句话整理”；“记录进展”选中任务后直接输入并保存，不提供单独的 AI 整理入口。2026-10-07 同版本更新移除了快捷程序的“一句话记录进展”；Obsidian 任务菜单中的该功能继续保留。首次打开会尝试读取该 vault 的插件模型配置，之后在工具内单独保存配置。工具和插件的草稿互相独立，均按任务位置隔离。

顶栏仅保留“新建任务／记录进展”；新建内部的“手动填写／一句话整理”在当前内容区切换，各自草稿互不覆盖。一句话切出前等待草稿写盘；失败时停留并保留输入，中文组合输入与正式保存期间不切走。模型设置仍单独弹出，关闭后回到当前输入页面。

服务地址可以填写 API 根地址，也可填写完整 `/chat/completions` 路径。仅支持 HTTPS Chat Completions 兼容服务；凭证格式支持不等于所有模型厂商都已实测，当前真实服务验证为 Kimi Code。

新建示例：

> 明天前完成相机启动慢的问题排查，放到相机项目，重要且紧急。先抓日志，再分析耗时，最后验证修改。现在已经复现了。

后续进展示例：

> 日志已经抓完，发现初始化耗时比较高，接下来分析原因。

模型设置支持 HTTPS Chat Completions 兼容接口。服务地址与密钥必须配套。Kimi Code 和 Kimi 开放平台的账号、额度和服务地址不是同一套；当前已用真实 Tracelo User-Agent 验证 Kimi Code 调用成功，正式产品接入应按供应商的适用服务配置。参见 [Kimi 官方说明](https://www.kimi.com/code/docs/)。

## 保存与边界

- 模型只生成建议；确认前不写正式任务。分组、日期、字段类型和待办 ID 会在本地校验。分组在确认期间被删除、待办被移除、任务结束或任务目录变化时，停止写入并保留草稿。
- 新建只发送当前描述、分组 ID/名称、当前日期及时区。进展只发送描述、所选任务的 ID/标题/待办、日期及时区，不发送整个仓库、历史进展或图片。
- 原文与确认表单按仓库／任务目录／目标任务保存到插件草稿，关闭后恢复。模型失败、取消、保存失败时保留输入。取消后忽略迟到响应；底层请求可能继续计费，当前宿主网络 API 不提供中断。
- 修改原文不会清除已经编辑的确认结果；重新整理前需要确认替换，成功后可“恢复上一版结果”。“放弃草稿”需再次确认。关闭会等待草稿写盘；失败时保持编辑器打开并提示重试。
- 独立工具在共享 WebView 表单中输入密钥，HTTP 请求与配置持久保存由 Swift／C# 宿主执行。macOS 配置和草稿在现有 Application Support 的 Drafts 中，Windows 在设置文件旁的 SmartCapture 目录，均使用原子替换写入。
- 独立工具可以直接创建新任务；既有任务的直接进展和待办更新先持久排队，显示“已暂存，等待 Obsidian 写入”。收到插件成功回执后才清除草稿；等待期间防止重复提交。旧版已排队的 `smart_progress` 操作仍兼容处理，不因入口移除丢弃请求或草稿。
- 新建复用稳定 creationId；进展把文字和待办更新作为一个任务快照保存，并将操作签名写入历史以防重复提交。
- 未明确的日期留空；未知分组不自动创建；未明确的优先级使用现有默认值，并提示检查。模型语义仍可能出错，需要确认。
- 一次处理一个新任务，或给一个明确选中的任务记录进展。跨任务自动匹配、多任务拆分、无需确认的自动保存、定时提醒、独立麦克风录音入口尚未实现。语音输入目前依赖系统听写，未测试真实麦克风识别效果。
- 不配置模型时，原有离线任务操作仍可使用。API Key 以普通本机配置保存：插件在 `data.json` 的模型配置内，快捷工具在按工作目录隔离的配置内；不写入任务或请求正文，不代表系统钥匙串加密。不要公开包含凭证的配置和备份；同步插件配置时也会同步其中的 Key。

## 实现入口

- `src/smart-capture.ts`：请求、提示词、JSON 校验、日期上下文、进展幂等更新。无文件或网络宿主依赖，可作为鸿蒙接入时的协议与测试依据；ArkTS 仍需按平台类型限制适配。
- `src/smart-capture-modal.ts`：原文、提取状态、编辑确认、草稿、模型设置。
- `src/main.ts`：桌面密钥读取、Obsidian 网络适配与现有任务存档接口。
- `src/desktop-smart-capture.ts`：共享确认表单、原生请求桥接、稳定创建重试、离线进展回执。
- `desktop/Sources/CaptureCore/SmartCaptureTransport.swift` 与 `desktop/windows/CaptureCore/SmartCaptureTransport.cs`：原生密钥和网络适配。
- `src/archive.ts`：保存服务地址、模型、API Key 和草稿；兼容读取旧密钥路径。

## 验证

```sh
npm run check
npm run test:smart
# 显式运行才调用真实模型，仅发送脚本内的虚构例句：
npm run test:smart:live -- /absolute/path/to/kimi-api-key.md
# macOS：独立 Obsidian 配置目录和临时 vault，不打开个人仓库
node tests/smart-capture.native.mjs /absolute/path/to/kimi-api-key.md
# macOS 独立菜单栏工具：临时 vault／独立偏好域，真实模型调用
node desktop/build-form.mjs
swift build --package-path desktop --product TraceloCapture
desktop/.build/debug/TraceloCapture --smart-smoke-test --key-file /absolute/path/to/kimi-api-key.md --screenshots test-results/smart-capture/native-smart
```

可通过 `TRACELO_AI_BASE_URL` 和 `TRACELO_AI_MODEL` 切换两个真实测试脚本的服务配置。真实调用不纳入日常回归或 CI。鸿蒙工程与测试已迁至 Herein，不再参与本项目 Vitest；请在 Herein 根目录运行 `npm test`。

测试覆盖模型拒绝/错误响应、超时、非法日期/分组/待办、直接输入及隐藏密钥、旧配置兼容、取消请求、原文与编辑草稿恢复、写入失败重试、重复提交、深浅色与窄窗口。独立 Obsidian 的真实 Kimi → 确认 → Markdown 存档流程为显式运行的测试，历史结果见[验收记录](validation/2026-10-04-smart-capture.md)，不代表每轮重新调用真实模型。截图在 `test-results/smart-capture/`。
