# Read-Web Optimization Workspace

This is the isolated architecture-optimization copy created on 2026-08-26.

## Safety boundary

- Workspace: `E:\read-web-next-optimization`
- Branch: `codex/read-web-optimization`
- Protected daily reader: `E:\read-web-next`
- Protected daily data: `E:\ReadWebData\SubtitleWorkflow-Next`
- Optimization frontend/backend: `5184/8776`
- Optimization data: `E:\ReadWebData\SubtitleWorkflow-Optimization`

Do not launch this copy with the daily reader configuration. Use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-optimization-preview.ps1
```

The copy intentionally includes the source workspace's uncommitted WhisperX and
language-processing changes. Generated output, browser artifacts, backups and
`node_modules` were not intentionally carried as optimization inputs; dependencies
must be installed independently in this workspace.

## Promotion rule

Optimization work stays in this workspace until its focused checks, `verify:full`,
backup/restore rehearsal and user-visible reading journeys pass. Promotion to the
daily reader requires explicit user approval and a reviewed commit-level transfer.
