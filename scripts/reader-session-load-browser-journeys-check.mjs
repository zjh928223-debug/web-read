import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { listenOnBrowserSafePort } from './lib/browser-port-policy.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const sessionRequests = new Map()

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/') return send(response, 200, 'text/html', '<!doctype html><meta charset="utf-8"><title>ReaderSessionLoad journeys</title>')
    if (url.pathname.startsWith('/src/') && url.pathname.endsWith('.js')) {
      const target = path.resolve(repoRoot, url.pathname.slice(1))
      if (!target.startsWith(`${repoRoot}${path.sep}`)) return send(response, 404, 'text/plain', 'not found')
      return send(response, 200, 'text/javascript', await readFile(target))
    }
    const sessionMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/session$/)
    if (sessionMatch) {
      const jobId = decodeURIComponent(sessionMatch[1])
      const count = (sessionRequests.get(jobId) || 0) + 1
      sessionRequests.set(jobId, count)
      const delay = jobId === 'a' && count === 1 ? 220 : jobId === 'b' ? 140 : jobId === 'abort' ? 500 : 5
      if (jobId === 'offline') return request.socket.destroy()
      return setTimeout(() => sendJson(response, 200, { jobId, title: `${jobId}-${count}`, files: { audio: 'audio' } }), delay)
    }
    const fileMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/file\/(transcript|chunkData)$/)
    if (fileMatch) {
      const jobId = decodeURIComponent(fileMatch[1])
      const kind = fileMatch[2]
      if (jobId === 'invalid' && kind === 'transcript') return send(response, 200, 'application/json', '{invalid')
      const body = kind === 'transcript'
        ? { segments: [{ start: 0, end: 1, words: [{ word: jobId, start: 0, end: 1 }] }] }
        : { s: [{ chunks: [{ a: 0, b: 1, en: jobId }] }] }
      return sendJson(response, 200, body)
    }
    const marksMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/reader-marks$/)
    if (marksMatch) return sendJson(response, 200, { marks: [] })
    const mediaMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/media\/audio$/)
    if (mediaMatch) {
      const jobId = decodeURIComponent(mediaMatch[1])
      if (jobId === 'missing') return send(response, 410, 'text/plain', 'gone')
      if (jobId === 'no-range') return send(response, 200, 'audio/wav', Buffer.from('not-range-capable'))
      response.writeHead(206, {
        'accept-ranges': 'bytes',
        'content-range': 'bytes 0-0/16',
        'content-length': '1',
        'content-type': 'audio/wav',
      })
      return response.end(Buffer.from([0]))
    }
    send(response, 404, 'text/plain', 'not found')
  } catch (error) {
    send(response, 500, 'text/plain', error.stack || String(error))
  }
})

const serverPort = await listenOnBrowserSafePort(server)
const origin = `http://127.0.0.1:${serverPort}`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
let page = await context.newPage()
const evidence = []

