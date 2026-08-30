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
- `src/services/windows-owner-legacy-compatibility-bridge.js` — the read-only legacy source boundary for
  inventory, deterministic one-time import input, and explicit rollback-window reads.
- `src/services/persistence/windows-durable-state-migration.js` — the thin, injected per-domain migration/
  restore controller for the isolated Task B slice; it does not claim production authority.

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

## Vocabulary/SRS internal seam

The first small domain slice is now exercised in
`tools/subtitle-workflow/youtube_workflow/vocabulary_srs_owner.py`. It stores the existing vocabulary/SRS
row envelopes under the inventoried keys in a profile-scoped `DurableJsonRepository`, and uses the existing
`OwnerCommitReceiptStore` for expected-revision CAS and idempotent command receipts. Its focused gate is
`npm run verify:windows-owner-vocabulary-srs`.

This is an isolated pre-cutover seam only: the browser vocabulary repositories remain the current writer,
no data migration or UI wiring has occurred, and `/api/app/owner` still returns the existing pre-cutover
`not-ready` result. The seam does not persist ECDICT suggestions, tokens, absolute paths, UI-only state, or
complete media; media-related content remains outside this small JSON record boundary. Aggregate Task A is now
complete because the other four domain seams have been integrated; production authority remains disabled.

## Passage-preview internal seam

The second small domain slice is now exercised in
`tools/subtitle-workflow/youtube_workflow/passage_preview_owner.py`. It keeps the existing
passage-preview and IELTS localStorage envelopes as opaque JSON records in a profile-scoped
`DurableJsonRepository`, with the frozen query/command surface and the existing
`OwnerCommitReceiptStore` for revision CAS and idempotent receipts. Its focused gate is
`npm run verify:windows-owner-passage-preview`.

This remains an isolated pre-cutover seam: browser localStorage remains the current writer and
`/api/app/owner` remains pre-cutover/not-ready, with no migration, backup/cutover, or UI wiring.
Session cache, shortcuts, translation/context display preferences, ECDICT suggestions, tokens, paths,
and complete media stay outside the canonical record boundary. Aggregate Task A is complete; production authority
remains disabled.

## Annotation internal seam

The third small domain slice is now exercised in
`tools/subtitle-workflow/youtube_workflow/annotation_owner.py`. It keeps the existing
`AnnotationGenerationStorage::<audioKey>::<documentId>::annotation.{bundle.v2,generated,status}.json`
records as opaque, shallow-checked JSON envelopes in a profile-scoped `DurableJsonRepository`, with the
frozen bundle/scope/generated/status/corrupt-evidence/storage-mode queries and bundle/import/backfill
commands. The existing `OwnerCommitReceiptStore` supplies Host envelope revision CAS and idempotent
receipts; the bundle's own revision/commitId is only a monotonic imported-record guard, and its FNV
checksum follows `storage.js`'s generated/status JSON order. `lightweight-export` is read-like and never
creates a receipt or download.

This remains an isolated pre-cutover seam: browser audio-folder/localStorage writers, browser merge and
backfill matching, `/api/app/owner`, migration, and authority cutover are unchanged. Runtime indexes,
ECDICT suggestions, directory handles, tokens, paths, complete media, and full export blobs stay outside
the Host record boundary. Aggregate Task A is complete; production authority remains disabled.

## Marks/activity internal seam

The marks/activity slice is now exercised in
`tools/subtitle-workflow/youtube_workflow/marks_activity_owner.py`. It is a narrow typed adapter over
the existing per-job `ReaderMarksActivityRepository` and `ReaderMarksCommitJournal`: marks and activity
remain in their existing versioned workflow envelopes, `expectedRevision`/CAS and activity
`operation_id` semantics are reused, and the journal remains the receipt/evidence authority. No
`marks-activity-owner.json`, parallel canonical JSON, or `OwnerCommitReceiptStore` is introduced. Its
focused gate is `npm run verify:windows-owner-marks-activity`.

This remains an isolated pre-cutover seam: the browser marks caller and outbox remain the current
compatibility path, `/api/app/owner` remains pre-cutover/not-ready, and no browser writer, migration,
backup restore, or authority cutover is connected. The owner accepts only bounded job/content scope and
JSON marks/activity updates; tokens, paths, complete media, playback indexes, and uncommitted UI intent
remain outside the durable boundary. Aggregate Task A is complete; production authority remains disabled.

## Workflow internal seam

