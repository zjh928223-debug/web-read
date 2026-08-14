import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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

// TDD RED evidence captured before the cross-process lock: the old
// in-process PATH_MUTEXES implementation ran this same two-process barrier
// workload to 87/96 journal entries (AssertionError: 87 !== 96). Keep the
// barrier and exact-count assertions as the regression proof.

if (process.argv[2] === '--child-worker') {
  await runChildWorker({
    workerId: process.argv[3],
    profileDir: process.argv[4],
    barrierDir: process.argv[5],
    rounds: Number(process.argv[6] || 12),
    writesPerRound: Number(process.argv[7] || 4),
    resultPath: process.argv[8],
  })
  process.exit(0)
}

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-backup-concurrency-'))

try {
  await runCrossProcessConcurrency(root)

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

  await runRollbackTimingChecks({ root, sourceService: publicService, artifact: publicArtifact })

  const interruptedController = new AbortController()
  interruptedController.abort()
  const interrupted = await second.beginTransaction({ restoreId: 'interrupted', signal: interruptedController.signal })
  await assert.rejects(interrupted.commit(), { code: 'RESTORE_INTERRUPTED' })
  const afterInterruption = await first.readState()
  assert.deepEqual(afterInterruption, state)

  const restarted = await createIsolatedProfileRestoreTarget({ profileDir })
  assert.equal((await restarted.readJournal({ restoreId: 'concurrent-49' })).status, 'started')
  assert.deepEqual(await restarted.readState(), state)

  console.log('Application backup concurrency checks passed (child-process barrier; old PATH_MUTEXES RED baseline was 87/96).')
} finally {
  await rm(root, { recursive: true, force: true })
}

async function runRollbackTimingChecks({ root, sourceService, artifact }) {
  const preBeginProfile = path.join(root, 'rollback-pre-begin-profile')
  const preBeginTarget = await createIsolatedProfileRestoreTarget({ profileDir: preBeginProfile, initialDomains })
  const preBeginWriter = await createIsolatedProfileRestoreTarget({ profileDir: preBeginProfile })
  const originalBegin = preBeginTarget.beginTransaction.bind(preBeginTarget)
  preBeginTarget.beginTransaction = async (options) => {
    const writerTransaction = await preBeginWriter.beginTransaction({ restoreId: 'concurrent-pre-begin-writer' })
    await writerTransaction.applyDomain('workflow', domainWithRecord('concurrent-pre-begin-writer'))
    await writerTransaction.commit()
    return originalBegin(options)
  }
  await assert.rejects(
    sourceService.restore(artifact, { target: preBeginTarget, restoreId: 'rollback-pre-begin' }),
    { code: 'RESTORE_REVISION_CONFLICT' },
  )
  const preBeginState = await preBeginTarget.readState()
  assert.equal(preBeginState.revision, 1)
  assert.equal(preBeginState.domains.workflow.records[0].id, 'concurrent-pre-begin-writer')
  const preBeginJournal = JSON.parse(await readFile(preBeginTarget.journalPath, 'utf8'))
  assert.equal(preBeginJournal.entries['rollback-pre-begin'].status, 'rolled-back')
  assert.equal(preBeginJournal.entries['rollback-pre-begin'].failureCode, 'RESTORE_REVISION_CONFLICT')
  assert.equal(Object.hasOwn(preBeginJournal.entries['rollback-pre-begin'], 'rollbackRevision'), false)

  const postCommitProfile = path.join(root, 'rollback-post-commit-profile')
  const postCommitTarget = await createIsolatedProfileRestoreTarget({ profileDir: postCommitProfile, initialDomains })
  const postCommitWriter = await createIsolatedProfileRestoreTarget({ profileDir: postCommitProfile })
  const postCommitBegin = postCommitTarget.beginTransaction.bind(postCommitTarget)
  postCommitTarget.beginTransaction = async (options) => {
    const transaction = await postCommitBegin(options)
    const originalCommit = transaction.commit.bind(transaction)
    transaction.commit = async () => {
      const result = await originalCommit()
      const writerTransaction = await postCommitWriter.beginTransaction({ restoreId: 'concurrent-post-commit-writer' })
      await writerTransaction.applyDomain('workflow', domainWithRecord('concurrent-post-commit-writer'))
      await writerTransaction.commit()
      const error = new Error('synthetic write-then-fail after concurrent commit')
      error.code = 'RESTORE_COMMIT_FAILED'
      error.committedRevision = transaction.committedRevision
      throw error
    }
    return transaction
  }
  await assert.rejects(
    sourceService.restore(artifact, { target: postCommitTarget, restoreId: 'rollback-post-commit' }),
    { code: 'RESTORE_REVISION_CONFLICT' },
  )
  const postCommitState = await postCommitTarget.readState()
  assert.equal(postCommitState.revision, 2)
  assert.equal(postCommitState.domains.workflow.records[0].id, 'concurrent-post-commit-writer')
  const postCommitJournal = JSON.parse(await readFile(postCommitTarget.journalPath, 'utf8'))
  const postCommitEntry = postCommitJournal.entries['rollback-post-commit']
  assert.equal(postCommitEntry.status, 'rollback-failed')
  assert.equal(postCommitEntry.failureCode, 'RESTORE_COMMIT_FAILED')
  assert.equal(postCommitEntry.committedRevision, 1)
  assert.equal(postCommitEntry.rollbackComplete, false)
  assert.equal(Object.hasOwn(postCommitEntry, 'rollbackRevision'), false)
  assert.equal(postCommitJournal.checksum, checksum(postCommitJournal, ['schemaVersion', 'revision', 'entries']))
}

