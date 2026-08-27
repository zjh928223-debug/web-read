# Read-Web Operations

本文档同时记录受保护 Next 树和隔离 optimization 树的操作。每个命令段都先声明自己的
工作目录；不要把 optimization 命令复制到 `E:\read-web-next` 执行。

## Safety boundary

- 不停止、复用或改写日常版 `E:\read-web` 的 `5173/8765`。
- Next 手工预览使用 `5174/8766`。
- `verify:full` 固定拥有隔离 Vite 端口 `4193`（development）和 `4194`（production preview）；其他自拥有 browser journeys 使用共享策略分配的随机 browser-safe 端口，全部排除 `5173/8765`。
- 不把凭据、浏览器 profile、媒体、工作流 data root 或词典数据库写入仓库。
- 桌面快捷方式已在 2026-08-17 获得用户明确确认后迁移；后续验证不得自动改写，旧目标必须保留用于回滚。

## Optimization worktree: built production launch

optimization 树的日常验证和本机正式预览使用 built `dist` 的单一 Local App Host，不使用
Vite dev server：

```powershell
Set-Location E:\read-web-next-optimization
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-optimization-preview.ps1
```

launcher 固定解析 `config/runtime.optimization.json`，使用 `5184/8776` 和
`E:\ReadWebData\SubtitleWorkflow-Optimization`。loopback stable front door 在
`127.0.0.1:5184` 提供静态 reader、workflow 和 browser-visible `/api`；Python Local App Host
在每个 release 的隔离内部端口运行，九个 Node capability endpoint 由同一 launcher 管理并可
复用的 sidecar 使用 `127.0.0.1:8776`，浏览器不会直接依赖第二个地址。

启动前会构建并校验 dist、生成 release manifest/checksum、建立 per-instance application
profile lease，并通过 PID/start identity 记录 front door、Host 和 sidecar。构建不会写入正在
服务的 project-root `dist`：launcher 先创建唯一 staging release，校验所有 dist artifact 的
checksum、manifest 及完整 `SeekPlayerDB / 1 / files / id` 兼容性，再把 staging 目录移动为不可变的
`.codex/releases/optimization/<releaseId>`。

若要把本次构建作为正式 release candidate，先显式设置
`$env:READ_WEB_OPTIMIZATION_RELEASE_CANDIDATE = '1'`；launcher 会在 build 前拒绝任何
dirty 或 untracked Git 状态。普通 optimization preview 可以在当前隔离 worktree 中迭代，
但其 manifest 会保留 `release.dirty` 事实，不能当作正式发布候选。

更新采用蓝绿切换：旧 Host 和旧 release 在新 release、新内部 Host 及新的 profile lease
全部 ready 前继续保留。三个 pointer 的 journal 切换期间，5184 front door 只暴露 journal
校验过的旧 target/旧 Host；它不会代理尚未 committed 的 candidate。若 target 缺失、损坏、
身份不完整或与 profile/release/instance 不一致，则 front door fail-closed 返回 503。journal
提交并且 active-release/active-host/target 一致后才切换到新 release。切换或 readiness 失败时
只清理新实例并恢复旧 target/pointer，旧 release 和旧 Host 继续可用；不存在“先停旧进程再
rollback”的停机窗口。manager 的 spawn receipt 和 activation journal 会在 launcher 崩溃后
按 PID/start identity、loopback port、health identity 及命令行 ownership 检查回收 orphan。

状态和日志位置：

- `.codex/runtime-state/optimization/`：front door、active Host descriptor、per-instance Host
  state、sidecar state、target/active pointers 和本机 token 文件；
