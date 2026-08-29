import assert from 'node:assert/strict'
import http from 'node:http'
import { createServer as createViteServer } from 'vite'
import { chromium } from 'playwright'

import { listenOnBrowserSafePort } from './lib/browser-port-policy.mjs'

const CONTRACT_VERSION = 'windows-thin-reader-api.v1'
const PROFILE_ID = 'optimization'
const INSTANCE_ID = 'reader-session-c1-instance'
const ACCESS_TOKEN = 'reader-session-c1-http-only-token'
const FINGERPRINT = `sha256:${'c'.repeat(64)}`

const fixture = {
  ownerRequests: [],
  mediaRequests: [],
  prepared: new Map(),
  receipts: new Map(),
  committedSnapshots: new Map(),
  snapshot: null,
  hostReady: true,
  ownerNotReady: false,
  commandMode: null,
  rangeMismatch: false,
  descriptorMismatch: false,
  snapshotMode: null,
  prepareSequence: 0,
}

fixture.snapshot = makeSnapshot(makeCandidate('job-old', 1), 'commit', 0)

const vite = await createViteServer({
  root: process.cwd(),
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: {
    middlewareMode: true,
    hmr: false,
    fs: { allow: [process.cwd()] },
  },
})

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/') {
      return send(response, 200, 'text/html', '<!doctype html><meta charset="utf-8"><title>Reader Session C1</title>')
    }
    if (url.pathname === '/__c1/control' && request.method === 'GET') {
      if (url.searchParams.has('rangeMismatch')) fixture.rangeMismatch = url.searchParams.get('rangeMismatch') === 'true'
      if (url.searchParams.has('hostReady')) fixture.hostReady = url.searchParams.get('hostReady') === 'true'
      if (url.searchParams.has('ownerNotReady')) fixture.ownerNotReady = url.searchParams.get('ownerNotReady') === 'true'
      if (url.searchParams.has('descriptorMismatch')) fixture.descriptorMismatch = url.searchParams.get('descriptorMismatch') === 'true'
      if (url.searchParams.has('snapshotMode')) {
        const snapshotMode = url.searchParams.get('snapshotMode')
        fixture.snapshotMode = snapshotMode === 'bad' ? 'bad' : null
      }
      if (url.searchParams.has('commandMode')) {
        const commandMode = url.searchParams.get('commandMode')
        fixture.commandMode = commandMode === 'none' ? null : commandMode
      }
      return sendJson(response, 200, {
        ok: true,
        hostReady: fixture.hostReady,
        rangeMismatch: fixture.rangeMismatch,
        ownerNotReady: fixture.ownerNotReady,
        descriptorMismatch: fixture.descriptorMismatch,
        snapshotMode: fixture.snapshotMode,
        commandMode: fixture.commandMode,
      })
    }
    if (url.pathname === '/__c1/state' && request.method === 'GET') {
      return sendJson(response, 200, {
        ownerRequests: fixture.ownerRequests.length,
        mediaRequests: fixture.mediaRequests.length,
        prepareRequests: fixture.ownerRequests.filter((item) => item.body.kind === 'command' && item.body.operation === 'prepare').length,
        commitRequests: fixture.ownerRequests.filter((item) => item.body.kind === 'command' && item.body.operation === 'commit').length,
        commitIdempotencyKeys: fixture.ownerRequests
          .filter((item) => item.body.kind === 'command' && item.body.operation === 'commit')
          .map((item) => item.body.idempotencyKey),
        commitReceiptIds: Object.fromEntries([...fixture.receipts.entries()]
          .map(([key, receipt]) => [key, receipt.receiptId])),
      })
    }
    if (url.pathname === '/api/app/health' && request.method === 'GET') return sendJson(response, 200, makeReadyHealth())
    if (url.pathname === '/api/app/owner' && request.method === 'POST') return handleOwnerRequest(request, response)
    const mediaMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/media\/(audio|video)$/u)
    if (mediaMatch && request.method === 'GET') return handleMediaRequest(request, response, mediaMatch)
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
const observedRequests = []
page.on('request', (request) => observedRequests.push({ method: request.method(), url: request.url() }))

