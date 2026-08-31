import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import {
  executeWindowsOwnerProductionEntry,
  parseWindowsOwnerProductionEntryArguments,
  validateWindowsOwnerProductionEntryOptions,
  WINDOWS_OWNER_PRODUCTION_DEFAULT_MAX_BACKUP_BYTES,
  waitForWorkflowWriterQuiescence,
} from './lib/windows-owner-production-entry.mjs'
import {
  fingerprintChromiumOriginSource,
  materializeRealProfileSource,
} from './lib/read-web-real-profile-rehearsal.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const execFileAsync = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, args, options, (error, stdout, stderr) => {
    if (error) {
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
      return
    }
    resolve({ stdout, stderr })
  })
})

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
}

async function loadBrowserCutoverModule() {
  const source = await readFile(path.join(repositoryRoot, 'src/services/windows-owner-domain-cutover.js'), 'utf8')
  const resolved = source
    .replace(
      "import { createWindowsOwnerApiClient } from './windows-owner-api-client.js'\n",
      'const createWindowsOwnerApiClient = () => null\n',
    )
    .replace(
      "import { readWindowsOwnerHealth } from './windows-owner-reader-session-composition.js'\n",
      `const readWindowsOwnerHealth = async (fetchImpl, healthPath) => {
        const response = await fetchImpl(healthPath, { method: 'GET' })
        return response?.json ? response.json() : null
      }
`,
    )
  return import(dataUrl(resolved))
}

function makeLayout(root) {
  const workflowDataRoot = path.join(root, 'workflow-data')
  const targetIsolationRoot = path.join(root, 'target-instance')
  const targetProfileAuthorityIsolationRoot = path.join(root, 'target-authority')
  return {
    browserProfileDir: path.join(root, 'browser-user-data', 'Default'),
    workflowDataRoot,
    workflowStateDir: path.join(workflowDataRoot, '.workflow_state'),
    workflowOutputDir: path.join(workflowDataRoot, 'output'),
    additionalOutputRoot: path.join(root, 'authorized-output'),
    runRoot: path.join(root, 'migration-run'),
    target: {
      isolationRoot: targetIsolationRoot,
      profileDir: path.join(targetIsolationRoot, 'profile'),
      pythonStateDir: path.join(targetIsolationRoot, 'python-state'),
      pythonOutputDir: path.join(targetIsolationRoot, 'python-output'),
      profileAuthorityIsolationRoot: targetProfileAuthorityIsolationRoot,
      profileAuthorityRoot: path.join(targetProfileAuthorityIsolationRoot, 'profile-authority'),
    },
  }
}

async function prepareLayout(layout) {
  await Promise.all([
    mkdir(layout.browserProfileDir, { recursive: true }),
    mkdir(layout.workflowStateDir, { recursive: true }),
    mkdir(layout.workflowOutputDir, { recursive: true }),
    mkdir(layout.additionalOutputRoot, { recursive: true }),
    mkdir(layout.runRoot, { recursive: true }),
    mkdir(layout.target.profileDir, { recursive: true }),
    mkdir(layout.target.pythonStateDir, { recursive: true }),
    mkdir(layout.target.pythonOutputDir, { recursive: true }),
    mkdir(layout.target.profileAuthorityRoot, { recursive: true }),
  ])
}

function entryArgs(layout, command, extra = []) {
  return [
    command,
    '--mode', 'optimization',
    '--profile-id', 'fixture-owner-profile',
    '--host-instance-id', 'fixture-owner-instance',
    '--host-access-token-env', 'READ_WEB_FIXTURE_TOKEN',
    '--browser-origin', 'http://127.0.0.1:49151',
    '--host-base-url', 'http://127.0.0.1:49152',
    '--browser-profile-dir', layout.browserProfileDir,
    '--workflow-data-root', layout.workflowDataRoot,
    '--workflow-state-dir', layout.workflowStateDir,
    '--workflow-output-dir', layout.workflowOutputDir,
    '--additional-output-root', layout.additionalOutputRoot,
    '--run-root', layout.runRoot,
    '--target-isolation-root', layout.target.isolationRoot,
    '--target-profile-dir', layout.target.profileDir,
    '--target-python-state-dir', layout.target.pythonStateDir,
    '--target-python-output-dir', layout.target.pythonOutputDir,
    '--target-profile-authority-isolation-root', layout.target.profileAuthorityIsolationRoot,
    '--target-profile-authority-root', layout.target.profileAuthorityRoot,
    '--migration-state-path', path.join(layout.target.profileAuthorityRoot, 'owner-mode', 'migration-state.json'),
    ...extra,
  ]
}