The workflow slice is now exercised in
`tools/subtitle-workflow/youtube_workflow/workflow_owner.py`. It is a narrow typed adapter over the
existing `WorkflowHistoryStore` and its injected `DurableJsonRepository`; jobs/history keep their existing
envelopes and revision/recovery behavior, while reader-index/config keep their existing raw JSON shape. It
does not create a `workflow-owner.json` or copy the service's job transition, queue, or process-supervisor
rules. The shared `OwnerCommitReceiptStore` supplies durable receipt evidence, CAS, idempotency, and
reopen/recovery behavior.

Its frozen queries are `health`, `readiness`, `capabilities`, `job`, `history`, `reader-index`, `config`,
`media-capability`, and `receipt`; commands are `job-start`, `job-cancel`, `job-retry`, `config-commit`,
`reader-index-commit`, and `receipt-query`. A committed job command means only that the already-validated
durable job record mutation was submitted and verified. It does not start, cancel, retry, enqueue, or claim
any external process side effect. The focused gate is `npm run verify:windows-owner-workflow`.

The seam is isolated and pre-cutover: `/api/app/owner` is unchanged, the browser workflow client and its
local receipt hint remain non-authoritative, and no migration, backup restore, service-route wiring, or UI
cutover is included. Query responses omit credentials, cookies, machine paths, UI state, and complete media;
the media capability returns only identity/reference, size, content type, ETag, and an authorized relative
media URL. Aggregate Task A is complete; production authority remains disabled.

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

## Task 3.1 browser typed owner API client

`src/services/windows-owner-api-client.js` is the browser boundary for future six-domain owner queries,
commands, and receipt lookups. It derives its operation/capability allow-list from `api-contract.json`, sends
only the frozen `/api/app/owner` JSON envelope with a same-origin relative URL and `credentials: same-origin`,
and relies on the existing HttpOnly instance authorization channel without reading or injecting a token. It
validates request bindings before `fetch` and validates response identity, operation, revision, receipt,
commit-status, and typed-error semantics before returning a small typed result.

The client has no durable browser storage, no automatic mutation retry, and no media-byte interface. A transport
loss or timeout during a command returns `commit-unknown` with the original idempotency lookup information; it
does not replay the command. This is only a dependency-injected client seam: all six domains remain
pre-cutover, existing browser writers are unchanged, and the Host still returns typed `503 not-ready` for legal
owner mutations. `npm run verify:windows-owner-api-client` exercises the boundary with a mock fetch and the
real contract artifact while `npm run verify:windows-owner-contract` checks the documented client contract.

## Task 3.2 browser durable status boundary

`src/services/windows-owner-durable-status.js` is a single, generic in-memory tracker for the future browser
owner adapter. It records only domain/intent generation and request/receipt identity metadata, then maps typed
owner results to `dirty`, `saving`, `saved`, `conflict`, `commit-unknown`, or `not-ready`. It starts at
`not-ready`; local edits, cache/query results, HTTP success, and prepare/ordinary completion cannot create
`saved`. The only saved transition requires a current-generation `committed` result, `commitStatus=committed`,
authoritative revision, and a complete receipt whose profile/domain/operation/request/correlation/idempotency/
expected-revision identity matches the in-flight mutation.

Late generations cannot clear a newer intent. Conflict and not-ready retain the intent, while transport/schema
uncertainty retains a receipt lookup and remains `commit-unknown` without automatic replay. Only a matching
authoritative receipt can resolve that state. Pending/unknown receipts remain unresolved; rejected/validation
results return to dirty. The tracker does not use browser durable storage, persist payloads or media, and is not
connected to current Reader, marks, SRS, Preview, Annotation, or workflow consumers. All six domains remain
pre-cutover and the Host continues to return typed `503 not-ready` for legal owner mutations.

The behavior gate is `npm run verify:windows-owner-durable-status`; it loads the real API operation registry and
exercises all six domains, valid and invalid commit evidence, query/cache isolation, generation ordering,
duplicate results, conflicts, unknown receipt resolution, not-ready preservation, and the memory-only boundary.

## Task 3.3 legacy compatibility bridge

`src/services/windows-owner-legacy-compatibility-bridge.js` is a browser-compatible, dependency-injected read
boundary over the existing `ApplicationPersistence.getAllRows()` frozen `SeekPlayerDB/files` reader, an explicit
read-only `localStorage` collector, and the existing backup adapter `collect()` seam for JSON-backed sources.
The bridge closes over those sources and exposes exactly `inventory()`, `prepareImport()`, and
`readRollbackWindow()`; it has no raw storage handle, `restore`, `commit`, or writer method and is not connected
to the UI, Pinia, or the Production Host route.

