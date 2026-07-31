# P6 acquisition and atomic graduation implementation report

Date: 2026-07-28
Change: `separate-vocabulary-acquisition-and-review`
Scope: P6, tasks 7.1-7.7 only

## Workspace and task state

- Worktree: `C:\Users\0\.codex\worktrees\4997\read-web`
- Canonical `E:\read-web` remained read-only.
- No commit, merge, stash, cleanup, or push was performed.
- Passage Preview, pronunciation, annotation, SRS UI, 1A tasks, and all other user changes were preserved.
- Live progress after this repair: 46/95. Tasks 7.1-7.7 remain checked; 8.x and later remain unchecked.

## Frozen Wave 1 baseline

The following SHA-256 values are the LF-normalized hashes recorded before P6 implementation. The
corresponding P1-P5, receipt, and Wave 1 files were not modified.

| Owner | File | SHA-256 |
|---|---|---|
| P1 | `src/services/vocabulary/vocabulary-learning-models.js` | `4a476b29917b426d44979c73fbc6a923c37658f9b1ae547f5c8e949652c7eaab` |
| P1 | `src/services/vocabulary/vocabulary-acquisition-repository.js` | `355759656f3a4826032752550463e10566ec69049a0989361d3fc26367f083f7` |
| P1 | `scripts/vocabulary-acquisition-repository-check.cjs` | `952820f635b7ffe43ec496c1f1599ea5154d7376e52321e0672803b1c1ca58b2` |
| P2 | `src/services/vocabulary/vocabulary-context-evidence.js` | `29f0d1cce5707e7d14acb4d5d4e9f2bae1f4dce963e2c1dee389f6e0f51d11ea` |
| P2 | `scripts/vocabulary-context-evidence-check.cjs` | `d324d5fd3470a24e88ec08df21c471c3bf111216b1585e484a92e7b6824e759f` |
| P2 | `scripts/fixtures/vocabulary-context-evidence.v1.json` | `6d0ed9356abadebe183fa193f4f730cbb254e5cffe8941641cc6313af6ab09df` |
| P3 | `src/services/vocabulary/vocabulary-learning-events.js` | `6eebf3017b1df9ee59ba8de706b8e17078eceba34a0432a8c691032f5b045086` |
| P3 | `scripts/vocabulary-learning-events-check.cjs` | `5a809a395d0684a6c849ef99fffbf226d021a663d9d03cd1d62b5a7702e0ab50` |
| P3 | `scripts/fixtures/vocabulary-learning-events.fixture.json` | `29f7fa6354f8492b4939f9a8227ca5358a413b31ee453001c3116bba71643f3b` |
| P4 | `src/features/srs-review/srs-review-policy.js` | `af70589d5dc57399dcb3be3926a434ae4333ed7a4abe41a8b582b67552bba5b1` |
| P4 | `src/features/srs-review/srs-session-planner.js` | `e0af7b012efa9405baa6096f63fb386ae791e7b985e9f77599687684c538fde0` |
| P4 | `scripts/srs-review-policy-planner-check.cjs` | `8ceb8b87fa3ff46fcc90433f512fed15bb26c7c3f5e9226b8ed39efcc5eac5ff` |
| P4 | `scripts/fixtures/srs-review-policy-planner-fixtures.json` | `96a4d51f5fe6db27c53e8c5a6520f0ea4ac7f84f247289e97206f3490c55c1f1` |
| P5 | `src/services/vocabulary/legacy-vocabulary-audit.js` | `3ba08324483dd21bebd14fd3fbf461dd19b5ea25a0dce9c2e3253b52266c75f9` |
| P5 | `scripts/legacy-vocabulary-audit-check.cjs` | `12e1257cbf5561c5750ecd3cabf61e97e9f80ecb11f4ecadd4c61dd11270141f` |
| P5 | `scripts/fixtures/legacy-vocabulary-audit-cases.json` | `717ec97168deec15964da80d804ee09c2952e0a479f4a0370a786117ea58fced` |
| Receipt | `scripts/vocabulary-command-receipt-fingerprint-check.cjs` | `512fe69296cf3eaeaaf6786786b3d9b5ae2595b22158bc4c07b3ad46a67f9e94` |
| Receipt | `scripts/fixtures/vocabulary-command-receipt-fingerprint-vectors.v1.json` | `de4a85a5e4ab8bcf69fbea3e4f2fbfaf54fcbf50527c854f4ceda1efb0adf88a` |
| Wave 1 | `scripts/vocabulary-wave1-integration-check.cjs` | `aa458117388adeb1361596722c01d490e1f36803837d132b3d58543250a2d0a6` |

## P6 files and SHA-256

