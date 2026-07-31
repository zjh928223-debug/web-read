# P6 canonical landing report

Date: 2026-07-28
Canonical workspace: `E:\read-web`
Source worktree: `C:\Users\0\.codex\worktrees\4997\read-web`
Base HEAD: `c623bb335b9082e7ab24479569a4f2250d5789fe`
Scope: P6 tasks 7.1–7.7 only

## Landing method and preserved work

Both worktrees shared the same base HEAD. The canonical workspace already contained uncommitted
P1–P5, Passage Preview, pronunciation, annotation, SRS UI, package-lock, Vite, and other user work.
The source copy of `package.json`, `design.md`, and the contextual acquisition spec was older than
the corresponding canonical P1 revisions, so those files were not copied wholesale.

The following reviewed P6 files were copied byte-for-byte:

- `src/services/vocabulary/vocabulary-acquisition-service.js`
- `src/services/vocabulary/vocabulary-learning-uow.js`
- `scripts/vocabulary-acquisition-service-check.cjs`
- `scripts/vocabulary-learning-uow-browser-check.cjs`
- `openspec/changes/separate-vocabulary-acquisition-and-review/p6-implementation-report.md`

Canonical-only additive edits:

- `package.json`: added `verify:vocabulary-acquisition-service` and
  `verify:vocabulary-learning-uow-browser`; all existing scripts and dependencies were preserved.
- `tasks.md`: checked only 7.1–7.7. Existing 1A.6–1A.8 stayed checked, and 8.x–10.x and all later
  work stayed unchecked.

No UI, IndexedDB schema, P1–P5 implementation, shared vocabulary export, article settlement,
review service V2, importer, reassessment flow, commit, stash, reset, cleanup, or push was added.

## OpenSpec state

- Schema: `spec-driven`
- Canonical progress: 49/98 complete, 49 remaining
- P6 7.1–7.7: complete
- P7–P10 (8.x–10.x): not started
- Strict validation: PASS

The canonical total is three tasks larger than the source report because canonical already had the
accepted Passage Preview follow-ups 1A.6–1A.8.

## Verification

| Command/check | Canonical result |
|---|---|
| `npm run verify:vocabulary-acquisition-service` | PASS |
| `npm run verify:vocabulary-learning-uow-browser` | PASS |
| P6 browser profile residue before/after | 0 / 0 |
| receipt fingerprint check | PASS |
| acquisition repository check | PASS |
| context evidence check | PASS |
| learning events check | PASS |
| SRS policy/planner check | PASS |
| legacy vocabulary audit check | PASS |
| Wave 1 integration check | PASS |
| P0 snapshot raw-byte check | PASS |
| P0 architecture guard | PASS |
| P0 contract check | PASS |
| `npx --no-install openspec validate separate-vocabulary-acquisition-and-review --strict` | PASS |
| `npm run build` | PASS |
| `npm run verify:vite` | PASS |
| vocabulary matching/SRS/preview focused checks | PASS |
| SRS review focused check | PASS |
| Passage Preview aggregate/unit checks | PASS |
| visual vocabulary focused check | PASS |

The source report recorded CRLF-only P0 failures in its checkout. They did not reproduce in the
canonical workspace: all three canonical P0 checks passed without rewriting protected files or
relaxing guards.

The production browser check used a random loopback origin and a disposable persistent Chromium
profile under the system temp directory. It created only synthetic `SeekPlayerDB` v1 data inside
that isolated profile, closed the browser/server in `finally`, deleted the profile, and left no
matching temp profile directory.

## Key SHA-256

| File | Raw SHA-256 |
|---|---|
| `src/services/vocabulary/vocabulary-acquisition-service.js` | `521f38b39a28d0d066245bea7d0f22d89984c63980b902503ee7db69ef8aa1cf` |
| `src/services/vocabulary/vocabulary-learning-uow.js` | `52b3bc790709801f9ff6b614eed847b27875f0d8c4b55bb6e918e662ebe1abd7` |
| `scripts/vocabulary-acquisition-service-check.cjs` | `c53692630fea845ad8108928fe9dd49fb3deef06ee87bdfece3889f5fe7418a4` |
| `scripts/vocabulary-learning-uow-browser-check.cjs` | `d12c86e32133628154f6200fae37ea01844d411cd3959241d4e5a7298b87ffdd` |
| `openspec/changes/separate-vocabulary-acquisition-and-review/p6-implementation-report.md` | `5355785e911279afa03b25e65e8abbd5df03a68a1fe4a69b513c5d33cc952a62` |
| canonical `package.json` after additive merge | `e0873ad1c8c425cbf0412784267bfaa11ec4a1ff08fee06279a2207c68673f23` |
| canonical `tasks.md` after additive merge | `663e97eeace2d8ef20e8b94cdfea90505fe0eed5cc86bdd81fc2c06cd5e47cc6` |

## Residual risks and downstream gate

- P6 remains intentionally absent from `src/services/vocabulary/index.js`; downstream integration
  owns shared exports and caller migration.
- The feature flag defaults off. No UI or legacy path invokes the new write path yet.
- Browser coverage is isolated and synthetic; application rollout and real-user observation remain
  downstream responsibilities.

P6 satisfies the technical prerequisite gate for beginning P7, P8, P9, or P10. This readiness is
not authorization to implement those phases, and their task boxes remain unchecked.
