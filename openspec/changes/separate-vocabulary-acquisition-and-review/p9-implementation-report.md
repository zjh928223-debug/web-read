# P9 Legacy reassessment implementation report

## Scope and safety

P9 implements OpenSpec tasks 10.1–10.6 as an isolated Wave 2D module. It does
not modify the shared vocabulary index, legacy vocabulary service, article
settlement, SRS UI, or P7/P8/P10 files. It does not open IndexedDB, change
`SeekPlayerDB` version 1, add an object store, or access real user data.

The implementation is intentionally dry-run-only. `config.dry_run` must be
`true`; any attempt to enable a real migration is rejected. The feature flag
defaults to off.

## Implementation

`legacy-vocabulary-reassessment.js` provides:

- deterministic audit-manifest selection for `compatible`, `needs_context`,
  `needs_sense`, and `conflicting` items;
- reassessment candidates passed through P4 `planReviewSession()`, preserving
  due-review priority and a fixed ledger;
- an additional reassessment cap so the planner sees at most the configured
  small batch;
- five explicit operator outcomes: supplement target sense, supplement
  validated real context, confirm existing state, rebuild a P6-compatible
  `review-state.v2`, and skip;
- an in-memory dry-run repository with session snapshots, pause/resume state,
  processed-item idempotency, control journal, and append-only normalized
  `legacy_reassessed` events;
- original word/context/review-state/review-log snapshots on every selected
  item and event;
- processing reason, operator choice, audit and reassessment policy versions,
  and reassessment result on every event;
- logical feature-flag rollback. Rollback stops further writes but retains
  events, original legacy logs, confirmed target senses, confirmed contexts,
  and rebuilt/confirmed state artifacts.

Items not selected by the fixed ledger are returned in
`unselected_legacy_word_ids`. Planning never mutates their legacy state or due
date.

## Independent-review repair

The directed P9 repair closes two medium-severity gaps:

- Every normalized decision now receives a
  `SHA-256(canonical_json.v1(decision))` fingerprint using the P6 helpers.
  The fingerprint is persisted on both the item and complete result. An exact
  event-id/fingerprint retry returns the first complete result; any changed
  action, reason, operator choice, command/correlation id, timestamp, sense,
  context, or rebuilt state fails with `IDEMPOTENCY_CONFLICT` before mutation.
- `supplement_sense` now requires an exact association DTO containing
  `target_sense_id`, reassessment `learning_unit_id`, legacy `word_id`, and the
  five P1 TargetSense fields. Unknown/missing fields and mismatched identities
  are rejected. `deriveTargetSenseKey()` and `normalizeLearningUnit()` perform
  the P1 normalization and strict gloss/language/nullable-field validation.
  The normalized sense snapshot and id are identical in the item, result, and
  `legacy_reassessed` event.

Focused regression snapshots the entire in-memory repository before every
conflict or invalid-sense attempt and requires byte-equivalent JSON afterward.
It covers exact retries; changed action/reason/operator/command/correlation/
timestamp; changed sense/context/rebuilt-state payloads; and unknown fields,
empty gloss, invalid language, empty target-sense id, and mismatched unit/word
ids.

## Configurable defaults

The exported `DEFAULT_LEGACY_REASSESSMENT_CONFIG` is the single documented
configuration point:

| Field | Default | Meaning |
|---|---:|---|
| `max_batch_items` | `5` | Maximum offered legacy items per batch |
| `reassessment_budget_ms` | `180000` | Three-minute reassessment allocation |
| `estimated_item_ms` | `36000` | P4 initial per-item estimate |
| `dry_run` | `true` | Synthetic dry-run only; real migration rejected |
| `policy_version` | `legacy-reassessment-policy.v1` | Frozen decision policy |

A future integration owner may provide explicit values after user confirmation.
P9 does not choose or execute the first real-user batch.

## Synthetic rehearsal

`legacy-vocabulary-reassessment-cases.json` contains only synthetic records:

- a bad/orphan reference, skipped;
- a polysemy conflict, rebuilt as `review-state.v2`;
- a missing-sense item, supplemented with a target sense;
- a missing-context item, supplemented with validated open synthetic context;
- a compatible item, confirmed without rewriting its original state;
- one compatible unselected item whose future due date remains unchanged.

The focused check also proves due review consumes budget before reassessment,
pause/resume survives repository round-trips, duplicate item submission is
idempotent only for the same event, rollback retains all logs/content/events,
and the disabled feature flag rejects new batches.

## Files

- `src/services/vocabulary/legacy-vocabulary-reassessment.js`
- `scripts/fixtures/legacy-vocabulary-reassessment-cases.json`
- `scripts/legacy-vocabulary-reassessment-check.cjs`
- `openspec/changes/separate-vocabulary-acquisition-and-review/tasks.md`
- `openspec/changes/separate-vocabulary-acquisition-and-review/p9-implementation-report.md`

## Verification

Passed:

- `node scripts/legacy-vocabulary-reassessment-check.cjs`
- `node scripts/srs-review-policy-planner-check.cjs`
- `node scripts/legacy-vocabulary-audit-check.cjs`
- `node scripts/vocabulary-acquisition-service-check.cjs`
- `node scripts/vocabulary-learning-uow-browser-check.cjs`
- `node scripts/vocabulary-context-evidence-check.cjs`
- `node scripts/vocabulary-learning-events-check.cjs`
- `npm run verify:vocabulary-srs`
- `openspec validate separate-vocabulary-acquisition-and-review --type change --strict --no-interactive`
- `npm run build`
- `npm run verify:vite`

Retest source identity:

- base HEAD: `c623bb335b9082e7ab24479569a4f2250d5789fe`
- reassessment module blob: `bdd9675f76aeb28f6f6b9006fbfa55f7f27d479e`
- focused verification blob: `8f0e6c865cee86f0a1063fdaae9922ddd41ecf8a`
- synthetic fixture blob: `b22cd69ba2d7b98ff61bc2f30c6d8c94a9fe55b3`

Pre-existing/frozen-baseline guard failures, not changed by P9:

- `p0-contract-check.cjs`: its LF-only multiline regex does not match the
  current CRLF `p0-contracts.md`.
- `p0-architecture-guard.cjs`: current canonical
  `src/composables/reader-runtime.js` hash differs from the frozen P0 hash.
- `p0-snapshot-check.cjs`: current synthetic fixture bytes differ from the
  frozen public-test-key hash.

## Canonical merge guidance

Canonical should merge only the five P9-owned files listed above, after the
canonical owner independently decides how to reconcile the three frozen P0
guard baselines with the already-landed canonical P1–P6 state. No P9 export was
added to `src/services/vocabulary/index.js`; the designated integration owner
should add that export later. No commit or push was created.
