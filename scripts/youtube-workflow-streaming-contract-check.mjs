import assert from 'node:assert/strict'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const moduleRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-streaming-contract-'))
try {
  // Preserve the browser modules and their relative import under an explicit ESM package.
  await writeFile(path.join(moduleRoot, 'package.json'), JSON.stringify({ type: 'module' }))
  for (const filename of ['youtube-workflow-loader.js', 'runtime-state-facade.js']) {
    await copyFile(new URL(`../src/composables/${filename}`, import.meta.url), path.join(moduleRoot, filename))
  }
  const { createYoutubeWorkflowLoader } = await import(pathToFileURL(path.join(moduleRoot, 'youtube-workflow-loader.js')).href)

  const transcript = {
    segments: [{ start: 0, end: 1, words: [{ word: 'Hello', start: 0, end: 1 }] }],
  }
  const chunkData = { s: [{ sentence: 'Hello', chunks: [{ start: 0, end: 1 }] }] }
  const fileCalls = []
  const writes = []
  const publications = []
  const rangeProbes = []

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
      assert.ok(kind === 'transcript' || kind === 'chunkData', `large media must use mediaUrl(), not getFile(..., ${kind})`)
      return new Blob([JSON.stringify(kind === 'transcript' ? transcript : chunkData)], { type: 'application/json' })
    },
    mediaUrl(jobId, kind) {
      return `http://127.0.0.1:8765/api/jobs/${jobId}/media/${kind}`
    },
    async probeMediaRange(jobId, kind) {
      rangeProbes.push({ jobId, kind })
      return { status: 206, contentRange: 'bytes 0-0/16', acceptRanges: 'bytes' }
    },
    async getReaderMarks() {
      return { marks: [] }
    },
    fileUrl(_jobId, kind) {
      assert.fail(`large ${kind} media must not use the generic file endpoint`)
    },
  }

  const loader = createYoutubeWorkflowLoader({
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
        assert.equal('video' in session, false, 'streamed workflow video must not be copied into IndexedDB')
      },
    },
    sessionPublisher: {
      captureVisibleSession() { return null },
      publishPreparedSession(session) { publications.push(session) },
      restoreVisibleSession() { assert.fail('a successful streamed session must not roll back') },
    },
    applyCurrentAudioMeta() {},
    processTranscript() {},
    processChunkData() {},
    validateTranscriptData: (value) => value,
    validateChunkData: (value) => value,
    mediaSource: { setAudioElement() {}, loadJobMedia() {} },
  })

  const result = await loader.loadJobIntoReader('stream-contract', { replacePolicy: 'replace-current' })

  assert.equal(result.status, 'loaded', 'the streaming contract must reach a successful load')
  assert.equal(result.jobId, 'stream-contract')
  assert.equal(publications.length, 1, 'the streaming contract must publish exactly one session')
  assert.equal(writes.length, 1, 'the streaming contract must commit exactly one session')
  assert.deepEqual(rangeProbes, [{ jobId: 'stream-contract', kind: 'audio' }], 'audio must be probed through the Range media contract')
  assert.equal(publications[0].audioUrl, client.mediaUrl('stream-contract', 'audio'))
  assert.equal(publications[0].media.videoUrl, client.mediaUrl('stream-contract', 'video'))
  assert.equal(publications[0].audioMeta.streamUrl, publications[0].audioUrl)
  assert.equal(writes[0].contentId, 'youtube-workflow:stream-contract')
  assert.equal(writes[0].audioMeta.streamUrl, publications[0].audioUrl)
  assert.deepEqual(fileCalls.slice().sort(), ['chunkData', 'transcript'], 'only small JSON artifacts may be materialized')
  assert.ok(writes.every((session) => !('audio' in session)), 'large workflow media must not be persisted as a Blob')
  console.log('youtube workflow streaming contract check passed')
} finally {
  assert.equal(path.dirname(moduleRoot), path.resolve(os.tmpdir()), 'cleanup must stay inside the temporary directory')
  await rm(moduleRoot, { recursive: true, force: true })
}
