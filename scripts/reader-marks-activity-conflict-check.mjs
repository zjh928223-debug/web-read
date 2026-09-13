import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { registerHooks } from 'node:module'
import net from 'node:net'
import { ref } from 'vue'

const esmRootUrl = new URL('../src/', import.meta.url).href
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith(esmRootUrl) && url.endsWith('.js')) {
      return nextLoad(url, { ...context, format: 'module' })
    }
    return nextLoad(url, context)
  },
})

const ledgerSource = await fs.readFile(
  new URL('../src/services/persistence/latest-wins-ledger.js', import.meta.url),
  'utf8',
)
const clientSource = (await fs.readFile(
  new URL('../src/composables/youtube-workflow-client.js', import.meta.url),
  'utf8',
)).replace(
  /^import \{ recordBestEffortFailure \} from '\.\.\/services\/runtime\/best-effort\.js';?$/m,
  'const recordBestEffortFailure = () => null',
)
const panelSource = await fs.readFile(
  new URL('../src/components/YouTubeWorkflowPanel.vue', import.meta.url),
  'utf8',
)
const coordinatorSource = await fs.readFile(
  new URL('../src/composables/use-reader-save-coordinator.js', import.meta.url),
  'utf8',
)
const { createLatestWinsLedger } = await import(
  `data:text/javascript;base64,${Buffer.from(ledgerSource).toString('base64')}#${Date.now()}`
)
const { createYoutubeWorkflowClient } = await import(
  `data:text/javascript;base64,${Buffer.from(clientSource).toString('base64')}#${Date.now()}`
)
const {
  createReaderOutboxEntry,
  isTrustedReaderMarksOutboxEntry,
  readReaderOutbox,
  writeReaderOutboxEntry,
} = await import('../src/services/persistence/reader-outbox-storage.js')

const port = await ephemeralPort()
const backend = createPublicReaderApi()
const clientA = createYoutubeWorkflowClient({ baseUrl: `http://127.0.0.1:${port}`, fetchImpl: backend.fetch })
const clientB = createYoutubeWorkflowClient({ baseUrl: `http://127.0.0.1:${port}`, fetchImpl: backend.fetch })

