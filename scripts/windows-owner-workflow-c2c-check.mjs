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
    cookiesPath: path.join(isolationRoot, 'cookies.txt'),
    ytDlpPath: path.join(isolationRoot, 'yt-dlp.exe'),
    whisperxPath: path.join(isolationRoot, 'whisperx.exe'),
    reconfiguredOutputDir: isolationRoot,
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
    status: 'ready',
    stage: 'ready',
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
    status: 'failed',
    stage: 'failed',
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
    status: 'ready',
    stage: 'ready',
  }
  const secondHistory = {
    ...secondJob,
    status: 'failed',
    stage: 'download',
    finishedAt: '2026-08-30T00:03:01Z',
    error: { code: 'fixture-download', message: 'fixture failure' },
  }
  const historyOnly = {
    jobId: 'workflow-history-only',
    status: 'ready',
    stage: 'ready',
    createdAt: '2026-08-30T00:04:01Z',
    updatedAt: '2026-08-30T00:05:01Z',
    finishedAt: '2026-08-30T00:05:01Z',
    title: 'Workflow history-only fixture',
    url: 'https://www.youtube.com/watch?v=workflow-history-only',
    sourceType: 'youtube',
    request: {
      url: 'https://www.youtube.com/watch?v=workflow-history-only',
      geminiMode: 'mock',
      model: 'workflow-c2c-model',
      baseUrl: 'https://workflow.example/v1',
      videoPriority: false,
    },
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
    history: [firstHistory, secondHistory, historyOnly],
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
  const outputDir = path.join(layout.pythonOutputDir, 'workflow-job-1')
  fixture.config.cookiesPath = layout.cookiesPath
  fixture.config.outputDir = layout.pythonOutputDir
  fixture.config.ytDlpPath = layout.ytDlpPath
  fixture.config.whisperxPath = layout.whisperxPath
  fixture.jobs[0].outputDir = outputDir
  fixture.history[0].outputDir = outputDir
  const audioPath = path.join(outputDir, 'fixture-audio.mp3')
  const manifest = {
    schemaVersion: 1,
    jobId: 'workflow-job-1',
    outputDir,
    files: { audio: audioPath },
  }
  fixture.jobs[0].manifest = manifest
  fixture.history[0].manifest = manifest
  await mkdir(layout.pythonOutputDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })
  await writeFile(audioPath, 'non-empty workflow media fixture', 'utf8')
  await writeJson(path.join(outputDir, 'output.json'), {
    schemaVersion: 1,
    revision: 1,
    jobId: 'workflow-job-1',
    result: 'non-empty workflow output fixture',
  })
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
import json, os, time
from pathlib import Path
import uvicorn
from youtube_workflow.core import WorkflowConfig
from youtube_workflow.service import JobManager, create_app as create_workflow_app
from youtube_workflow.production_host_prototype import create_local_app_host
from youtube_workflow.windows_owner_registry import load_owner_registry

class C2cRunner:
    def __init__(self, config):
        self.config = config
        self.cancel_event = None

    def _effect(self, job_id, status):
        path = Path(os.environ['C2C_EFFECTS'])
        with path.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'jobId': job_id, 'status': status}) + '\\n')

    def cancel(self):
        if self.cancel_event is not None:
            self.cancel_event.set()

    def run(self, request, job_id, emit=None, cancel_event=None):
        self.cancel_event = cancel_event
        self._effect(job_id, 'accepted')
        if emit:
            emit({'jobId': job_id, 'status': 'running', 'stage': 'downloading', 'message': 'fixture runner accepted'})
        if 'hold' in request.url:
            while not cancel_event.is_set():
                time.sleep(0.01)
            self._effect(job_id, 'canceled')
            raise RuntimeError('fixture runner canceled')
        if 'fail' in request.url:
            self._effect(job_id, 'failed')
            raise RuntimeError('fixture runner failed')
        output_dir = Path(self.config.output_dir) / job_id
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / 'fixture-audio.mp3').write_text(
            'non-empty workflow runner audio fixture',
            encoding='utf-8',
        )
        (output_dir / 'transcript.json').write_text(
            json.dumps({
                'segments': [
                    {'start': 0, 'end': 1, 'text': 'workflow runner fixture'},
                ],
            }),
            encoding='utf-8',
        )
        (output_dir / 'output.json').write_text(
            json.dumps({
                'revision': 1,
                's': [{'chunks': [{'text': 'workflow runner fixture'}]}],
            }),
            encoding='utf-8',
        )
        (output_dir / 'runner-output.json').write_text(
            json.dumps({'jobId': job_id, 'result': 'runner side effect'}, ensure_ascii=False),
            encoding='utf-8',
        )
        self._effect(job_id, 'ready')
        return {
            'schemaVersion': 1,
            'jobId': job_id,
            'title': job_id,
            'url': request.url,
            'status': 'ready',
            'stage': 'ready',
            'outputDir': str(Path(self.config.output_dir) / job_id),
            'request': request.safe_manifest_request(),
            'files': {
                'audio': str(output_dir / 'fixture-audio.mp3'),
                'transcript': str(output_dir / 'transcript.json'),
                'chunkData': str(output_dir / 'output.json'),
            },
            'logSummary': ['fixture runner accepted'],
            'error': None,
        }

