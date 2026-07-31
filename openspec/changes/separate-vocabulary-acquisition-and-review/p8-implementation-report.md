# P8 exam vocabulary candidate import closure report

Date: 2026-07-28
Change: `separate-vocabulary-acquisition-and-review`
Scope: P8, tasks 9.1–9.7 only

## Outcome

P8 now has a standalone CSV/JSON import and context-matching vertical slice. Confirmed import rows
are written in one P6 unit of work as `candidate` acquisition units plus append-only
`candidate_queued` events. The confirmation callback checks the review repository before and after
each candidate write. It does not create `ReviewState`, and its result reports zero formal due
review entries.

The focused closure imports one synthetic row, reports its initial context gap and three actions,
adds an explicitly confirmed repository-authored licensed sentence, performs an exact 24-hour
cross-episode delayed check, graduates through the P6 service, and observes exactly one new
`review-state.v2` due item. No UI, shared index, legacy vocabulary service, article settlement, SRS
UI, IndexedDB schema, or real user database was changed.

## Default import contract and change points

The repository fixture documents the current product default:

| Field | Required | Default/normalization |
|---|---:|---|
| `lemma` | yes | NFKC, whitespace collapsed, English lowercase |
| `target_meaning` | no | NFKC text or `null`; it remains proposed metadata while the unit is a candidate |
| `exam_category` | yes | NFKC text |
| `exam_level` | yes | NFKC text |
| `source_id` | yes | NFKC opaque local source identifier |

CSV uses these exact headers. JSON accepts either a row array or `{ "rows": [...] }`. Language is
currently the documented fixed default `en`. These are the intentional modification points if a
later product decision changes real column names, makes category/level optional, or supports
additional languages. The importer does not guess aliases and does not require a sentence.

Preview reports malformed rows, empty rows, exact duplicate words, ambiguous duplicate lemmas with
no sense, existing exact/candidate units, existing words, and same-lemma different-sense cases.
Same-lemma different-sense rows remain confirmable and reuse an existing `word_id`; candidate
identity remains the `learning_unit_id`.

## Transaction and queue boundary

`confirmExamVocabularyImport()` uses the P6 `runVocabularyLearningUnitOfWork` contract:

1. Build normalized `LearningUnit` values with all target-sense fields `null`.
2. Check that no review state exists for each generated learning unit.
3. Put each learning unit, which creates its canonical candidate acquisition state.
4. Append one `candidate_queued` event per accepted row.
5. Recheck that no review state exists.
6. Commit the batch and command receipt together.

Any candidate/event/receipt failure aborts the whole batch. The failure-injection verification
compares the entire in-memory row snapshot and observes no partial candidate, event, review, or
receipt rows.

## Context matching and missing-context actions

`matchExamVocabularyCandidatesToUserContexts()` searches only local values supplied by the caller,
in fixed order:

1. imported article sentences;
2. imported subtitle segments;
3. user-local exam material.

It performs no network, IndexedDB, AI, or review call. Unknown-license matches remain pending rather
than becoming validated anchors. User-local exam material retains local source locators, and P2's
default export redacts sentence and surrounding text while retaining source ID, content hash, and
locator.

No-match results contain exactly these acquisition-only actions:

- `wait_for_natural_encounter` — “等待自然遇见”;
- `import_licensed_corpus` — “从许可语料导入”;
- `request_optional_ai_candidate` — “可选 AI 候选”.

The AI item is metadata only. There is no API handler in P8, and it is explicitly disallowed during
review. Licensed corpus evidence must be supplied as a local value with a license reference and
must be explicitly confirmed before it becomes validated.

## Fixtures and copyright/data boundary

All P8 sentences are repository-authored synthetic verification text. Fixtures declare that they
contain no user data and no exam originals. Source and fixture checks reject accidental IELTS or
Cambridge identifiers. P8 does not read a browser profile, open production IndexedDB, fetch a
network resource, or package any user/local exam sentence for redistribution.

Default export redaction is exercised against `user_local_exam_material`: the exported item has
source ID, SHA-256 and local locator but no sentence or surrounding text.

## P8 files and SHA-256