await verifyReaderOutboxMetadata()
await verifyMarksConflictPolicy()
await verifyActivityConflictAndIdempotency()
await verifyConnectionCloseRetryKeepsOneMarksCommit()
await verifyCoordinatorJobSwitchIsolation()
assert.match(coordinatorSource, /status === 'conflict'/, 'coordinator must retain a distinct conflict state')
assert.match(coordinatorSource, /resolveReaderConflict/, 'coordinator must expose explicit conflict resolution')
assert.match(coordinatorSource, /readerConflicts/, 'coordinator must retain authoritative conflict context')
assert.match(panelSource, /useReaderSaveCoordinator/, 'panel must create the reader save coordinator')
assert.match(panelSource, /loadReaderConflict\(/, 'panel must connect outbox conflicts to the coordinator')
assert.match(panelSource, /readerMarksSaveState\.value = 'dirty'/, 'page close must not report marks as saved')
assert.match(panelSource, /reader-marks-\$\{payload\.jobId\}-\$\{payload\.sessionId\}-close/, 'page close must carry a stable marks operation id')
console.log('reader marks/activity conflict checks passed')

async function verifyReaderOutboxMetadata() {
  class MapStorage {
    constructor() { this.values = new Map() }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
    setItem(key, value) { this.values.set(key, String(value)) }
    removeItem(key) { this.values.delete(key) }
    key(index) { return [...this.values.keys()][index] ?? null }
    get length() { return this.values.size }
  }

  const originalWindow = globalThis.window
  const storage = new MapStorage()
  globalThis.window = { localStorage: storage }
  try {
    const trusted = createReaderOutboxEntry(
      'marks',
      {
        jobId: 'outbox-job',
        marks: [{ globalIndex: 1, word: 'trusted', start: 1, sourceType: 'manual-mark' }],
        source: 'local-edit',
        localVersion: 3,
      },
      'outbox-trusted',
      4,
    )
    assert.equal(isTrustedReaderMarksOutboxEntry(trusted), true, 'new marks outbox entries must carry trusted edit metadata and a local version')
    assert.equal(writeReaderOutboxEntry(trusted), true)
    const trustedRead = readReaderOutbox().entries.find((entry) => entry.operationId === 'outbox-trusted')
    const sourceField = 'source'
    assert.equal(trustedRead.intent[sourceField], 'local-edit')
    assert.equal(trustedRead.intent.localVersion, 3)

    const legacy = {
      jobId: 'outbox-legacy-job',
      kind: 'marks',
      operationId: 'outbox-legacy',
      expectedRevision: 0,
      intent: { marks: [{ globalIndex: 2, word: 'legacy', start: null, sourceType: 'manual-mark' }] },
    }
    storage.setItem('read-web.reader-save-outbox.v1', JSON.stringify({ schemaVersion: 1, entries: [legacy] }))
    const migrated = readReaderOutbox()
    const migratedLegacy = migrated.entries.find((entry) => entry.operationId === 'outbox-legacy')
    assert.ok(migratedLegacy, 'legacy marks outbox entries must remain after migration')
    assert.equal(isTrustedReaderMarksOutboxEntry(migratedLegacy), false, 'legacy marks outbox entries must remain untrusted')
    assert.equal(migratedLegacy.intent[sourceField], undefined)
    assert.equal(migratedLegacy.intent.localVersion, undefined)
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
}

async function verifyCoordinatorJobSwitchIsolation() {
  const currentJobId = ref('job-a')
  const firstA = deferred()
  const firstB = deferred()
  const writes = []
  const recentItems = []
  const controlledClient = {
    async getReaderMarks(jobId) {
      return { jobId, revision: 0, marks: [] }
    },
    async getReaderActivity(jobId) {
      return { jobId, revision: 0 }
    },
    saveReaderMarks(jobId, payload) {
      writes.push({ jobId, payload })
      return jobId === 'job-a' ? firstA.promise : firstB.promise
    },
    async recordReaderActivity(payload) {
      return { ...payload, revision: 1 }
    },
  }
  const coordinatorModuleSource = coordinatorSource
    .replace("import { ref } from 'vue'", "const { ref } = globalThis.__readerSaveCoordinatorDependencies")
    .replace("import { youtubeWorkflowClient } from './youtube-workflow-client.js'", "const youtubeWorkflowClient = globalThis.__readerSaveCoordinatorDependencies.youtubeWorkflowClient")
    .replace("import { createLatestWinsLedger } from '../services/persistence/latest-wins-ledger.js'", "const { createLatestWinsLedger } = globalThis.__readerSaveCoordinatorDependencies")
  globalThis.__readerSaveCoordinatorDependencies = {
    ref,
    youtubeWorkflowClient: controlledClient,
    createLatestWinsLedger,
  }
  let coordinator = null
  try {
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(coordinatorModuleSource).toString('base64')}#${Date.now()}`
    )
    coordinator = module.useReaderSaveCoordinator({
      currentJobId,
      getReaderSessionId: () => 'session-a',
      mergeRecentReaderItem: (item) => recentItems.push(item),
    })

    const ledgerA = coordinator.getReaderMarksLedger('job-a')
    ledgerA.submit({ jobId: 'job-a', marks: [{ globalIndex: 1, word: 'A' }] })
    await tick()

    currentJobId.value = 'job-b'
    const ledgerB = coordinator.getReaderMarksLedger('job-b')
    ledgerB.submit({ jobId: 'job-b', marks: [{ globalIndex: 2, word: 'B' }] })
    for (let attempt = 0; attempt < 10 && writes.length < 2; attempt += 1) await tick()
    assert.equal(writes.length, 2, 'both job ledgers must begin their own save')
    assert.equal(coordinator.readerMarksSaveState.value, 'saving', 'job B must own the visible save state')

    firstA.resolve({ jobId: 'job-a', revision: 1 })
    await ledgerA.waitForIdle()
    assert.equal(coordinator.readerMarksSaveState.value, 'saving', 'job A completion must not overwrite job B state')

    currentJobId.value = 'job-a'
    assert.equal(coordinator.getReaderMarksLedger('job-a'), ledgerA, 'returning to job A must reuse its ledger')
    assert.equal(ledgerA.getState().savedSequence, 1)

    currentJobId.value = 'job-b'
    firstB.resolve({ jobId: 'job-b', revision: 1 })
    await ledgerB.waitForIdle()
    currentJobId.value = 'job-a'
    assert.equal(coordinator.getReaderMarksLedger('job-a'), ledgerA)
  } finally {
    coordinator?.dispose()
    delete globalThis.__readerSaveCoordinatorDependencies
  }
}

