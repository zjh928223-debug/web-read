# Lightweight Vocabulary Preview Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make preview vocabulary favor roughly B2+ words, news terms, and a small set of fixed expressions while keeping proper nouns out of SRS, keeping preview marks opt-in, and hiding obsolete manual lightweight-backfill buttons.

**Architecture:** Keep selection deterministic and local in `preview-scan.js`; do not add dependencies or another AI request. Fix preview-mark leakage at the lightweight-import boundary by excluding `preview-scan` items before rebuilding `markedMap`. Remove only the two visible buttons while preserving the hidden file input and all underlying lightweight-backfill APIs.

**Tech Stack:** Vue 3, Pinia, browser ES modules, Node.js assertion-based verification scripts, Vite.

## Global Constraints

- Keep the change fast and lightweight for a personal tool.
- Do not add dependencies or a complete CEFR dataset.
- Do not add another AI request.
- Do not change IndexedDB schema `SeekPlayerDB` version `1`, store `files`, key path `id`.
- Do not add feature logic to `src/composables/reader-runtime.js` or `src/composables/session-init.js`.
- Preserve the lightweight import/export implementation used by AI annotation.
- Do not modify unrelated dirty-worktree files.

---

### Task 1: Improve local preview candidate quality

**Files:**
- Modify: `scripts/vocabulary-preview-service-check.cjs`
- Modify: `src/services/vocabulary/preview-scan.js`

**Interfaces:**
- Consumes: `buildPreviewScan(options): Promise<PreviewScanResult>`
- Produces: normalized single-word candidates plus allowlisted fixed-expression candidates with the existing preview candidate shape.

- [ ] **Step 1: Add failing regression assertions**

Add a compact article fixture containing:

```js
function createPreviewStateFromWords(tokens) {
  return {
    hasAiChunkData: false,
    segments: [{
      segId: 'filter-segment',
      text: tokens.join(' '),
      words: tokens.map((word, globalIndex) => ({ word, globalIndex })),
    }],
  };
}

const lightweightFilterState = createPreviewStateFromWords([
  'Bus', 'three', 'cars', 'hour', 'video', "He'll", 'happened',
  'recovering', 'seismic', 'devastating', 'slammed', 'into', 'Florida'
]);
const lightweightFilterScan = await api.buildPreviewScan({
  state: lightweightFilterState,
  sourceId: 'article-lightweight-filter',
  maxCount: 20,
});
const filteredLemmas = lightweightFilterScan.candidates.map((candidate) => candidate.lemma);
['bus', 'three', 'car', 'hour', 'video', 'he', 'happen', 'recover'].forEach((lemma) => {
  assert.equal(filteredLemmas.includes(lemma), false);
});
assert.ok(filteredLemmas.includes('seismic'));
assert.ok(filteredLemmas.includes('devastating'));
assert.ok(lightweightFilterScan.candidates.some((candidate) => candidate.markedText.toLowerCase() === 'slam into'));
assert.ok(lightweightFilterScan.candidates.some((candidate) => candidate.group === api.PREVIEW_SCAN_GROUPS.PROPER_NOUN));
```

Use the existing state shape and assign stable `globalIndex` values to every token.

- [ ] **Step 2: Run the focused check and verify RED**

Run:

```powershell
npm run verify:vocabulary-preview
```

Expected: FAIL because common inflections remain candidates and `slam into` is not emitted.

- [ ] **Step 3: Add minimal lexical normalization and filtering**

In `preview-scan.js`:

- Normalize common contractions before lookup (`he'll` → `he`).
- Derive a conservative lookup lemma for `-s`, `-es`, `-ed`, and `-ing`.
- Expand the local basic-word set only for common A1–B1 words needed by the regression category.
- Keep the displayed token unchanged while using the derived lemma for filtering and aggregation.
- Add a small `FIXED_EXPRESSIONS` allowlist for explicit 2–4 token news expressions such as `slam into` and `crash into`.
- Build phrase occurrences from adjacent block words; do not generate arbitrary n-grams.
- Reduce frequency weight below lexical length/news-expression weight so repetition is only a tie-breaker.
- Do not classify a token as a proper noun solely because it is capitalized at the start of a block; require a title-cased occurrence away from block start or another positive signal.

- [ ] **Step 4: Run the focused check and verify GREEN**

Run:

```powershell
npm run verify:vocabulary-preview
```

Expected: `vocabulary preview service check passed`.

---

### Task 2: Keep preview results out of manual正文 marks

**Files:**
- Modify: `scripts/session-annotation-lightweight-io-check.cjs`
- Modify: `src/composables/session-annotation-lightweight-io.js`

**Interfaces:**
- Consumes: merged `normalized.generated.items`.
- Produces: the same saved generated bundle, while `rebuildMarksFromAnnotationItems(items, options)` receives only non-preview items.

- [ ] **Step 1: Add a failing source-boundary assertion**

Extend the focused check with:

