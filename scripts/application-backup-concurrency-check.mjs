import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createIsolatedProfileRestoreTarget, loadBackupModules } from './lib/read-web-production-backup.mjs'

const { applicationBackup } = await loadBackupModules()
const { createApplicationBackupService } = applicationBackup

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

if (process.argv[2] === '--crash-after-state-write') {
  await runCrashAfterStateWriteWorker({
    profileDir: process.argv[3],
    barrierDir: process.argv[4],
    artifactPath: process.argv[5],
  })
  process.exit(0)
}

if (process.argv[2] === '--retry-crashed-restore') {
  await runRetryCrashedRestoreWorker({
    profileDir: process.argv[3],
    artifactPath: process.argv[4],
    resultPath: process.argv[5],
  })
  process.exit(0)
}

if (process.argv[2] === '--journal-crash-only') {
  const crashRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-journal-crash-red-'))
  try {
    const crashService = createApplicationBackupService({ adapters: createSourceAdapters() })
    await runJournalCrashRecovery({ root: crashRoot, artifact: await crashService.createBackup() })
  } finally {
    await rm(crashRoot, { recursive: true, force: true })
  }
  process.exit(0)
}

if (process.argv[2] === '--claim-crash-worker') {
  const target = await createIsolatedProfileRestoreTarget({ profileDir: process.argv[3] })
  await target.writeJournal({ restoreId: 'claim-crash-worker', status: 'started', appliedDomains: [] })
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
  if (journalResults.some((result) => result.status === 'rejected')) {
    console.error(journalResults.map((result, index) => result.status === 'rejected'
      ? { index, code: result.reason?.code, message: result.reason?.message }
      : null).filter(Boolean))
  }
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
  if (rollbackResults.some((result) => result.status === 'rejected')) {
    console.error(rollbackResults.map((result, index) => result.status === 'rejected'
      ? { index, code: result.reason?.code, message: result.reason?.message }
      : null).filter(Boolean))
  }
  assert.equal(rollbackResults.filter((result) => result.status === 'fulfilled').length, 50)
  assert.equal((await readdir(first.rollbackDir)).length, 50)

  const quarantineResults = await Promise.allSettled(Array.from({ length: 50 }, (_, index) => (
    first.quarantine.write({
      restoreId: `quarantine-${index}`,
      kind: 'fault-injection',
      reason: 'synthetic-rename-contention',
    })
  )))
  if (quarantineResults.some((result) => result.status === 'rejected')) {
    console.error(quarantineResults.map((result, index) => result.status === 'rejected'
      ? { index, code: result.reason?.code, message: result.reason?.message }
      : null).filter(Boolean))
  }
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
  await runJournalCrashRecovery({ root, artifact: publicArtifact })

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

async function runJournalCrashRecovery({ root, artifact }) {
  // TDD RED evidence: before committing-state recovery, the killed writer
  // left journal status=committing and a retry returned
  // RESTORE_REVISION_CONFLICT at base revision 0/current revision 1.
  const profileDir = path.join(root, 'journal-crash-profile')
  const barrierDir = path.join(root, 'journal-crash-barrier')
  const artifactPath = path.join(root, 'journal-crash-artifact.json')
  const resultPath = path.join(root, 'journal-crash-retry-result.json')
  await mkdir(barrierDir, { recursive: true })
  await writeFile(artifactPath, `${JSON.stringify(artifact)}\n`, 'utf8')
  await createIsolatedProfileRestoreTarget({ profileDir, initialDomains })
  const crash = spawnCrashWorker({
    mode: '--crash-after-state-write',
    args: [profileDir, barrierDir, artifactPath],
    env: { READ_WEB_BACKUP_LOCK_STALE_AFTER_MS: '1000', READ_WEB_BACKUP_LOCK_TIMEOUT_MS: '5000' },
  })
  await waitForPath(path.join(barrierDir, 'state-written.json'))
  crash.kill()
  const crashResult = await crash.done
  assert.notEqual(crashResult.code, 0, 'the crash worker must be terminated after state replacement')
  await new Promise((resolve) => setTimeout(resolve, 1_200))

  const retry = spawnCrashWorker({
    mode: '--retry-crashed-restore',
    args: [profileDir, artifactPath, resultPath],
    env: { READ_WEB_BACKUP_LOCK_STALE_AFTER_MS: '1000', READ_WEB_BACKUP_LOCK_TIMEOUT_MS: '5000' },
  })
  const retryResult = await retry.done
  assert.equal(retryResult.code, 0, retryResult.stderr || retryResult.stdout)
  const retryReport = JSON.parse(await readFile(resultPath, 'utf8'))
  assert.equal(retryReport.status, 'completed', `crash-gap retry failed: ${JSON.stringify(retryReport)}`)
  const target = await createIsolatedProfileRestoreTarget({ profileDir })
  const state = await target.readState()
  assert.equal(state.revision, 1, 'crash-gap recovery must not rewrite the already committed state')
  assert.equal(state.checksum, checksum(state, ['schemaVersion', 'revision', 'domains']))
  const journal = JSON.parse(await readFile(target.journalPath, 'utf8'))
  assert.equal(journal.entries['journal-crash-restore'].status, 'completed')
  assert.equal(journal.entries['journal-crash-restore'].committedRevision, 1)
  assert.equal(journal.checksum, checksum(journal, ['schemaVersion', 'revision', 'entries']))
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
  await runPathLockClaimCrashCheck(root)

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
  const oldDate = new Date(Date.now() - 10_000)
  const previousTimeout = process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
  const previousStaleAfter = process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS
  try {
    process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = '100'
    process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS = '1000'
    await mkdir(lockPath, { recursive: true })
    await utimes(lockPath, oldDate, oldDate)
    await target.writeJournal({ restoreId: 'empty-lockdir-must-recover', status: 'started', appliedDomains: [] })

    await rm(lockPath, { recursive: true, force: true })
    await mkdir(lockPath, { recursive: true })
    const partialOwnerPath = path.join(lockPath, 'owner.json.tmp-crashed')
    await writeFile(partialOwnerPath, '{"schemaVersion":1,"ownerToken":"partial', 'utf8')
    await utimes(lockPath, oldDate, oldDate)
    await utimes(partialOwnerPath, oldDate, oldDate)
    await target.writeJournal({ restoreId: 'partial-owner-must-recover', status: 'started', appliedDomains: [] })

    await rm(lockPath, { recursive: true, force: true })
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

    await rm(target.quarantineDir, { recursive: true, force: true })
    await writeFile(target.quarantineDir, 'not-a-directory', 'utf8')
    const operationFailureStartedAt = Date.now()
    await assert.rejects(
      target.quarantine.write({ restoreId: 'operation-error', kind: 'fault-injection' }),
      (error) => error?.code !== 'BACKUP_PATH_LOCK_TIMEOUT',
    )
    assert.ok(Date.now() - operationFailureStartedAt < 1_000, 'operation filesystem errors must not be retried as lock contention')
    await rm(target.quarantineDir, { force: true })
    await mkdir(target.quarantineDir, { recursive: true })
  } finally {
    await rm(lockPath, { recursive: true, force: true })
    if (previousTimeout === undefined) delete process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
    else process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = previousTimeout
    if (previousStaleAfter === undefined) delete process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS
    else process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS = previousStaleAfter
  }
}

async function runPathLockClaimCrashCheck(root) {
  const profileDir = path.join(root, 'claim-crash-profile')
  const barrierDir = path.join(root, 'claim-crash-barrier')
  await mkdir(barrierDir, { recursive: true })
  await createIsolatedProfileRestoreTarget({ profileDir, initialDomains })
  const crash = spawnCrashWorker({
    mode: '--claim-crash-worker',
    args: [profileDir],
    env: {
      READ_WEB_BACKUP_LOCK_STALE_AFTER_MS: '1000',
      READ_WEB_BACKUP_LOCK_TIMEOUT_MS: '5000',
      READ_WEB_BACKUP_LOCK_CLAIM_BARRIER_DIR: barrierDir,
      READ_WEB_BACKUP_TEST_MODE: '1',
      READ_WEB_BACKUP_LOCK_CLAIM_BARRIER_TIMEOUT_MS: '5000',
    },
  })
  await waitForPath(path.join(barrierDir, 'claim-ready.json'))
  crash.kill()
  const result = await crash.done
  assert.notEqual(result.code, 0, 'claim crash worker must be terminated before canonical lock rename')
  await new Promise((resolve) => setTimeout(resolve, 1_200))
  const target = await createIsolatedProfileRestoreTarget({ profileDir })
  await target.writeJournal({ restoreId: 'claim-crash-recovered', status: 'started', appliedDomains: [] })
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

function spawnCrashWorker({ mode, args, env = {} }) {
  const scriptPath = fileURLToPath(import.meta.url)
  const child = spawn(process.execPath, [scriptPath, mode, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal, stdout, stderr }))
  })
  return { child, done, kill: () => child.kill() }
}

