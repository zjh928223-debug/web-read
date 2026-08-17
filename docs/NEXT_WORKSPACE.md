# Read-Web Next Workspace

`E:\read-web-next` is the isolated development workspace for the next version of Read-Web.

## Safety contract

- The current learning installation remains at `E:\read-web`.
- The desktop learning shortcut was migrated with user approval on 2026-08-17 and now launches `E:\read-web-next` on ports `5174` and `8766`.
- Development and verification here use ports `5174` and `8766`.
- `scripts/launch-next-preview.ps1` starts only that isolated preview pair.
- Do not stop or replace the current learning processes during development.
- Do not rewrite the desktop shortcut automatically; its original `E:\read-web` target remains the rollback target.

## Repository identity

- Branch: `codex/read-web-next`
- Snapshot baseline: current working learning app plus the embedded subtitle workflow.
- The subtitle workflow source is owned here at `tools/subtitle-workflow`.

## Local data

Learning data remains outside Git:

- Current learning workflow data: `E:\ReadWebData\SubtitleWorkflow`
- Isolated preview workflow data: `E:\ReadWebData\SubtitleWorkflow-Next`
- Dictionaries: sourced read-only from `E:\read-web\data\dictionaries` during the transition. The launcher passes explicit database paths, so the next code workspace does not copy the 6.5 GB dictionary tree.

Do not copy generated media, browser profiles, credentials, or dictionary databases into Git.

## Migration record

The desktop shortcut was switched only after:

1. Build and focused checks pass.
2. The next frontend is verified on `5174`.
3. The embedded workflow is verified on `8766`.
4. Core learning flows are smoke-tested with a separate browser profile.
5. The next branch was committed locally; remote push remains a separate user-controlled action.
6. The old shortcut target is recorded for immediate rollback.
