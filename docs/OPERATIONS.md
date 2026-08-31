# Read-Web Operations

本文档同时记录受保护 Next 树和隔离 optimization 树的操作。每个命令段都先声明自己的
工作目录；不要把 optimization 命令复制到 `E:\read-web-next` 执行。

## Safety boundary

- 不停止、复用或改写当前日常 `E:\read-web-next` 的 `5174/8766`。
- 旧日常回退参考为 `E:\read-web` 的 `5173/8765`；两组端口都属于保留端口。
- 本 worktree 的 optimization 手工运行只使用 `5184/8776` 与 `E:\ReadWebData\SubtitleWorkflow-Optimization`。
- `verify:full` 固定拥有隔离 Vite 端口 `4193`（development）和 `4194`（production preview）；其他自拥有 browser journeys 使用共享策略分配的随机 browser-safe 端口，全部排除 `5173/8765` 和 `5174/8766`。
- 不把凭据、浏览器 profile、媒体、工作流 data root 或词典数据库写入仓库。
- 桌面快捷方式不属于本 worktree 的实现或验证范围；后续验证不得读取或改写，正式切换必须单独获得用户明确确认并保留旧目标用于回滚。

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
上一提交重新 build。需要临时恢复可用 reader 时，可明确运行 `-DevFallback`；它仍使用 optimization
RuntimeConfig 的 `5184/8776`，只是返回 Vite dev content，不能当作 built production Host。

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

## Daily production promotion: explicit takeover entry

这是从本优化 worktree 产出 built-dist Host、接管现有日常 origin 的最小入口，不是第二套
workflow 数据迁移。它固定使用 `config/runtime.daily-production.json`、`5174/8766`、
`E:\ReadWebData\SubtitleWorkflow-Next` 和 profile `daily-production`；不会复制约 4.67 GB
workflow/media，也不会改变 optimization 的 `5184/8776` 与
`E:\ReadWebData\SubtitleWorkflow-Optimization` 隔离约束。

默认只做安全 Plan：

```powershell
Set-Location E:\read-web-next-optimization
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-daily-production.ps1 -Action Plan -NoOpen
```

Plan 不写 state、release、profile 或数据；它只报告端口是否空闲、已有 process/health/profile
身份、root identity、built-dist 要求和 owner 状态。旧进程或未知占用者不会被自动停止或接管。

只有用户在确认 Plan、确认当前日常进程已由用户自行处理且允许使用现有 `SubtitleWorkflow-Next`
后，才可执行正式 Apply：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-daily-production.ps1 `
  -Action Apply -ConfirmDailyProductionApply -NoOpen
```

Apply 会构建不可变 release、启动 `youtube_workflow.production_host_prototype` built-dist Host
和 capability pair，并原子写入 `.codex/runtime-state/daily-production/`。状态保存 PID/start
time/executable/argument、health、release、profile、data-root identity 与 rollback state；失败
只清理本次新 owned instance，不删除旧 release 或数据。`Start`/`Stop`/`Rollback` 也只接受
identity-checked owned process，Rollback 需要 `-ConfirmDailyProductionRollback`，并保留 release
和 data root。Rollback 不会访问或重启受保护的 Vite/dev 进程；完成回退后，用户可以手动返回保留的
旧 launcher/target，现有 shortcut target 不会被丢弃。

Daily cold start、Apply/Start 以及 shortcut 指向的 launcher 使用同一套 Python 解析：正式
daily 在没有 `-BootstrapPython` 或 `READ_WEB_PYTHON`/`READ_WEB_PYTHON_PATH` 显式 override 时，
只允许使用 `%LOCALAPPDATA%\Read-Web\optimization-python\Scripts\python.exe`；该 venv 缺失时
直接 fail-closed，不会把 daily RuntimeConfig 中的裸 `python` 解析成全局回退。显式 override
只用于 fixture/CI 等明确场景。launcher 不会修改全局 Python，也不会用不健康的全局解释器继续
启动；完整 Python health、built Host 和 runtime preflight 任一失败都会 fail-closed。

快捷方式另有独立、显式的 Plan/Apply/Rollback 工具；验证只使用临时 `.lnk`，不会读取或改写桌面
快捷方式。正式切换时必须显式提供新的 script、working directory 和 launcher arguments，并保留
旧目标：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-shortcut-migration.ps1 `
  -Action Plan -ShortcutPath <explicit-shortcut> -StatePath <explicit-state> `
  -NewScriptPath E:\read-web-next-optimization\scripts\launch-daily-production.ps1 `
  -NewWorkingDirectory E:\read-web-next-optimization `
  -NewLauncherArguments '-Action Start -NoOpen'
