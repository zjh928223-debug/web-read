import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const loaderSource = await importSource('../src/composables/youtube-workflow-loader.js')
const clientSource = await importSource('../src/composables/youtube-workflow-client.js')
const { createYoutubeWorkflowLoader } = loaderSource
const { createYoutubeWorkflowClient } = clientSource
const budget = JSON.parse(await readFile(new URL('./fixtures/youtube-workflow-large-media-budget.v1.json', import.meta.url), 'utf8'))

assert.equal(budget.schemaVersion, 1)
assert.deepEqual(budget.sizesMiB, [300, 540])

const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'read-web-large-media-'))
const fixtures = new Map()
const requests = []
const accessToken = 'isolated-large-media-token'

try {
  for (const sizeMb of budget.sizesMiB) {
    const filePath = path.join(fixtureRoot, `${sizeMb}mb-media.bin`)
    const handle = await open(filePath, 'w')
    await handle.truncate(sizeMb * 1024 * 1024)
    await handle.close()
    assert.equal((await stat(filePath)).size, sizeMb * 1024 * 1024)
    fixtures.set(`fixture-${sizeMb}`, { filePath, sizeMb })
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const match = url.pathname.match(/^\/api\/jobs\/(fixture-(?:300|540))\/media\/audio$/)
    if (!match || url.searchParams.get('access_token') !== accessToken) {
      response.writeHead(401).end()
      return
    }
    const fixture = fixtures.get(match[1])
    const range = String(request.headers.range || '')
    const rangeMatch = range.match(/^bytes=(\d+)-(\d+)$/)
    if (!rangeMatch) {
      requests.push({ jobId: match[1], range, status: 416, bytes: 0 })
      response.writeHead(416, { 'Accept-Ranges': 'bytes' }).end()
      return
    }
    const size = fixture.sizeMb * 1024 * 1024
    const start = Number(rangeMatch[1])
    const end = Math.min(Number(rangeMatch[2]), size - 1)
    const bytes = end - start + 1
    requests.push({ jobId: match[1], range, status: 206, bytes })
    response.writeHead(206, {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(bytes),
      ETag: `"fixture-${fixture.sizeMb}-v1"`,
      'Content-Type': 'application/octet-stream',
    })
    createReadStream(fixture.filePath, { start, end }).pipe(response)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  try {
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`
    const urlClient = createYoutubeWorkflowClient({
      baseUrl,
      accessToken,
      fetchImpl() { throw new Error('mediaUrl construction must not fetch the media') },
    })

    for (const fixture of fixtures.values()) {
      const jobId = `fixture-${fixture.sizeMb}`
      const materializedKinds = []
      const commits = []
      let firstRangeResponse = null
      let assignedUrl = ''
      const audioPlayer = {
        set src(value) {
          assignedUrl = value
          firstRangeResponse = fetch(value, { headers: { Range: `bytes=0-${budget.rangeRequestBytes - 1}` } })
        },
        get src() { return assignedUrl },
      }
      const client = {
        async getSession() {
          return {
            jobId,
            title: `Sparse ${fixture.sizeMb}MB`,
            files: { audio: fixture.filePath, transcript: 'transcript.json', chunkData: 'chunks.json' },
            media: { hasVideo: false, audioBytes: fixture.sizeMb * 1024 * 1024 },
          }
        },
        async getFile(_jobId, kind) {
          materializedKinds.push(kind)
          assert.ok(kind === 'transcript' || kind === 'chunkData')
          const payload = kind === 'transcript'
            ? { segments: [{ words: [{ word: 'fixture', start: 0, end: 1 }] }] }
            : { s: [{ chunks: [{ a: 0, b: 1, en: 'fixture' }] }] }
          return new Blob([JSON.stringify(payload)], { type: 'application/json' })
        },
        mediaUrl: urlClient.mediaUrl,
        fileUrl(_jobId, kind) {
          assert.fail(`large ${kind} media must use the authorized Range mediaUrl`)
        },
      }
      const loader = createYoutubeWorkflowLoader({
        client,
        hasCurrentContent: () => false,
        audioPlayer,
        readerSessionPersistence: {
          async commit(session) {
            commits.push(session)
            assertNoBlob(session)
            assert.equal('audio' in session, false)
            assert.equal('video' in session, false)
            assert.ok(JSON.stringify(session).length < budget.maxIdbPayloadBytes)
          },
        },
        applyCurrentAudioMeta() {},
        processTranscript() {},
        processChunkData() {},
        validateTranscriptData: (value) => value,
        validateChunkData: (value) => value,
      })

      const startedAt = performance.now()
      const result = await loader.loadJobIntoReader(jobId, { replacePolicy: 'replace-current' })
      const rangeResponse = await firstRangeResponse
      await rangeResponse.arrayBuffer()
      const firstPlayableMs = performance.now() - startedAt

      assert.equal(result.status, 'loaded')
      assert.deepEqual(materializedKinds.slice().sort(), ['chunkData', 'transcript'])
      assert.equal(commits.length, 1)
      assert.equal(new URL(assignedUrl).pathname, `/api/jobs/${jobId}/media/audio`)
      assert.equal(new URL(assignedUrl).searchParams.get('access_token'), accessToken)
      assert.equal(rangeResponse.status, 206)
      assert.equal(rangeResponse.headers.get('accept-ranges'), 'bytes')
      assert.match(rangeResponse.headers.get('content-range'), new RegExp(`/${fixture.sizeMb * 1024 * 1024}$`))
      assert.ok(firstPlayableMs < budget.maxFirstPlayableMs, `${fixture.sizeMb}MB first Range response must stay below ${budget.maxFirstPlayableMs}ms, got ${firstPlayableMs.toFixed(1)}ms`)
    }

    assert.equal(requests.length, budget.sizesMiB.length * budget.maxNetworkRequestsPerFixture)
    assert.ok(requests.every((request) => request.status === 206 && request.bytes === budget.rangeRequestBytes))
    assert.equal(requests.reduce((total, request) => total + request.bytes, 0), budget.rangeRequestBytes * budget.sizesMiB.length)
    console.log('youtube workflow 300-540MB streaming budget check passed')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
} finally {
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function importSource(relativePath) {
  const source = await (await import('node:fs/promises')).readFile(new URL(relativePath, import.meta.url), 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

function assertNoBlob(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  assert.equal(value instanceof Blob, false, 'IndexedDB session commit must not contain a media Blob')
  seen.add(value)
  for (const nested of Object.values(value)) assertNoBlob(nested, seen)
}
