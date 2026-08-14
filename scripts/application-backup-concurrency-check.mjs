import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createIsolatedProfileRestoreTarget } from './lib/read-web-production-backup.mjs'

const backupSource = await readFile(new URL('../src/services/persistence/application-backup.js', import.meta.url), 'utf8')
const { createApplicationBackupService } = await import(
  `data:text/javascript;base64,${Buffer.from(backupSource).toString('base64')}`,
)

const requiredDomains = [
  'reader-session',
  'marks-activity',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'workflow',
]

const initialDomains = Object.fromEntries(requiredDomains.map((key) => [key, {
  schemaVersion: 1,
  adapterVersion: 1,
  revision: 0,
  records: [],
  references: [],
  mediaReferences: [],
}]))

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-backup-concurrency-'))

try {
  const profileDir = path.join(root, 'profile')
  const first = await createIsolatedProfileRestoreTarget({ profileDir, initialDomains })
  const second = await createIsolatedProfileRestoreTarget({ profileDir })

  const journalResults = await Promise.allSettled(Array.from({ length: 50 }, (_, index) => (
    (index % 2 ? second : first).writeJournal({
      restoreId: `concurrent-${index}`,
      status: 'started',
      appliedDomains: [],
    })
  )))
  assert.equal(journalResults.filter((result) => result.status === 'fulfilled').length, 50)
  assert.equal(journalResults.filter((result) => result.status === 'rejected').length, 0)

  await first.writeJournal({ restoreId: 'completed-entry', status: 'completed', appliedDomains: ['workflow'] })
  await second.writeJournal({ restoreId: 'completed-entry', status: 'started', appliedDomains: [] })

  const journal = JSON.parse(await readFile(first.journalPath, 'utf8'))
  assert.equal(Object.keys(journal.entries).length, 51)
  assert.equal(journal.revision, 52)
  assert.equal(journal.entries['completed-entry'].status, 'completed')
  assert.equal(journal.checksum, checksum(journal, ['schemaVersion', 'revision', 'entries']))

  const rollbackResults = await Promise.allSettled(Array.from({ length: 50 }, (_, index) => (
    first.rollbackStore.write({
      restoreId: `rollback-${index}`,
      artifact: { artifactChecksum: `sha256:rollback-${index}` },
      createdAt: new Date().toISOString(),
    })
  )))
  assert.equal(rollbackResults.filter((result) => result.status === 'fulfilled').length, 50)
  assert.equal((await readdir(first.rollbackDir)).length, 50)

  const quarantineResults = await Promise.allSettled(Array.from({ length: 50 }, (_, index) => (
    first.quarantine.write({
      restoreId: `quarantine-${index}`,
      kind: 'fault-injection',
      reason: 'synthetic-rename-contention',
    })
  )))
  assert.equal(quarantineResults.filter((result) => result.status === 'fulfilled').length, 50)
  assert.equal((await readdir(first.quarantineDir)).length, 50)

  const txA = await first.beginTransaction({ restoreId: 'transaction-a' })
  const txB = await second.beginTransaction({ restoreId: 'transaction-b' })
  await txA.applyDomain('workflow', domainWithRecord('writer-a'))
  await txB.applyDomain('workflow', domainWithRecord('writer-b'))
  const commitResults = await Promise.allSettled([txA.commit(), txB.commit()])
  assert.equal(commitResults.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(commitResults.filter((result) => result.status === 'rejected').length, 1)
  assert.equal(commitResults.find((result) => result.status === 'rejected').reason.code, 'RESTORE_REVISION_CONFLICT')

  const state = await first.readState()
  assert.equal(state.revision, 1)
  assert.ok(['writer-a', 'writer-b'].includes(state.domains.workflow.records[0]?.id))
  assert.equal(state.checksum, checksum(state, ['schemaVersion', 'revision', 'domains']))

  const sourceAdapters = Object.fromEntries(requiredDomains.map((key) => [key, {
    key,
    schemaVersion: 1,
    adapterVersion: 1,
    revision: 1,
    async collect() {
      return {
        schemaVersion: 1,
        revision: 1,
        records: [{
          id: `${key}-source-record`,
          schemaVersion: 1,
          revision: 1,
          contentId: `${key}-source-content`,
          payload: { value: `${key}-source` },
          references: [],
          mediaReferences: [],
        }],
      }
    },
  }]))
  const publicService = createApplicationBackupService({ adapters: sourceAdapters })
  const publicArtifact = await publicService.createBackup()
  const publicRestoreProfile = path.join(root, 'public-restore-profile')
  const publicFirst = await createIsolatedProfileRestoreTarget({ profileDir: publicRestoreProfile, initialDomains })
  const publicSecond = await createIsolatedProfileRestoreTarget({ profileDir: publicRestoreProfile })
  let begun = 0
  let releaseTransactions
  const transactionBarrier = new Promise((resolve) => { releaseTransactions = resolve })
  for (const target of [publicFirst, publicSecond]) {
    const originalBegin = target.beginTransaction.bind(target)
    target.beginTransaction = async (options) => {
      const transaction = await originalBegin(options)
      begun += 1
      if (begun === 2) releaseTransactions()
      await transactionBarrier
      return transaction
    }
  }
  const publicRestoreResults = await Promise.allSettled([
    publicService.restore(publicArtifact, { target: publicFirst, restoreId: 'public-restore-a' }),
    publicService.restore(publicArtifact, { target: publicSecond, restoreId: 'public-restore-b' }),
  ])
  assert.equal(publicRestoreResults.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(publicRestoreResults.filter((result) => result.status === 'rejected').length, 1)
  assert.equal(publicRestoreResults.find((result) => result.status === 'rejected').reason.code, 'RESTORE_REVISION_CONFLICT')
  const publicRestoredState = await publicFirst.readState()
  assert.equal(publicRestoredState.revision, 1)
  assert.equal(publicRestoredState.checksum, checksum(publicRestoredState, ['schemaVersion', 'revision', 'domains']))
  const publicJournal = JSON.parse(await readFile(publicFirst.journalPath, 'utf8'))
  assert.equal(Object.keys(publicJournal.entries).length, 2)
  assert.equal(publicJournal.checksum, checksum(publicJournal, ['schemaVersion', 'revision', 'entries']))

  const interruptedController = new AbortController()
  interruptedController.abort()
  const interrupted = await second.beginTransaction({ restoreId: 'interrupted', signal: interruptedController.signal })
  await assert.rejects(interrupted.commit(), { code: 'RESTORE_INTERRUPTED' })
  const afterInterruption = await first.readState()
  assert.deepEqual(afterInterruption, state)

  const restarted = await createIsolatedProfileRestoreTarget({ profileDir })
  assert.equal((await restarted.readJournal({ restoreId: 'concurrent-49' })).status, 'started')
  assert.deepEqual(await restarted.readState(), state)

  console.log('Application backup concurrency checks passed.')
} finally {
  await rm(root, { recursive: true, force: true })
}

function domainWithRecord(id) {
  return {
    schemaVersion: 1,
    adapterVersion: 1,
    revision: 1,
    records: [{
      id,
      schemaVersion: 1,
      revision: 1,
      contentId: id,
      payload: { value: id },
      references: [],
      mediaReferences: [],
    }],
    references: [],
    mediaReferences: [],
  }
}

function canonicalJson(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function checksum(value, fields) {
  const core = Object.fromEntries(fields.map((key) => [key, value[key]]))
  return `sha256:${createHash('sha256').update(canonicalJson(core)).digest('hex')}`
}