async function verifyMarksConflictPolicy() {
  const aRevision = (await clientA.getReaderMarks('job-1')).revision
  let bRevision = (await clientB.getReaderMarks('job-1')).revision
  const writes = []
  let authoritative = null

  const ledgerA = createLatestWinsLedger({
    createOperationId: () => 'marks-owner-a',
    async write(snapshot, context) {
      writes.push({ owner: 'a', snapshot, context })
      return clientA.saveReaderMarks('job-1', {
        marks: snapshot.marks,
        expectedRevision: aRevision,
        operationId: context.operationId,
      })
    },
  })
  const ledgerB = createLatestWinsLedger({
    createOperationId: () => 'marks-owner-b',
    async write(snapshot, context) {
      writes.push({ owner: 'b', snapshot, context })
      return clientB.saveReaderMarks('job-1', {
        marks: snapshot.marks,
        expectedRevision: bRevision,
        operationId: context.operationId,
      })
    },
    async onConflict() {
      authoritative = await clientB.getReaderMarks('job-1')
    },
  })

  ledgerA.submit({ jobId: 'job-1', marks: [{ globalIndex: 1, word: 'A' }] })
  ledgerB.submit({ jobId: 'job-1', marks: [{ globalIndex: 2, word: 'B' }] })
  await Promise.all([ledgerA.waitForIdle(), ledgerB.waitForIdle()])
  await tick()

  assert.equal(ledgerA.getState().status, 'saved')
  assert.equal(ledgerB.getState().status, 'conflict')
  assert.equal(ledgerB.getState().dirty, true)
  assert.deepEqual(ledgerB.getState().conflict.localIntent.marks, [{ globalIndex: 2, word: 'B' }])
  assert.equal(writes.length, 2, 'a conflict must not trigger an implicit stale retry')
  assert.equal((await clientB.getReaderMarks('job-1')).marks[0].word, 'A')
  assert.equal(authoritative.revision, 1)

  bRevision = authoritative.revision
  const retry = await ledgerB.retry()
  assert.equal(retry, true, 'explicit retry after adopting authoritative revision must be allowed')
  assert.equal(ledgerB.getState().status, 'saved')
  assert.equal((await clientB.getReaderMarks('job-1')).revision, 2)
  assert.equal((await clientB.getReaderMarks('job-1')).marks[0].word, 'B')
}

async function verifyActivityConflictAndIdempotency() {
  const aRevision = (await clientA.getReaderActivity('job-2')).revision
  let bRevision = (await clientB.getReaderActivity('job-2')).revision
  let authoritative = null
  let activityWrites = 0
  const payload = {
    jobId: 'job-2',
    event: 'close',
    sessionId: 'session-b',
    positionSeconds: 9,
  }
  const ledgerA = createLatestWinsLedger({
    createOperationId: () => 'activity-owner-a',
    async write(snapshot, context) {
      activityWrites += 1
      return clientA.recordReaderActivity({
        ...snapshot,
        expectedRevision: aRevision,
        activityOperationId: context.operationId,
      })
    },
  })
  const ledgerB = createLatestWinsLedger({
    createOperationId: () => 'activity-owner-b',
    async write(snapshot, context) {
      activityWrites += 1
      return clientB.recordReaderActivity({
        ...snapshot,
        expectedRevision: bRevision,
        activityOperationId: context.operationId,
      })
    },
    async onConflict() {
      authoritative = await clientB.getReaderActivity('job-2')
    },
  })

  ledgerA.submit({ ...payload, sessionId: 'session-a', positionSeconds: 4 })
  ledgerB.submit(payload)
  await Promise.all([ledgerA.waitForIdle(), ledgerB.waitForIdle()])
  await tick()
  assert.equal(ledgerB.getState().status, 'conflict')
  assert.equal(ledgerB.getState().dirty, true)
  assert.equal(authoritative.revision, 1)

  const duplicate = await clientA.recordReaderActivity({
    jobId: 'job-2',
    event: 'close',
    sessionId: 'session-a',
    positionSeconds: 4,
    expectedRevision: 0,
    activityOperationId: 'activity-owner-a',
  })
  assert.equal(duplicate.revision, 1, 'retrying one operation id must not increment activity again')
  assert.equal(duplicate.completedCount, 0)

  bRevision = authoritative.revision
  const retry = await ledgerB.retry()
  assert.equal(retry, true)
  const activity = await clientB.getReaderActivity('job-2')
  assert.equal(activity.revision, 2)
  assert.equal(activity.openCount, 0)
  assert.equal(activity.completedCount, 0)
  assert.equal(activity.sessions.length, 2)
  assert.equal(activityWrites, 3, 'one winner, one conflict, one explicit retry')
  assert.equal('activityOperationId' in activity, false)
  assert.equal('path' in activity, false)
}

