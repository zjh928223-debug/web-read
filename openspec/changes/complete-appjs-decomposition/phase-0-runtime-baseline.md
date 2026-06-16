# Phase 0 Runtime Baseline

Last scanned: 2026-06-16

This file is the Phase 0 baseline for `complete-appjs-decomposition`. It records the current compatibility surface before moving more code out of `app.js`.

## Scope

Current entry:

```text
index.html
  -> src/stores/*.js compatibility stores
  -> src/composables/*.js compatibility modules
  -> app.js
  -> src/composables/session-init.js
  -> /src/main.js
```

Current state spine:

```text
app.js local variables
  -> window.__state getter/setter proxy
  -> direct adapter-to-Pinia binding plus runtime bridgeToPinia compatibility
  -> src/pinia-stores/*.js
  -> Vue components
```

Phase 0 does not change runtime behavior. It records current owners, consumers, target owners, verification coverage, and cleanup guardrails.

## 1. app.js Runtime Export Map

These are the current `app.js` exports at the bottom of the file. Some names are also assigned by composables; `app.js` still re-exports them as compatibility globals.

| Export | Current owner | Known consumers | Target owner | Removal condition |
| --- | --- | --- | --- | --- |
| `handleBackwardClick` | `src/composables/playback-module.js`, re-exported by `app.js` | `index.html`, `keyboard-module.js`, playback verification | `playback-module.js` or Vue control binding | `index.html` and tests stop calling `window.handleBackwardClick` directly |
| `handleForwardClick` | `src/composables/playback-module.js`, re-exported by `app.js` | `index.html`, `keyboard-module.js`, playback verification | `playback-module.js` or Vue control binding | direct `window` and inline callers removed |
| `changeSpeed` | `src/composables/controls-module.js`, re-exported by `app.js` | `index.html` speed buttons | Vue/audio controls module | speed buttons no longer use inline `onclick` |
| `cycleHighlightMode` | `app.js` | `index.html`, interaction verification | transcript/playback state owner plus Vue control binding | highlight control no longer calls `window.cycleHighlightMode` |
| `toggleChunkMode` | `app.js` | `index.html`, `session-init.js`, verification scripts | chunk store/runtime module | chunk mode control and restore path use explicit module API |
| `toggleChunkFocusMode` | `app.js` | `index.html` | chunk store/runtime module | focus button uses Vue/module binding |
| `openChunkStyleModal` | `src/composables/style-editor.js`, re-exported by `app.js` | `index.html` | style editor module or Vue modal | inline modal opener removed |
| `closeChunkStyleModal` | `src/composables/style-editor.js`, re-exported by `app.js` | `index.html`, `style-editor.js` | style editor module or Vue modal | inline close handler removed |
| `openChunkNoteStyleModal` | `app.js` | `index.html` | chunk note subsystem or Vue modal | note style modal owned outside `app.js` |
| `closeChunkNoteStyleModal` | `app.js` | `index.html` | chunk note subsystem or Vue modal | note style modal owned outside `app.js` |
| `toggleChunkShadowManual` | `app.js` | `index.html` | chunk store/runtime module | shadow toggle uses explicit module API |
| `updateChunkStyle` | `src/composables/style-editor.js`, re-exported by `app.js` | `index.html` style inputs | style editor module or Vue binding | `oninput` handlers removed |
| `updateChunkNoteStyle` | `app.js` | `index.html` note style inputs | chunk note subsystem/style module | `oninput` handlers removed |
| `toggleChunkBtn` | DOM element export from `app.js` | `import-module.js`, `session-init.js` | DOM binding/module state, not global element | modules no longer mutate button element directly |
| `forceUpdateUI` | `src/composables/playback-module.js`, re-exported by `app.js` | `transcript-interactions.js`, `chunk-interactions.js`, verification scripts, import/session modules | playback module API injected into components/modules | Vue components stop using `window.forceUpdateUI` |
| `mainUpdateHighlight` | `src/composables/playback-module.js`, re-exported by `app.js` | `controls-module.js`, playback module | playback module internal API | no external module calls `window.mainUpdateHighlight` |
| `initDB` / `saveToDB` / `loadFromDB` / `deleteFromDB` / `clearDBStore` | `window.__audioStore` wrappers in `app.js`, bridged to Pinia by `src/main.js` | `session-init.js`, `import-module.js`, `notes-module.js`, marks/app handlers | `src/pinia-stores/audio.js` or explicit storage adapter | all consumers receive storage adapter by import/injection |
| `showToast` / `showError` | `window.__uiStore` wrappers in `app.js`, bridged to Pinia by `src/main.js` | import/app handlers, session-init, UI store compatibility | `src/pinia-stores/ui.js` | all consumers import/inject UI store or notification adapter |
| `bridgeToPinia` | `app.js` | `import-module.js`, `session-init.js`, verification scripts | direct store updates or state owner methods | `window.__bridge` no longer needed for startup/runtime sync |
| `renderTranscript` | `app.js` local function; `window.renderTranscript` removed in task 5.6 | `import-module.js` and `app-handlers.js` through explicit injection; `session-init.js` through `render-runtime.js` | `TranscriptContainer.vue` plus transcript store | injected render callers removed |
| `renderChunkMode` | `app.js` local function; `window.renderChunkMode` removed in task 5.6 | `import-module.js` and `app-handlers.js` through explicit injection; `session-init.js` through `render-runtime.js` | `ChunkModeView.vue` plus chunk store | injected render callers removed |
| `processTranscript` | `app.js` delegates to import module wrapper and updates local state | file import, session restore, verification scripts | transcript ingestion module plus transcript store | import/restore/tests no longer call `window.processTranscript` |
| `processChunkData` | `app.js` delegates to import module wrapper and updates local chunk state | file import, session restore, verification scripts | chunk ingestion module plus chunk store | import/restore/tests no longer call `window.processChunkData` |
| `selectSentenceFromChunkTarget` | `src/composables/notes-module.js`, re-exported by `app.js` | `chunk-interactions.js` | chunk/sentence selection module | component receives injected handler or emits event |
| `openChunkNoteContextFromEvent` | `src/composables/notes-module.js`, re-exported by `app.js` | `chunk-interactions.js` | chunk note subsystem | component no longer calls `window.openChunkNoteContextFromEvent` |
| `notifyAnnotationBubbleWordClick` | `app.js`, injected into transcript/chunk interaction modules | `transcript-interactions.js`, `chunk-interactions.js`, interaction verification | annotation bubble/click resolver module | components no longer call `window.notifyAnnotationBubbleWordClick` |
| `isInputLikeTarget` | `src/composables/keyboard-module.js`, re-exported by `app.js` | legacy `window.isInputLikeTarget` compatibility only | keyboard module utility | no callers use `window.isInputLikeTarget` |
| `adjustChunkNoteArrowSizeByGap` | `app.js` | `style-editor.js`, `session-init.js` | chunk note style/layout subsystem | callers use chunk note style API |
| `getAnnotationGenerationScope` | `app.js` facade over session-init hook | `import-module.js`, `session-init.js` | annotation/session scope module | import/session code uses module API directly |
| `buildCurrentSentenceDocId` | `app.js` wrapper over `IdentityStorageKeys` | `import-module.js`, `notes-module.js`, `session-init.js` | identity/storage key utility | consumers import/inject utility directly |
| `clearGeneratedAnnotationIndex` | `app.js` facade over session-init hook | `import-module.js`, `session-init.js` | annotation session module | import/session code uses module API directly |
| `loadChunkNotesForCurrentAudio` | `src/composables/notes-module.js`, re-exported by `app.js` | `import-module.js`, `session-init.js` | chunk note subsystem | consumers import/inject chunk note API |
| `setChunkNoteVisible` | `src/composables/notes-module.js`, re-exported by `app.js` | `keyboard-module.js`, `session-init.js` | chunk note subsystem/store | controls and keyboard receive subsystem API |
| `loadSentenceNotesForCurrentAudio` | `src/composables/notes-module.js`, re-exported by `app.js` | `session-init.js` | sentence note subsystem | session restore uses subsystem API directly |
| `switchSentenceNotesDoc` | `src/composables/notes-module.js`, re-exported by `app.js` | `import-module.js`, `session-init.js` | sentence note subsystem | transcript import/restore use subsystem API directly |
| `applyCurrentAudioMeta` | `app.js` | `import-module.js`, `session-init.js` | audio/session identity module or audio store | audio import/restore update canonical owner directly |
| `clearPersistedChunkSession` | `app.js` facade over session-init hook | `import-module.js`, `session-init.js` | session cleanup module | import/session code uses module API directly |
| `emitAnnotationDiagnostics` | `app.js` facade over session-init hook | `import-module.js`, `session-init.js` | annotation diagnostics module | callers use diagnostics API directly |
| `scheduleGeneratedAnnotationIndexRefresh` | `app.js` facade over session-init hook | `import-module.js`, `session-init.js` | annotation session module | callers use annotation session API directly |
| `syncAnnotationGenerationEntryStatus` | `app.js` facade over session-init hook | marks/app/import/session modules | annotation session module | mark/import/session code uses annotation API directly |
| `initAnnotationApiSettingsUi` | `app.js` facade over session-init hook | session-init startup path | annotation API settings UI module | startup initializes module directly |
| `updateChunkCnHoldBtn` | `app.js` | `session-init.js` | chunk controls module or Vue button state | button label state owned outside `app.js` |

