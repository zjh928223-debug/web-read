import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import net from 'node:net'

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
const { createLatestWinsLedger } = await import(
  `data:text/javascript;base64,${Buffer.from(ledgerSource).toString('base64')}#${Date.now()}`
)
const { createYoutubeWorkflowClient } = await import(
  `data:text/javascript;base64,${Buffer.from(clientSource).toString('base64')}#${Date.now()}`
)

const port = await ephemeralPort()
const backend = createPublicReaderApi()
const clientA = createYoutubeWorkflowClient({ baseUrl: `http://127.0.0.1:${port}`, fetchImpl: backend.fetch })
const clientB = createYoutubeWorkflowClient({ baseUrl: `http://127.0.0.1:${port}`, fetchImpl: backend.fetch })

await verifyMarksConflictPolicy()
await verifyActivityConflictAndIdempotency()
await verifyConnectionCloseRetryKeepsOneMarksCommit()
assert.match(panelSource, /status === 'conflict'/, 'panel must render a distinct conflict state')
assert.match(panelSource, /resolveReaderConflict/, 'panel must expose an explicit conflict resolution action')
assert.match(panelSource, /readerConflict/, 'panel must retain authoritative conflict context')
assert.match(panelSource, /readerMarksSaveState\.value = 'dirty'/, 'page close must not report marks as saved')
assert.match(panelSource, /reader-marks-\$\{payload\.jobId\}-\$\{payload\.sessionId\}-close/, 'page close must carry a stable marks operation id')
console.log('reader marks/activity conflict checks passed')

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
