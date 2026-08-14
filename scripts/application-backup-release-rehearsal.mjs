import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {
  createIsolatedProfileRestoreTarget,
  createReadWebProductionBackupComposition,
  readArtifactFromFile,
  writeArtifactToFile,
  writeIsolatedBrowserProfile,
} from './lib/read-web-production-backup.mjs'

const outputPath = path.resolve(
  process.env.APPLICATION_BACKUP_REHEARSAL_OUTPUT || 'output/verification/application-backup-rehearsal.json',
)
const rehearsalRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-backup-rehearsal-'))
const evidence = {
  schemaVersion: 2,
  kind: 'isolated-production-application-backup-restore-rehearsal',
  startedAt: new Date().toISOString(),
  realDataTouched: false,
  reservedDailyPortsTouched: false,
  source: { root: '[temporary-isolated-root]', profile: null, pythonState: null, pythonOutput: null },
  checks: [],
  passed: false,
}

try {
  const sourceProfile = path.join(rehearsalRoot, 'source-profile')
  const sourcePythonState = path.join(rehearsalRoot, 'source-python-state')
  const sourcePythonOutput = path.join(rehearsalRoot, 'source-python-output')
  const artifactPath = path.join(rehearsalRoot, 'application-backup.json')
  evidence.source.profile = 'source-profile'
  evidence.source.pythonState = 'source-python-state'
  evidence.source.pythonOutput = 'source-python-output'
  await createFixture(sourceProfile, sourcePythonState, sourcePythonOutput)

  const composition = await createReadWebProductionBackupComposition({
    profileDir: sourceProfile,
    pythonStateDir: sourcePythonState,
    pythonOutputDir: sourcePythonOutput,
    release: {
      applicationVersion: 'rehearsal-1',
      backendVersion: 'rehearsal-1',
      gitSha: 'rehearsal-git-sha',
      releaseId: 'rehearsal-release',
      manifestSha: 'rehearsal-manifest-sha',
    },
  })
  assert.deepEqual(composition.requiredDomains, [
    'reader-session',
    'marks-activity',
    'vocabulary-srs',
    'passage-preview',
    'annotation',
    'workflow',
  ])
  evidence.checks.push({ name: 'production composition owns all six domains', passed: true })

  const artifact = await composition.createBackup({ now: () => 1760000000000 })
  await writeArtifactToFile(artifactPath, artifact)
  const rereadArtifact = await readArtifactFromFile(artifactPath)
  const independentVerification = await composition.service.verifyBackup(JSON.stringify(rereadArtifact))
  assert.equal(independentVerification.valid, true)
  assert.equal(independentVerification.summary.domainKeys.length, 6)
  assert.ok(independentVerification.summary.domains.every((domain) => domain.recordCount > 0))
  evidence.checks.push({
    name: 'independent verifier rereads one six-domain artifact',
    passed: true,
    domainCounts: rereadArtifact.manifest.recordCounts,
  })

  const serializedArtifact = JSON.stringify(rereadArtifact)
  for (const forbidden of [
    'fixture-access-token',
    'fixture-api-key',
    'private-machine',
    'whisperx-private',
    'Authorization',
    'not copied into backup',
  ]) assert.equal(serializedArtifact.includes(forbidden), false, `artifact must not contain ${forbidden}`)
  assert.ok(rereadArtifact.manifest.mediaReferences.workflow.every((reference) => (
    reference.strategy === 'identity-metadata-rebind'
      && Number.isInteger(reference.sizeBytes)
      && !Object.prototype.hasOwnProperty.call(reference, 'bytes')
  )))
  const outboxRecords = rereadArtifact.domains['reader-session'].records.filter((record) => record.id.startsWith('reader-save-outbox:'))
  assert.equal(outboxRecords.length, 2)
  assert.ok(outboxRecords.some((record) => record.schemaVersion === 1))
  assert.ok(outboxRecords.some((record) => record.schemaVersion === 2))
  evidence.checks.push({ name: 'outbox v1/v2, secrets, private paths, and full media are handled', passed: true, outboxRecords: outboxRecords.length })

  const conflictTarget = await createIsolatedProfileRestoreTarget({
    profileDir: path.join(rehearsalRoot, 'target-conflict'),
    initialDomains: createConflictBaseline(artifact),
  })
  const conflictReport = await composition.service.dryRunRestore(artifact, { target: conflictTarget })
  assert.equal(conflictReport.write, false)
  assert.equal(conflictReport.ok, false)
  const conflictDomain = conflictReport.domains.find((domain) => domain.key === 'vocabulary-srs')
  assert.ok(conflictDomain?.records.some((record) => record.decision === 'blocked' && record.targetRevision === 99))
  assert.ok(conflictReport.blocked.some((entry) => entry.recordId))
  evidence.checks.push({ name: 'dry-run blocks a newer record and reports it by id', passed: true })

  const target = await createIsolatedProfileRestoreTarget({
    profileDir: path.join(rehearsalRoot, 'target-success'),
    initialDomains: createEmptyBaseline(composition.requiredDomains),
  })
  const dryRun = await composition.service.dryRunRestore(artifact, { target })
  assert.equal(dryRun.write, false)
  assert.equal(dryRun.ok, true)
  const restored = await composition.service.restore(artifact, { target, restoreId: 'production-rehearsal-success' })
  assert.equal(restored.status, 'completed')
  assert.equal((await target.readState()).domains.workflow.records.length, artifact.domains.workflow.records.length)
  const retry = await composition.service.restore(artifact, { target, restoreId: 'production-rehearsal-success' })
  assert.equal(retry.status, 'already-complete')
  evidence.checks.push({ name: 'real isolated directory restore and idempotent retry', passed: true })

  const failureTarget = await createIsolatedProfileRestoreTarget({
    profileDir: path.join(rehearsalRoot, 'target-failure'),
    initialDomains: createFailureBaseline(composition.requiredDomains, artifact),
    faults: { commit: 'fail-once' },
  })
  const beforeFailure = await targetStateJson(failureTarget)
  const failureDryRun = await composition.service.dryRunRestore(artifact, { target: failureTarget })
  assert.equal(failureDryRun.ok, true, JSON.stringify(failureDryRun))
  await assert.rejects(
    composition.service.restore(artifact, { target: failureTarget, restoreId: 'production-rehearsal-failure' }),
    (error) => error?.code === 'RESTORE_COMMIT_FAILED',
  )
  assert.deepEqual(await targetStateJson(failureTarget), beforeFailure)
  failureTarget.setFaults({})
  const recovered = await composition.service.restore(artifact, { target: failureTarget, restoreId: 'production-rehearsal-failure' })
  assert.equal(recovered.status, 'completed')
  const completedRetry = await composition.service.restore(artifact, { target: failureTarget, restoreId: 'production-rehearsal-failure' })
  assert.equal(completedRetry.status, 'already-complete')
  evidence.checks.push({ name: 'replace failure rolls back old values and retry is idempotent', passed: true })

  const interruptionTarget = await createIsolatedProfileRestoreTarget({
    profileDir: path.join(rehearsalRoot, 'target-interruption'),
    initialDomains: createFailureBaseline(composition.requiredDomains, artifact),
    faults: { interruptAfterDomain: 1 },
  })
  const beforeInterruption = await targetStateJson(interruptionTarget)
  const interruptionDryRun = await composition.service.dryRunRestore(artifact, { target: interruptionTarget })
  assert.equal(interruptionDryRun.ok, true, JSON.stringify(interruptionDryRun))
  await assert.rejects(
    composition.service.restore(artifact, { target: interruptionTarget, restoreId: 'production-rehearsal-interruption' }),
    (error) => error?.code === 'RESTORE_INTERRUPTED',
  )
  assert.deepEqual(await targetStateJson(interruptionTarget), beforeInterruption)
  interruptionTarget.setFaults({})
  assert.equal((await composition.service.restore(artifact, {
    target: interruptionTarget,
    restoreId: 'production-rehearsal-interruption',
  })).status, 'completed')
  evidence.checks.push({ name: 'interruption preserves old values and resumes', passed: true })

  const quotaTarget = await createIsolatedProfileRestoreTarget({
    profileDir: path.join(rehearsalRoot, 'target-quota'),
    initialDomains: createEmptyBaseline(composition.requiredDomains),
    capacityBytes: 1,
  })
  const beforeQuota = await targetStateJson(quotaTarget)
  const quotaReport = await composition.service.dryRunRestore(artifact, { target: quotaTarget })
  assert.equal(quotaReport.ok, false)
  assert.deepEqual(await targetStateJson(quotaTarget), beforeQuota)
  evidence.checks.push({ name: 'quota dry-run blocks without writing', passed: true })

  const corruptArtifact = structuredClone(artifact)
  corruptArtifact.manifest.schemaVersion = 99
  const corruptTarget = await createIsolatedProfileRestoreTarget({
    profileDir: path.join(rehearsalRoot, 'target-corrupt'),
    initialDomains: createFailureBaseline(composition.requiredDomains, artifact),
  })
  const beforeCorrupt = await targetStateJson(corruptTarget)
  await assert.rejects(
    composition.service.restore(corruptArtifact, { target: corruptTarget, restoreId: 'production-rehearsal-corrupt' }),
    (error) => error?.code === 'BACKUP_SCHEMA_UNSUPPORTED',
  )
  assert.deepEqual(await targetStateJson(corruptTarget), beforeCorrupt)
  evidence.checks.push({ name: 'unknown schema is quarantined without changing target', passed: true })

  evidence.artifact = {
    path: '[temporary-isolated-root]/application-backup.json',
    checksum: rereadArtifact.artifactChecksum,
    verifier: independentVerification.summary,
  }
  evidence.passed = true
} catch (error) {
  evidence.error = { code: error?.code || 'REHEARSAL_FAILED', message: error?.message || String(error) }
  process.exitCode = 1
} finally {
  evidence.completedAt = new Date().toISOString()
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(`backup/restore production rehearsal: ${evidence.passed ? 'passed' : 'failed'}`)
  console.log(`evidence: ${outputPath}`)
  await rm(rehearsalRoot, { recursive: true, force: true })
}