Additional globals assigned by composables/services are outside `app.js` final export block but remain part of the compatibility surface, for example `window.__keyboardModule`, `window.__importModule`, `window.__annotationLightweightModule`, `window.PlaybackIndexHelpers`, `window.ChunkMatchingHelpers`, `window.VocabMatchingHelpers`, `window.AnnotationGenerationController`, and annotation service globals.

## 2. window.__state Map

`window.__state` started as a proxy over `app.js` local variables. Migrated fields now proxy their runtime adapter or Pinia owner while the field name remains as a compatibility facade.

| Field | Backing variable | Current readers/writers outside app.js | Target owner |
| --- | --- | --- | --- |
| `chunkNoteModalEl` | `__chunkNoteModalEl` | no direct external field access found | chunk note subsystem |
| `segments` | `segments` | `playback-module.js`, `controls-module.js`, `session-init.js` | transcript store/runtime |
| `words` | `words` | `playback-module.js`, `controls-module.js`, `session-init.js` | transcript store/runtime |
| `wordStarts` | `wordStarts` | `playback-module.js`, `controls-module.js` | transcript/playback index helper owner |
| `chunkItems` | `window.__chunkState.chunkItems` | `playback-module.js`, `session-init.js` | chunk store/runtime adapter |
| `hasAiChunkData` | `window.__chunkState.hasAiChunkData` | `playback-module.js`, `session-init.js` | chunk store/runtime adapter |
| `hasClozeData` | `window.__clozeState.hasClozeData` | verification scripts directly set/read | cloze store/runtime adapter |
| `clozeItems` | `window.__clozeState.clozeItems` | verification scripts directly set | cloze store/runtime adapter |
| `clozeAnswerState` | `window.__clozeState.clozeAnswerState` | verification scripts directly set | cloze store/runtime adapter |
| `manualChunkStates` | `window.__chunkState.manualChunkStates` | `session-init.js` | chunk store/runtime adapter |
| `currentAudioMeta` | `currentAudioMeta` | `session-init.js` | audio/session identity owner |
| `chunkNotesFileHandle` | removed from `window.__state` in 4.8; owner is `window.__notesState.chunkNotesFileHandle` | no direct external field access found | notes runtime adapter |
| `chunkNotesFileHandleAudioKey` | removed from `window.__state` in 4.8; owner is `window.__notesState.chunkNotesFileHandleAudioKey` | no direct external field access found | notes runtime adapter |
| `chunkNotesFileName` | removed from `window.__state` in 4.8; owner is `window.__notesState.chunkNotesFileName` | no direct external field access found | notes runtime adapter |
| `isChunkMode` | `window.__chunkState.isChunkMode` | `playback-module.js`, `controls-module.js`, `session-init.js`, verification scripts | chunk store/runtime adapter |
| `currentAudioKey` | `__cak` / `currentAudioKey` accessor | `session-init.js` | audio/session identity owner |
| `currentWordIndex` | `currentWordIndex` | `playback-module.js` | playback runtime or transcript store |
| `autoFollow` | `window.__playbackState.autoFollow` | `controls-module.js`, verification scripts | playback runtime adapter |
| `userScrollSuppress` | `window.__playbackState.userScrollSuppress` | `controls-module.js`, verification scripts | playback runtime adapter |
| `suppressTimer` | `window.__playbackState.suppressTimer` | `controls-module.js` | playback runtime adapter |
| `highlightMode` | `highlightMode` | `playback-module.js`, `controls-module.js`, verification scripts | transcript/playback store |
| `lastActiveSegIndex` | `window.__playbackState.lastActiveSegIndex` | `playback-module.js`, verification scripts | playback runtime adapter |
| `activeWordHighlightEl` | `window.__playbackState.activeWordHighlightEl` | `playback-module.js` | playback runtime adapter |
| `activeSentenceEl` | `window.__playbackState.activeSentenceEl` | `playback-module.js` | playback runtime adapter |
| `activeChunkEl` | `window.__playbackState.activeChunkEl` | `playback-module.js` | playback runtime adapter |
| `playbackUiSignature` | `window.__playbackState.playbackUiSignature` | `controls-module.js` | playback runtime adapter |
| `markKey` | `markKey` | `session-init.js` | keyboard settings store |
| `notesKey` | `notesKey` | `session-init.js` | keyboard settings store |
| `annotationBubbleKey` | `annotationBubbleKey` | `session-init.js` | keyboard settings store |
| `chunkCnKey` | `chunkCnKey` | `session-init.js`, verification scripts | keyboard settings store |
| `chunkShadowKey` | `chunkShadowKey` | `session-init.js` | keyboard settings store |
| `chunkNoteKey` | `chunkNoteKey` | `session-init.js` | keyboard settings store |
| `backwardKey` | `backwardKey` | `session-init.js`, verification scripts | keyboard settings store |
| `forwardKey` | `forwardKey` | `session-init.js` | keyboard settings store |
| `markedMap` | `markedMap` | `session-init.js`, verification scripts | marks store |
| `globalVocab` | `globalVocab` | no direct external field access found | annotation/marks matching owner |
| `vocabMatchMap` | `vocabMatchMap` | verification scripts directly mutate | annotation/marks matching owner |
| `chunkCnVisible` | `window.__chunkState.chunkCnVisible` | `session-init.js`, verification scripts | chunk store/runtime adapter |
| `chunkCnHoldMode` | `window.__chunkState.chunkCnHoldMode` | `session-init.js`, verification scripts | chunk store/runtime adapter |
| `isHoldingChunkCn` | removed from `window.__state` in 4.8; owner is `window.__chunkState.isHoldingChunkCn` | no direct external field access found | chunk controls runtime adapter |
| `holdPrevChunkCnVisible` | removed from `window.__state` in 4.8; owner is `window.__chunkState.holdPrevChunkCnVisible` | no direct external field access found | chunk controls runtime adapter |
| `holdPrevHadFocusClass` | `holdPrevHadFocusClass` | no direct external field access found | chunk controls runtime |
| `isChunkShadowOn` | `window.__chunkState.isChunkShadowOn` | `session-init.js` | chunk store/runtime adapter |
| `chunkCnMode` | `window.__chunkState.chunkCnMode` | `session-init.js`, verification scripts | chunk store/runtime adapter |
| `lastActiveChunkIndex` | `window.__chunkState.lastActiveChunkIndex` -> `chunk.activeChunkIdx` | `playback-module.js`, `session-init.js` | chunk store/runtime adapter |
| `lastAiPrevTapChunkIndex` | `window.__chunkState.lastAiPrevTapChunkIndex` | `playback-module.js`, `session-init.js` | chunk store/runtime adapter |
| `lastAiPrevTapAt` | `window.__chunkState.lastAiPrevTapAt` | `playback-module.js`, `session-init.js` | chunk store/runtime adapter |
| `lastSentencePrevTapSegIndex` | removed from `window.__state` in 4.8; owner is `window.__playbackState.lastSentencePrevTapSegIndex` | no direct external field access found | playback runtime adapter |
| `lastSentencePrevTapAt` | removed from `window.__state` in 4.8; owner is `window.__playbackState.lastSentencePrevTapAt` | no direct external field access found | playback runtime adapter |
| `chunkPointerDown` | `chunkPointerDown` | no direct external field access found | chunk interaction runtime |