try {
  await context.addCookies([{
    name: 'read_web_instance',
    value: ACCESS_TOKEN,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  }])
  await page.goto(origin, { waitUntil: 'domcontentloaded' })

  const result = await page.evaluate(async ({ contractVersion, profileId, instanceId }) => {
    const [apiModule, consumerModule, compositionModule, loaderModule, restoreModule] = await Promise.all([
      import('/src/services/windows-owner-api-client.js'),
      import('/src/services/windows-owner-reader-session-consumer.js'),
      import('/src/services/windows-owner-reader-session-composition.js'),
      import('/src/composables/youtube-workflow-loader.js'),
      import('/src/composables/session-restore-runtime.js'),
    ])
    const { createWindowsOwnerApiClient } = apiModule
    const {
      createWindowsOwnerReaderSessionConsumer,
    } = consumerModule
    const { initializeWindowsOwnerReaderSessionComposition } = compositionModule
    const { createYoutubeWorkflowLoader } = loaderModule
    const { createSessionRestoreRuntime } = restoreModule

    const audio = createMediaElement()
    const client = createWindowsOwnerApiClient({ profileId, instanceId, timeoutMs: 1500 })
    const control = async (values) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(values || {})) params.set(key, String(value))
      const response = await fetch(`/__c1/control?${params.toString()}`)
      if (!response.ok) throw new Error(`C1 fixture control failed: ${response.status}`)
    }
    const counts = async () => {
      const response = await fetch('/__c1/state')
      if (!response.ok) throw new Error(`C1 fixture state failed: ${response.status}`)
      return response.json()
    }

    const preflightAudio = createMediaElement()
    await control({ hostReady: false })
    const notReadyComposition = await initializeWindowsOwnerReaderSessionComposition({
      windowObject: window,
      documentObject: document,
      mediaElement: preflightAudio,
      fetchImpl: window.fetch.bind(window),
    })
    if (notReadyComposition.status !== 'not-ready' || window.__windowsOwnerReaderSessionConsumer != null) {
      throw new Error('pre-cutover Host readiness must not inject a Reader Session owner')
    }
    await control({ hostReady: true })

    const composition = await initializeWindowsOwnerReaderSessionComposition({
      windowObject: window,
      documentObject: document,
      mediaElement: audio,
      fetchImpl: window.fetch.bind(window),
      timeoutMs: 1500,
    })
    if (composition.status !== 'ready' || composition.source !== 'host-readiness') {
      throw new Error(`production owner composition did not use Host readiness: ${JSON.stringify(composition)}`)
    }
    const owner = composition.readerSessionOwner
    if (window.__windowsOwnerReaderSessionConsumer !== owner) throw new Error('composition did not inject the owner consumer')

    const initial = await owner.load()
    if (initial.status !== 'loaded' || initial.session.contentId !== 'youtube-workflow:job-old') {
      throw new Error(`initial owner session did not load: ${JSON.stringify(initial)}`)
    }
    if (audio.getAttribute('src') !== '/api/jobs/job-old/media/audio') throw new Error('owner load did not bind its authorized URL')
    audio.currentTime = 8
    await audio.play()
    if (audio.playCalls !== 1 || audio.currentTime !== 8) throw new Error('playback/seek did not stay on the direct media element')
    const oldSession = initial.session

    await control({ rangeMismatch: true })
    const rangeMismatch = await owner.load({ fallbackSession: oldSession })
    if (rangeMismatch.status !== 'media-rebind-required' || rangeMismatch.session !== oldSession) {
      throw new Error(`Range/ETag mismatch did not preserve the old session: ${JSON.stringify(rangeMismatch)}`)
    }
    if (owner.getDescriptor() !== null || audio.getAttribute('src') !== null) throw new Error('media mismatch did not dispose the old resource')
    await control({ rangeMismatch: false })

    await control({ descriptorMismatch: true })
    const revisionMismatch = await owner.load({ fallbackSession: oldSession })
    if (revisionMismatch.status !== 'media-rebind-required' || revisionMismatch.session !== oldSession) {
      throw new Error(`media revision mismatch did not preserve the old session: ${JSON.stringify(revisionMismatch)}`)
    }
    if (owner.getDescriptor() !== null || audio.getAttribute('src') !== null) {
      throw new Error('media revision mismatch did not dispose the old resource')
    }
    await control({ descriptorMismatch: false })

    const visible = {
      contentId: oldSession.contentId,
      transcript: 'old',
      chunk: 'old',
      audio: 'old',
    }
    let persistenceWrites = 0
    const publisher = {
      async captureVisibleSession() { return structuredClone(visible) },
      async publishPreparedSession(prepared) {
        visible.contentId = prepared.contentId
        visible.transcript = prepared.transcript.segments[0].words[0].word
        visible.chunk = prepared.chunkData.s[0].chunks[0].en
        visible.audio = prepared.audioUrl
      },
      async restoreVisibleSession(snapshot) { Object.assign(visible, snapshot) },
    }
    const workflowClient = {
      async getSession(jobId) {
        return {
          jobId,
          title: 'Owner-backed material',
          files: { audio: 'audio', transcript: 'transcript', chunkData: 'chunkData' },
        }
      },
      async getFile(_jobId, kind) {
        if (kind === 'transcript') return new Blob([JSON.stringify({
          segments: [{ words: [{ word: 'job-new', start: 0, end: 1 }] }],
        })], { type: 'application/json' })
        return new Blob([JSON.stringify({
          s: [{ chunks: [{ a: 0, b: 1, en: 'job-new' }] }],
        })], { type: 'application/json' })
      },
      async getReaderMarks() { return { marks: [] } },
    }
    const persistence = {
      async commit() { persistenceWrites += 1; throw new Error('browser persistence must not be used in owner mode') },
      async loadCommitted() { persistenceWrites += 1; throw new Error('browser persistence must not be read in owner mode') },
      async loadCurrentRevision() { persistenceWrites += 1; throw new Error('browser persistence must not be read in owner mode') },
    }
    const loader = createYoutubeWorkflowLoader({
      client: workflowClient,
      readerSessionOwner: owner,
      readerSessionPersistence: persistence,
      hasCurrentContent: () => false,
      sessionPublisher: publisher,
      validateTranscriptData: (value) => value,
      validateChunkData: (value) => value,
    })
    const switched = await loader.loadJobIntoReader('job-new', { replacePolicy: 'replace-current' })
    if (switched.status !== 'loaded' || visible.contentId !== 'youtube-workflow:job-new') {
      throw new Error(`owner material switch failed: ${JSON.stringify(switched)}`)
    }
    if (persistenceWrites !== 0) throw new Error('owner material switch touched browser durable persistence')
    const switchedDescriptor = owner.getDescriptor()
    if (!switchedDescriptor || switchedDescriptor.authorizedUrl !== '/api/jobs/job-new/media/audio') {
      throw new Error('material switch did not retain the Host authorized media descriptor')
    }
    const switchedContentId = visible.contentId

    const beforeStableRetry = await counts()
    const switchedCommitKey = beforeStableRetry.commitIdempotencyKeys.at(-1)
    const switchedReceiptId = beforeStableRetry.commitReceiptIds[switchedCommitKey]
    const retryLoader = createYoutubeWorkflowLoader({
      client: workflowClient,
      readerSessionOwner: owner,
      readerSessionPersistence: persistence,
      hasCurrentContent: () => false,
      sessionPublisher: publisher,
      validateTranscriptData: (value) => value,
      validateChunkData: (value) => value,
    })
    const stableRetry = await retryLoader.loadJobIntoReader('job-new', { replacePolicy: 'replace-current' })
    const afterStableRetry = await counts()
    if (stableRetry.status !== 'loaded'
      || afterStableRetry.prepareRequests !== beforeStableRetry.prepareRequests
      || afterStableRetry.commitRequests !== beforeStableRetry.commitRequests
      || afterStableRetry.commitReceiptIds[switchedCommitKey] !== switchedReceiptId) {
      throw new Error('recreated loader did not reuse the committed candidate receipt')
    }

    const beforeFailedSwitch = structuredClone(visible)
    await control({ commandMode: 'not-ready' })
    const failedLoader = createYoutubeWorkflowLoader({
      client: {
        ...workflowClient,
        async getSession(jobId) { return { jobId, title: 'Rejected', files: { audio: 'audio', transcript: 'transcript', chunkData: 'chunkData' } } },
        async getFile(_jobId, kind) {
          if (kind === 'transcript') return new Blob([JSON.stringify({ segments: [{ words: [{ word: 'rejected' }] }] })])
          return new Blob([JSON.stringify({ s: [{ chunks: [{ a: 0, b: 1, en: 'rejected' }] }] })])
        },
      },
      readerSessionOwner: owner,
      readerSessionPersistence: persistence,
      hasCurrentContent: () => false,
      sessionPublisher: publisher,
      validateTranscriptData: (value) => value,
      validateChunkData: (value) => value,
    })
    await expectReject(() => failedLoader.loadJobIntoReader('job-failed', { replacePolicy: 'replace-current' }))
    if (persistenceWrites !== 0 || JSON.stringify(visible) !== JSON.stringify(beforeFailedSwitch)) {
      throw new Error('not-ready owner commit did not preserve the visible session without browser fallback')
    }
    if (owner.getDescriptor()?.authorizedUrl !== switchedDescriptor.authorizedUrl) {
      throw new Error('failed owner switch did not rebind the old media descriptor')
    }
    await control({ commandMode: 'none' })

    const legacyAudio = createMediaElement()
    legacyAudio.src = '/legacy/audio'
    const legacyVisible = {
      contentId: 'legacy-browser-session',
      audio: legacyAudio.getAttribute('src'),
      transcript: 'legacy',
      chunk: 'legacy',
    }
    const legacyOwner = createWindowsOwnerReaderSessionConsumer({
      profileId,
      ownerClient: createWindowsOwnerApiClient({ profileId, instanceId: `${instanceId}-legacy`, timeoutMs: 1500 }),
      mediaElement: legacyAudio,
      fetchImpl: window.fetch.bind(window),
    })
    const legacyPublisher = {
      async captureVisibleSession() { return structuredClone(legacyVisible) },
      async publishPreparedSession(prepared) {
        legacyVisible.contentId = prepared.contentId
        legacyVisible.transcript = prepared.transcript.segments[0].words[0].word
        legacyVisible.chunk = prepared.chunkData.s[0].chunks[0].en
        legacyVisible.audio = prepared.audioUrl
        legacyAudio.src = prepared.audioUrl
      },
      async restoreVisibleSession(snapshot) {
        Object.assign(legacyVisible, snapshot)
        legacyAudio.src = snapshot.audio
      },
    }
    await control({ commandMode: 'not-ready' })
    const legacyLoader = createYoutubeWorkflowLoader({
      client: workflowClient,
      readerSessionOwner: legacyOwner,
      readerSessionPersistence: persistence,
      hasCurrentContent: () => false,
      sessionPublisher: legacyPublisher,
      validateTranscriptData: (value) => value,
      validateChunkData: (value) => value,
    })
    await expectReject(() => legacyLoader.loadJobIntoReader('job-legacy', { replacePolicy: 'replace-current' }))
    if (legacyVisible.contentId !== 'legacy-browser-session'
      || legacyAudio.getAttribute('src') !== '/legacy/audio'
      || legacyVisible.audio !== '/legacy/audio'
      || legacyOwner.getDescriptor() !== null) {
      throw new Error('legacy visible session/audio was not restored after owner commit failure')
    }
    legacyOwner.dispose()
    await control({ commandMode: 'none' })

    const beforeConflictSwitch = structuredClone(visible)
    const previousConflictDescriptor = owner.getDescriptor()
    await control({ commandMode: 'conflict' })
    await expectReject(() => loader.loadJobIntoReader('job-cas-conflict', { replacePolicy: 'replace-current' }))
    if (persistenceWrites !== 0 || JSON.stringify(visible) !== JSON.stringify(beforeConflictSwitch)) {
      throw new Error('owner CAS conflict did not preserve the visible session without browser fallback')
    }
    if (owner.getDescriptor()?.authorizedUrl !== previousConflictDescriptor?.authorizedUrl) {
      throw new Error('owner CAS conflict did not restore the previous media descriptor')
    }
    await control({ commandMode: 'none' })

    const beforeUnknown = structuredClone(visible)
    const previousUnknownDescriptor = owner.getDescriptor()
    await control({ commandMode: 'unknown-no-evidence' })
    let unconfirmedResult = null
    let unconfirmedError = null
    try {
      unconfirmedResult = await loader.loadJobIntoReader('job-unknown-no-evidence', { replacePolicy: 'replace-current' })
    } catch (error) {
      unconfirmedError = { code: error?.code || '', message: error?.message || String(error) }
    }
    if (!unconfirmedError) throw new Error(`unconfirmed owner commit unexpectedly completed: ${JSON.stringify(unconfirmedResult)}`)
    if (persistenceWrites !== 0 || JSON.stringify(visible) !== JSON.stringify(beforeUnknown)) {
      throw new Error('unconfirmed owner commit did not preserve the visible session without browser fallback')
    }
    if (owner.getDescriptor()?.authorizedUrl !== previousUnknownDescriptor?.authorizedUrl) {
      throw new Error('unconfirmed owner commit did not restore the previous media descriptor')
    }
    await control({ commandMode: 'none' })

    const beforeUnknownWrites = persistenceWrites
    await control({ commandMode: 'commit-unknown' })
    const commitUnknown = await loader.loadJobIntoReader('job-unknown', { replacePolicy: 'replace-current' })
    if (commitUnknown.status !== 'loaded' || visible.contentId !== 'youtube-workflow:job-unknown') {
      throw new Error(`commit-unknown receipt recovery did not converge: ${JSON.stringify(commitUnknown)}`)
    }
    if (persistenceWrites !== beforeUnknownWrites) throw new Error('commit-unknown recovery used browser persistence')
    await control({ commandMode: 'none' })

    const reopenedAudio = createMediaElement()
    const reopenedOwner = createWindowsOwnerReaderSessionConsumer({
      profileId,
      ownerClient: createWindowsOwnerApiClient({ profileId, instanceId: `${instanceId}-reopened`, timeoutMs: 1500 }),
      mediaElement: reopenedAudio,
      fetchImpl: window.fetch.bind(window),
    })
    const reopened = await reopenedOwner.load()
    if (reopened.status !== 'loaded' || reopened.session.contentId !== 'youtube-workflow:job-unknown') {
      throw new Error('Host restart/reopen did not restore the committed session')
    }

    const restoreAudio = createMediaElement()
    const restoreOwner = createWindowsOwnerReaderSessionConsumer({
      profileId,
      ownerClient: createWindowsOwnerApiClient({ profileId, instanceId: `${instanceId}-restore`, timeoutMs: 1500 }),
      mediaElement: restoreAudio,
      fetchImpl: window.fetch.bind(window),
    })
    const legacyReads = []
    const restoreRuntime = createSessionRestoreRuntime({
      readerSessionOwner: restoreOwner,
      readerSessionPersistence: persistence,
      state: { currentAudioKey: '', markedMap: new Map(), isChunkMode: false },
      namespace: { currentDocId: '' },
      audioPlayer: restoreAudio,
      lblAudio: {},
      lblTranscript: {},
      lblVisual: {},
      async loadFromDB(key) { legacyReads.push(key); throw new Error('owner restore must not use browser persistence') },
      markFileLoaded() {},
      applyCurrentAudioMeta() {},
      processTranscript() {},
      processChunkData() {},
      processVisual() {},
      normalizeAnnotationMark(value) { return value },
      renderTranscript() {},
      syncAnnotationGenerationEntryStatus() {},
      bridgeToPinia() {},
      getAnnotationGeneratedResultStore() { return { getItems() { return [] } } },
      getAnnotationGenerationScope() { return { audioKey: '', documentId: '' } },
      buildCurrentSentenceDocId() { return '' },
      scheduleGeneratedAnnotationIndexRefresh() {},
      emitAnnotationDiagnostics() {},
    })
    const restored = await restoreRuntime.restoreSession()
    if (restored.status !== 'restored' || restored.source !== 'owner' || legacyReads.length !== 0) {
      throw new Error(`owner session restore did not remain Host-backed: ${JSON.stringify(restored)}`)
    }

    const beforeBadSnapshot = reopenedOwner.getDescriptor()
    await control({ snapshotMode: 'bad' })
    const badSnapshot = await reopenedOwner.load({ fallbackSession: reopened.session })
    if (badSnapshot.status !== 'rejected' || badSnapshot.session !== reopened.session) {
      throw new Error('malformed owner snapshot did not preserve the existing Reader Session')
    }
    if (reopenedOwner.getDescriptor()?.authorizedUrl !== beforeBadSnapshot?.authorizedUrl) {
      throw new Error('malformed owner snapshot changed the existing media resource')
    }
    await control({ snapshotMode: 'none' })

    await control({ ownerNotReady: true })
    const notReady = await reopenedOwner.load({ fallbackSession: reopened.session })
    if (notReady.status !== 'rejected' || notReady.session !== reopened.session) {
      throw new Error('owner not-ready did not preserve the existing Reader Session')
    }
    await control({ ownerNotReady: false })

    const beforeBinaryCalls = (await counts()).ownerRequests
    const binaryCases = [
      { blob: new Blob(['complete-media']) },
      { arrayBuffer: new ArrayBuffer(1) },
      { typedArray: new Uint8Array([1]) },
      { dataUri: 'data:audio/wav;base64,AAAA' },
      { base64: `UklGR${'A'.repeat(128)}` },
      { path: 'C:\\Users\\reader\\audio.wav' },
    ]
    for (const binaryValue of binaryCases) {
      const binaryAttempt = await owner.commitSession({
        contentId: 'youtube-workflow:binary',
        revision: 'not-used',
        audioMeta: binaryValue,
        transcript: { segments: [] },
        chunkData: [],
        marks: [],
        media: reopened.session.media,
      }, { expectedRevision: reopened.revision, idempotencyKey: `binary-rejected-${Object.keys(binaryValue)[0]}` })
      if (binaryAttempt.status !== 'rejected') throw new Error('complete media was not rejected before a Host command')
    }
    if ((await counts()).ownerRequests !== beforeBinaryCalls) {
      throw new Error('complete media was not rejected before a Host command')
    }

    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
    const finalCounts = await counts()
    return {
      initialRevision: initial.revision,
      switchedContentId,
      reopenedContentId: reopened.session.contentId,
      restoredSource: restored.source,
      rangeRequests: finalCounts.mediaRequests,
      ownerRequests: finalCounts.ownerRequests,
      directAuthorizedUrls: [audio.getAttribute('src'), reopenedAudio.getAttribute('src'), restoreAudio.getAttribute('src')],
      storage: { localStorage: Object.keys(localStorage), indexedDb: databases.map((item) => item.name).filter(Boolean) },
      asyncEvidence: { playCalls: audio.playCalls, seek: audio.currentTime },
      compositionStatus: composition.status,
      commitKeys: finalCounts.commitIdempotencyKeys,
    }

    async function expectReject(operation) {
      try {
        await operation()
      } catch (error) {
        if (!error?.code) throw error
        return
      }
      throw new Error('expected owner operation to reject')
    }

    function createMediaElement() {
      const media = document.createElement('audio')
      media.preload = 'none'
      media.playCalls = 0
      media.play = function () { this.playCalls += 1; return Promise.resolve() }
      document.body.appendChild(media)
      return media
    }
  }, { contractVersion: CONTRACT_VERSION, profileId: PROFILE_ID, instanceId: INSTANCE_ID })

  assert.equal(result.initialRevision, 1)
  assert.equal(result.switchedContentId, 'youtube-workflow:job-new')
  assert.equal(result.reopenedContentId, 'youtube-workflow:job-unknown')
  assert.equal(result.restoredSource, 'owner')
  assert.equal(result.compositionStatus, 'ready')
  assert.ok(fixture.ownerRequests.some((request) => request.body.domain === 'workflow'
    && request.body.operation === 'media-capability'
    && request.body.payload?.jobId === 'job-new'
    && request.body.payload?.mediaKind === 'audio'), 'new material must use the workflow media capability query')
  assert.equal(fixture.ownerRequests.some((request) => request.body.domain === 'reader-session'
    && request.body.operation === 'media-identity'
    && request.body.payload?.contentId === 'youtube-workflow:job-new'), false,
  'new material must not use the committed session media query')
  assert.ok(result.rangeRequests >= 5, 'C1 should probe each authorized binding with Range')
  assert.ok(result.ownerRequests >= 12, 'C1 should use typed owner queries and prepare/commit')
  assert.equal(new Set(result.commitKeys).size, result.commitKeys.length, 'different materials must not reuse a commit key')
  assert.deepEqual(result.storage.localStorage, [])
  assert.deepEqual(result.storage.indexedDb, [])
  assert.equal(result.asyncEvidence.playCalls, 1)
  assert.equal(result.asyncEvidence.seek, 8)
  assert.ok(result.directAuthorizedUrls.every((url) => url === null || url.startsWith('/api/jobs/')))
  assert.ok(observedRequests.every((request) => !request.url.includes(ACCESS_TOKEN)))
  assert.ok(fixture.ownerRequests.every((request) => request.url === '/api/app/owner'))
  assert.ok(fixture.ownerRequests.every((request) => !request.raw.includes(ACCESS_TOKEN)))
  assert.ok(fixture.mediaRequests.every((request) => request.range === 'bytes=0-0'))
  assert.ok(fixture.mediaRequests.every((request) => request.status === 206))
  assert.ok(fixture.mediaRequests.every((request) => request.responseBytes === 1))
  assert.ok(fixture.ownerRequests.some((request) => request.body.operation === 'prepare'))
  assert.ok(fixture.ownerRequests.some((request) => request.body.operation === 'commit'))
  console.log('Windows owner Reader Session C1 Chromium checks passed (owner restore/switch/reopen, direct Range media, rebind and no browser fallback)')
} finally {
  await context.close()
  await browser.close()
  await closeServer(server)
  await vite.close()
}

