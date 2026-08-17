import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

async function importSource(pathname) {
  const source = (await fs.readFile(new URL(pathname, import.meta.url), 'utf8')).replace(
    "import { runtimeState } from './runtime-state-facade.js'",
    'const runtimeState = {}'
  )
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`)
}

const [{ createReaderSessionPublisher }, { createYoutubeWorkflowLoader }] = await Promise.all([
  importSource('../src/composables/reader-session-publisher.js'),
  importSource('../src/composables/youtube-workflow-loader.js'),
])

function oldState() {
  return {
    segments: [{ words: [{ word: 'old', start: 0, end: 1 }] }],
    words: [{ word: 'old', start: 0, end: 1 }],
    wordStarts: [0],
    currentWordIndex: 0,
    chunkItems: [{ rawEn: 'old' }],
    hasAiChunkData: true,
    isChunkMode: true,
    chunkCnVisible: true,
    chunkCnHoldMode: false,
    isChunkShadowOn: false,
    chunkCnMode: 'global',
    manualChunkStates: { 0: true },
    lastActiveChunkIndex: 0,
    lastAiPrevTapChunkIndex: 0,
    lastAiPrevTapAt: 12,
    currentAudioMeta: { name: 'old.audio', jobId: 'old' },
    currentAudioKey: 'old-key',
    markedMap: new Map([[0, { globalIndex: 0, word: 'old' }]]),
  }
}

function snapshotVisible(state, audio, media) {
  return {
    state: JSON.parse(JSON.stringify({ ...state, markedMap: Array.from(state.markedMap.entries()) })),
    audio: { src: audio.src, currentTime: audio.currentTime, playbackRate: audio.playbackRate, volume: audio.volume, muted: audio.muted },
    media: JSON.parse(JSON.stringify(media.value)),
  }
}

function makeHarness(failStage = '') {
  const state = oldState()
  let audioSrc = 'old://audio'
  const audio = {
    getAttribute(name) { return name === 'src' ? audioSrc : null },
    removeAttribute() { audioSrc = '' },
    get src() { return audioSrc },
    set src(value) { audioSrc = value; fail('audio-src') },
    currentTime: 7,
    playbackRate: 1.25,
    volume: 0.6,
    muted: true,
  }
  const media = { value: { jobId: 'old', videoTitle: 'Old', videoSource: 'old-source', videoUrl: 'old://video', videoAvailable: true, videoPreferred: true, activeKind: 'video', window: { x: 1, y: 2, width: 360, aspectRatio: 1.5 } } }
  let armed = failStage
  function fail(stage) {
    if (armed !== stage) return
    armed = ''
    const error = new Error(`fault:${stage}`)
    error.code = `FAULT_${stage}`
    throw error
  }
  const mediaSource = {
    getState() { return { ...media.value, window: { ...media.value.window } } },
    setAudioElement() { fail('media-audio') },
    loadJobMedia(value) {
      media.value = { ...media.value, jobId: value.jobId, videoTitle: value.title, videoSource: value.videoSource, videoUrl: value.videoUrl, videoAvailable: !!value.hasVideo }
      fail('media-load')
    },
    setVideoPreferred(value) { media.value.videoPreferred = !!value },
    setVideoWindow(value) { media.value.window = { ...value } },
  }
  const publisher = createReaderSessionPublisher({
    state,
    audioPlayer: audio,
    mediaSource,
    applyCurrentAudioMeta(meta) { state.currentAudioMeta = meta; state.currentAudioKey = meta.jobId; fail('audio-meta') },
    processTranscript(value) {
      state.segments = value.segments
      state.words = value.segments.flatMap((segment) => segment.words)
      state.wordStarts = state.words.map((word) => word.start)
      fail('transcript')
    },
    processChunkData(value) { state.chunkItems = value.s[0].chunks; state.hasAiChunkData = true; fail('chunk') },
    applyReaderMarks(value) { state.markedMap = new Map(value.map((mark) => [mark.globalIndex, mark])); fail('marks') },
    resetChunkDisplay() { state.chunkCnVisible = false; fail('reset') },
  })
  return { state, audio, media, publisher, fail }
}

function client() {
  return {
    async getSession(jobId) { return { jobId, title: 'New', files: {} } },
    async getFile(_jobId, kind) {
      const value = kind === 'transcript'
        ? { segments: [{ words: [{ word: 'new', start: 0, end: 1 }] }] }
        : { s: [{ chunks: [{ a: 0, b: 1, en: 'new' }] }] }
      return new Blob([JSON.stringify(value)])
    },
    async getReaderMarks() { return { marks: [{ globalIndex: 0, word: 'new' }] } },
    mediaUrl(jobId, kind) { return `new://${jobId}/${kind}` },
    async probeMediaRange() { return { status: 206 } },
  }
}

