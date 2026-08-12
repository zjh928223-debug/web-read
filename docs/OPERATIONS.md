# Read-Web Operations

本文档是 `E:\read-web-next` 的当前操作手册。所有命令默认在该目录执行。

## Safety boundary

- 不停止、复用或改写日常版 `E:\read-web` 的 `5173/8765`。
- Next 手工预览使用 `5174/8766`。
- 自动浏览器测试只使用 `4193/4194/4195`。
- 不把凭据、浏览器 profile、媒体、工作流 data root 或词典数据库写入仓库。
- 未完成发布门禁并获得用户确认前，不修改桌面快捷方式。

## Install and diagnose

```powershell
npm ci
npm run verify:toolchain
python tools/subtitle-workflow/scripts/verify_runtime_dependencies.py --profile service
```

Python 清单区分 required 和 optional。`whisperx` 等外部工具缺失会报告，但只有使用对应能力时才阻塞。

RuntimeConfig 诊断：

```powershell
python tools/subtitle-workflow/youtube_workflow/runtime_config.py --config config/runtime.next.json --diagnostics
```

诊断输出必须脱敏，不应打印凭据、cookie 或私人绝对路径。

## Start Next preview

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-next-preview.ps1
```

预期地址：

- frontend `http://127.0.0.1:5174/`
- backend `http://127.0.0.1:8766/api/health`

若端口已被未知进程占用，停止并核对 PID ownership；不要结束日常版进程来腾端口。

## Verification

```powershell
npm run verify:fast
npm run build
node scripts/verify-full.mjs
openspec validate stabilize-and-simplify-read-web --strict
git diff --check
```

`verify:full` 应在完成后释放 `4193/4194`。可复查：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 4193,4194,4195,5174,8766 -ErrorAction SilentlyContinue
```

性能和后端基准见：

- `docs/performance/browser-journeys.md`
- `docs/performance/backend-benchmark.md`
- `config/performance-budgets.json`

## Backend tests

```powershell
Set-Location tools/subtitle-workflow
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
