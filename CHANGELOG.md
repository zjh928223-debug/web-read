# Changelog

## Next workspace — unreleased

This release is still isolated in `E:\read-web-next`. It must not replace the daily-use shortcut until backup/restore, long-duration stability, old-vs-next differential checks, and rollback rehearsal pass.

### Reliability and data safety

- Added atomic, recoverable JSON persistence with backup, quarantine, interrupted-write detection, bounded job logs, and restart state recovery.
- Added transaction-complete IndexedDB writes, versioned reader-session envelopes, checksums, quarantine, abortable commits, and fail-closed restore validation.
- Added latest-wins ledgers for marks and activity; removed duplicate observer-based saves.
- Added atomic vocabulary CAS/migration, Preview state, Annotation bundle, sentence warehouse swaps, and Gemini cache/rate-limit persistence.

### Performance and responsiveness

- Stream large workflow media with HTTP Range instead of copying 300–540 MB blobs into IndexedDB.
- Removed permanent paused playback animation loops and bounded UI observers/listeners with disposable lifecycle scopes.
- Localized active-word DOM changes and added fixed production browser budgets with screenshot, trace, JSON, provenance, and baseline-diff evidence.
- Added 1k/10k transcript gates. Current 10k hot-path P95 is about 18 ms for word/chunk/seek/mark; mode switching remains about 246 ms and is still an optimization target.

### Workflow service

- Added batch snapshots, bounded/coalesced persistence, request metrics, reliable process-tree supervision, NativePicker ownership/timeout behavior, and loopback/token boundaries.
- Moved annotation backfill to cancellable `202` operations with deadlines, retry jitter, and per-resource limits.
- Added stress coverage for 1/10/50 active jobs, mass cancellation/restart, half-written state, picker focus churn, timeout, and upstream 503 handling.

### Runtime and release architecture

- Added shared RuntimeConfig, fixed Node/Python locks, clean-room installation checks, secret/license/SBOM gates, and a Windows CI workflow.
- Added an independent Local App Host for built assets, workflow ASGI, Range media, and nine Node capability families. Vite remains a development fallback.
- Added process/port ownership, release/profile/instance identity, manifest health checks, crash/restart tests, and isolation from daily-use ports `5173/8765`.
- Removed retired notes compatibility runtime and classified or removed orphan verification scripts.

### Verification snapshot

- `verify:full`: fast gate, production build, isolated development and preview journeys, independent production-host journeys, reader-session interruption journeys, and backend suite.
- Production browser budget: 10/10 metrics passing across three independent Local App Host runs.
- Reader-session fault matrix: 10/10 journeys passing.
- Workflow stress suite: 5/5 scenarios passing; backend suite reached 107 tests at this checkpoint.

### Remaining migration blockers

- Complete multi-domain backup/import dry-run and atomic restore with rollback backup.
- Finish remaining compatibility/runtime decomposition and accessibility/offline failure journeys.
- Run 30-minute playback, heap-growth, real-data-copy recovery, old-vs-next differential, release manifest, and shortcut rollback rehearsal.
- Obtain explicit user approval before pushing or changing the desktop shortcut.