| File | SHA-256 |
|---|---|
| `src/services/vocabulary/exam-vocabulary-importer.js` | `4b519af604bec0c2b7f07872502b77e35eb287eea20039be93aba73a15c2afeb` |
| `src/services/vocabulary/exam-vocabulary-context-matcher.js` | `7fa12b134bd25cb243c158d76ee898b008480b48d524a595f1649c0db8dff0be` |
| `scripts/exam-vocabulary-import-closure-check.cjs` | `78e702105a3c8dc5c4c862e58701fdebc63064427df92d3127d4257ebdfa5f58` |
| `scripts/fixtures/exam-vocabulary-import-v1.json` | `ad6fed881019d16baf7235b2457d9ffffe29388124e70898496a0f25bb62e120` |
| `scripts/fixtures/exam-vocabulary-import-v1.csv` | `94e1d0a67c298fdd424b18b48a1e324cc544cfc3d4f8c4e15728426af9cff986` |
| `scripts/fixtures/exam-vocabulary-context-v1.json` | `db7f8893576f6b26d67b7b7e79e54dc8a9d4919c80f0407781b5e9be2fcb7572` |
| `openspec/changes/separate-vocabulary-acquisition-and-review/tasks.md` | `2f4ff934895aef57c828023f86bf6ad78e8bf99ae210578832fc45a054fdefad` |

This report excludes its own hash because embedding it would be self-referential.

## Preserved P1/P2/P3/P6 seams

P8 did not modify the following upstream files. Their raw SHA-256 values at final verification were:

| File | SHA-256 |
|---|---|
| `vocabulary-learning-models.js` | `5b75e25b046da1cda59d86db7427cbf44c5d21fe3d66a7a2f248e1c0a4409460` |
| `vocabulary-acquisition-repository.js` | `7a0b3a756cf5a2d82320a4114485cff9f52218c848bc20073eaa9fccee65aa13` |
| `vocabulary-context-evidence.js` | `91302840f51da8e013f2098f878c180c48db457c0412d0bffd904a0a4c03d78d` |
| `vocabulary-learning-events.js` | `0f1c221d6ccec672de7fc9ce67099b2fe53a511722b8cb353f46b7a95565fb93` |
| `vocabulary-acquisition-service.js` | `449f8bae13dbf290c13d794094dc7d420a04868f9b71bbc76091a68114cf10af` |
| `vocabulary-learning-uow.js` | `974053ae56a8feff0ee180774393b1e29841763794afd6d81fa2874295f0b3ba` |

## Verification matrix

| Command/check | Result |
|---|---|
| `node scripts/exam-vocabulary-import-closure-check.cjs` | PASS |
| `node scripts/vocabulary-acquisition-repository-check.cjs` | PASS |
| `node scripts/vocabulary-context-evidence-check.cjs` | PASS |
| `node scripts/vocabulary-learning-events-check.cjs` | PASS |
| `node scripts/vocabulary-command-receipt-fingerprint-check.cjs` | PASS |
| `node scripts/vocabulary-wave1-integration-check.cjs` | PASS |
| `npm run verify:vocabulary-acquisition-service` | PASS |
| `npm run verify:vocabulary-learning-uow-browser` | PASS after `npm ci` installed the locked Playwright dependency |
| `npm run verify:vocabulary-srs` | PASS |
| `npm run verify:vocabulary-preview` | PASS |
| `npm run verify:srs-review` | PASS |
| `npx --no-install openspec validate separate-vocabulary-acquisition-and-review --strict` | PASS |
| `npm run build` | PASS |
| `npm run verify:vite` | PASS: load, playback, interaction |
| P0 raw-byte guards | ENVIRONMENT-ONLY FAIL: existing CRLF/raw-byte mismatch recorded by the P6 report; protected files were not changed |

The P0 failures reproduce the already documented worktree-only conditions: the synthetic snapshot
raw hash differs only by line endings, the protected reader runtime raw hash differs while the file
is not dirty, and the contract regex expects LF while this checkout is CRLF. P8 did not rewrite or
relax any P0 artifact.

## OpenSpec state

- Schema: `spec-driven`
- Progress after P8: 56/98 complete
- Checked by P8: only 9.1–9.7
- P7, P9, P10 and later work remain unchecked
- Strict validation: PASS

## Canonical merge recommendation

Do not copy the whole dirty worktree. From a canonical tree that already contains P1–P6, copy only
the two P8 modules, three P8 fixtures, focused verification, and this report. Apply a narrow additive
edit that checks only tasks 9.1–9.7. Do not copy `package.json`, `package-lock.json`, any shared
vocabulary index/service, article settlement, SRS UI, generated logs, Playwright artifacts, or
unrelated existing changes.

Run the P8 focused check first, then the preserved P1/P2/P6 and Wave 1 checks, strict OpenSpec,
build, and Vite verification in canonical. No commit or push was created in this worktree.
