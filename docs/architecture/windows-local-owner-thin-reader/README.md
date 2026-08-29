# Windows local owner / thin reader milestone

This directory is the human entry point and machine-readable evidence bundle for the first reviewable
milestone of `windows-local-owner-thin-reader`.

The milestone freezes the current Windows optimization boundary and defines the future API seam. Task 2.2
adds a contract-only six-domain owner registry and a Local App Host readiness guard. Task 2.3 wires the
existing cross-process application-profile lease through Host lifetime and production restore entry points,
and adds an atomic owner-mode checkpoint contract; it still does not implement the owner repositories, a
browser API client, or any domain writer migration. The current browser and Python owners are recorded as
facts so that later waves can move one boundary at a time without treating the compatibility path as
authoritative by accident.

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
  commit receipt, typed error schema, and profile-lease/owner-mode semantics. It is a contract-only
  artifact; it is not a capability claim.
- `owner-registry.json` — exactly six Host-managed repository contracts with key/schema claims, query/
  command surfaces, revision/backup/recovery evidence, and explicit pre-cutover authority state. The
  static contract and the explicit read-only profile evidence are validated at Local App Host startup;
  missing or invalid profile evidence is degraded and owner operations remain rejected.
- `owner-mode-checkpoint.schema.json` — the small versioned schema for the single per-domain authority
  switch; it requires lease identity, old-writer drain evidence, Host-managed repository revision evidence,
  and a checksum.
- `scripts/lib/windows-owner-pending-journal.mjs` — the focused profile-journal coordinator used by the
  isolated behavior gate; the production composition only calls its lease-protected recovery seam.
- `tools/subtitle-workflow/youtube_workflow/windows_owner_health.py` — the focused health/capability snapshot
  and diagnostic-redaction seam used by the Local App Host.

Every JSON artifact has an `artifactChecksum` over the canonical JSON object with that field omitted. The
canonicalization is UTF-8 JSON with recursively code-point-sorted object keys, array order preserved, and no
whitespace. `scripts/windows-local-owner-contract-check.mjs` validates the bundle without launching a
service. `scripts/windows-local-owner-baseline-check.mjs` executes every evidence item marked `pass` with a
shell-free Node runner and leaves `not-run` items untouched; its output includes a checksum of the real run.
`scripts/windows-local-owner-determinism-check.mjs` repeats canonicalization and source-map checks.

The owner registry validator is behavior-oriented: it rejects missing or duplicate domains/owners, unknown
or unsupported profile rows, missing inventory/read evidence, missing backup/recovery or
transaction/revision/recovery/application-lease bindings, browser-only repositories, and canonical browser bridge claims. A
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

## Task 2.3 lease and checkpoint contract

`read-web-production-backup.mjs` is the single lease implementation for the optimization application
profile. Its atomic claim directory, canonical lock, heartbeat, PID/stale recovery, and release-on-error
behavior are reused by the Local App Host lock-holder, production restore target, owner read helper, and
the migration-cutover checkpoint helper. The per-instance directory under
`.read-web-application/instances/<instanceId>` still has an instance-lifetime lock for profile/Python
state isolation; it is not the authority identity. The authority lease and checkpoint tree are instead
under the stable `.read-web-application/profiles/<profileId>` target, which is validated inside the same
optimization application isolation root. The lock-holder keeps that stable lease for the Host lifetime; a
second overlapping Host may hold only its own instance lock as `standby`, receives no authority lease, and
does not become an authoritative writer. A failed or stopped Host releases its locks before the next
startup.

`owner-mode/checkpoints/<domain>.json` is the only authority-switch record. It is created atomically while
the profile lease is held, cannot overwrite an existing checkpoint, and must bind the profile identity,
stable profile-lease identity, blocked old writer, read-only compatibility mode, zero in-flight mutations,
Host-managed repository identity/type, base/current revision evidence, and `host-api=authoritative`. A
missing checkpoint keeps the domain `pre-cutover`; corrupt, foreign, partial, or unsupported checkpoints
are rejected. `readOwnerCanonicalDomain` calls only an explicitly matching Host-managed repository reader
under the same lease and never falls back to browser storage.

`restoreTarget` and the cutover checkpoint helper acquire and verify the stable profile authority lease
before touching authoritative state; the instance-lifetime lock is an additional local state guard, not a
substitute for that profile lease. The optimization launcher passes `standby-if-busy` for an overlapping
replacement, but marks that readiness only as an internal candidate preflight. A standby Host is never a
committed active target: the launcher drains/stops the candidate, drains/stops the old Host, then restarts
the same candidate instance in authoritative mode and waits for `profileLeaseMode: authoritative`,
`profileLeaseReady: true`, and a live stable lease before writing the front-door target. Thus the old and
replacement Host never hold two stable profile leases at once. If promotion fails, recovery first
ownership-checks and drains/stops the replacement, waits until the stable profile lease is absent, then
restores the old Host from its captured manager receipt and only afterward restores the old pointers; a
standby result is never committed. A normal/committed Host without the stable lease is degraded, while the temporary
candidate may report ready only with the explicit preflight flag. The current boolean drain/freeze inputs
are only a contract/test seam for the future 7.1 coordinator; they do not claim that real browser freeze
or drain has been verified.