Observed direct application module users:

- `src/composables/playback-module.js`: playback state, active DOM element refs, transcript/chunk data.
- `src/composables/controls-module.js`: playback loop signature and auto-follow suppression.
- `src/composables/session-init.js`: startup restore, annotation scope, marks, chunk/session cleanup, hotkey restore.

Observed direct verification users:

- `scripts/read-web-playback-check.cjs`
- `scripts/read-web-interactions-check.cjs`

## 3. window.__bridge Map

Task 4.9 removed active `window.__bridge` startup snapshots. `src/main.js` now seeds Pinia directly from the transcript/chunk/cloze state adapters by calling `bindPiniaStore(...)` without `preferStore`. `bridgeToPinia()` remains as a runtime compatibility function, but it writes directly to `window.__piniaStores` and no longer creates or updates `window.__bridge`.

| Former bridge field | Current source | Pinia runtime target | Current writers | Target state owner |
| --- | --- | --- | --- | --- |
| `transcript.segments` | `window.__transcriptState.segments` | `transcriptStore.segments` / `ps.transcript.segments` | state adapter bind, `bridgeToPinia()` runtime | transcript store |
| `transcript.words` | `window.__transcriptState.words` | `transcriptStore.words` / `ps.transcript.words` | state adapter bind, `bridgeToPinia()` runtime | transcript store |
| `transcript.wordStarts` | `window.__transcriptState.wordStarts` | `transcriptStore.wordStarts` / `ps.transcript.wordStarts` | state adapter bind, `bridgeToPinia()` runtime | transcript/playback index owner |
| `transcript.highlightMode` | `window.__transcriptState.highlightMode` | `transcriptStore.highlightMode` / `ps.transcript.highlightMode` | state adapter bind, `bridgeToPinia()` runtime | transcript/playback store |
| `chunkItems` | `window.__chunkState.chunkItems` | `chunkStore.chunkItems` / `ps.chunk.chunkItems` | state adapter bind, `bridgeToPinia()` runtime | chunk store |
| `isChunkMode` | `window.__chunkState.isChunkMode` | `chunkStore.isChunkMode` / `ps.chunk.isChunkMode` | state adapter bind, `bridgeToPinia()` runtime | chunk store |
| `hasAiChunkData` | `window.__chunkState.hasAiChunkData` | `chunkStore.hasAiChunkData` / `ps.chunk.hasAiChunkData` | state adapter bind, `bridgeToPinia()` runtime | chunk store |
| `chunkCNVisible` | `window.__chunkState.chunkCnVisible` | `chunkStore.chunkCNVisible` / `ps.chunk.chunkCNVisible` | state adapter bind, `bridgeToPinia()` runtime | chunk store |
| `chunkCNHoldMode` | `window.__chunkState.chunkCnHoldMode` | `chunkStore.chunkCNHoldMode` / `ps.chunk.chunkCNHoldMode` | state adapter bind, `bridgeToPinia()` runtime | chunk store |
| `chunkFocusMode` | `window.__chunkState.chunkCnMode === 'focus'` | `chunkStore.chunkFocusMode` / `ps.chunk.chunkFocusMode` | state adapter bind, `bridgeToPinia()` runtime | chunk store |
| `chunkShadowVisible` | `window.__chunkState.isChunkShadowOn` | `chunkStore.chunkShadowVisible` / `ps.chunk.chunkShadowVisible` | state adapter bind, `bridgeToPinia()` runtime | chunk store |
| `chunkNoteVisible` | `_ns.chunkNoteVisible` | `ps.chunk.chunkNoteVisible` runtime only | `bridgeToPinia()` | chunk note/chunk store boundary |
| `clozeItems` | `window.__clozeState.clozeItems` | `clozeStore.items` / `ps.cloze.items` | state adapter bind, `bridgeToPinia()` runtime | cloze store |
| `hasClozeData` | `window.__clozeState.hasClozeData` | `clozeStore.hasData` / `ps.cloze.hasData` | state adapter bind, `bridgeToPinia()` runtime | cloze store |
| `clozeAnswerState` | `window.__clozeState.clozeAnswerState` | `clozeStore.answerState` / `ps.cloze.answerState` | state adapter bind, `bridgeToPinia()` runtime | cloze store |