```js
assert.ok(
  moduleSource.includes('function excludePreviewGeneratedItems(items)'),
  'lightweight import should define the preview-item boundary'
);
assert.ok(
  moduleSource.includes('rebuildMarksFromAnnotationItems(excludePreviewGeneratedItems('),
  'lightweight import should not rebuild reader marks from preview-scan items'
);
```

- [ ] **Step 2: Run the focused check and verify RED**

Run:

```powershell
npm run verify:session-annotation-lightweight-io
```

Expected: FAIL because preview items are currently passed into mark rebuilding.

- [ ] **Step 3: Filter only the mark-rebuild input**

Add:

```js
function excludePreviewGeneratedItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    const source = String(item && (item.source || item.provider || item.source_type || item.sourceType) || '').trim();
    const targetId = String(item && (item.targetId || item.target_id) || '').trim();
    return source !== 'preview-scan' && !targetId.startsWith('preview-');
  });
}
```

Pass `excludePreviewGeneratedItems(normalized.generated && normalized.generated.items)` to `rebuildMarksFromAnnotationItems`. Do not filter `storage.saveBundle`, generated-index refresh, SRS settlement, or the explicit preview toggle.

- [ ] **Step 4: Run focused import and preview checks**

Run:

```powershell
npm run verify:session-annotation-lightweight-io
npm run verify:session-annotation-bundle-merge
npm run verify:vocabulary-preview
```

Expected: all three checks pass.

---

### Task 3: Hide obsolete manual lightweight-backfill buttons

**Files:**
- Modify: `scripts/reader-dom-refs-check.cjs`
- Modify: `scripts/read-web-interactions-check.cjs`
- Modify: `index.html`
- Modify: `src/composables/reader-dom-refs.js`

**Interfaces:**
- Consumes: nullable DOM refs already accepted by `initManualLightweightAnnotationControls`.
- Produces: no visible export/import lightweight buttons; hidden `import-annotation-lightweight-file` remains available.

- [ ] **Step 1: Change UI assertions to the desired state**

In `reader-dom-refs-check.cjs`, assert that neither `index.html` nor `reader-dom-refs.js` owns:

```text
btn-export-annotation-lightweight
btn-import-annotation-lightweight
```

Keep the assertion that `import-annotation-lightweight-file` is collected.

In `read-web-interactions-check.cjs`:

- Record both export and import button presence.
- Expect both to be `false`.
- Keep `hasLightweightInput === true`.
- Remove the Playwright click/download assertion for the removed export button.

- [ ] **Step 2: Run UI checks and verify RED**

Run:

```powershell
npm run verify:reader-dom-refs
npm run verify:interactions
```

Expected: FAIL because both buttons still exist.

- [ ] **Step 3: Remove only visible buttons and obsolete refs**

Delete from `index.html`:

```html
<button id="btn-export-annotation-lightweight" ...>导出轻回填模板</button>
<button id="btn-import-annotation-lightweight" ...>导入轻回填结果</button>
```

Keep:

```html
<input type="file" id="import-annotation-lightweight-file" accept=".json" style="display: none;" />
```

Remove the two matching lookups from `reader-dom-refs.js`. Leave the feature-dependency properties and lightweight module intact; they will receive `undefined`/`null`, which the existing initializer supports.

- [ ] **Step 4: Run UI and AI annotation checks**

Run:

```powershell
npm run verify:reader-dom-refs
npm run verify:reader-app-runtime
npm run verify:annotation-lightweight-module
npm run verify:annotation-backfill-ai
```

Expected: all checks pass.

---

### Task 4: Integrated verification

**Files:**
- Verify only; modify production code only if a focused regression identifies a directly related defect.

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: evidence that preview, manual AI annotation, UI startup, and production build remain healthy.

- [ ] **Step 1: Run the complete relevant verification set**

Run:

```powershell
npm run verify:vocabulary-preview
npm run verify:vocabulary-srs
npm run verify:session-annotation-lightweight-io
npm run verify:session-annotation-bundle-merge
npm run verify:session-annotation-marks
npm run verify:reader-dom-refs
npm run verify:reader-app-runtime
npm run verify:annotation-lightweight-module
npm run verify:annotation-backfill-ai
npm run verify:interactions
npm run verify:vite
npm run build
```

Expected: every command exits `0`; the focused scripts print their `passed` message; Vite verification reports no page errors; production build completes successfully.

- [ ] **Step 2: Inspect the final diff**

Run:

```powershell
git diff --check
git status --short
git diff -- src/services/vocabulary/preview-scan.js src/composables/session-annotation-lightweight-io.js index.html src/composables/reader-dom-refs.js scripts/vocabulary-preview-service-check.cjs scripts/session-annotation-lightweight-io-check.cjs scripts/reader-dom-refs-check.cjs scripts/read-web-interactions-check.cjs
```

Expected: no whitespace errors, no unrelated user files modified, and the diff matches the approved design.
