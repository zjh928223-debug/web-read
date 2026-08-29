import assert from 'node:assert/strict'
import http from 'node:http'
import { createServer as createViteServer } from 'vite'
import { chromium } from 'playwright'

import { listenOnBrowserSafePort } from './lib/browser-port-policy.mjs'

const CONTRACT_VERSION = 'windows-thin-reader-api.v1'
const PROFILE_ID = 'c2b-browser-profile'
const INSTANCE_ID = 'c2b-browser-instance'
const ACCESS_TOKEN = 'c2b-browser-token'
const PASSAGE_DATA_KEY = 'vocabulary.passage-preview.data.v2'
const PASSAGE_PROGRESS_KEY = 'vocabulary.passage-preview.progress.v2'
const PASSAGE_DURABLE_KEY = 'vocabulary.passage-preview.durable-state.v1'
const PASSAGE_ACQUISITION_KEY = 'vocabulary.passage-preview.acquisition.v1'
const ANNOTATION_PREFIX = 'AnnotationGenerationStorage::'
const ANNOTATION_SUFFIXES = ['annotation.bundle.v2.json', 'annotation.generated.json', 'annotation.status.json']
const FINGERPRINT = `sha256:${'a'.repeat(64)}`

const passageRecords = {
  [PASSAGE_DURABLE_KEY]: {
    schemaVersion: 'passage-preview.durable-state.v1',
    revision: 1,
    batchId: 'c2b-batch',
    data: [{ id: 'c2b-before', text: 'before' }],
    progress: {
      schemaVersion: 'passage-preview.local-progress.v2',
      status: 'in_progress',
      currentIndex: 0,
      revealed: {},
      contextExpanded: {},
      startedAt: null,
      completedAt: null,
    },
    allocations: {
      schemaVersion: 'ielts-daily-preview.allocations.v1',
      batches: {
        '2026-08-29': { words: ['cword'] },
      },
      assignedLemmas: ['cword'],
    },
    continuation: {
      schemaVersion: 'ielts-daily-preview.continuation.v1',
      consumedBatchDates: [],
      lastLoadedBatchDate: '2026-08-29',
      updatedAt: '2026-08-29T00:00:00.000Z',
    },
    archive: [{
      date: '2026-08-28',
      items: [{ id: 'c2b-archived' }],
      completedAt: '2026-08-28T00:00:00.000Z',
    }],
  },
  [PASSAGE_DATA_KEY]: {
    schemaVersion: 'passage-preview.local-data.v2',
    items: [{ id: 'c2b-before', text: 'before' }],
  },
  [PASSAGE_PROGRESS_KEY]: {
    schemaVersion: 'passage-preview.local-progress.v2',
    status: 'in_progress',
    currentIndex: 0,
    revealed: {},
    contextExpanded: {},
    startedAt: null,
    completedAt: null,
  },
  [PASSAGE_ACQUISITION_KEY]: {
    schemaVersion: 'passage-preview.acquisition.v1',
    records: [{
      itemKey: 'persist\u001f持久',
      previewItemId: 'c2b-acquisition-item',
      lemma: 'persist',
      word: 'persist',
      primaryMeaningZh: '持久',
      learningUnitId: 'c2b-learning-unit',
      status: 'introduced',
      item: {
        id: 'c2b-acquisition-item',
        lemma: 'persist',
        word: 'persist',
        primaryMeaningZh: '持久',
      },
    }],
  },
}

const annotationScopes = [
  { audioKey: 'youtube-workflow::c2b audio', documentId: 'document::一' },
  { audioKey: '本地 file::二', documentId: '文档::two' },
]
const annotationRecords = Object.fromEntries(annotationScopes.flatMap((scope, index) => {
  const generated = {
    schemaVersion: 1,
    audioKey: scope.audioKey,
    documentId: scope.documentId,
    items: [{ id: `c2b-annotation-${index + 1}`, text: 'before' }],
  }
  const status = {
    schemaVersion: 1,
    audioKey: scope.audioKey,
    documentId: scope.documentId,
    blocks: {},
  }
  const bundle = {
    schemaVersion: 'annotation-bundle.v2',
    scope,
    revision: 1,
    commitId: `c2b-annotation-${index + 1}`,
    generated,
    status,
    checksum: fnv1aUtf16(JSON.stringify({ generated, status })),
  }
  return ANNOTATION_SUFFIXES.map((suffix, suffixIndex) => [
    annotationKey(scope, suffix),
    suffixIndex === 0 ? bundle : suffixIndex === 1 ? generated : status,
  ])
}))

const state = {
  passageRecords: structuredClone(passageRecords),
  annotationRecords: structuredClone(annotationRecords),
  revisions: { 'passage-preview': 0, annotation: 0 },
  ownerRequests: [],
  commandRequests: [],
  commandInFlight: 0,
  maxConcurrentCommands: 0,
}

