import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {
  OWNER_PENDING_JOURNAL_FILE,
  OWNER_PROFILE_DOMAINS,
  calculateOwnerPendingJournalChecksum,
  createOwnerPendingProfileIdentity,
  createReadWebProductionBackupComposition,
  readOwnerPendingJournal,
  recoverOwnerPendingJournal,
  runOwnerPendingJournalOperation,
  withReadWebApplicationProfileLease,
  writeIsolatedBrowserProfile,
} from './lib/read-web-production-backup.mjs'

const SCRIPT_PATH = path.resolve(process.argv[1])

function canonicalJson(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForFile(filePath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await stat(filePath)
      return
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await delay(20)
  }
  throw new Error(`Timed out waiting for ${filePath}`)
}

async function waitForInput() {
  if (process.stdin.readableEnded || process.stdin.destroyed) return
  process.stdin.resume()
  await new Promise((resolve) => {
    const done = () => resolve()
    process.stdin.once('end', done)
    process.stdin.once('close', done)
  })
}

async function writeState(stateDir, domain, identity) {
  await writeFile(path.join(stateDir, `${domain}.json`), `${JSON.stringify(identity)}\n`, 'utf8')
}

async function readState(stateDir, domain) {
  return JSON.parse(await readFile(path.join(stateDir, `${domain}.json`), 'utf8'))
}

async function appendEvent(eventsPath, event) {
  await appendFile(eventsPath, `${JSON.stringify(event)}\n`, 'utf8')
}

function createFileAdapters(stateDir, eventsPath) {
  return Object.fromEntries(OWNER_PROFILE_DOMAINS.map((domain) => [domain, {
    async read() {
      return readState(stateDir, domain)
    },
    async prepare({ domain: preparedDomain }) {
      await appendEvent(eventsPath, { kind: 'prepare', domain: preparedDomain })
      return { source: `journal-fixture-prepare-${preparedDomain}` }
    },
    async commit({ domain: committedDomain, staged }) {
      await writeState(stateDir, committedDomain, staged)
      await appendEvent(eventsPath, { kind: 'commit', domain: committedDomain, revision: staged.revision })
      return { source: `journal-fixture-commit-${committedDomain}` }
    },
    async restore({ domain: restoredDomain, target }) {
      await writeState(stateDir, restoredDomain, target)
      await appendEvent(eventsPath, { kind: 'restore', domain: restoredDomain, revision: target.revision })
      return { identity: target }
    },
  }]))
}

function createFixtureProfiles() {
  const makeDomains = (revision) => Object.fromEntries(OWNER_PROFILE_DOMAINS.map((domain, index) => [
    domain,
    {
      revision,
      checksum: `sha256:${createHash('sha256').update(`journal-fixture:${revision}:${index}:${domain}`).digest('hex')}`,
    },
  ]))
  return {
    baseline: createOwnerPendingProfileIdentity({ profileRevision: 10, domains: makeDomains(10) }),
    staged: createOwnerPendingProfileIdentity({ profileRevision: 11, domains: makeDomains(11) }),
  }
}

async function createFixture(root, name, profileId = `journal-${name}`) {
  const instanceRoot = path.join(root, `${name}-instance`)
  const profileDir = path.join(instanceRoot, 'profile')
  const stateDir = path.join(instanceRoot, 'domain-state')
  const eventsPath = path.join(instanceRoot, 'events.jsonl')
  const profileAuthorityIsolationRoot = path.join(root, `${name}-authority`)
  const profileAuthorityRoot = path.join(profileAuthorityIsolationRoot, 'profiles', profileId)
  await Promise.all([
    mkdir(profileDir, { recursive: true }),
    mkdir(stateDir, { recursive: true }),
    mkdir(profileAuthorityRoot, { recursive: true }),
  ])
  await writeFile(eventsPath, '', 'utf8')
  return {
    name,
    stateDir,
    eventsPath,
    journalPath: path.join(profileAuthorityRoot, OWNER_PENDING_JOURNAL_FILE),
    options: {
      isolationRoot: instanceRoot,
      profileDir,
      profileAuthorityIsolationRoot,
      profileAuthorityRoot,
      profileId,
      releaseId: `release-${name}`,
      instanceId: `instance-${name}`,
    },
  }
}

