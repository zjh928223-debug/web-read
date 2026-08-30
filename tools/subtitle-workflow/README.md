# Read-Web Subtitle Workflow Service

This directory contains the local FastAPI material-processing service used by Read-Web.

- Service module: `youtube_workflow.service:app`
- Legacy compatibility host: `127.0.0.1:8765`
- Legacy compatibility data root: `E:\ReadWebData\SubtitleWorkflow`
- Current daily reader origin: `127.0.0.1:5174`; workflow/capability service: `127.0.0.1:8766`; data root `E:\ReadWebData\SubtitleWorkflow-Next` (protected Vite/dev compatibility path)
- Daily-production candidate: built reader Host `youtube_workflow.production_host_prototype` on `127.0.0.1:5174` with capability service `127.0.0.1:8766`
- Optimization manual reader Host: `127.0.0.1:5184`; capability service: `127.0.0.1:8776`; data root `E:\ReadWebData\SubtitleWorkflow-Optimization`
- Legacy default output directory: `E:\ReadWebData\SubtitleWorkflow\output`
- Legacy default state directory: `E:\ReadWebData\SubtitleWorkflow\.workflow_state`

Do not commit generated materials, local state, credentials, caches, or Python bytecode. The reader startup script owns service launch. For a reproducible local run, create the venv outside the repository and select it explicitly:

```powershell
$venv = Join-Path $env:TEMP ('read-web-python-' + [Guid]::NewGuid().ToString('N'))
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
The release/launcher gates pass the same executable identity to health, OSV,
the Production Host, and the release reuse key. `verify:fast` deliberately
remains offline and checks lock structure only; OSV is a release/supply-chain
gate and fails closed on findings, malformed responses, or network errors.

日常 production promotion 只有在用户明确确认后才解析
`config/runtime.daily-production.json`，使用现有 `SubtitleWorkflow-Next` root；optimization 手工运行仍只使用
`config/runtime.optimization.json`。`8765` 只描述 legacy compatibility 行为，daily origin 和 daily-production
candidate 都使用 `8766`。完整操作说明见 `docs/OPERATIONS.md`。