const vite = await createViteServer({
  root: process.cwd(),
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, fs: { allow: [process.cwd()] } },
})
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/') return send(response, 200, 'text/html', '<!doctype html><title>C2b browser owner fixture</title>')
    if (url.pathname === '/api/app/owner' && request.method === 'POST') return handleOwnerRequest(request, response)
    return vite.middlewares(request, response, () => send(response, 404, 'text/plain', 'not found'))
  } catch (error) {
    if (!response.headersSent) send(response, 500, 'text/plain', error?.stack || String(error))
    else response.destroy()
  }
})

const port = await listenOnBrowserSafePort(server)
const origin = `http://127.0.0.1:${port}`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  state.commandRequests = []
  state.commandInFlight = 0
  state.maxConcurrentCommands = 0
  const result = await page.evaluate(async ({ profileId, instanceId }) => {
    const { createWindowsOwnerApiClient } = await import('/src/services/windows-owner-api-client.js')
    const passage = await import('/src/features/passage-preview/passage-preview-storage.js')
    const daily = await import('/src/features/passage-preview/passage-preview-daily-continuation.js')
    const acquisition = await import('/src/features/passage-preview/passage-preview-acquisition.js')
    const ownerFlow = daily
    const annotation = await import('/src/services/annotation/storage.js')
    const ownerClient = createWindowsOwnerApiClient({ profileId, instanceId, timeoutMs: 1000 })
    window.__windowsOwnerDomainCutover = {
      isAuthoritative: (domain) => domain === 'passage-preview' || domain === 'annotation',
      query: (request) => ownerClient.query(request),
      command: (request) => ownerClient.command(request),
    }
    localStorage.clear()
    const originalGetItem = Storage.prototype.getItem
    const originalSetItem = Storage.prototype.setItem
    let storageReads = 0
    let storageWrites = 0
    Storage.prototype.getItem = function (...args) {
      storageReads += 1
      return originalGetItem.apply(this, args)
    }
    Storage.prototype.setItem = function (...args) {
      storageWrites += 1
      return originalSetItem.apply(this, args)
    }
    try {
      const beforeData = await passage.loadPassagePreviewDataFromOwner()
      const beforeAllocations = await daily.loadIeltsDailyPreviewAllocations()
      const beforeContinuation = await daily.loadIeltsDailyPreviewContinuation()
      const beforeArchive = await daily.loadIeltsDailyPreviewArchive()
      const beforeAcquisition = await acquisition.loadPassagePreviewAcquisitionRecords()
      if (beforeData?.[0]?.id !== 'c2b-before'
        || beforeAllocations.batches[0]?.words[0] !== 'cword'
        || beforeContinuation.lastLoadedBatchDate !== '2026-08-29'
        || beforeArchive[0]?.date !== '2026-08-28'
        || beforeAcquisition[0]?.lemma !== 'persist') {
        throw new Error('passage Host query did not hydrate all authoritative daily records')
      }

      await ownerFlow.commitPassagePreviewBatchTransition({
        archive: {
          date: '2026-08-30',
          items: [{ id: 'c2b-before', text: 'before' }],
          completedAt: '2026-08-30T00:00:00.000Z',
        },
        nextItems: [{ id: 'c2b-after', text: 'after' }],
        progress: {
          status: 'completed',
          currentIndex: 1,
          revealed: { c2b: true },
          contextExpanded: {},
          startedAt: null,
          completedAt: null,
        },
        continuation: {
          ...beforeContinuation,
          consumedBatchDates: ['2026-08-30'],
          lastLoadedBatchDate: '2026-08-30',
          updatedAt: '2026-08-30T00:00:00.000Z',
        },
        saveArchive: daily.saveIeltsDailyPreviewArchive,
        saveData: passage.savePassagePreviewData,
        saveProgress: passage.savePassagePreviewProgress,
        saveContinuation: daily.saveIeltsDailyPreviewContinuation,
      })

      const afterData = await passage.loadPassagePreviewDataFromOwner()
      const afterProgress = await passage.loadPassagePreviewProgressFromOwner()
      const afterArchive = await daily.loadIeltsDailyPreviewArchive()
      const afterContinuation = await daily.loadIeltsDailyPreviewContinuation()
      const afterAcquisition = await acquisition.loadPassagePreviewAcquisitionRecords()
      if (afterData?.[0]?.id !== 'c2b-after'
        || afterProgress?.status !== 'completed'
        || afterArchive[0]?.date !== '2026-08-30'
        || afterContinuation.lastLoadedBatchDate !== '2026-08-30'
        || afterAcquisition[0]?.lemma !== 'persist') {
        throw new Error('passage typed Host mutation did not preserve all daily records')
      }

      const reopenedClient = createWindowsOwnerApiClient({ profileId, instanceId, timeoutMs: 1000 })
      window.__windowsOwnerDomainCutover = {
        isAuthoritative: (domain) => domain === 'passage-preview' || domain === 'annotation',
        query: (request) => reopenedClient.query(request),
        command: (request) => reopenedClient.command(request),
      }
      const reopenedData = await passage.loadPassagePreviewDataFromOwner()
      const reopenedProgress = await passage.loadPassagePreviewProgressFromOwner()
      const reopenedAllocations = await daily.loadIeltsDailyPreviewAllocations()
      const reopenedContinuation = await daily.loadIeltsDailyPreviewContinuation()
      const reopenedArchive = await daily.loadIeltsDailyPreviewArchive()
      const reopenedAcquisition = await acquisition.loadPassagePreviewAcquisitionRecords()
      if (reopenedData?.[0]?.id !== 'c2b-after'
        || reopenedProgress?.status !== 'completed'
        || reopenedAllocations.batches[0]?.words[0] !== 'cword'
        || reopenedContinuation.lastLoadedBatchDate !== '2026-08-30'
        || reopenedArchive[0]?.date !== '2026-08-30'
        || reopenedAcquisition[0]?.lemma !== 'persist') {
        throw new Error('reopened passage Host query did not preserve authoritative daily state')
      }

      const annotationOwner = createWindowsOwnerApiClient({ profileId, instanceId, timeoutMs: 1000 })
      window.__windowsOwnerDomainCutover = {
        isAuthoritative: (domain) => domain === 'passage-preview' || domain === 'annotation',
        query: (request) => annotationOwner.query(request),
        command: (request) => annotationOwner.command(request),
      }
      const scope = { audioKey: 'youtube-workflow::c2b audio', documentId: 'document::一' }
      const beforeBundle = await annotation.loadBundle(scope)
      if (beforeBundle.generated.items[0]?.text !== 'before') throw new Error('annotation Host query did not hydrate the existing scope')
      await annotation.saveBundle(scope, {
        ...beforeBundle.generated,
        items: [{ id: 'c2b-annotation-1', text: 'after' }],
      }, beforeBundle.status)
      const afterBundle = await annotation.loadBundle(scope)
      if (afterBundle.generated.items[0]?.text !== 'after' || afterBundle.storageMode !== 'host-managed') {
        throw new Error('annotation typed Host mutation did not become readable')
      }

      return {
        storageReads,
        storageWrites,
        localStorageKeys: Object.keys(localStorage),
        passageRevision: afterProgress?.status === 'completed' ? 4 : null,
        annotationRevision: afterBundle.revision,
      }
    } finally {
      Storage.prototype.getItem = originalGetItem
      Storage.prototype.setItem = originalSetItem
    }
  }, { profileId: PROFILE_ID, instanceId: INSTANCE_ID })

  assert.equal(result.storageReads, 0, 'authoritative browser adapters must not read localStorage')
  assert.equal(result.storageWrites, 0, 'authoritative browser adapters must not write localStorage')
  assert.deepEqual(result.localStorageKeys, [])
  assert.equal(state.revisions['passage-preview'], 4, 'passage daily transition used four typed Host commands')
  assert.equal(state.maxConcurrentCommands, 1, 'passage daily transition awaited each Host command')
  assert.deepEqual(
    state.commandRequests.slice(0, 4).map((request) => Object.keys(request.body.payload.records)),
    [
      [PASSAGE_DURABLE_KEY],
      [PASSAGE_DURABLE_KEY, PASSAGE_DATA_KEY],
      [PASSAGE_DURABLE_KEY, PASSAGE_PROGRESS_KEY],
      [PASSAGE_DURABLE_KEY],
    ],
  )
  assert.equal(state.revisions.annotation, 1, 'annotation used one typed Host command')
  assert.equal(state.ownerRequests.every((request) => request.url === '/api/app/owner'), true)
  assert.equal(state.ownerRequests.every((request) => !request.raw.includes(ACCESS_TOKEN)), true)
  assert.equal(state.ownerRequests.every((request) => request.body?.payload?.profileId === PROFILE_ID), true)
  assert.equal(state.ownerRequests.every((request) => request.body?.payload?.instanceId === INSTANCE_ID), true)
  assert.ok(state.ownerRequests.some((request) => request.body?.domain === 'passage-preview' && request.body?.kind === 'command'))
  assert.ok(state.ownerRequests.some((request) => request.body?.domain === 'annotation' && request.body?.kind === 'command'))
  console.log('Windows owner C2b browser typed passage-preview/annotation checks passed.')
} finally {
  await context.close()
  await browser.close()
  await closeServer(server)
  await vite.close()
}