async function initializeFixture(fixture, profiles) {
  await Promise.all(OWNER_PROFILE_DOMAINS.map((domain) => writeState(
    fixture.stateDir,
    domain,
    profiles.baseline.domains[domain],
  )))
}

async function readEvents(fixture) {
  const raw = await readFile(fixture.eventsPath, 'utf8')
  return raw.trim() ? raw.trim().split('\n').map((line) => JSON.parse(line)) : []
}

async function assertProfileState(fixture, profile) {
  for (const domain of OWNER_PROFILE_DOMAINS) {
    assert.deepEqual(await readState(fixture.stateDir, domain), profile.domains[domain])
  }
}

async function runWorker(mode, payload) {
  const options = payload.options
  const adapters = createFileAdapters(payload.stateDir, payload.eventsPath)
  if (mode === 'run') {
    return runOwnerPendingJournalOperation({
      ...options,
      adapters,
      baseline: payload.baseline,
      staged: payload.staged,
      operationKind: 'restore',
      faults: payload.faults,
    })
  }
  if (mode === 'recover') {
    return recoverOwnerPendingJournal({
      ...options,
      adapters,
    })
  }
  if (mode === 'hold') {
    return withReadWebApplicationProfileLease(options, async ({ profileLease }) => {
      await writeFile(payload.readyPath, `${JSON.stringify(profileLease)}\n`, 'utf8')
      await waitForInput()
      return { status: 'released' }
    })
  }
  throw new Error(`Unknown journal fixture worker mode: ${mode}`)
}

if (process.argv[2] === '--worker') {
  const mode = process.argv[3]
  const payload = JSON.parse(process.argv[4] || '{}')
  try {
    const result = await runWorker(mode, payload)
    if (payload.resultPath) await writeFile(payload.resultPath, `${JSON.stringify({ status: 'ok', result })}\n`, 'utf8')
  } catch (error) {
    if (payload.resultPath) {
      await writeFile(payload.resultPath, `${JSON.stringify({
        status: 'error',
        code: error?.code || null,
        message: error?.message || String(error),
      })}\n`, 'utf8')
    }
  }
  process.exit(0)
}

function spawnWorker(mode, payload, { timeoutMs = 5_000 } = {}) {
  const child = spawn(process.execPath, [SCRIPT_PATH, '--worker', mode, JSON.stringify(payload)], {
    cwd: path.resolve(path.dirname(SCRIPT_PATH), '..'),
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'pipe'],
    env: {
      ...process.env,
      READ_WEB_BACKUP_LOCK_TIMEOUT_MS: String(timeoutMs),
      READ_WEB_BACKUP_LOCK_STALE_AFTER_MS: '1000',
    },
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  return {
    child,
    stderr: () => stderr,
    wait: new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    }),
  }
}

async function readWorkerResult(resultPath) {
  await waitForFile(resultPath)
  return JSON.parse(await readFile(resultPath, 'utf8'))
}

async function runDirect(fixture, profiles, faults = {}) {
  return runOwnerPendingJournalOperation({
    ...fixture.options,
    adapters: createFileAdapters(fixture.stateDir, fixture.eventsPath),
    baseline: profiles.baseline,
    staged: profiles.staged,
    operationKind: 'restore',
    faults,
  })
}

async function recoverDirect(fixture) {
  return recoverOwnerPendingJournal({
    ...fixture.options,
    adapters: createFileAdapters(fixture.stateDir, fixture.eventsPath),
  })
}

async function readRawJournal(fixture) {
  return JSON.parse(await readFile(fixture.journalPath, 'utf8'))
}

