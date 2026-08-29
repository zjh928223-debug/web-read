# Application backup and restore contract

The application backup boundary is intentionally adapter-driven. A backup is
not considered complete unless all six durable domains provide an adapter:

- `reader-session` — the small `SeekPlayerDB/files` reader rows, quarantine evidence,
  and the durable `read-web.reader-save-outbox.v1` / `.v2.*` receipts;
- `marks-activity` — the reader marks/activity ledger. The production
  composition bridges the workflow service's `ReaderMarksActivityBackupAdapter`;
- `vocabulary-srs` — vocabulary, review, acquisition, SRS, learning-event and personalization rows;
- `passage-preview` — the durable preview envelope and known legacy/continuation localStorage keys;
- `annotation` — scoped generated/status/bundle localStorage or audio-folder records;
- `workflow` — jobs/history/reader-index/config and reader-output JSON, with media references only. Its Python owner is
  `WorkflowBackupAdapter`.

The registry is fail-closed: a missing adapter, unclaimed IndexedDB row, unknown
domain or unsupported schema blocks export or import. An adapter returning zero
records is different from an absent adapter and is still represented in the
manifest.

The Read-Web browser adapter audits the current `SeekPlayerDB/files` row IDs,
the Vocabulary/SRS `vocabulary.*` rows, the known Passage Preview and IELTS
continuation keys, and the `AnnotationGenerationStorage::` prefix. Legacy JSON
arrays and raw shortcut/display-mode values are represented with an explicit
key schema and revision `0`; they are not kept as opaque strings. A new key
under either preview prefix or an unclaimed IndexedDB row blocks export until
its owner registers a schema.

Each artifact has `format`, `manifest`, `domains` and `artifactChecksum`. The
manifest records format/schema versions, release/git identity, `createdAt`, the
domain registry, per-domain and per-record counts/checksums, references,
per-domain media references, redaction count and byte limits. Record envelopes
retain `schemaVersion`, `revision`, `contentId` (when applicable), payload and
record checksum.

Credentials are omitted; credential-bearing URL query values and userinfo are
replaced with `[REDACTED]`. Cookies, authorization headers, API keys, proxy
credentials, temporary files and binary values are never exported. Media uses
`identity-metadata-rebind` references with a strict reference ceiling; complete
Blob/ArrayBuffer/typed-array content is rejected.

Reader save-outbox quarantine evidence is fail-closed unless the caller provides
an AES-GCM recovery protector. With a protector, the raw quarantined value is
recoverable from an encrypted sensitive-sidecar envelope, while the ordinary
artifact contains only ciphertext, key identity and safe metadata. Without a
protector, export stops and the original value remains in the source profile;
it is never silently dropped or copied in plaintext.

`verifyBackupArtifact` reparses the artifact and independently recomputes
record, domain, manifest and artifact checksums, counts, registry, references
and media policy. `dryRunRestore` is read-only and reports each domain and
record as `keep`, `restore`, `merge` or `blocked`, including schema, reference,
capacity, newer-record-revision and content-id conflicts. Capacity accounts for the restore artifact and
the migration-before rollback copy unless the target explicitly declares a
separate rollback store.

`restore` requires an explicitly isolated target with an atomic transaction,
durable journal, migration-before rollback backup and corrupt quarantine. The
target must publish `restoreCapabilities` with
`atomicRevisionCommit`, `commitRevisionEvidence` and `verifyAppliedRevision`
set to `true`. Its transaction commit must return or expose a non-negative
committed revision, and `verifyApplied` must return `{ ok, revision }`; targets
without this contract are rejected before any write, while missing post-commit
evidence produces a typed manual-recovery failure. The rollback entry stores
the target's raw state revision; `beginTransaction` must
compare that expected base revision while holding the target lock. A failed
transaction before a durable commit is never allowed to restore an old
snapshot. Snapshot rollback is attempted only when the transaction exposes a
committed revision (or equivalent partial-commit evidence), and the rollback
itself uses an expected-revision CAS. If another writer advances the target,
  restore returns a revision conflict/manual-recovery outcome and leaves the
  newer state intact. A `restoreId` makes retries idempotent; a completed retry
  is a no-op and an interrupted/failed retry reuses the original rollback backup
  only when its journal evidence is safe.