async function createFixture(profileDir, stateDir, outputDir) {
  const jobDir = path.join(outputDir, 'job-1')
  const workflowDir = path.join(jobDir, '_workflow')
  await Promise.all([
    mkdir(profileDir, { recursive: true }),
    mkdir(stateDir, { recursive: true }),
    mkdir(workflowDir, { recursive: true }),
  ])
  const marksEntry = {
    jobId: 'job-1',
    kind: 'marks',
    operationId: 'outbox-marks-1',
    expectedRevision: 2,
    intent: { marks: [{ globalIndex: 1, word: 'durable', start: 1.5, sourceType: 'manual-mark' }] },
  }
  const activityEntry = {
    jobId: 'job-1',
    kind: 'activity',
    operationId: 'outbox-activity-1',
    expectedRevision: 3,
    intent: {
      event: 'pause',
      sessionId: 'session-1',
      sessionStartedAt: '2026-08-14T00:00:00Z',
      positionSeconds: 3.5,
      durationSeconds: 10,
      intervals: [[0, 3.5]],
      coverageRatio: 0.35,
      markCount: 1,
    },
  }
  await writeIsolatedBrowserProfile(profileDir, {
    localStorage: {
      'read-web.reader-save-outbox.v1': JSON.stringify({ schemaVersion: 1, entries: [marksEntry] }),
      [`read-web.reader-save-outbox.v2.${outboxKeyPart(activityEntry.jobId)}.${activityEntry.kind}.${outboxKeyPart(activityEntry.operationId)}`]: JSON.stringify({ schemaVersion: 2, ...activityEntry }),
      'vocabulary.passage-preview.durable-state.v1': JSON.stringify({ schemaVersion: 'passage-preview.durable-state.v1', revision: 4, contentId: 'preview-1', payload: { page: 2 } }),
      'AnnotationGenerationStorage::content-1': JSON.stringify({ schemaVersion: 1, revision: 2, contentId: 'content-1', status: 'generated', payload: { sentenceCount: 1 } }),
    },
    indexedDbRows: [
      { id: 'audioMeta', schemaVersion: 1, revision: 3, contentId: 'content-1', content: { title: 'Fixture reader', mediaIdentity: 'fixture-media-1' } },
      { id: 'transcript', schemaVersion: 1, revision: 3, contentId: 'content-1', content: { text: 'A durable fixture.' } },
      { id: 'chunkData', schemaVersion: 1, revision: 2, contentId: 'content-1', content: { chunks: [{ id: 'chunk-1', text: 'durable fixture' }] } },
      { id: 'marks', schemaVersion: 1, revision: 2, contentId: 'content-1', content: { marks: [{ globalIndex: 1, word: 'durable' }] } },
      { id: 'readerSession', schemaVersion: 1, revision: 3, contentId: 'content-1', content: { sessionId: 'session-1', currentTime: 3.5 } },
      { id: 'vocabulary.word-1', schemaVersion: 1, revision: 5, contentId: 'word-1', content: { word: 'durable', srs: { due: '2026-08-15' } } },
    ],
  })

  await writeWorkflowEnvelope(stateDir, 'jobs.json', 'workflow.jobs', 'jobs', [{
    jobId: 'job-1',
    outputDir: jobDir,
    url: 'https://example.test/watch?token=fixture-access-token',
    ytDlpPath: 'C:\\Users\\private-machine\\tools\\yt-dlp.exe',
    whisperxPath: '/home/private-machine/.venv/bin/whisperx',
  }])
  await writeWorkflowEnvelope(stateDir, 'history.json', 'workflow.history', 'items', [{ jobId: 'job-1', outputDir: jobDir, title: 'Fixture' }])
  await writeJson(path.join(stateDir, 'reader-index.json'), { items: [{ jobId: 'job-1', outputDir: jobDir }] })
  await writeJson(path.join(stateDir, 'config.json'), {
    model: 'fixture-model',
    proxyUrl: 'https://user:password@example.test:8443/?token=fixture-access-token',
    cookiesPath: 'C:\\Users\\private-machine\\cookies.txt',
    ytDlpPath: 'C:\\Users\\private-machine\\tools\\yt-dlp.exe',
    whisperxPath: '/home/private-machine/.venv/bin/whisperx',
  })
  await writeJson(path.join(workflowDir, 'transcript.json'), { schemaVersion: 1, revision: 2, segments: [{ text: 'durable' }] })
  await writeJson(path.join(workflowDir, 'reader-marks.json'), await marksEnvelope('job-1'))
  await writeJson(path.join(workflowDir, 'reader-activity.json'), await activityEnvelope('job-1'))
  await writeJson(path.join(workflowDir, 'reader-marks-commit-journal.json'), await marksJournalEnvelope('job-1'))
  await writeFile(path.join(jobDir, 'video.mp4'), Buffer.alloc(1024, 7))
}

