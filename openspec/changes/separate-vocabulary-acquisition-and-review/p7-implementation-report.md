# P7 Review service V2 and session ledger implementation report

Date: 2026-07-28
Change: `separate-vocabulary-acquisition-and-review`
Scope: P7, tasks 8.1–8.7 only
Base HEAD: `c623bb335b9082e7ab24479569a4f2250d5789fe`

## Scope and ownership

This worktree already contained the uncommitted canonical P1–P6 and unrelated user changes. P7
added only the Review service V2, session-ledger persistence, focused verification, this report,
and the 8.1–8.7 task checkboxes.

P7 did not modify `src/services/vocabulary/index.js`, `vocabulary-service.js`,
`src/features/srs-review/useSrsReview.js`, SRS UI/CSS, article settlement, shared runtime entry
files, P8–P10 implementation, `package.json`, or `package-lock.json`. No commit, push, migration,
real-user IndexedDB access, cleanup, reset, or copy to `E:\read-web` was performed.

## Public API

`srs-review-service-v2.js` exports:

- `SRS_REVIEW_SERVICE_V2_VERSION`
- `SRS_REVIEW_ATTEMPT_COMMAND_TYPE`
- `createSrsReviewServiceV2(options)`
  - `startReviewSession(input)`
  - `recordReviewAttempt(input)`
  - `resumeReviewSession(session_id, options)`
  - `completeReviewSession(session_id)`

`srs-review-session-ledger.js` exports:

- `SRS_REVIEW_SESSION_LEDGER_ROW_ID`
- `SRS_REVIEW_SESSION_LEDGER_STORE_SCHEMA`
- `normalizeReviewSessionLedger(input)`
- `createInMemoryReviewSessionLedgerRepository(seed)`
- `createIndexedDbReviewSessionLedgerRepository({ indexedDBApi? })`
- `createIndexedDbReviewStateReader({ indexedDBApi? })`

The new session row is `vocabulary.review-session-ledgers.v1`. It uses the existing
`SeekPlayerDB` version 1 `files` object store with key path `id`. It is not a second ReviewState
store. ReviewState reads and writes continue to use P6
`bindReviewRepositoryToTransaction()` and `vocabulary.review.store.v2`.

## Review queue and fixed ledger

`startReviewSession()` loads the acquisition snapshot, filters to `status === "graduated"` before
querying ReviewState, skips missing or future states, and uses P4
`estimateActiveAttemptDuration()`, `normalizeReviewPolicy()`, and `planReviewSession()`.

The persisted ledger freezes:

- `policy_version`, `mode`, `budget_ms`, and personal/default speed estimate;
- deterministic entry order, queue kind, planned due time, duration estimate, and enqueue reason;
- cursor, completed item IDs, attempt IDs, revisit counts, and active duration;
- backlog and P4 completion estimates.

Starting the same session ID returns the stored ledger and does not silently re-plan it.

## Attempt transaction and metadata

`recordReviewAttempt()` accepts only `again`, `hard`, `good`, or `easy`. Rating is passed alone to
the existing scheduler. `prompt_mode`, `cue_level`, answer reveal, context, duration, and content
metadata are recorded independently.

The P6 unit of work atomically:

1. re-reads the LearningUnit and requires its AcquisitionState to be `graduated`;
2. reads the active ReviewState through P6 `ReviewTransactionRepository`;
3. schedules using the rating;
4. updates the same review-state.v2 row with optimistic revision checking;
5. appends a P3 `review_attempt_recorded` event with full before/after state, scheduler version,
   correlation ID, session position, prompt/cue metadata, and training eligibility;
6. commits the P6 command receipt.

The attempt-level canonical fingerprint is independent of transport `command_id`, `event_id`,
`correlation_id`, and event partition, but includes every scheduling/analysis input, including
`active_duration_reliable`. The P6 command payload also includes the reliability field, so both
attempt-level and same-command receipt conflicts are detected.

The same UoW event stores `attempt_id -> attempt_fingerprint + first_result`. This is the durable
attempt receipt index: the P6 CommandReceipt remains the authoritative command receipt, while the
append-only event makes the first complete result discoverable by attempt ID after a refresh.
The ledger caches the same mapping only as a recoverable projection. A same attempt/fingerprint,
including a retry with a new command/event ID, returns the first result without scheduling or
appending again; changed semantic content returns `IDEMPOTENCY_CONFLICT`.

Focused verification proves `good + original_context/target_sentence` and
`good + word_only/none` produce identical scheduler rating and `after_state`, while their event
analysis metadata remains different.

## Same-day policies and recovery

- `once_daily` never inserts a same-day revisit.
- `balanced` allows new/learning/relearning or `again` at the P4 15-minute eligibility time, at
  most one completed revisit per local day.
- `intensive` follows eligible scheduler short steps and the P4 safety cap.
- Revisit insertion checks both the policy count and the remaining session time budget.
- Ledger `planned_due_at` never replaces or rewrites the scheduler's historical/new `due_at`.