The invocation snapshot is created synchronously by `restore()` before the
first promise suspension. It fixes the generated `restoreId`, deep-copies and
freezes `resolutions`, fixes the target capability identity and stores the
caller's `AbortSignal` reference. The signal is the only restore input whose
state remains intentionally dynamic; the original options object and its
resolutions object are never read again. The restore core receives only this
frozen invocation plus the target capability bundle.

Commit evidence has a fixed capture contract. A valid `commitResult.revision`
has priority. If commit returns `undefined`, the transaction may instead
provide a bound `getCommittedRevision()` method or a getter descriptor for
`committedRevision` captured at transaction bind time. A writable data property
is not an accepted evidence reader. The captured reader is used for both a
normal empty-return commit and a commit that writes and then throws. On a
failed commit, the restore service reads and fixes that evidence before it
invokes transaction rollback, so transaction cleanup cannot erase proof of an
already durable write. Valid evidence must be a non-negative integer. Confirmed
partial commit always attempts snapshot rollback with the committed revision as
expected-revision CAS. Missing, invalid or unreadable evidence remains a typed
manual-recovery failure and is never silently treated as an uncommitted
transaction or a completed rollback.

The generic restore gate also requires a private-issuer registration for the
target object itself. Registration binds the canonical isolation certificate,
all safety/capacity/rollback scalars, the complete own-key and property
descriptor surface, the target prototype, every restore method (including
`mergeDomain`), and the journal, adapter, rollback-store, quarantine and
capability surfaces. A borrowed certificate, spread/clone, proxy, added or
  deleted member, accessor replacement, prototype change, method replacement, or
  nested safety-surface mutation is rejected as `RESTORE_TARGET_UNSAFE` before
  target methods or writes are reached. Production fault injection is held in a
  private closure and changed only through the controlled `setFaults` hook; a
  mutable public `faults` safety object is not part of the production target.

Registration is not a promise that the public target object is frozen. At the
start of each restore, `resolveTrustedTarget` creates a private immutable
capability bundle from the registered canonical layout, exact bound target
methods, normalized adapter methods, capacity policy, journal/rollback/
  quarantine stores, resolutions and revision evidence. The bundle also invokes
  the registered synchronous `captureRestoreOperation` seam. Production targets
  return an opaque WeakMap token whose fault-plan data is deep-copied and frozen;
  `setFaults` changes only the next token's plan. Begin, rollback-backup,
  apply/commit and after-commit fault behavior reads the token's private plan,
  including a private fail-once cell, rather than shared public fault state.
  Adapter/store runtime values are copied into private operation cells; the
  restore core receives only that bundle and does not re-read `target` across an
  `await`. A returned transaction is immediately reduced to bound
  `applyDomain`, `commit`, `rollback` and captured evidence-reader capabilities.
  Therefore a later public property, descriptor, prototype, adapter/store method,
  capacity, fault plan or resolutions mutation cannot redirect the current
  operation. Fault callbacks remain adversarial test hooks: they may mutate the
  public facade, but the operation continues through its captured bundle. This
  is bundle snapshot semantics, not a claim that arbitrary application closures
  outside the trusted target factory are frozen.

The public contract and fault matrix are exercised by
`npm run verify:application-backup`; the path-scoped concurrency stress is
`npm run verify:application-backup-concurrency`. The production composition in
`scripts/lib/read-web-production-backup.mjs` joins public restore adapters for
all six domains. The browser-facing adapter contract is the same one used by
`ApplicationPersistence` for `SeekPlayerDB` version 1, object store `files`,
and key path `id`; the localStorage adapter owns Passage Preview and
Annotation envelopes, and the Python bridge owns marks/activity and workflow
through `DurableJsonRepository`. The isolated Node gate intentionally uses a
temporary file-backed profile plus a `MapStorage`/JSON persistence shim, so it
never opens a user's IndexedDB or localStorage. The six-domain production
composition now publishes `atomicRevisionCommit: true` together with a durable
application-profile lease. That cross-process lease is held across the full
sequential owner commit; public owner reads and a second composition startup
wait behind it, so they observe the complete baseline or complete committed
revision rather than an in-progress owner mix.

