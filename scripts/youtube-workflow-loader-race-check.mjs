import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const loaderUrl = new URL('../src/composables/youtube-workflow-loader.js', import.meta.url)
const runtimeStateStub = 'export const runtimeState = {}'
const runtimeStateUrl = `data:text/javascript;base64,${Buffer.from(runtimeStateStub).toString('base64')}`
const loaderSource = (await fs.readFile(loaderUrl, 'utf8'))
  .replace("'./runtime-state-facade.js'", `'${runtimeStateUrl}'`)
const { createYoutubeWorkflowLoader } = await import(
  `data:text/javascript;base64,${Buffer.from(loaderSource).toString('base64')}`
)

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function transcript(label) {
  return { segments: [{ start: 0, end: 1, words: [{ word: label, start: 0, end: 1 }] }] }
}

function chunks(label) {
  return { s: [{ chunks: [{ a: 0, b: 1, en: label }] }] }
}

const aManifest = deferred()
const sessionSignals = new Map()
const visible = { transcript: 'old-session', chunk: 'old-session', audio: 'old-session' }
const commits = []
const client = {
  getSession(jobId, options = {}) {
    sessionSignals.set(jobId, options.signal)
    if (jobId === 'job-a') return aManifest.promise
    return Promise.resolve({ jobId, title: jobId, files: {} })
  },
  getFile(jobId, kind, options = {}) {
    assert.equal(options.signal, sessionSignals.get(jobId), 'all prepare requests must share the generation AbortSignal')
    const payload = kind === 'transcript' ? transcript(jobId) : chunks(jobId)
    return Promise.resolve(new Blob([JSON.stringify(payload)], { type: 'application/json' }))
  },
  getReaderMarks(jobId, options = {}) {
    assert.equal(options.signal, sessionSignals.get(jobId), 'marks prepare must share the generation AbortSignal')
    return Promise.resolve({ marks: [{ globalIndex: 0, word: jobId }] })
  },
  mediaUrl(jobId, kind) { return `http://workflow.test/${jobId}/${kind}` },
  probeMediaRange(_jobId, _kind, options = {}) {
    assert.ok(options.signal, 'Range probe must share the generation AbortSignal')
    return Promise.resolve({ status: 206, contentRange: 'bytes 0-0/16', acceptRanges: 'bytes' })
  },
}

const loader = createYoutubeWorkflowLoader({
  client,
  hasCurrentContent: () => false,
  readerSessionPersistence: {
    async commit(session) { commits.push(session) },
  },
  applyCurrentAudioMeta(meta) { visible.audio = meta.jobId },
  processTranscript(value) { visible.transcript = value.segments[0].words[0].word },
  processChunkData(value) { visible.chunk = value.s[0].chunks[0].en },
  validateTranscriptData: (value) => value,
  validateChunkData: (value) => value,
  sessionPublisher: {
    async captureVisibleSession() { return { ...visible } },
    async publishPreparedSession(prepared) {
      visible.audio = prepared.audioMeta.jobId
      visible.transcript = prepared.transcript.segments[0].words[0].word
      visible.chunk = prepared.chunkData.s[0].chunks[0].en
    },
    async restoreVisibleSession(snapshot) { Object.assign(visible, snapshot) },
  },
  audioPlayer: {},
})

assert.deepEqual(loader.getLoadState(), {
  status: 'idle', generation: 0, jobId: '', error: null,
})

const loadA = loader.loadJobIntoReader('job-a', { replacePolicy: 'replace-current' })
await Promise.resolve()
assert.equal(loader.getLoadState().status, 'loading')
assert.equal(loader.getLoadState().generation, 1)

const loadB = loader.loadJobIntoReader('job-b', { replacePolicy: 'replace-current' })
assert.equal(sessionSignals.get('job-a').aborted, true, 'starting B must abort A')
assert.equal((await loadB).status, 'loaded')
assert.deepEqual(visible, { transcript: 'job-b', chunk: 'job-b', audio: 'job-b' })