async function handleOwnerRequest(request, response) {
  const raw = await readBody(request)
  const body = JSON.parse(raw || '{}')
  const captured = {
    url: request.url,
    raw,
    body,
    cookie: String(request.headers.cookie || ''),
  }
  fixture.ownerRequests.push(captured)
  if (body.contractVersion !== CONTRACT_VERSION) return sendJson(response, 400, ownerResponse(body, { outcome: 'rejected', commitStatus: 'rejected', error: typedError(body, 'invalid-request', 'validation') }))

  if (body.kind === 'query' && body.domain === 'reader-session') {
    if (fixture.ownerNotReady) return sendJson(response, 503, ownerResponse(body, { outcome: 'not-ready', commitStatus: 'not-ready', error: typedError(body, 'not-ready', 'readiness') }))
    if (body.operation === 'snapshot') {
      const snapshot = fixture.snapshotMode === 'bad' ? { schemaVersion: 'invalid' } : fixture.snapshot
      return snapshot
        ? sendJson(response, 200, ownerResponse(body, {
          outcome: 'read',
          commitStatus: 'not-applicable',
          revision: fixture.snapshot.revision,
          payload: { snapshot, found: true },
        }))
        : sendJson(response, 200, ownerResponse(body, {
          outcome: 'read',
          commitStatus: 'not-applicable',
          revision: 0,
          payload: { found: false, empty: true },
          error: typedError(body, 'not-found', 'not-found'),
        }))
    }
    if (body.operation === 'current-revision') {
      return sendJson(response, 200, ownerResponse(body, {
        outcome: 'read',
        commitStatus: 'not-applicable',
        revision: fixture.snapshot?.revision || 0,
        payload: { revision: fixture.snapshot?.revision || 0 },
      }))
    }
    if (body.operation === 'media-identity') {
      const baseMedia = fixture.snapshot ? descriptorFromSnapshot(fixture.snapshot) : null
      if (!baseMedia) {
        return sendJson(response, 200, ownerResponse(body, {
          outcome: 'read',
          commitStatus: 'not-applicable',
          revision: 0,
          payload: { found: false, empty: true },
          error: typedError(body, 'not-found', 'not-found'),
        }))
      }
      const media = fixture.descriptorMismatch
        ? { ...baseMedia, revision: 'changed-media-revision' }
        : baseMedia
      return sendJson(response, 200, ownerResponse(body, {
        outcome: 'read',
        commitStatus: 'not-applicable',
        revision: fixture.snapshot?.revision || 0,
        payload: { media },
      }))
    }
  }

  if (body.kind === 'query' && body.domain === 'workflow' && body.operation === 'media-capability') {
    const jobId = body.payload?.jobId
    const mediaKind = body.payload?.mediaKind
    if (typeof jobId !== 'string' || (mediaKind !== 'audio' && mediaKind !== 'video')) {
      return sendJson(response, 200, ownerResponse(body, {
        outcome: 'read',
        commitStatus: 'not-applicable',
        revision: fixture.snapshot?.revision || 0,
        payload: { found: false, empty: true },
        error: typedError(body, 'not-found', 'not-found'),
      }))
    }
    return sendJson(response, 200, ownerResponse(body, {
      outcome: 'read',
      commitStatus: 'not-applicable',
      revision: fixture.snapshot?.revision || 0,
      payload: { media: makeMediaDescriptor(jobId) },
    }))
  }

  if (body.kind === 'command' && body.domain === 'reader-session' && body.operation === 'prepare') {
    const candidate = body.payload?.candidate
    const prepareId = `prepare-c1-${++fixture.prepareSequence}`
    fixture.prepared.set(prepareId, { candidate, expectedRevision: body.expectedRevision })
    return sendJson(response, 200, ownerResponse(body, {
      outcome: 'read',
      commitStatus: 'not-applicable',
      revision: fixture.snapshot?.revision || 0,
      payload: {
        prepare: {
          prepareId,
          baseRevision: fixture.snapshot?.revision || 0,
          candidateRevision: candidate?.revision,
          candidateChecksum: FINGERPRINT,
          contentId: candidate?.contentId,
          mediaIdentity: candidate?.media?.mediaId,
          expiresInSeconds: 300,
        },
      },
    }))
  }

  if (body.kind === 'command' && body.domain === 'reader-session' && body.operation === 'commit') {
    if (fixture.commandMode === 'not-ready') {
      return sendJson(response, 503, ownerResponse(body, { outcome: 'not-ready', commitStatus: 'not-ready', error: typedError(body, 'not-ready', 'readiness') }))
    }
    if (fixture.commandMode === 'conflict') {
      return sendJson(response, 409, ownerResponse(body, {
        outcome: 'conflict',
        commitStatus: 'conflict',
        revision: fixture.snapshot?.revision || 0,
        error: typedError(body, 'conflict', 'conflict'),
      }))
    }
    const existing = fixture.receipts.get(body.idempotencyKey)
    if (existing) return sendJson(response, 200, ownerResponse(body, {
      outcome: existing.commitStatus === 'committed' ? 'committed' : existing.commitStatus,
      commitStatus: existing.commitStatus,
      revision: existing.revision,
      receipt: existing,
      payload: existing.commitStatus === 'committed'
        ? { snapshot: fixture.committedSnapshots.get(body.idempotencyKey) || fixture.snapshot }
        : {},
      error: existing.commitStatus === 'committed' ? null : typedError(body, 'conflict', 'conflict'),
    }))
    const prepared = fixture.prepared.get(body.payload?.prepareId)
    if (!prepared || body.expectedRevision !== (fixture.snapshot?.revision || 0)) {
      return sendJson(response, 409, ownerResponse(body, { outcome: 'conflict', commitStatus: 'conflict', revision: fixture.snapshot?.revision || 0, error: typedError(body, 'conflict', 'conflict') }))
    }
    const receipt = makeReceipt(body, 'commit', body.expectedRevision, prepared.candidate?.revision)
    if (fixture.commandMode === 'unknown-no-evidence') {
      fixture.commandMode = null
      return send(response, 200, 'application/json', '{')
    }
    fixture.snapshot = makeSnapshot(prepared.candidate, 'commit', body.expectedRevision, receipt)
    fixture.receipts.set(body.idempotencyKey, receipt)
    fixture.committedSnapshots.set(body.idempotencyKey, fixture.snapshot)
    if (fixture.commandMode === 'commit-unknown') {
      fixture.commandMode = null
      return send(response, 200, 'application/json', '{')
    }
    return sendJson(response, 200, ownerResponse(body, {
      outcome: 'committed',
      commitStatus: 'committed',
      revision: fixture.snapshot.revision,
      receipt,
      payload: { snapshot: fixture.snapshot },
    }))
  }

  if (body.kind === 'receipt-query' && body.domain === 'reader-session') {
    const receipt = fixture.receipts.get(body.idempotencyKey)
    if (!receipt) {
      return sendJson(response, 200, ownerResponse(body, {
        outcome: 'read',
        commitStatus: 'not-applicable',
        revision: fixture.snapshot?.revision || 0,
        payload: { found: false },
        error: typedError(body, 'not-found', 'not-found'),
      }))
    }
    return sendJson(response, 200, ownerResponse(body, {
      outcome: receipt.commitStatus === 'committed' ? 'committed' : receipt.commitStatus,
      commitStatus: receipt.commitStatus,
      revision: receipt.revision,
      receipt,
      payload: receipt.commitStatus === 'committed'
        ? { snapshot: fixture.committedSnapshots.get(body.idempotencyKey) || fixture.snapshot }
        : {},
      error: receipt.commitStatus === 'committed' ? null : typedError(body, receipt.commitStatus, receipt.commitStatus === 'conflict' ? 'conflict' : 'readiness'),
    }))
  }

  return sendJson(response, 400, ownerResponse(body, { outcome: 'rejected', commitStatus: 'rejected', error: typedError(body, 'invalid-request', 'validation') }))
}