Known `bridgeToPinia()` callers:

- `app.js` local render functions and chunk CN toggles.
- `src/composables/import-module.js` after transcript/chunk/cloze imports.
- `src/composables/session-init.js` during startup restore.
- verification scripts.

Removal condition:

- `src/main.js` no longer reads `window.__bridge` (done in task 4.9).
- import/session code updates Pinia/runtime owners directly.
- verification scripts no longer need `window.bridgeToPinia()`.

## 4. index.html Integration Map

### Script Order

Keep this order until a migration phase explicitly changes it and runs full verification.

```text
1. External Google CSE script
2. compatibility stores
   3.1 src/stores/theme.js
   3.2 src/stores/ui.js
   3.3 src/stores/audio.js
   3.4 src/stores/marks.js
   3.5 src/stores/cloze.js
   3.6 src/stores/transcript.js
   3.7 src/stores/chunk.js
   3.8 src/stores/notes.js
   3.9 src/stores/annotation.js
3. compatibility/runtime composables
   4.1 src/composables/glass-effects.js
   4.2 src/composables/chunk-note-layout.js
   4.3 src/composables/app-handlers.js
   4.4 src/composables/style-editor.js
   4.5 src/composables/notes-module.js
   4.6 src/composables/import-module.js
   4.7 src/composables/keyboard-module.js
   4.8 src/composables/playback-module.js
   4.9 src/composables/controls-module.js
   4.10 src/composables/annotation-lightweight-module.js
   4.11 src/composables/transcript-state.js
   4.12 src/composables/chunk-state.js
   4.13 src/composables/cloze-state.js
   4.14 src/composables/playback-state.js
4. app.js
5. src/composables/session-init.js
6. /src/main.js
```