- `.codex/startup-logs/`：production host 与 capability host 的 stdout/stderr；
- `E:\ReadWebData\SubtitleWorkflow-Optimization\.read-web-application\instances\`：每个
  blue-green Host 的 browser、Python state/output 隔离 profile 目录。

只关闭该优化实例：

```powershell
Set-Location E:\read-web-next-optimization
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-optimization-preview.ps1 -Stop
```

`-Stop` 只接受 state 文件中 profile、PID、start identity 匹配的进程；未知占用者不会被终止。
`-DevFallback` 是显式源代码调试逃生路径，会调用现有 Vite launcher，不能作为默认日常启动。
若 built Host 启动或蓝绿切换失败，launcher 会清理本次 staging/新 owned instance，并保留
当前 active release、旧 target、旧 Host 可用性及数据目录；先查看上述日志，再修复或回到
上一提交重新 build。需要临时恢复可用 reader 时，可明确运行 `-DevFallback`，确认后再用
`-Stop` 清理旧的 production pair。

launcher focused check（包含真实 start → health → reuse(PID/instance 不变) → stop，以及 staging
构建/发布失败安全性）使用优化端口并拒绝接管已有 owned pair：

```powershell
Set-Location E:\read-web-next-optimization
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/optimization-launcher-check.ps1
```

非浏览器生命周期证据可在不触碰日常端口的情况下运行三轮冷启动、崩溃恢复和 profile lease 检查：

```powershell
Set-Location E:\read-web-next-optimization
$env:READ_WEB_PRODUCTION_HOST_BROWSER = '0'
node scripts/production-host-lifecycle-check.mjs
Remove-Item Env:READ_WEB_PRODUCTION_HOST_BROWSER
```

该模式会在随机 loopback 端口运行，明确记录 `browserJourneys: skipped`；默认验证仍保留浏览器旅程。

## Optimization install and diagnose

```powershell
Set-Location E:\read-web-next-optimization
npm ci
npm run verify:toolchain
python tools/subtitle-workflow/scripts/verify_runtime_dependencies.py --profile service --config config/runtime.optimization.json
```

Python 清单区分 required 和 optional。`whisperx` 等外部工具缺失会报告，但只有使用对应能力时才阻塞。

Release manifest 的外部工具 probe 是工具专属且可审计的：`ffmpeg` 接受 6--8 的稳定主版本
或 2024--2026 的 dated git banner，`yt-dlp` 接受 2025--2026 的 `YYYY.MM.DD` release，
`WhisperX` 接受 3.x.y。probe 必须匹配对应的 version banner，并记录 resolved executable、
sha256、probe 命令、support matrix 和 `compatibility.status`；exit 0 的任意文本、伪 banner、
不支持版本和非零 probe 都是 typed `degraded`，绝不会写成 `verified`。缺失工具可以使非相关
能力继续运行；launcher 允许这种 `missing` 降级，依赖该工具的 workflow stage 以 typed
configuration/tool preflight error fail-closed。伪 banner、不支持版本和 probe failure 则在
候选发布前直接 fail-closed，不会启动新的 production Host，也不会改变当前 active release。

RuntimeConfig 诊断：

```powershell
Set-Location E:\read-web-next-optimization
python tools/subtitle-workflow/youtube_workflow/runtime_config.py --config config/runtime.optimization.json --diagnostics
```

诊断输出必须脱敏，不应打印凭据、cookie 或私人绝对路径。

## Start optimization preview

```powershell
Set-Location E:\read-web-next-optimization
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-optimization-preview.ps1 -NoOpen
```

预期地址：

- stable front door `http://127.0.0.1:5184/`
- workflow health `http://127.0.0.1:5184/api/health`

若端口已被未知进程占用，停止并核对 PID ownership；不要结束日常版进程来腾端口。需要源代码调试时，必须显式传入
`-DevFallback`，它仍使用隔离的 `5174/8766`，不改变 built production 默认路径。

## Verification

```powershell
Set-Location E:\read-web-next-optimization
npm run verify:fast
npm run build
node scripts/verify-full.mjs
node scripts/learning-page-launcher-check.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/optimization-launcher-check.ps1 -PowerShellKind powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/optimization-launcher-check.ps1 -PowerShellKind pwsh
git diff --check
```

`verify:full` 应在完成后释放固定的 `4193/4194`；随机 browser-safe journey 端口由各自 owner 在结束时释放。可复查：

```powershell
Set-Location E:\read-web-next-optimization
Get-NetTCPConnection -State Listen -LocalPort 4193,4194,5174,8766 -ErrorAction SilentlyContinue
```

`E:\read-web-next` 是受保护的日常 reader 树，本节不提供在那里执行 `npm ci`、build、verify 或 launch
的命令；本 worktree 的 release/launcher 验证必须使用上述 optimization 目录和
`config/runtime.optimization.json`。

性能和后端基准见：

- `docs/performance/browser-journeys.md`
- `docs/performance/backend-benchmark.md`
- `config/performance-budgets.json`

## Backend tests

```powershell
Set-Location E:\read-web-next-optimization\tools\subtitle-workflow
python -m unittest discover -s tests -p 'test_*.py'
```

后端测试必须使用临时 data root 或 in-process adapter，不得读取或清理真实 `E:\ReadWebData\SubtitleWorkflow`。

## Failure artifacts

- 浏览器报告：`.playwright-artifacts/`
- 性能报告：`output/performance/`
- baseline capture：`output/baselines/`

这些目录是可再生成产物，不应提交。失败报告可用于诊断，但分享前仍需检查脱敏。

## Git and rollback discipline

- 每个边界形成小提交；不要把未验证的多域重构堆成一个发布点。
- 开始下一阶段前保持 `git status` 可解释。
- 不执行 `git reset --hard` 或覆盖用户工作。
- 当前分支尚无 upstream 时，不得把“本地已提交”当作远端备份。

最终迁移前必须完成：clean-room install、release gates、用户数据 backup/restore dry-run、长时运行、旧版/Next 差分、Release Manifest、快捷方式原子切换和回滚演练。切换动作需要用户再次明确确认。