aManifest.resolve({ jobId: 'job-a', title: 'job-a', files: {} })
const resultA = await loadA
assert.equal(resultA.status, 'superseded')
assert.equal(resultA.generation, 1)
assert.deepEqual(visible, { transcript: 'job-b', chunk: 'job-b', audio: 'job-b' }, 'late A must not overwrite B')
assert.ok(commits.every((value) => !JSON.stringify(value).includes('job-a')), 'superseded A must not persist')
assert.equal(commits.length, 1)
assert.equal(commits[0].contentId, 'youtube-workflow:job-b')
assert.deepEqual(loader.getLoadState(), {
  status: 'loaded', generation: 2, jobId: 'job-b', error: null,
})

const beforeFailure = { ...visible }
client.getFile = async (_jobId, kind) => new Blob([
  kind === 'transcript' ? '{bad-json' : JSON.stringify(chunks('job-c')),
], { type: 'application/json' })
await assert.rejects(
  () => loader.loadJobIntoReader('job-c', { replacePolicy: 'replace-current' }),
  /transcript JSON parse failed/,
)
assert.deepEqual(visible, beforeFailure, 'prepare failure must preserve the visible reader session')
assert.equal(loader.getLoadState().status, 'error')
assert.equal(loader.getLoadState().jobId, 'job-c')
assert.equal(loader.getLoadState().generation, 3)
assert.equal(loader.getLoadState().error.code, 'READER_SESSION_LOAD_FAILED')

{
  let ownerRevision = 0
  let ownerCommitAttempts = 0
  const ownerExpectedRevisions = []
  const ownerVisible = { contentId: 'old-owner-session' }
  const owner = {
    async resolveWorkflowMediaDescriptor() {
      return {
        mediaId: 'owner-media',
        kind: 'audio',
        size: 10,
        contentType: 'audio/mpeg',
        etag: 'owner-etag',
        revision: 'owner-revision',
        authorizedUrl: 'owner://audio',
      }
    },
    async bindMediaDescriptor() {},
    async currentRevision() { return ownerRevision },
    async commitSession(_session, options) {
      ownerExpectedRevisions.push(options.expectedRevision)
      ownerCommitAttempts += 1
      if (ownerCommitAttempts < 3) {
        ownerRevision += 1
        return { status: 'conflict', error: { code: 'reader-session-conflict' } }
      }
      return { status: 'committed' }
    },
    getDescriptor() { return null },
  }
  const ownerLoader = createYoutubeWorkflowLoader({
    client: {
      async getSession(jobId) { return { jobId, title: 'Owner retry', files: {} } },
      async getFile(_jobId, kind) {
        const payload = kind === 'transcript' ? transcript('owner-retry') : chunks('owner-retry')
        return new Blob([JSON.stringify(payload)])
      },
      async getReaderMarks() { return { marks: [] } },
    },
    readerSessionOwner: owner,
    hasCurrentContent: () => false,
    sessionPublisher: {
      async captureVisibleSession() { return { ...ownerVisible } },
      async publishPreparedSession(prepared) { ownerVisible.contentId = prepared.contentId },
      async restoreVisibleSession(snapshot) { Object.assign(ownerVisible, snapshot) },
    },
    validateTranscriptData: (value) => value,
    validateChunkData: (value) => value,
  })
  const ownerResult = await ownerLoader.loadJobIntoReader('owner-retry', { replacePolicy: 'replace-current' })
  assert.equal(ownerResult.status, 'loaded', 'owner conflict retries should eventually commit the loaded session')
  assert.equal(ownerCommitAttempts, 3, 'owner commit retries should remain bounded')
  assert.deepEqual(ownerExpectedRevisions, [0, 1, 2], 'each owner retry should refresh the authoritative revision')
}

console.log('youtube workflow loader race check passed')