Before replacing the committed front-door target, the launcher durably records `status: committed` with
`phase: commit-pointer-pending`. The stable front door continues serving the previous target until the
new committed-target file matches; after that file is visible, a launcher crash can only enter forward
recovery. A committed journal is never sent through the rollback branch; if its replacement is not ready,
the journal remains for a safe retry and the service stays fail-closed.

The current optimization candidate therefore reports `profileLeaseReady: true` and
`ownerMode.status: pre-cutover`, while `durableOwnerReady` and
`acceptingApiAuthoritativeOperations` remain false and owner commands remain typed `503`. The checkpoint
helper is a contract/test seam for later cutover; it does not migrate writers or make the static six-domain
registry authoritative. Focused lease evidence is `npm run verify:windows-owner-lease`; handoff evidence is
`npm run verify:windows-owner-handoff`, which runs two real isolated Python Hosts through standby,
stable-lease release, authoritative promotion, and a failed promotion with no active-pointer commit, then
invokes the real `scripts/optimization-launcher-check.ps1` journal/snapshot recovery gate. If the selected
optimization Python is blocked by the known duplicate `networkx`/`torchaudio` distribution check, the JSON
result reports `status: blocked`, `launcherRecovery.status: blocked`, exits non-zero, and does not claim
launcher rollback passed; consequently `verify:windows-owner` remains blocked until that environment gate is
fixed. The
production lifecycle check also proves the running Host holds the lease and keeps the owner API in
pre-cutover mode. The crash gate permits the rollback baseline instance or the committed forward-recovery
instance, as identified by the recovered active manager state, and rejects every other leftover instance.

Neither the baseline nor the initializer opens `E:\read-web-next`, `E:\read-web`, the daily data root, or a
real browser profile. Any later live rehearsal must use `config/runtime.optimization.json`, ports `5184/8776`,
and `E:\ReadWebData\SubtitleWorkflow-Optimization`.

## Task 2.4 pending journal and recovery

The profile-scoped pending journal lives under the stable profile authority root and uses the existing
application-profile lease and atomic JSON replace helper. It records a versioned operation identity,
release/instance metadata, the fixed domain order (`reader-session`, `vocabulary-srs`, `passage-preview`,
`annotation`, `marks-activity`, `workflow`), complete baseline/staged profile revision checksums, and
per-domain prepare/commit evidence. It accepts only the small operation set needed by this contract:
restore, migration-cutover, and material-publish. No token, secret, media bytes, or unnecessary personal
path is stored in the journal.

The coordinator never synthesizes adapter evidence from the request. Each adapter must return a complete,
matching `verified` prepare record or `committed` commit record, including the requested baseline/staged
revision and checksum, its evidence checksum, source, and timestamp. Each commit receives that domain's
current baseline revision as `expectedRevision` for CAS. Before the journal can become `committed` or
`finalized`, all six adapters are read again and every actual identity must equal the staged identity;
no-op or incorrectly written adapters remain unresolved instead of producing `staged-committed` evidence.

An operation is `pending → prepared → committing → committed → finalized`; all six prepare records must be
durable before the first commit, and every committed domain is recorded before the next visible profile
revision. Startup checks this journal while holding the same stable profile lease before running the older
application restore recovery. A resolved journal is finalized and retained as evidence. An unresolved
journal is recovered only to one complete baseline or one complete staged revision. Missing/unknown/corrupt
evidence, a revision conflict, missing adapter/recovery handler, failed atomic journal write, or a busy/non-
authoritative profile lease yields `manual-recovery`/not-ready and leaves the journal available for review;
it never publishes a partial cross-domain combination or falls back to a browser writer. Repeating recovery
after finalization is idempotent, and two recovery processes are serialized by the stable lease. An explicit
`not-run` result with `ready: false` is also blocking; it is a diagnostic state, not an empty or ready recovery.

The production composition supplies no six-domain pending adapter yet, deliberately: an active journal is
therefore retained as `manual-recovery` until later domain adapter work provides real evidence. The Host
exposes this diagnostic through `ownerPendingRecovery`, but remains pre-cutover; `ownerMode` is still
`pre-cutover`, `durableOwnerReady` and API-authoritative mutation acceptance remain false, and no current
browser writer or canonical domain authority is migrated. `npm run verify:windows-owner-journal` runs the
isolated adapters through ordered commit, process-death baseline/staged recovery, missing/corrupt evidence,
atomic-write failure, lease contention, concurrent recovery, and recovery-before-ready composition cases.

## Task 2.5 request policy middleware

`youtube_workflow.windows_owner_request_policy` is the shared, small request-policy seam used by the Local
App Host and workflow service. It validates explicit loopback Host/Origin and instance-token rules before
dispatch. Query-string tokens remain a narrowly scoped compatibility path for GET/HEAD media URLs and the
workflow event stream consumed by `EventSource`; formal owner routes require the instance token in a header
or the existing cookie and never treat CORS as authorization. Owner envelopes are checked against
`api-contract.json`, the six-domain operation/capability registry, the current profile/instance, and
mutation-only `expectedRevision`/`idempotencyKey` requirements.