Inventory output is metadata-only and includes source kind/identity, six-domain claim classification, schema,
revision, size, content-sensitive checksum evidence, and a stable blocked reason for unknown, ambiguous,
duplicate, unsupported, corrupt, sensitive, or media-byte records. Claims are source-bound: the frozen
`SeekPlayerDB/files` records cannot be supplied by localStorage or an arbitrary JSON source. It always carries the
frozen `SeekPlayerDB` / version `1` / `files` / keyPath `id` identity. A missing source or failed collector is blocked rather than treated as an empty profile, and source
errors are not echoed.

`prepareImport()` re-reads the source and produces a deterministic `legacy-import-input` only when every observed
record is safely classified. It returns a source/import checksum and clones JSON-safe payloads; secrets, raw
handles, complete Blob/ArrayBuffer/byte payloads, unknown records, corrupt values, media data URIs/base64 values,
URL userinfo, and sensitive query values cannot enter the plan. Duplicate source/domain/key identities, including
the same domain/key across selected sources, are blocked rather than arbitrarily selecting the first record; an
explicit single-source rollback read remains source-scoped.
Known non-canonical preference records are reported as explicitly excluded. No Host request or repository
commit is performed. `readRollbackWindow()` requires an exact source identity, domain, and registered record key,
and returns a frozen clone for a rollback window; it never mutates the source or becomes an ordinary durable read
fallback. The six browser sources remain old-owner/pre-cutover until later inventory and migration work.

The behavior gate is `npm run verify:windows-owner-legacy-bridge`; it exercises IndexedDB, localStorage, and JSON
collectors, all six domain classifications, deterministic inventory/import checksums, unknown/schema/corrupt and
media blocking, source/path isolation, no-write counters, cloned rollback reads, and the frozen IndexedDB
schema. Task 3.4 adds the narrow media owner boundary described below; it does not introduce a domain cutover.

## Task 3.4 media resource owner

`src/services/media/media-resource-owner.js` contains both the existing short-lived resource owner and a
validated Windows owner media binding seam. The seam consumes only the frozen `reader-session.media-identity`
or `workflow.media-capability` mapping, accepts a bounded descriptor (`profileId`, media identity, kind, size,
content type, ETag, revision, and an authorized relative `/api/jobs/{jobId}/media/{kind}` URL), and never exposes
a local path or storage handle. A descriptor is range-probed with only `Range: bytes=0-0` (without `If-Range`);
only a `206` response with exact `Content-Range`, `Accept-Ranges: bytes`, matching ETag, and
`X-Read-Web-Media-Identity` can bind it.

The media element receives the authorized URL directly. Replacement, disposal, identity change, ETag mismatch,
missing media, and failed probes release the old resource or return a typed rebind/not-found result. A `200` full
representation from the probe is canceled without reading its body and returns `media-rebind-required`. The seam
does not call `blob()`, `arrayBuffer()`, `text()`, or `URL.createObjectURL`, and its request/response metadata
boundary rejects Blob, ArrayBuffer, typed-array, media data URI, and obvious media base64 payloads. The existing
workflow media route remains a legacy Range stream; the owner media query is still typed `not-ready` while all
six domains are pre-cutover, so no writer, repository, or authority is changed here.

The focused behavior gate is `npm run verify:windows-owner-media-capability`; it covers the two contract mappings,
descriptor and URL validation, no-copy values, Range/ETag/identity checks, direct element binding, replacement,
disposal, and typed failure behavior. Task 3.5 adds the focused boundary slice below; no domain repository or UI
cutover is introduced here.

## Task 3.5 focused boundary slice

`npm run verify:windows-owner-focused-boundaries` is the single reproducible 3.5 check. Its Node portion
executes the existing contract/client/durable-status/media/legacy-bridge and application-backup public seams;
its Python portion reuses the request-policy, receipt, Local App Host, and registered-media TestClient cases for
loopback Host/Origin/token, profile/capability, CAS/idempotency, receipt retry/query, 206/416/ETag/identity, and
path boundaries. The browser portion starts an isolated loopback HTTP fixture with Vite middleware and runs the
real Chromium journey against the browser API client and `MediaResourceOwner`: it verifies same-origin typed
requests, HttpOnly-only authorization, no durable token storage, direct authorized URL binding, byte-range-only
media probes, ETag/identity rebind cleanup, and Blob/ArrayBuffer/typed-array rejection. The fixture owns no real
profile, does not use the optimization service ports, and is closed before the command exits.

The slice is included in `npm run verify:full` but not `npm run verify:fast`; it is focused evidence for the
contract boundaries only. It does not claim owner authority, add repositories, migrate writers, or perform UI
cutover.

