# Read-Web

Vue 3 + Vite — language reading tool with audio sync, AI chunking, cloze quizzes, and annotation via Google Gemini API.

## Quick Start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build
npm test           # Playwright verification
```

## Architecture

```
index.html → 27 legacy IIFE + 9 stores + app.js + Vue entry (main.js)
                ↓                              ↓
         (data + pipeline)              Vue 3 App (Pinia + 6 SFCs)
```

| Layer | Tech | Status |
|-------|------|--------|
| Rendering | Vue 3 SFC (Options API) | ✅ Active |
| State | Pinia (9 stores) + IIFE bridge | ✅ Active |
| Build | Vite | ✅ |
| DB | IndexedDB (SeekPlayerDB v1) | ✅ |
| AI | Gemini API (gemini-2.5-flash) | ✅ |
| CSS | Liquid Glass system | ✅ |
| Test | Playwright | ✅ |

## Structure

```
src/
├── main.js                     ← createApp + Pinia + bridge
├── App.vue                     ← Root
├── components/                 ← 6 Vue SFCs
│   ├── ToastMessage.vue        ← Pinia reactive
│   ├── TranscriptContainer.vue ← Normal mode
│   ├── ChunkModeView.vue       ← AI chunk mode
│   ├── ClozeQuizView.vue       ← Quiz container
│   ├── ClozeCard.vue           ← Quiz card
│   └── SentenceNoteSidebar.vue ← (shell)
├── pinia-stores/               ← 9 Pinia stores
├── stores/                     ← 9 IIFE stores (bridge)
├── composables/                ← 2 composables
├── services/annotation/        ← 14 ES modules
└── utils/                      ← 8 ES modules
```

## Key Constraint

Do not modify `SeekPlayerDB` IndexedDB schema. DB name, version, store, keyPath fixed.

## Migration History

20 commits, 7 phases.

| Phase | What |
|-------|------|
| 1 | Vite + Vue shell |
| 2 | 9 stores extracted |
| 3 | ToastMessage.vue |
| 4 | 5 component shells + render toggle |
| 5 | 22 ES module copies |
| 6 | Cleanup + docs |
| 7 | Pinia bridge |
| 8 | Composables + default Vue render |
| 9 | Gut old render, delete read-26.html |
