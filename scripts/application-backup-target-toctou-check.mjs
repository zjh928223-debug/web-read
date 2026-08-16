import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import * as productionBackup from './lib/read-web-production-backup.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-target-toctou-'))

try {
  const { applicationBackup } = await productionBackup.loadBackupModules()
  const requiredDomains = applicationBackup.APPLICATION_BACKUP_REQUIRED_DOMAINS
  const sourceAdapters = createSourceAdapters(requiredDomains)
  const service = applicationBackup.createApplicationBackupService({ adapters: sourceAdapters })
  const artifact = await service.createBackup()
  const target = await productionBackup.createIsolatedProfileRestoreTarget({
    isolationRoot: root,
    profileDir: path.join(root, 'microtask-target'),
  })
  const stateBefore = await readFile(target.statePath, 'utf8')
  const calls = { value: 0 }

  const restorePromise = service.restore(artifact, {
    target,
    restoreId: 'target-toctou-microtask',
  })

  target.capacityBytes = Number.MAX_SAFE_INTEGER
  target.beginTransaction = async () => {
    calls.value += 1
    throw new Error('mutated beginTransaction must not be reached')
  }
  target.verifyApplied = async () => {
    calls.value += 1
    throw new Error('mutated verifyApplied must not be reached')
  }
  target.restoreSnapshot = async () => {
    calls.value += 1
    throw new Error('mutated restoreSnapshot must not be reached')
  }
  target.mergeDomain = async () => {
    calls.value += 1
    throw new Error('mutated mergeDomain must not be reached')
  }

  let result
  try {
    result = await restorePromise
  } catch (error) {
    throw new Error(`TOCTOU RED: ${error?.code || error?.message}; mutatedCalls=${calls.value}`)
  }
  assert.equal(result.status, 'completed', 'a post-check target mutation must not redirect the restore')
  assert.equal(calls.value, 0, 'mutated target methods must not be reached')
  assert.notEqual(await readFile(target.statePath, 'utf8'), stateBefore, 'the bound target capability must still commit')

  console.log('application backup target TOCTOU microtask check passed')
} finally {
  await rm(root, { recursive: true, force: true })
}

function createSourceAdapters(requiredDomains) {
  return Object.fromEntries(requiredDomains.map((key) => [key, {
    key,
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      return {
        schemaVersion: 1,
        adapterVersion: 1,
        revision: 1,
        records: [{
          id: `${key}:source-record`,
          schemaVersion: 1,
          revision: 1,
          contentId: `${key}:content`,
          payload: { value: 'source' },
          references: [],
          mediaReferences: [],
        }],
        references: [],
        mediaReferences: [],
      }
    },
  }]))
}