async function verifyConnectionCloseRetryKeepsOneMarksCommit() {
  const rawBackend = createPublicReaderApi()
  let disconnected = false
  const client = createYoutubeWorkflowClient({
    baseUrl: `http://127.0.0.1:${port}`,
    fetchImpl: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : {}
      const isTarget = String(options.method || '').toUpperCase() === 'POST'
        && new URL(url).pathname.endsWith('/reader-marks')
        && body.operationId === 'marks-connection-close'
      if (isTarget && !disconnected) {
        disconnected = true
        await rawBackend.fetch(url, options)
        throw new TypeError('connection closed after durable response commit')
      }
      return rawBackend.fetch(url, options)
    },
  })
  let revision = 0
  const ledger = createLatestWinsLedger({
    createOperationId: () => 'marks-connection-close',
    async write(snapshot, context) {
      const saved = await client.saveReaderMarks('job-1', {
        marks: snapshot.marks,
        expectedRevision: revision,
        operationId: context.operationId,
      })
      revision = saved.revision
      return saved
    },
  })
  ledger.submit({ jobId: 'job-1', marks: [{ globalIndex: 8, word: 'connection' }] })
  await ledger.waitForIdle()
  assert.equal(ledger.getState().status, 'error')
  assert.equal(ledger.getState().dirty, true)
  assert.equal(await ledger.retry(), true)
  assert.equal(ledger.getState().status, 'saved')
  assert.equal((await client.getReaderMarks('job-1')).revision, 1)
}

function createPublicReaderApi() {
  const state = {
    marks: { revision: 0, marks: [], operations: new Map() },
    activity: { revision: 0, value: emptyActivity(), operations: new Map() },
  }

  return {
    async fetch(url, options = {}) {
      const parsed = new URL(url)
      const method = String(options.method || 'GET').toUpperCase()
      const body = options.body ? JSON.parse(options.body) : {}
      if (parsed.pathname.endsWith('/reader-marks')) {
        if (method === 'GET') {
          return jsonResponse(200, publicMarks(state.marks))
        }
        const operationId = String(body.operationId || '')
        if (operationId && state.marks.operations.has(operationId)) {
          return jsonResponse(200, state.marks.operations.get(operationId))
        }
        if (body.expectedRevision !== state.marks.revision) {
          return jsonResponse(409, { detail: conflict('READER_MARKS_REVISION_CONFLICT', state.marks.revision) })
        }
        state.marks.revision += 1
        state.marks.marks = body.marks
        const result = publicMarks(state.marks)
        if (operationId) state.marks.operations.set(operationId, result)
        return jsonResponse(200, result)
      }
      if (parsed.pathname.endsWith('/reader-activity') || parsed.pathname.endsWith('/reader/activity')) {
        if (method === 'GET') return jsonResponse(200, publicActivity(state.activity))
        const operationId = String(body.activityOperationId || '')
        if (operationId && state.activity.operations.has(operationId)) {
          return jsonResponse(200, state.activity.operations.get(operationId))
        }
        if (body.expectedRevision !== state.activity.revision) {
          return jsonResponse(409, { detail: conflict('READER_ACTIVITY_REVISION_CONFLICT', state.activity.revision) })
        }
        state.activity.revision += 1
        state.activity.value = mergeActivity(state.activity.value, body)
        const result = publicActivity(state.activity)
        if (operationId) state.activity.operations.set(operationId, result)
        return jsonResponse(200, result)
      }
      return jsonResponse(404, { detail: 'not found' })
    },
  }
}

function publicMarks(value) {
  return { schemaVersion: 'reader-marks.v1', jobId: 'job-1', revision: value.revision, marks: value.marks, checksum: `sha256:marks-${value.revision}` }
}

function emptyActivity() {
  return { jobId: 'job-2', openCount: 0, completedCount: 0, sessions: [], lastPositionSeconds: 0 }
}

function publicActivity(value) {
  return { schemaVersion: 'reader-activity.v1', jobId: 'job-2', revision: value.revision, ...value.value, checksum: `sha256:activity-${value.revision}` }
}

function mergeActivity(current, body) {
  const next = { ...current, lastPositionSeconds: Number(body.positionSeconds || 0) }
  if (body.event === 'open') next.openCount += 1
  next.sessions = [...current.sessions, { sessionId: body.sessionId, lastEvent: body.event }]
  return next
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function conflict(code, actualRevision) {
  return { code, category: 'conflict', message: 'changed elsewhere', retryable: true, details: { actualRevision } }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => '' },
    async json() { return body },
  }
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}