async function handleOwnerRequest(request, response) {
  const raw = await readBody(request)
  const body = JSON.parse(raw || '{}')
  state.ownerRequests.push({ url: request.url, raw, body })
  if (body.contractVersion !== CONTRACT_VERSION || body.payload?.profileId !== PROFILE_ID) {
    return sendJson(response, 400, { error: 'invalid owner fixture request' })
  }
  const domain = body.domain
  if (body.kind === 'query') {
    const records = domain === 'passage-preview'
      ? state.passageRecords
      : state.annotationRecords
    const selected = domain === 'annotation' && body.payload?.scope
      ? Object.fromEntries(Object.entries(records).filter(([, content]) => sameScope(content, body.payload.scope)))
      : records
    return sendJson(response, 200, ownerResponse(body, {
      outcome: 'read',
      commitStatus: 'not-applicable',
      revision: state.revisions[domain],
      payload: {
        found: Object.keys(selected).length > 0,
        empty: Object.keys(selected).length === 0,
        revision: state.revisions[domain],
        records: Object.fromEntries(Object.entries(selected).map(([id, content]) => [id, { id, content }])),
      },
    }))
  }
  if (body.kind === 'command') {
    const incoming = body.payload?.records
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return sendJson(response, 400, { error: 'records are required' })
    }
    state.commandRequests.push({ url: request.url, raw, body })
    state.commandInFlight += 1
    state.maxConcurrentCommands = Math.max(state.maxConcurrentCommands, state.commandInFlight)
    try {
      await new Promise((resolve) => setTimeout(resolve, 5))
      const target = domain === 'passage-preview' ? state.passageRecords : state.annotationRecords
      for (const [id, record] of Object.entries(incoming)) target[id] = record?.content ?? record
      state.revisions[domain] += 1
      return sendJson(response, 200, ownerResponse(body, {
        outcome: 'committed',
        commitStatus: 'committed',
        revision: state.revisions[domain],
        receipt: committedReceipt(body, state.revisions[domain]),
        payload: { recordKeys: Object.keys(incoming) },
      }))
    } finally {
      state.commandInFlight -= 1
    }
  }
  return sendJson(response, 400, { error: 'unsupported owner fixture request' })
}

