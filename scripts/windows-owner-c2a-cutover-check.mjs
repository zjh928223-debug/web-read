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
const PRODUCTION_DOMAINS = ['reader-session', 'marks-activity']
const ALL_OWNER_DOMAINS = [
  'reader-session',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'marks-activity',
  'workflow',
]

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
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`
}

function makeLayout(root, name) {
  const instanceRoot = path.join(root, `${name}-instance`)
  const authorityIsolationRoot = path.join(root, `${name}-authority`)
  return {
    isolationRoot: instanceRoot,
    profileDir: path.join(instanceRoot, 'profile'),
    pythonStateDir: path.join(instanceRoot, 'python-state'),
    pythonOutputDir: path.join(instanceRoot, 'python-output'),
    profileAuthorityIsolationRoot: authorityIsolationRoot,
    profileAuthorityRoot: path.join(authorityIsolationRoot, 'profile-authority'),
  }
}

function makeHealth(frozenDomains, authoritativeDomains = []) {
  const frozen = new Set(frozenDomains)
  const authoritative = new Set(authoritativeDomains)
  return {
    profileId: 'c2a-production-profile',
    instanceId: 'c2a-production-instance',
    liveness: { ready: true },
    contractValid: true,
    profileEvidenceReady: true,
    ownerRegistry: { valid: true },
    ownerMode: {
      status: frozen.size ? 'frozen' : authoritative.size ? 'authoritative' : 'pre-cutover',
      authoritativeDomains: [...authoritative],
      frozenDomains: [...frozen],
    },
    domains: PRODUCTION_DOMAINS.map((domain) => ({
      domain,
      authority: authoritative.has(domain) ? 'authoritative' : 'pre-cutover',
      queryCapability: 'read-only',
      commandCapability: authoritative.has(domain) ? 'writable' : 'not-ready',
      writerFrozen: frozen.has(domain),
    })),
  }
}

function ownerProfileEvidence(profileId) {
  const verified = {
    bound: true,
    status: 'verified',
    source: 'read-web-production-backup.composition',
  }
  const bindings = {
    backupAdapterRegistry: {
      ...verified,
      requiredDomains: [...ALL_OWNER_DOMAINS],
    },
    applicationLease: {
      ...verified,
      source: 'read-web-production-backup.application-profile-lease',
    },
    transaction: { ...verified },
    revision: { ...verified },
    recovery: { ...verified },
    domains: {},
  }
  for (const domain of ALL_OWNER_DOMAINS) {
    bindings.domains[domain] = {
      backupAdapter: {
        ...verified,
        key: domain,
        schemaVersion: 1,
        supportedSchemaVersions: [1],
      },
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
      status: 'authoritative',
      authoritativeDomains: [...PRODUCTION_DOMAINS],
      invalidDomains: [],
    },
  }
}

async function unusedPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = address?.port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function startLocalAppHost(layout) {
  const port = await unusedPort()
  const distDir = path.join(layout.isolationRoot, 'host-dist')
  await mkdir(distDir, { recursive: true })
  await writeFile(path.join(distDir, 'index.html'), '<main>isolated C2a Host</main>', 'utf8')
  const profileId = 'c2a-production-profile'
  const instanceId = 'c2a-production-instance'
  const accessToken = 'c2a-production-token'
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

registry = load_owner_registry(Path(os.environ['C2A_REGISTRY']))
app = create_local_app_host(
    dist_dir=Path(os.environ['C2A_DIST']),
    workflow_app=FastAPI(),
    access_token=os.environ['C2A_TOKEN'],
    profile_id=os.environ['C2A_PROFILE_ID'],
    instance_id=os.environ['C2A_INSTANCE_ID'],
    owner_registry=registry,
    owner_profile_evidence=json.loads(os.environ['C2A_OWNER_EVIDENCE']),
    owner_repository_root=Path(os.environ['C2A_AUTHORITY_ROOT']),
    owner_receipt_root=Path(os.environ['C2A_AUTHORITY_ROOT']),
    owner_freeze_root=Path(os.environ['C2A_AUTHORITY_ROOT']),
    config_compatibility={'schemaVersion': 1, 'minimum': 1, 'maximum': 1},
)
uvicorn.run(app, host='127.0.0.1', port=int(os.environ['C2A_PORT']), log_level='warning', access_log=False)
`
  const child = spawn(python.executable, ['-c', script], {
    cwd: path.join(repositoryRoot, 'tools', 'subtitle-workflow'),
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: path.join(repositoryRoot, 'tools', 'subtitle-workflow'),
      C2A_DIST: distDir,
      C2A_REGISTRY: path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader', 'owner-registry.json'),
      C2A_TOKEN: accessToken,
      C2A_PROFILE_ID: profileId,
      C2A_INSTANCE_ID: instanceId,
      C2A_OWNER_EVIDENCE: JSON.stringify(ownerProfileEvidence(profileId)),
      C2A_AUTHORITY_ROOT: layout.profileAuthorityRoot,
      C2A_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const baseUrl = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local App Host exited before ready: ${stderr.trim() || child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/api/app/health`, {
        headers: { 'X-Read-Web-Token': accessToken },
      })
      if (response.ok) {
        const health = await response.json()
        return { child, baseUrl, accessToken, profileId, instanceId, health }
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  child.kill()
  await once(child, 'exit').catch(() => {})
  throw new Error(`Local App Host did not become ready: ${stderr.trim() || 'timeout'}`)
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

function readerRows() {
  const contentId = 'c2a-reader-content'
  const mediaIdentity = {
    mediaId: 'c2a-reader-audio',
    kind: 'audio',
    size: 12,
    contentType: 'audio/mp4',
    etag: '"c2a-reader-v1"',
    revision: 1,
    authorizedReference: '/api/jobs/c2a-reader/media/audio',
  }
  const payloads = {
    audioMeta: { schemaVersion: 1, contentId, mediaIdentity },
    transcript: { schemaVersion: 1, contentId, segments: [] },
    chunkData: [{ text: 'c2a', index: 0 }],
    marks: { schemaVersion: 1, contentId, marks: [{ globalIndex: 0, word: 'c2a' }] },
    readerSession: { schemaVersion: 3, contentId, revision: 1 },
  }
  return Object.entries(payloads).map(([id, content]) => ({
    id,
    schemaVersion: id === 'readerSession' ? 3 : 1,
    revision: 1,
    contentId,
    content,
  }))
}

function marksEnvelope() {
  const unsigned = {
    schemaVersion: 'reader-marks.v1',
    domain: 'reader-marks',
    jobId: 'c2a-marks',
    revision: 1,
    updatedAt: '2026-08-30T00:00:00Z',
    payload: {
      jobId: 'c2a-marks',
      marks: [{ globalIndex: 1, word: 'marks' }],
      updatedAt: '2026-08-30T00:00:00Z',
    },
  }
  return { ...unsigned, checksum: checksum(unsigned) }
}

async function seedProfile(layout, { reader = false, marks = false } = {}) {
  await mkdir(layout.pythonOutputDir, { recursive: true })
  await mkdir(layout.pythonStateDir, { recursive: true })
  await mkdir(layout.profileAuthorityRoot, { recursive: true })
  await writeIsolatedBrowserProfile(layout.profileDir, {
    localStorage: {},
    indexedDbRows: reader ? readerRows() : [],
  })
  if (marks) {
    const marksPath = path.join(layout.pythonOutputDir, '_workflow', 'reader-marks.json')
    await mkdir(path.dirname(marksPath), { recursive: true })
    await writeFile(marksPath, `${JSON.stringify(marksEnvelope(), null, 2)}\n`, 'utf8')
  }
}

const browserCutoverModule = await loadBrowserCutoverModule()
const {
  assertWindowsOwnerBrowserWriterAllowed,
  initializeWindowsOwnerDomainCutoverComposition,
} = browserCutoverModule

const workRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-owner-c2a-production-'))
let host = null
let reopenedHost = null
let browserGuard = null
try {
  const source = makeLayout(workRoot, 'source')
  const target = makeLayout(workRoot, 'target')
  await seedProfile(source, { reader: true, marks: true })
  await seedProfile(target)
  host = await startLocalAppHost(target)
  assert.deepEqual(host.health.ownerMode?.authoritativeDomains, PRODUCTION_DOMAINS)
  assert.equal(host.health.domains?.find((domain) => domain.domain === 'reader-session')?.authority, 'authoritative')
  const hostClient = await createWindowsOwnerProductionHostClient({
    baseUrl: host.baseUrl,
    accessToken: host.accessToken,
    profileId: host.profileId,
    instanceId: host.instanceId,
  })

  const frozenDomains = new Set()
  const windowObject = {}
  const browserComposition = await initializeWindowsOwnerDomainCutoverComposition({
    windowObject,
    health: makeHealth([]),
    fetchImpl: async () => ({ ok: true, async json() { return makeHealth([...frozenDomains]) } }),
    healthPath: '/api/app/health',
    healthTimeoutMs: 500,
  })
  assert.equal(browserComposition.status, 'not-ready')
  assert.ok(browserComposition.cutover, 'pre-cutover page must retain a pollable guard')
  assert.deepEqual(browserComposition.cutover.authoritativeDomains, [])
  browserGuard = browserComposition.cutover

  const refreshes = []
  const result = await runWindowsOwnerProductionCutover({
    mode: 'optimization',
    explicitOptIn: true,
    profileId: 'c2a-production-profile',
    source,
    target,
    domains: PRODUCTION_DOMAINS,
    sourceIdsByDomain: {
      'reader-session': ['SeekPlayerDB/files'],
      'marks-activity': ['backup.marks-activity'],
    },
    expectedRevisionByDomain: {
      'reader-session': 0,
      'marks-activity': 0,
    },
    hostClient,
    hostScopeByDomain: {
      'marks-activity': { jobId: 'c2a-marks', contentId: 'c2a-marks' },
    },
    browserGuard,
    refreshBrowserGuard: async ({ domain }) => {
      frozenDomains.clear()
      frozenDomains.add(domain)
      const marker = await readOwnerModeFreeze({
        ...target,
        profileId: 'c2a-production-profile',
        domain,
      })
      assert.equal(marker?.status, 'frozen', 'the open browser must see a persisted freeze marker')
      const refreshed = await browserGuard.refresh()
      assert.ok(refreshed.frozenDomains.includes(domain), `open browser did not observe ${domain} frozen`)
      assert.throws(
        () => assertWindowsOwnerBrowserWriterAllowed(domain, 'opened-browser-write', windowObject),
        /frozen after Host cutover/,
      )
      refreshes.push(domain)
      return {
        ok: true,
        observedFrozen: true,
        frozenDomains: refreshed.frozenDomains,
      }
    },
  })

  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.productionComposition, true)
  assert.deepEqual(result.domains.map((entry) => entry.domain), PRODUCTION_DOMAINS)
  assert.deepEqual(refreshes, PRODUCTION_DOMAINS, 'each domain must refresh the already-open browser before final backup')
  assert.deepEqual(
    result.domains.map((entry) => entry.steps.dryRun.sourceIds),
    [['SeekPlayerDB/files'], ['backup.marks-activity']],
  )
  assert.ok(result.domains.every((entry) => entry.steps.beforeFinalBackup?.observedFrozen === true))
  assert.ok(result.domains.every((entry) => entry.steps.smoke?.status === 'passed'))

  for (const domain of PRODUCTION_DOMAINS) {
    const checkpoint = await readOwnerModeCheckpoint({ ...target, profileId: 'c2a-production-profile', domain })
    assert.equal(checkpoint?.authorityMode, 'host-api=authoritative')
    assert.equal(await readOwnerModeFreeze({ ...target, profileId: 'c2a-production-profile', domain }), null)
  }

  await stopLocalAppHost(host)
  host = null
  reopenedHost = await startLocalAppHost(target)
  const reopenedClient = await createWindowsOwnerProductionHostClient({
    baseUrl: reopenedHost.baseUrl,
    accessToken: reopenedHost.accessToken,
    profileId: reopenedHost.profileId,
    instanceId: reopenedHost.instanceId,
  })
  const reopenedReader = await reopenedClient.query({
    domain: 'reader-session',
    operation: 'snapshot',
    payload: {},
  })
  const reopenedMarks = await reopenedClient.query({
    domain: 'marks-activity',
    operation: 'marks',
    payload: { jobId: 'c2a-marks', contentId: 'c2a-marks' },
  })
  assert.equal(reopenedReader.outcome, 'read')
  assert.equal(reopenedReader.payload.snapshot.contentId, 'c2a-reader-content')
  assert.equal(reopenedReader.payload.snapshot.media.mediaId, 'c2a-reader-audio')
  assert.equal(reopenedMarks.outcome, 'read')
  assert.deepEqual(reopenedMarks.payload.marks, [{ globalIndex: 1, word: 'marks' }])
  await stopLocalAppHost(reopenedHost)
  reopenedHost = null
  console.log('Windows owner C2a production cutover checks passed.')
} finally {
  await stopLocalAppHost(reopenedHost)
  await stopLocalAppHost(host)
  browserGuard?.dispose?.()
  await rm(workRoot, { recursive: true, force: true })
}
