# Phase 5 Legacy Copy Cleanup

Date: 2026-06-16

## Scope

Task 6.6 removes the stale `vite.config.js` root script copy plugin after task 6.5 removed the corresponding root script tags from `index.html`.

Removed from `vite.config.js`:

- `legacyScripts`
- `copyLegacyScripts`
- `copy-legacy-root-scripts`
- `copyFileSync` / `mkdirSync` / `resolve` / `dirname` imports

The legacy root files still exist in the repository. This task only removes production build copying.

## New Build Behavior

`vite.config.js` now uses only:

```text
plugins: [vue()]
```

The former root regular scripts are bundled through their module replacements instead of copied as root assets.

## Focused Verification

Added `npm run verify:legacy-root-copy`, backed by `scripts/legacy-root-copy-check.cjs`.

The check guards that:

- `vite.config.js` no longer contains the legacy copy plugin or root script file list
- `index.html` still does not load the former root regular scripts

## Verification Results

Commands run for task 6.6:

```text
cmd /c "node --input-type=module --check < vite.config.js"
node --check scripts\legacy-root-copy-check.cjs
npm run verify:legacy-root-copy
npm run build
npm test
openspec validate complete-appjs-decomposition --strict
git diff --check
post-build dist root script absence check
```

All commands passed. After `npm run build`, `dist/` did not contain the four former root script files.