async function writeWorkflowEnvelope(stateDir, fileName, domain, collection, items) {
  const payload = { [collection]: items }
  await writeJson(path.join(stateDir, fileName), {
    schemaVersion: 1,
    domain,
    revision: 1,
    payload,
    checksum: sha256(payload),
  })
}

async function marksEnvelope(jobId) {
  return signedMarksEnvelope('reader-marks.v1', 'reader-marks', jobId, 2, {
    jobId,
    marks: [{ globalIndex: 1, text: 'durable' }],
  })
}

async function activityEnvelope(jobId) {
  return signedMarksEnvelope('reader-activity.v1', 'reader-activity', jobId, 3, {
    jobId,
    events: [{ type: 'pause', positionSeconds: 3.5 }],
  })
}

async function marksJournalEnvelope(jobId) {
  return signedMarksEnvelope('reader-marks-commit-journal.v1', 'reader-marks-commit-journal', jobId, 3, {
    jobId,
    operations: { 'outbox-marks-1': { status: 'saved' } },
  })
}

function signedMarksEnvelope(schemaVersion, domain, jobId, revision, payload) {
  const unsigned = { schemaVersion, domain, jobId, revision, updatedAt: '2026-08-14T00:00:00Z', payload }
  return { ...unsigned, checksum: sha256(unsigned) }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

function canonicalJson(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function outboxKeyPart(value) {
  return Array.from(String(value || '')).map((character) => character.codePointAt(0).toString(16)).join('_')
}

function createEmptyBaseline(requiredDomains) {
  return Object.fromEntries(requiredDomains.map((key) => [key, {
    schemaVersion: 1,
    adapterVersion: 1,
    revision: 0,
    records: [],
    references: [],
    mediaReferences: [],
  }]))
}

function createFailureBaseline(requiredDomains, artifact = null) {
  return Object.fromEntries(requiredDomains.map((key) => [key, {
    schemaVersion: 1,
    adapterVersion: 1,
    revision: 0,
    records: artifact
      ? artifact.domains[key].records.map((record) => ({
          id: record.id,
          schemaVersion: record.schemaVersion,
          revision: 0,
          contentId: record.contentId,
          payload: record.revision === 0 ? record.payload : { oldValue: `old-${key}-${record.id}` },
          references: record.revision === 0 ? record.references : [],
          mediaReferences: record.revision === 0 ? record.mediaReferences : [],
        }))
      : [{ id: `old:${key}`, schemaVersion: 1, revision: 7, contentId: `old-${key}`, payload: { value: `old-${key}` }, references: [], mediaReferences: [] }],
    references: [],
    mediaReferences: [],
  }]))
}

function createConflictBaseline(artifact) {
  const baseline = createEmptyBaseline(Object.keys(artifact.domains))
  const source = artifact.domains['vocabulary-srs'].records[0]
  baseline['vocabulary-srs'].revision = 99
  baseline['vocabulary-srs'].records = [{
    id: source.id,
    schemaVersion: source.schemaVersion,
    revision: 99,
    contentId: source.contentId,
    payload: { value: 'target-is-newer' },
    references: [],
    mediaReferences: [],
  }]
  return baseline
}

async function targetStateJson(target) {
  return JSON.stringify(await target.readState())
}