### Inline Handlers

| Element / control | Handler | Target owner |
| --- | --- | --- |
| Previous sentence button | `handleBackwardClick()` | playback controls component/module |
| Next sentence button | `handleForwardClick()` | playback controls component/module |
| Speed buttons | `changeSpeed(rate)` | audio controls component/module |
| Highlight button | `cycleHighlightMode()` | transcript/playback controls |
| AI chunk button | `toggleChunkMode()` | chunk controls |
| Load chunk button | migrated from inline handler to `src/composables/file-input-bindings.js` in task 5.1 | file import controls |
| Load cloze button | migrated from inline handler to `src/composables/file-input-bindings.js` in task 5.1 | file import controls |
| Chunk style button | `openChunkStyleModal()` | style editor component/module |
| Chunk focus button | `toggleChunkFocusMode()` | chunk controls |
| Chunk note style button | `openChunkNoteStyleModal()` | chunk note style module/component |
| Chunk style close | `closeChunkStyleModal()` | style editor component/module |
| Chunk style inputs | `updateChunkStyle()` | style editor component/module |
| Chunk shadow toggle | `toggleChunkShadowManual()` | chunk controls |
| Chunk note style close | `closeChunkNoteStyleModal()` | chunk note style module/component |
| Chunk note style inputs | `updateChunkNoteStyle()` | chunk note style module/component |