registry = load_owner_registry(Path(os.environ['C2C_REGISTRY']))
config = WorkflowConfig(
    state_dir=Path(os.environ['C2C_STATE']),
    output_dir=Path(os.environ['C2C_OUTPUT']),
    cookies_path=Path(os.environ['C2C_COOKIES']),
    yt_dlp_path=Path(os.environ['C2C_YTDLP']),
    whisperx_path=Path(os.environ['C2C_WHISPERX']),
)
manager = JobManager(
    config=config,
    runner_factory=lambda: C2cRunner(config),
    persistence_delay_seconds=0.01,
)
workflow = create_workflow_app(
    manager=manager,
    access_token=os.environ['C2C_TOKEN'],
    profile_id=os.environ['C2C_PROFILE_ID'],
)
app = create_local_app_host(
    dist_dir=Path(os.environ['C2C_DIST']),
    workflow_app=workflow,
    workflow_service_manager=manager,
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
    owner_workflow_state_dir=Path(os.environ['C2C_STATE']),
    owner_workflow_output_dir=Path(os.environ['C2C_OUTPUT']),
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
      C2C_STATE: layout.pythonStateDir,
      C2C_OUTPUT: layout.pythonOutputDir,
      C2C_COOKIES: layout.cookiesPath,
      C2C_YTDLP: layout.ytDlpPath,
      C2C_WHISPERX: layout.whisperxPath,
      C2C_EFFECTS: path.join(layout.isolationRoot, 'runner-effects.jsonl'),
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
  if (!host?.child || host.child.exitCode !== null || host.child.killed) return
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

async function waitFor(check, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`${label} did not become true${lastError ? `: ${lastError.message}` : ''}`)
}

