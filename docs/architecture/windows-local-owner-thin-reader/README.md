# Windows local owner / thin reader milestone

This directory is the human entry point and machine-readable evidence bundle for the first reviewable
milestone of `windows-local-owner-thin-reader`.

The milestone freezes the current Windows optimization boundary and defines the future API seam. Task 2.2
adds a contract-only six-domain owner registry and a Local App Host readiness guard; it does not implement
the owner repositories, a browser API client, a lease/journal cutover, or any domain writer migration. The
current browser and Python owners are recorded as facts so that later waves can move one boundary at a time
without treating the compatibility path as authoritative by accident.

## Frozen artifacts

- `environment-baseline.json` — repository, optimization config, ports, data-root policy, tool probes, and
  protected working-tree evidence captured on 2026-08-28.
- `domain-inventory.json` — source-and-adapter inventory of the six durable domains, record/key shapes,
  revision sources, and checksum conventions. It intentionally contains no user-profile payload.
- `ownership-matrix.json` — the six-domain owner/caller/backup/revision/media/rollback matrix and future
  owner facade/query/command seams.
- `browser-direct-writer-consumer-map.json` — direct IndexedDB, localStorage, raw JSON, SQLite read-only,
  `window.*`/DOM compatibility, and workflow-client consumers with migration wave and writer-zero gate.
- `baseline-journeys.json` — API-first journey status. Existing compatibility checks are recorded as
  evidence; journeys that require the not-yet-built owner API are explicitly `blocked`.
- `non-goals.json` — frozen schema, transport, script-order, protected-file, and implementation guard.
- `api-contract.json` — versioned typed envelope, domain/operation registry, identity/revision/idempotency,
  commit receipt, and typed error schema. It is a contract-only artifact; it is not a capability claim.
- `owner-registry.json` — exactly six Host-managed repository contracts with key/schema claims, query/
  command surfaces, revision/backup/recovery evidence, and explicit pre-cutover authority state. The
  static contract and the explicit read-only profile evidence are validated at Local App Host startup;
  missing or invalid profile evidence is degraded and owner operations remain rejected.

Every JSON artifact has an `artifactChecksum` over the canonical JSON object with that field omitted. The
canonicalization is UTF-8 JSON with recursively code-point-sorted object keys, array order preserved, and no
whitespace. `scripts/windows-local-owner-contract-check.mjs` validates the bundle without launching a
service. `scripts/windows-local-owner-baseline-check.mjs` executes every evidence item marked `pass` with a
shell-free Node runner and leaves `not-run` items untouched; its output includes a checksum of the real run.
`scripts/windows-local-owner-determinism-check.mjs` repeats canonicalization and source-map checks.

The owner registry validator is behavior-oriented: it rejects missing or duplicate domains/owners, unknown
or unsupported profile rows, missing inventory/read evidence, missing backup/recovery or
transaction/revision/recovery bindings, browser-only repositories, and canonical browser bridge claims. A
valid profile still reports `ownerApiReady: false` and `acceptingApiAuthoritativeOperations: false` until a
later migration task implements the repository and cutover contract.

## Evidence semantics

`pass` means the named existing focused check or static source assertion actually ran successfully. It does
not mean the future Windows owner API exists. `blocked` means the journey is a required baseline but cannot
be honestly exercised in this milestone because its API-authoritative capability belongs to task 2.2 or a
later task. No blocked journey is used as evidence for an owner-mode cutover.

The six protected WhisperX/language-processing paths retain `sha256AtCapture` as historical evidence only.
The non-goal gate checks that `491bd8a718a82faf9659a460b9b817c69c18eeb0...HEAD` and the staged index do not
contain those paths, so later unstaged user edits are allowed. The twelve historical source captures use
semantic IndexedDB fingerprints instead of full-file hashes: `SeekPlayerDB`, version `1`, `files`, `id`, and
introduced destructive schema operations remain guarded while legacy writer/adapter calls may be removed or
moved. The focused check structurally recognizes IDB object-store operations; comments, strings, cache clears,
and repository-level `clear()` methods are not treated as schema changes.

The consumer gate reads every mapped source and verifies its declared symbol/token evidence. The two small
self-tests exercise both negative boundaries: an unstaged protected-file fixture is allowed, while a committed
or staged protected path, omission of any required Reader Session caller, or omission of its matrix reference
is rejected.

The baseline inventory reads source text and the existing backup registry only. The Local App Host profile
readiness path separately consumes the explicit isolated `browser-profile.json` plus the existing
application-backup composition and Python adapters. On a brand-new optimization launcher instance,
`Start-OptimizationOwnedPair` first asks the controlled Node initializer to create an empty schema-version-1
Host-candidate profile (`localStorage: {}`, `indexedDbRows: []`) only after isolation validation and only when
the profile directory is empty. It never imports or copies legacy browser data. An existing, corrupt, unknown,
or non-empty candidate is never replaced; the normal profile evidence path keeps startup degraded and owner
operations at 503. `profileEvidenceReady: true` for the empty candidate means the isolated evidence source and
bindings are readable, not that a durable owner or API authority exists: `durableOwnerReady` and
`acceptingApiAuthoritativeOperations` remain false until later cutover work, while the real browser
IndexedDB/localStorage remains old-owner pending task 3.3's read-only inventory/import bridge.

Neither the baseline nor the initializer opens `E:\read-web-next`, `E:\read-web`, the daily data root, or a
real browser profile. Any later live rehearsal must use `config/runtime.optimization.json`, ports `5184/8776`,
and `E:\ReadWebData\SubtitleWorkflow-Optimization`.
