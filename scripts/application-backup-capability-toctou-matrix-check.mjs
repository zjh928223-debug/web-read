import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const TEST_ISOLATION_ISSUER_TOKEN = 'application-backup-capability-toctou-issuer'
const source = (await readFile(new URL('../src/services/persistence/application-backup.js', import.meta.url), 'utf8')).replace(
  'const ISOLATION_ISSUER_TOKEN = null',
  `const ISOLATION_ISSUER_TOKEN = ${JSON.stringify(TEST_ISOLATION_ISSUER_TOKEN)}`,
)
const {
  APPLICATION_BACKUP_REQUIRED_DOMAINS,
  createApplicationBackupIsolationCertificate,
  createApplicationBackupService,
  registerApplicationBackupIsolationTarget,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-capability-toctou-'))
const observedCollectorReceivers = []

try {
  const sourceAdapters = createAdapters('source')
  const sourceService = createApplicationBackupService({ adapters: sourceAdapters })
  const artifact = await sourceService.createBackup()
  const resolutions = Object.fromEntries(APPLICATION_BACKUP_REQUIRED_DOMAINS.map((key) => [key, 'merge']))

  for (const phase of ['journal-read', 'dry-run', 'capacity', 'rollback-backup']) {
    const barrier = createBarrier()
    const target = createTarget(path.join(root, phase), { barrierPhase: phase, barrier })
    const service = createApplicationBackupService({ adapters: sourceAdapters })
    const calls = { value: 0 }
    const restorePromise = service.restore(artifact, {
      target,
      restoreId: `barrier-${phase}`,
      resolutions,
    })
    await barrier.hit
    mutateTarget(target, calls)
    barrier.release()
    const result = await restorePromise
    assert.equal(result.status, 'completed', `${phase} barrier must retain the bound operation`)
    assert.equal(calls.value, 0, `${phase} target mutations must not reach an evil surface`)
    assert.equal(target.state.revision, 1, `${phase} barrier must commit exactly once`)
  }

  {
    const target = createTarget(path.join(root, 'fault-hook'))
    const service = createApplicationBackupService({ adapters: sourceAdapters })
    const calls = { value: 0 }
    target.setFaults({
      beforeBeginTransaction: async () => mutateTarget(target, calls),
    })
    const result = await service.restore(artifact, {
      target,
      restoreId: 'fault-hook-surface-mutation',
      resolutions,
    })
    assert.equal(result.status, 'completed', 'fault-hook mutation must not redirect the operation')
    assert.equal(calls.value, 0, 'fault-hook mutation must not reach an evil surface')
    assert.equal(target.state.revision, 1, 'fault-hook mutation must commit exactly once')
  }

  {
    const barrier = createBarrier()
    const events = []
    const target = createTarget(path.join(root, 'fault-plan-barrier'), {
      barrierPhase: 'dry-run',
      barrier,
      initialFaults: {
        beforeBeginTransaction: async () => events.push('A'),
      },
    })
    const service = createApplicationBackupService({ adapters: sourceAdapters })
    const restorePromise = service.restore(artifact, {
      target,
      restoreId: 'fault-plan-barrier',
      resolutions,
    })
    await barrier.hit
    target.setFaults({ beforeBeginTransaction: async () => events.push('B') })
    barrier.release()
    const result = await restorePromise
    assert.equal(result.status, 'completed', 'post-dry-run fault-plan replacement must not fail the in-flight restore')
    assert.deepEqual(events, ['A'], 'a barrier-time fault-plan replacement must not affect the active operation')
  }

  {
    const target = createTarget(path.join(root, 'nested-mutation'))
    const service = createApplicationBackupService({ adapters: sourceAdapters })
    const calls = { value: 0 }
    const barrier = createBarrier()
    target.setFaults({
      beforeBeginTransaction: async () => {
        target.adapters[APPLICATION_BACKUP_REQUIRED_DOMAINS[0]].schemaVersion = 999
        target.adapters[APPLICATION_BACKUP_REQUIRED_DOMAINS[0]].collect = evil(calls)
        target.rollbackStore.write = evil(calls)
        target.rollbackStore.metadata = 'changed-after-bind'
        await barrier.pause()
      },
    })
    const restorePromise = service.restore(artifact, {
      target,
      restoreId: 'nested-surface-mutation',
      resolutions,
    })
    await barrier.hit
    barrier.release()
    const result = await restorePromise
    assert.equal(result.status, 'completed', 'nested mutation must not redirect the operation')
    assert.equal(calls.value, 0, 'nested method mutation must not be reached')
  }

  {
    const barrier = createBarrier()
    const target = createTarget(path.join(root, 'nested-dynamic-mutation'), { barrierPhase: 'dry-run', barrier })
    const service = createApplicationBackupService({ adapters: sourceAdapters })
    const calls = { value: 0 }
    const restorePromise = service.restore(artifact, {
      target,
      restoreId: 'nested-dynamic-surface-mutation',
      resolutions,
    })
    await barrier.hit
    Object.defineProperty(target.adapters[APPLICATION_BACKUP_REQUIRED_DOMAINS[0]], 'failed', {
      configurable: true,
      enumerable: true,
      get() {
        calls.value += 1
        return false
      },
    })
    barrier.release()
    const result = await restorePromise
    assert.equal(result.status, 'completed', 'dynamic adapter state mutation must not redirect the operation')
    assert.equal(calls.value, 0, 'dynamic adapter state mutation must not reach an evil accessor')
    assert.ok(observedCollectorReceivers.length > 0)
    assert.notEqual(observedCollectorReceivers.at(-1), target.adapters[APPLICATION_BACKUP_REQUIRED_DOMAINS[0]])
  }

  {
    const calls = { value: 0 }
    const target = createTarget(path.join(root, 'transaction-mutation'), { mutateTransactionOnApply: true, evilCalls: calls })
    const service = createApplicationBackupService({ adapters: sourceAdapters })
    const result = await service.restore(artifact, {
      target,
      restoreId: 'transaction-surface-mutation',
      resolutions,
    })
    assert.equal(result.status, 'completed', 'transaction methods changed after binding must not redirect the operation')
    assert.equal(calls.value, 0, 'transaction replacement methods must not be reached')
    assert.equal(target.state.revision, 1, 'transaction mutation must commit exactly once')
  }

  {
    const target = createTarget(path.join(root, 'transaction-exposed-evidence'), { commitReturnsUndefined: true })
    const service = createApplicationBackupService({ adapters: sourceAdapters })
    const result = await service.restore(artifact, {
      target,
      restoreId: 'transaction-exposed-evidence',
      resolutions,
    })
    assert.equal(result.status, 'completed', 'captured committedRevision getter must satisfy an empty commit return')
    assert.equal(target.state.revision, 1, 'exposed transaction evidence must commit exactly once')
    assert.equal(result.journal.committedRevision, 1, 'journal must record the captured transaction evidence')
  }

  {
    const calls = { value: 0 }
    const target = createTarget(path.join(root, 'transaction-evidence-mutation'), {
      commitReturnsUndefined: true,
      mutateEvidenceOnApply: true,
      evilCalls: calls,
    })
    const service = createApplicationBackupService({ adapters: sourceAdapters })
    const result = await service.restore(artifact, {
      target,
      restoreId: 'transaction-evidence-mutation',
      resolutions,
    })
    assert.equal(result.status, 'completed', 'transaction evidence replacement after bind must not redirect the captured reader')
    assert.equal(calls.value, 0, 'replacement transaction evidence accessor must not be reached')
  }

  {
    const target = createTarget(path.join(root, 'transaction-partial-commit'), { partialCommit: true })
    const baseline = structuredClone(target.state.domains)
    const service = createApplicationBackupService({ adapters: sourceAdapters })
    await assert.rejects(
      service.restore(artifact, {
        target,
        restoreId: 'transaction-partial-commit',
        resolutions,
      }),
      (error) => error?.code === 'RESTORE_COMMIT_FAILED',
    )
    assert.deepEqual(target.state.domains, baseline, 'captured evidence must trigger snapshot rollback after a write-then-throw commit')
    assert.equal(target.state.revision, 2, 'snapshot rollback must use the committed expected revision')
  }

  for (const [label, invalidRevision] of [['negative', -1], ['nan', Number.NaN], ['string', '1']]) {
    const target = createTarget(path.join(root, `transaction-invalid-evidence-${label}`), { invalidCommitRevision: invalidRevision })
    const service = createApplicationBackupService({ adapters: sourceAdapters })
    await assert.rejects(
      service.restore(artifact, {
        target,
        restoreId: `transaction-invalid-evidence-${label}`,
        resolutions,
      }),
      (error) => error?.code === 'RESTORE_COMMIT_EVIDENCE_UNAVAILABLE',
    )
  }

  console.log('application backup capability TOCTOU matrix passed (journal/dry-run/capacity/rollback/fault-plan/nested/resolutions/transaction-evidence)')
} finally {
  await rm(root, { recursive: true, force: true })
}

function createBarrier() {
  let hitResolve
  let releaseResolve
  const hit = new Promise((resolve) => { hitResolve = resolve })
  const release = new Promise((resolve) => { releaseResolve = resolve })
  let signalled = false
  return {
    hit,
    release: () => releaseResolve(),
    async pause() {
      if (!signalled) {
        signalled = true
        hitResolve()
      }
      await release
    },
  }
}

function createAdapters(kind) {
  return Object.fromEntries(APPLICATION_BACKUP_REQUIRED_DOMAINS.map((key) => [key, {
    key,
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    revision: kind === 'source' ? 1 : 0,
    failed: false,
    records: kind === 'source'
      ? [{
          id: `${key}:source-record`,
          schemaVersion: 1,
          revision: 1,
          contentId: `${key}:content`,
          payload: { value: 'source' },
          references: [],
          mediaReferences: [],
        }]
      : [],
    async collect() {
      if (this.failed === 'mutated') throw new Error('mutated adapter state must not be read')
      return {
        schemaVersion: this.schemaVersion,
        revision: this.revision,
        records: structuredClone(this.records),
        references: [],
        mediaReferences: [],
      }
    },
  }]))
}

function createTarget(targetPath, {
  barrierPhase = null,
  barrier = null,
  mutateTransactionOnApply = false,
  evilCalls = null,
  initialFaults = {},
  commitReturnsUndefined = false,
  partialCommit = false,
  invalidCommitRevision,
  mutateEvidenceOnApply = false,
} = {}) {
  const isolationLayout = Object.freeze({
    isolationRoot: path.dirname(targetPath),
    paths: Object.freeze({ target: targetPath }),
  })
  const state = {
    revision: 0,
    domains: Object.fromEntries(APPLICATION_BACKUP_REQUIRED_DOMAINS.map((key) => [key, {
      schemaVersion: 1,
      adapterVersion: 1,
      revision: 0,
      records: [],
      references: [],
      mediaReferences: [],
    }])),
    journal: new Map(),
    rollback: null,
    writes: 0,
  }
  const adapters = createAdapters('target')
  const faultState = { ...initialFaults }
  const operationStates = new WeakMap()
  const target = {
    isolated: true,
    isolationCertificate: createApplicationBackupIsolationCertificate({
      ...isolationLayout,
      issuerToken: TEST_ISOLATION_ISSUER_TOKEN,
    }),
    isolationRoot: isolationLayout.isolationRoot,
    isolationLayout,
    profileDir: targetPath,
    statePath: path.join(targetPath, 'state.json'),
    restoreCapabilities: {
      atomicRevisionCommit: true,
      commitRevisionEvidence: true,
      verifyAppliedRevision: true,
    },
    captureRestoreOperation() {
      const operation = {}
      operationStates.set(operation, {
        faults: { ...faultState },
        failed: false,
      })
      return operation
    },
    adapters,
    rollbackStoreSeparate: true,
    journal: { marker: 'journal' },
    rollbackStore: {
      async write(entry) {
        if (barrierPhase === 'rollback-backup') await barrier.pause()
        state.rollback = { ...entry, rawState: { revision: state.revision } }
        state.writes += 1
        return structuredClone(state.rollback)
      },
      async read() {
        return state.rollback ? structuredClone(state.rollback) : null
      },
    },
    quarantine: {
      entries: [],
      async write(entry) { this.entries.push(structuredClone(entry)) },
    },
    async estimateCapacity({ requiredBytes }) {
      if (barrierPhase === 'capacity') await barrier.pause()
      return { ok: 256 * 1024 * 1024 >= requiredBytes, availableBytes: 256 * 1024 * 1024 }
    },
    async readJournal({ restoreId }) {
      if (barrierPhase === 'journal-read') await barrier.pause()
      return state.journal.get(restoreId) ? structuredClone(state.journal.get(restoreId)) : null
    },
    async writeJournal(entry) {
      state.journal.set(entry.restoreId, structuredClone(entry))
    },
    async beginTransaction({ restoreId, expectedBaseRevision, operation }) {
      const operationState = operationStates.get(operation) || { faults: faultState, failed: false }
      const activeFaults = operationState.faults
      if (typeof activeFaults.beforeBeginTransaction === 'function') {
        await activeFaults.beforeBeginTransaction({ restoreId, expectedBaseRevision })
      }
      if (expectedBaseRevision !== state.revision) {
        throw Object.assign(new Error('stale restore base revision'), { code: 'RESTORE_REVISION_CONFLICT' })
      }
      const staged = new Map()
      let committedRevision = null
      const transaction = {
        async applyDomain(key, domain) {
          if (mutateTransactionOnApply) {
            transaction.applyDomain = evil(evilCalls || { value: 0 })
            transaction.commit = evil(evilCalls || { value: 0 })
            transaction.rollback = evil(evilCalls || { value: 0 })
          }
          staged.set(key, structuredClone(domain))
          if (mutateEvidenceOnApply) {
            Object.defineProperty(transaction, 'committedRevision', {
              configurable: true,
              enumerable: true,
              get() {
                if (evilCalls) evilCalls.value += 1
                return -1
              },
            })
          }
        },
        async commit() {
          for (const [key, domain] of staged) {
            state.domains[key] = structuredClone(domain)
            adapters[key].records = structuredClone(domain.records)
            adapters[key].revision = domain.revision
          }
          state.revision += 1
          committedRevision = state.revision
          if (partialCommit) throw Object.assign(new Error('commit wrote state and then failed'), { code: 'RESTORE_COMMIT_FAILED' })
          if (invalidCommitRevision !== undefined) return { revision: invalidCommitRevision }
          return commitReturnsUndefined ? undefined : { revision: state.revision }
        },
        async rollback() { staged.clear() },
        get committedRevision() { return committedRevision },
      }
      return transaction
    },
    async restoreSnapshot(artifact, context = {}) {
      if (Number.isInteger(context.expectedRevision) && context.expectedRevision !== state.revision) {
        throw Object.assign(new Error('stale rollback revision'), { code: 'RESTORE_REVISION_CONFLICT' })
      }
      for (const key of APPLICATION_BACKUP_REQUIRED_DOMAINS) state.domains[key] = structuredClone(artifact.domains[key])
      state.revision += 1
      return { revision: state.revision }
    },
    async verifyApplied({ artifact }) {
      const ok = APPLICATION_BACKUP_REQUIRED_DOMAINS.every((key) => (
        JSON.stringify(state.domains[key]) === JSON.stringify(artifact.domains[key])
      ))
      return { ok, revision: state.revision }
    },
    async mergeDomain(transaction, key, domain, context = {}) {
      return transaction.applyDomain(key, domain, { decision: 'merge', restoreId: context.restoreId })
    },
    setFaults(nextFaults = {}) {
      Object.keys(faultState).forEach((key) => { delete faultState[key] })
      Object.assign(faultState, nextFaults)
    },
    state,
  }
  for (const adapter of Object.values(adapters)) {
    const originalCollect = adapter.collect
    adapter.collect = async function collectWithBarrier(...args) {
      if (barrierPhase === 'dry-run') await barrier.pause()
      observedCollectorReceivers.push(this)
      return originalCollect.apply(this, args)
    }
  }
  assert.equal(registerApplicationBackupIsolationTarget({
    target,
    isolationCertificate: target.isolationCertificate,
    isolationLayout,
    issuerToken: TEST_ISOLATION_ISSUER_TOKEN,
  }), true)
  return target
}

function mutateTarget(target, calls) {
  target.capacityBytes = Number.MAX_SAFE_INTEGER
  target.profileDir = 'E:\\read-web'
  target.isolationRoot = 'E:\\read-web'
  target.beginTransaction = evil(calls)
  target.restoreSnapshot = evil(calls)
  target.verifyApplied = evil(calls)
  target.mergeDomain = evil(calls)
  target.estimateCapacity = evil(calls)
  target.readJournal = evil(calls)
  target.writeJournal = evil(calls)
  target.adapters = Object.fromEntries(APPLICATION_BACKUP_REQUIRED_DOMAINS.map((key) => [key, { collect: evil(calls) }]))
  target.rollbackStore = { read: evil(calls), write: evil(calls) }
  target.quarantine = { write: evil(calls) }
}

function evil(calls) {
  return async () => {
    calls.value += 1
    throw new Error('mutated capability must not be reached')
  }
}
