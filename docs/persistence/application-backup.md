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
never opens a user's IndexedDB or localStorage. That rehearsal does not prove
a real browser startup recovery seam or completion of 12.2/12.3.

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

`npm run verify:application-backup-real-restore` runs a real six-domain
temporary-profile round trip and idempotent retry. The failure matrix is
`npm run verify:application-backup-restore-faults`; it covers rollback-backup
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
