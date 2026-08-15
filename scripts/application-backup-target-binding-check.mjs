import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import * as productionBackup from './lib/read-web-production-backup.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-target-binding-'))

try {
  const { applicationBackup } = await productionBackup.loadBackupModules()
  const requiredDomains = applicationBackup.APPLICATION_BACKUP_REQUIRED_DOMAINS
  const adapters = Object.fromEntries(requiredDomains.map((key) => [key, {
    key,
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      return { schemaVersion: 1, adapterVersion: 1, revision: 0, records: [], references: [], mediaReferences: [] }
    },
  }]))
  const service = applicationBackup.createApplicationBackupService({ adapters })
  const artifact = await service.createBackup()

  const validTarget = await createTarget('valid')
  const validResult = await service.restore(artifact, { target: validTarget, restoreId: 'target-binding-valid' })
  assert.equal(validResult.status, 'completed', 'a target created by the production factory must remain usable')

  await assertUnsafeTarget('borrowed-certificate', async (calls) => {
    const source = await createTarget('borrowed')
    const borrowed = {
      ...source,
      profileDir: 'E:\\read-web',
      adapters: instrumentAdapters(source.adapters, calls),
    }
    instrumentTargetSurface(borrowed, calls)
    return borrowed
  })

  await assertUnsafeTarget('spread-clone', async (calls) => {
    const source = await createTarget('spread')
    const clone = { ...source, adapters: instrumentAdapters(source.adapters, calls) }
    instrumentTargetSurface(clone, calls)
    clone.profileDir = 'E:\\read-web'
    return clone
  })

  await assertUnsafeTarget('method-mutation', async (calls) => {
    const target = await createTarget('method-mutation')
    instrumentTargetSurface(target, calls)
    target.beginTransaction = async () => {
      calls.value += 1
      throw new Error('mutated beginTransaction must not be reached')
    }
    return target
  })

  await assertUnsafeTarget('path-mutation', async (calls) => {
    const target = await createTarget('path-mutation')
    instrumentTargetSurface(target, calls)
    target.profileDir = 'E:\\read-web'
    return target
  })

  await assertUnsafeTarget('adapter-mutation', async (calls) => {
    const target = await createTarget('adapter-mutation')
    instrumentTargetSurface(target, calls)
    target.adapters = instrumentAdapters(target.adapters, calls)
    return target
  })

  console.log('application backup target binding checks passed')
} finally {
  await rm(root, { recursive: true, force: true })
}

async function createTarget(name) {
  return productionBackup.createIsolatedProfileRestoreTarget({
    isolationRoot: root,
    profileDir: path.join(root, name),
  })
}

async function assertUnsafeTarget(name, createMutatedTarget) {
  const calls = { value: 0 }
  const target = await createMutatedTarget(calls)
  const stateBefore = await readFile(target.statePath, 'utf8')
  await assert.rejects(
    serviceRestore(target, name),
    (error) => error?.code === 'RESTORE_TARGET_UNSAFE',
    `${name} must be rejected by the generic restore gate`,
  )
  assert.equal(calls.value, 0, `${name} must not reach target methods or adapters`)
  assert.equal(await readFile(target.statePath, 'utf8'), stateBefore, `${name} must not write target state`)
}

async function serviceRestore(target, name) {
  const { applicationBackup } = await productionBackup.loadBackupModules()
  const requiredDomains = applicationBackup.APPLICATION_BACKUP_REQUIRED_DOMAINS
  const adapters = Object.fromEntries(requiredDomains.map((key) => [key, {
    key,
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      return { schemaVersion: 1, adapterVersion: 1, revision: 0, records: [], references: [], mediaReferences: [] }
    },
  }]))
  const service = applicationBackup.createApplicationBackupService({ adapters })
  const artifact = await service.createBackup()
  return service.restore(artifact, { target, restoreId: `target-binding-${name}` })
}

function instrumentTargetSurface(target, calls) {
  for (const name of ['estimateCapacity', 'readJournal', 'writeJournal', 'beginTransaction', 'restoreSnapshot', 'verifyApplied']) {
    if (typeof target[name] !== 'function') continue
    const original = target[name]
    target[name] = async (...args) => {
      calls.value += 1
      return original(...args)
    }
  }
  for (const name of ['rollbackStore', 'quarantine']) {
    const store = target[name]
    if (!store || typeof store.write !== 'function') continue
    target[name] = {
      ...store,
      async write(...args) {
        calls.value += 1
        return store.write(...args)
      },
    }
  }
}

function instrumentAdapters(adapters, calls) {
  return Object.fromEntries(Object.entries(adapters).map(([key, adapter]) => [key, {
    ...adapter,
    async collect(...args) {
      calls.value += 1
      return adapter.collect(...args)
    },
    ...(typeof adapter.restoreRecords === 'function' ? {
      async restoreRecords(...args) {
        calls.value += 1
        return adapter.restoreRecords(...args)
      },
    } : {}),
  }]))
}