| File | SHA-256 |
|---|---|
| `src/services/vocabulary/vocabulary-acquisition-service.js` | `521f38b39a28d0d066245bea7d0f22d89984c63980b902503ee7db69ef8aa1cf` |
| `src/services/vocabulary/vocabulary-learning-uow.js` | `52b3bc790709801f9ff6b614eed847b27875f0d8c4b55bb6e918e662ebe1abd7` |
| `scripts/vocabulary-acquisition-service-check.cjs` | `c53692630fea845ad8108928fe9dd49fb3deef06ee87bdfece3889f5fe7418a4` |
| `scripts/vocabulary-learning-uow-browser-check.cjs` | `d12c86e32133628154f6200fae37ea01844d411cd3959241d4e5a7298b87ffdd` |
| `package.json` | `3678e73c6983dd3c3ac97b3e1769bef24d86163e1b43bffa3c0e4caecf693c36` |
| `openspec/changes/separate-vocabulary-acquisition-and-review/tasks.md` | `fb46ea4069f60000cb4353ec20a73878980342846441abbe971982277c8ed061` |

This report excludes its own hash because embedding it would be self-referential. `package.json`
already contained the user-owned Passage Preview script; P6 owns only its two acquisition/UoW
verification scripts.

## Public API and state machine

`vocabulary-acquisition-service.js` exports:

- `VOCABULARY_ACQUISITION_FEATURE_FLAG`
- `createVocabularyAcquisitionService({ enabled, now, runUnitOfWork })`
- `queueCandidate`, `selectTargetSense`, `introduceCandidate`, `attachContextEvidence`,
  `recordAcquisitionAttempt`, `markReadyForCheck`, `graduateLearningUnit`, and `skipLearningUnit`

`vocabulary-learning-uow.js` exports:

- `canonicalJson`, `sha256Utf8`, and `fingerprintVocabularyLearningCommand`
- `createVocabularyLearningTransactionRowPort`
- `normalizeReviewState` and `bindReviewRepositoryToTransaction`
- `assembleVocabularyLearningUnitOfWork` and `runVocabularyLearningUnitOfWork`
- `createInMemoryVocabularyLearningUnitOfWorkRunner` for deterministic tests

The service directly uses the reviewed P1/P2/P3 normalizers, evaluator, and transaction binders.
It does not duplicate them. The guarded state machine is:

```text
candidate -> introduced -> acquiring -> ready_for_check -> graduated
candidate|introduced|acquiring|ready_for_check -> skipped
graduated|skipped -> terminal
```

## Review repair findings

### 1. Raw payload validation before fingerprinting

`normalizeServiceCommand` now calls the frozen `canonical_json.v1` implementation on the original
`raw.payload` before cloning, normalization, UoW entry, or fingerprinting. Only a successfully
validated JSON value is cloned, so the clone preserves its JSON semantics. Contract failures use
`INVALID_FIELD_TYPE`, and details contain only the contract/field metadata.

The public-service regression constructs NaN, positive/negative Infinity, Date, object `undefined`,
array `undefined`, and a custom-prototype object. Each invalid value is paired with the legal value
that old `JSON.stringify/parse` cloning would collide with. Every invalid command is rejected before
both `runUnitOfWork` and its callback; both invocation counters remain zero.

RED evidence:

```text
npm run verify:vocabulary-acquisition-service
AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

The same command is GREEN after the raw validation fix.

### 2. Only delayed checks can qualify

`recordAcquisitionAttempt` evaluates and persists graduation eligibility only for
`attempt_kind === "delayed_check"`. Exposure and reassessment persist
`graduation_eligibility: null` and cannot be qualifying attempts. Graduation explicitly rechecks
the persisted attempt kind before consulting `.eligible`; a non-delayed attempt is rejected with
the existing frozen `RATING_NOT_ELIGIBLE` contract error.

Focused tests prove that exposure+good and reassessment+good cannot graduate even with a target
sense, validated anchor, 24 hours, a different episode, and an unrevealed answer. The delayed-check
success path remains covered.

### 3. Event partition is bound to the action month

Every public command validates `event_partition` before UoW/receipt creation against the
authoritative UTC timestamp:

- queue: `learning_unit.created_at`
- select/introduce/attach/mark-ready/skip: `payload.occurred_at`
- attempt: `payload.attempt.occurred_at`
- graduation: `payload.graduated_at`

Bad format or a different UTC month raises `INVALID_EVENT_PARTITION` without user text in details.
Tests cover an event-appending queue command plus no-event introduce, mark-ready, and skip commands;
all prove unchanged rows and no receipt/UoW execution.

### 4. Production IndexedDB regression

`verify:vocabulary-learning-uow-browser` launches disposable persistent Chromium with a temporary
profile and random local origin. Test setup alone creates a synthetic fixed
`SeekPlayerDB` version 1, `files` store, `keyPath: "id"` database. It imports and runs the production
service/UoW modules in the browser; no production schema creation or upgrade path was added.

The check covers:

- first production command, event rows, and receipt;
- same command/fingerprint after page refresh with callback count zero, deep-copy isolation, and
  unchanged result, timestamps, events, and rows;
- changed fingerprint with `IDEMPOTENCY_CONFLICT` and unchanged rows;
- callback failure and real IndexedDB request abort with complete rollback;
- successful Promise resolution only after the readwrite transaction `complete` event;
- missing database/store, wrong keyPath, and wrong database version rejection;
- context close and disposable profile deletion in `finally`.

The browser profile and origin are isolated from user browser data and contain synthetic text only.

## Transaction, graduation, receipt, and feature flag

Production UoW opens only existing `SeekPlayerDB` version 1 and one `files` readwrite transaction.
It creates one transaction row port, passes that same port separately to the P1 acquisition, P2
context, P3 event, and P6 review binders, and only then assembles the callback-facing UoW. Binders
receive no complete UoW and open no transaction.

Graduation re-reads unit, state, attempt, and anchor in the same transaction; revalidates anchor
identity/quality and delayed-check eligibility; rejects an existing ReviewState; and atomically
writes exactly one initial `review-state.v2`, graduated acquisition state, event shard/manifest, and
receipt. Request, callback, event, manifest, review, acquisition, and receipt failures abort all
writes. Success resolves only on transaction `oncomplete`.

Receipts use the frozen canonical JSON, fingerprint envelope, SHA-256, FileRow, result hash, and
stable errors. Same command+fingerprint returns a deep clone of the first result without callback
execution or time/event changes. A changed fingerprint returns `IDEMPOTENCY_CONFLICT` with no row
changes.

`VOCABULARY_ACQUISITION_ENABLED` remains versioned and off by default. Off rejects before UoW
entry; it does not delete rows written while enabled. P6 did not connect it to UI, shared exports,
article settlement, or legacy paths.

## Failure-injection and focused coverage

Focused/in-memory coverage includes successful exact-24-hour cross-episode graduation, 24 hours
minus 1 ms, same episode, missing/pending anchor, revealed answer, `again`, missing rating, two
active senses for one word, duplicate active sense, state jumps, terminal states, duplicate click,
refresh idempotency/conflict, unique initial review state, feature flag off/on/off-after-data, and
failure injection at anchor read, review write, acquisition write, event shard, manifest, and
receipt. Every failure compares the complete row snapshot before and after.

The new Chromium check adds production database open/schema/readwrite/oncomplete/onabort/close and
refresh persistence coverage. Neither verification accesses real user IndexedDB data.

## Verification matrix

| Command | Result |
|---|---|
| `npm run verify:vocabulary-acquisition-service` | PASS |
| `npm run verify:vocabulary-learning-uow-browser` | PASS |
| `node scripts/vocabulary-command-receipt-fingerprint-check.cjs` | PASS |
| `node scripts/vocabulary-acquisition-repository-check.cjs` | PASS |
| `node scripts/vocabulary-context-evidence-check.cjs` | PASS |
| `node scripts/vocabulary-learning-events-check.cjs` | PASS |
| `node scripts/srs-review-policy-planner-check.cjs` | PASS |
| `node scripts/legacy-vocabulary-audit-check.cjs` | PASS |
| `node scripts/vocabulary-wave1-integration-check.cjs` | PASS |
| P0 snapshot | ENVIRONMENT-ONLY FAIL: raw CRLF hash `864044...`, normalized/frozen hash `d66511...` |
| P0 architecture | ENVIRONMENT-ONLY FAIL at first raw-byte seam hash |
| P0 contract | ENVIRONMENT-ONLY FAIL on raw `\n` signature regex after semantic checks |
| frozen normalized-content comparison | PASS for all 10 snapshot/entrypoint/IDB seam/contract files |
| `npx --no-install openspec validate separate-vocabulary-acquisition-and-review --strict` | PASS |
| `npm run build` | PASS |
| `npm run verify:vite` | PASS: load, playback, and interaction |
| `npm run verify:vocab-matching` | PASS |
| `npm run verify:vocabulary-srs` | PASS |
| `npm run verify:vocabulary-preview` | PASS |
| `npm run verify:srs-review` | PASS |
| `npm run verify:passage-preview` | PASS |

The P0 failures are checkout byte-format failures only. In-memory LF normalization produced content
identical to canonical for all protected files, including the mixed-line-ending canonical
`src/stores/audio.js`; no file was rewritten, converted, or used to relax a guard.

## Residual risks and downstream gate

- P6 is intentionally absent from `src/services/vocabulary/index.js`; P10 owns shared export and
  integration.
- No review session/query policy, importer, reassessment flow, article settlement, or UI wiring was
  implemented.
- Production IndexedDB coverage is isolated and synthetic; application rollout remains owned by
  downstream integration.

All four review findings are repaired and all non-environment gates pass. Tasks 7.1-7.7 remain
complete. Technical prerequisites are available for P7, P8, P9, and P10; this is readiness only,
not authorization or implementation of those phases.
