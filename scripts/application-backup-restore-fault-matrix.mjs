import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createReadWebProductionBackupComposition } from './lib/read-web-production-backup.mjs'

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
  await writeFailureIsAtomic(sourceComposition, artifact)
  await quotaFailureIsAtomic(sourceComposition, artifact)
  await revisionConflictIsFailClosed(sourceComposition, artifact)
  await checksumAndSchemaCorruptionIsQuarantined(sourceComposition, artifact)
  await pageCloseAbortIsRetryable(sourceComposition, artifact)
  await processClosePendingCheckpointIsRecoverable(sourceComposition, artifact)
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
      faults: { abortAfterDomain },
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

async function writeFailureIsAtomic(sourceComposition, artifact) {
  const target = await createTarget(root, 'write-failure', {
    faults: { failBeforeDomain: 2, failCode: 'RESTORE_DISK_FULL' },
  })
  const before = await collectApplicationDomains(target.restoreTarget)
  await assert.rejects(
    sourceComposition.service.restore(artifact, { target: target.restoreTarget, restoreId: 'fault-disk-full' }),
    (error) => error?.code === 'RESTORE_DISK_FULL',
  )
  assert.deepEqual(await collectApplicationDomains(target.restoreTarget), before)
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
  await target.browserProfile.persistence.replaceRows({
    rows: [{ id: 'readerSession', schemaVersion: 1, revision: 99, contentId: 'content-1', content: { contentId: 'content-1', changed: true } }],
    allowId: () => true,
  })
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
  const profileAfterCorruptArtifact = JSON.parse(await readFile(path.join(target.profile, 'browser-profile.json'), 'utf8'))
  assert.ok(Object.keys(profileAfterCorruptArtifact.localStorage).some((key) => key.includes('quarantine')))

  const corruptProfile = await createFixture(root, 'target-corrupt-value', false)
  await writeJson(path.join(corruptProfile.profile, 'browser-profile.json'), {
    schemaVersion: 1,
    localStorage: { 'vocabulary.passage-preview.durable-state.v1': '{truncated-json' },
    indexedDbRows: [],
  })
  const corruptTarget = await createReadWebProductionBackupComposition({ ...corruptProfile, release })
  await assert.rejects(
    sourceComposition.service.restore(artifact, { target: corruptTarget.restoreTarget, restoreId: 'fault-corrupt-local-storage' }),
    (error) => error?.code === 'RESTORE_DRY_RUN_BLOCKED' || error?.code === 'BACKUP_LOCAL_STORAGE_CORRUPT',
  )
  const corruptProfileAfter = JSON.parse(await readFile(path.join(corruptProfile.profile, 'browser-profile.json'), 'utf8'))
  const quarantineValues = Object.entries(corruptProfileAfter.localStorage)
    .filter(([key]) => key.includes('quarantine'))
    .map(([, value]) => JSON.parse(value).value)
  assert.ok(quarantineValues.some((value) => (
    value.sourceKey === 'vocabulary.passage-preview.durable-state.v1'
      && value.rawValue === '{truncated-json'
      && value.reason === 'BACKUP_LOCAL_STORAGE_CORRUPT'
      && value.quarantinedAt
  )))
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
  let pendingValue = null
  const interruptedPendingStore = {
    async read() { return pendingValue ? structuredClone(pendingValue) : null },
    async write(value) {
      pendingValue = structuredClone(value)
      if (Array.isArray(value.appliedDomains) && value.appliedDomains.length === 1) {
        const error = new Error('simulated page/process close after durable checkpoint')
        error.code = 'RESTORE_PROCESS_CLOSED'
        throw error
      }
    },
    async remove() {
      const error = new Error('simulated process close before pending cleanup')
      error.code = 'RESTORE_PROCESS_CLOSED'
      throw error
    },
  }
  const target = await createTarget(root, 'process-close-pending', { pendingStore: interruptedPendingStore })
  const before = await collectApplicationDomains(target.restoreTarget)
  await assert.rejects(
    sourceComposition.service.restore(artifact, {
      target: target.restoreTarget,
      restoreId: 'fault-process-close-pending',
    }),
    (error) => error?.code === 'RESTORE_ROLLBACK_FAILED',
  )
  assert.ok(pendingValue?.checksum)

  const reopenedPendingStore = {
    async read() { return structuredClone(pendingValue) },
    async write(value) { pendingValue = structuredClone(value) },
    async remove() { pendingValue = null },
  }
  const reopened = await createReadWebProductionBackupComposition({
    profileDir: target.profile,
    pythonStateDir: target.state,
    pythonOutputDir: target.output,
    pendingStore: reopenedPendingStore,
    release,
  })
  const recovery = await reopened.restoreTarget.recoverPendingRestore()
  assert.equal(recovery.status, 'rolled-back')
  assert.deepEqual(await collectApplicationDomains(reopened.restoreTarget), before)
  assert.equal(pendingValue, null)
}

async function rollbackFailureIsReported(sourceComposition, artifact) {
  const target = await createTarget(root, 'rollback-failure', {
    faults: { failAfterDomain: 1, failRollbackAfterDomain: 1 },
  })
  await assert.rejects(
    sourceComposition.service.restore(artifact, { target: target.restoreTarget, restoreId: 'fault-rollback-failure' }),
    (error) => error?.code === 'RESTORE_ROLLBACK_FAILED',
  )
  const journal = await target.restoreTarget.readJournal({ restoreId: 'fault-rollback-failure' })
  assert.equal(journal.status, 'rollback-failed')
  assert.equal(journal.manualRecoveryRequired, true)
  const profile = JSON.parse(await readFile(path.join(target.profile, 'browser-profile.json'), 'utf8'))
  assert.ok(Object.keys(profile.localStorage).some((key) => key.includes('quarantine')))
}

async function createTarget(parent, name, options = {}) {
  const fixture = await createFixture(parent, name, false)
  return {
    ...fixture,
    ...(await createReadWebProductionBackupComposition({ ...fixture, ...options, release })),
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
  return { profileDir: profile, pythonStateDir: state, pythonOutputDir: output, profile, state, output }
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
