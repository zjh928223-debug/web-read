# Read-Web Subtitle Workflow Service

This directory contains the local FastAPI material-processing service used by Read-Web.

- Service module: `youtube_workflow.service:app`
- Default host: `127.0.0.1:8765`
- Default data root: `E:\ReadWebData\SubtitleWorkflow`
- Default output directory: `E:\ReadWebData\SubtitleWorkflow\output`
- Default state directory: `E:\ReadWebData\SubtitleWorkflow\.workflow_state`

Do not commit generated materials, local state, credentials, caches, or Python bytecode. The reader startup script owns service launch. For a reproducible local run, create the venv outside the repository. The stable optimization launcher location keeps desktop cold starts on the same interpreter:

```powershell
$venv = Join-Path $env:LOCALAPPDATA 'Read-Web\optimization-python'
python -m venv $venv
$env:READ_WEB_PYTHON = Join-Path $venv 'Scripts\python.exe'
$env:READ_WEB_PYTHON_PATH = $env:READ_WEB_PYTHON
$env:READ_WEB_RUNTIME_CONFIG = (Resolve-Path .\config\runtime.optimization.json).Path
& $env:READ_WEB_PYTHON -m pip install --require-hashes --only-binary=:all: -r .\tools\subtitle-workflow\requirements-service.lock
```

Run the production health check before adding test-only packages. The health
gate compares the complete environment with the production lock, so it must
run while this venv still contains only production dependencies:

```powershell
npm run verify:python-health
```

For the Python test suite, then install the separate hashed test lock so
Starlette's `TestClient` uses its supported `httpx2` client and Uvicorn selects
its warning-free WebSocket implementation:

```powershell
& $env:READ_WEB_PYTHON -m pip install --require-hashes --only-binary=:all: -r .\tools\subtitle-workflow\requirements-service-test.lock
```

The lock-first vulnerability gate does not install packages or depend on a
globally installed `pip-audit`/`safety` executable. It queries the OSV PyPI
batch API and fails closed on a malformed lock, network failure, or known
finding:

```powershell
& $env:READ_WEB_PYTHON .\tools\subtitle-workflow\scripts\audit_python_dependencies.py --config .\config\runtime.optimization.json
```

Use `--lock .\tools\subtitle-workflow\requirements-service-test.lock` to
audit the test-only additions as well.

The health gate compares the complete installed distribution set with the
production hashed lock and never installs packages. `READ_WEB_PYTHON` is the
canonical interpreter selector; `READ_WEB_PYTHON_PATH` is a compatibility alias.
When neither is set, the optimization launcher and Node Python gates prefer
`%LOCALAPPDATA%\Read-Web\optimization-python\Scripts\python.exe` when it exists,
then fall back to the RuntimeConfig/PATH selection. A global interpreter still
has to pass the full health gate; duplicate or drifted distributions are not
silently ignored.
The release/launcher gates pass the same executable identity to health, OSV,
the Production Host, and the release reuse key. `verify:fast` deliberately
remains offline and checks lock structure only; OSV is a release/supply-chain
gate and fails closed on findings, malformed responses, or network errors.

在 Next 隔离工作区中，端口、data root 和工具路径由根目录的
`config/runtime.next.json` 与 `RuntimeConfig` 解析。默认 `8765` 仅描述未提供
RuntimeConfig 时的兼容行为；Next launcher 使用 `8766`。完整操作说明见
`docs/OPERATIONS.md`。