async function runCrossProcessConcurrency(root) {
  const profileDir = path.join(root, 'cross-process-profile')
  const barrierDir = path.join(root, 'cross-process-barriers')
  await mkdir(barrierDir, { recursive: true })
  const initialTarget = await createIsolatedProfileRestoreTarget({ profileDir, initialDomains })
  const rounds = 12
  const writesPerRound = 4
  const workers = ['alpha', 'beta'].map((workerId) => {
    const resultPath = path.join(barrierDir, `result-${workerId}.json`)
    return spawnWorker({ workerId, profileDir, barrierDir, rounds, writesPerRound, resultPath })
  })
  const results = await Promise.all(workers)
  for (const result of results) {
    assert.equal(result.code, 0, `child process ${result.workerId} failed: ${result.stderr || result.stdout}`)
  }

  const target = await createIsolatedProfileRestoreTarget({ profileDir })
  const journal = JSON.parse(await readFile(target.journalPath, 'utf8'))
  assert.equal(Object.keys(journal.entries).length, rounds * writesPerRound * 2)
  assert.equal(journal.revision, rounds * writesPerRound * 2)
  for (const workerId of ['alpha', 'beta']) {
    for (let round = 0; round < rounds; round += 1) {
      for (let write = 0; write < writesPerRound; write += 1) {
        assert.equal(journal.entries[`cross-process-${workerId}-${round}-${write}`].status, 'started')
      }
    }
  }
  assert.equal(journal.checksum, checksum(journal, ['schemaVersion', 'revision', 'entries']))
  await runPathLockSafetyChecks({ profileDir, target: initialTarget })

  const commitResults = results.map((result) => JSON.parse(result.result))
  assert.equal(commitResults.filter((result) => result.commitCode === 'fulfilled').length, 1)
  assert.equal(commitResults.filter((result) => result.commitCode === 'RESTORE_REVISION_CONFLICT').length, 1)
  const state = await target.readState()
  assert.equal(state.revision, 1)
  assert.ok(['cross-process-alpha', 'cross-process-beta'].includes(state.domains.workflow.records[0]?.id))
  assert.equal(state.checksum, checksum(state, ['schemaVersion', 'revision', 'domains']))
}

