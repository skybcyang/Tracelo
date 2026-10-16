# 2026-10-15 · 自建 HTTP 模型服务

## 需求与实现

用户要求模型设置同时支持使用 HTTP 的自建服务器。原实现的 TypeScript、Swift、C# 地址校验均限定 HTTPS，设置页和说明也写成仅 HTTPS。

本轮统一允许 HTTP／HTTPS Chat Completions 兼容接口，保留自定义端口、API 子路径、完整 `/chat/completions` 路径与末尾斜杠规范化。仍拒绝其他协议及携带账号、密码、查询参数或片段的地址。插件一句话整理与工作对话共用此请求校验；macOS／Windows 快捷工具共用设置页，并同步修改原生请求校验。没有增加确认开关，没有更改用户已保存的地址或密钥。

基于已有未提交改动继续开发，保留并行工作，包括期间更新的卡片／样式；未提交、推送或发布，版本仍为 0.9.7 本地开发构建。

## 本轮验证

执行日期为 2026-10-15，以下时间为 +08:00。本轮只用固定虚构输入与测试凭证调用本机 HTTP 夹具，不调用用户模型，不把正式任务发送给夹具。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 先复现再修复 | 19:28 新增四种 HTTP 地址的 TS 请求回归均被原 HTTPS 校验拒绝；Swift 同样在地址校验处失败；修复后通过 | `.local/http-model-20261015/red-ts.log`、`red-swift.log`、`smart.log`、`swift-core.log` |
| `npm run test:smart` | 25 项单元通过；插件及 macOS／Windows 模拟桥接的设置连接测试、HTTP 地址保存、原文／草稿保护通过 | `.local/http-model-20261015/smart.log`；`tests/smart-capture.test.ts`、`tests/smart-capture.browser.mjs`、`tests/smart-desktop.browser.mjs` |
| `npm test` | 19:28 开始，147 项通过，2 项因缺少 .NET SDK 跳过 | `.local/http-model-20261015/unit.log` |
| `npm run build` | 类型检查及生产构建通过 | `.local/http-model-20261015/build.log` |
| Swift 核心／macOS 打包 | 10 项核心通过；Universal 两架构、签名、真实 WebKit 深浅色与原子发布／重试通过 | `.local/http-model-20261015/swift-core.log`、`macos-package-final.log` |
| 安装版真实 Obsidian HTTP 请求 | 重新加载本项目插件，通过 `extractSmartCapture → requestUrl → 本机 HTTP 服务`，校验 POST、端口、子路径、Bearer 与返回解析；固定虚构上下文，没有正式保存；实际设置页已查看截图 | `.local/http-model-20261015/plugin-http.json`、`installed-settings.png` |
| 安装版真实 macOS HTTP 请求 | 安装应用 `--smart-smoke-test`，真实 WebKit → Swift URLSession → 本机非回环接口 HTTP 服务；临时隔离 vault 中完成提取／确认创建／直接进展暂存与草稿保留 | `.local/http-model-20261015/native-http.json`、`native-http.log`、`native-http/` |
| 本地安装与数据保护 | 插件三件套与最终构建哈希一致，安装 app 与最终构建逐文件一致；正式任务／附件、插件配置／草稿、Capture 偏好／草稿保留；进程重启 | `.local/http-model-20261015/install-before.json`、`install-after.json` |
| 系统快捷键与 Esc | 19:33 实际配置的两个快捷键均激活安装 app，Esc 返回原 Obsidian 前台；没有输入文字或保存任务 | `.local/http-model-20261015/focus-after.json` |

地址回归覆盖 localhost、局域网 IPv4、自建域名、IPv6、自定义端口与子路径，以及 HTTP 完整接口路径不重复追加后缀。Windows C# 同步新增等价用例，但本机没有 .NET SDK／Windows 设备，本轮未执行 C# 编译及 Windows 原生请求；浏览器模拟 Windows 桥接通过不能替代它们。

环境边界：第一次 Obsidian 请求使用自动选中的虚拟网卡地址时超时；随后改用明确回环地址通过，未修改产品请求实现来规避。macOS URLSession 向该非回环地址通过。此差异的网络／代理根因未定位，不宣称任意网络环境都可达；保留原失败证据 `.local/http-model-20261015/plugin-http-virtual-ip-failed.json`。

## 安装与恢复

最终安装目标为本项目 `.obsidian/plugins/work-timeline/` 和 `/Applications/Tracelo Capture.app`。插件已在真实 WorkAssistant vault 重载，快捷工具已重启，最终 HTTP 请求在安装产物上通过；Obsidian 调试进程退出后恢复普通启动。

安装前备份位于 `.local/http-model-20261015/install-backup/`，含原插件、任务与附件、app、偏好和草稿，恢复说明为其中 `RESTORE.md`。此目录可能含凭证，只留本机、不上传。并行工作期间源码产物发生变化后，重新同步最终插件和配套 app，再核对哈希与数据保留。

只复验本轮地址／模型设置与必要原生安装链路，未重复整套布局及人工输入法／多屏矩阵。实际用户自建模型未提供，本轮通过的是确定性 HTTP 服务，不能作为其模型语义、可用性或兼容性验收。
