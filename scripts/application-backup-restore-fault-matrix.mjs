import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createIsolatedProfileRestoreTarget,
  createReadWebProductionBackupComposition,
} from './lib/read-web-production-backup.mjs'

const REQUIRED_DOMAINS = [
  'reader-session',
  'marks-activity',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'workflow',
]

const release = {
  applicationVersion: 'real-restore-fault-matrix',
  backendVersion: 'real-restore-fault-matrix',
  gitSha: 'real-restore-fault-matrix',
  releaseId: 'real-restore-fault-matrix',
  manifestSha: null,
}
const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-real-restore-faults-'))
const source = await createFixture(root, 'source', true)
const sourceComposition = await createReadWebProductionBackupComposition({ ...source, release })
const artifact = await sourceComposition.createBackup({ now: () => 1760000000000 })

try {
  await rollbackBackupFailureIsZeroWrite(sourceComposition, artifact)
  await abortAtEveryDomainIsAtomic(sourceComposition, artifact)
  await writeFailureIsReported(sourceComposition, artifact)
  await quotaFailureIsAtomic(sourceComposition, artifact)
  await revisionConflictIsFailClosed(sourceComposition, artifact)
  await checksumAndSchemaCorruptionIsQuarantined(sourceComposition, artifact)
  await pageCloseAbortIsRetryable(sourceComposition, artifact)
  await processClosePendingCheckpointIsRecoverable(sourceComposition, artifact)
  await pendingRecoveryPreservesConcurrentWrites(sourceComposition, artifact)
  await rollbackFailureIsReported(sourceComposition, artifact)
  console.log('real application restore fault matrix passed')
} finally {
  await rm(root, { recursive: true, force: true })
}

async function rollbackBackupFailureIsZeroWrite(sourceComposition, artifact) {
  const target = await createTarget(root, 'rollback-backup-failure', {
    rollbackStore: {
      async read() { return null },
      async write() {
        const error = new Error('fault injected while writing rollback backup')
        error.code = 'RESTORE_ROLLBACK_UNAVAILABLE'
        throw error
      },
    },
  })
  const before = await collectApplicationDomains(target.restoreTarget)
  await assert.rejects(
    sourceComposition.service.restore(artifact, { target: target.restoreTarget, restoreId: 'fault-rollback-backup' }),
    (error) => error?.code === 'RESTORE_ROLLBACK_UNAVAILABLE',
  )
  assert.deepEqual(await collectApplicationDomains(target.restoreTarget), before)
}

async function abortAtEveryDomainIsAtomic(sourceComposition, artifact) {
  for (const abortAfterDomain of [1, 2, 3, 4, 5, 6]) {
    const target = await createTarget(root, `abort-${abortAfterDomain}`, {
      faults: { interruptAfterDomain: abortAfterDomain },
    })
    const before = await collectApplicationDomains(target.restoreTarget)
    await assert.rejects(
      sourceComposition.service.restore(artifact, {
        target: target.restoreTarget,
        restoreId: `fault-abort-${abortAfterDomain}`,
      }),
      (error) => error?.code === 'RESTORE_INTERRUPTED',
    )
    assert.deepEqual(await collectApplicationDomains(target.restoreTarget), before)
    target.restoreTarget.setFaults({})
    assert.equal((await sourceComposition.service.restore(artifact, {
      target: target.restoreTarget,
      restoreId: `fault-abort-${abortAfterDomain}`,
    })).status, 'completed')
  }
}

async function writeFailureIsReported(sourceComposition, artifact) {
  const target = await createTarget(root, 'write-failure', {
    faults: { commit: 'write-then-fail' },
  })
  const before = await collectApplicationDomains(target.restoreTarget)
  const beforeRevision = (await target.restoreTarget.readState()).revision
  await assert.rejects(
    sourceComposition.service.restore(artifact, { target: target.restoreTarget, restoreId: 'fault-disk-full' }),
    (error) => error?.code === 'RESTORE_COMMIT_FAILED',
  )
  const after = await collectApplicationDomains(target.restoreTarget)
  assert.deepEqual(after, before, 'the foundation target confirms rollback after a post-write commit fault')
  assert.ok((await target.restoreTarget.readState()).revision > beforeRevision, 'the fault evidence retains a durable revision transition')
}

async function quotaFailureIsAtomic(sourceComposition, artifact) {
  const target = await createTarget(root, 'quota-failure', { capacityBytes: 1 })
  const before = await collectApplicationDomains(target.restoreTarget)
  const report = await sourceComposition.service.dryRunRestore(artifact, { target: target.restoreTarget })
  assert.equal(report.ok, false)
  assert.ok(report.blocked.some((entry) => entry.reason === 'insufficient-capacity'))
  assert.deepEqual(await collectApplicationDomains(target.restoreTarget), before)
}