```

若 Host health 的六域 `ownerMode.authoritativeDomains` 未全部覆盖
`reader-session`、`marks-activity`、`passage-preview`、`annotation`、`vocabulary-srs`、`workflow`，
结果必须诚实显示 `legacy-browser-owner/pre-cutover`，不能宣称 authoritative。

## Optimization install and diagnose

```powershell
Set-Location E:\read-web-next-optimization
npm ci
npm run verify:toolchain
$venv = Join-Path $env:LOCALAPPDATA 'Read-Web\optimization-python'
python -m venv $venv
$env:READ_WEB_PYTHON = Join-Path $venv 'Scripts\python.exe'
$env:READ_WEB_PYTHON_PATH = $env:READ_WEB_PYTHON
$env:READ_WEB_RUNTIME_CONFIG = (Resolve-Path config\runtime.optimization.json).Path
& $env:READ_WEB_PYTHON -m pip install --disable-pip-version-check --require-hashes --only-binary=:all: -r tools\subtitle-workflow\requirements-service.lock
npm run verify:python-health
npm run verify:python-runtime-inventory
```

venv 必须放在仓库外，不提交也不与其他项目混用。上面的 `%LOCALAPPDATA%\Read-Web\optimization-python`
是 optimization launcher 的稳定默认位置：桌面快捷方式冷启动时，即使没有继承当前 PowerShell
会话的环境变量，也会选择这个解释器。`READ_WEB_PYTHON` 是 canonical 选择；
`READ_WEB_PYTHON_PATH` 仅为兼容别名，显式环境变量和 `-BootstrapPython` 会优先于默认位置。
optimization launcher、full/release gate 和 Production Host 都使用同一个解析后的 executable。
optimization 默认 venv 不存在时，optimization launcher 才回退到 RuntimeConfig/PATH；全局解释器
若未通过完整 package-set health，仍会在 BuildAction 前 fail-fast。daily-production launcher
使用更严格的 daily resolver：没有显式 `-BootstrapPython` 或 `READ_WEB_PYTHON`/
`READ_WEB_PYTHON_PATH` 时，默认 venv 缺失就 fail-closed，不会把 daily RuntimeConfig 中的裸
`python` 解析成全局回退；显式 override 只用于 fixture/CI 等明确场景。

一次性验证或 CI 可以把 `$venv` 换成系统临时目录；这时必须在同一会话设置 `READ_WEB_PYTHON`，
或启动 launcher 时显式传入 `-BootstrapPython <path-to-python.exe>`。

`verify:fast` 只执行离线、确定性的 lock 格式和 RuntimeConfig 选择检查；`verify:full` 还会
执行完整 package-set health。Python 清单区分 required 和 optional。`whisperx` 等外部工具缺失
会报告，但只有使用对应能力时才阻塞；Production Host 的 Python lock/package 漂移、缺包和
解释器不一致则在 launcher 的 BuildAction 前 fail-closed。

OSV 是 release/supply-chain owner，不是 fast owner：

```powershell
npm run verify:python-osv
npm run verify:python-osv:test
```

OSV finding、坏响应或网络错误均 fail-closed；普通离线 fast gate 不依赖网络。CI 使用
`$env:RUNNER_TEMP` 下的同等临时 venv，见 `.github/workflows/windows-ci.yml`。

Release manifest 的 previous source 必须显式提供。正式 release 使用受版本控制、只读且能通过
artifact checksum verification 的 manifest 输入，不从默认个人路径重建：

```powershell
$env:READ_WEB_PREVIOUS_RELEASE_MANIFEST = 'E:\release-inputs\read-web-previous\release-manifest.json'
npm run release:manifest
npm run verify:release -- --list
```

正式 manifest 会先把 clean candidate 的 artifacts 复制到
`output/release/published/<releaseId>/`，在那里写入并校验
`source.kind=immutable-release`、`source.readOnly=true` 的 manifest；顶层
`output/release/release-manifest.json` 是同一份已发布 manifest 的便捷副本，
下一轮可直接将发布目录中的 manifest 作为 `--previous-manifest` 输入。

也可把 `--previous-manifest <path>` 传给对应 Node 脚本。旧版 live root 只有在实际包含完整
Python lock 时才能作为非正式 fixture source；缺 lock 会在长门禁前报告
`RELEASE_PREVIOUS_SOURCE_INCOMPLETE`，不会伪造 previous lock、hash 或 identity。previous
manifest 及其 release root 只读校验；health 与 rollback 使用同一 releaseId/manifest SHA。

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
`-DevFallback`，它仍使用 optimization 隔离的 `5184/8776`，不改变 built production 默认路径。

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
Get-NetTCPConnection -State Listen -LocalPort 4193,4194 -ErrorAction SilentlyContinue
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
& $env:READ_WEB_PYTHON -m unittest discover -s tests -p 'test_*.py'
```

后端测试必须使用临时 data root 或 in-process adapter，不得读取或清理真实
`E:\ReadWebData\SubtitleWorkflow-Next` 或 `E:\ReadWebData\SubtitleWorkflow`。

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