function annotationKey(scope, suffix) {
  return `${ANNOTATION_PREFIX}${scope.audioKey}::${scope.documentId}::${suffix}`
}

function sameScope(content, scope) {
  const candidate = content?.scope || content
  return candidate?.audioKey === scope?.audioKey && candidate?.documentId === scope?.documentId
}

function fnv1aUtf16(value) {
  let result = 2166136261
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code <= 0xffff) {
      result ^= code
      result = Math.imul(result, 16777619) >>> 0
    } else {
      const high = ((code - 0x10000) >> 10) + 0xd800
      const low = ((code - 0x10000) & 0x3ff) + 0xdc00
      result ^= high
      result = Math.imul(result, 16777619) >>> 0
      result ^= low
      result = Math.imul(result, 16777619) >>> 0
    }
  }
  return result.toString(16).padStart(8, '0')
}

function ownerResponse(request, overrides = {}) {
  return {
    contractVersion: CONTRACT_VERSION,
    requestId: request.requestId,
    correlationId: request.correlationId,
    domain: request.domain,
    operation: request.operation,
    outcome: overrides.outcome || 'read',
    commitStatus: overrides.commitStatus || 'not-applicable',
    revision: overrides.revision ?? null,
    receipt: overrides.receipt ?? null,
    payload: overrides.payload || {},
    error: overrides.error ?? null,
  }
}

function committedReceipt(request, revision) {
  return {
    receiptId: `receipt-c2b-${request.domain}-${revision}`,
    contractVersion: CONTRACT_VERSION,
    profileId: PROFILE_ID,
    instanceId: INSTANCE_ID,
    requestId: request.requestId,
    correlationId: request.correlationId,
    domain: request.domain,
    operation: request.operation,
    idempotencyKey: request.idempotencyKey,
    expectedRevision: request.expectedRevision,
    requestFingerprint: FINGERPRINT,
    commitStatus: 'committed',
    revision,
    effectFingerprint: FINGERPRINT,
    recordChecksums: [FINGERPRINT],
    evidenceChecksum: FINGERPRINT,
    evidenceSource: 'c2b-browser-fixture',
    createdAt: '2026-08-30T00:00:00.000Z',
    committedAt: '2026-08-30T00:00:00.000Z',
    queryOperation: 'receipt-query',
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function send(response, status, contentType, body, headers = {}) {
  response.writeHead(status, { 'content-type': contentType, ...headers })
  response.end(body)
}

function sendJson(response, status, value) {
  send(response, status, 'application/json', JSON.stringify(value))
}

function closeServer(value) {
  return new Promise((resolve, reject) => value.close((error) => error ? reject(error) : resolve()))
}