for (const stage of ['audio-meta', 'audio-src', 'media-audio', 'media-load', 'transcript', 'chunk', 'marks', 'reset']) {
  const harness = makeHarness(stage)
  const before = snapshotVisible(harness.state, harness.audio, harness.media)
  let commits = 0
  const loader = createYoutubeWorkflowLoader({
    client: client(),
    hasCurrentContent: () => false,
    readerSessionPersistence: { async loadCommitted() { return { status: 'committed', session: { revision: 'old-revision' } } }, async commit() { commits += 1 } },
    sessionPublisher: harness.publisher,
    validateTranscriptData: (value) => value,
    validateChunkData: (value) => value,
  })
  await assert.rejects(() => loader.loadJobIntoReader('new', { replacePolicy: 'replace-current' }), new RegExp(`fault:${stage}`))
  assert.deepEqual(snapshotVisible(harness.state, harness.audio, harness.media), before, `${stage} must restore the complete visible session`)
  assert.equal(commits, 0, `${stage} must not commit IndexedDB`)
}

{
  const harness = makeHarness()
  const before = snapshotVisible(harness.state, harness.audio, harness.media)
  const loader = createYoutubeWorkflowLoader({
    client: client(),
    hasCurrentContent: () => false,
    readerSessionPersistence: {
      async loadCommitted() { return { status: 'committed', session: { revision: 'old-revision' } } },
      async commit() { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error },
    },
    sessionPublisher: harness.publisher,
    validateTranscriptData: (value) => value,
    validateChunkData: (value) => value,
  })
  await assert.rejects(() => loader.loadJobIntoReader('new', { replacePolicy: 'replace-current' }), { name: 'QuotaExceededError' })
  assert.deepEqual(snapshotVisible(harness.state, harness.audio, harness.media), before, 'commit failure must restore the complete visible session')
}

for (const commitFailure of [
  Object.assign(new Error('quota'), { name: 'QuotaExceededError' }),
  Object.assign(new Error('stale writer'), { code: 'REVISION_CONFLICT', actualRevision: 'newer-revision' }),
]) {
  const harness = makeHarness()
  const before = snapshotVisible(harness.state, harness.audio, harness.media)
  const loader = createYoutubeWorkflowLoader({
    client: client(),
    hasCurrentContent: () => false,
    readerSessionPersistence: {
      async loadCommitted() { return { status: 'committed', session: { revision: 'old-revision' } } },
      async commit() { throw commitFailure },
    },
    sessionPublisher: harness.publisher,
    validateTranscriptData: (value) => value,
    validateChunkData: (value) => value,
  })
  await assert.rejects(() => loader.loadJobIntoReader('new', { replacePolicy: 'replace-current' }), (error) => error === commitFailure)
  assert.deepEqual(snapshotVisible(harness.state, harness.audio, harness.media), before, `${commitFailure.name || commitFailure.code} must restore visible state and leave DB commit rejected`)
}

console.log('reader session publisher check passed')