async function runCrashAfterStateWriteWorker({ profileDir, barrierDir, artifactPath }) {
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'))
  const service = createApplicationBackupService({ adapters: createSourceAdapters() })
  const target = await createIsolatedProfileRestoreTarget({
    profileDir,
    faults: { commit: 'write-then-block', commitBarrierDir: barrierDir },
  })
  await service.restore(artifact, {
    target,
    restoreId: 'journal-crash-restore',
    resolutions: Object.fromEntries(requiredDomains.map((key) => [key, 'restore'])),
  })
}

async function runRetryCrashedRestoreWorker({ profileDir, artifactPath, resultPath }) {
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'))
  const service = createApplicationBackupService({ adapters: createSourceAdapters() })
  const target = await createIsolatedProfileRestoreTarget({ profileDir })
  try {
    const report = await service.restore(artifact, {
      target,
      restoreId: 'journal-crash-restore',
      resolutions: Object.fromEntries(requiredDomains.map((key) => [key, 'restore'])),
    })
    await writeFile(resultPath, `${JSON.stringify(report)}\n`, 'utf8')
  } catch (error) {
    await writeFile(resultPath, `${JSON.stringify({ errorCode: error?.code, message: error?.message })}\n`, 'utf8')
  }
}

function createSourceAdapters() {
  return Object.fromEntries(requiredDomains.map((key) => [key, {
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
}

async function waitForPath(filePath) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await readFile(filePath, 'utf8')
      return
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${filePath}`)
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
