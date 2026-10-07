# 发布操作手册

适用于 Tracelo 插件、macOS 与 Windows 同版本发布。根据 [0.9.1 发布复盘](validation/2026-09-30-release-091.md#发布复盘)整理；实际构建、超时和附件规则以 [Release 工作流](../.github/workflows/release.yml)为准。

## 下次按这个顺序做

1. **确定发布范围并隔离后续开发。** 检查工作区、分支与远端；有并行开发时使用独立发布工作区，明确挑选发布文件，避免 `git add -A` 混入未验收功能。
2. **先做廉价预检。** 检查 GitHub API 和 Git 传输通道；统一版本与发布说明；先运行版本契约测试，再跑完整检查。
3. **验证候选提交。** 推送候选分支，手动运行 Release 工作流，确认插件、macOS 和 Windows 原生构建均通过。分支上的手动运行会跳过 publish，不创建公开 Release。
4. **冻结提交后打标签。** 标签指向已验证的 SHA，版本号不带 `v`。发布说明、版本文件也必须包含在此提交中；随后有代码变化就重新验证。
5. **等待标签工作流发布并验收。** 发布由 CI 完成，不另行手动创建同名 Release。核对标签、运行 SHA、七个附件、版本与校验和，记录验证边界。

当前标签工作流会重新构建和测试；候选构建的意义是提前暴露原生平台问题，不能把候选附件手工替换进正式发布。

## 版本与本地检查

逐项更新：

- `package.json`、`package-lock.json` 顶层与 `packages[""].version`。
- `manifest.json`、`versions.json` 中新版本对应的最低 Obsidian 版本。
- `desktop/Info.plist` 的两个版本字段、Windows `.csproj` 的 `Version`。
- `tests/plugin-contract.test.ts` 中的固定版本断言。
- `docs/releases/<版本>.md`，以及 README、桌面文档中的当前下载文件名和版本介绍；历史记录保持原版本。

```sh
npx vitest run tests/version-metadata.test.ts tests/plugin-contract.test.ts
git diff --check
npm run check
```

Node.js 要求 ≥ 22.12；完整浏览器测试需安装 Playwright Chromium（`npx playwright install chromium`）。`PLAYWRIGHT_CHANNEL=chrome` 仅被部分脚本读取，不能替代完整套件的 Chromium 依赖。macOS 完整跨语言检查需 Swift 和 .NET 8 SDK；必要时设置 `DOTNET_PATH` 为实际 SDK 路径，不直接假定上次 `/tmp` 中的路径仍可用。缺少工具导致的跳过要注明，不能当作全部通过。

完整本地检查在代码稳定后运行一次。仅文档调整检查链接与差异；平台专项修复先做对应检查，再由三平台 CI 把关，避免无变化地重复整套回归。测试证据必须记录对应提交及运行环境。

## GitHub 网络：先验证通道，再传大包

0.9.1 遇到 API 直连超时、HTTPS Git 推送超时；当时系统代理是 `127.0.0.1:7890`，CLI 没有自动继承。下列端口是本机当次配置，下次先用 `scutil --proxy` 确认，不能假定其他机器也相同。

```sh
scutil --proxy
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 \
  gh api repos/skybcyang/Tracelo --jq .full_name
```

API 能通不代表 Git 大包能推送。本次最终可用的是 **SSH 经 HTTP CONNECT 代理连接 GitHub 443**：

```sh
ssh -T -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes \
  -o 'ProxyCommand=nc -X connect -x 127.0.0.1:7890 %h %p' \
  -p 443 git@ssh.github.com
```

看到 GitHub 的认证成功提示即可；它不提供 shell，因此此探测返回码 1 是正常的。未知主机密钥需按 GitHub 官方指纹核验，不关闭主机密钥检查。此 `nc` 写法适用于本次 macOS 环境。

确认通道后，在发布终端中设置以下变量；版本从当前 manifest 读取，先核实它就是本次计划发布的版本，代理地址按上面的实测结果填写：

```sh
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
export GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes -o "ProxyCommand=nc -X connect -x 127.0.0.1:7890 %h %p"'
release_remote=ssh://git@ssh.github.com:443/skybcyang/Tracelo.git
release_version=$(node -p "require('./manifest.json').version")
release_branch=codex/release-$release_version
release_sha=$(git rev-parse HEAD)
git push "$release_remote" "$release_sha:refs/heads/$release_branch"
gh workflow run release.yml --repo skybcyang/Tracelo --ref "$release_branch"
gh run list --repo skybcyang/Tracelo --workflow release.yml --branch "$release_branch" \
  --limit 5 --json databaseId,headSha,status,conclusion,url
```

从列表中选取 **headSha 等于 `release_sha`** 的候选运行，保存 run ID 并等待结束；不要只看最新一条。候选分支通过前不打标签，也不要在等待期间继续改动该分支。

推送失败时，先用 `git ls-remote` 查目标分支／标签是否已更新，再决定重试。本次约 24 MB 的 Git pack 曾反复上传后超时，调大 `http.postBuffer` 或切 HTTP/1.1 均未解决；不要无依据地重复同一慢通道。`Writing objects: 100%` 以及失败输出中的 `Everything up-to-date` 都不能证明远端成功。

## 标签与正式发布

候选三平台检查通过后，确认远端 main 没有其他未纳入提交、`release_sha` 可以快进主线，且新版本标签与 Release 均不存在。如果主线已经前进，先整合并重新验证候选提交，不强推覆盖主线。

```sh
git tag -a "$release_version" "$release_sha" -m "Tracelo $release_version"
git push --atomic "$release_remote" \
  "$release_sha:refs/heads/main" "refs/tags/$release_version"
git ls-remote "$release_remote" refs/heads/main "refs/tags/$release_version^{}"
gh run list --repo skybcyang/Tracelo --workflow release.yml \
  --limit 10 --json databaseId,headSha,headBranch,event,status,conclusion,url
```

选择 headBranch 为版本标签、headSha 匹配的正式运行。将下方示例 ID 换成实际值，再执行等待命令：

```sh
release_run_id=123456789
gh run watch "$release_run_id" --repo skybcyang/Tracelo --exit-status --compact --interval 30
gh release view "$release_version" --repo skybcyang/Tracelo \
  --json url,isDraft,isPrerelease,publishedAt,assets
git fetch origin main
```

直接向 SSH URL 推送不会自动更新 `origin/main`，因此最后 fetch 同步本地远端引用。原有工作区有未提交改动时，不为同步而重置或清空它。

0.9.1 曾在尚未生成 Release 时，核实远端状态后用显式 lease 修正早打的标签；这是发布前故障恢复的例外。正常流程不移动标签，已经公开发布的版本应通过新版本修复。

用户明确指定覆盖已发布版本时，先保存旧标签对象、提交与七个附件，完成新候选三平台验证后再用旧标签对象的显式 lease 更新标签。现有 Release 的附件与说明由标签 CI 替换，保留下载地址；`publish` 支持同版本重跑和覆盖附件。2026-10-07 的 0.9.5 覆盖遵循此次用户明确授权，见[同版本更新记录](validation/2026-10-07-release-095-refresh.md)。

## 验收与故障出口

- Release 工作流的 plugin、macos、windows、publish 全部成功；记录标签解析后的提交 SHA、run ID 和发布时间。
- 附件应为三个平台 ZIP、`main.js`、`manifest.json`、`styles.css`、`SHA256SUMS.txt`，共七个；六个载荷的 GitHub 上传摘要逐项对照校验文件。
- 实际下载的文件再用 `shasum -a 256` 验证，检查包内版本与插件 ZIP 内容。区分“上传摘要匹配”和“本地下载验证”，不把未下载的大包说成已实测。
- Windows 原生加载失败优先查看 `smoke-result.txt` 与截图，检查页面大小和 WebView2 加载路径；浏览器、WebKit、C# 编译成功均不能代替 Windows 原生窗口通过。
- 当前 CI 已有 120 秒 Windows smoke 进程上限、5 秒诊断上限，证据只上传 `*.png`／`*.txt`，不要恢复无期限等待或上传整个 WebView2 profile。
- 时间相关测试必须在创建数据前安装模拟时钟，避免跨天后样本历史倒序。
- 发布后是否本地重装另行记录；远端发布成功不意味着本机已安装新版本。

尚待后续改进：`desktop/windows/scripts/verify.ps1` 仍默认版本 `0.8.0` 且使用无上限 `-Wait`；手动使用时必须显式传入当前版本，并按 CI 的有界等待方式执行原生冒烟。该脚本尚未同步 CI 防护。候选产物复用、版本自动更新和 bundle 瘦身也尚未实现，本手册不将它们视为已有能力。