async function handleMediaRequest(request, response, match) {
  const rawRange = String(request.headers.range || '')
  const jobId = decodeURIComponent(match[1])
  const base = makeMediaDescriptor(jobId)
  const etag = fixture.rangeMismatch ? '"changed-etag"' : base.etag
  const identity = fixture.rangeMismatch ? `${base.mediaId}-changed` : base.mediaId
  const body = Buffer.from([0])
  fixture.mediaRequests.push({ range: rawRange, status: 206, responseBytes: body.length, etag, identity })
  if (rawRange !== 'bytes=0-0') return send(response, 416, 'text/plain', 'range rejected', { 'content-range': 'bytes */4' })
  return send(response, 206, 'audio/wav', body, {
    'accept-ranges': 'bytes',
    'content-range': 'bytes 0-0/4',
    'content-type': 'audio/wav',
    etag,
    'x-read-web-media-identity': identity,
    'content-length': String(body.length),
  })
}

function makeReadyHealth() {
  const ready = fixture.hostReady
  return {
    profileId: PROFILE_ID,
    instanceId: INSTANCE_ID,
    liveness: { ready: true },
    durableOwnerReadiness: {
      ready,
      acceptingApiAuthoritativeOperations: ready,
    },
    ownerRegistry: {
      ownerApiReady: ready,
      acceptingApiAuthoritativeOperations: ready,
    },
    domains: [{
      domain: 'reader-session',
      authority: ready ? 'authoritative' : 'pre-cutover',
      commandCapability: ready ? 'writable' : 'unavailable',
    }],
  }
}