The ReviewState/event/receipt transaction commits before the ledger projection. If a refresh or
ledger `put` failure occurs in that narrow interval, both `resumeReviewSession()` and
`recordReviewAttempt()` first reconcile the persisted ledger from P3 append-only review events.
Reconciliation restores the attempt fingerprint and exact first result before deciding whether a
submission is new. Already committed attempts therefore advance the cursor and return their first
result without scheduling, event append, or receipt creation. Conflicting persisted attempt
receipts fail closed. A session resumed on another local day is reconciled before it is completed
or abandoned.

## Focused coverage

`node scripts/srs-review-service-v2-check.cjs` covers:

- only graduated units are queried for active ReviewState;
- missing/future ReviewState exclusion and due ordering;
- frozen policy/mode/budget/speed/order/reason/backlog;
- the production `ts-fsrs` scheduler executing all four ratings and invalid rating no-write
  behavior;
- prompt/cue/rating separation and the two `good` metadata cases;
- FSRS-compatible before/after snapshots, scheduler version, event, and correlation data;
- same attempt replay, changed-fingerprint conflict, changed reliability conflict, and unchanged
  rows;
- UoW success followed by injected ledger failure, new service instance, event-based resume,
  original-command retry, and new-command/new-event retry;
- exact first-result recovery plus unchanged ReviewState revision, event count, receipt count, and
  complete row snapshot across all retries;
- `active_duration_reliable=false` training exclusion and fingerprint participation;
- `once_daily`, `balanced`, and `intensive`;
- balanced delay, one-revisit limit, budget exhaustion, and unchanged scheduler due date;
- fixed ledger, completion, append-only event recovery, refresh reconciliation, and cross-day
  abandonment;
- fixed IndexedDB schema guard and explicit reuse of the P6 review binder.

`node scripts/srs-review-session-ledger-browser-check.cjs` uses a disposable Chromium profile and
random loopback origin to verify production IndexedDB row create/read/update/refresh behavior,
optimistic revision conflict, and the unchanged `SeekPlayerDB` version 1 / `files` / `id` schema.
Only synthetic data is used and the profile is deleted in `finally`.

## Verification matrix

| Check | Result |
|---|---|
| P7 focused service/session ledger | PASS |
| P7 production IndexedDB session ledger browser | PASS |
| P6 acquisition service focused | PASS |
| P6 production IndexedDB browser | PASS |
| P3 learning events | PASS |
| P4 policy/planner | PASS |
| P0 receipt/fingerprint vectors | PASS |
| P1 acquisition repository | PASS |
| P2 context evidence | PASS |
| Wave 1 integration | PASS |
| Existing vocabulary SRS | PASS after installing lockfile-declared local dependencies |
| Existing SRS review | PASS after installing lockfile-declared local dependencies |
| OpenSpec strict validation | PASS |
| `npm run build` | PASS |
| `npm run verify:vite` | PASS |
| P0 raw snapshot/architecture/contract guards | KNOWN ENVIRONMENT-ONLY FAIL |

The three P0 guard failures reproduce the CRLF/raw-byte mismatch already documented by the P6
implementation report: fixture hash `864044…` vs pinned LF hash `d66511…`, raw protected-file hash,
and `\n`-specific contract regex against CRLF content. P7 did not modify those protected files or
relax the guards.

The worktree initially lacked `node_modules/ts-fsrs`. `npm install --ignore-scripts --no-audit
--no-fund` installed lockfile-declared local dependencies. Before/after SHA-256 values of
`package.json` and `package-lock.json` were identical.

## File SHA-256

| File | SHA-256 |
|---|---|
| `src/services/vocabulary/srs-review-service-v2.js` | `0ef403c6eea36e3d7ca0782dbe9ea3270dc4341bb77dc767c5df887590b0e233` |
| `src/services/vocabulary/srs-review-session-ledger.js` | `1b6fccf7b6be8507a9231d81712e470b3c9da277357da9603628f280d7a21a1c` |
| `scripts/srs-review-service-v2-check.cjs` | `65aadef5cc8253b6312b3b46fcb447e730cf0c3f542c8523f0eda379f71f85b5` |
| `scripts/srs-review-session-ledger-browser-check.cjs` | `1cbb6745928d5dc67df6746fcd40032ddd9d603be34a0e54a75ce0d3bdcd58ef` |
| `openspec/changes/separate-vocabulary-acquisition-and-review/tasks.md` | `25d470f2256984cd84ac536f3113d25b22c5282888201f9e935519562c6bb2ac` |

The report excludes its own hash because embedding it would be self-referential.

## Canonical landing recommendation

Merge/copy only these P7 additions:

1. `src/services/vocabulary/srs-review-service-v2.js`
2. `src/services/vocabulary/srs-review-session-ledger.js`
3. `scripts/srs-review-service-v2-check.cjs`
4. `scripts/srs-review-session-ledger-browser-check.cjs`
5. this report

Apply only the seven 8.1–8.7 checkbox changes from `tasks.md`; do not copy the whole OpenSpec
directory over canonical. Preserve all existing canonical user work. P10/P11 should later own
shared exports and UI wiring respectively.
