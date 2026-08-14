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

`verifyBackupArtifact` reparses the artifact and independently recomputes
record, domain, manifest and artifact checksums, counts, registry, references
and media policy. `dryRunRestore` is read-only and reports each domain and
record as `keep`, `restore`, `merge` or `blocked`, including schema, reference,
capacity, newer-record-revision and content-id conflicts. Capacity accounts for the restore artifact and
the migration-before rollback copy unless the target explicitly declares a
separate rollback store.

`restore` requires an explicitly isolated target with an atomic transaction,
durable journal, migration-before rollback backup, post-failure snapshot
rollback and corrupt quarantine. A `restoreId` makes retries idempotent; a
completed retry is a no-op and an interrupted/failed retry reuses the original
rollback backup before attempting the commit again.

The public contract and fault matrix are exercised by
`npm run verify:application-backup`. The production composition in
`scripts/lib/read-web-production-backup.mjs` joins the isolated browser
profile adapters with the Python marks/activity and workflow bridge, and
`scripts/application-backup-release-rehearsal.mjs` drives that public entry
through an on-disk journal/rollback/quarantine target. It uses generated
temporary fixture directories only and never restores real daily data.
