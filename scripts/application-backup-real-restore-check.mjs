import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createProductionOutboxQuarantineProtector,
  createReadWebProductionBackupComposition,
} from './lib/read-web-production-backup.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-real-restore-'))
await assert.rejects(
  createReadWebProductionBackupComposition({
    profileDir: path.join(root, 'missing-root-profile'),
    pythonStateDir: path.join(root, 'missing-root-state'),
    pythonOutputDir: path.join(root, 'missing-root-output'),
  }),
  (error) => error?.code === 'BACKUP_PRODUCTION_COMPOSITION_CONFIGURATION',
)
await assert.rejects(
  createReadWebProductionBackupComposition({
    isolationRoot: root,
    profileDir: path.join(root, 'overlap'),
    pythonStateDir: path.join(root, 'overlap', 'state'),
    pythonOutputDir: path.join(root, 'overlap-output'),
  }),
  (error) => error?.code === 'BACKUP_PRODUCTION_COMPOSITION_UNSAFE_PATH',
)
const forbiddenRoot = path.join(root, 'forbidden')
await assert.rejects(
  createReadWebProductionBackupComposition({
    isolationRoot: forbiddenRoot,
    profileDir: path.join(forbiddenRoot, 'profile'),
    pythonStateDir: path.join(forbiddenRoot, 'state'),
    pythonOutputDir: path.join(forbiddenRoot, 'output'),
    forbiddenRoots: [forbiddenRoot],
  }),
  (error) => error?.code === 'BACKUP_PRODUCTION_COMPOSITION_UNSAFE_PATH',
)
await assert.rejects(
  createReadWebProductionBackupComposition({
    isolationRoot: path.join('E:\\read-web-next', 'batch2-unsafe'),
    profileDir: path.join('E:\\read-web-next', 'batch2-unsafe', 'profile'),
    pythonStateDir: path.join('E:\\read-web-next', 'batch2-unsafe', 'state'),
    pythonOutputDir: path.join('E:\\read-web-next', 'batch2-unsafe', 'output'),
  }),
  (error) => error?.code === 'BACKUP_PRODUCTION_COMPOSITION_UNSAFE_PATH',
)
const symlinkRoot = path.join(root, 'symlink-root')
const symlinkTarget = path.join(root, 'symlink-target')
await mkdir(symlinkTarget, { recursive: true })
const redirectedProfile = path.join(symlinkRoot, 'profile')
await mkdir(symlinkRoot, { recursive: true })
await symlink(symlinkTarget, redirectedProfile, 'junction')
await assert.rejects(
  createReadWebProductionBackupComposition({
    isolationRoot: symlinkRoot,
    profileDir: path.join(redirectedProfile, 'nested-profile'),
    pythonStateDir: path.join(symlinkRoot, 'state'),
    pythonOutputDir: path.join(symlinkRoot, 'output'),
  }),
  (error) => error?.code === 'BACKUP_PRODUCTION_COMPOSITION_UNSAFE_PATH',
)
const outboxQuarantineProtector = await createProductionOutboxQuarantineProtector({
  key: 'real-restore-fixture-key',
  keyId: 'real-restore-fixture-key-1',
})
const source = await createFixture(root, 'source', true)
const target = await createFixture(root, 'target', false)
const sourceComposition = await createReadWebProductionBackupComposition({
  profileDir: source.profile,
  pythonStateDir: source.state,
  pythonOutputDir: source.output,
  isolationRoot: source.rootDir,
  readerSaveOutboxQuarantineProtector: outboxQuarantineProtector,
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
  isolationRoot: target.rootDir,
  readerSaveOutboxQuarantineProtector: outboxQuarantineProtector,
  release: { applicationVersion: 'real-restore-test', backendVersion: 'real-restore-test', gitSha: 'real-restore-test', releaseId: 'real-restore-test', manifestSha: null },
})
const restoreTarget = targetComposition.restoreTarget
assert.equal(restoreTarget.rollbackStoreSeparate, false)
assert.equal(restoreTarget.restoreCapabilities.atomicRevisionCommit, true)
const dryRun = await sourceComposition.service.dryRunRestore(artifact, { target: restoreTarget })
assert.equal(dryRun.write, false)
assert.equal(dryRun.ok, true, JSON.stringify(dryRun))
assert.equal((await sourceComposition.service.restore(artifact, {
  target: restoreTarget,
  restoreId: 'real-six-domain-restore',
})).status, 'completed')
assert.deepEqual(
  normalizeDomains(await collectApplicationDomains(restoreTarget)),
  normalizeDomains(artifact.domains),
  'the production target must publish the complete six-domain restore',
)
const reopenedTarget = (await createReadWebProductionBackupComposition({
    profileDir: target.profile,
    pythonStateDir: target.state,
    pythonOutputDir: target.output,
    isolationRoot: target.rootDir,
    readerSaveOutboxQuarantineProtector: outboxQuarantineProtector,
  release: { applicationVersion: 'real-restore-test', backendVersion: 'real-restore-test', gitSha: 'real-restore-test', releaseId: 'real-restore-test', manifestSha: null },
})).restoreTarget
assert.deepEqual(
  normalizeDomains(await collectApplicationDomains(reopenedTarget)),
  normalizeDomains(artifact.domains),
  'application startup must reopen the complete committed six-domain restore',
)

