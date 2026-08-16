import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {
  createReadWebProductionBackupComposition,
  writeIsolatedBrowserProfile,
} from './lib/read-web-production-backup.mjs'

if (process.argv[2] === '--crash-worker') {
  await runCrashWorker(JSON.parse(process.argv[3]))
  process.exit(0)
}

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-atomic-boundary-check-'))

try {
  const source = await createFixture(root, 'source')
  const target = await createFixture(root, 'target')
  await writeIsolatedBrowserProfile(source.profileDir, {
    localStorage: {
      'vocabulary.passage-preview.durable-state.v1': JSON.stringify({
        schemaVersion: 'passage-preview.durable-state.v1',
        revision: 1,
        contentId: 'atomic-boundary-preview',
        payload: { page: 1 },
      }),
    },
    indexedDbRows: [{
      id: 'audioMeta',
      schemaVersion: 1,
      revision: 1,
      contentId: 'atomic-boundary-source',
      content: { title: 'synthetic fixture' },
    }],
  })

  const sourceComposition = await createReadWebProductionBackupComposition(source)
  const targetComposition = await createReadWebProductionBackupComposition(target)
  const artifact = await sourceComposition.createBackup({ now: () => 1760000000000 })

  assert.equal(
    targetComposition.restoreTarget.restoreCapabilities.atomicRevisionCommit,
    true,
    'the six-domain application target must publish its startup-gated atomic visibility contract',
  )
  const result = await sourceComposition.service.restore(artifact, {
    target: targetComposition.restoreTarget,
    restoreId: 'six-domain-atomic-boundary',
  })
  assert.equal(result.status, 'completed')

  const reopened = await createReadWebProductionBackupComposition(target)
  assert.deepEqual(
    normalizeDomains(await collectDomains(reopened.restoreTarget)),
    normalizeDomains(artifact.domains),
    'application startup must expose the complete committed six-domain snapshot',
  )

  const visibilityTarget = await createFixture(root, 'visibility-target')
  const domainApplied = deferred()
  const releaseCommit = deferred()
  const visibilityComposition = await createReadWebProductionBackupComposition({
    ...visibilityTarget,
    faults: {
      async afterDomain({ appliedCount }) {
        if (appliedCount !== 1) return
        domainApplied.resolve()
        await releaseCommit.promise
      },
    },
  })
  const restorePromise = sourceComposition.service.restore(artifact, {
    target: visibilityComposition.restoreTarget,
    restoreId: 'six-domain-visibility-barrier',
  })
  try {
    await withTimeout(domainApplied.promise, 2_000, 'restore did not expose the domain fault barrier')
    const observer = collectDomains(visibilityComposition.restoreTarget)
    const startupObserver = createReadWebProductionBackupComposition(visibilityTarget)
    const observation = await Promise.race([
      observer.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 100)),
    ])
    assert.equal(observation, 'blocked', 'owner reads must wait while a six-domain commit is in progress')
    const startupObservation = await Promise.race([
      startupObserver.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 100)),
    ])
    assert.equal(startupObservation, 'blocked', 'application startup must wait behind an in-progress six-domain commit')
    releaseCommit.resolve()
    assert.equal((await restorePromise).status, 'completed')
    assert.deepEqual(
      normalizeDomains(await observer),
      normalizeDomains(artifact.domains),
      'a blocked observer must resume with the complete committed snapshot',
    )
    assert.deepEqual(
      normalizeDomains(await collectDomains((await startupObserver).restoreTarget)),
      normalizeDomains(artifact.domains),
      'application startup must resume with the complete committed snapshot',
    )
  } finally {
    releaseCommit.resolve()
    await restorePromise.catch(() => {})
  }

  await assertCrashRecoveryIsMandatory({ root, source, artifact })

  console.log('application backup atomic boundary checks passed')
} finally {
  await rm(root, { recursive: true, force: true })
}

