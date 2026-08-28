import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {
  commitOwnerModeCheckpoint,
  createReadWebProductionBackupComposition,
  readOwnerCanonicalDomain,
  readOwnerModeCheckpoint,
  inspectOwnerModeCheckpoints,
  withReadWebApplicationStartupLock,
  withReadWebApplicationProfileLease,
  writeIsolatedBrowserProfile,
} from './lib/read-web-production-backup.mjs'

const SCRIPT_PATH = path.resolve(process.argv[1])

if (process.argv[2] === '--lease-child') {
  await runLeaseChild({
    root: process.argv[3],
    profileDir: process.argv[4],
    profileId: process.argv[5],
    authorityIsolationRoot: process.argv[6],
    authorityRoot: process.argv[7],
    readyPath: process.argv[8],
    resultPath: process.argv[9],
  })
  process.exit(0)
}

if (process.argv[2] === '--startup-child') {
  await runStartupChild(JSON.parse(process.argv[3] || '{}'))
  process.exit(0)
}

async function waitForChildRelease() {
  if (process.stdin.readableEnded || process.stdin.destroyed) return
  process.stdin.resume()
  await new Promise((resolve) => {
    const done = () => resolve()
    process.stdin.once('end', done)
    process.stdin.once('close', done)
  })
}

async function runLeaseChild({ root, profileDir, profileId, authorityIsolationRoot, authorityRoot, readyPath, resultPath }) {
  try {
    const profileLease = await withReadWebApplicationProfileLease({
      isolationRoot: root,
      profileDir,
      profileId,
      profileAuthorityIsolationRoot: authorityIsolationRoot,
      profileAuthorityRoot: authorityRoot,
    }, async ({ profileLease: evidence }) => {
      await writeFile(readyPath, `${JSON.stringify(evidence)}\n`, 'utf8')
      await waitForChildRelease()
      return evidence
    })
    await writeFile(resultPath, `${JSON.stringify({ status: 'released', profileLease })}\n`, 'utf8')
  } catch (error) {
    await writeFile(resultPath, `${JSON.stringify({ status: 'failed', code: error?.code || null, message: error?.message || String(error) })}\n`, 'utf8')
  }
}

async function runStartupChild({ readyPath, resultPath, ...options }) {
  try {
    await withReadWebApplicationStartupLock(options, async ({ composition, profileLease, profileLeaseMode }) => {
      await writeFile(readyPath, `${JSON.stringify({
        status: 'ready',
        profileLease,
        profileLeaseMode,
        ownerProfileEvidence: composition.ownerProfileEvidence,
      })}\n`, 'utf8')
      await waitForChildRelease()
    })
    await writeFile(resultPath, `${JSON.stringify({ status: 'released' })}\n`, 'utf8')
  } catch (error) {
    await writeFile(resultPath, `${JSON.stringify({ status: 'failed', code: error?.code || null, message: error?.message || String(error) })}\n`, 'utf8')
  }
}

function spawnChild(argumentsList, { timeoutMs = 5_000, environment = {} } = {}) {
  const child = spawn(process.execPath, [SCRIPT_PATH, ...argumentsList], {
    cwd: path.resolve(path.dirname(SCRIPT_PATH), '..'),
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'pipe'],
    env: {
      ...process.env,
      READ_WEB_BACKUP_LOCK_TIMEOUT_MS: String(timeoutMs),
      ...environment,
    },
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  return {
    child,
    stderr: () => stderr,
    wait: () => new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    }),
  }
}

function spawnLeaseChild({ root, profileDir, profileId, authorityIsolationRoot, authorityRoot, readyPath, resultPath, timeoutMs = 5_000, environment = {} }) {
  return spawnChild([
    '--lease-child',
    root,
    profileDir,
    profileId,
    authorityIsolationRoot,
    authorityRoot,
    readyPath,
    resultPath,
  ], { timeoutMs, environment })
}

