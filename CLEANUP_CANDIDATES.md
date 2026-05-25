# Cleanup Candidates (Conservative Cleanup Status)

This file tracks candidate cleanup items with explicit triage:
- `Safe to clean now`
- `Should wait for product/UI decision`

All applied changes remain conservative and behavior-preserving.

## Applied now (safe to clean now)

| Priority | Candidate | File / Lines | What was done |
|---|---|---|---|
| Medium | Legacy sentence-note migration branch duplicated in two loaders | `app.js:649`, `app.js:735-742`, `app.js:764` | Added shared helper `ensureLegacySentenceNotesForDoc(docId)` and replaced duplicated branches in both load paths. |
| Medium | Repeated "persist current sentence notes before content switch" sequence | `app.js:793-796`, `app.js:2679`, `app.js:2706` | Added helper `persistSentenceNotebookBeforeContentSwitch()` and reused it in audio/transcript change handlers. |
| Low | Windows ADS artifacts committed as regular files | `.gitignore:1`, removed `*:Zone.Identifier` files under `cankao/` and repo root | Deleted ADS artifact files and added ignore rule `*:Zone.Identifier` to prevent re-introduction. |
| Low | Repeated "loaded label" update sequence | `app.js:798-802`, `app.js:2491`, `app.js:2510`, `app.js:2518`, `app.js:2524`, `app.js:2702`, `app.js:2717`, `app.js:2760`, `app.js:2796` | Added helper `markFileLoaded(labelEl, text)` and reused it for audio/transcript/notes/visual load and restore paths. |
| Low | Repeated delayed sentence-focus capture callback | `app.js:809-811`, `app.js:2666-2667` | Added helper `scheduleSentenceFocusCapture()` and reused it for transcript `mouseup`/`keyup` hooks. |
| Low | Repeated input-target guard checks | `app.js:804-807`, `app.js:4360`, `app.js:4408`, `app.js:4445` | Added helper `isInputLikeTarget(target)` and reused it in keydown/keyup/delete-guard branches. |
| Low | Repeated note-preview empty-state block | `app.js:3708-3714`, `app.js:3672`, `app.js:3680` | Added helper `showNotePreviewEmptyState(message)` to centralize identical empty-state/reset logic. |
| Low | Repeated `FileReader` boilerplate in import/load handlers | `app.js:813-821`, `app.js:2649-2665`, `app.js:2722-2734`, `app.js:2764-2771`, `app.js:2799-2808`, `app.js:2824-2833`, `app.js:4613-4630`, `app.js:4669-4683` | Added helper `readFileAsText(file, onText)` and replaced repeated local FileReader setup across sentence notes / transcript / notes / visual / chunk / marks imports. |
| Low | Repeated event file extraction pattern (`event.target.files[0]`) | `app.js:798-800`, `app.js:2658`, `app.js:2705`, `app.js:2751`, `app.js:2786`, `app.js:2814`, `app.js:4601`, `app.js:4660` | Added helper `getFirstFileFromEvent(event)` and reused it across import handlers in the import/restore/load-state subsystem. |
| Low | Repeated current-audio filename base derivation for export names | `app.js:802-806`, `app.js:2682`, `app.js:4627` | Added helper `getCurrentAudioFilenameBase(fallback)` and reused it for sentence-note and chunk-note export filename generation. |
| Low | Repeated current-audio context assignment logic | `app.js:808-812`, `app.js:2507`, `app.js:2510`, `app.js:2709` | Kept `applyCurrentAudioMeta(meta)` in `app.js` as the runtime-state writer, and moved the next-state derivation into shared helper `buildCurrentAudioMetaState(meta, buildAudioKey)` so restore/audio-load flow still reuses one behavior-preserving path. |
| Low | Data-layer section boundaries clarified for identity/storage/persistence groups | `app.js:251`, `app.js:287`, `app.js:639`, `app.js:805` | Kept helpers contiguous and labeled by responsibility (`Identity keys`, `Storage key helpers`, `Sentence notebook persistence lifecycle`, `Import/export/restore shared helpers`) for easier reasoning. |
| Low | Repeated plain-object shape checks in persistence paths | `app.js:45`, `app.js:642`, `app.js:743`, `app.js:3815`, `app.js:3825` | Added helper `isPlainObjectRecord(value)` and reused it in sentence-note load/legacy/import validation paths. |
| Low | Repeated sentence-note immediate persist pair | `app.js:749-752`, `app.js:771`, `app.js:787`, `app.js:807` | Added helper `persistSentenceNotebookNow()` and reused it in doc-switch/export/content-switch helper paths where calls were adjacent and unconditional. |
| Low | Repeated sentence-note export docId fallback expression | `app.js:782`, `app.js:789` | Added helper `getCurrentSentenceDocIdForExport()` and reused it in sentence-note export snapshot build. |
| Low | `app.js` reading-order and section scanability | `app.js:1-6`, `app.js:81`, `app.js:312`, `app.js:2110`, `app.js:2473`, `app.js:2718`, `app.js:2858-2859`, `app.js:3108`, `app.js:3167`, `app.js:4203` | Performed comment-only organization pass: added read-order map and relabeled major section headers to make utility/data/persistence/import/render/input boundaries easier to scan. No logic moved or changed. |

## Deferred (should wait for product/UI decision)

| Priority | Candidate | File / Lines | Why deferred | Suggested later action |
|---|---|---|---|---|
| High | Hidden sentence-note meta render path | `app.js:3493-3506`, `app.js:3618-3623`, `styles.css:1717-1732` | Per instruction, not removed without proving no UI dependency. This can still be re-enabled by style changes. | Decide whether meta feedback should be visible; then remove or restore consistently. |
| High | Duplicate global keyboard listener split across two blocks | `app.js:4356-4402`, `app.js:4433-4447` | Listener merge is low-medium risk because shortcut ordering is user-visible and tied to modal/selection state. | Merge only with explicit shortcut regression checklist. |
| Medium | `saveSentenceNotesDebounced` name does not match behavior | `app.js:653-655` | Renaming is behavior-neutral but touches multiple references; deferred to avoid churn during active feature changes. | Rename in a dedicated naming pass (or implement true debounce). |
| Low | `formatSentenceNoteItemMeta` data path likely stale under current UI policy | `app.js:3493-3499` | Depends on the hidden-meta decision above. | Clean together with sentence-note meta visibility decision. |

## Notes
- No UI redesign was done.
- No broad refactor was done.
- No hidden sentence-note meta logic was removed in this pass.
- No playback or selection behavior was changed.
- This round stayed within one local subsystem: import/restore/load-state helper cleanup.
- This round further organized the same subsystem with small helper extraction only (no event-model or runtime interaction changes).
- This round also completed a conservative data/persistence/document-identity organization pass with helper-level changes only.
- This round also included a comment-only app.js reading-order cleanup pass (no helper extraction, no behavior change).
- This round also extracted the current-audio filename-base derivation into `import-export-shared-helpers.js` and kept the app-side wrapper behavior intact.
- This round also extracted `markFileLoaded(labelEl, text)` into `import-export-shared-helpers.js` and kept the app-side wrapper behavior intact.
- This round also extracted current-audio context derivation into `import-export-shared-helpers.js` as `buildCurrentAudioMetaState(meta, buildAudioKey)`, while keeping final runtime assignments inside `app.js`.
