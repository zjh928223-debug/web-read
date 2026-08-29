import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/services/media/media-resource-owner.js', import.meta.url), 'utf8')
const contract = JSON.parse(await readFile(new URL('../docs/architecture/windows-local-owner-thin-reader/api-contract.json', import.meta.url), 'utf8'))
const media = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const {
  MediaResourceOwnerError,
  WINDOWS_OWNER_MEDIA_QUERY_OPERATIONS,
  assertWindowsOwnerMediaMetadataOnly,
  createWindowsOwnerMediaResourceOwner,
  getWindowsOwnerMediaQueryOperation,
  probeWindowsOwnerMediaRange,
  validateWindowsOwnerMediaDescriptor,
  validateWindowsOwnerMediaQueryResult,
} = media

const descriptor = createDescriptor()

assert.deepEqual(WINDOWS_OWNER_MEDIA_QUERY_OPERATIONS, {
  'reader-session': { operation: 'media-identity', capability: 'reader-session.query' },
  workflow: { operation: 'media-capability', capability: 'workflow.media-range' },
})
assert.deepEqual(
  contract.mediaResourceOwnerContract.queryMappings,
  WINDOWS_OWNER_MEDIA_QUERY_OPERATIONS,
  'media owner must use the frozen API media-query mapping',
)
assert.equal(getWindowsOwnerMediaQueryOperation('annotation'), null)
assert.deepEqual(getWindowsOwnerMediaQueryOperation('workflow'), {
  domain: 'workflow',
  operation: 'media-capability',
  capability: 'workflow.media-range',
})

const normalized = validateWindowsOwnerMediaDescriptor(descriptor, { profileId: 'optimization' })
assert(Object.isFrozen(normalized))
assert.deepEqual(normalized, descriptor)
assert.throws(
  () => validateWindowsOwnerMediaQueryResult({
    domain: 'workflow',
    operation: 'media-capability',
    outcome: 'not-ready',
    commitStatus: 'not-ready',
    payload: {},
  }, { domain: 'workflow', profileId: 'optimization' }),
  (error) => error instanceof MediaResourceOwnerError && error.code === 'media-not-ready',
)
assert.throws(
  () => validateWindowsOwnerMediaQueryResult({
    domain: 'annotation',
    operation: 'bundle',
    outcome: 'read',
    commitStatus: 'not-applicable',
    payload: { media: descriptor },
  }, { domain: 'workflow', profileId: 'optimization' }),
  (error) => error instanceof MediaResourceOwnerError && error.code === 'media-capability-invalid',
)
for (const [typedError, expectedCode] of [
  [{ code: 'not-found', category: 'not-found', details: { path: 'C:\\secret\\media' } }, 'media-not-found'],
  [{ code: 'unauthorized', category: 'authorization', details: { token: 'secret-token' } }, 'media-unauthorized'],
  [{ code: 'forbidden', category: 'authorization', details: { reason: 'permission denied' } }, 'media-unauthorized'],
  [{ code: 'path-not-allowed', category: 'authorization', details: { path: 'C:\\secret\\media' } }, 'media-unauthorized'],
]) {
  assert.throws(
    () => validateWindowsOwnerMediaQueryResult({
      domain: 'workflow',
      operation: 'media-capability',
      outcome: 'rejected',
      commitStatus: 'rejected',
      payload: {},
      error: typedError,
    }, { domain: 'workflow', profileId: 'optimization' }),
    (error) => error instanceof MediaResourceOwnerError
      && error.code === expectedCode
      && !JSON.stringify(error).includes('secret'),
  )
}
for (const outcome of ['not-ready', 'manual-recovery', 'commit-unknown']) {
  assert.throws(
    () => validateWindowsOwnerMediaQueryResult({
      domain: 'workflow',
      operation: 'media-capability',
      outcome,
      commitStatus: outcome,
      payload: {},
      error: { code: outcome, category: 'readiness', details: { secret: 'hidden' } },
    }, { domain: 'workflow', profileId: 'optimization' }),
    (error) => error instanceof MediaResourceOwnerError
      && error.code === 'media-not-ready'
      && !JSON.stringify(error).includes('hidden'),
  )
}
assert.throws(
  () => validateWindowsOwnerMediaQueryResult({
    domain: 'workflow',
    operation: 'media-capability',
    outcome: 'rejected',
    commitStatus: 'rejected',
    payload: {},
    error: { code: 'unexpected', category: 'validation', details: {} },
  }, { domain: 'workflow', profileId: 'optimization' }),
  (error) => error instanceof MediaResourceOwnerError && error.code === 'media-capability-invalid',
)

