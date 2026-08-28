import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createReadWebProductionBackupComposition,
  writeIsolatedBrowserProfile,
} from './lib/read-web-production-backup.mjs'

async function createFixture(profile) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-windows-owner-profile-'))
  const paths = {
    root,
    profile: path.join(root, 'profile'),
    state: path.join(root, 'python-state'),
    output: path.join(root, 'python-output'),
  }
  await Promise.all(Object.values(paths).slice(1).map((directory) => mkdir(directory, { recursive: true })))
  if (profile !== undefined) await writeIsolatedBrowserProfile(paths.profile, profile)
  return paths
}

async function readEvidence(profile) {
  const fixture = await createFixture(profile)
  try {
    const composition = await createReadWebProductionBackupComposition({
      isolationRoot: fixture.root,
      profileDir: fixture.profile,
      pythonStateDir: fixture.state,
      pythonOutputDir: fixture.output,
    })
    return composition.ownerProfileEvidence
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
}

const complete = await readEvidence({
  localStorage: {
    'AnnotationGenerationStorage::fixture': JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      payload: { fixture: true },
    }),
  },
  indexedDbRows: [{
    id: 'audioMeta',
    schemaVersion: 1,
    revision: 1,
    content: { contentId: 'owner-profile-fixture' },
  }],
})
assert.equal(complete.ready, true, 'complete explicit profile/provider evidence must be ready')
assert.equal(complete.inventory.present, true)
assert.equal(complete.collection.status, 'verified')
assert.equal(complete.inventory.indexedDbRowCount, 1)
assert.equal(complete.rows.some((row) => row.key === 'audioMeta' && row.source === 'browser-profile.indexedDbRows'), true)
assert.equal(complete.rows.some((row) => row.key === 'AnnotationGenerationStorage::fixture'), true)
assert.deepEqual(
  complete.bindings.backupAdapterRegistry.requiredDomains,
  ['reader-session', 'vocabulary-srs', 'passage-preview', 'annotation', 'marks-activity', 'workflow'],
)
assert.equal(complete.bindings.transaction.bound, true)
assert.equal(complete.bindings.revision.bound, true)
assert.equal(complete.bindings.recovery.bound, true)
assert.equal(complete.bindings.applicationLease.bound, true)
assert.equal(complete.profileLease.status, 'held')
assert.equal(complete.ownerMode.status, 'pre-cutover')

const missingInventory = await readEvidence()
assert.equal(missingInventory.inventory.present, false, 'missing browser inventory must not become an empty ready profile')
assert.equal(missingInventory.ready, false)

const unknownRow = await readEvidence({
  localStorage: {},
  indexedDbRows: [{ id: 'not-claimed', schemaVersion: 1, content: {} }],
})
assert.equal(unknownRow.ready, false)
assert.equal(unknownRow.collection.status, 'failed')
assert.equal(unknownRow.collection.errorCode, 'BACKUP_UNCLAIMED_PERSISTENCE_ROW')

const unsupportedRow = await readEvidence({
  localStorage: {},
  indexedDbRows: [{ id: 'audioMeta', schemaVersion: 99, content: {} }],
})
assert.equal(unsupportedRow.ready, false)
assert.equal(unsupportedRow.collection.status, 'failed')
assert.equal(unsupportedRow.collection.errorCode, 'OWNER_PROFILE_UNSUPPORTED_SCHEMA')

const unknownLocalStorage = await readEvidence({
  localStorage: {
    'vocabulary.passage-preview.future.v9': JSON.stringify({ schemaVersion: 'future.v9' }),
  },
  indexedDbRows: [],
})
assert.equal(unknownLocalStorage.ready, false)
assert.equal(unknownLocalStorage.collection.status, 'failed')
assert.equal(unknownLocalStorage.collection.errorCode, 'BACKUP_UNCLAIMED_LOCAL_STORAGE_KEY')

console.log('windows local owner profile provider passed (real isolated composition, missing inventory, unclaimed row/key, unsupported schema)')