function makeCandidate(jobId, revision) {
  const media = makeMediaDescriptor(jobId)
  const strippedMedia = stripMedia(media)
  return {
    schemaVersion: 'reader-session-owner.v1',
    domain: 'reader-session',
    profileId: PROFILE_ID,
    contentId: `youtube-workflow:${jobId}`,
    revision,
    audioMeta: {
      name: `${jobId}.audio`,
      size: media.size,
      type: media.contentType,
      source: 'c1-fixture',
      jobId,
      streamUrl: media.authorizedUrl,
      media: strippedMedia,
    },
    transcript: { segments: [{ words: [{ word: jobId, start: 0, end: 1 }] }] },
    chunkData: { s: [{ chunks: [{ a: 0, b: 1, en: jobId }] }] },
    marks: [],
    media: strippedMedia,
  }
}

function makeMediaDescriptor(jobId) {
  return {
    schemaVersion: 1,
    profileId: PROFILE_ID,
    mediaId: `${jobId}-audio`,
    kind: 'audio',
    authorizedUrl: `/api/jobs/${jobId}/media/audio`,
    size: 4,
    contentType: 'audio/wav',
    etag: `"${jobId}-etag"`,
    revision: `${jobId}-media-rev`,
  }
}

function stripMedia(media) {
  return {
    mediaId: media.mediaId,
    kind: media.kind,
    size: media.size,
    contentType: media.contentType,
    etag: media.etag,
    revision: media.revision,
    authorizedUrl: media.authorizedUrl,
  }
}