async function readRunnerEffects(layout) {
  try {
    const text = await readFile(path.join(layout.isolationRoot, 'runner-effects.jsonl'), 'utf8')
    return text.trim() ? text.trim().split(/\r?\n/u).map((line) => JSON.parse(line)) : []
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
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
  assert.equal(queries.history.payload.records.length, fixture.history.length)
  assert.equal(queries.index.payload.records.length, fixture.readerIndex.items.length)
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
  let ordinaryHostClient = await createWindowsOwnerProductionHostClient({
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
  assert.equal(finalWorkflow.records.length, 9)
  assert.equal(finalBackup.artifact.manifest.recordCounts.workflow, 9)
  assert.equal(
    finalBackup.artifact.manifest.domainChecksums.workflow,
    checksum(workflowDomainCore(finalWorkflow)),
  )
  assert.equal(
    Object.keys(finalBackup.artifact.manifest.recordChecksums)
      .filter((key) => key.startsWith('workflow:')).length,
    9,
  )
  const finalRecords = recordsById(finalWorkflow.records)
  assert.deepEqual(Object.keys(finalRecords).sort(), [
    'config',
    'items:workflow-history-only',
    'items:workflow-job-1',
    'items:workflow-job-2',
    'jobs:workflow-job-1',
    'jobs:workflow-job-2',
    'output:workflow-job-1/output.json',
    'reader-index:workflow-job-1',
    'reader-index:workflow-job-2',
  ])
  assert.equal(finalRecords['output:workflow-job-1/output.json'].payload.result, 'non-empty workflow output fixture')
  assert.deepEqual(finalRecords['output:workflow-job-1/output.json'].references, [
    { type: 'workflow-job', id: 'workflow-job-1' },
  ])
  assert.equal(finalRecords.config.payload.outputDir, '.')
  assert.equal(finalRecords.config.payload.ytDlpPath, '[REDACTED_PATH]')
  assert.equal(finalRecords.config.payload.whisperxPath, '[REDACTED_PATH]')
  assert.equal(Object.prototype.hasOwnProperty.call(finalRecords.config.payload, 'cookiesPath'), false)

  const checkpoint = await readOwnerModeCheckpoint({ ...target, profileId, domain: 'workflow' })
  assert.equal(checkpoint?.authorityMode, 'host-api=authoritative')
  assert.equal(await readOwnerModeFreeze({ ...target, profileId, domain: 'workflow' }), null)

  const authoritative = await browserGuard.refresh()
  assert.ok(authoritative.authoritativeDomains.includes('workflow'))
  assert.equal(browserGuard.isAuthoritative('workflow'), true)
  const targetMediaDir = path.join(target.pythonOutputDir, 'workflow-job-1')
  await mkdir(targetMediaDir, { recursive: true })
  await writeFile(path.join(targetMediaDir, 'fixture-audio.mp3'), 'non-empty workflow media fixture', 'utf8')

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
  assert.equal((await browserClient.history({ limit: 20 })).length, fixture.history.length)
  assert.equal((await browserClient.getReaderIndex()).items.length, 2)
  assert.equal((await browserClient.getConfig()).model, fixture.config.model)
  assert.equal((await browserClient.getHistory('workflow-history-only')).jobId, 'workflow-history-only')

  const jobsSnapshot = () => browserClient.getJobsSnapshot([], { includeAll: true })
  const jobsRevision = async () => (await jobsSnapshot()).revision
  const importedConfig = await browserClient.getConfig()
  assert.equal(path.resolve(importedConfig.outputDir), path.resolve(target.pythonOutputDir))
  assert.equal(path.resolve(importedConfig.cookiesPath), path.resolve(target.cookiesPath))
  assert.equal(importedConfig.ytDlpPath, target.ytDlpPath)
  assert.equal(importedConfig.whisperxPath, target.whisperxPath)
  await stopLocalAppHost(host)
  host = null
  reopenedHost = await startLocalAppHost(target)
  host = reopenedHost
  assert.deepEqual(reopenedHost.health.ownerMode?.authoritativeDomains, ['workflow'])
  const reopenedMigrationClient = await createWindowsOwnerProductionHostClient({
    baseUrl: reopenedHost.baseUrl,
    accessToken: reopenedHost.accessToken,
    profileId: reopenedHost.profileId,
    instanceId: reopenedHost.instanceId,
    migrationOnly: true,
    mode: 'optimization',
    explicitOptIn: true,
  })
  ordinaryHostClient = await createWindowsOwnerProductionHostClient({
    baseUrl: reopenedHost.baseUrl,
    accessToken: reopenedHost.accessToken,
    profileId: reopenedHost.profileId,
    instanceId: reopenedHost.instanceId,
  })
  browserGuard?.dispose?.()
  const reopenedBrowserComposition = await initializeWindowsOwnerDomainCutoverComposition({
    windowObject: globalThis,
    health: reopenedHost.health,
    ownerClient: reopenedMigrationClient,
    fetchImpl: (url, init) => hostFetch(reopenedHost, url, init),
    healthPath: `${reopenedHost.baseUrl}/api/app/health`,
    healthTimeoutMs: 500,
  })
  assert.ok(reopenedBrowserComposition.cutover)
  browserGuard = reopenedBrowserComposition.cutover
  const reopenedImportedConfig = await browserClient.getConfig()
  assert.equal(path.resolve(reopenedImportedConfig.outputDir), path.resolve(target.pythonOutputDir))
  assert.equal(path.resolve(reopenedImportedConfig.cookiesPath), path.resolve(target.cookiesPath))
  assert.equal(reopenedImportedConfig.ytDlpPath, target.ytDlpPath)
  assert.equal(reopenedImportedConfig.whisperxPath, target.whisperxPath)
  const sanitizedStart = await browserClient.createJob(
    {
      url: 'https://www.youtube.com/watch?v=workflow-c2c-sanitized-import-start',
      geminiMode: 'mock',
      forceReprocess: true,
    },
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-sanitized-import-start' },
  )
  assert.equal(sanitizedStart.status, 'queued')
  await waitFor(async () => {
    const job = (await jobsSnapshot()).jobs.find((item) => item.jobId === sanitizedStart.jobId)
    return job?.status === 'ready' ? job : null
  }, 'sanitized config imported runner job')
  assert.ok((await readRunnerEffects(target)).some((effect) => effect.jobId === sanitizedStart.jobId && effect.status === 'accepted'))
  assert.equal(
    JSON.parse(await readFile(path.join(target.pythonOutputDir, sanitizedStart.jobId, 'runner-output.json'), 'utf8')).jobId,
    sanitizedStart.jobId,
  )
  const configuredPaths = {
    cookiesPath: path.join(target.isolationRoot, 'cookies.txt'),
    outputDir: target.reconfiguredOutputDir,
    ytDlpPath: path.join(target.isolationRoot, 'yt-dlp.exe'),
    whisperxPath: path.join(target.isolationRoot, 'whisperx.exe'),
  }
  const configuredConfig = {
    model: 'workflow-c2c-client-model',
    baseUrl: 'https://workflow.example/v2',
    proxyUrl: 'http://127.0.0.1:8899',
    ...configuredPaths,
  }
  const savedConfig = await browserClient.saveConfig(
    configuredConfig,
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-client-config' },
  )
  assert.equal(savedConfig.model, 'workflow-c2c-client-model')
  const savedConfigQuery = await browserClient.getConfig()
  for (const [key, value] of Object.entries(configuredConfig)) assert.equal(savedConfigQuery[key], value)
  const migratedMedia = await ordinaryHostClient.query({
    domain: 'workflow',
    operation: 'media-capability',
    payload: { jobId: 'workflow-job-1', mediaKind: 'audio' },
  })
  assert.equal(migratedMedia.outcome, 'read')
  assert.equal(migratedMedia.payload.found, true)

  const emptyOptionalPaths = {
    ...configuredConfig,
    cookiesPath: '',
    outputDir: '',
    ytDlpPath: '',
    whisperxPath: '',
  }
  await browserClient.saveConfig(
    emptyOptionalPaths,
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-empty-optional-paths' },
  )
  const emptyPathConfig = await browserClient.getConfig()
  assert.equal(path.resolve(emptyPathConfig.cookiesPath), path.resolve(target.cookiesPath))
  assert.equal(path.resolve(emptyPathConfig.outputDir), path.resolve(target.pythonOutputDir))
  assert.equal(emptyPathConfig.ytDlpPath, target.ytDlpPath)
  assert.equal(emptyPathConfig.whisperxPath, target.whisperxPath)
  const emptyOwnerConfig = await ordinaryHostClient.query({
    domain: 'workflow',
    operation: 'config',
    payload: {},
  })
  assert.equal(path.resolve(emptyOwnerConfig.payload.config.outputDir), path.resolve(target.pythonOutputDir))
  const emptyDefaultStart = await browserClient.createJob(
    {
      url: 'https://www.youtube.com/watch?v=workflow-c2c-empty-default-immediate',
      geminiMode: 'mock',
      forceReprocess: true,
    },
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-empty-default-immediate' },
  )
  assert.equal(emptyDefaultStart.status, 'queued')
  await waitFor(async () => {
    const job = (await jobsSnapshot()).jobs.find((item) => item.jobId === emptyDefaultStart.jobId)
    return job?.status === 'ready' ? job : null
  }, 'empty optional paths immediate default runner job')
  assert.equal(
    JSON.parse(await readFile(path.join(target.pythonOutputDir, emptyDefaultStart.jobId, 'runner-output.json'), 'utf8')).jobId,
    emptyDefaultStart.jobId,
  )

  await stopLocalAppHost(host)
  host = null
  reopenedHost = await startLocalAppHost(target)
  host = reopenedHost
  assert.deepEqual(reopenedHost.health.ownerMode?.authoritativeDomains, ['workflow'])
  const reopenedDefaultMigrationClient = await createWindowsOwnerProductionHostClient({
    baseUrl: reopenedHost.baseUrl,
    accessToken: reopenedHost.accessToken,
    profileId: reopenedHost.profileId,
    instanceId: reopenedHost.instanceId,
    migrationOnly: true,
    mode: 'optimization',
    explicitOptIn: true,
  })
  ordinaryHostClient = await createWindowsOwnerProductionHostClient({
    baseUrl: reopenedHost.baseUrl,
    accessToken: reopenedHost.accessToken,
    profileId: reopenedHost.profileId,
    instanceId: reopenedHost.instanceId,
  })
  browserGuard?.dispose?.()
  const reopenedDefaultBrowserComposition = await initializeWindowsOwnerDomainCutoverComposition({
    windowObject: globalThis,
    health: reopenedHost.health,
    ownerClient: reopenedDefaultMigrationClient,
    fetchImpl: (url, init) => hostFetch(reopenedHost, url, init),
    healthPath: `${reopenedHost.baseUrl}/api/app/health`,
    healthTimeoutMs: 500,
  })
  assert.ok(reopenedDefaultBrowserComposition.cutover)
  browserGuard = reopenedDefaultBrowserComposition.cutover
  const reopenedEmptyPathConfig = await browserClient.getConfig()
  assert.equal(path.resolve(reopenedEmptyPathConfig.cookiesPath), path.resolve(target.cookiesPath))
  assert.equal(path.resolve(reopenedEmptyPathConfig.outputDir), path.resolve(target.pythonOutputDir))
  assert.equal(reopenedEmptyPathConfig.ytDlpPath, target.ytDlpPath)
  assert.equal(reopenedEmptyPathConfig.whisperxPath, target.whisperxPath)
  const reopenedEmptyOwnerConfig = await ordinaryHostClient.query({
    domain: 'workflow',
    operation: 'config',
    payload: {},
  })
  assert.equal(path.resolve(reopenedEmptyOwnerConfig.payload.config.outputDir), path.resolve(target.pythonOutputDir))
  const emptyDefaultRestartStart = await browserClient.createJob(
    {
      url: 'https://www.youtube.com/watch?v=workflow-c2c-empty-default-restart',
      geminiMode: 'mock',
      forceReprocess: true,
    },
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-empty-default-restart' },
  )
  assert.equal(emptyDefaultRestartStart.status, 'queued')
  await waitFor(async () => {
    const job = (await jobsSnapshot()).jobs.find((item) => item.jobId === emptyDefaultRestartStart.jobId)
    return job?.status === 'ready' ? job : null
  }, 'empty optional paths reopened default runner job')
  assert.equal(
    JSON.parse(await readFile(path.join(target.pythonOutputDir, emptyDefaultRestartStart.jobId, 'runner-output.json'), 'utf8')).jobId,
    emptyDefaultRestartStart.jobId,
  )
  await browserClient.saveConfig(
    configuredConfig,
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-client-config-restored' },
  )
  const restoredConfig = await browserClient.getConfig()
  for (const [key, value] of Object.entries(configuredConfig)) assert.equal(restoredConfig[key], value)
  assert.equal(path.resolve(restoredConfig.outputDir), path.resolve(target.reconfiguredOutputDir))

  await assert.rejects(
    browserClient.createJob(
      { url: fixture.jobs[0].url, geminiMode: 'mock' },
      { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-duplicate-material' },
    ),
    (error) => {
      assert.equal(error.code, 'MATERIAL_ALREADY_EXISTS')
      assert.equal(error.status, 409)
      assert.equal(error.detail?.materialKey, 'youtube:workflow-c2c-1')
      assert.equal(error.detail?.existing?.jobId, 'workflow-job-1')
      return true
    },
  )

  const createTypedJobWithKey = async (id, idempotencyKey, extra = {}) => {
    return browserClient.createJob(
      {
        url: `https://www.youtube.com/watch?v=workflow-c2c-${id}`,
        geminiMode: 'mock',
        forceReprocess: true,
        ...extra,
      },
      { expectedRevision: await jobsRevision(), idempotencyKey },
    )
  }
  const createTypedJob = async (id, extra = {}) => {
    const job = await createTypedJobWithKey(id, `workflow-c2c-${id}-create`, extra)
    assert.equal(job.status, 'queued')
    return job
  }
  const waitForJobStatus = (jobId, status) => waitFor(async () => {
    const jobs = (await jobsSnapshot()).jobs
    const job = jobs.find((item) => item.jobId === jobId)
    return job?.status === status ? job : null
  }, `job ${jobId} to become ${status}`)

  const outputRootJob = await createTypedJob('output-root')
  await waitForJobStatus(outputRootJob.jobId, 'ready')
  const outputRootFile = path.join(configuredPaths.outputDir, outputRootJob.jobId, 'runner-output.json')
  assert.equal(JSON.parse(await readFile(outputRootFile, 'utf8')).jobId, outputRootJob.jobId)
  const outputRootSnapshot = await jobsSnapshot()
  assert.ok(outputRootSnapshot.jobs.some((job) => job.jobId === outputRootJob.jobId))
  const outputBackupQuery = await ordinaryHostClient.query({
    domain: 'workflow',
    operation: 'job',
    payload: {},
  })
  const outputBackup = outputBackupQuery.payload.backupRecords
    .find((record) => record.contentId === outputRootJob.jobId && record.id === `output:${outputRootJob.jobId}/runner-output.json`)
  assert.ok(outputBackup, JSON.stringify(outputBackupQuery.payload.backupRecords
    .filter((record) => record.contentId === outputRootJob.jobId)
    .map((record) => ({ id: record.id, payload: record.payload }))))
  assert.equal(outputBackup.payload.result, 'runner side effect')
  const outputMedia = await ordinaryHostClient.query({
    domain: 'workflow',
    operation: 'media-capability',
    payload: { jobId: 'workflow-job-1', mediaKind: 'audio' },
  })
  assert.equal(outputMedia.payload.found, true)

  const created = await createTypedJob('create')
  await waitForJobStatus(created.jobId, 'ready')
  const createdEffects = await readRunnerEffects(target)
  assert.ok(createdEffects.some((effect) => effect.jobId === created.jobId && effect.status === 'accepted'))
  const replayedCreated = await createTypedJobWithKey('create', 'workflow-c2c-create-create')
  assert.equal(replayedCreated.jobId, created.jobId)
  assert.equal(replayedCreated.idempotent, true)
  assert.equal(
    (await readRunnerEffects(target)).filter((effect) => effect.jobId === created.jobId && effect.status === 'accepted').length,
    1,
  )

  const hold = await createTypedJob('hold-cancel', { url: 'https://www.youtube.com/watch?v=workflow-c2c-hold-cancel' })
  await waitFor(() => readRunnerEffects(target).then((effects) => effects.some((effect) => effect.jobId === hold.jobId && effect.status === 'accepted')), 'cancel runner acceptance')
  await assert.rejects(
    browserClient.retryJob(
      hold.jobId,
      {},
      { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-retry-running-conflict' },
    ),
    (error) => {
      assert.equal(error.code, 'WORKFLOW_RETRY_NOT_ALLOWED')
      assert.equal(error.status, 409)
      return true
    },
  )
  await assert.rejects(
    browserClient.deleteJob(
      hold.jobId,
      { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-delete-running-conflict' },
    ),
    (error) => {
      assert.equal(error.code, 'WORKFLOW_DELETE_NOT_ALLOWED')
      assert.equal(error.status, 409)
      return true
    },
  )
  const pendingCancel = await createTypedJob('pending-cancel')
  const pendingCancelStartedAt = Date.now()
  const pendingCanceled = await browserClient.cancelJob(
    pendingCancel.jobId,
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-pending-cancel-command' },
  )
  assert.ok(Date.now() - pendingCancelStartedAt < 1000, 'pending cancellation must not wait for another running job')
  assert.equal(pendingCanceled.jobId, pendingCancel.jobId)
  assert.equal(pendingCanceled.status, 'canceled')
  assert.equal((await browserClient.getJob(pendingCancel.jobId)).status, 'canceled')
  assert.equal(
    (await readRunnerEffects(target)).filter((effect) => effect.jobId === pendingCancel.jobId && effect.status === 'accepted').length,
    0,
  )
  const activeHold = await browserClient.getJob(hold.jobId)
  assert.ok(!['ready', 'failed', 'canceled'].includes(activeHold.status))
  assert.equal(activeHold.stage, 'downloading')
  const canceled = await browserClient.cancelJob(
    hold.jobId,
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-hold-cancel-command' },
  )
  assert.ok(['running', 'canceled'].includes(canceled.status))
  await waitForJobStatus(hold.jobId, 'canceled')
  assert.ok((await readRunnerEffects(target)).some((effect) => effect.jobId === hold.jobId && effect.status === 'canceled'))

  const priorityHold = await createTypedJob('hold-priority', { url: 'https://www.youtube.com/watch?v=workflow-c2c-hold-priority' })
  await waitFor(() => readRunnerEffects(target).then((effects) => effects.some((effect) => effect.jobId === priorityHold.jobId && effect.status === 'accepted')), 'priority runner acceptance')
  const low = await createTypedJob('low')
  const priority = await createTypedJob('priority')
  const prioritized = await browserClient.prioritizeJob(
    priority.jobId,
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-priority-command' },
  )
  assert.equal(prioritized.jobId, priority.jobId)
  assert.equal(prioritized.status, 'queued')
  const priorityCanceled = await browserClient.cancelJob(
    priorityHold.jobId,
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-priority-hold-cancel' },
  )
  assert.ok(['running', 'canceled'].includes(priorityCanceled.status))
  await waitForJobStatus(priorityHold.jobId, 'canceled')
  await waitForJobStatus(priority.jobId, 'ready')
  await waitForJobStatus(low.jobId, 'ready')
  const priorityEffects = (await readRunnerEffects(target)).filter((effect) => effect.status === 'accepted').map((effect) => effect.jobId)
  assert.ok(priorityEffects.indexOf(priority.jobId) >= 0 && priorityEffects.indexOf(low.jobId) >= 0)
  assert.ok(priorityEffects.indexOf(priority.jobId) < priorityEffects.indexOf(low.jobId), 'prioritized job must reach the runner first')

  const failing = await createTypedJob('fail-original', { url: 'https://www.youtube.com/watch?v=workflow-c2c-fail-original' })
  await waitForJobStatus(failing.jobId, 'failed')
  assert.ok((await readRunnerEffects(target)).some((effect) => effect.jobId === failing.jobId && effect.status === 'failed'))
  const retried = await browserClient.retryJob(
    failing.jobId,
    { stage: 'downloading' },
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-retry-command' },
  )
  assert.equal(retried.retryOf, failing.jobId)
  await waitForJobStatus(retried.jobId, 'failed')
  assert.ok((await readRunnerEffects(target)).some((effect) => effect.jobId === retried.jobId && effect.status === 'failed'))
  const replayedRetry = await browserClient.retryJob(
    failing.jobId,
    { stage: 'downloading' },
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-retry-command' },
  )
  assert.equal(replayedRetry.jobId, retried.jobId)
  assert.equal(replayedRetry.idempotent, true)
  assert.equal(
    (await readRunnerEffects(target)).filter((effect) => effect.jobId === retried.jobId && effect.status === 'failed').length,
    1,
  )

  const deleted = await browserClient.deleteJob(
    retried.jobId,
    { expectedRevision: await jobsRevision(), idempotencyKey: 'workflow-c2c-delete-command' },
  )
  assert.equal(deleted.deleted, true)
  await waitFor(async () => !(await jobsSnapshot()).jobs.some((job) => job.jobId === retried.jobId), 'retry deletion')

  const clearCandidate = await createTypedJob('fail-clear', { url: 'https://www.youtube.com/watch?v=workflow-c2c-fail-clear' })
  await waitForJobStatus(clearCandidate.jobId, 'failed')
  const cleared = await browserClient.clearFailedJobs({
    expectedRevision: await jobsRevision(),
    idempotencyKey: 'workflow-c2c-clear-failed-command',
  })
  assert.ok(cleared.cleared >= 1)
  await waitFor(async () => !(await jobsSnapshot()).jobs.some((job) => job.status === 'failed'), 'failed jobs to clear')
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
  assert.ok(reopenedQueries.jobs.payload.records.length >= 2)
  assert.ok(reopenedQueries.history.payload.records.length >= fixture.history.length)
  assert.equal(reopenedQueries.index.payload.records.length, 2)
  for (const [key, value] of Object.entries(configuredConfig)) assert.equal(reopenedQueries.config.payload.config[key], value)
  const reopenedOutput = reopenedQueries.jobs.payload.backupRecords.find(
    (record) => record.contentId === 'workflow-job-1' && record.payload?.result === 'non-empty workflow output fixture',
  )
  assert.equal(reopenedOutput?.payload?.result, 'non-empty workflow output fixture')
  assert.equal(reopenedOutput?.id, 'output:python-output/workflow-job-1/output.json')
  assert.match(reopenedOutput?.checksum || '', /^sha256:/u)
  assert.ok(reopenedQueries.jobs.payload.records.some((record) => record.jobId === hold.jobId && record.status === 'canceled'))
  assert.ok(!reopenedQueries.jobs.payload.records.some((record) => record.jobId === retried.jobId))
  assert.ok(!reopenedQueries.jobs.payload.records.some((record) => record.status === 'failed'))

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