for (const unauthorizedUrl of [
  'https://example.test/api/jobs/job-1/media/audio',
  'http://127.0.0.1/api/jobs/job-1/media/audio',
  '//example.test/api/jobs/job-1/media/audio',
  'data:audio/mpeg;base64,AAAA',
  'blob:https://example.test/media',
  '/api/jobs/job-1/media/audio?access_token=secret-token',
  '/api/jobs/../private/audio',
  '/api/jobs/job%2Fother/media/audio',
]) {
  assert.throws(
    () => validateWindowsOwnerMediaDescriptor({ ...descriptor, authorizedUrl: unauthorizedUrl }),
    (error) => error instanceof MediaResourceOwnerError && error.code === 'media-unauthorized-url',
    `unauthorized media URL was accepted: ${unauthorizedUrl}`,
  )
}
assert.throws(
  () => validateWindowsOwnerMediaDescriptor({ ...descriptor, authorizedUrl: '/api/jobs/job-1/media/audio?token=secret-token' }),
  (error) => {
    assert.equal(error.code, 'media-unauthorized-url')
    assert.equal(JSON.stringify(error).includes('secret-token'), false)
    return true
  },
)
for (const invalidDescriptor of [
  { ...descriptor, size: -1 },
  { ...descriptor, etag: '' },
  { ...descriptor, revision: '' },
  { ...descriptor, unknown: 'field' },
]) {
  assert.throws(
    () => validateWindowsOwnerMediaDescriptor(invalidDescriptor),
    (error) => error instanceof MediaResourceOwnerError && error.code === 'media-descriptor-invalid',
  )
}

for (const unsafePayload of [
  { mediaData: new Uint8Array([1, 2, 3]) },
  { mediaBytes: new ArrayBuffer(4) },
  { nested: { typedArray: [1, 2, 3] } },
  { nested: { mediaData: 'data:audio/mpeg;base64,AAAA' } },
  { nested: { videoData: 'A'.repeat(160) } },
]) {
  assert.throws(
    () => assertWindowsOwnerMediaMetadataOnly(unsafePayload, 'request.payload'),
    (error) => error instanceof MediaResourceOwnerError && error.code === 'media-payload-rejected',
  )
}
if (typeof Blob !== 'undefined') {
  assert.throws(
    () => assertWindowsOwnerMediaMetadataOnly({ nested: { blob: new Blob(['media']) } }, 'request.payload'),
    (error) => error instanceof MediaResourceOwnerError && error.code === 'media-payload-rejected',
  )
}
assert.doesNotThrow(() => assertWindowsOwnerMediaMetadataOnly({
  mediaId: 'media-1',
  contentId: 'content-1',
  title: 'ordinary text',
  nested: { size: 12, revision: 'rev-a' },
}))

const rangeCalls = []
let bodyMethodCalls = 0
const range = await probeWindowsOwnerMediaRange(descriptor, {
  fetchImpl: async (url, options) => {
    rangeCalls.push({ url, options })
    return rangeResponse(descriptor, {
      blob() { bodyMethodCalls += 1; throw new Error('body must not be read') },
      arrayBuffer() { bodyMethodCalls += 1; throw new Error('body must not be read') },
      text() { bodyMethodCalls += 1; throw new Error('body must not be read') },
    })
  },
})
assert.deepEqual(range, {
  status: 206,
  contentRange: 'bytes 0-0/12',
  acceptRanges: 'bytes',
  etag: '"etag-a"',
  mediaId: 'media-1',
})
assert.equal(bodyMethodCalls, 0)
assert.equal(rangeCalls.length, 1)
assert.equal(rangeCalls[0].url, descriptor.authorizedUrl)
assert.deepEqual(rangeCalls[0].options.headers, {
  Range: 'bytes=0-0',
})
assert.equal(rangeCalls[0].options.credentials, 'same-origin')
assert.equal(rangeCalls[0].options.cache, 'no-store')
assert.equal(String(rangeCalls[0].url).includes('token'), false)

