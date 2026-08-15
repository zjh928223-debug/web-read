# Script inventory

The machine-readable inventory is `script-inventory.json`. It covers executable files below
`scripts/` that are not named directly by a `package.json` command.

- `releaseGate` contains checks reached transitively by an npm verification command.
- `devTool` contains intentional manual helpers. The current desktop launcher chain is represented
  by `launch-learning-page.ps1` and `start-latest-reader.ps1`; this cleanup does not change it.
- `archiveDelete` records retired hard-coded startup scripts, duplicate runners, and `read26`
  compatibility names. These paths must remain absent.

Valuable standalone behavior checks have explicit `verify:*` package commands and therefore do not
appear in this package-external inventory. Run `npm run verify:script-inventory` after adding,
renaming, or removing a script.

## Test evidence inventory

`test-inventory.json` is the deterministic machine-readable audit for package/npm direct and
transitive verification commands plus executable Node checks under `scripts/`. It records the
primary category (`architecture`, `behavior`, `browser`, `performance`, or `release`), all layers,
source-shape/source-read/browser/performance/release evidence, invocation depth, and every owner.
An executable check may not remain an orphan.

Refresh and validate it with:

```powershell
npm run verify:test-inventory:update
npm run verify:architecture:test-inventory
npm run verify:test-inventory
```

Source-shape checks (`includes`, `match`, `indexOf`, file-shape assertions) are architecture
evidence only. For a mixed check, `architectureEvidence` records only that source-shape
aspect; its behavior/browser/performance/release assertions are not credited as architecture.
The canonical aggregate is `verify:architecture:source-shape`; the canonical
migrated-interface behavior aggregate is `verify:behavior:migrated-interfaces`. Existing
`verify:<feature>` commands remain callable compatibility aliases so external callers are not
broken. Fast/full use the canonical aggregates, and their plans state which layers are excluded.

The two temporary architecture exclusions owned by the 10.5 production migration
(`runtime-state-source-check.cjs` and `video-player-module-check.cjs`) remain visible in the
canonical architecture plan and inventory; they are not behavior, performance, or release
evidence. Once the production seams land, remove the exclusions and restore those focused guards.

Root legacy artifact and flag cleanup is tracked separately in
`legacy-deletion-inventory.json` and enforced by `npm run verify:legacy-deletion`.
