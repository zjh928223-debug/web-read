# Windows CI

`.github/workflows/windows-ci.yml` is the repository quality gate for pushes to `main`, `codex/**`, and pull requests.

The workflow uses a fixed `windows-2022` runner with Node `24.13.1`, npm `11.8.0` (verified by the toolchain contract), and Python `3.10.10`. It installs JavaScript packages with `npm ci` and Python packages from the hash-locked service requirements.

The gate runs:

1. `verify:fast`, including toolchain, dependency-lock, script ownership, async-error policy, secret scan, license review, and SBOM generation.
2. `verify:full`, including the production build, isolated Vite journeys, independent Local App Host journeys, and all backend tests.
Logs, SBOM files, production-host evidence, traces, screenshots, and browser reports are uploaded for 14 days even when a step fails. The workflow does not use credentials, paid APIs, live YouTube, or the daily-use ports `5173/8765`.
