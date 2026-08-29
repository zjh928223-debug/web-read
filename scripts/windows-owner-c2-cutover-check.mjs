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
const DOMAINS = [
  'reader-session',
  'marks-activity',
  'passage-preview',
  'annotation',
  'vocabulary-srs',
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

function fnv1aUtf16(value) {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619) >>> 0
  }
  return result.toString(16).padStart(8, '0')
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
    profileId: 'c2-production-profile',
    instanceId: 'c2-production-instance',
    liveness: { ready: true },
    contractValid: true,
    profileEvidenceReady: true,
    ownerRegistry: { valid: true },
    ownerMode: {
      status: frozen.size ? 'frozen' : authoritative.size ? 'authoritative' : 'pre-cutover',
      authoritativeDomains: [...authoritative],
      frozenDomains: [...frozen],
    },
    domains: DOMAINS.map((domain) => ({
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
    backupAdapterRegistry: { ...verified, requiredDomains: [...DOMAINS] },
    applicationLease: { ...verified, source: 'read-web-production-backup.application-profile-lease' },
    transaction: { ...verified },
    revision: { ...verified },
    recovery: { ...verified },
    domains: {},
  }
  for (const domain of DOMAINS) {
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
  await writeFile(path.join(distDir, 'index.html'), '<main>isolated C2 Host</main>', 'utf8')
  const profileId = 'c2-production-profile'
  const instanceId = 'c2-production-instance'
  const accessToken = 'c2-production-token'
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

registry = load_owner_registry(Path(os.environ['C2_REGISTRY']))
app = create_local_app_host(
    dist_dir=Path(os.environ['C2_DIST']),
    workflow_app=FastAPI(),
    access_token=os.environ['C2_TOKEN'],
    profile_id=os.environ['C2_PROFILE_ID'],
    instance_id=os.environ['C2_INSTANCE_ID'],
    owner_registry=registry,
    owner_profile_evidence=json.loads(os.environ['C2_OWNER_EVIDENCE']),
    owner_repository_root=Path(os.environ['C2_AUTHORITY_ROOT']),
    owner_receipt_root=Path(os.environ['C2_AUTHORITY_ROOT']),
    owner_freeze_root=Path(os.environ['C2_AUTHORITY_ROOT']),
    owner_migration_mode='optimization',
    owner_migration_domains=${JSON.stringify(DOMAINS)},
    config_compatibility={'schemaVersion': 1, 'minimum': 1, 'maximum': 1},
)
uvicorn.run(app, host='127.0.0.1', port=int(os.environ['C2_PORT']), log_level='warning', access_log=False)
`
  const child = spawn(python.executable, ['-c', script], {
    cwd: path.join(repositoryRoot, 'tools', 'subtitle-workflow'),
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: path.join(repositoryRoot, 'tools', 'subtitle-workflow'),
      C2_DIST: distDir,
      C2_REGISTRY: path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader', 'owner-registry.json'),
      C2_TOKEN: accessToken,
      C2_PROFILE_ID: profileId,
      C2_INSTANCE_ID: instanceId,
      C2_OWNER_EVIDENCE: JSON.stringify(ownerProfileEvidence(profileId)),
      C2_AUTHORITY_ROOT: layout.profileAuthorityRoot,
      C2_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const baseUrl = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local App Host exited before ready: ${stderr.trim() || child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/api/app/health`, {
        headers: { 'X-Read-Web-Token': accessToken },
      })
      if (response.ok) return { child, baseUrl, accessToken, profileId, instanceId, health: await response.json() }
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
  const contentId = 'c2-reader-content'
  const mediaIdentity = {
    mediaId: 'c2-reader-audio',
    kind: 'audio',
    size: 12,
    contentType: 'audio/mp4',
    etag: '"c2-reader-v1"',
    revision: 1,
    authorizedReference: '/api/jobs/c2-reader/media/audio',
  }
  const payloads = {
    audioMeta: { schemaVersion: 1, contentId, mediaIdentity },
    transcript: { schemaVersion: 1, contentId, segments: [] },
    chunkData: [{ text: 'c2', index: 0 }],
    marks: { schemaVersion: 1, contentId, marks: [{ globalIndex: 0, word: 'c2' }] },
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
    jobId: 'c2-marks',
    revision: 1,
    updatedAt: '2026-08-30T00:00:00Z',
    payload: {
      jobId: 'c2-marks',
      marks: [{ globalIndex: 1, word: 'marks' }],
      updatedAt: '2026-08-30T00:00:00Z',
    },
  }
  return { ...unsigned, checksum: checksum(unsigned) }
}

function passageRecords() {
  return {
    'vocabulary.passage-preview.durable-state.v1': {
      schemaVersion: 'passage-preview.durable-state.v1',
      revision: 1,
      contentId: 'c2-passage',
      items: [{ id: 'p1', text: 'passage' }],
    },
    'vocabulary.passage-preview.progress.v2': {
      schemaVersion: 'passage-preview.local-progress.v2',
      contentId: 'c2-passage',
      completed: ['p1'],
    },
  }
}

function annotationRecords() {
  const scope = { audioKey: 'youtube-workflow::c2 annotation audio', documentId: 'c2 document::中文' }
  const generated = { schemaVersion: 1, audioKey: scope.audioKey, documentId: scope.documentId, items: [] }
  const status = { schemaVersion: 1, audioKey: scope.audioKey, documentId: scope.documentId, blocks: {} }
  const bundle = {
    schemaVersion: 'annotation-bundle.v2',
    scope,
    revision: 1,
    commitId: 'c2-annotation-1',
    generated,
    status,
    checksum: fnv1aUtf16(JSON.stringify({ generated, status })),
  }
  return {
    scope,
    records: {
      [`AnnotationGenerationStorage::${scope.audioKey}::${scope.documentId}::annotation.bundle.v2.json`]: bundle,
      [`AnnotationGenerationStorage::${scope.audioKey}::${scope.documentId}::annotation.generated.json`]: generated,
      [`AnnotationGenerationStorage::${scope.audioKey}::${scope.documentId}::annotation.status.json`]: status,
    },
  }
}

function vocabularyRows() {
  return [{
    id: 'vocabulary.srs.store.v1',
    schemaVersion: 1,
    revision: 1,
    content: {
      schemaVersion: 1,
      revision: 1,
      entries: { c2: { word: 'c2', meaning: 'fixture' } },
    },
  }]
}

async function seedProfile(layout, { populated = false, annotation } = {}) {
  await mkdir(layout.pythonOutputDir, { recursive: true })
  await mkdir(layout.pythonStateDir, { recursive: true })
  await mkdir(layout.profileAuthorityRoot, { recursive: true })
  const localStorage = populated
    ? {
      ...Object.fromEntries(Object.entries(passageRecords()).map(([key, value]) => [key, JSON.stringify(value)])),
      ...Object.fromEntries(Object.entries(annotation.records).map(([key, value]) => [key, JSON.stringify(value)])),
    }
    : {}
  await writeIsolatedBrowserProfile(layout.profileDir, {
    localStorage,
    indexedDbRows: populated ? [...readerRows(), ...vocabularyRows()] : [],
  })
  if (populated) {
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

const workRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-owner-c2-production-'))
let host = null
let reopenedHost = null
let browserGuard = null
try {
  const source = makeLayout(workRoot, 'source')
  const target = makeLayout(workRoot, 'target')
  const annotation = annotationRecords()
  await seedProfile(source, { populated: true, annotation })
  await seedProfile(target, { populated: false, annotation })

  host = await startLocalAppHost(target)
  assert.deepEqual(host.health.ownerMode?.authoritativeDomains, [])
  const ordinaryHostClient = await createWindowsOwnerProductionHostClient({
    baseUrl: host.baseUrl,
    accessToken: host.accessToken,
    profileId: host.profileId,
    instanceId: host.instanceId,
  })
  const ordinaryPreCutover = await ordinaryHostClient.query({
    domain: 'passage-preview',
    operation: 'durable-state',
    payload: {},
  })
  assert.equal(ordinaryPreCutover.outcome, 'not-ready')

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
  browserGuard = browserComposition.cutover

  const refreshes = []
  const result = await runWindowsOwnerProductionCutover({
    mode: 'optimization',
    explicitOptIn: true,
    profileId: 'c2-production-profile',
    source,
    target,
    domains: DOMAINS,
    sourceIdsByDomain: {
      'reader-session': ['SeekPlayerDB/files'],
      'marks-activity': ['backup.marks-activity'],
      'passage-preview': ['localStorage'],
      annotation: ['localStorage'],
      'vocabulary-srs': ['SeekPlayerDB/files'],
      workflow: ['backup.workflow'],
    },
    hostBaseUrl: host.baseUrl,
    hostAccessToken: host.accessToken,
    hostInstanceId: host.instanceId,
    hostScopeByDomain: {
      'marks-activity': { jobId: 'c2-marks', contentId: 'c2-marks' },
      annotation: annotation.scope,
    },
    browserGuard,
    refreshBrowserGuard: async ({ domain }) => {
      frozenDomains.clear()
      frozenDomains.add(domain)
      const marker = await readOwnerModeFreeze({
        ...target,
        profileId: 'c2-production-profile',
        domain,
      })
      assert.equal(marker?.status, 'frozen', `freeze marker missing for ${domain}`)
      const refreshed = await browserGuard.refresh()
      assert.ok(refreshed.frozenDomains.includes(domain), `open browser did not observe ${domain} frozen`)
      assert.throws(
        () => assertWindowsOwnerBrowserWriterAllowed(domain, 'opened-browser-write', windowObject),
        /frozen after Host cutover/,
      )
      refreshes.push(domain)
      return { ok: true, observedFrozen: true, frozenDomains: refreshed.frozenDomains }
    },
    smokeByDomain: {
      'reader-session': async ({ revision, client }) => {
        const query = await client.query({ domain: 'reader-session', operation: 'snapshot', payload: {} })
        const snapshot = query.payload.snapshot
        const candidate = {
          schemaVersion: 'reader-session-owner.v1',
          domain: 'reader-session',
          profileId: 'c2-production-profile',
          contentId: snapshot.contentId,
          revision: revision + 1,
          audioMeta: snapshot.audioMeta,
          transcript: snapshot.transcript,
          chunkData: snapshot.chunkData,
          marks: snapshot.marks,
          media: snapshot.media,
        }
        const prepared = await client.command({ domain: 'reader-session', operation: 'prepare', payload: { candidate } })
        const committed = await client.command({
          domain: 'reader-session',
          operation: 'commit',
          payload: { prepareId: prepared.payload.prepare.prepareId },
          expectedRevision: revision,
          idempotencyKey: 'c2-smoke-reader-session',
        })
        assert.equal(committed.outcome, 'committed')
        return { outcome: committed.outcome, revision: committed.revision }
      },
      'marks-activity': async ({ revision, client }) => {
        const committed = await client.command({
          domain: 'marks-activity',
          operation: 'marks-commit',
          payload: { jobId: 'c2-marks', contentId: 'c2-marks', marks: [{ globalIndex: 1, word: 'marks' }] },
          expectedRevision: revision,
          idempotencyKey: 'c2-smoke-marks-activity',
        })
        assert.equal(committed.outcome, 'committed')
        return { outcome: committed.outcome, revision: committed.revision }
      },
      'passage-preview': async ({ revision, client }) => {
        const records = passageRecords()
        const committed = await client.command({
          domain: 'passage-preview',
          operation: 'state-commit',
          payload: { recordKey: 'vocabulary.passage-preview.durable-state.v1', record: records['vocabulary.passage-preview.durable-state.v1'] },
          expectedRevision: revision,
          idempotencyKey: 'c2-smoke-passage-preview',
        })
        assert.equal(committed.outcome, 'committed')
        return { outcome: committed.outcome, revision: committed.revision }
      },
      annotation: async ({ revision, client }) => {
        const committed = await client.command({
          domain: 'annotation',
          operation: 'lightweight-import',
          payload: { scope: annotation.scope, records: annotation.records },
          expectedRevision: revision,
          idempotencyKey: 'c2-smoke-annotation',
        })
        assert.equal(committed.outcome, 'committed')
        return { outcome: committed.outcome, revision: committed.revision }
      },
      'vocabulary-srs': async ({ revision, client }) => {
        const content = vocabularyRows()[0].content
        const committed = await client.command({
          domain: 'vocabulary-srs',
          operation: 'entry-upsert',
          payload: { recordKey: 'vocabulary.srs.store.v1', record: { id: 'vocabulary.srs.store.v1', content } },
          expectedRevision: revision,
          idempotencyKey: 'c2-smoke-vocabulary-srs',
        })
        assert.equal(committed.outcome, 'committed')
        return { outcome: committed.outcome, revision: committed.revision }
      },
      workflow: async ({ revision, client }) => {
        const committed = await client.command({
          domain: 'workflow',
          operation: 'config-commit',
          payload: { config: { model: 'c2-smoke' } },
          expectedRevision: revision,
          idempotencyKey: 'c2-smoke-workflow',
        })
        assert.equal(committed.outcome, 'committed')
        return { outcome: committed.outcome, revision: committed.revision }
      },
    },
  })

  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.productionComposition, true)
  assert.deepEqual(result.domains.map((entry) => entry.domain), DOMAINS)
  assert.deepEqual(refreshes, DOMAINS)
  assert.ok(result.domains.every((entry) => entry.steps.beforeFinalBackup?.observedFrozen === true))
  assert.ok(result.domains.every((entry) => entry.steps.smoke?.status === 'passed'))
  assert.ok(result.domains.every((entry) => entry.steps.smoke?.outcome === 'committed'))
  assert.deepEqual(
    result.domains.map((entry) => entry.steps.dryRun.sourceIds),
    [
      ['SeekPlayerDB/files'],
      ['backup.marks-activity'],
      ['localStorage'],
      ['localStorage'],
      ['SeekPlayerDB/files'],
      ['backup.workflow'],
    ],
  )

  for (const domain of DOMAINS) {
    const checkpoint = await readOwnerModeCheckpoint({ ...target, profileId: 'c2-production-profile', domain })
    assert.equal(checkpoint?.authorityMode, 'host-api=authoritative')
    assert.equal(await readOwnerModeFreeze({ ...target, profileId: 'c2-production-profile', domain }), null)
  }

  await stopLocalAppHost(host)
  host = null
  reopenedHost = await startLocalAppHost(target)
  assert.deepEqual(
    [...(reopenedHost.health.ownerMode?.authoritativeDomains || [])].sort(),
    [...DOMAINS].sort(),
  )
  const reopenedClient = await createWindowsOwnerProductionHostClient({
    baseUrl: reopenedHost.baseUrl,
    accessToken: reopenedHost.accessToken,
    profileId: reopenedHost.profileId,
    instanceId: reopenedHost.instanceId,
  })
  const reopenedQueries = await Promise.all([
    reopenedClient.query({ domain: 'reader-session', operation: 'snapshot', payload: {} }),
    reopenedClient.query({ domain: 'marks-activity', operation: 'marks', payload: { jobId: 'c2-marks', contentId: 'c2-marks' } }),
    reopenedClient.query({ domain: 'passage-preview', operation: 'durable-state', payload: {} }),
    reopenedClient.query({ domain: 'annotation', operation: 'scope', payload: { scope: annotation.scope } }),
    reopenedClient.query({ domain: 'vocabulary-srs', operation: 'snapshot', payload: {} }),
    reopenedClient.query({ domain: 'workflow', operation: 'config', payload: {} }),
  ])
  assert.equal(reopenedQueries[0].outcome, 'read')
  assert.equal(reopenedQueries[0].payload.snapshot.contentId, 'c2-reader-content')
  assert.equal(reopenedQueries[0].payload.snapshot.media.mediaId, 'c2-reader-audio')
  assert.equal(reopenedQueries[1].outcome, 'read')
  assert.equal(reopenedQueries[2].outcome, 'read')
  assert.equal(reopenedQueries[3].outcome, 'read')
  assert.equal(reopenedQueries[4].outcome, 'read')
  assert.equal(reopenedQueries[5].outcome, 'read')
  assert.equal(reopenedQueries[5].payload.config.model, 'c2-smoke')
  assert.equal(reopenedQueries[4].payload.records['vocabulary.srs.store.v1'].content.entries.c2.word, 'c2')
  await stopLocalAppHost(reopenedHost)
  reopenedHost = null
  console.log('Windows owner C2 six-domain production cutover checks passed.')
} finally {
  await stopLocalAppHost(reopenedHost)
  await stopLocalAppHost(host)
  browserGuard?.dispose?.()
  await rm(workRoot, { recursive: true, force: true })
}