### DOM IDs with Runtime Reads

Active/current IDs in `index.html` include:

```text
audio-player, transcript-container, toggle-follow, highlight-mode-btn,
theme-controls, theme-toggle, theme-custom-panel, theme-custom-bg,
theme-custom-text, theme-custom-sub, theme-custom-border, theme-custom-button,
theme-custom-reset, toggle-chunk-btn, btn-chunk-cn-hold, audio-file,
transcript-file, chunk-file, cloze-file, lbl-audio, lbl-transcript,
highlight-color-input, sentence-color-input, hotkey-input, hotkey-notes-input,
hotkey-annotation-bubble-input, hotkey-backward-input, hotkey-forward-input,
hotkey-chunk-cn-input, hotkey-chunk-shadow-input, hotkey-chunk-note-input,
btn-import-chunk-notes, import-chunk-notes-file, btn-export-chunk-notes,
chunk-note-svg-layer, chunk-note-probe, chunk-note-ctx-menu,
chunk-note-ctx-add, main-app-area, import-marks-btn, import-marks-file,
export-json, export-md-all, btn-export-annotation-lightweight,
import-annotation-lightweight-file, btn-import-annotation-lightweight,
btn-annotation-api-settings, annotation-api-settings-panel, modal-backdrop,
btn-load-cloze, btn-chunk-focus, chunk-vue-container
```

