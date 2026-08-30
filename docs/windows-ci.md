# Windows CI

`.github/workflows/windows-ci.yml` is the repository quality gate for pushes to `main`, `codex/**`, and pull requests.

The workflow uses a fixed `windows-2022` runner with Node `24.13.1`, npm `11.8.0` (verified by the toolchain contract), and Python `3.10.10`. It installs JavaScript packages with `npm ci`, creates a venv under `RUNNER_TEMP`, exports that exact interpreter as `READ_WEB_PYTHON`/`READ_WEB_PYTHON_PATH`, and installs Python packages there from the hash-locked service requirements. No repository-local venv is created or committed.

The gate runs:

1. `verify:fast`, including offline lock-format/interpreter selection, toolchain, dependency-lock, script ownership, async-error policy, secret scan, license review, and SBOM generation.
2. `verify:full`, including exact Python package-set health for the selected Production Host interpreter, the production build, isolated Vite journeys, independent Local App Host journeys, and all backend tests.
3. Release-only OSV checks use the same selected interpreter and fail closed on findings or network/API errors; ordinary fast CI does not depend on OSV network availability.
Logs, SBOM files, production-host evidence, traces, screenshots, and browser reports are uploaded for 14 days even when a step fails. The workflow does not use credentials, paid APIs, live YouTube, or the reserved daily ports `5173/8765` and `5174/8766`.
