import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

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

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const origin = `http://127.0.0.1:${server.address().port}`
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
    function loader(commit = persistence.commit) {
      return createYoutubeWorkflowLoader({
        client,
        hasCurrentContent: () => false,
        readerSessionPersistence: { commit },
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