async function runPathLockSafetyChecks({ profileDir, target }) {
  const lockBase = path.resolve(profileDir)
  const lockPath = `${process.platform === 'win32' ? lockBase.toLowerCase() : lockBase}.read-web-path.lock`
  const ownerPath = path.join(lockPath, 'owner.json')
  const oldHeartbeat = new Date(Date.now() - 10_000).toISOString()
  const previousTimeout = process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
  const previousStaleAfter = process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS
  try {
    process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = '100'
    process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS = '1000'
    await mkdir(lockPath, { recursive: true })
    await writeFile(ownerPath, `${JSON.stringify({
      schemaVersion: 1,
      ownerToken: 'active-owner-token',
      pid: process.pid,
      acquiredAt: oldHeartbeat,
      heartbeatAt: oldHeartbeat,
    })}\n`, 'utf8')
    await assert.rejects(
      target.writeJournal({ restoreId: 'active-lock-must-survive', status: 'started', appliedDomains: [] }),
      { code: 'BACKUP_PATH_LOCK_TIMEOUT' },
    )
    assert.equal(JSON.parse(await readFile(ownerPath, 'utf8')).ownerToken, 'active-owner-token')

    await rm(lockPath, { recursive: true, force: true })
    await mkdir(lockPath, { recursive: true })
    await writeFile(ownerPath, `${JSON.stringify({
      schemaVersion: 1,
      ownerToken: 'dead-owner-token',
      pid: Number.MAX_SAFE_INTEGER,
      acquiredAt: oldHeartbeat,
      heartbeatAt: oldHeartbeat,
    })}\n`, 'utf8')
    await target.writeJournal({ restoreId: 'stale-lock-must-recover', status: 'started', appliedDomains: [] })
  } finally {
    await rm(lockPath, { recursive: true, force: true })
    if (previousTimeout === undefined) delete process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
    else process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = previousTimeout
    if (previousStaleAfter === undefined) delete process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS
    else process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS = previousStaleAfter
  }
}

function spawnWorker({ workerId, profileDir, barrierDir, rounds, writesPerRound, resultPath }) {
  const scriptPath = fileURLToPath(import.meta.url)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      scriptPath,
      '--child-worker',
      workerId,
      profileDir,
      barrierDir,
      String(rounds),
      String(writesPerRound),
      resultPath,
    ], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const timeout = setTimeout(() => child.kill(), 30_000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', async (code, signal) => {
      clearTimeout(timeout)
      const result = await readFile(resultPath, 'utf8').catch(() => '')
      resolve({ workerId, code: code ?? 1, signal, stdout, stderr, result })
    })
  })
}

async function runChildWorker({ workerId, profileDir, barrierDir, rounds, writesPerRound, resultPath }) {
  const target = await createIsolatedProfileRestoreTarget({ profileDir })
  for (let round = 0; round < rounds; round += 1) {
    await barrier(barrierDir, `journal-${round}`, workerId)
    await Promise.all(Array.from({ length: writesPerRound }, (_, write) => target.writeJournal({
      restoreId: `cross-process-${workerId}-${round}-${write}`,
      status: 'started',
      appliedDomains: [],
    })))
    await barrier(barrierDir, `journal-done-${round}`, workerId)
  }

  const transaction = await target.beginTransaction({ restoreId: `cross-process-${workerId}` })
  await barrier(barrierDir, 'transaction-begun', workerId)
  await transaction.applyDomain('workflow', domainWithRecord(`cross-process-${workerId}`))
  let commitCode = 'fulfilled'
  try {
    await transaction.commit()
  } catch (error) {
    commitCode = error?.code || 'UNKNOWN_COMMIT_ERROR'
  }
  await writeFile(resultPath, `${JSON.stringify({ workerId, commitCode })}\n`, 'utf8')
}

async function barrier(root, name, workerId) {
  await mkdir(path.join(root, `${name}-${workerId}`), { recursive: false }).catch((error) => {
    if (error?.code !== 'EEXIST') throw error
  })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const entries = await readdir(root)
    if (entries.filter((entry) => entry.startsWith(`${name}-`)).length >= 2) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`barrier timed out: ${name}`)
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