async function testEntryContract(layout) {
  assert.deepEqual(
    parseWindowsOwnerProductionEntryArguments(['plan', '--mode', 'optimization']),
    { command: 'plan', values: { mode: 'optimization' }, additionalOutputRoots: [] },
  )
  assert.throws(
    () => parseWindowsOwnerProductionEntryArguments(['plan', '--mode', 'optimization', '--mode', 'optimization']),
    (error) => error?.code === 'OWNER_PRODUCTION_ENTRY_ARGUMENT_INVALID',
  )

  const before = await readdir(layout.runRoot)
  const plan = await executeWindowsOwnerProductionEntry(
    parseWindowsOwnerProductionEntryArguments(entryArgs(layout, 'plan')),
  )
  assert.equal(plan.result.operation, 'plan')
  assert.equal(plan.result.noWrites, true)
  assert.equal(plan.write, false)
  assert.equal(plan.backupLimits.maxBackupBytes, WINDOWS_OWNER_PRODUCTION_DEFAULT_MAX_BACKUP_BYTES)
  assert.deepEqual(await readdir(layout.runRoot), before)

  const explicit = await validateWindowsOwnerProductionEntryOptions(
    parseWindowsOwnerProductionEntryArguments(entryArgs(layout, 'plan', [
      '--max-backup-bytes', String(WINDOWS_OWNER_PRODUCTION_DEFAULT_MAX_BACKUP_BYTES),
    ])),
  )
  assert.equal(explicit.maxBackupBytes, 256 * 1024 * 1024)
  await assert.rejects(
    validateWindowsOwnerProductionEntryOptions(
      parseWindowsOwnerProductionEntryArguments(entryArgs(layout, 'plan', ['--max-backup-bytes', '0'])),
    ),
    (error) => error?.code === 'OWNER_PRODUCTION_ENTRY_CONFIGURATION',
  )

  const cliPlan = await execFileAsync(process.execPath, [
    'scripts/windows-owner-production-entry.mjs',
    ...entryArgs(layout, 'plan'),
  ], { cwd: repositoryRoot, maxBuffer: 2 * 1024 * 1024 })
  assert.equal(JSON.parse(cliPlan.stdout).result.noWrites, true)

  await assert.rejects(
    executeWindowsOwnerProductionEntry(
      parseWindowsOwnerProductionEntryArguments(entryArgs(layout, 'apply', [
        '--confirm-owner-migration', 'APPLY',
      ])),
    ),
    (error) => error?.code === 'OWNER_PRODUCTION_ENTRY_EVIDENCE_REQUIRED',
  )
  assert.equal(await readdir(layout.runRoot).then((entries) => entries.length), 0)
}

async function testWorkflowQuiescence(layout) {
  const activityPath = path.join(layout.workflowStateDir, '.read-web-workflow-writer-active.json')
  await writeFile(activityPath, JSON.stringify({
    schemaVersion: 1,
    kind: 'read-web.workflow-writer-activity',
    jobId: 'fixture-active-job',
  }), 'utf8')
  const removal = new Promise((resolve, reject) => {
    setTimeout(() => rm(activityPath, { force: true }).then(resolve, reject), 25)
  })
  const drained = await waitForWorkflowWriterQuiescence({
    workflowStateDir: layout.workflowStateDir,
    browserEvidenceTimeoutMs: 500,
  })
  await removal
  assert.equal(drained.status, 'quiescent')

  await writeFile(activityPath, JSON.stringify({
    schemaVersion: 1,
    kind: 'read-web.workflow-writer-activity',
    jobId: 'fixture-crashed-job',
    pid: 2_147_483_647,
  }), 'utf8')
  const stale = await waitForWorkflowWriterQuiescence({
    workflowStateDir: layout.workflowStateDir,
    browserEvidenceTimeoutMs: 500,
  })
  assert.equal(stale.status, 'quiescent')
  assert.equal(await readdir(layout.workflowStateDir).then((entries) => entries.includes('.read-web-workflow-writer-active.json')), false)

  await writeFile(activityPath, JSON.stringify({
    schemaVersion: 1,
    kind: 'read-web.workflow-writer-activity',
    jobId: 'fixture-stuck-job',
  }), 'utf8')
  await assert.rejects(
    waitForWorkflowWriterQuiescence({
      workflowStateDir: layout.workflowStateDir,
      browserEvidenceTimeoutMs: 0,
    }),
    (error) => error?.code === 'OWNER_PRODUCTION_ENTRY_WORKFLOW_ACTIVE'
      && error?.details?.jobId === 'fixture-stuck-job',
  )
  await rm(activityPath, { force: true })
}

async function testLiveFreezeEvidence() {
  const module = await loadBrowserCutoverModule()
  const origin = 'http://127.0.0.1:49151'
  const health = {
    profileId: 'fixture-owner-profile',
    instanceId: 'fixture-owner-instance',
    liveness: { ready: true },
    ownerMode: { frozenDomains: ['reader-session'], authoritativeDomains: [] },
    domains: [{ domain: 'reader-session', writerFrozen: true }],
  }
  const windowObject = { location: { origin } }
  const cutover = module.createWindowsOwnerDomainCutover({
    windowObject,
    health,
    fetchImpl: async () => ({ ok: true, json: async () => health }),
  })
  const evidence = await cutover.collectFreezeEvidence({
    domain: 'reader-session',
    challenge: 'fixture-challenge',
    sourceFingerprint: 'a'.repeat(64),
  })
  assert.equal(evidence.kind, 'live-browser-owner-freeze')
  assert.equal(evidence.guard.writerBlocked, true)
  assert.deepEqual(evidence.guard.observedFrozenDomains, ['reader-session'])
  assert.equal(evidence.browserOrigin, origin)
  cutover.dispose()

  await assert.rejects(
    module.createWindowsOwnerBrowserFreezeEvidence({
      windowObject,
      domain: 'reader-session',
      challenge: 'fixture-challenge',
      sourceFingerprint: 'a'.repeat(64),
    }),
    (error) => error?.code === 'windows-owner-browser-freeze-guard-unavailable',
  )

  await assert.rejects(
    module.createWindowsOwnerBrowserFreezeEvidence({
      windowObject,
      cutover: {
        health,
        isAuthoritative: () => false,
        async refresh() { return { frozenDomains: ['reader-session'], health } },
        assertBrowserWriterAllowed() {},
      },
      domain: 'reader-session',
      challenge: 'fixture-challenge',
      sourceFingerprint: 'a'.repeat(64),
    }),
    (error) => error?.code === 'windows-owner-browser-freeze-not-enforced',
  )
}