const quotaTarget = (await createReadWebProductionBackupComposition({
  profileDir: path.join(root, 'quota-profile'),
  pythonStateDir: path.join(root, 'quota-state'),
  pythonOutputDir: path.join(root, 'quota-output'),
  isolationRoot: root,
  readerSaveOutboxQuarantineProtector: outboxQuarantineProtector,
  capacityBytes: 1,
  release: { applicationVersion: 'real-restore-test', backendVersion: 'real-restore-test', gitSha: 'real-restore-test', releaseId: 'real-restore-test', manifestSha: null },
})).restoreTarget
const quotaReport = await sourceComposition.service.dryRunRestore(artifact, { target: quotaTarget })
assert.equal(quotaReport.ok, false)

console.log('real application restore target checks passed')
await rm(root, { recursive: true, force: true })

async function collectApplicationDomains(target) {
  return Object.fromEntries(await Promise.all([
    'reader-session',
    'marks-activity',
    'vocabulary-srs',
    'passage-preview',
    'annotation',
    'workflow',
  ].map(async (key) => [key, await target.adapters[key].collect()])))
}

function normalizeDomains(domains) {
  return Object.fromEntries(Object.entries(domains).map(([key, domain]) => [key, {
    schemaVersion: domain.schemaVersion,
    adapterVersion: domain.adapterVersion,
    revision: domain.revision,
    references: domain.references || [],
    mediaReferences: domain.mediaReferences || [],
    records: (domain.records || []).map(({ checksum: _checksum, ...record }) => ({
      ...record,
      references: record.references || [],
      mediaReferences: record.mediaReferences || [],
    })),
  }]))
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
        'read-web.reader-save-outbox.v1': JSON.stringify({ schemaVersion: 1, entries: [readerOutboxFixture()] }),
        'read-web.reader-save-outbox-quarantine.v1.corrupt-fixture': JSON.stringify({
          schemaVersion: 1,
          sourceKey: 'read-web.reader-save-outbox.v2.corrupt-fixture',
          detectedAt: '2026-08-15T00:00:00.000Z',
          reason: 'malformed-json',
          rawValue: '{truncated-fixture',
        }),
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
  return { profile, state, output, rootDir }
}

function readerOutboxFixture() {
  return {
    jobId: 'job-1',
    kind: 'marks',
    operationId: 'restore-fixture-marks-1',
    expectedRevision: 1,
    intent: { marks: [{ globalIndex: 1, word: 'fixture', start: null, sourceType: 'manual-mark' }] },
  }
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
