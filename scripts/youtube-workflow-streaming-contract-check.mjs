import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const loaderPath = path.join(repoRoot, 'src', 'composables', 'youtube-workflow-loader.js')
const source = await fs.readFile(loaderPath, 'utf8')
const loaderModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const transcript = {
  segments: [{ start: 0, end: 1, words: [{ word: 'Hello', start: 0, end: 1 }] }],
}
const chunkData = { s: [{ sentence: 'Hello', chunks: [{ start: 0, end: 1 }] }] }
const fileCalls = []
const writes = []

const client = {
  async getSession() {
    return {
      jobId: 'stream-contract',
      title: 'Streaming contract',
      files: { audio: 'private/audio.mp3', video: 'private/video.mp4', transcript: 'private/transcript.json', chunkData: 'private/chunks.json' },
      media: { hasVideo: true, videoSource: 'contract' },
    }
  },
  async getFile(_jobId, kind) {
    fileCalls.push(kind)
    assert.ok(kind === 'transcript' || kind === 'chunkData', `large media must use fileUrl(), not getFile(..., ${kind})`)
    return new Blob([JSON.stringify(kind === 'transcript' ? transcript : chunkData)], { type: 'application/json' })
  },
  fileUrl(jobId, kind) {
    return `http://127.0.0.1:8765/api/jobs/${jobId}/file/${kind}`
  },
}

const loader = loaderModule.createYoutubeWorkflowLoader({
  client,
  hasCurrentContent: () => false,
  audioPlayer: {},
  createObjectURL() {
    assert.fail('streamed workflow media must not allocate an object URL')
  },
  readerSessionPersistence: {
    async commit(session) {
      writes.push(session)
      assert.equal('audio' in session, false, 'streamed workflow media must not be copied into IndexedDB')
    },
  },
  applyCurrentAudioMeta() {},
  processTranscript() {},
  processChunkData() {},
  validateTranscriptData: (value) => value,
  validateChunkData: (value) => value,
  mediaSource: { setAudioElement() {}, loadJobMedia() {} },
})

await loader.loadJobIntoReader('stream-contract', { replacePolicy: 'replace-current' })

assert.deepEqual(fileCalls.slice().sort(), ['chunkData', 'transcript'], 'only small JSON artifacts may be materialized')
assert.ok(writes.every((session) => !('audio' in session)), 'large workflow media must not be persisted as a Blob')
console.log('youtube workflow streaming contract check passed')
