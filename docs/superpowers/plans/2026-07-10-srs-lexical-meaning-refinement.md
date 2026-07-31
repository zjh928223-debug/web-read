# SRS Lexical Meaning Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI refinement generate a short Chinese gloss for the selected expression itself, using only local context for disambiguation and never substituting the expression's article-specific referent.

**Architecture:** Keep the current single-request refinement flow and existing SRS persistence schema. Strengthen the request contract at both the frontend template and backend system-prompt boundaries, pass only per-item local context, and version the prompt so results produced under the old referent-compression contract can be explicitly regenerated once.

**Tech Stack:** Vue 3 compatibility runtime, ES modules, Node assertion checks, FastAPI/Python unittest, Gemini structured JSON output.

## Global Constraints

- Do not upload `articleText`, `articleSentences`, or the full transcript for SRS meaning refinement.
- Do not store prompt examples, article context, or full article text in SRS entries.
- Preserve `SeekPlayerDB` version 1, object store `files`, key path `id`.
- Keep one Gemini request for the selected refinement candidates.
- Treat contextual `meaning/explanation` as disambiguation evidence, not as the output to compress verbatim.
- Do not commit or stage the dirty accumulated worktree unless the user explicitly asks.

---

### Task 1: Lock the lexical-gloss request contract with failing tests

**Files:**
- Modify: `scripts/vocabulary-preview-service-check.cjs`
- Modify: `E:/read-web-worktrees/next-feature-20260629/tools/subtitle-workflow/tests/test_service_app.py`

**Interfaces:**
- Consumes: `buildSettlementMeaningRefinementTemplate({ candidates, sourceId })`.
- Produces: assertions for local-only context, general few-shot contrasts, and absence of full-article fields.

- [ ] **Step 1: Add the realistic frontend regression fixture**

Use an `invisible gas` phrase whose contextual explanation explicitly names ethylene, then assert that the template contract says the lexical gloss is `不可见气体`, not `乙烯气体`.

```js
assert.ok(instructions.includes('invisible gas'));
assert.ok(instructions.includes('不可见气体'));
assert.ok(instructions.includes('乙烯气体'));
assert.equal(Object.hasOwn(template, 'articleText'), false);
assert.equal(Object.hasOwn(template, 'articleSentences'), false);
```

- [ ] **Step 2: Add backend prompt assertions**

```python
self.assertIn("lexical gloss", calls[0]["prompt"])
self.assertIn("the capital", calls[0]["prompt"])
self.assertIn("ethylene gas", calls[0]["prompt"])
self.assertNotIn("Why Bananas Ripen So Much Faster Than Other Fruits", calls[0]["prompt"])
```

- [ ] **Step 3: Run both focused suites and confirm RED**

Run:

```powershell
npm run verify:vocabulary-preview
python -m unittest tests.test_service_app
```

Expected: failures on the new lexical-gloss and generic-example assertions.

### Task 2: Send local context without full article content

**Files:**
- Modify: `src/services/vocabulary/settlement-meaning-refinement.js`
- Test: `scripts/vocabulary-preview-service-check.cjs`

**Interfaces:**
- Consumes: `candidate.context.surrounding_text`, falling back to `candidate.context.sentence`.
- Produces: per-item `localContext` and `contextualExplanation`; no top-level article body.

- [ ] **Step 1: Add bounded local-context extraction**

```js
const localContext = truncateText(
  candidate.context && (candidate.context.surrounding_text || candidate.context.surroundingText)
    || sentence,
  600
);
```

- [ ] **Step 2: Emit explicit field roles**

```js
return {
  markedText: text,
  sentence,
  localContext,
  contextualExplanation: meaning,
  meaning,
  simpleMeaning: '',
};
```

- [ ] **Step 3: Run the frontend focused suite and confirm GREEN**

Run: `npm run verify:vocabulary-preview`

Expected: `vocabulary preview service check passed`.

### Task 3: Replace the article-specific exception with general few-shot contrasts

**Files:**
- Modify: `src/services/vocabulary/settlement-meaning-refinement.js`
- Modify: `E:/read-web-worktrees/next-feature-20260629/tools/subtitle-workflow/youtube_workflow/service.py`
- Test: both focused files from Task 1.

**Interfaces:**
- Consumes: `markedText`, `localContext`, and `contextualExplanation`.
- Produces: JSON `{"items":[{"targetId":"...","simpleMeaning":"..."}]}`.

- [ ] **Step 1: Define the general rule**

```text
simpleMeaning is the short Chinese lexical gloss of markedText/boundary as written.
Use local context only to choose among senses. Never replace the expression with a named entity or referent revealed by the context or contextualExplanation unless that entity is explicitly present in markedText/boundary.
```

- [ ] **Step 2: Add consistent positive and negative examples**

```text
invisible gas + explanation identifies ethylene -> 不可见气体 (not 乙烯气体)
the capital + explanation identifies Beijing -> 首都 (not 北京)
the enzyme + explanation identifies PPO -> 这种酶 (not 多酚氧化酶)
ethylene gas -> 乙烯气体
polyphenol oxidase -> 多酚氧化酶
```

- [ ] **Step 3: Increment `SETTLEMENT_MEANING_REFINEMENT_PROMPT_VERSION`**

Change the value from `2` to `3` so version-2 outputs are not treated as current results.

- [ ] **Step 4: Run frontend and backend suites and confirm GREEN**

Run:

```powershell
npm run verify:vocabulary-preview
python -m unittest tests.test_service_app
```

Expected: both commands exit 0.

### Task 4: Verify the runtime request and application boundary

**Files:**
- Read: the newest `_workflow/srs-meaning-refinement/latest-template.json`
- Read: the newest `_workflow/srs-meaning-refinement/latest-prompt.txt`
- Read: the corresponding Gemini cache response after the user explicitly triggers a new request

**Interfaces:**
- Consumes: runtime artifacts written by the backend.
- Produces: evidence that no full article was uploaded and that lexical output is applied by `targetId`.

- [ ] **Step 1: Restart only the verified Subtitle Workflow process**

Verify `/api/health` reports `subtitle-workflow` and the expected workflow root before restarting port 8765.

- [ ] **Step 2: Run non-network verification immediately**

Run:

```powershell
npm run verify:vocabulary-srs
npm run verify:youtube-workflow-startup
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Inspect the next user-triggered runtime artifact**

Confirm the saved template contains item-local `localContext`, does not contain top-level `articleText` or `articleSentences`, and the raw response for `invisible gas` is `不可见气体`.