Task 5.2 moved `btn-load-cloze` active-state DOM lookup out of `app.js` and into `src/composables/import-module.js`, matching the file picker control boundary started in task 5.1. Task 5.5 moved Vue cloze draft/check interaction out of `window.__clozeCheck` and DOM input queries into `src/composables/cloze-interactions.js`. Task 5.6 removed `window.renderTranscript` and `window.renderChunkMode` after `session-init.js` moved to `src/composables/render-runtime.js`; `window.__clozeCheck` and `window.__buildClozeQuizMarkup` remain for the later cloze fallback cleanup. Other `app.js` DOM lookups remain pending for later Phase 4 control/component migrations.

Legacy or absent IDs still referenced by runtime code and needing audit before deletion:

```text
toggle-sidebar-btn, notes-file, visual-file, lbl-notes, lbl-visual,
hotkey-sidebar-input, btn-import-sentence-notes, import-sentence-notes-file,
btn-export-sentence-notes, toggle-note-preview-btn, note-preview-sidebar,
note-preview-resize-handle, note-preview-resize-handle-y, note-preview-empty,
note-preview-list, placeholder, info-card, show-word, show-context,
show-meaning, show-not, scene-list, search-pool, style-controls-container,
open-style-editor, style-editor-modal
```

These absent/legacy IDs are risk signals, not automatic deletion candidates.

## 5. Root Regular Script Map

| Script | Global exposed | Current consumers | Target owner |
| --- | --- | --- | --- |
| `chunk-note-layout-helpers.js` | `src/utils/chunk-note-layout-helpers.js` compatibility global | root script tag removed in task 6.5; direct consumers import/load the module replacement | `src/utils/chunk-note-layout-helpers.js` ES module | done |
| `chunk-note-layout-core.js` | `src/utils/chunk-note-layout-core.js` compatibility global | root script tag removed in task 6.5; direct consumers import/load the module replacement | `src/utils/chunk-note-layout-core.js` ES module | done |
| `annotation-bubble.js` | `src/composables/annotation-bubble.js` compatibility global | root script tag removed in task 6.5; `app.js` imports the module API | `src/composables/annotation-bubble.js` ES module | done |
| `annotation-api-settings-ui.js` | `src/composables/annotation-api-settings-ui.js` compatibility global | root script tag removed in task 6.5; `session-init.js` imports the module API | `src/composables/annotation-api-settings-ui.js` ES module | done |

