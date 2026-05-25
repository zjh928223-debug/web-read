## Context

The repository has already completed a conservative first wave of helper extraction into:
- `data-utils.js`
- `identity-and-storage-keys.js`
- `import-export-shared-helpers.js`
- `sentence-notes-persistence-utils.js`

`app.js` still contains a small cloze-specific utility cluster around:
- `validateClozeData`
- `normalizeClozeAnswer`
- `escapeHtml`

Those functions are close to pure and sit immediately before cloze rendering functions:
- `buildClozeQuizMarkup`
- `handleClozeCheck`

The requested split is intentionally narrow: move only the low-risk utility subset and leave all UI behavior unchanged.

## Goals / Non-Goals

**Goals:**
- Create a dedicated `cloze-utils.js` helper module for cloze utility functions.
- Preserve all existing reader behavior, markup output, and event flow.
- Make `app.js` smaller and more legible without changing runtime sequencing.
- Keep the split small enough to serve as a first safe extraction step.

**Non-Goals:**
- Do not refactor `buildClozeQuizMarkup` or `handleClozeCheck`.
- Do not alter cloze card HTML structure, button text, or result logic.
- Do not change playback, highlighting, chunk rendering, or transcript rendering.
- Do not introduce a broader application state refactor.

## Decisions

### Decision: Extract only pure or near-pure cloze helpers
Rationale:
- `validateClozeData`, `normalizeClozeAnswer`, and `escapeHtml` do not depend on DOM state, playback state, or rendering order.
- They form a coherent mini-boundary around cloze data preparation.

Alternatives considered:
- Extract the full cloze block including `buildClozeQuizMarkup`.
  Rejected because it mixes rendering concerns and increases behavioral risk.
- Leave cloze logic in `app.js` and start with a higher-value render split.
  Rejected because the first safe split should optimize for low regression risk, not maximum scope.

### Decision: Keep `buildClozeQuizMarkup` in `app.js` for now
Rationale:
- It directly constructs UI markup and is coupled to current card rendering behavior.
- Keeping it local avoids accidental DOM or presentation changes during the first split.

Alternatives considered:
- Move all cloze functions together.
  Rejected because this would expand the change from utility extraction into render refactoring.

### Decision: Integrate `cloze-utils.js` the same way existing helper scripts are loaded
Rationale:
- The project already uses browser-global helper modules.
- Matching that pattern avoids bundler changes or module system migration.

Alternatives considered:
- Introduce ES modules or a bundling step.
  Rejected because it is out of scope and raises risk far beyond this change.

## Risks / Trade-offs

- [Risk] `validateClozeData` may rely on local assumptions that are currently implicit in `app.js` → Mitigation: keep function signature and returned shape unchanged.
- [Risk] Script load order could break if the new helper file is referenced after `app.js` → Mitigation: load `cloze-utils.js` before `app.js`, consistent with existing helper files.
- [Risk] A small extraction may feel low-impact compared with the overall size of `app.js` → Mitigation: treat this as the first safe split that establishes a repeatable extraction pattern.
- [Risk] `escapeHtml` is generic enough that future ownership may be ambiguous → Mitigation: scope it explicitly to cloze usage for now and defer broader shared-utility decisions.

## Migration Plan

No product migration is required.

Implementation sequence should be:
1. Add `cloze-utils.js`.
2. Move the approved cloze utility functions into that file.
3. Expose them on `window` in the same style as existing helper modules.
4. Update `app.js` call sites to read from the helper module.
5. Load `cloze-utils.js` before `app.js` in `read-26.html`.
6. Run existing syntax and smoke checks.

Rollback is straightforward:
- Restore the helper functions back into `app.js`.
- Remove the `cloze-utils.js` script include.

## Open Questions

- Should `escapeHtml` remain cloze-local long term, or eventually move into a broader shared rendering helper module?
- After this split, should the next safe step be cloze render helpers, or should the effort pivot to `processChunkData()` utility extraction first?