async function createBrowserFixture(browserUserDataDir, origin) {
  const context = await chromium.launchPersistentContext(browserUserDataDir, {
    channel: 'chrome',
    headless: true,
    args: ['--profile-directory=Default'],
  })
  try {
    await context.route('**/*', async (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>owner entry fixture</title>',
    }))
    const page = await context.newPage()
    await page.goto(`${origin}/__fixture__`)
    await page.evaluate(async () => {
      localStorage.setItem('AnnotationGenerationStorage::fixture', '{"schemaVersion":1}')
      localStorage.setItem('unrelated.secret', 'must-not-stage')
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('files', 'readwrite')
        const store = transaction.objectStore('files')
        store.put({ id: 'audio', blob: new Blob(['x'.repeat(1024)], { type: 'audio/mpeg' }) })
        store.put({ id: 'audioMeta', schemaVersion: 1, revision: 1, payload: { contentId: 'fixture' } })
        store.put({ id: 'vocabulary.srs.store.v1', schemaVersion: 1, revision: 1, payload: { words: [] } })
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      database.close()
    })
  } finally {
    await context.close()
  }
}

async function testStagingBoundary(layout) {
  const userDataDir = path.dirname(layout.browserProfileDir)
  const origin = 'http://127.0.0.1:49151'
  await createBrowserFixture(userDataDir, origin)
  await writeFile(path.join(layout.workflowStateDir, 'jobs.json'), '{"jobs":[]}\n', 'utf8')
  await writeFile(path.join(layout.workflowStateDir, 'history.json'), JSON.stringify({
    items: [{ jobId: 'fixture-job', outputDir: layout.additionalOutputRoot, title: 'fixture' }],
  }) + '\n', 'utf8')
  await writeFile(path.join(layout.additionalOutputRoot, 'manifest.json'), '{"schemaVersion":1}\n', 'utf8')

  const inventory = await executeWindowsOwnerProductionEntry(
    parseWindowsOwnerProductionEntryArguments(entryArgs(layout, 'inventory')),
  )
  assert.equal(inventory.result.operation, 'inventory')
  assert.equal(inventory.result.readOnly, true)
  assert.equal(inventory.write, false)
  assert.equal(JSON.stringify(inventory).includes('must-not-stage'), false)
  assert.equal(JSON.stringify(inventory).includes('x'.repeat(1024)), false)
  assert.equal(await readdir(layout.runRoot).then((entries) => entries.length), 0)

  const before = await fingerprintChromiumOriginSource({
    browserProfileDir: layout.browserProfileDir,
    browserOrigin: origin,
  })
  const stage = await materializeRealProfileSource({
    browserProfileDir: layout.browserProfileDir,
    browserOrigin: origin,
    workflowDataRoot: layout.workflowDataRoot,
    workflowStateDir: layout.workflowStateDir,
    workflowOutputDir: layout.workflowOutputDir,
    additionalOutputRoots: [layout.additionalOutputRoot],
    isolatedRoot: layout.runRoot,
  })
  try {
    const stagedProfile = JSON.parse(await readFile(path.join(stage.source.profileDir, 'browser-profile.json'), 'utf8'))
    const stagedSnapshots = await readFile(stage.workflowSnapshotsPath, 'utf8')
    assert.equal(before, await fingerprintChromiumOriginSource({
      browserProfileDir: layout.browserProfileDir,
      browserOrigin: origin,
    }))
    assert.equal(stagedProfile.indexedDbRows.some((row) => row.id === 'audio'), false)
    assert.equal(stagedProfile.localStorage['unrelated.secret'], undefined)
    assert.equal(stagedSnapshots.includes('must-not-stage'), false)
    assert.equal(stage.browserEvidence.networkRequests, 0)
  } finally {
    await rm(stage.runRoot, { recursive: true, force: true })
  }
}

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-owner-entry-check-'))
const layout = makeLayout(root)
try {
  await prepareLayout(layout)
  await testEntryContract(layout)
  await testWorkflowQuiescence(layout)
  await testLiveFreezeEvidence()
  await testStagingBoundary(layout)
  console.log('Windows owner production entry checks passed.')
} finally {
  await rm(root, { recursive: true, force: true })
}
