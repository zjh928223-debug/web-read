# Controlled production migration entry

The one-time entry is `scripts/windows-owner-production-entry.mjs`. It is an
explicit, optimization-only operator tool; normal browser startup never imports
or invokes it. It has six commands:

```text
plan inventory dry-run apply resume rollback
```

Every invocation must name the browser origin/profile, workflow roots, run
root, Host loopback URL/instance, profile id, target instance roots, target
profile-authority roots, and migration-state path. The Host token is supplied
only through the named environment variable. The tool rejects relative paths,
overlapping source/target roots, non-loopback Host URLs, unknown arguments, and
the frozen `SeekPlayerDB v1/files/id` boundary.

`plan`, `inventory`, and `dry-run` are read-only with respect to the source and
target durable data. They may create disposable staging material under the
explicit run root and remove it before returning. `apply`, `resume`, and
`rollback` require the matching explicit confirmation:

```text
--confirm-owner-migration APPLY
--confirm-owner-migration RESUME
--confirm-owner-migration ROLLBACK
```

The fixed domain order is:

```text
reader-session → marks-activity → passage-preview → annotation → vocabulary-srs → workflow
```

For `apply`, the tool materializes a JSON-only source snapshot and writes a
small `production-migration-run.json` manifest in the run root. It then stops
at each domain freeze until the already-open browser page supplies live guard
evidence. The final backup, import, verify, Host checkpoint, and smoke check
are executed one domain at a time; a failure stops later domains. Final backup
and rollback metadata remain in the explicit target migration-state file.

The browser evidence must come from the current page, not from a copied marker
or a CLI callback. After the Host freeze marker is visible, use the guard seam
exposed by the current page:

```js
await window.__windowsOwnerDomainCutover.collectFreezeEvidence({
  domain: 'reader-session',
  challenge: manifest.freezeChallenge,
  sourceFingerprint: manifest.sourceFingerprint.browserPhysical,
  browserOrigin: location.origin,
})
```

Save the returned object, or an `{ entries: [...] }` collection of objects, to
the explicit `--browser-freeze-evidence` path inside the run root. The CLI also
re-fingerprints the live browser/workflow source and checks Host health before
allowing the final backup. A page without the current
`windows-owner-domain-cutover` guard is rejected; the old daily 5174 page is
not silently treated as frozen. Do not hand-author evidence JSON.

`resume` reuses the staged manifest and stable idempotency keys. It skips only
domains whose checkpoint and smoke state are already authoritative. `rollback`
takes one explicit registered domain, restores the retained pre-import Host
snapshot when possible, and records the rollback result.

The fixture contract is `npm run verify:windows-owner-production-entry`; the
existing `verify:windows-durable-state-migration` and `verify:windows-owner-c2`
checks cover retry/reopen, failure stop/rollback, Host reopen, and media
no-copy behavior. This change does not run the entry against daily data or
modify credentials, profiles, shortcuts, ports, or the six personal files.
