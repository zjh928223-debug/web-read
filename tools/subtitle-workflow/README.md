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

Do not commit generated materials, local state, credentials, caches, or Python bytecode. The reader startup script owns service launch. For a reproducible local run, create the service venv outside the repository. The stable optimization launcher location keeps desktop cold starts on the same interpreter:

```powershell
$venv = Join-Path $env:LOCALAPPDATA 'Read-Web\optimization-python'
python -m venv $venv
$env:READ_WEB_PYTHON = Join-Path $venv 'Scripts\python.exe'
$env:READ_WEB_PYTHON_PATH = $env:READ_WEB_PYTHON
$env:READ_WEB_RUNTIME_CONFIG = (Resolve-Path .\config\runtime.optimization.json).Path
& $env:READ_WEB_PYTHON -m pip install --require-hashes --only-binary=:all: -r .\tools\subtitle-workflow\requirements-service.lock
```

WhisperX is deliberately installed in a second venv because it is an external
workflow tool and its Torch/pyannote dependency tree must not be added to the
locked HTTP service environment. On Windows, create it at the stable path used
by `config/runtime.optimization.json` and install the current stable PyPI
release (the CUDA Torch wheels are selected separately when GPU inference is
available):

```powershell
$whisperxVenv = Join-Path $env:LOCALAPPDATA 'Read-Web\whisperx'
python -m venv $whisperxVenv
$whisperxPython = Join-Path $whisperxVenv 'Scripts\python.exe'
& $whisperxPython -m pip install whisperx
& $whisperxPython -m pip install --force-reinstall --no-deps --index-url https://download.pytorch.org/whl/cu128 torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0
$nltkData = Join-Path $whisperxVenv 'nltk_data'
New-Item -ItemType Directory -Force -Path $nltkData | Out-Null
$env:NLTK_ALLOW_PROXIED_URLOPEN = '1' # only when using a trusted local proxy
& $whisperxPython -c "import nltk; nltk.download('punkt_tab', download_dir=r'$nltkData')"
```

The optimization RuntimeConfig resolves
`%LOCALAPPDATA%\Read-Web\whisperx\Scripts\whisperx.exe` at startup, so a
normal launcher restart does not depend on the current shell PATH or a
temporary worktree. The service venv remains subject to the production lock
health gate; the WhisperX venv is probed separately as an executable.

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

日常 production promotion 只有在用户明确确认后才解析
`config/runtime.daily-production.json`，使用现有 `SubtitleWorkflow-Next` root；optimization 手工运行仍只使用
`config/runtime.optimization.json`。`8765` 只描述 legacy compatibility 行为，daily origin 和 daily-production
candidate 都使用 `8766`。完整操作说明见 `docs/OPERATIONS.md`。