try {
  await page.goto(origin)
  const setup = await page.evaluate(async (baseUrl) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('SeekPlayerDB')
      request.onsuccess = resolve
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('SeekPlayerDB', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' })
      request.onsuccess = () => { request.result.close(); resolve() }
      request.onerror = () => reject(request.error)
    })
    const [{ createReaderSessionPersistence }, { createYoutubeWorkflowClient }, { createYoutubeWorkflowLoader }] = await Promise.all([
      import('/src/services/persistence/reader-session-persistence.js'),
      import('/src/composables/youtube-workflow-client.js'),
      import('/src/composables/youtube-workflow-loader.js'),
    ])
    const persistence = createReaderSessionPersistence()
    const old = session('old')
    await persistence.commit(old)
    const visible = { contentId: 'old', transcript: 'old', chunk: 'old', audio: 'old' }
    const client = createYoutubeWorkflowClient({ baseUrl })
    function loader(
      commit = persistence.commit,
      loadCommitted = persistence.loadCommitted,
      loadCurrentRevision = persistence.loadCurrentRevision,
    ) {
      const sessionPublisher = {
        async captureVisibleSession() { return structuredClone(visible) },
        async publishPreparedSession(prepared) {
          visible.audio = prepared.audioMeta.jobId
          visible.contentId = prepared.audioMeta.jobId
          visible.transcript = prepared.transcript.segments[0].words[0].word
          visible.chunk = prepared.chunkData.s[0].chunks[0].en
        },
        async restoreVisibleSession(snapshot) { Object.assign(visible, snapshot) },
      }
      return createYoutubeWorkflowLoader({
        client,
        hasCurrentContent: () => false,
        readerSessionPersistence: { commit, loadCommitted, loadCurrentRevision },
        sessionPublisher,
        applyCurrentAudioMeta(meta) { visible.audio = meta.jobId; visible.contentId = meta.jobId },
        processTranscript(value) { visible.transcript = value.segments[0].words[0].word },
        processChunkData(value) { visible.chunk = value.s[0].chunks[0].en },
        validateTranscriptData: (value) => value,
        validateChunkData: (value) => value,
        audioPlayer: {},
      })
    }
    globalThis.__readerJourney = { persistence, visible, client, loader }
    return (await persistence.loadCommitted()).session

    function session(label) {
      return {
        contentId: label,
        revision: `${label}:1`,
        audioMeta: { jobId: label, streamUrl: `${baseUrl}/${label}` },
        transcript: { segments: [{ words: [{ word: label }] }] },
        chunkData: { s: [{ chunks: [{ a: 0, b: 1, en: label }] }] },
        marks: [],
      }
    }
  }, origin)
  assert.equal(setup.contentId, 'old')

  const revisionConflictRecovery = await page.evaluate(async () => {
    const state = globalThis.__readerJourney
    const before = structuredClone(state.visible)
    let currentRevision = 'external:1'
    const expectedRevisions = []
    const loader = state.loader(
      async (_session, options) => {
        expectedRevisions.push(options.expectedRevision)
        if (expectedRevisions.length === 1) {
          currentRevision = 'external:2'
          const error = new Error('simulated concurrent reader session commit')
          error.name = 'ApplicationPersistenceError'
          error.code = 'REVISION_CONFLICT'
          error.expectedRevision = options.expectedRevision
          error.actualRevision = currentRevision
          throw error
        }
        if (options.expectedRevision !== currentRevision) {
          throw new Error(`retry used stale revision ${options.expectedRevision}`)
        }
        return { status: 'committed' }
      },
      async () => ({ status: 'committed', session: { revision: currentRevision } }),
    )
    const result = await loader.loadJobIntoReader('revision-race', { replacePolicy: 'replace-current' })
    Object.assign(state.visible, before)
    return { result, expectedRevisions }
  })
  assert.equal(revisionConflictRecovery.result.status, 'loaded')
  assert.deepEqual(revisionConflictRecovery.expectedRevisions, ['external:1', 'external:2'])
  evidence.push({ journey: 'revision-conflict-during-open', outcome: 'reloaded-and-committed-current-revision' })

  const persistentRevisionConflict = await page.evaluate(async () => {
    const state = globalThis.__readerJourney
    const before = structuredClone(state.visible)
    let currentRevision = 'persistent:0'
    const expectedRevisions = []
    const loader = state.loader(
      async (_session, options) => {
        expectedRevisions.push(options.expectedRevision)
        currentRevision = `persistent:${expectedRevisions.length}`
        const error = new Error('simulated persistent reader session conflict')
        error.name = 'ApplicationPersistenceError'
        error.code = 'REVISION_CONFLICT'
        error.expectedRevision = options.expectedRevision
        error.actualRevision = currentRevision
        throw error
      },
      async () => ({ status: 'committed', session: { revision: currentRevision } }),
    )
    let errorCode = ''
    try {
      await loader.loadJobIntoReader('persistent-revision-race', { replacePolicy: 'replace-current' })
    } catch (error) {
      errorCode = error.code || ''
    }
    const after = structuredClone(state.visible)
    Object.assign(state.visible, before)
    return { errorCode, expectedRevisions, before, after }
  })
  assert.equal(persistentRevisionConflict.errorCode, 'REVISION_CONFLICT')
  assert.deepEqual(persistentRevisionConflict.expectedRevisions, ['persistent:0', 'persistent:1', 'persistent:2'])
  assert.deepEqual(persistentRevisionConflict.after, persistentRevisionConflict.before)
  evidence.push({ journey: 'persistent-revision-conflict', outcome: 'bounded-retry-and-visible-session-rollback' })

  const corruptSessionRepair = await page.evaluate(async () => {
    const state = globalThis.__readerJourney
    const before = structuredClone(state.visible)
    const expectedRevisions = []
    const loader = state.loader(
      async (_session, options) => {
        expectedRevisions.push(options.expectedRevision)
        if (options.expectedRevision !== 'corrupt-guard:1') {
          const error = new Error('corrupt guard revision was not preserved')
          error.name = 'ApplicationPersistenceError'
          error.code = 'REVISION_CONFLICT'
          error.expectedRevision = options.expectedRevision
          error.actualRevision = 'corrupt-guard:1'
          throw error
        }
        return { status: 'committed' }
      },
      async () => ({
        status: 'corrupt',
        session: null,
        error: { code: 'READER_SESSION_CORRUPT' },
      }),
      async () => 'corrupt-guard:1',
    )
    const result = await loader.loadJobIntoReader('corrupt-session-repair', { replacePolicy: 'replace-current' })
    Object.assign(state.visible, before)
    return { result, expectedRevisions }
  })
  assert.equal(corruptSessionRepair.result.status, 'loaded')
  assert.deepEqual(corruptSessionRepair.expectedRevisions, ['corrupt-guard:1'])
  evidence.push({ journey: 'corrupt-current-session', outcome: 'atomically-replaced-using-current-guard-revision' })

  for (const jobId of ['no-range', 'missing']) {
    const result = await page.evaluate(async (id) => {
      const state = globalThis.__readerJourney
      const before = structuredClone(state.visible)
      let error = null
      try { await state.loader().loadJobIntoReader(id, { replacePolicy: 'replace-current' }) } catch (caught) {
        error = { code: caught.code || '', message: caught.message }
      }
      return { id, before, after: state.visible, stored: (await state.persistence.loadCommitted()).session, error }
    }, jobId)
    assert.match(result.error?.code || '', /MEDIA_RANGE_(UNSUPPORTED|UNAVAILABLE)/)
    assert.deepEqual(result.after, result.before)
    assert.equal(result.stored.contentId, 'old')
    evidence.push({ journey: jobId, outcome: 'old-session-preserved', errorCode: result.error.code })
  }

  const rapid = await page.evaluate(async () => {
    const state = globalThis.__readerJourney
    const loader = state.loader()
    const a1 = loader.loadJobIntoReader('a', { replacePolicy: 'replace-current' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const b = loader.loadJobIntoReader('b', { replacePolicy: 'replace-current' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const a2 = loader.loadJobIntoReader('a', { replacePolicy: 'replace-current' })
    return { results: await Promise.all([a1, b, a2]), visible: state.visible, stored: (await state.persistence.loadCommitted()).session }
  })
  assert.deepEqual(rapid.results.map((item) => item.status), ['superseded', 'superseded', 'loaded'])
  assert.deepEqual(rapid.visible, { contentId: 'a', transcript: 'a', chunk: 'a', audio: 'a' })
  assert.equal(rapid.stored.contentId, 'youtube-workflow:a')
  evidence.push({ journey: 'rapid-switch-a-b-a', outcome: 'latest-a-committed' })

  const commitRace = await page.evaluate(async () => {
    const state = globalThis.__readerJourney
    let firstA = true
    const loader = state.loader(async (session, options) => {
      if (session.audioMeta.jobId === 'a' && firstA) {
        firstA = false
        await new Promise((resolve) => setTimeout(resolve, 220))
      }
      return state.persistence.commit(session, options)
    })
    const a1 = loader.loadJobIntoReader('a', { replacePolicy: 'replace-current' })
    await new Promise((resolve) => setTimeout(resolve, 25))
    const b = loader.loadJobIntoReader('b', { replacePolicy: 'replace-current' })
    await new Promise((resolve) => setTimeout(resolve, 25))
    const a2 = loader.loadJobIntoReader('a', { replacePolicy: 'replace-current' })
    return { results: await Promise.all([a1, b, a2]), visible: state.visible, stored: (await state.persistence.loadCommitted()).session }
  })
  assert.deepEqual(commitRace.results.map((item) => item.status), ['superseded', 'superseded', 'loaded'])
  assert.deepEqual(commitRace.visible, { contentId: 'a', transcript: 'a', chunk: 'a', audio: 'a' })
  assert.equal(commitRace.stored.contentId, 'youtube-workflow:a')
  assert.equal(commitRace.stored.audioMeta.name, `${commitRace.results[2].manifest.title}.audio`)
  evidence.push({ journey: 'commit-race-a-b-a', outcome: 'stale-transaction-aborted' })

  for (const jobId of ['offline', 'invalid']) {
    const failure = await page.evaluate(async (id) => {
      const state = globalThis.__readerJourney
      const before = structuredClone(state.visible)
      let rejected = false
      try { await state.loader().loadJobIntoReader(id, { replacePolicy: 'replace-current' }) } catch { rejected = true }
      return { rejected, before, after: state.visible, stored: (await state.persistence.loadCommitted()).session }
    }, jobId)
    assert.equal(failure.rejected, true)
    assert.deepEqual(failure.after, failure.before)
    assert.equal(failure.stored.contentId, 'youtube-workflow:a')
    evidence.push({ journey: jobId, outcome: 'old-session-preserved' })
  }

  const aborted = await page.evaluate(async () => {
    const state = globalThis.__readerJourney
    const before = structuredClone(state.visible)
    const loader = state.loader()
    const pending = loader.loadJobIntoReader('abort', { replacePolicy: 'replace-current' })
    await new Promise((resolve) => setTimeout(resolve, 25))
    const canceled = loader.cancelLoad()
    return { canceled, result: await pending, before, after: state.visible, stored: (await state.persistence.loadCommitted()).session }
  })
  assert.equal(aborted.canceled, true)
  assert.equal(aborted.result.status, 'superseded')
  assert.deepEqual(aborted.after, aborted.before)
  assert.equal(aborted.stored.contentId, 'youtube-workflow:a')
  evidence.push({ journey: 'abort', outcome: 'old-session-preserved' })

  for (const fault of [
    { name: 'quota', domName: 'QuotaExceededError' },
    { name: 'connection-close', domName: 'InvalidStateError' },
  ]) {
    const injected = await page.evaluate(async ({ name, domName }) => {
      const state = globalThis.__readerJourney
      const before = structuredClone(state.visible)
      const loader = state.loader(async () => { throw new DOMException(name, domName) })
      let errorName = ''
      try { await loader.loadJobIntoReader(`fault-${name}`, { replacePolicy: 'replace-current' }) } catch (error) { errorName = error.name }
      return { errorName, before, after: state.visible, stored: (await state.persistence.loadCommitted()).session }
    }, fault)
    assert.equal(injected.errorName, fault.domName)
    assert.deepEqual(injected.after, injected.before)
    assert.equal(injected.stored.contentId, 'youtube-workflow:a')
    evidence.push({ journey: fault.name, outcome: 'old-session-preserved', errorName: injected.errorName })
  }

  const committed = await page.evaluate(async () => {
    const state = globalThis.__readerJourney
    return state.loader().loadJobIntoReader('reload', { replacePolicy: 'replace-current' })
  })
  assert.equal(committed.status, 'loaded')
  await page.close()
  page = await context.newPage()
  await page.goto(origin)
  const restored = await page.evaluate(async () => {
    const { createReaderSessionPersistence } = await import('/src/services/persistence/reader-session-persistence.js')
    return createReaderSessionPersistence().loadCommitted()
  })
  assert.equal(restored.status, 'committed')
  assert.equal(restored.session.contentId, 'youtube-workflow:reload')
  assert.equal(restored.session.transcript.segments[0].words[0].word, 'reload')
  assert.equal(restored.session.chunkData.s[0].chunks[0].en, 'reload')
  assert.equal(restored.session.audioMeta.jobId, 'reload')
  evidence.push({ journey: 'close-reload', outcome: 'new-session-fully-restored' })

  let pageCloseBefore = await readReaderSessionSnapshot(page)
  for (const closeAfterPut of [1, 3, 5]) {
    const candidate = {
      contentId: `page-close-new-${closeAfterPut}`,
      revision: `page-close:${closeAfterPut}`,
      audioMeta: {
        jobId: `page-close-new-${closeAfterPut}`,
        streamUrl: `${origin}/page-close-new-${closeAfterPut}`,
      },
      transcript: { segments: [{ words: [{ word: `page-close-new-${closeAfterPut}` }] }] },
      chunkData: { s: [{ chunks: [{ en: `page-close-new-${closeAfterPut}` }] }] },
      marks: [{ globalIndex: 0, word: `page-close-new-${closeAfterPut}` }],
    }
    const closeResult = await closeReaderPageDuringTransaction({
      context,
      origin,
      candidate,
      closeAfterPut,
    })
    assert.equal(closeResult.closeError, null)
    assert.equal(closeResult.dialog.phase, 'put-success')
    assert.equal(closeResult.dialog.putIndex, closeAfterPut)
    assert.equal(closeResult.dialog.commitSettled, false)
    assert.equal(closeResult.dialog.transactionComplete, false)
    assert.equal(closeResult.commitSuccess, false, `writer events: ${closeResult.events.join(', ')}`)

    const recovered = await readReaderSessionSnapshot(page)
    assert.equal(recovered.restored.status, 'committed')
    assert.ok(
      [pageCloseBefore.restored.session.contentId, candidate.contentId].includes(recovered.restored.session.contentId),
      `unexpected recovered content: ${recovered.restored.session.contentId}`,
    )
    assertReaderSessionSnapshotIsWhole(recovered)
    evidence.push({
      journey: `page-close-during-transaction-after-put-${closeAfterPut}`,
      outcome: 'only-complete-old-or-new-revision-recovered',
      recoveredContentId: recovered.restored.session.contentId,
      recoveredRevision: recovered.restored.session.revision,
    })
    pageCloseBefore = recovered
  }

  console.log(JSON.stringify({ status: 'passed', origin, journeys: evidence }, null, 2))
} finally {
  await context.close()
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}

function send(response, status, contentType, body) {
  response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' })
  response.end(body)
}

function sendJson(response, status, value) {
  send(response, status, 'application/json', JSON.stringify(value))
}

async function closeReaderPageDuringTransaction({ context, origin, candidate, closeAfterPut }) {
  const writer = await context.newPage()
  const events = []
  let dialog = null
  let closeError = null
  let writerClosedResolve
  const writerClosed = new Promise((resolve) => { writerClosedResolve = resolve })
  writer.on('console', (message) => events.push(message.text()))
  writer.on('dialog', async (activeDialog) => {
    dialog = JSON.parse(activeDialog.message())
    try {
      await writer.close()
    } catch (error) {
      closeError = error
    }
    try { await activeDialog.dismiss() } catch { /* Closing the page dismisses the dialog. */ }
    writerClosedResolve()
  })
  await writer.goto(origin)
  await writer.evaluate(async ({ candidate: session, closeAfterPut: stopAt }) => {
    let commitSettled = false
    let transactionComplete = false
    const originalTransaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = originalTransaction.apply(this, args)
      if (args[1] === 'readwrite') {
        transaction.addEventListener('complete', () => { transactionComplete = true }, { once: true })
      }
      return transaction
    }
    const originalPut = IDBObjectStore.prototype.put
    let putIndex = 0
    IDBObjectStore.prototype.put = function (...args) {
      const request = originalPut.apply(this, args)
      const index = ++putIndex
      request.addEventListener('success', () => {
        if (index === stopAt) {
          alert(JSON.stringify({ phase: 'put-success', putIndex: index, commitSettled, transactionComplete }))
        }
      }, { once: true })
      return request
    }
    const { createReaderSessionPersistence } = await import('/src/services/persistence/reader-session-persistence.js')
    const persistence = createReaderSessionPersistence()
    const commit = persistence.commit(session)
    globalThis.__pageCloseCommit = commit
    commit.then(() => {
      commitSettled = true
      console.log('reader-page-close:commit-success')
    }).catch((error) => {
      console.log(`reader-page-close:commit-error:${error.name}:${error.code || ''}`)
    })
  }, { candidate, closeAfterPut })
  await Promise.race([
    writerClosed,
    new Promise((_, reject) => setTimeout(() => reject(new Error('page-close transaction signal timed out')), 10_000)),
  ])
  return {
    dialog,
    closeError,
    commitSuccess: events.includes('reader-page-close:commit-success'),
    events,
  }
}

async function readReaderSessionSnapshot(page) {
  return page.evaluate(async () => {
    const { createReaderSessionPersistence } = await import('/src/services/persistence/reader-session-persistence.js')
    const persistence = createReaderSessionPersistence()
    const restored = await persistence.loadCommitted()
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('SeekPlayerDB', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const rows = await new Promise((resolve, reject) => {
      const transaction = database.transaction(['files'], 'readonly')
      const store = transaction.objectStore('files')
      const values = new Map()
      for (const id of ['audioMeta', 'transcript', 'chunkData', 'marks', 'readerSession']) {
        const request = store.get(id)
        request.onsuccess = () => values.set(id, request.result)
        request.onerror = () => reject(request.error)
      }
      transaction.oncomplete = () => resolve(Object.fromEntries(values))
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error || new Error('reader session read transaction aborted'))
    })
    database.close()
    return { restored, rows }
  })
}

function assertReaderSessionSnapshotIsWhole(snapshot) {
  const session = snapshot.restored.session
  const rows = snapshot.rows
  const ids = ['audioMeta', 'transcript', 'chunkData', 'marks', 'readerSession']
  assert.deepEqual(Object.keys(rows).sort(), ids.sort())
  assert.equal(session.audioMeta.jobId, session.contentId)
  assert.equal(session.transcript.segments[0].words[0].word, session.contentId)
  assert.equal(session.chunkData.s[0].chunks[0].en, session.contentId)
  assert.equal(session.marks[0].word, session.contentId)

  const rowValues = ids.map((id) => rows[id])
  assert.equal(new Set(rowValues.map((row) => row.contentId)).size, 1)
  assert.equal(new Set(rowValues.map((row) => row.revision)).size, 1)
  assert.equal(new Set(rowValues.map((row) => row.checksum)).size, 1)
  assert.equal(rowValues[0].contentId, session.contentId)
  assert.equal(rowValues[0].revision, session.revision)
  assert.match(rowValues[0].checksum, /^sha256:[a-f0-9]{64}$/)
  assert.equal(rows.readerSession.content.checksum, rowValues[0].checksum)
  assert.equal(rows.readerSession.content.contentId, session.contentId)
  assert.equal(rows.readerSession.content.revision, session.revision)
}
