import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  readOwnerModeCheckpoint,
  readOwnerModeFreeze,
  writeIsolatedBrowserProfile,
} from './lib/read-web-production-backup.mjs'
import { runWindowsOwnerProductionCutover } from './lib/windows-owner-cutover.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRODUCTION_DOMAINS = ['reader-session', 'marks-activity']

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

function makeHealth(frozenDomains) {
  const frozen = new Set(frozenDomains)
  return {
    profileId: 'c2a-production-profile',
    instanceId: 'c2a-production-instance',
    liveness: { ready: true },
    contractValid: true,
    profileEvidenceReady: true,
    ownerRegistry: { valid: true },
    ownerMode: {
      status: frozen.size ? 'frozen' : 'authoritative',
      authoritativeDomains: [...PRODUCTION_DOMAINS],
      frozenDomains: [...frozen],
    },
    domains: PRODUCTION_DOMAINS.map((domain) => ({
      domain,
      authority: 'authoritative',
      queryCapability: 'read-only',
      commandCapability: 'writable',
      writerFrozen: frozen.has(domain),
    })),
  }
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
    chunkData: { schemaVersion: 1, contentId, chunks: [] },
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
  createWindowsOwnerDomainCutover,
} = browserCutoverModule

const workRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-owner-c2a-production-'))
try {
  const source = makeLayout(workRoot, 'source')
  const target = makeLayout(workRoot, 'target')
  await seedProfile(source, { reader: true, marks: true })
  await seedProfile(target)

  const frozenDomains = new Set()
  const windowObject = {}
  const browserGuard = createWindowsOwnerDomainCutover({
    windowObject,
    health: makeHealth([]),
    authoritativeDomains: PRODUCTION_DOMAINS,
    frozenDomains: [],
    ownerClient: {},
    fetchImpl: async () => ({ ok: true, async json() { return makeHealth([...frozenDomains]) } }),
    healthPath: '/api/app/health',
    healthTimeoutMs: 500,
  })
  windowObject.__windowsOwnerDomainCutover = browserGuard

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
      return { ok: true, observedFrozen: true }
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

  const reopened = await (await import('./lib/read-web-production-backup.mjs')).createReadWebProductionBackupComposition({
    ...target,
    profileId: 'c2a-production-profile',
  })
  const reopenedReader = await reopened.adapters['reader-session'].collect({ domain: 'reader-session' })
  const reopenedMarks = await reopened.adapters['marks-activity'].collect({ domain: 'marks-activity' })
  assert.ok(reopenedReader.records.some((record) => record.id === 'audioMeta' && record.contentId === 'c2a-reader-content'))
  assert.ok(reopenedMarks.records.some((record) => record.contentId === 'c2a-marks'))
  browserGuard.dispose()
  console.log('Windows owner C2a production cutover checks passed.')
} finally {
  await rm(workRoot, { recursive: true, force: true })
}