async function assertCrashRecoveryIsMandatory({ root, source, artifact }) {
  const target = await createFixture(root, 'crash-recovery-target')
  const baselineComposition = await createReadWebProductionBackupComposition(target)
  const baseline = normalizeDomains(await collectDomains(baselineComposition.restoreTarget))
  const artifactPath = path.join(root, 'crash-recovery-artifact.json')
  const barrierPath = path.join(root, 'crash-recovery-domain-applied.json')
  await writeFile(artifactPath, `${JSON.stringify(artifact)}\n`, 'utf8')
  const child = spawn(process.execPath, [
    import.meta.filename,
    '--crash-worker',
    JSON.stringify({ source, target, artifactPath, barrierPath }),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      READ_WEB_BACKUP_LOCK_STALE_AFTER_MS: '1000',
      READ_WEB_BACKUP_LOCK_TIMEOUT_MS: '10000',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  await waitForFile(barrierPath, 10_000)
  child.kill()
  await waitForExit(child, 5_000)

  const previousStale = process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS
  const previousTimeout = process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
  process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS = '1000'
  process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = '10000'
  try {
    const startup = await createReadWebProductionBackupComposition(target)
    assert.equal(startup.startupRecovery?.status, 'rolled-back', 'startup must report recovery before exposing owners')
    assert.equal(
      (await startup.restoreTarget.readJournal({ restoreId: 'six-domain-hard-crash' }))?.status,
      'rolled-back',
      'startup recovery must durably close the interrupted restore journal',
    )
    assert.deepEqual(
      normalizeDomains(await collectDomains(startup.restoreTarget)),
      baseline,
      'startup after a hard restore crash must expose the complete baseline snapshot',
    )
    const profile = JSON.parse(await readFile(path.join(target.profileDir, 'browser-profile.json'), 'utf8'))
    assert.equal(
      profile.localStorage?.['isolated.read-web.application-restore.pending.v1'],
      undefined,
      'startup recovery must clear the durable pending checkpoint',
    )
  } finally {
    if (previousStale === undefined) delete process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS
    else process.env.READ_WEB_BACKUP_LOCK_STALE_AFTER_MS = previousStale
    if (previousTimeout === undefined) delete process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
    else process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = previousTimeout
  }
  assert.equal(stderr, '', `crash worker emitted stderr before termination: ${stderr}`)
}

async function runCrashWorker({ source, target, artifactPath, barrierPath }) {
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'))
  const sourceComposition = await createReadWebProductionBackupComposition(source)
  const targetComposition = await createReadWebProductionBackupComposition({
    ...target,
    faults: {
      async afterDomain({ appliedCount }) {
        if (appliedCount !== 1) return
        await writeFile(barrierPath, `${JSON.stringify({ appliedCount })}\n`, 'utf8')
        await new Promise(() => { setInterval(() => {}, 1_000) })
      },
    },
  })
  await sourceComposition.service.restore(artifact, {
    target: targetComposition.restoreTarget,
    restoreId: 'six-domain-hard-crash',
  })
}

async function waitForFile(filePath, timeoutMs) {
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

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode
  return withTimeout(new Promise((resolve, reject) => {
    child.once('exit', resolve)
    child.once('error', reject)
  }), timeoutMs, 'timed out waiting for crash worker exit')
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function withTimeout(promise, milliseconds, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
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

async function collectDomains(target) {
  return Object.fromEntries(await Promise.all(
    Object.keys(target.adapters).map(async (key) => [key, await target.adapters[key].collect()]),
  ))
}

async function createFixture(parent, name) {
  const rootDir = path.join(parent, name)
  const fixture = {
    rootDir,
    profileDir: path.join(rootDir, 'profile'),
    pythonStateDir: path.join(rootDir, 'python-state'),
    pythonOutputDir: path.join(rootDir, 'python-output'),
  }
  await Promise.all([
    mkdir(fixture.rootDir, { recursive: true }),
    mkdir(fixture.profileDir, { recursive: true }),
    mkdir(fixture.pythonStateDir, { recursive: true }),
    mkdir(fixture.pythonOutputDir, { recursive: true }),
  ])
  return {
    isolationRoot: fixture.rootDir,
    profileDir: fixture.profileDir,
    pythonStateDir: fixture.pythonStateDir,
    pythonOutputDir: fixture.pythonOutputDir,
  }
}