## Task 4.1 isolated Reader Session owner repository

`tools/subtitle-workflow/youtube_workflow/reader_session_owner.py` is a small, profile-scoped Host-side
`ReaderSessionOwner` facade over `DurableJsonRepository` and `OwnerCommitReceiptStore`. It is an isolated
pre-cutover seam and is not wired into `/api/app/owner`; the production Local App Host continues to report
Reader Session commands as not-ready and the browser `reader-session-persistence.js` writer remains unchanged.

The canonical record is a bounded JSON snapshot containing schema/domain/profile identity, `contentId`, session
revision, `audioMeta`, `transcript`, `chunkData`, `marks`, media identity/reference metadata, a stable checksum,
and commit metadata. Media metadata contains only `mediaId`, kind, non-negative size, content type, ETag,
revision, and the authorized relative route reference. Complete Blob/ArrayBuffer/typed-array/bytes, data URI,
media base64, and raw paths are rejected; ordinary small JSON/text fields remain valid. The repository keeps the
previous snapshot as a durable `.bak` and never returns an absolute path.

The facade supports typed `snapshot`, `current-revision`, `media-identity`, and `restore-status` queries. Empty
state is explicit; unknown schema, corrupt JSON, and checksum mismatch return manual-recovery evidence without
normalization or overwrite. `prepare` validates the complete candidate and returns only a bounded in-memory
handle/evidence. `commit` and `restore` require the matching base/expected revision and idempotency key, use the
shared durable receipt boundary, and atomically publish a complete snapshot. Repeated keys replay one receipt;
stale or replaced candidates, restore conflicts, and atomic write faults retain the previous canonical snapshot.
After process reopen, current/previous snapshots and receipt evidence can be queried, including a domain commit
that was durable before its receipt response was lost.

The focused gate is `npm run verify:windows-owner-reader-session`; it runs the isolated Python tests for empty and
valid query, prepare-without-write, commit/reopen, receipt idempotency and recovery, CAS/replaced candidates,
no-copy/path/media validation, strict corrupt/unknown handling, restore success/conflict/failure, and atomic
replace faults. It is registered in `verify:full` but is not part of `verify:fast`, and it does not implement
4.2+, backup/migration aggregation, browser cutover, or owner-mode authority.

## Task C1 Reader Session owner consumer

`src/services/windows-owner-reader-session-consumer.js` is the small browser consumer seam for an injected,
ready `ReaderSessionOwner` API client. `src/services/windows-owner-reader-session-composition.js` is the production
composition: it reads the Host `/api/app/health` status with a short bounded probe and injects the consumer only
when liveness/profile/registry basics and the `reader-session` domain's own evidence report
`authoritative`/`writable`; global readiness for unrelated domains is not required. Pre-cutover or degraded status
leaves the existing browser path unchanged. The consumer reads the Host snapshot and reader-session media-identity
capability, normalizes the Python owner envelope into the existing reader session shape, and binds the authorized
media descriptor through `MediaResourceOwner`. The workflow loader uses the existing workflow `media-capability`
query for a newly selected job, while reader-session `media-identity` remains the restore check for the current
committed session.

The owner path publishes a material only after the Host media probe succeeds and the typed prepare/commit result
is committed or can be reconciled from matching receipt/snapshot evidence. Commit idempotency is derived from the
profile and stable candidate/material identity, so a recreated loader can query the same receipt without relying on
an in-memory generation. If the same material is revisited after another material changed the canonical snapshot,
the consumer derives a new occurrence key from the current base revision; a same-key retry of that occurrence still
queries the same receipt. A failed, conflicting, not-ready, or unknown command restores the visible session and
prior media binding without writing browser durable storage.
Media is assigned directly to the element and probed with the existing `Range: bytes=0-0` seam; changed ETag,
identity, revision, malformed snapshots, and failed probes stop the old resource and return a rebind/not-ready
result while retaining the session. The production route remains pre-cutover/not-ready and the existing browser
writer is unchanged.

The isolated Chromium gate is `npm run verify:windows-owner-reader-session-c1`. It covers owner-backed startup,
play/seek, material switch, commit-unknown and CAS/not-ready rollback, malformed snapshot retention, media
Range/ETag rebind, Host reopen, and the no-browser-durable-fallback/no-copy boundary. It is included in
`verify:full` but not `verify:fast`.

## Task B per-domain backup and migration seam

