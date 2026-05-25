# Read-Web

Vue 3 + Vite — language reading tool with audio sync, AI chunking, cloze quizzes, and annotation generation via Google Gemini API.

## Quick Start

```bash
npm install
npm run dev        # http://localhost:5173
```

## Project Status

**Phase 6 — Cleanup complete.** Vue 3 migration in progress.

- ✅ Vite + Vue shell (Phase 1)
- ✅ 9 stores extracted from app.js (Phase 2)
- ✅ ToastMessage Vue component (Phase 3)
- ✅ 5 component shells (Phase 4)
- ✅ 22 ES module copies (Phase 5)
- ✅ Cleanup + docs (Phase 6)

## Stack

| Layer | Tech |
|-------|------|
| Framework | Vue 3 (Options API) |
| Build | Vite |
| State | Plain JS objects on `window` (→ Pinia deferred) |
| DB | IndexedDB (`SeekPlayerDB` v1) |
| AI | Google Gemini API (`gemini-2.5-flash`) |
| CSS | Liquid Glass design system |
| Test | Playwright |

## File Map

```
read-web/
├── index.html              ← Vite entry
├── vite.config.js
├── package.json
├── app.js                  ← Legacy monolith (6900 lines, being phased out)
├── styles.css              ← Global CSS
├── read-26.html            ← Original (reference only)
├── src/
│   ├── main.js             ← Vue app bootstrap
│   ├── App.vue             ← Root component
│   ├── components/         ← 6 Vue components
│   ├── stores/             ← 9 store files
│   ├── services/annotation/ ← 14 ES module pipeline files
│   ├── utils/              ← 8 ES module utility files
│   └── styles.css
├── scripts/                ← Verification tools
├── cankao/                 ← Reference (old version)
└── openspec/               ← Spec documentation
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm test` | Run legacy Playwright check |
| `npm run verify:vite` | Run Vite Playwright check |

## Key Constraint

**Do not modify `SeekPlayerDB` IndexedDB schema.** DB name, version, store name, and keyPath are fixed. All persistence must use existing store.
