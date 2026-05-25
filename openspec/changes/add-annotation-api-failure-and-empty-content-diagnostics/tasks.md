## 1. Run-level Diagnostics Record

- [x] 1.1 Audit the current annotation diagnostics helper, storage helper, and existing persistence points to identify the minimal seam for `runId`, `scopeKey`, and persisted history.
- [x] 1.2 Add a diagnostics record helper that persists generation run summaries by `audioKey`, `documentId`, and `scopeKey`.
- [x] 1.3 Ensure diagnostics records survive refresh and can distinguish multiple runs for the same document scope.

## 2. API Failure Chain Observation

- [x] 2.1 Record `runId`, `blockId`, `attempt`, `targetCount`, request start/end timestamps, duration, and whether the HTTP request was actually issued.
- [x] 2.2 Classify API failures with `httpStatus`, provider error code, error message, and a safe error-body summary.
- [x] 2.3 Record `returnedCount`, `normalizedCount`, and explicit evidence when provider output normalizes to zero valid items.
- [x] 2.4 Expose the primary failure type and message in controller / entry diagnostics so failures are no longer opaque.

## 3. Merge, Save, Load, Index Evidence

- [x] 3.1 Record merge before/after item counts, save success/failure, save targets, and post-save generated bundle counts.
- [x] 3.2 Record load targets, generated item counts, and generated index refresh counts.
- [x] 3.3 Ensure these events can be correlated through `runId + scopeKey`.

## 4. Empty-content Chain and Export-file Role

- [x] 4.1 Add diagnostics on the generated bundle, generated index, click resolver, and bubble-consumption path for empty-content cases.
- [x] 4.2 Record the actual runtime data source and explicitly verify whether `annotation-full-export.json` participates in runtime display.
- [x] 4.3 Prepare a minimal runtime reproduction and evidence summary for the “UI says generated but front-end content is empty” path.

## 5. Verification and Conclusion Output

- [x] 5.1 Reproduce frequent API failure scenarios and record failure-type distribution with concrete runtime evidence.
- [x] 5.2 Reproduce an empty-content runtime path and confirm whether the break happens in bundle, index, click, bubble, or UI state.
- [x] 5.3 Run `node --check` and the verification harness, confirming this change only adds diagnostics and does not alter provider retry, merge, restore, or render core logic.