function descriptorFromSnapshot(snapshot) {
  return { schemaVersion: 1, profileId: PROFILE_ID, ...snapshot.media }
}

function makeSnapshot(candidate, operation, expectedRevision, receipt = null) {
  const snapshot = {
    ...candidate,
    checksum: FINGERPRINT,
    commit: {
      operation,
      requestFingerprint: FINGERPRINT,
      expectedRevision,
      committedAt: '2026-08-29T00:00:00.000Z',
      effectFingerprint: FINGERPRINT,
    },
  }
  if (receipt) snapshot.commit.requestFingerprint = receipt.requestFingerprint
  return snapshot
}

function makeReceipt(request, operation, expectedRevision, revision) {
  return {
    receiptId: `receipt-c1-${request.idempotencyKey}`,
    contractVersion: CONTRACT_VERSION,
    profileId: PROFILE_ID,
    instanceId: INSTANCE_ID,
    requestId: request.requestId,
    correlationId: request.correlationId,
    domain: 'reader-session',
    operation,
    idempotencyKey: request.idempotencyKey,
    expectedRevision,
    requestFingerprint: FINGERPRINT,
    commitStatus: 'committed',
    revision,
    effectFingerprint: FINGERPRINT,
    recordChecksums: [FINGERPRINT],
    evidenceChecksum: FINGERPRINT,
    evidenceSource: 'reader-session-c1-fixture',
    createdAt: '2026-08-29T00:00:00.000Z',
    committedAt: '2026-08-29T00:00:00.000Z',
    queryOperation: 'receipt-query',
  }
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

function typedError(request, code, category) {
  return {
    type: 'windows-thin-reader-error.v1',
    code,
    category,
    message: 'isolated C1 fixture rejected the request',
    retryable: category === 'readiness' || category === 'conflict',
    correlationId: request.correlationId,
    details: {},
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
