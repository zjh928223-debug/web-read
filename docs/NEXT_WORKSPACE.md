# Read-Web Next Workspace

`E:\read-web-next` is the protected current daily installation/workspace for Read-Web. The independent
optimization implementation workspace is `E:\read-web-next-optimization`.

## Safety contract

- The current daily learning origin uses ports `5174` and `8766`; its existing compatibility launcher is a protected Vite/dev path.
- The legacy rollback reference remains at `E:\read-web` on `5173` and `8765`.
- `scripts/launch-next-preview.ps1` is the protected daily Vite/dev compatibility launcher; the optimization
  worktree's `scripts/launch-daily-production.ps1` is the separate built-dist promotion candidate.
- Do not stop or replace current learning processes during development or verification.
- Do not rewrite the desktop shortcut automatically; its old target must remain available for rollback.
- Daily promotion is opt-in, does not copy workflow/media, and must report `legacy-browser-owner/pre-cutover`
  until all six Host owner domains are checkpointed.

## Repository identity

- Branch: `codex/read-web-next`
- Snapshot baseline: current working learning app plus the embedded subtitle workflow.
- The subtitle workflow source is owned here at `tools/subtitle-workflow`.

## Local data

Learning data remains outside Git:

- Current daily workflow data: `E:\ReadWebData\SubtitleWorkflow-Next`
- Legacy rollback workflow data: `E:\ReadWebData\SubtitleWorkflow`
- Optimization manual workflow data: `E:\ReadWebData\SubtitleWorkflow-Optimization`
- Dictionaries: sourced read-only from `E:\read-web\data\dictionaries` during the transition. The launcher passes explicit database paths, so the next code workspace does not copy the 6.5 GB dictionary tree.

Do not copy generated media, browser profiles, credentials, or dictionary databases into Git.

## Migration record

The historical desktop shortcut switch was performed only after:

1. Build and focused checks pass.
2. The daily frontend is verified on `5174`.
3. The embedded workflow is verified on `8766`.
4. Core learning flows are smoke-tested with a separate browser profile.
5. The next branch was committed locally; remote push remains a separate user-controlled action.
6. The old shortcut target is recorded for immediate rollback.
