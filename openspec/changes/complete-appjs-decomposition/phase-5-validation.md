# Phase 5 Validation

Date: 2026-06-16

## Scope

Task 6.7 validates the root script and entry cleanup work from tasks 6.1 through 6.6.

Validated state:

- all four former root regular scripts have Vite module replacements
- `index.html` no longer loads the former root regular scripts
- `vite.config.js` no longer copies the former root regular scripts into `dist/`
- production preview can load the built app

## Production Preview Check

Added `npm run verify:production-preview`, backed by `scripts/production-preview-load-check.cjs`.

The check starts `vite preview` against the built `dist/` output, runs the current load check, and shuts the preview server down.

## Verification Results

Commands run for task 6.7:

```text
node --check scripts\production-preview-load-check.cjs
npm run build
npm test
npm run verify:production-preview
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All commands passed.