`src/services/persistence/windows-durable-state-migration.js` is a small callable controller over the existing
`createApplicationBackupService`/`verifyBackupArtifact` and the read-only
`windows-owner-legacy-compatibility-bridge`. The caller supplies profile-scoped Host adapters and one small
state store for the domain statuses; the controller does not create another repository, transaction framework, or production
`/api/app/owner` path. The focused fixture supplies all six adapters and uses a reopenable in-memory state store
only to exercise the same persisted metadata boundary without opening a real profile.

Each domain follows the fixed sequence `read-only inventory → dry-run/容量与格式检查 → freeze old writer → final
backup/checksum → one-time final copy/import → verify → switch Host authoritative writer → smoke check → rollback
if needed`. The final envelope always lists all six domains, including empty ones, with record count/checksum/
revision/media-reference metadata and a per-domain rollback target. Final backup and the sole import are rejected
before freeze. A matching import retry replays its saved result without another adapter write; a failed replace keeps
the old Host value, and rollback restores the captured pre-import value when verification permits.

The normalized `sourceIds` selected during dry-run are persisted and reused for the freeze-time final backup, so a
subset migration cannot silently change its source set. If an adapter writes a wrong/partial value before failing or
before post-commit verification, the controller prefers the adapter rollback path for one expected-revision compensation to the invocation
snapshot; a failed compensation remains frozen and not-ready. If the canonical write succeeds but state persistence
fails, reopen consumes the pending import attempt when the canonical snapshot matches the saved artifact instead of
importing again. Numeric revisions retain numeric ordering and opaque owner revisions use strict equality/CAS.

Only identity/reference media metadata is carried. Blob/ArrayBuffer/typed-array/bytes/data-URI/base64 media,
credentials, arbitrary paths, and temporary UI state are excluded. `switchHostAuthoritative` records
`ready-to-switch` with `cutover-deferred`; it does not change production writer authority, which remains a later C2
operation. It retains `frozen: true`, and its smoke result is explicitly deferred/not-ready; a successful B run means
pre-cutover preparation is complete, not that authority or smoke has passed. The focused gate is
`npm run verify:windows-durable-state-migration`; it is standalone rather than part of `verify:fast` and covers
representative six-domain inventory, source selection, dry-run, freeze ordering, final manifest, import/retry,
restore, rollback, no-copy, failure retention, and reopen behavior.

## Task C2 isolated production cutover (completed)

`scripts/lib/windows-owner-cutover.mjs` now exposes the explicit optimization-only
`runWindowsOwnerProductionCutover(...)` entry. It connects the existing backup/migration controller to the
real Local App Host owner handlers and typed owner client for the fixed order
`reader-session → marks-activity → passage-preview → annotation → vocabulary-srs → workflow`. It requires
isolated source/target compositions and an explicit optimization opt-in; ordinary startup and the normal
production route remain pre-cutover/not-ready until a persisted per-domain checkpoint exists.

Each selected domain observes its persisted freeze marker through the already-open browser guard before the
freeze-time final backup. The controller then performs the single import, verify, checkpoint/switch and small
query/mutation smoke in sequence; a failed domain stops later domains and leaves the domain frozen or rolls back
using its existing B evidence. After a successful checkpoint, the compatibility writer is read-only and the
normal typed client can read the Host owner again after a Local App Host reopen. The C2 evidence is the isolated
`npm run verify:windows-owner-c2` journey, supplemented by the passage/annotation browser journey and the
vocabulary/workflow C2c journeys. It exercises the fixed six-domain order with representative records, real
Local App Host handlers, per-domain freeze observation, typed smoke, CAS/idempotency and reopen checks; it never
migrates a daily profile or copies complete media.

## Task D closeout

The optimization workspace now has a completed isolated C2 cutover path for all six domains. A successful
per-domain checkpoint makes the Host authoritative and blocks the old canonical browser writer through the
existing domain guard; normal startup still keeps an uncheckpointed/pre-cutover domain not-ready, and the
explicit optimization entry never auto-migrates a daily profile. Legacy readers needed for inventory or rollback
remain read-only. `SeekPlayerDB` version 1 / `files` / `id`, the thin runtime entries, loopback-only transport,
and identity/reference-only media handling remain unchanged.

The closeout evidence is `npm run verify:windows-owner-c2`, the domain owner/C2c and C1 focused gates,
`npm run verify:windows-owner-focused-boundaries`, `npm run build`, `npm run verify:fast`, and strict OpenSpec
validation. `npm run verify:full` reaches the existing Python dependency-health gate and is blocked by duplicate
installed `networkx` and `torchaudio` distributions before its remaining browser/restore stages; no authority or
readiness claim is based on that blocked run.
