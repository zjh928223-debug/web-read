# PROJECT_MAP.md — Read-Web (Vue 3)

## Overview

```
read-web/
├── index.html                ← Vite entry (legacy scripts + Vue mount)
├── vite.config.js            ← Vite config
├── app.js                    ← Legacy monolith (~6900 lines)
├── styles.css                ← Global Liquid Glass CSS
├── read-26.html              ← Original (reference)
├── package.json
├── .gitignore
│
├── src/
│   ├── main.js               ← createApp + Pinia
│   ├── App.vue               ← Root (ToastMessage + 5 shells)
│   ├── styles.css            ← (moved from root)
│   ├── components/            ← 6 Vue SFCs
│   │   ├── ToastMessage.vue       ← ✅ Active (Options API)
│   │   ├── ClozeQuizView.vue      ← 🔲 Shell (v-if flag)
│   │   ├── ClozeCard.vue          ← 🔲 Shell
│   │   ├── TranscriptContainer.vue← 🔲 Shell
│   │   ├── ChunkModeView.vue      ← 🔲 Shell
│   │   └── SentenceNoteSidebar.vue← 🔲 Shell
│   ├── stores/                ← 9 store files (IIFE, pre-Pinia)
│   │   ├── theme.js           ← ✅ Active (theme logic)
│   │   ├── ui.js              ← ✅ Active (toast delegation)
│   │   ├── audio.js           ← ✅ Active (IndexedDB)
│   │   ├── marks.js           ← ✅ Active (mark ops)
│   │   └── ... (5 placeholder)
│   ├── services/annotation/   ← 14 ES module pipeline copies
│   └── utils/                 ← 8 ES module utility copies
│
├── (28 legacy IIFE JS files)  ← Still loaded by index.html
├── scripts/                   ← Verification utilities
├── cankao/                    ← Reference (never touch)
└── openspec/                  ← Spec docs
```

## Data Flow

```
[Audio + JSON files] → app.js (parse via DataUtils)
       ↓
    app.js builds: words[], segments[], wordStarts[]
       ↓
    <audio> timeupdate → bsFindActive → highlight
       ↓
    [Normal mode] renderTranscript() — sentence-level
    [Chunk mode]  renderChunkMode() — block-level + CN
       ↓
    Mark word (m key) → markedMap → saveToDB('marks')
       ↓
    Annotation Pipeline (14 modules):
      marks + segments → target-source → block-planner
        → prompt-builder → api-client (Gemini)
        → storage (save) → result-store (index)
        → UI update
       ↓
    Notes: chunk notes, sentence notes → IndexedDB
```

## Risk Levels

### 🔴 High Risk
| File | Lines | Why |
|------|-------|-----|
| `app.js` | ~6900 | Central state, rendering, event wiring |
| `annotation-generation-controller.js` | ~1591 | Async state machine, rate limit, retry, abort |
| `annotation-api-client.js` | ~795 | API key handling, HTTP |

### 🟡 Medium Risk
| File | Lines | Why |
|------|-------|-----|
| `styles.css` | ~2500 | Glass-morphism system, theme variables |
| `annotation-target-source.js` | ~411 | Parsing used by entire pipeline |
| `annotation-block-planner.js` | ~333 | Block size constraints affect LLM output |
| `data-utils.js` | ~186 | Transcript parsing — failure blocks loading |

### 🟢 Low Risk
- Vue components (isolated, flag-gated)
- Store files (plain objects, delegating)
- ES module copies (not yet consumed)
- Utility files (pure functions)
