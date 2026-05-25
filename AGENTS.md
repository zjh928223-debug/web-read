# AGENTS.md — Read-Final Project

## What This Is

A zero-framework, single-page HTML/JS/CSS application for language learning with audio playback, synchronized transcripts, AI-powered chunking, cloze quizzes, and annotation generation via Google Gemini API.

## Entry Point

- `read-26.html` — HTML shell; loads all JS in dependency order.
- `app.js` (~7300 lines) — Central orchestrator. Do NOT scan or rewrite without explicit plan.

## Critical Constraints

### app.js Scope
app.js handles: IndexedDB ops, state management, DOM wiring, rendering, event listeners, annotation pipeline dispatch, theme system. It is intentionally monolithic. Do NOT propose refactoring it unless the task explicitly targets app.js decomposition.

### High-Risk Files — Do Not Touch Without Approval
| File | Risk | Reason |
|------|------|--------|
| `app.js` | 🔴 | 7300 lines; central state, rendering, all event wiring |
| `annotation-generation-controller.js` | 🔴 | Async orchestration with rate limiting, retry, abort logic |
| `annotation-api-client.js` | 🟡 | Gemini HTTP client; token/API key handling |
| `annotation-generation-storage.js` | 🟡 | Persistence of generated bundles; directory handle |
| `annotation-target-source.js` | 🟡 | Markup parsing used by the generation pipeline |
| `data-utils.js` | 🟡 | Transcript parsing; breaking it breaks ALL data loading |

### Do NOT Scan
- `node_modules/`
- `output/` (logs, playwright artifacts, screenshots)
- `.git/`
- `.claude/`, `.codex/`, `.vscode/`

### Do NOT Modify IndexedDB Schema
Database: `SeekPlayerDB`, version 1, store `files` with keyPath `id`. Object store structure must NOT change. Any new persistence must use new keys within the existing store.

### Do NOT Modify Package Dependencies
No changes to `package.json` dependencies or scripts unless explicitly asked.

## Workflow Rules

1. **Before any edit, explain your plan** — What files will change, what is the expected effect, what is the rollback strategy.
2. **After any edit, run `npm run verify:read26`** — This starts http-server and runs a Playwright load check. If it fails, fix before proceeding.
3. **Do NOT run global-project searches** without a specific target. Use glob/grep for narrow searches.
4. **Do NOT propose app.js decomposition refactors** unless the assigned task directly requires splitting app.js.
5. **Test first** — Understand existing behavior before changing it.