Payload paths are resolved under configured roots before a future handler can access a repository, media,
credential, or capability file; traversal and symlink/junction escapes are rejected without echoing the
token or full personal path. Existing workflow routes keep their established route behavior and only share
the common transport checks. A valid owner request still receives the existing typed `503 not-ready` in
this pre-cutover stage: this task does not add domain repositories, browser clients, or authority/cutover.

The focused behavior gate is `npm run verify:windows-owner-request-policy`; it covers the accepted
loopback/media compatibility cases and the fail-closed owner/path cases without starting a production
server or touching canonical profile data.

## Task 2.6 commit receipts and commit-unknown recovery

`youtube_workflow.windows_owner_receipts.OwnerCommitReceiptStore` is the small Host-owned receipt
store for the stable application-profile authority root. It reuses the existing cross-process JSON
lock and atomic replace helper, stores only profile/instance/request identity, revision, fingerprints,
checksums and evidence metadata, and rejects a missing, corrupt, unsupported, or partially written
receipt document instead of guessing a result. The store covers the fixed six-domain contract and
does not make any domain repository authoritative.

Mutation adapters receive the baseline/current revision for CAS and must return a complete explicit
evidence record: status, matching domain and expected revision, new revision, request/effect
fingerprints, sorted record checksums, evidence checksum, and a safe source. The coordinator never
constructs a committed receipt from a request alone. A same-key/same-fingerprint retry replays the
original receipt without invoking the adapter; a same-key/different-request retry is a conflict.
Abort and stale-CAS paths are non-committed, while a process death, timeout, response loss, or
receipt replace failure leaves `commit-unknown` evidence available for a later authoritative
reconciliation. A caller may inject one resolver per domain (or one resolver for all domains); it
receives the persisted pending receipt and reads the domain repository's own durable revision,
effect fingerprint and record checksums. `receipt-query` invokes that resolver after a Host restart,
so a new Host process can resolve a commit without sharing the old adapter's memory. No resolver or
no matching evidence keeps the result `commit-unknown`; corrupt or contradictory evidence is
`manual-recovery`, and no second side effect is started. The explicit `reconcile` seam remains
available for a caller that already has the same authoritative evidence.

The Local App Host exposes the `receipt-query` owner route through the existing transport and
operation/capability policy. A query can recover a receipt after a new Host instance starts when a
configured authoritative resolver can verify the domain evidence; it still requires the stable
authoritative profile lease when a real lease process is present. Other owner commands remain typed
`503 not-ready`: the current six domains stay pre-cutover, browser writers are unchanged, and no
production repository mutation or authority switch is claimed. The focused behavior gate is
`npm run verify:windows-owner-receipt`; it uses isolated synthetic adapters, disk-backed evidence,
new-process recovery and a real `Production Host` dispatch to exercise abort, process death,
timeout/response loss, duplicate retry, CAS conflict, corrupt evidence, atomic-write failure,
six-domain persistence and receipt query.

## Task 2.7 health and capability snapshot

`youtube_workflow.windows_owner_health` is the single small aggregation seam for Local App Host health and the
delegated `/api/app/capabilities` document. It distinguishes process liveness, application readiness and
durable-owner/API-authoritative readiness. The latter remains false in this pre-cutover milestone: every domain
reports its declared owner/facade, registry/adapter/repository/revision/recovery state, query/command capability
state and stable reason codes. The legacy nullable `profileLease` field remains compatible with the launcher;
the structured `profileLeaseState` reports mode, binding, aliveness and separates `authoritativeLeaseHeld` from
`authoritativeOperationsAllowed`; the latter is false until owner mode, API and durable-readiness gates all pass.
Pending journal state, aggregate receipt counts,
runtime/API/registry schema compatibility, Range/206/ETag identity capability and required/optional dependencies
are reported in the same snapshot. Optional AI, dictionary, ECDICT and external-network failures never make
liveness fail; required workflow failure makes application readiness not-ready.

The capability route retains the existing nine endpoint list and is enriched with the same readiness, domain,
lease, recovery, schema, Range and dependency snapshot. When a capability sidecar owns the route, the Local App
Host safely merges this snapshot into its JSON response; the route remains delegated and no domain repository or
writer is introduced. A host without a sidecar serves the same nine-endpoint contract locally.

Health diagnostics are allow-listed and redacted: `dataRoot` is only `configured`/`not-configured` with a stable
`dataRootIdentity`, manifest interpreter paths are omitted, and receipt/request/idempotency identities, tokens,
cookies, media bytes and raw exception/path text are not returned. The optimization launcher compares the hashed
root identity and release runtime hashes rather than requiring an absolute path or interpreter path in health.
`applicationStartupRecovery` remains a small lifecycle summary; it does not claim browser freeze/drain or owner
cutover. The focused evidence is `npm run verify:windows-owner-health`.