for (const response of [
  rangeResponse(descriptor, { headers: rangeHeaders(descriptor, { etag: '"changed"' }) }),
  rangeResponse(descriptor, { headers: rangeHeaders(descriptor, { mediaId: 'other-media' }) }),
]) {
  await assert.rejects(
    probeWindowsOwnerMediaRange(descriptor, { fetchImpl: async () => response }),
    (error) => error instanceof MediaResourceOwnerError && error.code === 'media-rebind-required',
  )
}
let canceledFullResponse = false
let fullResponseBodyRead = false
await assert.rejects(
  probeWindowsOwnerMediaRange(descriptor, {
    fetchImpl: async () => ({
      status: 200,
      body: {
        async cancel() { canceledFullResponse = true },
        blob() { fullResponseBodyRead = true; throw new Error('full response must not be read') },
        arrayBuffer() { fullResponseBodyRead = true; throw new Error('full response must not be read') },
        text() { fullResponseBodyRead = true; throw new Error('full response must not be read') },
      },
      headers: rangeHeaders(descriptor),
    }),
  }),
  (error) => error instanceof MediaResourceOwnerError && error.code === 'media-rebind-required',
)
assert.equal(canceledFullResponse, true)
assert.equal(fullResponseBodyRead, false)
await assert.rejects(
  probeWindowsOwnerMediaRange(descriptor, {
    fetchImpl: async () => ({ status: 404, headers: new Map() }),
  }),
  (error) => error instanceof MediaResourceOwnerError && error.code === 'media-not-found',
)

const events = []
const element = createMediaElement(events)
let responseDescriptor = descriptor
const owner = createWindowsOwnerMediaResourceOwner({
  profileId: 'optimization',
  mediaElement: element,
  fetchImpl: async () => rangeResponse(responseDescriptor),
  ownerClient: {
    async query(request) {
      assert.deepEqual(request, {
        domain: 'workflow',
        operation: 'media-capability',
        payload: { jobId: 'job-1', kind: 'audio' },
      })
      return {
        domain: 'workflow',
        operation: 'media-capability',
        outcome: 'read',
        commitStatus: 'not-applicable',
        payload: { media: descriptor },
      }
    },
  },
})
const bound = await owner.bind({
  domain: 'workflow',
  payload: { jobId: 'job-1', kind: 'audio' },
})
assert.equal(bound.descriptor.authorizedUrl, descriptor.authorizedUrl)
assert.equal(element.src, descriptor.authorizedUrl)
assert.equal(owner.getDescriptor().etag, descriptor.etag)

const replacement = { ...descriptor, mediaId: 'media-2', etag: '"etag-b"', revision: 'rev-b' }
responseDescriptor = replacement
await owner.bindDescriptor(replacement)
assert.equal(element.src, replacement.authorizedUrl)
assert.equal(owner.getDescriptor().mediaId, 'media-2')
assert.ok(events.includes('pause'))
assert.ok(events.includes('remove:src'))
assert.ok(events.includes('load'))

responseDescriptor = replacement
const changed = { ...replacement, etag: '"etag-c"', revision: 'rev-c' }
await assert.rejects(
  owner.bindDescriptor(changed),
  (error) => error instanceof MediaResourceOwnerError && error.code === 'media-rebind-required',
)
assert.equal(owner.getDescriptor(), null)
assert.equal(element.src, null)
owner.dispose()
owner.dispose()

const invalidQueryOwner = createWindowsOwnerMediaResourceOwner({
  profileId: 'optimization',
  mediaElement: createMediaElement([]),
  fetchImpl: async () => rangeResponse(descriptor),
  ownerClient: { query: async () => ({
    domain: 'workflow',
    operation: 'media-capability',
    outcome: 'read',
    commitStatus: 'not-applicable',
    payload: { media: { ...descriptor, authorizedUrl: 'data:audio/mpeg;base64,secret' } },
  }) },
})
await assert.rejects(
  invalidQueryOwner.bind({ domain: 'workflow', payload: {} }),
  (error) => error instanceof MediaResourceOwnerError && error.code === 'media-unauthorized-url'
    && !JSON.stringify(error).includes('secret'),
)

console.log('Windows owner media capability checks passed.')

function createDescriptor(overrides = {}) {
  return {
    schemaVersion: 1,
    profileId: 'optimization',
    mediaId: 'media-1',
    kind: 'audio',
    authorizedUrl: '/api/jobs/job-1/media/audio',
    size: 12,
    contentType: 'audio/mpeg',
    etag: '"etag-a"',
    revision: 'rev-a',
    ...overrides,
  }
}

function rangeResponse(value, overrides = {}) {
  return {
    status: 206,
    headers: rangeHeaders(value),
    ...overrides,
  }
}

function rangeHeaders(value, overrides = {}) {
  return new Map([
    ['content-range', `bytes 0-0/${value.size}`],
    ['accept-ranges', 'bytes'],
    ['etag', overrides.etag || value.etag],
    ['x-read-web-media-identity', overrides.mediaId || value.mediaId],
  ])
}

function createMediaElement(events) {
  let currentSrc = null
  return {
    get src() { return currentSrc },
    set src(value) {
      currentSrc = value
      events.push(`set:${value}`)
    },
    pause() { events.push('pause') },
    removeAttribute(name) {
      events.push(`remove:${name}`)
      if (name === 'src') currentSrc = null
    },
    load() { events.push('load') },
  }
}