async function rewriteRawJournal(fixture, mutate) {
  const next = mutate(JSON.parse(JSON.stringify(await readRawJournal(fixture))))
  next.checksum = calculateOwnerPendingJournalChecksum(next)
  await writeFile(fixture.journalPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

async function createCrashedFixture(root, name, profiles, faults) {
  const fixture = await createFixture(root, name)
  await initializeFixture(fixture, profiles)
  const resultPath = path.join(root, `${name}-worker-result.json`)
  const worker = spawnWorker('run', {
    options: fixture.options,
    stateDir: fixture.stateDir,
    eventsPath: fixture.eventsPath,
    baseline: profiles.baseline,
    staged: profiles.staged,
    faults,
    resultPath,
  })
  const exit = await worker.wait
  assert.ok(exit.signal || exit.code !== 0, `${name} must simulate process death (stderr=${worker.stderr()})`)
  await delay(1_200)
  return fixture
}

async function assertRecoveryAfterCrash(root, profiles, name, faults, expected) {
  const fixture = await createCrashedFixture(root, name, profiles, faults)
  const active = await readOwnerPendingJournal(fixture.options)
  assert.notEqual(active.status, 'finalized', `${name} must leave an unresolved journal before restart`)
  const recovered = await recoverDirect(fixture)
  assert.equal(recovered.status, 'finalized')
  assert.equal(recovered.decision, expected.decision)
  assert.equal(recovered.result, expected.result)
  assert.equal(recovered.ready, true)
  await assertProfileState(fixture, expected.profile)
  const repeated = await recoverDirect(fixture)
  assert.equal(repeated.status, 'finalized', `${name} recovery must be idempotent`)
  assert.equal(repeated.journalUpdated, false)
  await assertProfileState(fixture, expected.profile)
  return fixture
}

async function assertManualRecovery(fixture, expectedCode) {
  const result = await recoverDirect(fixture)
  assert.equal(result.status, 'manual-recovery')
  assert.equal(result.ready, false)
  assert.equal(result.decision, 'manual-recovery')
  assert.equal(result.result, 'blocked')
  if (expectedCode) assert.equal(result.reason.code, expectedCode)
  assert.equal(result.journalRetained, true)
  return result
}

const testRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-windows-owner-journal-2.4-'))
const profiles = createFixtureProfiles()
const previousTimeout = process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
const previousStaleAfter = process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS
process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = '5_000'
process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS = '1000'

const evidence = {
  schemaVersion: 1,
  command: 'node scripts/windows-local-owner-journal-check.mjs',
  scenarios: {},
}

try {
  const full = await createFixture(testRoot, 'full')
  await initializeFixture(full, profiles)
  const fullResult = await runDirect(full, profiles)
  assert.equal(fullResult.status, 'finalized')
  assert.equal(fullResult.decision, 'staged')
  assert.equal(fullResult.result, 'staged-committed')
  assert.equal(fullResult.ownerMode, 'pre-cutover')
  assert.equal(fullResult.ownerApiAuthoritative, false)
  const fullJournal = await readOwnerPendingJournal(full.options)
  assert.equal(fullJournal.status, 'finalized')
  assert.deepEqual(Object.keys(fullJournal.prepareEvidence), OWNER_PROFILE_DOMAINS)
  assert.deepEqual(Object.keys(fullJournal.commitEvidence), OWNER_PROFILE_DOMAINS)
  const fullEvents = await readEvents(full)
  assert.deepEqual(
    fullEvents.filter((event) => event.kind === 'prepare').map((event) => event.domain),
    OWNER_PROFILE_DOMAINS,
  )
  assert.deepEqual(
    fullEvents.filter((event) => event.kind === 'commit').map((event) => event.domain),
    OWNER_PROFILE_DOMAINS,
  )
  assert.ok(
    fullEvents.findIndex((event) => event.kind === 'commit')
      > fullEvents.map((event) => event.kind).lastIndexOf('prepare'),
    'the first domain commit must follow every prepare evidence record',
  )
  await assertProfileState(full, profiles.staged)
  evidence.scenarios.completePrepareThenOrderedCommit = {
    status: 'passed',
    journalChecksum: fullJournal.checksum,
    eventCount: fullEvents.length,
  }

  await assertRecoveryAfterCrash(testRoot, profiles, 'after-prepare', { crashAfterPrepare: true }, {
    decision: 'baseline',
    result: 'baseline-recovered',
    profile: profiles.baseline,
  })
  await assertRecoveryAfterCrash(testRoot, profiles, 'after-first-commit', { crashAfterCommitDomain: 1 }, {
    decision: 'baseline',
    result: 'baseline-recovered',
    profile: profiles.baseline,
  })
  await assertRecoveryAfterCrash(testRoot, profiles, 'after-middle-commit', { crashAfterCommitDomain: 3 }, {
    decision: 'baseline',
    result: 'baseline-recovered',
    profile: profiles.baseline,
  })
  await assertRecoveryAfterCrash(testRoot, profiles, 'after-last-commit', { crashAfterCommitDomain: 6 }, {
    decision: 'staged',
    result: 'staged-committed',
    profile: profiles.staged,
  })
  await assertRecoveryAfterCrash(testRoot, profiles, 'before-finalize', { crashBeforeFinalize: true }, {
    decision: 'staged',
    result: 'staged-committed',
    profile: profiles.staged,
  })
  evidence.scenarios.processDeathRecovery = {
    status: 'passed',
    phases: ['after-prepare', 'after-first-commit', 'after-middle-commit', 'after-last-commit', 'before-finalize'],
    decisionRule: 'complete-baseline-or-complete-staged-only',
  }

  const missingPrepare = await createCrashedFixture(testRoot, 'missing-prepare', profiles, { crashAfterPrepare: true })
  const missingPrepareRaw = await readFile(missingPrepare.journalPath, 'utf8')
  await rewriteRawJournal(missingPrepare, (journal) => {
    delete journal.prepareEvidence[OWNER_PROFILE_DOMAINS[0]]
    return journal
  })
  const missingPrepareResult = await assertManualRecovery(missingPrepare, 'OWNER_PENDING_JOURNAL_PREPARE_EVIDENCE_MISSING')
  assert.equal(await readFile(missingPrepare.journalPath, 'utf8') !== missingPrepareRaw, true)

  const unknownEvidence = await createCrashedFixture(testRoot, 'unknown-evidence', profiles, { crashAfterPrepare: true })
  const unknownEvidenceRaw = await readFile(unknownEvidence.journalPath, 'utf8')
  await rewriteRawJournal(unknownEvidence, (journal) => {
    journal.prepareEvidence['future-domain'] = journal.prepareEvidence.workflow
    return journal
  })
  const unknownEvidenceResult = await assertManualRecovery(unknownEvidence, 'OWNER_PENDING_JOURNAL_UNKNOWN_DOMAIN')
  assert.equal(await readFile(unknownEvidence.journalPath, 'utf8') !== unknownEvidenceRaw, true)

  const corrupt = await createCrashedFixture(testRoot, 'corrupt', profiles, { crashAfterPrepare: true })
  const corruptBytes = '{"schemaVersion":1,\n'
  await writeFile(corrupt.journalPath, corruptBytes, 'utf8')
  const corruptResult = await assertManualRecovery(corrupt, 'OWNER_PENDING_JOURNAL_CORRUPT')
  assert.equal(await readFile(corrupt.journalPath, 'utf8'), corruptBytes, 'corrupt journal bytes must be retained')

  const invalidCommit = await createCrashedFixture(testRoot, 'invalid-commit', profiles, { crashAfterCommitDomain: 1 })
  await rewriteRawJournal(invalidCommit, (journal) => {
    journal.commitEvidence[OWNER_PROFILE_DOMAINS[0]].checksum = `sha256:${'0'.repeat(64)}`
    return journal
  })
  const invalidCommitResult = await assertManualRecovery(invalidCommit, 'OWNER_PENDING_JOURNAL_COMMIT_EVIDENCE_INVALID')

  const missingCommit = await createCrashedFixture(testRoot, 'missing-commit', profiles, { crashAfterPrepare: true })
  await writeState(missingCommit.stateDir, OWNER_PROFILE_DOMAINS[0], profiles.staged.domains[OWNER_PROFILE_DOMAINS[0]])
  const missingCommitResult = await assertManualRecovery(missingCommit, 'OWNER_PENDING_JOURNAL_COMMIT_EVIDENCE_MISSING')
  assert.deepEqual(await readState(missingCommit.stateDir, OWNER_PROFILE_DOMAINS[0]), profiles.staged.domains[OWNER_PROFILE_DOMAINS[0]])

  const missingAdapter = await createCrashedFixture(testRoot, 'missing-adapter', profiles, { crashAfterPrepare: true })
  const missingAdapterResult = await recoverOwnerPendingJournal({ ...missingAdapter.options, adapters: {} })
  assert.equal(missingAdapterResult.status, 'manual-recovery')
  assert.equal(missingAdapterResult.reason.code, 'OWNER_PENDING_JOURNAL_ADAPTER_MISSING')

  const conflict = await createCrashedFixture(testRoot, 'conflict', profiles, { crashAfterPrepare: true })
  await writeState(conflict.stateDir, OWNER_PROFILE_DOMAINS[1], {
    revision: 99,
    checksum: `sha256:${'9'.repeat(64)}`,
  })
  const conflictResult = await assertManualRecovery(conflict, 'OWNER_PENDING_JOURNAL_REVISION_CONFLICT')
  evidence.scenarios.invalidEvidenceIsManualRecovery = {
    status: 'passed',
    cases: {
      missingPrepare: missingPrepareResult.reason.code,
      unknownDomain: unknownEvidenceResult.reason.code,
      corruptJournal: corruptResult.reason.code,
      invalidCommit: invalidCommitResult.reason.code,
      missingCommit: missingCommitResult.reason.code,
      missingRecoveryAdapter: missingAdapterResult.reason.code,
      conflictingRevision: conflictResult.reason.code,
    },
  }

  const atomicFailure = await createFixture(testRoot, 'atomic-failure')
  await initializeFixture(atomicFailure, profiles)
  await assert.rejects(
    runDirect(atomicFailure, profiles, { failWriteAt: 10 }),
    (error) => error?.code === 'OWNER_PENDING_JOURNAL_ATOMIC_WRITE_FAILED',
  )
  const atomicJournal = await readOwnerPendingJournal(atomicFailure.options)
  assert.equal(atomicJournal.status, 'committing')
  assert.deepEqual(Object.keys(atomicJournal.commitEvidence), [])
  assert.deepEqual(await readState(atomicFailure.stateDir, OWNER_PROFILE_DOMAINS[0]), profiles.staged.domains[OWNER_PROFILE_DOMAINS[0]])
  const atomicRecovery = await assertManualRecovery(atomicFailure, 'OWNER_PENDING_JOURNAL_COMMIT_EVIDENCE_MISSING')
  evidence.scenarios.atomicJournalWriteFailure = {
    status: 'passed',
    journalStatusBeforeRecovery: atomicJournal.status,
    recoveryReason: atomicRecovery.reason.code,
  }

  const concurrent = await createCrashedFixture(testRoot, 'concurrent-recovery', profiles, { crashAfterCommitDomain: 3 })
  const concurrentResultA = path.join(testRoot, 'concurrent-a.json')
  const concurrentResultB = path.join(testRoot, 'concurrent-b.json')
  const workerA = spawnWorker('recover', {
    options: concurrent.options,
    stateDir: concurrent.stateDir,
    eventsPath: concurrent.eventsPath,
    resultPath: concurrentResultA,
  }, { timeoutMs: 5_000 })
  const workerB = spawnWorker('recover', {
    options: concurrent.options,
    stateDir: concurrent.stateDir,
    eventsPath: concurrent.eventsPath,
    resultPath: concurrentResultB,
  }, { timeoutMs: 5_000 })
  const [exitA, exitB] = await Promise.all([workerA.wait, workerB.wait])
  assert.equal(exitA.code, 0, workerA.stderr())
  assert.equal(exitB.code, 0, workerB.stderr())
  const resultA = await readWorkerResult(concurrentResultA)
  const resultB = await readWorkerResult(concurrentResultB)
  assert.equal(resultA.status, 'ok')
  assert.equal(resultB.status, 'ok')
  assert.equal(resultA.result.status, 'finalized')
  assert.equal(resultB.result.status, 'finalized')
  await assertProfileState(concurrent, profiles.baseline)
  assert.equal((await readEvents(concurrent)).filter((event) => event.kind === 'restore').length, 3)
  evidence.scenarios.concurrentRecovery = {
    status: 'passed',
    stableLeaseSerializesRecoveries: true,
    results: [resultA.result.result, resultB.result.result],
  }

  const leaseFixture = await createFixture(testRoot, 'lease-contender')
  const holderReady = path.join(testRoot, 'lease-holder-ready.json')
  const holderResult = path.join(testRoot, 'lease-holder-result.json')
  const holder = spawnWorker('hold', {
    options: leaseFixture.options,
    stateDir: leaseFixture.stateDir,
    eventsPath: leaseFixture.eventsPath,
    readyPath: holderReady,
    resultPath: holderResult,
  }, { timeoutMs: 5_000 })
  await waitForFile(holderReady)
  const contenderTimeout = process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
  process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = '350'
  await assert.rejects(
    readOwnerPendingJournal(leaseFixture.options),
    (error) => error?.code === 'BACKUP_PATH_LOCK_TIMEOUT',
  )
  process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = contenderTimeout
  holder.child.stdin.end()
  const holderExit = await holder.wait
  assert.equal(holderExit.code, 0, holder.stderr())
  assert.equal((await readWorkerResult(holderResult)).status, 'ok')
  assert.equal(await readOwnerPendingJournal(leaseFixture.options), null)
  evidence.scenarios.profileLeaseRequired = {
    status: 'passed',
    crossProcessContender: 'BACKUP_PATH_LOCK_TIMEOUT',
    recoveryAuthority: 'stable-profile-lease-only',
  }

  const compositionFixture = await createCrashedFixture(testRoot, 'composition-pending', profiles, { crashAfterPrepare: true })
  await Promise.all([
    mkdir(path.join(compositionFixture.options.isolationRoot, 'python-state'), { recursive: true }),
    mkdir(path.join(compositionFixture.options.isolationRoot, 'python-output'), { recursive: true }),
  ])
  await writeIsolatedBrowserProfile(compositionFixture.options.profileDir, {
    localStorage: {},
    indexedDbRows: [],
  })
  const composition = await createReadWebProductionBackupComposition({
    ...compositionFixture.options,
    pythonStateDir: path.join(compositionFixture.options.isolationRoot, 'python-state'),
    pythonOutputDir: path.join(compositionFixture.options.isolationRoot, 'python-output'),
  })
  assert.equal(composition.ownerPendingRecovery.status, 'manual-recovery')
  assert.equal(composition.ownerPendingRecovery.ready, false)
  assert.equal(composition.ownerProfileEvidence.ready, false)
  assert.equal(composition.startupRecovery.status, 'not-run')
  assert.equal(composition.startupRecovery.reason, 'owner-pending-recovery-required')
  assert.equal(composition.ownerMode.status, 'pre-cutover')
  evidence.scenarios.recoveryBeforeHostReady = {
    status: 'passed',
    ownerPendingStatus: composition.ownerPendingRecovery.status,
    startupRecovery: composition.startupRecovery,
    ownerMode: composition.ownerMode.status,
    ownerApiAuthoritative: composition.ownerProfileEvidence.ownerApiAuthoritative || false,
  }
} finally {
  if (previousTimeout === undefined) delete process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
  else process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = previousTimeout
  if (previousStaleAfter === undefined) delete process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS
  else process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS = previousStaleAfter
  await rm(testRoot, { recursive: true, force: true })
}

evidence.status = 'passed'
evidence.artifactChecksum = `sha256:${createHash('sha256').update(canonicalJson(evidence)).digest('hex')}`
console.log(JSON.stringify(evidence))