async function revisionConflictIsFailClosed(sourceComposition, artifact) {
  const target = await createTarget(root, 'revision-conflict')
  const writer = await createIsolatedProfileRestoreTarget({
    profileDir: target.profile,
    isolationRoot: target.rootDir,
  })
  const writerTransaction = await writer.beginTransaction({ restoreId: 'revision-conflict-writer' })
  await writerTransaction.applyDomain('workflow', { ...artifact.domains.workflow, revision: 99 })
  await writerTransaction.commit()
  const before = await collectApplicationDomains(target.restoreTarget)
  const report = await sourceComposition.service.dryRunRestore(artifact, { target: target.restoreTarget })
  assert.equal(report.ok, false)
  assert.ok(report.blocked.some((entry) => entry.reason === 'newer-target-revision'))
  await assert.rejects(
    sourceComposition.service.restore(artifact, { target: target.restoreTarget, restoreId: 'fault-revision-conflict' }),
    (error) => error?.code === 'RESTORE_DRY_RUN_BLOCKED',
  )
  assert.deepEqual(await collectApplicationDomains(target.restoreTarget), before)
}

async function checksumAndSchemaCorruptionIsQuarantined(sourceComposition, artifact) {
  const target = await createTarget(root, 'artifact-corruption')
  const corrupted = structuredClone(artifact)
  corrupted.domains.workflow.records[0].payload.title = 'tampered-without-checksum-update'
  await assert.rejects(
    sourceComposition.service.restore(corrupted, { target: target.restoreTarget, restoreId: 'fault-checksum-corrupt' }),
    (error) => error?.code === 'BACKUP_RECORD_CHECKSUM_MISMATCH'
      || error?.code === 'BACKUP_ARTIFACT_CHECKSUM_MISMATCH'
      || error?.code === 'BACKUP_CHECKSUM_MISMATCH',
  )
  assert.ok((await readdir(target.restoreTarget.quarantineDir)).length > 0)

  const corruptProfile = await createFixture(root, 'target-corrupt-value', false)
  await assert.rejects(
    (async () => {
      await writeFile(path.join(corruptProfile.profile, 'application-state.json'), '{truncated-json')
      return createIsolatedProfileRestoreTarget({
        profileDir: corruptProfile.profile,
        isolationRoot: corruptProfile.rootDir,
      })
    })(),
    (error) => error?.code === 'RESTORE_TARGET_STATE_CORRUPT',
  )
}

async function pageCloseAbortIsRetryable(sourceComposition, artifact) {
  const target = await createTarget(root, 'page-close')
  const before = await collectApplicationDomains(target.restoreTarget)
  const controller = new AbortController()
  controller.abort('page-close')
  await assert.rejects(
    sourceComposition.service.restore(artifact, {
      target: target.restoreTarget,
      restoreId: 'fault-page-close',
      signal: controller.signal,
    }),
    (error) => error?.code === 'RESTORE_INTERRUPTED',
  )
  assert.deepEqual(await collectApplicationDomains(target.restoreTarget), before)
  assert.equal((await sourceComposition.service.restore(artifact, {
    target: target.restoreTarget,
    restoreId: 'fault-page-close',
  })).status, 'completed')
}

async function processClosePendingCheckpointIsRecoverable(sourceComposition, artifact) {
  const target = await createTarget(root, 'process-close-pending', { faults: { commit: 'fail-once' } })
  const before = await collectApplicationDomains(target.restoreTarget)
  const beforeRevision = (await target.restoreTarget.readState()).revision
  await assert.rejects(
    sourceComposition.service.restore(artifact, {
      target: target.restoreTarget,
      restoreId: 'fault-process-close-pending',
    }),
    (error) => error?.code === 'RESTORE_COMMIT_FAILED',
  )
  assert.deepEqual(await collectApplicationDomains(target.restoreTarget), before)
  assert.ok((await target.restoreTarget.readState()).revision > beforeRevision)
  target.restoreTarget.setFaults({})
  assert.equal((await sourceComposition.service.restore(artifact, {
    target: target.restoreTarget,
    restoreId: 'fault-process-close-pending',
  })).status, 'completed')
}

async function pendingRecoveryPreservesConcurrentWrites(sourceComposition, artifact) {
  const target = await createTarget(root, 'pending-concurrent-write')
  const concurrent = await createIsolatedProfileRestoreTarget({
    profileDir: target.profile,
    isolationRoot: target.rootDir,
  })
  const firstTransaction = await target.restoreTarget.beginTransaction({ restoreId: 'pending-first' })
  const concurrentTransaction = await concurrent.beginTransaction({ restoreId: 'pending-concurrent' })
  await concurrentTransaction.applyDomain('workflow', { ...artifact.domains.workflow, revision: 2 })
  await concurrentTransaction.commit()
  await firstTransaction.applyDomain('workflow', artifact.domains.workflow)
  await assert.rejects(
    firstTransaction.commit(),
    (error) => error?.code === 'RESTORE_REVISION_CONFLICT',
    'a concurrent third state must remain visible instead of being overwritten by recovery',
  )
  const state = await target.restoreTarget.readState()
  assert.equal(state.revision, 1)
  assert.equal(state.domains.workflow.revision, 2)
}

