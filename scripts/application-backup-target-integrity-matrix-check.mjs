import assert from 'node:assert/strict'
import { readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import * as productionBackup from './lib/read-web-production-backup.mjs'

const root = await (await import('node:fs/promises')).mkdtemp(path.join(os.tmpdir(), 'read-web-target-integrity-'))

try {
  const { applicationBackup } = await productionBackup.loadBackupModules()
  const requiredDomains = applicationBackup.APPLICATION_BACKUP_REQUIRED_DOMAINS
  const expectedTargetSurface = new Set([
    'isolated',
    'isolationCertificate',
    'isolationLayout',
    'restoreCapabilities',
    'faults',
    'adapters',
    'journal',
    'resolutions',
    'rollbackStore',
    'quarantine',
    'rollbackStoreSeparate',
    'capacityBytes',
    'estimateCapacity',
    'readJournal',
    'writeJournal',
    'beginTransaction',
    'restoreSnapshot',
    'verifyApplied',
    'mergeDomain',
    'recoverPendingRestore',
    'readState',
    'captureRestoreOperation',
    'setFaults',
    'isolationRoot',
    'profileDir',
    'statePath',
    'journalPath',
    'rollbackDir',
    'quarantineDir',
    'pythonStateDir',
    'pythonOutputDir',
  ])
  assert.deepEqual(
    applicationBackup.APPLICATION_BACKUP_TARGET_INTEGRITY_MEMBERS,
    [...expectedTargetSurface].sort(),
    'the exported target integrity contract must enumerate the complete target surface',
  )
  const source = await readFile(new URL('../src/services/persistence/application-backup.js', import.meta.url), 'utf8')
  const directTargetReads = [...source.matchAll(/\btarget(?:\?\.|\.)([A-Za-z_$][\w$]*)/g)]
    .map((match) => match[1])
  const unregisteredReads = [...new Set(directTargetReads)].filter((member) => !expectedTargetSurface.has(member))
  assert.deepEqual(unregisteredReads, [], 'every direct restore target read must belong to the integrity contract')
  const sourceAdapters = createSourceAdapters(requiredDomains)
  const service = applicationBackup.createApplicationBackupService({ adapters: sourceAdapters })
  const artifact = await service.createBackup()

  const results = []
  for (const mutation of createMutations(requiredDomains)) {
    const name = mutation.name
    const target = await productionBackup.createIsolatedProfileRestoreTarget({
      isolationRoot: root,
      profileDir: path.join(root, name),
      capacityBytes: mutation.capacityBytes ?? 1,
      rollbackStoreSeparate: mutation.rollbackStoreSeparate,
      enableMergeDomain: mutation.enableMergeDomain,
    })
    const calls = { value: 0 }
    target.setFaults({
      beforeBeginTransaction() {
        calls.value += 1
      },
    })
      const before = await snapshotTargetFiles(target)
      try {
        let mutationError = null
        try {
          mutation.apply(target, calls)
        } catch (error) {
          mutationError = error
        }
        if (mutationError) {
          if (!(mutationError instanceof TypeError)) results.push(`${name}: mutation setup failed: ${mutationError.message}`)
          const after = await snapshotTargetFiles(target)
          if (calls.value !== 0) results.push(`${name}: target method reached ${calls.value} time(s)`)
          if (JSON.stringify(after) !== JSON.stringify(before)) results.push(`${name}: target files changed during language-level mutation rejection`)
          continue
        }
        const restoreTarget = calls.proxy || target
        let error = null
        try {
          await service.restore(artifact, {
            target: restoreTarget,
          restoreId: `target-integrity-${name}`,
          resolutions: mutation.resolutions || {},
        })
      } catch (caught) {
        error = caught
      }
      const after = await snapshotTargetFiles(target)
      if (error?.code !== 'RESTORE_TARGET_UNSAFE') {
        results.push(`${name}: expected RESTORE_TARGET_UNSAFE, got ${error?.code || 'completed'}`)
      }
      if (calls.value !== 0) results.push(`${name}: target method reached ${calls.value} time(s)`)
      if (JSON.stringify(after) !== JSON.stringify(before)) results.push(`${name}: target files changed before the safety rejection`)
    } catch (error) {
      results.push(`${name}: mutation setup failed: ${error?.message || error}`)
    }
  }

  assert.deepEqual(results, [], 'registered target mutation matrix must fail closed before any target method or write')
  console.log(`application backup target integrity matrix passed (${createMutations(requiredDomains).length} mutations)`)
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
          id: `source-${key}`,
          schemaVersion: 1,
          revision: 1,
          contentId: `content-${key}`,
          payload: { value: `source-${key}` },
        }],
        references: [],
        mediaReferences: [],
      }
    },
  }]))
}

function mergeResolutions(requiredDomains) {
  return Object.fromEntries(requiredDomains.map((key) => [key, 'merge']))
}

