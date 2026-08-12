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