async function rollbackFailureIsReported(sourceComposition, artifact) {
  const target = await createTarget(root, 'rollback-failure', {
    faults: { commit: 'write-then-fail' },
  })
  await assert.rejects(
    sourceComposition.service.restore(artifact, { target: target.restoreTarget, restoreId: 'fault-rollback-failure' }),
    (error) => error?.code === 'RESTORE_COMMIT_FAILED',
  )
  const journal = await target.restoreTarget.readJournal({ restoreId: 'fault-rollback-failure' })
  assert.equal(journal.status, 'rolled-back')
  assert.equal((await readdir(target.restoreTarget.rollbackDir)).length, 1)
}

async function createTarget(parent, name, options = {}) {
  const fixture = await createFixture(parent, name, false)
  const restoreTarget = await createIsolatedProfileRestoreTarget({
    profileDir: fixture.profile,
    isolationRoot: fixture.rootDir,
    initialDomains: options.initialDomains || emptyDomains(),
    capacityBytes: options.capacityBytes,
    faults: options.faults,
  })
  if (options.rollbackStore) restoreTarget.rollbackStore = options.rollbackStore
  if (options.quarantine) restoreTarget.quarantine = options.quarantine
  return {
    ...fixture,
    restoreTarget,
  }
}

async function createFixture(parent, name, populated) {
  const rootDir = path.join(parent, name)
  const profile = path.join(rootDir, 'profile')
  const state = path.join(rootDir, 'state')
  const output = path.join(rootDir, 'output')
  await Promise.all([
    mkdir(profile, { recursive: true }),
    mkdir(state, { recursive: true }),
    mkdir(output, { recursive: true }),
  ])
  if (populated) {
    await writeJson(path.join(profile, 'browser-profile.json'), {
      schemaVersion: 1,
      localStorage: {
        'vocabulary.passage-preview.durable-state.v1': JSON.stringify({ schemaVersion: 'passage-preview.durable-state.v1', revision: 2, contentId: 'preview-1', payload: { index: 1 } }),
        'AnnotationGenerationStorage::content-1': JSON.stringify({ schemaVersion: 1, revision: 2, contentId: 'content-1', payload: { count: 1 } }),
      },
      indexedDbRows: [
        { id: 'audioMeta', schemaVersion: 1, revision: 1, contentId: 'content-1', content: { title: 'fixture' } },
        { id: 'transcript', schemaVersion: 1, revision: 1, contentId: 'content-1', content: { segments: [] } },
        { id: 'chunkData', schemaVersion: 1, revision: 1, contentId: 'content-1', content: { s: [] } },
        { id: 'marks', schemaVersion: 1, revision: 1, contentId: 'content-1', content: [] },
        { id: 'readerSession', schemaVersion: 1, revision: 1, contentId: 'content-1', content: { contentId: 'content-1', revision: '1' } },
        { id: 'vocabulary.word-1', schemaVersion: 1, revision: 3, contentId: 'word-1', content: { schemaVersion: 1, words: [{ word: 'fixture' }], contexts: [], reviewStates: [], reviewLogs: [] } },
      ],
    })
    await writeEnvelope(path.join(state, 'jobs.json'), 'workflow.jobs', 'jobs', [{ jobId: 'job-1', outputDir: output, title: 'Fixture' }])
    await writeEnvelope(path.join(state, 'history.json'), 'workflow.history', 'items', [{ jobId: 'job-1', outputDir: output, title: 'Fixture' }])
    await writeJson(path.join(state, 'reader-index.json'), { items: [{ jobId: 'job-1' }] })
    await writeJson(path.join(state, 'config.json'), { model: 'fixture-model' })
    const marksPayload = { jobId: 'job-1', marks: [{ globalIndex: 1, text: 'fixture' }] }
    const marksCore = {
      schemaVersion: 'reader-marks.v1',
      domain: 'reader-marks',
      jobId: 'job-1',
      revision: 1,
      updatedAt: '2026-08-15T00:00:00.000Z',
      payload: marksPayload,
    }
    await writeJson(path.join(output, 'job-1', 'reader-marks.json'), {
      ...marksCore,
      checksum: `sha256:${await sha256(marksCore)}`,
    })
  }
  return {
    profileDir: profile,
    pythonStateDir: state,
    pythonOutputDir: output,
    isolationRoot: rootDir,
    profile,
    state,
    output,
    rootDir,
  }
}

async function writeEnvelope(filePath, domain, key, values) {
  const payload = { [key]: values }
  await writeJson(filePath, {
    schemaVersion: 1,
    domain,
    revision: 1,
    payload,
    checksum: `sha256:${await sha256(payload)}`,
    [key]: values,
  })
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function canonicalJson(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

async function collectApplicationDomains(target) {
  const values = {}
  for (const key of ['reader-session', 'vocabulary-srs', 'passage-preview', 'annotation', 'marks-activity', 'workflow']) {
    values[key] = await target.adapters[key].collect()
  }
  return values
}

function emptyDomains() {
  return Object.fromEntries(REQUIRED_DOMAINS.map((key) => [key, {
    schemaVersion: 1,
    adapterVersion: 1,
    revision: 0,
    records: [],
    references: [],
    mediaReferences: [],
  }]))
}