Build implication:

- `vite.config.js` copies all four root scripts into `dist/`.
- Copy logic can be removed in task 6.6 because `index.html` no longer loads these files as root regular scripts.

## 6. Verification Matrix

| Area | Required verification | Notes |
| --- | --- | --- |
| Load path / script order / entry files | `npm test`, `npm run build` | `npm test` runs the Vite load check; build verifies legacy copy behavior. |
| Script order guard | `npm run verify:script-order`, `npm test`, `npm run build` | Required before and after any intentional `index.html` script order change. |
| Playback highlight / seek / follow | `npm run verify:playback`, `npm test` | Also run when changing `forceUpdateUI`, `mainUpdateHighlight`, index helpers, or follow suppression. |
| AI chunk mode / chunk Chinese / focus | `npm run verify:playback`, `npm run verify:interactions`, `npm test` | Required when changing chunk state, chunk rendering, or `toggleChunkMode`. |
| Chunk note interactions | `npm run verify:interactions`, browser smoke check | Covers right-click, save, underline, connectors, delete prompt. Manual browser check recommended after subsystem moves. |
| Cloze rendering/checking | `npm run verify:cloze-interactions`, `npm run verify:interactions`, `npm test` | Required when changing cloze state, view model, or answer interaction. |
| Legacy render facades | `npm run verify:render-facades`, `npm test`, `npm run build` | Required when removing render globals or changing temporary render runtime wiring. |
| Hotkeys / keyboard handling | `npm run verify:keyboard-boundary`, `npm run verify:interactions`, `npm run verify:playback` if navigation affected | Required for `keyboard-module.js` or key state ownership changes. |
| Session restore / persisted cleanup | `npm test`, targeted browser smoke check | Existing automated coverage is partial; document manual checks if session code changes. |
| Annotation lightweight import/export | `npm run verify:annotation-lightweight-module`, `npm run verify:interactions`, `npm test` | Required when changing import/export glue or annotation session scope. |
| Root regular scripts / production build | `npm run build`, `npm test`, production preview/load check | Required before deleting script tags or `vite.config.js` copy logic. |
| Documentation-only Phase 0 updates | `npm test`, `npm run build` baseline | Establishes current clean baseline before behavioral migration. |

## 7. Cleanup Guardrails

- Do not add user-facing feature logic to `app.js`.
- Do not change IndexedDB schema unless a separate migration is explicitly requested.
- Do not reorder `index.html` scripts casually; script order changes must be isolated and fully verified.
- Do not mix dead-path deletion with high-risk runtime migration in the same commit.
- Do not treat `src/stores/` as the long-term state owner; it is compatibility only.
- Keep compatibility globals until their consumers are removed or migrated.
- Every migrated facade needs a target owner and removal condition.

## 8. Phase 1 Runtime Map Update

Completed 2026-06-16:

| Migrated helper | Old location | New location | Current compatibility global | Status |
| --- | --- | --- | --- | --- |
| vocab text normalization and `vocabMatchMap` construction | embedded in `app.js` `rebuildVocabMatching()` | `src/utils/vocab-matching.js` | `window.VocabMatchingHelpers` | delegated; `app.js` only clears/copies the returned Map |

Verification:

```text
2026-06-16 npm run verify:vocab-matching: passed
2026-06-16 npm test: passed
2026-06-16 npm run build: passed
```

## 9. Phase 0 Verification Log

Pending baseline commands:

```text
npm test
npm run build
```

Record results after running:

```text
2026-06-16 npm test: passed
  - read-web load check passed
  - read-web playback check passed
  - read-web interaction check passed
2026-06-16 npm run build: passed after task 6.5
  - Vite production build completed
  - root regular script warnings are gone after removing the four root script tags from index.html
  - stale legacy copy plugin cleanup remains pending task 6.6
```
