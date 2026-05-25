# AGENTS.md — Read-Web Project (Vue 3 Migration)

## What This Is

A Vue 3 + Vite + Pinia application for language learning with audio playback, synchronized transcripts, AI-powered chunking, cloze quizzes, and annotation generation via Google Gemini API.

Migrated from a zero-framework SPA (`read-26.html` + `app.js` monolith).

## Entry Point

- `index.html` — Vite entry; loads legacy IIFE scripts + Vue app mount
- `src/main.js` — Vue app bootstrap (createApp + Pinia)
- `src/App.vue` — Root component (shell, 5 child components)
- `app.js` (~6900 lines) — Legacy orchestrator, being phased out. Do NOT add new features here.

## Current Architecture (Hybrid)

```
index.html
├── 28 legacy IIFE scripts (regular <script>)  ← still load, being migrated
├── 9 store scripts (regular <script>)         ← Phase 2 stores
├── app.js (regular <script>)                  ← legacy monolith
└── <script type="module" src="/src/main.js">  ← Vue app entry
```

## Directory Structure

```
src/
├── main.js                     ← Vue createApp + Pinia
├── App.vue                     ← Root component
├── components/                 ← Vue components (6 total)
│   ├── ToastMessage.vue        ← Phase 3, functional
│   ├── ClozeQuizView.vue       ← Phase 4 shell
│   ├── ClozeCard.vue           ← Phase 4 shell
│   ├── TranscriptContainer.vue ← Phase 4 shell
│   ├── ChunkModeView.vue       ← Phase 4 shell
│   └── SentenceNoteSidebar.vue ← Phase 4 shell
├── stores/                     ← Store files (3 active + 6 placeholder)
│   ├── theme.js                ← Full theme logic
│   ├── ui.js                   ← Toast delegation
│   ├── audio.js                ← IndexedDB CRUD
│   ├── marks.js                ← Mark operations
│   └── ... (5 placeholders)    ← cloze, transcript, chunk, notes, annotation
├── services/
│   └── annotation/             ← 14 ES module copies of annotation pipeline
├── utils/                      ← 8 ES module copies of utility functions
└── styles.css                  ← Global CSS (moved from root)
```

## Critical Constraints

### DO NOT Modify IndexedDB Schema
Database: `SeekPlayerDB`, version 1, store `files` with keyPath `id`. Object store structure must NOT change.

### DO NOT Change Script Load Order in index.html
The 28 legacy IIFE scripts load in a specific order. Breaking this breaks all legacy code.

### Vue Shells are Phase 4 (Not Active)
The Vue components under `src/components/` (except ToastMessage.vue) are **shells**. They render `v-if="__USE_VUE_RENDERING"` which is currently `false`. They will become active in a future rendering migration phase.

### Stores are Plain Objects
The stores under `src/stores/` are plain JS objects attached to `window`. They are NOT Pinia stores yet. Pinia migration is deferred.

### app.js is Legacy
Do not add new features to app.js. New features should go into Vue components or store files.

## Commands

```bash
npm run dev           # Vite dev server (port 5173)
npm run build         # Production build
npm run verify:read26 # Legacy verification (http-server + Playwright)
npm run verify:vite   # Vite verification (vite + Playwright)
npm test              # Default: verify:read26
```

## Migration Status

| Phase | Status | Git Tag |
|-------|--------|---------|
| 1 — Vite shell | ✅ Done | phase-1-done |
| 2 — 9 stores | ✅ Done | phase-2-done |
| 3 — ToastMessage.vue | ✅ Done | phase-3-done |
| 4 — 5 component shells | ✅ Done | phase-4-done |
| 5 — 22 ES module copies | ✅ Done | phase-5-done |
| 6 — Cleanup | ✅ Done | phase-6-done |
