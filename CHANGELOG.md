# Changelog

## Current daily promotion boundary — 2026-08-30

The current daily origin remains the protected `E:\read-web-next` Vite/dev compatibility path on
`5174/8766` with `E:\ReadWebData\SubtitleWorkflow-Next`. This optimization worktree adds an
independent, opt-in daily-production candidate that serves built assets through
`youtube_workflow.production_host_prototype`; it has not switched the desktop shortcut or claimed
six-domain Host authority. The legacy `E:\read-web` `5173/8765` target remains available for rollback.

## Next workspace — migrated locally on 2026-08-17

The stabilization and migration work is complete in `E:\read-web-next`. After the
isolated release gates and explicit user approval, the desktop learning shortcut was
switched to `E:\read-web-next\scripts\launch-next-preview.ps1`. The legacy workspace
remains available, and the rollback state is retained under
`output/release/desktop-shortcut-migration.json`.

### Reliability and data safety

- Added atomic, recoverable JSON and IndexedDB persistence with versioned envelopes,
  checksums, quarantine, rollback backups, interrupted-write recovery, and conflict-safe
  multi-domain restore.
- Added latest-wins ledgers for marks/activity, atomic vocabulary and Preview/Annotation
  updates, and durable workflow checkpoints with bounded logs.
- Verified a read-only copy of the real six-domain profile by restoring only into an
  isolated temporary root. Daily data and services were not written by the rehearsal.

### Performance and workflow service

- Streamed large workflow media with HTTP Range instead of copying 300–540 MB blobs into
  IndexedDB, and added explicit media resource ownership and cleanup.
- Replaced permanent playback work and unbounded observers with event-driven updates and
  disposable lifecycle scopes; added 1k/10k transcript and fixed browser budgets.
- Added workflow batch snapshots, coalesced persistence, reliable process supervision,
  cancellable background operations, NativePicker ownership, and 1/10/50-job stress tests.

### Runtime and release architecture

- Added shared RuntimeConfig, fixed Node/Python locks, clean-room checks, supply-chain
  gates, Windows CI, and an independent Local App Host for built assets and local APIs.
- Retired notes/root artifacts and the theme/audio/marks/UI compatibility stores. Pinia is
  configured before reader/session startup and non-component runtime consumers use an
  explicit registry; legacy state/bridge globals now have zero consumers.
- Split source-shape evidence into the canonical `verify:architecture:source-shape` layer
  and public interface behavior into `verify:behavior:migrated-interfaces`.

### Release evidence

- Three cold starts, crash/restart recovery, 30-minute playback, 120 A/B/A switches, the
  36-cell Quota/corruption matrix, and mass cancellation/restart completed in isolation.
- Legacy and Next each passed 21/21 matched journeys across three runs, with no browser or
  network errors and an aggregate performance ratio within the personal-project budget.
- Release manifests, artifact checksums, health checks, rollback, and shortcut rollback
  rehearsal passed before the explicitly approved desktop shortcut migration.
- The post-migration runtime cleanup passed `verify:fast`, the full Vite journeys,
  production build/startup, and the production preview gate.

### Auditable phase commits

Work was kept in reviewable commits instead of one migration dump. Representative phase
boundaries are:

| Phase | Representative commits |
| --- | --- |
| Production host, observability, clean-room | `7400fb8`, `c7957ec`, `0aa7df6`, `9905e78` |
| Persistence, session and workflow reliability | `293c0a5`, `7b7d609`, `f8ff483`, `944b49a`, `68c286e` |
| Runtime decomposition and legacy cleanup | `9666e6f`, `1d4b462`, `33483a5`, `e02062c`, `a582a0b` |
| Backup and atomic restore | `83c6e61`, `49c0b39`, `3e3a0e0`, `22429fd`, `8c841f2` |
| Stability, differential and release controls | `597e9fd`, `9bd1bc3`, `b3a3bf6`, `a1a7e04`, `88dfb10` |
| Architecture/behavior test ownership | `55563e9` |

### Remote handoff boundary

The completed work is on local branch `codex/read-web-next`. Remote `origin` is configured,
but this branch has no upstream and no push was performed. Selecting the remote branch,
setting upstream, or pushing requires a separate explicit confirmation.
