# 0.9.5 同版本更新验证

用户于 2026-10-07 确认移除快捷程序的“一句话记录进展”，并明确要求覆盖现有 0.9.5 Release。范围只涉及快捷进展入口、相关检查与说明；新建的一句话整理和 Obsidian 任务菜单的进展整理继续保留，旧版请求与草稿不清理。

## 本地验证

先在快捷进展检查中断言移除入口，观察旧实现因仍有一个按钮而失败；移除共用入口后通过。macOS／Windows 共享页面的 AI 新建、直接进展、草稿隔离和短窗口操作通过；快捷队列与写入回执、失败重试、减弱动效检查通过，生产类型检查与构建通过。

原生真实模型 QA 改为“一句话创建＋直接记录进展”，不再点击被移除的入口；本轮不调用真实模型、不读取真实密钥，不在正式任务上测试写入。

## 远端验证

- 发布提交：`6393c15c5d84f17920cb2b96803e0347c9859385`。
- [候选运行 37604471507](https://github.com/skybcyang/Tracelo/actions/runs/37604471507)：plugin、macos、windows 全部成功，publish 按设计跳过。插件执行完整 `npm run check`，macOS／Windows 执行原生构建与冒烟。
- 远端主线快进到已验证提交，标签以旧对象的显式 lease 更新；已核对 `main` 与 `0.9.5` 标签解析的提交相同。
- [正式覆盖运行 37605432888](https://github.com/skybcyang/Tracelo/actions/runs/37605432888)：plugin、macos、windows、publish 全部成功，运行 SHA 与新标签一致。
- [原 0.9.5 Release](https://github.com/skybcyang/Tracelo/releases/tag/0.9.5) 于北京时间 2026-10-07 18:15:22 更新，仍为非草稿、非预发布；Release ID `405075654` 及下载地址保留。七个附件的创建时间均在此次正式运行之后，发布说明与本次源码一致。

## 正式附件与安装

七个新附件已实际下载，六个载荷的 `shasum -a 256 -c SHA256SUMS.txt` 全部通过；七个下载文件的哈希均匹配 GitHub 上传摘要。插件 ZIP 仅含三件套，逐字节与独立附件相同，版本仍为 0.9.5。Windows ZIP 包含独立程序。macOS 包双架构、签名与下载后本机原生冒烟通过。

| 附件 | SHA-256 |
| --- | --- |
| Tracelo-0.9.5-obsidian.zip | `9d03edf2c3639431ac58c65a6d97ab1a83f313b42b09fc58663176c2e7192f83` |
| Tracelo-Capture-0.9.5-macos-universal.zip | `308190d76a5a6c8a67abcc7346dc2e7a0dcee951faf29bfcdf67fc42725fbec5` |
| Tracelo-Capture-0.9.5-windows-x64.zip | `b28a8f13ee1748081d98d3df1c2142b3c5653e3dde154da14d136205c880998e` |
| main.js | `02f290f4f33a559a6c95a3ccd2af2dd2d44d52fab82c4b2b13de32fdc8f745f3` |
| manifest.json | `585be76cd0d0c67d58e86e5d038a083f8d6842971af879bf589c6d99505c2141` |
| styles.css | `af48eb12ccc8d6311de5934d2cfbb430e65717e0ab7c2e55a0d9134a72f36f5e` |
| SHA256SUMS.txt | `1bcee0afafd335bf66f7ffc94fec9ca5a2ad92426458446d6ab358de7b35a109` |

对正式 macOS 包内页面资源进行隔离浏览器验收：无“一句话记录进展”入口，新建“一句话整理”可见，切换新建与进展保留直接进展草稿，无 JS 错误。截图在本工作树 `.local/release-095-refreshed-download/verified-progress.png`。

已用此次附件更新项目 vault 的 `.obsidian/plugins/work-timeline/`，三件套与新附件字节一致；实际项目 Obsidian 窗口 Force Reload 后加载版本为 0.9.5，配置与安装前相同。macOS 应用更新至 `/Applications/Tracelo Capture.app`，完整 Contents 与新包一致、签名验证通过；已重启安装路径进程。实际按 `⌃⌥P` 打开记录进展，并查看窗口截图确认入口移除。正式工作记录目录、插件配置及快捷草稿与安装前备份无差异。

实际安装截图仅保存在项目 `.local/release-095-refresh/installed-progress.png`，未上传私有任务内容；真实输入法、多屏及跨应用焦点全量矩阵仍未验收。Windows 有 CI 原生冒烟，本机未运行 Windows 实机。版本号相同的其他设备需重新下载安装才能取得此次更新。

## 覆盖与回退

旧标签对象：`26cd679a3e63784b85a7a7c751b0ff532f81066f`；旧发布提交：`07e4a5acdc01709d0df96640c8f2c9010e759457`。旧版验证和校验值见[首次发布记录](2026-10-07-release-095.md)。覆盖前保存旧附件与本地标签备份，更新标签使用显式 lease，远端主线只快进。

七个原附件保存在本工作树 `.local/release-095-original-assets/`，逐个匹配覆盖前的 GitHub 摘要；旧标签保存在本地 `backup-0.9.5-20261007-before-refresh`。本机安装前插件、任务、应用、配置和草稿备份保存在项目主目录 `.local/release-095-refresh/install-backup/`。

Release 工作流在三个平台全部通过后，替换现有七个附件及说明；不删除现有 Release。新附件以更新后的 `SHA256SUMS.txt` 为准，先前下载的副本需重新下载才包含此次入口移除。
