import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createReadWebProductionBackupComposition } from './lib/read-web-production-backup.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-real-restore-'))
const source = await createFixture(root, 'source', true)
const target = await createFixture(root, 'target', false)
const sourceComposition = await createReadWebProductionBackupComposition({
  profileDir: source.profile,
  pythonStateDir: source.state,
  pythonOutputDir: source.output,
  release: { applicationVersion: 'real-restore-test', backendVersion: 'real-restore-test', gitSha: 'real-restore-test', releaseId: 'real-restore-test', manifestSha: null },
})
const artifact = await sourceComposition.createBackup({ now: () => 1760000000000 })
assert.ok(artifact.domains.workflow.records.some((record) => record.id.startsWith('jobs:')))
assert.ok(artifact.domains['marks-activity'].records.some((record) => record.id.startsWith('reader-marks.json:')))
assert.ok(artifact.domains['reader-session'].records.some((record) => record.id === 'readerSession'))
assert.ok(artifact.domains['passage-preview'].records.some((record) => record.id === 'vocabulary.passage-preview.durable-state.v1'))
assert.ok(artifact.domains.annotation.records.some((record) => record.id === 'AnnotationGenerationStorage::content-1'))

const targetComposition = await createReadWebProductionBackupComposition({
  profileDir: target.profile,
  pythonStateDir: target.state,
  pythonOutputDir: target.output,
  release: { applicationVersion: 'real-restore-test', backendVersion: 'real-restore-test', gitSha: 'real-restore-test', releaseId: 'real-restore-test', manifestSha: null },
})
const restoreTarget = targetComposition.restoreTarget
const dryRun = await sourceComposition.service.dryRunRestore(artifact, { target: restoreTarget })
assert.equal(dryRun.write, false)
assert.equal(dryRun.ok, true, JSON.stringify(dryRun))
const restored = await sourceComposition.service.restore(artifact, {
  target: restoreTarget,
  restoreId: 'real-restore-success',
})
assert.equal(restored.status, 'completed')
const restoredVerification = await sourceComposition.service.dryRunRestore(artifact, { target: restoreTarget })
assert.equal(restoredVerification.ok, true, JSON.stringify(restoredVerification))
assert.equal((await sourceComposition.service.restore(artifact, { target: restoreTarget, restoreId: 'real-restore-success' })).status, 'already-complete')
const persistedProfile = JSON.parse(await readFile(path.join(target.profile, 'browser-profile.json'), 'utf8'))
assert.ok(persistedProfile.localStorage['vocabulary.passage-preview.durable-state.v1'])
const reopenedTarget = (await createReadWebProductionBackupComposition({
  profileDir: target.profile,
  pythonStateDir: target.state,
  pythonOutputDir: target.output,
  release: { applicationVersion: 'real-restore-test', backendVersion: 'real-restore-test', gitSha: 'real-restore-test', releaseId: 'real-restore-test', manifestSha: null },
})).restoreTarget
assert.equal((await sourceComposition.service.dryRunRestore(artifact, { target: reopenedTarget })).ok, true)

const failingTargetComposition = await createReadWebProductionBackupComposition({
  profileDir: path.join(root, 'failure-profile'),
  pythonStateDir: path.join(root, 'failure-state'),
  pythonOutputDir: path.join(root, 'failure-output'),
  release: { applicationVersion: 'real-restore-test', backendVersion: 'real-restore-test', gitSha: 'real-restore-test', releaseId: 'real-restore-test', manifestSha: null },
})
failingTargetComposition.restoreTarget.setFaults({ failAfterDomain: 1 })
const beforeFailure = JSON.stringify(await failingTargetComposition.restoreTarget.adapters['reader-session'].collect())
await assert.rejects(
  sourceComposition.service.restore(artifact, { target: failingTargetComposition.restoreTarget, restoreId: 'real-restore-failure' }),
  (error) => error?.code === 'RESTORE_COMMIT_FAILED',
)
assert.equal(JSON.stringify(await failingTargetComposition.restoreTarget.adapters['reader-session'].collect()), beforeFailure)
failingTargetComposition.restoreTarget.setFaults({})
assert.equal((await sourceComposition.service.restore(artifact, {
  target: failingTargetComposition.restoreTarget,
  restoreId: 'real-restore-failure',
})).status, 'completed')

const quotaTarget = (await createReadWebProductionBackupComposition({
  profileDir: path.join(root, 'quota-profile'),
  pythonStateDir: path.join(root, 'quota-state'),
  pythonOutputDir: path.join(root, 'quota-output'),
  capacityBytes: 1,
  release: { applicationVersion: 'real-restore-test', backendVersion: 'real-restore-test', gitSha: 'real-restore-test', releaseId: 'real-restore-test', manifestSha: null },
})).restoreTarget
const quotaReport = await sourceComposition.service.dryRunRestore(artifact, { target: quotaTarget })
assert.equal(quotaReport.ok, false)

console.log('real application restore target checks passed')
await rm(root, { recursive: true, force: true })

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
    await writeJson(path.join(output, 'job-1', 'reader-marks.json'), {
      schemaVersion: 'reader-marks.v1',
      domain: 'reader-marks',
      jobId: 'job-1',
      revision: 1,
      updatedAt: '2026-08-15T00:00:00.000Z',
      payload: { jobId: 'job-1', marks: [{ globalIndex: 1, text: 'fixture' }] },
      checksum: sha256({
        schemaVersion: 'reader-marks.v1',
        domain: 'reader-marks',
        jobId: 'job-1',
        revision: 1,
        updatedAt: '2026-08-15T00:00:00.000Z',
        payload: { jobId: 'job-1', marks: [{ globalIndex: 1, text: 'fixture' }] },
      }),
    })
  }
  return { profile, state, output }
}

async function writeEnvelope(filePath, domain, key, values) {
  const payload = { [key]: values }
  await writeJson(filePath, {
    schemaVersion: 1,
    domain,
    revision: 1,
    payload,
    checksum: sha256(payload),
    [key]: values,
  })
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