The Local App Host CLI requires the isolated application root plus browser,
Python state and Python output paths. Before it binds a port, a Node lock holder
acquires the same lease, constructs the production composition and performs
pending-restore recovery. The holder keeps the lease for the host lifetime via
a parent-owned pipe; graceful exit or process death closes the pipe and releases
the lease. Restore cannot start while the application is serving, and the host
cannot become ready while restore or startup recovery is incomplete. Recovery
status is exposed as startup evidence and closes the interrupted journal as
`rolled-back` or `completed`. This completes 12.2. Task 12.3 subsequently copied
the real browser profile and read the real workflow roots without writing them,
restored all six domains under a temporary isolated root, reopened them, and
reproduced every record count and domain checksum. Reader, Vocabulary, SRS,
Preview, Annotation and workflow journeys passed with zero network requests.
Complete media bytes and retired browser rows remained excluded; workflow media
identity metadata is persisted as rebind evidence so a restore/reopen round trip
remains exact.

`createReadWebApplicationRestoreTarget` keeps the browser-facing stores,
journal, rollback backup, pending checkpoint, revision evidence and quarantine
in the explicitly isolated profile supplied by the caller. A restore starts
with a read-only dry-run; conflicts are reported per domain and per record and
default to fail-closed. `keep`, `restore` and `merge` are explicit decisions.
The target writes a durable pending checkpoint before applying domains, uses
domain CAS guards, confirms the new revision, and recovers a pending operation
to either its complete baseline or its complete staged state. Every rollback
backup is independently checksummed and associated with the `restoreId` and
artifact checksum. Quarantine entries preserve source key, raw value, time,
reason and checksum evidence and are read back before a corrupt source is
discarded.

`npm run verify:application-backup-real-restore` audits the real six-domain
composition and performs a successful reopenable round trip while retaining
dry-run/capacity evidence. `application-backup-atomic-boundary-check.mjs`
holds a commit after its first owner, proves in-process reads and a second
startup remain blocked, then hard-kills a child restore and proves the next
startup recovers before exposing owners. The failure matrix is
`npm run verify:application-backup-restore-faults`; its transactional cases run
against the isolated file-backed foundation target and cover rollback-backup
failure before writes, per-domain abort, quota/disk-full, revision conflict,
checksum/schema corruption, page-close retry, and rollback success/failure
reports. The Python owner tests are
`npm run verify:workflow-application-backup-restore`, while `npm run
verify:full` includes these machine checks. All fixtures are generated in
temporary directories; no daily profile, IndexedDB schema or real user data is
opened by these gates.

All file-backed target mutations share a cross-process lock. A complete owner
record is written and synced in a unique claim directory before an atomic
claim-to-canonical rename; only the canonical lease can block writers. Heartbeat
and PID checks protect active owners, while bounded stale recovery handles
dead canonical leases and abandoned claims without deleting an active lock.

## Task B: minimal per-domain migration controller

`src/services/persistence/windows-durable-state-migration.js` provides the
isolated, pre-cutover migration seam. It reuses the read-only legacy bridge to
build the standard six-domain application-backup artifact and the existing
artifact verifier; it does not define a second backup format or connect the
production owner API. A caller supplies the profile-scoped Host adapter and
small state store used for the domain's final/rollback metadata.

The controller enforces `read-only inventory → dry-run/容量与格式检查 →
freeze old writer → final backup/checksum → one-time final copy/import → verify
→ switch Host authoritative writer → smoke check → rollback if needed`. The
final envelope includes all six domains, including empty domains, per-domain
record count/checksum/revision and media-reference metadata, plus the captured
rollback target. Final backup/import are unavailable before freeze; a matching
retry is a no-op with the same saved result. Failed replace or verification
leaves the old value available, and the one-domain failure stops the remaining
sequence.

This seam is only tested with isolated fixtures. It keeps the legacy sources
read-only, preserves `SeekPlayerDB` version 1 / `files` / `id`, carries media
identity/reference metadata instead of media bytes, and records rather than
performs the future authority switch. Browser writer cutover remains a later
task.
