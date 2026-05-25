## 1. Cloze Utility Extraction

- [x] 1.1 Create `cloze-utils.js` and move only `validateClozeData`, `normalizeClozeAnswer`, and `escapeHtml` into it
- [x] 1.2 Expose the extracted helpers through the same browser-global helper pattern used elsewhere in the project
- [x] 1.3 Update `app.js` to consume the extracted helpers without changing cloze rendering or event behavior

## 2. Wiring And Verification

- [x] 2.1 Load `cloze-utils.js` before `app.js` in `read-26.html`
- [x] 2.2 Verify that cloze import, answer checking, and result display behave identically after the extraction
- [x] 2.3 Run existing syntax and smoke checks to confirm no regressions in transcript, chunk, and playback flows