function createMutations(requiredDomains) {
  const merge = mergeResolutions(requiredDomains)
  const maliciousMerge = (calls) => async () => {
    calls.value += 1
    throw new Error('MERGE_TARGET_REACHED')
  }
  return [
    {
      name: 'capacity-expanded',
      apply(target) { target.capacityBytes = Number.MAX_SAFE_INTEGER },
    },
    {
      name: 'capacity-deleted',
      apply(target) { delete target.capacityBytes },
    },
    {
      name: 'capacity-accessor',
      apply(target) {
        Object.defineProperty(target, 'capacityBytes', {
          configurable: true,
          enumerable: true,
          get() { return Number.MAX_SAFE_INTEGER },
        })
      },
    },
    {
      name: 'capacity-accessor-setter',
      apply(target) {
        Object.defineProperty(target, 'capacityBytes', {
          configurable: true,
          enumerable: true,
          get() { return Number.MAX_SAFE_INTEGER },
          set() {},
        })
      },
    },
    {
      name: 'capacity-null',
      apply(target) { target.capacityBytes = null },
    },
    {
      name: 'capacity-nan',
      apply(target) { target.capacityBytes = Number.NaN },
    },
    {
      name: 'capacity-infinity',
      apply(target) { target.capacityBytes = Number.POSITIVE_INFINITY },
    },
    {
      name: 'rollback-strategy-expanded',
      rollbackStoreSeparate: false,
      capacityBytes: Number.MAX_SAFE_INTEGER,
      apply(target) { target.rollbackStoreSeparate = true },
    },
    {
      name: 'rollback-strategy-accessor',
      rollbackStoreSeparate: false,
      capacityBytes: Number.MAX_SAFE_INTEGER,
      apply(target) {
        Object.defineProperty(target, 'rollbackStoreSeparate', {
          configurable: true,
          enumerable: true,
          get() { return true },
        })
      },
    },
    {
      name: 'top-level-addition',
      apply(target) { target.unregisteredSafetyMember = 'unsafe' },
    },
    {
      name: 'restore-capability-scalar',
      apply(target) { target.restoreCapabilities.atomicRevisionCommit = false },
    },
    {
      name: 'adapter-method',
      capacityBytes: Number.MAX_SAFE_INTEGER,
      apply(target, calls) {
        target.adapters['reader-session'].collect = async () => {
          calls.value += 1
          throw new Error('ADAPTER_TARGET_REACHED')
        }
      },
    },
    {
      name: 'adapter-scalar',
      capacityBytes: Number.MAX_SAFE_INTEGER,
      apply(target) { target.adapters['reader-session'].schemaVersion = 99 },
    },
    {
      name: 'adapter-metadata-array',
      capacityBytes: Number.MAX_SAFE_INTEGER,
      apply(target) { target.adapters['reader-session'].supportedSchemaVersions.push(99) },
    },
    {
      name: 'rollback-store-method',
      capacityBytes: Number.MAX_SAFE_INTEGER,
      apply(target, calls) {
        target.rollbackStore.write = async () => {
          calls.value += 1
          throw new Error('ROLLBACK_STORE_TARGET_REACHED')
        }
      },
    },
    {
      name: 'rollback-store-scalar',
      capacityBytes: Number.MAX_SAFE_INTEGER,
      apply(target) { target.rollbackStore.unregisteredMetadata = 'unsafe' },
    },
    {
      name: 'quarantine-store-method',
      capacityBytes: Number.MAX_SAFE_INTEGER,
      apply(target, calls) {
        target.quarantine.write = async () => {
          calls.value += 1
          throw new Error('QUARANTINE_TARGET_REACHED')
        }
      },
    },
    {
      name: 'merge-added',
      capacityBytes: Number.MAX_SAFE_INTEGER,
      resolutions: merge,
      apply(target, calls) { target.mergeDomain = maliciousMerge(calls) },
    },
    {
      name: 'merge-replaced',
      capacityBytes: Number.MAX_SAFE_INTEGER,
      enableMergeDomain: true,
      resolutions: merge,
      apply(target, calls) {
        target.mergeDomain = maliciousMerge(calls)
      },
    },
    {
      name: 'merge-deleted',
      capacityBytes: Number.MAX_SAFE_INTEGER,
      enableMergeDomain: true,
      resolutions: merge,
      apply(target) {
        delete target.mergeDomain
      },
    },
    {
      name: 'merge-accessor',
      capacityBytes: Number.MAX_SAFE_INTEGER,
      enableMergeDomain: true,
      resolutions: merge,
      apply(target, calls) {
        Object.defineProperty(target, 'mergeDomain', {
          configurable: true,
          enumerable: true,
          get: () => maliciousMerge(calls),
        })
      },
    },
    {
      name: 'merge-prototype',
      capacityBytes: Number.MAX_SAFE_INTEGER,
      resolutions: merge,
      apply(target, calls) {
        Object.setPrototypeOf(target, { mergeDomain: maliciousMerge(calls) })
      },
    },
    {
      name: 'proxy-target',
      capacityBytes: Number.MAX_SAFE_INTEGER,
      apply(target, calls) {
        calls.proxy = new Proxy(target, {
          get(value, key, receiver) {
            calls.value += 1
            return Reflect.get(value, key, receiver)
          },
        })
      },
    },
  ]
}

async function snapshotTargetFiles(target) {
  return {
    state: await readOptional(target.statePath),
    journal: await readOptional(target.journalPath),
    rollback: await listTree(target.rollbackDir),
    quarantine: await listTree(target.quarantineDir),
  }
}

async function readOptional(filePath) {
  try { return await readFile(filePath, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function listTree(directory) {
  const result = []
  async function visit(current, prefix = '') {
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = path.join(prefix, entry.name)
      if (entry.isDirectory()) await visit(path.join(current, entry.name), relative)
      else result.push({ path: relative, content: await readFile(path.join(current, entry.name), 'utf8') })
    }
  }
  await visit(directory)
  return result
}
