import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  readOwnerModeCheckpoint,
  readOwnerModeFreeze,
  writeIsolatedBrowserProfile,
} from './lib/read-web-production-backup.mjs'
import {
  createWindowsOwnerProductionHostClient,
  runWindowsOwnerProductionCutover,
} from './lib/windows-owner-cutover.mjs'
import { resolveSelectedPython } from './lib/python-runtime.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const allDomains = [
  'reader-session',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'marks-activity',
  'workflow',
]
const profileId = 'workflow-c2c-profile'
const instanceId = 'workflow-c2c-instance'
const accessToken = 'workflow-c2c-token'

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
}

function canonical(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function checksum(value) {
  return `sha256:${createHash('sha256').update(canonical(value), 'utf8').digest('hex')}`
}

function makeLayout(root, name) {
  const isolationRoot = path.join(root, `${name}-instance`)
  const profileAuthorityIsolationRoot = path.join(root, `${name}-authority`)
  return {
    isolationRoot,
    profileDir: path.join(isolationRoot, 'profile'),
    pythonStateDir: path.join(isolationRoot, 'python-state'),
    pythonOutputDir: path.join(isolationRoot, 'python-output'),
    profileAuthorityIsolationRoot,
    profileAuthorityRoot: path.join(profileAuthorityIsolationRoot, 'profile-authority'),
  }
}

function ownerProfileEvidence() {
  const verified = {
    bound: true,
    status: 'verified',
    source: 'read-web-production-backup.composition',
  }
  const bindings = {
    backupAdapterRegistry: { ...verified, requiredDomains: [...allDomains] },
    applicationLease: { ...verified, source: 'read-web-production-backup.application-profile-lease' },
    transaction: { ...verified },
    revision: { ...verified },
    recovery: { ...verified },
    domains: {},
  }
  for (const domain of allDomains) {
    bindings.domains[domain] = {
      backupAdapter: { ...verified, key: domain, schemaVersion: 1, supportedSchemaVersions: [1] },
      revision: { ...verified },
      recovery: { ...verified },
    }
  }
  return {
    schemaVersion: 1,
    source: 'read-web-production-backup.composition',
    ready: true,
    profileChecksum: `sha256:${'a'.repeat(64)}`,
    inventory: {
      present: true,
      status: 'verified',
      source: 'browser-profile.json + application_backup.py',
      indexedDbRowCount: 0,
      localStorageKeyCount: 0,
      pythonSourceCount: 2,
    },
    collection: {
      status: 'verified',
      source: 'createReadWebApplicationBackupService.createBackup',
      artifactChecksum: `sha256:${'b'.repeat(64)}`,
    },
    rows: [],
    bindings,
    profileLease: {
      schemaVersion: 1,
      status: 'held',
      profileId,
      profileKeyHash: `sha256:${'c'.repeat(64)}`,
      leaseIdHash: `sha256:${'d'.repeat(64)}`,
      ownerTokenHash: `sha256:${'e'.repeat(64)}`,
      pid: process.pid,
    },
    ownerMode: {
      schemaVersion: 1,
      status: 'pre-cutover',
      authoritativeDomains: [],
      invalidDomains: [],
    },
  }
}

function workflowFixtures() {
  const firstUrl = 'https://www.youtube.com/watch?v=workflow-c2c-1'
  const secondUrl = 'https://www.youtube.com/watch?v=workflow-c2c-2'
  const firstJob = {
    jobId: 'workflow-job-1',
    status: 'completed',
    stage: 'finished',
    createdAt: '2026-08-30T00:00:01Z',
    updatedAt: '2026-08-30T00:01:01Z',
    finishedAt: '2026-08-30T00:01:01Z',
    title: 'Workflow fixture one',
    url: firstUrl,
    sourceType: 'youtube',
    videoPriority: false,
    request: {
      url: firstUrl,
      geminiMode: 'mock',
      model: 'workflow-c2c-model',
      baseUrl: 'https://workflow.example/v1',
      videoPriority: false,
    },
  }
  const secondJob = {
    jobId: 'workflow-job-2',
    status: 'queued',
    stage: 'queued',
    createdAt: '2026-08-30T00:02:01Z',
    updatedAt: '2026-08-30T00:02:01Z',
    title: 'Workflow fixture two',
    url: secondUrl,
    sourceType: 'youtube',
    videoPriority: true,
    request: {
      url: secondUrl,
      geminiMode: 'mock',
      model: 'workflow-c2c-model',
      baseUrl: 'https://workflow.example/v1',
      videoPriority: true,
    },
  }
  const firstHistory = {
    ...firstJob,
    status: 'completed',
    stage: 'finished',
  }
  const secondHistory = {
    ...secondJob,
    status: 'failed',
    stage: 'download',
    finishedAt: '2026-08-30T00:03:01Z',
    error: { code: 'fixture-download', message: 'fixture failure' },
  }
  const readerIndex = [
    { jobId: firstJob.jobId, title: firstJob.title, url: firstJob.url, status: firstJob.status },
    { jobId: secondJob.jobId, title: secondJob.title, url: secondJob.url, status: secondHistory.status },
  ]
  const config = {
    model: 'workflow-c2c-model',
    baseUrl: 'https://workflow.example/v1',
    proxyUrl: 'https://proxy.example',
  }
  return {
    jobs: [firstJob, secondJob],
    history: [firstHistory, secondHistory],
    readerIndex: { items: readerIndex },
    config,
  }
}

function workflowEnvelope(domain, key, items) {
  const payload = { [key]: items }
  return {
    schemaVersion: 1,
    domain,
    revision: 1,
    updatedAt: '2026-08-30T00:00:00Z',
    payload,
    [key]: items,
    checksum: checksum(payload),
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function seedSource(layout) {
  const fixture = workflowFixtures()
  await mkdir(layout.pythonOutputDir, { recursive: true })
  await mkdir(layout.profileAuthorityRoot, { recursive: true })
  await writeIsolatedBrowserProfile(layout.profileDir, { localStorage: {}, indexedDbRows: [] })
  await writeJson(
    path.join(layout.pythonStateDir, 'jobs.json'),
    workflowEnvelope('workflow.jobs', 'jobs', fixture.jobs),
  )
  await writeJson(
    path.join(layout.pythonStateDir, 'history.json'),
    workflowEnvelope('workflow.history', 'items', fixture.history),
  )
  await writeJson(path.join(layout.pythonStateDir, 'reader-index.json'), fixture.readerIndex)
  await writeJson(path.join(layout.pythonStateDir, 'config.json'), fixture.config)
  return fixture
}

async function seedTarget(layout) {
  await mkdir(layout.profileAuthorityRoot, { recursive: true })
  await writeIsolatedBrowserProfile(layout.profileDir, { localStorage: {}, indexedDbRows: [] })
}

async function unusedPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address()?.port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function startLocalAppHost(layout) {
  const port = await unusedPort()
  const distDir = path.join(layout.isolationRoot, 'host-dist')
  await mkdir(distDir, { recursive: true })
  await writeFile(path.join(distDir, 'index.html'), '<main>isolated workflow C2c Host</main>', 'utf8')
  const python = await resolveSelectedPython({
    repoRoot: repositoryRoot,
    configPath: path.join(repositoryRoot, 'config', 'runtime.optimization.json'),
  })
  const script = `
import json, os
from pathlib import Path
from fastapi import FastAPI
import uvicorn
from youtube_workflow.production_host_prototype import create_local_app_host
from youtube_workflow.windows_owner_registry import load_owner_registry

registry = load_owner_registry(Path(os.environ['C2C_REGISTRY']))
app = create_local_app_host(
    dist_dir=Path(os.environ['C2C_DIST']),
    workflow_app=FastAPI(),
    access_token=os.environ['C2C_TOKEN'],
    profile_id=os.environ['C2C_PROFILE_ID'],
    instance_id=os.environ['C2C_INSTANCE_ID'],
    owner_registry=registry,
    owner_profile_evidence=json.loads(os.environ['C2C_OWNER_EVIDENCE']),
    owner_repository_root=Path(os.environ['C2C_AUTHORITY_ROOT']),
    owner_receipt_root=Path(os.environ['C2C_AUTHORITY_ROOT']),
    owner_freeze_root=Path(os.environ['C2C_AUTHORITY_ROOT']),
    owner_migration_mode='optimization',
    owner_migration_domains=['workflow'],
    config_compatibility={'schemaVersion': 1, 'minimum': 1, 'maximum': 1},
)
uvicorn.run(app, host='127.0.0.1', port=int(os.environ['C2C_PORT']), log_level='warning', access_log=False)
`
  const child = spawn(python.executable, ['-c', script], {
    cwd: path.join(repositoryRoot, 'tools', 'subtitle-workflow'),
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: path.join(repositoryRoot, 'tools', 'subtitle-workflow'),
      C2C_DIST: distDir,
      C2C_REGISTRY: path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader', 'owner-registry.json'),
      C2C_TOKEN: accessToken,
      C2C_PROFILE_ID: profileId,
      C2C_INSTANCE_ID: instanceId,
      C2C_OWNER_EVIDENCE: JSON.stringify(ownerProfileEvidence()),
      C2C_AUTHORITY_ROOT: layout.profileAuthorityRoot,
      C2C_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const baseUrl = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local workflow C2c Host exited before ready: ${stderr.trim() || child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/api/app/health`, {
        headers: { 'X-Read-Web-Token': accessToken },
      })
      if (response.ok) return {
        child,
        baseUrl,
        accessToken,
        profileId,
        instanceId,
        health: await response.json(),
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  child.kill()
  await once(child, 'exit').catch(() => {})
  throw new Error(`Local workflow C2c Host did not become ready: ${stderr.trim() || 'timeout'}`)
}

async function stopLocalAppHost(host) {
  if (!host?.child || host.child.exitCode !== null) return
  host.child.kill()
  await once(host.child, 'exit').catch(() => {})
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
        try {
          const response = await fetchImpl(healthPath, { method: 'GET', credentials: 'same-origin' })
          return response?.ok === false || typeof response?.json !== 'function' ? null : response.json()
        } catch (_error) {
          return null
        }
      }
`,
    )
  return import(dataUrl(resolved))
}

function hostFetch(host, url, init = {}) {
  const target = new URL(String(url), host.baseUrl)
  return fetch(target, {
    ...init,
    headers: { ...(init.headers || {}), 'X-Read-Web-Token': host.accessToken },
  })
}

function workflowDomainCore(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    adapterVersion: snapshot.adapterVersion,
    revision: snapshot.revision,
    records: snapshot.records,
    references: snapshot.references,
    mediaReferences: snapshot.mediaReferences,
  }
}

function recordsById(records) {
  return Object.fromEntries((Array.isArray(records) ? records : []).map((record) => [record.id, record]))
}

async function queryWorkflow(client) {
  const [jobs, history, index, config] = await Promise.all([
    client.query({ domain: 'workflow', operation: 'job', payload: {} }),
    client.query({ domain: 'workflow', operation: 'history', payload: { limit: 200 } }),
    client.query({ domain: 'workflow', operation: 'reader-index', payload: {} }),
    client.query({ domain: 'workflow', operation: 'config', payload: {} }),
  ])
  return { jobs, history, index, config }
}

function assertWorkflowPayloads(queries, fixture, expectedJobs = 2) {
  assert.equal(queries.jobs.outcome, 'read')
  assert.equal(queries.history.outcome, 'read')
  assert.equal(queries.index.outcome, 'read')
  assert.equal(queries.config.outcome, 'read')
  assert.equal(queries.jobs.payload.records.length, expectedJobs)
  assert.equal(queries.history.payload.records.length, 2)
  assert.equal(queries.index.payload.records.length, 2)
  assert.equal(queries.config.payload.config.model, fixture.config.model)
  assert.equal(queries.config.payload.config.present, true)
  return queries
}

const browserCutoverModule = await loadBrowserCutoverModule()
const {
  assertWindowsOwnerBrowserWriterAllowed,
  initializeWindowsOwnerDomainCutoverComposition,
} = browserCutoverModule

const workRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-workflow-c2c-'))
let host = null
let reopenedHost = null
let browserGuard = null
try {
  const source = makeLayout(workRoot, 'source')
  const target = makeLayout(workRoot, 'target')
  const fixture = await seedSource(source)
  await seedTarget(target)

  host = await startLocalAppHost(target)
  assert.deepEqual(host.health.ownerMode?.authoritativeDomains, [])
  const migrationClient = await createWindowsOwnerProductionHostClient({
    baseUrl: host.baseUrl,
    accessToken: host.accessToken,
    profileId: host.profileId,
    instanceId: host.instanceId,
    migrationOnly: true,
    mode: 'optimization',
    explicitOptIn: true,
  })
  const ordinaryHostClient = await createWindowsOwnerProductionHostClient({
    baseUrl: host.baseUrl,
    accessToken: host.accessToken,
    profileId: host.profileId,
    instanceId: host.instanceId,
  })
  const ordinaryPreCutover = await ordinaryHostClient.query({
    domain: 'workflow',
    operation: 'config',
    payload: {},
  })
  assert.equal(ordinaryPreCutover.outcome, 'not-ready')

  const browserComposition = await initializeWindowsOwnerDomainCutoverComposition({
    windowObject: globalThis,
    health: host.health,
    ownerClient: migrationClient,
    fetchImpl: (url, init) => hostFetch(host, url, init),
    healthPath: `${host.baseUrl}/api/app/health`,
    healthTimeoutMs: 500,
  })
  assert.equal(browserComposition.status, 'not-ready')
  assert.ok(browserComposition.cutover, `workflow C2c needs an open browser guard: ${JSON.stringify(browserComposition.health)}`)
  browserGuard = browserComposition.cutover

  const result = await runWindowsOwnerProductionCutover({
    mode: 'optimization',
    explicitOptIn: true,
    profileId,
    source,
    target,
    domains: ['workflow'],
    sourceIdsByDomain: { workflow: ['backup.workflow'] },
    hostBaseUrl: host.baseUrl,
    hostAccessToken: host.accessToken,
    hostInstanceId: host.instanceId,
    browserGuard,
    refreshBrowserGuard: async ({ domain }) => {
      const marker = await readOwnerModeFreeze({ ...target, profileId, domain })
      assert.equal(marker?.status, 'frozen', 'workflow freeze marker must be visible to the open page')
      const refreshed = await browserGuard.refresh()
      assert.ok(refreshed.frozenDomains.includes(domain), 'open page must observe workflow freeze')
      assert.throws(
        () => assertWindowsOwnerBrowserWriterAllowed(domain, 'opened-browser-write', globalThis),
        /frozen after Host cutover/,
      )
      return { ok: true, observedFrozen: true, frozenDomains: refreshed.frozenDomains }
    },
    smokeByDomain: {
      workflow: async ({ client }) => {
        const queries = await queryWorkflow(client)
        assertWorkflowPayloads(queries, fixture)
        return { outcome: 'read', recordCounts: {
          jobs: queries.jobs.payload.records.length,
          history: queries.history.payload.records.length,
          readerIndex: queries.index.payload.records.length,
          config: 1,
        } }
      },
    },
  })

  assert.equal(result.ok, true, JSON.stringify(result))
  const workflowResult = result.domains[0]
  assert.equal(workflowResult.domain, 'workflow')
  assert.deepEqual(
    Object.keys(workflowResult.steps),
    ['inventory', 'dryRun', 'freeze', 'beforeFinalBackup', 'finalBackup', 'import', 'verify', 'switch', 'smoke'],
  )
  assert.equal(workflowResult.steps.dryRun.write, false)
  assert.deepEqual(workflowResult.steps.dryRun.sourceIds, ['backup.workflow'])
  assert.equal(workflowResult.steps.beforeFinalBackup.observedFrozen, true)
  assert.equal(workflowResult.steps.smoke.status, 'passed')

  const finalBackup = workflowResult.steps.finalBackup.finalBackup
  const finalWorkflow = finalBackup.artifact.domains.workflow
  assert.equal(finalWorkflow.records.length, 7)
  assert.equal(finalBackup.artifact.manifest.recordCounts.workflow, 7)
  assert.equal(
    finalBackup.artifact.manifest.domainChecksums.workflow,
    checksum(workflowDomainCore(finalWorkflow)),
  )
  assert.equal(
    Object.keys(finalBackup.artifact.manifest.recordChecksums)
      .filter((key) => key.startsWith('workflow:')).length,
    7,
  )
  const finalRecords = recordsById(finalWorkflow.records)
  assert.deepEqual(Object.keys(finalRecords).sort(), [
    'config',
    'items:workflow-job-1',
    'items:workflow-job-2',
    'jobs:workflow-job-1',
    'jobs:workflow-job-2',
    'reader-index:workflow-job-1',
    'reader-index:workflow-job-2',
  ])

  const checkpoint = await readOwnerModeCheckpoint({ ...target, profileId, domain: 'workflow' })
  assert.equal(checkpoint?.authorityMode, 'host-api=authoritative')
  assert.equal(await readOwnerModeFreeze({ ...target, profileId, domain: 'workflow' }), null)

  const authoritative = await browserGuard.refresh()
  assert.ok(authoritative.authoritativeDomains.includes('workflow'))
  assert.equal(browserGuard.isAuthoritative('workflow'), true)

  const clientSource = await readFile(path.join(repositoryRoot, 'src/composables/youtube-workflow-client.js'), 'utf8')
  const workflowClientModule = await import(dataUrl(
    clientSource.replace(
      "import { recordBestEffortFailure } from '../services/runtime/best-effort.js'\n",
      'const recordBestEffortFailure = () => null\n',
    ),
  ))
  let legacyFetchCalls = 0
  const browserClient = workflowClientModule.createYoutubeWorkflowClient({
    baseUrl: 'http://127.0.0.1:1',
    accessToken: 'unused',
    fetchImpl: async () => {
      legacyFetchCalls += 1
      throw new Error('legacy durable workflow endpoint was called')
    },
  })
  const clientSnapshot = await browserClient.getJobsSnapshot([], { includeAll: true })
  assert.equal(clientSnapshot.jobs.length, 2)
  assert.equal((await browserClient.history({ limit: 20 })).length, 2)
  assert.equal((await browserClient.getReaderIndex()).items.length, 2)
  assert.equal((await browserClient.getConfig()).model, fixture.config.model)

  const expectedRevision = clientSnapshot.revision
  const savedConfig = await browserClient.saveConfig(
    { model: 'workflow-c2c-client-model', baseUrl: 'https://workflow.example/v2' },
    { expectedRevision, idempotencyKey: 'workflow-c2c-client-config' },
  )
  assert.equal(savedConfig.model, 'workflow-c2c-client-model')
  assert.equal((await browserClient.getConfig()).model, 'workflow-c2c-client-model')

  const created = await browserClient.createJob(
    { url: 'https://www.youtube.com/watch?v=workflow-c2c-3', geminiMode: 'mock' },
    { expectedRevision, idempotencyKey: 'workflow-c2c-client-job' },
  )
  assert.equal(created.status, 'queued')
  assert.equal((await browserClient.getJobsSnapshot([], { includeAll: true })).jobs.length, 3)
  const canceled = await browserClient.cancelJob(
    created.jobId,
    { expectedRevision: created.revision, idempotencyKey: 'workflow-c2c-client-cancel' },
  )
  assert.equal(canceled.status, 'canceled')
  assert.equal(legacyFetchCalls, 0)

  const legacyConfigResponse = await hostFetch(reopenedHost || host, '/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'legacy-must-be-blocked' }),
  })
  assert.equal(legacyConfigResponse.status, 409)
  const legacyConfigBody = await legacyConfigResponse.json()
  assert.equal(legacyConfigBody.error?.code, 'legacy-writer-frozen')

  await stopLocalAppHost(host)
  host = null
  reopenedHost = await startLocalAppHost(target)
  assert.deepEqual(reopenedHost.health.ownerMode?.authoritativeDomains, ['workflow'])
  const reopenedClient = await createWindowsOwnerProductionHostClient({
    baseUrl: reopenedHost.baseUrl,
    accessToken: reopenedHost.accessToken,
    profileId: reopenedHost.profileId,
    instanceId: reopenedHost.instanceId,
  })
  const reopenedQueries = await queryWorkflow(reopenedClient)
  assert.equal(reopenedQueries.jobs.outcome, 'read')
  assert.equal(reopenedQueries.jobs.payload.records.length, 3)
  assert.equal(reopenedQueries.history.payload.records.length, 2)
  assert.equal(reopenedQueries.index.payload.records.length, 2)
  assert.equal(reopenedQueries.config.payload.config.model, 'workflow-c2c-client-model')
  assert.equal(reopenedQueries.config.payload.config.baseUrl, 'https://workflow.example/v2')
  assert.ok(reopenedQueries.jobs.payload.records.some((record) => record.jobId === created.jobId && record.status === 'canceled'))

  const reopenedLegacyResponse = await hostFetch(reopenedHost, '/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://legacy.invalid' }),
  })
  assert.equal(reopenedLegacyResponse.status, 409)

  globalThis.__windowsOwnerDomainCutover = {
    isAuthoritative(domain) { return domain === 'workflow' },
    async query() { throw new Error('workflow Host unavailable') },
    async command() { throw new Error('workflow Host unavailable') },
  }
  try {
    let failedLegacyCalls = 0
    const failClosedClient = workflowClientModule.createYoutubeWorkflowClient({
      baseUrl: 'http://127.0.0.1:1',
      fetchImpl: async () => {
        failedLegacyCalls += 1
        throw new Error('legacy durable fallback is forbidden')
      },
    })
    await assert.rejects(failClosedClient.getConfig(), /workflow Host unavailable/)
    assert.equal(failedLegacyCalls, 0)
  } finally {
    globalThis.__windowsOwnerDomainCutover = browserGuard
  }

  await stopLocalAppHost(reopenedHost)
  reopenedHost = null
  console.log('Windows owner workflow C2c migration and typed-client checks passed.')
} finally {
  await stopLocalAppHost(reopenedHost)
  await stopLocalAppHost(host)
  browserGuard?.dispose?.()
  await rm(workRoot, { recursive: true, force: true })
}
