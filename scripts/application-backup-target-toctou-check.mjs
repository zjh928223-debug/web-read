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
    enableMergeDomain: true,
  })
  const stateBefore = await readFile(target.statePath, 'utf8')
  const calls = { value: 0 }

  const restorePromise = service.restore(artifact, {
    target,
    restoreId: 'target-toctou-microtask',
    resolutions: Object.fromEntries(requiredDomains.map((key) => [key, 'merge'])),
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

  {
    const postStartTarget = await productionBackup.createIsolatedProfileRestoreTarget({
      isolationRoot: root,
      profileDir: path.join(root, 'fault-plan-post-start'),
      enableMergeDomain: true,
    })
    const reached = { value: 0 }
    const postStartPromise = service.restore(artifact, {
      target: postStartTarget,
      restoreId: 'fault-plan-post-start',
      resolutions: Object.fromEntries(requiredDomains.map((key) => [key, 'merge'])),
    })
    postStartTarget.setFaults({
      beforeBeginTransaction: async () => { reached.value += 1 },
    })
    const postStartResult = await postStartPromise
    assert.equal(postStartResult.status, 'completed', 'post-start fault-plan replacement must not fail the in-flight restore')
    assert.equal(reached.value, 0, 'post-start setFaults must only affect the next operation')
  }

  {
    const events = []
    const planTarget = await productionBackup.createIsolatedProfileRestoreTarget({
      isolationRoot: root,
      profileDir: path.join(root, 'fault-plan-entry-snapshot'),
      enableMergeDomain: true,
      faults: {
        beforeBeginTransaction: async () => events.push('A'),
      },
    })
    const planOptions = {
      target: planTarget,
      restoreId: 'fault-plan-entry-a',
      resolutions: Object.fromEntries(requiredDomains.map((key) => [key, 'merge'])),
    }
    const planPromise = service.restore(artifact, planOptions)
    planTarget.setFaults({ beforeBeginTransaction: async () => events.push('B') })
    const planResult = await planPromise
    assert.equal(planResult.status, 'completed', 'the entry fault plan must complete normally')
    assert.deepEqual(events, ['A'], 'an in-flight operation must retain plan A after setFaults installs plan B')

    const nextResult = await service.restore(artifact, {
      target: planTarget,
      restoreId: 'fault-plan-entry-b',
      resolutions: Object.fromEntries(requiredDomains.map((key) => [key, 'merge'])),
    })
    assert.equal(nextResult.status, 'completed', 'the next operation must remain usable')
    assert.deepEqual(events, ['A', 'B'], 'the next operation must observe the newly installed plan B')
  }

  {
    const resolutionsTarget = await productionBackup.createIsolatedProfileRestoreTarget({
      isolationRoot: root,
      profileDir: path.join(root, 'resolutions-entry-snapshot'),
      enableMergeDomain: true,
    })
    const originalResolutions = Object.fromEntries(requiredDomains.map((key) => [key, { decision: 'merge' }]))
    const resolutionsOptions = {
      target: resolutionsTarget,
      restoreId: 'resolutions-entry-snapshot',
      resolutions: originalResolutions,
    }
    const resolutionsPromise = service.restore(artifact, resolutionsOptions)
    resolutionsOptions.resolutions = Object.fromEntries(requiredDomains.map((key) => [key, { decision: 'keep' }]))
    for (const key of requiredDomains) originalResolutions[key].decision = 'keep'
    const resolutionsResult = await resolutionsPromise
    assert.equal(resolutionsResult.status, 'completed', 'restore must use invocation-time resolutions')
    assert.equal(JSON.parse(await readFile(resolutionsTarget.statePath, 'utf8')).revision, 1, 'the invocation snapshot must commit the merge decision')
  }

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
