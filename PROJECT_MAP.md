# PROJECT_MAP.md — Read-Final Project Structure

## Overview

```
read-final/
├── read-26.html          ← HTML entry (loads all scripts)
├── app.js                ← Central orchestrator (~7300 lines)
├── styles.css            ← Full glass-morphism design system (~1600 lines)
├── data-utils.js         ← Transcript validation & parsing
├── identity-and-storage-keys.js  ← IndexedDB key builders
├── import-export-shared-helpers.js
├── sentence-notes-persistence-utils.js
├── cloze-utils.js        ← Cloze-deletion quiz validation
├── cloze-view-model-helpers.js
├── chunk-matching-helpers.js      ← Fuzzy text matching engine
├── playback-index-helpers.js      ← Binary search by audio time
├── chunk-note-layout-helpers.js   ← Note text wrapping engine
├── chunk-note-layout-core.js
├── annotation-bubble.js           ← Floating definition bubble
├── annotation-target-source.js    ← Extract targets from marks/transcript
├── annotation-block-planner.js    ← Split document into LLM-sized blocks
├── annotation-prompt-builder.js   ← Build Gemini prompts
├── annotation-api-config.js       ← API credential management
├── annotation-api-settings-ui.js  ← API settings panel
├── annotation-api-client.js       ← Gemini HTTP client
├── annotation-generation-progress-store.js
├── annotation-generation-storage.js  ← Bundle persistence
├── annotation-generation-controller.js ← Async orchestration
├── annotation-generation-diagnostics.js
├── annotation-generation-diagnostics-records.js
├── annotation-run-diagnostics.js
├── annotation-generation-diff.js
├── annotation-generated-result-store.js  ← In-memory annotation index
├── annotation-click-resolver.js
├── annotation-generation-entry-ui.js ← Generate button state machine
├── scripts/
│   ├── read26-verify.js       ← Playwright load check (npm test)
│   └── read26-load-check.js
├── cankao/                 ← Reference only (old version)
├── output/                 ← Logs & Playwright artifacts (gitignored)
├── package.json
└── .gitignore
```

## Module Boundary & Data Flow

```
[Audio + JSON] → data-utils.js (parse)
       ↓
   app.js builds: words[], segments[], wordStarts[]
       ↓
   <audio> timeupdate → playback-index-helpers → highlight
       ↓
   [Normal mode] renderTranscript() — sentence-level
   [Chunk mode]  renderChunkMode() — block-level + CN
       ↓
   Mark word (m key) → markedMap → saveToDB('marks')
       ↓
   Annotation Pipeline:
     marks + segments → target-source → block-planner
       → prompt-builder → api-client (Gemini)
       → storage (save) → result-store (index)
       → UI update
       ↓
   Notes:
     Chunk notes → modal popover → IndexedDB → SVG overlay
     Sentence notes → sidebar editor → IndexedDB (per-doc scope)
```

## Risk Levels

### 🔴 High Risk — Plan Required Before Touch
| File | Lines | Why |
|------|-------|-----|
| `app.js` | ~7300 | Central state, all rendering, all event wiring; no tests per function |
| `annotation-generation-controller.js` | ~1591 | Async state machine with rate limit, retry, abort — hard to debug |
| `annotation-api-client.js` | ~795 | Handles API keys and HTTP; security-sensitive |

### 🟡 Medium Risk — Understand Before Edit
| File | Lines | Why |
|------|-------|-----|
| `styles.css` | ~1600 | Glass-morphism design system; theme variables; easy to break layout |
| `annotation-target-source.js` | ~411 | Parsing logic used by generation pipeline |
| `annotation-block-planner.js` | ~333 | Block size constraints affect LLM output quality |
| `annotation-generation-storage.js` | ~269 | Dual backend (localStorage + OPFS) |
| `data-utils.js` | ~186 | Transcript parsing — failure blocks all loading |
| `read-26.html` | ~270 | Script load order must be maintained |

### 🟢 Low Risk — Safe to Modify
| File | Why |
|------|-----|
| `cloze-utils.js` | Pure validation, no side effects |
| `cloze-view-model-helpers.js` | Pure view model builder |
| `playback-index-helpers.js` | Pure binary search, no state |
| `chunk-matching-helpers.js` | Pure text matching, no side effects |
| `chunk-note-layout-helpers.js` | Pure layout math |
| `chunk-note-layout-core.js` | Pure layout result builder |
| `annotation-generation-entry-ui.js` | UI state machine, well-isolated |
| `annotation-bubble.js` | Self-contained floating panel |
| `annotation-prompt-builder.js` | Pure string construction |
| `import-export-shared-helpers.js` | File I/O only |
| `identity-and-storage-keys.js` | Pure key generators |

## Suggested Modification Order (Safe → Risky)

1. **Pure utility modules** (chunk-matching-helpers, playback-index-helpers, cloze-utils, layout helpers, identity-and-storage-keys)
2. **Isolated UI modules** (annotation-bubble, entry-ui, api-settings-ui)
3. **Prompt/data construction** (prompt-builder, block-planner, target-source)
4. **Storage layer** (generation-storage, progress-store, result-store)
5. **Pipeline orchestration** (generation-controller, api-client)
6. **Styles** (styles.css) — cosmetic only, but cross-cutting
7. **HTML** (read-26.html) — script order critical
8. **app.js** — final step; requires most careful planning

## What NOT to Touch

- `SeekPlayerDB` IndexedDB schema (DB name, version, store name, keyPath)
- `package.json` dependencies
- `cankao/` directory (reference only)
- Script load order in `read-26.html` without cross-referencing all JS dependencies

## Low-Risk Extraction Candidates

These are well-contained enough to extract from app.js into standalone modules:

- Theme system (theme toggle, custom colors) → `theme-utils.js`
- Toast/notification system → `toast.js`
- Chunk note rendering (all the `chunk-note-*` functions in app.js) → already partially extracted; remaining could move
- Sentence note sidebar UI → `sentence-notes-ui.js`
