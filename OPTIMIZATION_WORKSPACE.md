# Read-Web Optimization Workspace

This is the isolated architecture-optimization copy created on 2026-08-26.

## Safety boundary

- Workspace: `E:\read-web-next-optimization`
- Branch: `codex/read-web-optimization`
- Protected daily reader: `E:\read-web-next`
- Protected daily data: `E:\ReadWebData\SubtitleWorkflow-Next`
- Optimization frontend/backend: `5184/8776`
- Optimization data: `E:\ReadWebData\SubtitleWorkflow-Optimization`

Do not launch this copy with the daily reader configuration. The normal Windows path is the
built-dist Local App Host launcher:

```powershell
Set-Location E:\read-web-next-optimization
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-optimization-preview.ps1
```

The launcher resolves `config/runtime.optimization.json`, builds into a unique staging directory,
validates every built artifact and the release manifest, and then publishes an immutable versioned
release under `.codex/releases/optimization/<releaseId>`. The active release and front-door target
pointers are written atomically only after a new internal Local App Host is healthy; the previous
release remains available for rollback. A loopback stable front door serves the active release on
`127.0.0.1:5184`, while each candidate Python Local App Host uses a separate internal port. The Node
capability sidecar stays on loopback `127.0.0.1:8776` and is reused when healthy. During an update,
the old Host remains active while the new target and pointers are prepared; the front door fails
closed during the brief pointer journal transition until all identities are coherent. The launcher
never mutates the active release or the project-root `dist` while an existing host is serving it.
It writes ownership state under `.codex/runtime-state/optimization` and logs under
`.codex/startup-logs`. A formal release candidate must set
`READ_WEB_OPTIMIZATION_RELEASE_CANDIDATE=1`, which rejects dirty/untracked Git state before build.
Stop only the owned optimization runtimes with:

```powershell
Set-Location E:\read-web-next-optimization
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-optimization-preview.ps1 -Stop
```

`-DevFallback` is an explicit Vite development escape hatch for source debugging; it is not the
default path. The launcher never uses the current daily `5174/8766` origin/data root or the legacy
rollback `5173/8765` ports.

The copy intentionally includes the source workspace's uncommitted WhisperX and
language-processing changes. Generated output, browser artifacts, backups and
`node_modules` were not intentionally carried as optimization inputs; dependencies
must be installed independently in this workspace.

## Promotion rule

Optimization work stays in this workspace until its focused checks, `verify:full`,
backup/restore rehearsal and user-visible reading journeys pass. Promotion to the
daily reader requires explicit user approval and a reviewed commit-level transfer.