function spawnStartupChild({ options, readyPath, resultPath, timeoutMs = 5_000 }) {
  return spawnChild([
    '--startup-child',
    JSON.stringify({ ...options, readyPath, resultPath }),
  ], { timeoutMs })
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
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for ${filePath}`)
}

function fixturePaths(root, name) {
  const isolationRoot = path.join(root, name)
  return {
    isolationRoot,
    profileDir: path.join(isolationRoot, 'profile'),
    pythonStateDir: path.join(isolationRoot, 'python-state'),
    pythonOutputDir: path.join(isolationRoot, 'python-output'),
  }
}

async function makeDirectories(paths, includePython = false) {
  const values = includePython
    ? Object.values(paths)
    : [paths.isolationRoot, paths.profileDir]
  await Promise.all(values.map((directory) => mkdir(directory, { recursive: true })))
}

async function assertCode(promise, code, message) {
  await assert.rejects(promise, (error) => error?.code === code, message)
}

function canonicalJson(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function withCheckpointChecksum(value) {
  const { checksum: _checksum, ...core } = value
  return {
    ...core,
    checksum: `sha256:${createHash('sha256').update(canonicalJson(core)).digest('hex')}`,
  }
}

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-windows-owner-lease-2.3-'))
const profileId = 'lease-focused-profile'
const profilePaths = fixturePaths(root, 'profile-lease-instance-a')
const secondProfilePaths = fixturePaths(root, 'profile-lease-instance-b')
const profileAuthorityIsolationRoot = path.join(root, 'stable-profile-authority')
const profileAuthorityRoot = path.join(profileAuthorityIsolationRoot, 'profiles', profileId)
const crashPaths = fixturePaths(root, 'profile-lease-crash')
const checkpointPaths = fixturePaths(root, 'checkpoint')
const checkpointAuthorityIsolationRoot = path.join(root, 'checkpoint-authority')
const checkpointAuthorityRoot = path.join(checkpointAuthorityIsolationRoot, 'profiles', 'checkpoint-profile')
const compositionPaths = fixturePaths(root, 'composition')
const compositionAuthorityIsolationRoot = path.join(root, 'composition-authority')
const compositionAuthorityRoot = path.join(compositionAuthorityIsolationRoot, 'profiles', 'composition-profile')
await makeDirectories(profilePaths)
await makeDirectories(secondProfilePaths)
await makeDirectories(crashPaths)
await makeDirectories(checkpointPaths)
await makeDirectories(compositionPaths, true)
await mkdir(profileAuthorityRoot, { recursive: true })
await mkdir(checkpointAuthorityRoot, { recursive: true })
await mkdir(compositionAuthorityRoot, { recursive: true })

try {
  const firstReady = path.join(root, 'first-ready.json')
  const firstResult = path.join(root, 'first-result.json')
  const secondReady = path.join(root, 'second-ready.json')
  const secondResult = path.join(root, 'second-result.json')
  const first = spawnLeaseChild({
    root: profilePaths.isolationRoot,
    profileDir: profilePaths.profileDir,
    profileId,
    authorityIsolationRoot: profileAuthorityIsolationRoot,
    authorityRoot: profileAuthorityRoot,
    readyPath: firstReady,
    resultPath: firstResult,
  })
  await waitForFile(firstReady)

  const second = spawnLeaseChild({
    root: secondProfilePaths.isolationRoot,
    profileDir: secondProfilePaths.profileDir,
    profileId,
    authorityIsolationRoot: profileAuthorityIsolationRoot,
    authorityRoot: profileAuthorityRoot,
    readyPath: secondReady,
    resultPath: secondResult,
    timeoutMs: 350,
  })
  const secondExit = await second.wait()
  assert.equal(secondExit.code, 0, second.stderr())
  const secondEvidence = JSON.parse(await readFile(secondResult, 'utf8'))
  assert.equal(secondEvidence.status, 'failed', 'a second process must not become an authoritative writer')
  assert.equal(secondEvidence.code, 'BACKUP_PATH_LOCK_TIMEOUT')
  await assert.rejects(stat(secondReady), { code: 'ENOENT' })
  assert.ok(
    await stat(`${profileAuthorityRoot.toLowerCase()}.read-web-path.lock`),
    'the stable profile authority lock must remain held by the first instance',
  )
  await assert.rejects(
    stat(`${profilePaths.isolationRoot.toLowerCase()}.read-web-path.lock`),
    { code: 'ENOENT' },
    'the standalone authority lease must not fall back to the instance root',
  )

  first.child.stdin.end()
  const firstExit = await first.wait()
  assert.equal(firstExit.code, 0, first.stderr())
  assert.equal(JSON.parse(await readFile(firstResult, 'utf8')).status, 'released')

  const reacquired = await withReadWebApplicationProfileLease({
    isolationRoot: profilePaths.isolationRoot,
    profileDir: profilePaths.profileDir,
    profileId,
    profileAuthorityIsolationRoot,
    profileAuthorityRoot,
  }, ({ profileLease }) => profileLease)
  assert.equal(reacquired.status, 'held')
  await assert.rejects(stat(`${profileAuthorityRoot.toLowerCase()}.read-web-path.lock`), { code: 'ENOENT' })

  await assertCode(
    withReadWebApplicationProfileLease({
      isolationRoot: profilePaths.isolationRoot,
      profileDir: profilePaths.profileDir,
      profileId,
      profileAuthorityIsolationRoot,
      profileAuthorityRoot,
    }, async () => { throw Object.assign(new Error('startup failure fixture'), { code: 'STARTUP_FAILURE_FIXTURE' }) }),
    'STARTUP_FAILURE_FIXTURE',
    'startup failure must release the profile lease',
  )
  const afterFailedStart = await withReadWebApplicationProfileLease({
    isolationRoot: profilePaths.isolationRoot,
    profileDir: profilePaths.profileDir,
    profileId,
    profileAuthorityIsolationRoot,
    profileAuthorityRoot,
  }, ({ profileLease }) => profileLease)
  assert.equal(afterFailedStart.status, 'held')

  const crashReady = path.join(root, 'crash-ready.json')
  const crashResult = path.join(root, 'crash-result.json')
  const crash = spawnLeaseChild({
    root: crashPaths.isolationRoot,
    profileDir: crashPaths.profileDir,
    profileId,
    authorityIsolationRoot: profileAuthorityIsolationRoot,
    authorityRoot: profileAuthorityRoot,
    readyPath: crashReady,
    resultPath: crashResult,
    environment: { READ_WEB_BACKUP_LOCK_STALE_AFTER_MS: '1000' },
  })
  await waitForFile(crashReady)
  crash.child.kill()
  const crashExit = await crash.wait()
  assert.notEqual(crashExit.code, 0, 'the crash fixture must terminate before releasing its lease')
  const previousTimeout = process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
  const previousStaleAfter = process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS
  process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = '3_000'
  process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS = '1_000'
  try {
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    const recoveredAfterCrash = await withReadWebApplicationProfileLease({
      isolationRoot: crashPaths.isolationRoot,
      profileDir: crashPaths.profileDir,
      profileId,
      profileAuthorityIsolationRoot,
      profileAuthorityRoot,
    }, ({ profileLease }) => profileLease)
    assert.equal(recoveredAfterCrash.status, 'held')
  } finally {
    if (previousTimeout === undefined) delete process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
    else process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = previousTimeout
    if (previousStaleAfter === undefined) delete process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS
    else process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS = previousStaleAfter
  }

  const repository = {
    identity: 'windows-host.reader-session.fixture.v1',
    type: 'host-managed',
    baseRevision: 0,
    revision: 1,
    baseEvidence: `sha256:${'a'.repeat(64)}`,
    revisionEvidence: `sha256:${'b'.repeat(64)}`,
  }
  let ownerReads = 0
  const readOptions = {
    isolationRoot: checkpointPaths.isolationRoot,
    profileDir: checkpointPaths.profileDir,
    profileAuthorityIsolationRoot: checkpointAuthorityIsolationRoot,
    profileAuthorityRoot: checkpointAuthorityRoot,
    profileId: 'checkpoint-profile',
    domain: 'reader-session',
    repository: {
      ...repository,
      async read() {
        ownerReads += 1
        return { source: 'host-fixture', revision: 1 }
      },
    },
  }
  await assertCode(
    readOwnerCanonicalDomain(readOptions),
    'OWNER_MODE_AUTHORITY_NOT_READY',
    'owner read must not fall back to browser storage before a checkpoint',
  )
  assert.equal(ownerReads, 0)
  const preCutover = await inspectOwnerModeCheckpoints({
    isolationRoot: checkpointPaths.isolationRoot,
    profileDir: checkpointPaths.profileDir,
    profileAuthorityIsolationRoot: checkpointAuthorityIsolationRoot,
    profileAuthorityRoot: checkpointAuthorityRoot,
    profileId: 'checkpoint-profile',
  })
  assert.equal(preCutover.status, 'pre-cutover')
  assert.deepEqual(preCutover.authoritativeDomains, [])

  await assertCode(
    commitOwnerModeCheckpoint({
      ...readOptions,
      domain: 'reader-session',
      oldWriterBlocked: false,
      compatibilityMode: 'read-only',
      inFlight: 0,
      repository,
    }),
    'OWNER_MODE_CHECKPOINT_PRECONDITION_FAILED',
    'a checkpoint cannot switch authority before old-writer freeze',
  )

  const committedAt = '2026-08-29T00:00:00.000Z'
  const checkpointResult = await commitOwnerModeCheckpoint({
    ...readOptions,
    oldWriterBlocked: true,
    compatibilityMode: 'read-only',
    inFlight: 0,
    repository,
    committedAt,
  })
  assert.equal(checkpointResult.created, true)
  assert.equal(checkpointResult.checkpoint.authorityMode, 'host-api=authoritative')
  const checkpointPath = checkpointResult.path
  assert.equal(checkpointPath.startsWith(checkpointAuthorityRoot), true)
  assert.deepEqual(await readdir(path.dirname(checkpointPath)), ['reader-session.json'])
  const beforeNoOverwrite = await readFile(checkpointPath, 'utf8')
  await assertCode(
    commitOwnerModeCheckpoint({
      ...readOptions,
      oldWriterBlocked: true,
      compatibilityMode: 'read-only',
      inFlight: 0,
      repository: { ...repository, revision: 2 },
      committedAt: '2026-08-29T00:00:01.000Z',
    }),
    'OWNER_MODE_CHECKPOINT_EXISTS',
    'an owner-mode checkpoint must not be overwritten by a second authority switch',
  )
  assert.equal(await readFile(checkpointPath, 'utf8'), beforeNoOverwrite)

  const ownerRead = await readOwnerCanonicalDomain(readOptions)
  assert.deepEqual(ownerRead, { source: 'host-fixture', revision: 1 })
  assert.equal(ownerReads, 1)
  const checkpoint = await readOwnerModeCheckpoint({
    isolationRoot: checkpointPaths.isolationRoot,
    profileDir: checkpointPaths.profileDir,
    profileAuthorityIsolationRoot: checkpointAuthorityIsolationRoot,
    profileAuthorityRoot: checkpointAuthorityRoot,
    profileId: 'checkpoint-profile',
    domain: 'reader-session',
  })
  assert.equal(checkpoint.repository.identity, repository.identity)
  await assertCode(
    readOwnerModeCheckpoint({
      isolationRoot: checkpointPaths.isolationRoot,
      profileDir: checkpointPaths.profileDir,
      profileAuthorityIsolationRoot: checkpointAuthorityIsolationRoot,
      profileAuthorityRoot: checkpointAuthorityRoot,
      profileId: 'foreign-profile',
      domain: 'reader-session',
    }),
    'OWNER_MODE_CHECKPOINT_PROFILE_MISMATCH',
    'a foreign profile identity must not read an owner checkpoint',
  )
  await assertCode(
    readOwnerCanonicalDomain({
      ...readOptions,
      repository: { ...readOptions.repository, type: 'browser-indexeddb' },
    }),
    'OWNER_MODE_REPOSITORY_MISMATCH',
    'browser persistence cannot impersonate the checkpoint repository',
  )

  const foreignLeaseCheckpoint = withCheckpointChecksum({
    ...checkpoint,
    lease: { ...checkpoint.lease, profileKeyHash: `sha256:${'f'.repeat(64)}` },
  })
  await writeFile(checkpointPath, `${JSON.stringify(foreignLeaseCheckpoint)}\n`, 'utf8')
  await assertCode(
    readOwnerModeCheckpoint({
      isolationRoot: checkpointPaths.isolationRoot,
      profileDir: checkpointPaths.profileDir,
      profileAuthorityIsolationRoot: checkpointAuthorityIsolationRoot,
      profileAuthorityRoot: checkpointAuthorityRoot,
      profileId: 'checkpoint-profile',
      domain: 'reader-session',
    }),
    'OWNER_MODE_CHECKPOINT_LEASE_MISMATCH',
    'a checkpoint from a foreign lease identity must not be accepted',
  )

  const unknownSchemaCheckpoint = { ...foreignLeaseCheckpoint, schemaVersion: 99 }
  await writeFile(checkpointPath, `${JSON.stringify(unknownSchemaCheckpoint)}\n`, 'utf8')
  await assertCode(
    readOwnerModeCheckpoint({
      isolationRoot: checkpointPaths.isolationRoot,
      profileDir: checkpointPaths.profileDir,
      profileAuthorityIsolationRoot: checkpointAuthorityIsolationRoot,
      profileAuthorityRoot: checkpointAuthorityRoot,
      profileId: 'checkpoint-profile',
      domain: 'reader-session',
    }),
    'OWNER_MODE_CHECKPOINT_UNKNOWN_SCHEMA',
    'an unknown owner-mode checkpoint schema must fail closed',
  )

  const partialCheckpoint = withCheckpointChecksum({ ...checkpoint, oldWriterBlocked: false })
  await writeFile(checkpointPath, `${JSON.stringify(partialCheckpoint)}\n`, 'utf8')
  await assertCode(
    readOwnerModeCheckpoint({
      isolationRoot: checkpointPaths.isolationRoot,
      profileDir: checkpointPaths.profileDir,
      profileAuthorityIsolationRoot: checkpointAuthorityIsolationRoot,
      profileAuthorityRoot: checkpointAuthorityRoot,
      profileId: 'checkpoint-profile',
      domain: 'reader-session',
    }),
    'OWNER_MODE_CHECKPOINT_INVALID',
    'a partial owner-mode checkpoint must not switch authority',
  )

  const restoreFixture = {
    ...compositionPaths,
    profileAuthorityIsolationRoot: compositionAuthorityIsolationRoot,
    profileAuthorityRoot: compositionAuthorityRoot,
    profileId: 'composition-profile',
  }
  await writeIsolatedBrowserProfile(restoreFixture.profileDir, { localStorage: {}, indexedDbRows: [] })
  const composition = await createReadWebProductionBackupComposition({
    isolationRoot: restoreFixture.isolationRoot,
    profileDir: restoreFixture.profileDir,
    pythonStateDir: restoreFixture.pythonStateDir,
    pythonOutputDir: restoreFixture.pythonOutputDir,
    profileId: restoreFixture.profileId,
    profileAuthorityIsolationRoot: restoreFixture.profileAuthorityIsolationRoot,
    profileAuthorityRoot: restoreFixture.profileAuthorityRoot,
  })
  assert.equal(composition.restoreTarget.applicationLeaseRequired, true)
  assert.equal(composition.restoreTarget.restoreCapabilities.applicationProfileLease, true)
  let releaseRestoreLease
  let signalHolderEntered
  const holderEntered = new Promise((resolve) => { signalHolderEntered = resolve })
  const holder = withReadWebApplicationProfileLease(restoreFixture, async () => {
    signalHolderEntered()
    await new Promise((release) => { releaseRestoreLease = release })
  })
  // Resolve a barrier from inside the lease callback so the restore/cutover
  // assertions run while this process owns the canonical profile lock.
  await holderEntered
  process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = '350'
  try {
    await assertCode(
      composition.restoreTarget.readJournal({ restoreId: 'lease-blocked' }),
      'BACKUP_PATH_LOCK_TIMEOUT',
      'restore target must wait for the same application profile lease',
    )
    await assertCode(
      commitOwnerModeCheckpoint({
        ...restoreFixture,
        domain: 'workflow',
        oldWriterBlocked: true,
        compatibilityMode: 'read-only',
        inFlight: 0,
        repository: {
          identity: 'windows-host.workflow.fixture.v1',
          type: 'host-managed',
          baseRevision: 0,
          revision: 1,
          baseEvidence: `sha256:${'c'.repeat(64)}`,
          revisionEvidence: `sha256:${'d'.repeat(64)}`,
        },
      }),
      'BACKUP_PATH_LOCK_TIMEOUT',
      'migration cutover must require the same application profile lease',
    )
  } finally {
    delete process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
    releaseRestoreLease?.()
    await holder
  }
  await composition.restoreTarget.readJournal({ restoreId: 'lease-released' })

  let junctionContainment = process.platform !== 'win32'
  if (process.platform === 'win32') {
    const junctionInstance = fixturePaths(root, 'junction-instance')
    const junctionAuthorityIsolationRoot = path.join(root, 'junction-authority')
    const junctionAuthorityRoot = path.join(junctionAuthorityIsolationRoot, 'profiles', 'junction-profile')
    const externalOwnerMode = path.join(root, 'junction-external-owner-mode')
    await makeDirectories(junctionInstance)
    await mkdir(junctionAuthorityRoot, { recursive: true })
    await mkdir(externalOwnerMode, { recursive: true })
    await writeFile(path.join(externalOwnerMode, 'sentinel.txt'), 'must-remain', 'utf8')
    const ownerModePath = path.join(junctionAuthorityRoot, 'owner-mode')
    await symlink(externalOwnerMode, ownerModePath, 'junction')
    const beforeEntries = (await readdir(externalOwnerMode)).sort()
    const beforeSentinel = await readFile(path.join(externalOwnerMode, 'sentinel.txt'), 'utf8')
    await assertCode(
      commitOwnerModeCheckpoint({
        ...junctionInstance,
        profileAuthorityIsolationRoot: junctionAuthorityIsolationRoot,
        profileAuthorityRoot: junctionAuthorityRoot,
        profileId: 'junction-profile',
        domain: 'workflow',
        oldWriterBlocked: true,
        compatibilityMode: 'read-only',
        inFlight: 0,
        repository: {
          identity: 'windows-host.workflow.junction-fixture.v1',
          type: 'host-managed',
          baseRevision: 0,
          revision: 1,
          baseEvidence: `sha256:${'e'.repeat(64)}`,
          revisionEvidence: `sha256:${'f'.repeat(64)}`,
        },
      }),
      'BACKUP_PRODUCTION_COMPOSITION_UNSAFE_PATH',
      'a junction in the checkpoint parent must fail closed before mkdir/write',
    )
    assert.deepEqual((await readdir(externalOwnerMode)).sort(), beforeEntries)
    assert.equal(await readFile(path.join(externalOwnerMode, 'sentinel.txt'), 'utf8'), beforeSentinel)
    junctionContainment = true
  }

  const launcherOverlapProfileId = 'launcher-overlap-profile'
  const launcherOverlapAuthorityIsolationRoot = path.join(root, 'launcher-overlap-authority')
  const launcherOverlapAuthorityRoot = path.join(
    launcherOverlapAuthorityIsolationRoot,
    'profiles',
    launcherOverlapProfileId,
  )
  const launcherOverlapFirst = fixturePaths(root, 'launcher-overlap-instance-a')
  const launcherOverlapSecond = fixturePaths(root, 'launcher-overlap-instance-b')
  await makeDirectories(launcherOverlapFirst, true)
  await makeDirectories(launcherOverlapSecond, true)
  await mkdir(launcherOverlapAuthorityRoot, { recursive: true })
  await writeIsolatedBrowserProfile(launcherOverlapFirst.profileDir, { localStorage: {}, indexedDbRows: [] })
  await writeIsolatedBrowserProfile(launcherOverlapSecond.profileDir, { localStorage: {}, indexedDbRows: [] })
  const launcherOverlapOptions = (paths) => ({
    isolationRoot: paths.isolationRoot,
    profileDir: paths.profileDir,
    pythonStateDir: paths.pythonStateDir,
    pythonOutputDir: paths.pythonOutputDir,
    profileId: launcherOverlapProfileId,
    profileAuthorityIsolationRoot: launcherOverlapAuthorityIsolationRoot,
    profileAuthorityRoot: launcherOverlapAuthorityRoot,
    allowStandby: true,
  })
  const launcherFirstReadyPath = path.join(root, 'launcher-overlap-first-ready.json')
  const launcherFirstResultPath = path.join(root, 'launcher-overlap-first-result.json')
  const launcherSecondReadyPath = path.join(root, 'launcher-overlap-second-ready.json')
  const launcherSecondResultPath = path.join(root, 'launcher-overlap-second-result.json')
  const launcherFirst = spawnStartupChild({
    options: launcherOverlapOptions(launcherOverlapFirst),
    readyPath: launcherFirstReadyPath,
    resultPath: launcherFirstResultPath,
  })
  await waitForFile(launcherFirstReadyPath)
  const launcherFirstReady = JSON.parse(await readFile(launcherFirstReadyPath, 'utf8'))
  assert.equal(launcherFirstReady.status, 'ready')
  assert.equal(launcherFirstReady.profileLeaseMode, 'authoritative')
  assert.ok(launcherFirstReady.profileLease)
  assert.equal(launcherFirstReady.ownerProfileEvidence.ownerMode.status, 'pre-cutover')
  assert.deepEqual(launcherFirstReady.ownerProfileEvidence.ownerMode.authoritativeDomains, [])
  assert.ok(
    await stat(`${launcherOverlapAuthorityRoot.toLowerCase()}.read-web-path.lock`),
    'the first overlapping Host must hold the stable profile authority lease',
  )

  const launcherSecond = spawnStartupChild({
    options: launcherOverlapOptions(launcherOverlapSecond),
    readyPath: launcherSecondReadyPath,
    resultPath: launcherSecondResultPath,
    timeoutMs: 350,
  })
  await waitForFile(launcherSecondReadyPath)
  const launcherSecondReady = JSON.parse(await readFile(launcherSecondReadyPath, 'utf8'))
  assert.equal(launcherSecondReady.status, 'ready')
  assert.equal(launcherSecondReady.profileLeaseMode, 'standby')
  assert.equal(launcherSecondReady.profileLease, null)
  assert.equal(launcherSecondReady.ownerProfileEvidence.ready, false)
  assert.equal(launcherSecondReady.ownerProfileEvidence.profileLease, null)
  assert.equal(launcherSecondReady.ownerProfileEvidence.profileLeaseMode, 'standby')
  launcherSecond.child.stdin.end()
  const launcherSecondExit = await launcherSecond.wait()
  assert.equal(launcherSecondExit.code, 0, launcherSecond.stderr())
  assert.equal(JSON.parse(await readFile(launcherSecondResultPath, 'utf8')).status, 'released')
  launcherFirst.child.stdin.end()
  const launcherFirstExit = await launcherFirst.wait()
  assert.equal(launcherFirstExit.code, 0, launcherFirst.stderr())
  assert.equal(JSON.parse(await readFile(launcherFirstResultPath, 'utf8')).status, 'released')
  await assert.rejects(stat(`${launcherOverlapAuthorityRoot.toLowerCase()}.read-web-path.lock`), { code: 'ENOENT' })

  console.log(JSON.stringify({
    schema: 'read-web.windows-local-owner-lease-check',
    schemaVersion: 1,
    status: 'passed',
    isolation: {
      tempRoot: root,
      sourceDataRead: false,
      protectedTreesRead: false,
      dailyPortsUsed: false,
    },
    lease: {
      singleAuthoritativeWriter: true,
      sameProfileDifferentInstanceRoots: true,
      stableAuthorityRoot: true,
      normalRelease: true,
      failedStartupRelease: true,
      crashStaleRecovery: true,
      foreignProfileRejected: true,
    },
    checkpoint: {
      soleAuthoritySwitch: true,
      missingReadRejected: true,
      preconditionGate: true,
      noOverwrite: true,
      hostReadOnly: true,
    },
    restoreAndCutover: {
      sharedProfileLease: true,
      leaseContract: composition.restoreTarget.applicationLeaseSource,
    },
    launcherOverlap: {
      stableAuthorityLease: true,
      standbyDoesNotClaimAuthority: true,
      normalRelease: true,
      junctionContainment,
      normalAtomicCheckpointPath: checkpointPath.startsWith(checkpointAuthorityRoot),
    },
  }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
