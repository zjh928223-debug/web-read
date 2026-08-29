function defaultRevokeObjectURL(url) {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url)
  }
}

function isBlobUrl(url) {
  return typeof url === 'string' && url.startsWith('blob:')
}

const MEDIA_DESCRIPTOR_KEYS = new Set([
  'schemaVersion',
  'profileId',
  'mediaId',
  'kind',
  'authorizedUrl',
  'size',
  'contentType',
  'etag',
  'revision',
])
const MEDIA_QUERY_OPERATIONS = Object.freeze({
  'reader-session': Object.freeze({
    operation: 'media-identity',
    capability: 'reader-session.query',
  }),
  workflow: Object.freeze({
    operation: 'media-capability',
    capability: 'workflow.media-range',
  }),
})
const SAFE_MEDIA_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAFE_MEDIA_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u
const MEDIA_ROUTE = /^\/api\/jobs\/([^/]+)\/media\/(audio|video)$/u
const MEDIA_BINARY_KEY = /^(?:blob|arraybuffer|typedarray|bytes|base64|datauri|media(?:bytes|data|blob)|(?:audio|video)(?:bytes|data|blob))$/iu
const MEDIA_DATA_URI = /^data:(?:audio|video|application\/octet-stream)(?:;[^,]*)?;base64,/iu
const MEDIA_BASE64 = /^[A-Za-z0-9+/]{128,}={0,2}$/u
const MEDIA_BASE64_PREFIX = /^(?:UklGR|SUQz|T2dn|GkXfo|AAAAIGZ0eX)/u
const MEDIA_QUERY_NOT_READY_VALUES = new Set(['not-ready', 'manual-recovery', 'commit-unknown'])
const MEDIA_QUERY_NOT_FOUND_VALUES = new Set(['not-found'])
const MEDIA_QUERY_UNAUTHORIZED_VALUES = new Set(['unauthorized', 'forbidden', 'path-not-allowed'])
const MEDIA_ERROR_MESSAGE = Object.freeze({
  'media-descriptor-invalid': 'media capability descriptor is invalid',
  'media-unauthorized-url': 'media capability URL is not an authorized relative URL',
  'media-payload-rejected': 'media payload must contain metadata only',
  'media-capability-invalid': 'media capability response is invalid',
  'media-not-ready': 'media capability is not ready',
  'media-range-unsupported': 'media range response is unsupported',
  'media-not-found': 'media resource was not found',
  'media-unauthorized': 'media resource authorization failed',
  'media-rebind-required': 'media identity or ETag changed',
  'media-upstream': 'media range request failed',
  'media-aborted': 'media range request was aborted',
  'media-binding-stale': 'media binding was superseded',
  'media-bind-failed': 'media resource could not be attached',
})

export const WINDOWS_OWNER_MEDIA_QUERY_OPERATIONS = MEDIA_QUERY_OPERATIONS

export class MediaResourceOwnerError extends Error {
  constructor(code, details = {}) {
    super(MEDIA_ERROR_MESSAGE[code] || 'media resource operation failed')
    this.name = 'MediaResourceOwnerError'
    this.code = code
    this.details = Object.freeze({ ...details })
  }
}

export function getWindowsOwnerMediaQueryOperation(domain) {
  const mapping = MEDIA_QUERY_OPERATIONS[domain]
  return mapping ? Object.freeze({ domain, ...mapping }) : null
}

export function assertWindowsOwnerMediaMetadataOnly(value, context = 'media') {
  walkMediaMetadata(value, new WeakSet(), context, null)
  return value
}

export function validateWindowsOwnerMediaDescriptor(value, options = {}) {
  if (!isPlainObject(value)) throw mediaError('media-descriptor-invalid', { field: 'descriptor' })
  for (const key of Object.keys(value)) {
    if (!MEDIA_DESCRIPTOR_KEYS.has(key)) throw mediaError('media-descriptor-invalid', { field: 'descriptor' })
  }
  if (value.schemaVersion !== 1) throw mediaError('media-descriptor-invalid', { field: 'schemaVersion' })

  const profileId = requireMediaIdentity(value.profileId, 'profileId')
  if (options.profileId !== undefined && profileId !== options.profileId) {
    throw mediaError('media-descriptor-invalid', { field: 'profileId' })
  }
  const mediaId = requireMediaIdentity(value.mediaId, 'mediaId')
  if (value.kind !== 'audio' && value.kind !== 'video') {
    throw mediaError('media-descriptor-invalid', { field: 'kind' })
  }
  const authorizedUrl = validateAuthorizedMediaUrl(value.authorizedUrl)
  if (!Number.isSafeInteger(value.size) || value.size < 0) {
    throw mediaError('media-descriptor-invalid', { field: 'size' })
  }
  const contentType = requireVisibleString(value.contentType, 'contentType', 128)
  const etag = requireVisibleString(value.etag, 'etag', 256)
  const revision = requireMediaRevision(value.revision)

  return Object.freeze({
    schemaVersion: 1,
    profileId,
    mediaId,
    kind: value.kind,
    authorizedUrl,
    size: value.size,
    contentType,
    etag,
    revision,
  })
}

export function validateWindowsOwnerMediaQueryResult(result, options = {}) {
  const mapping = MEDIA_QUERY_OPERATIONS[options.domain]
  if (!mapping || !isPlainObject(result)) {
    throw mediaError('media-capability-invalid', { field: 'operation' })
  }
  if (result.domain !== options.domain || result.operation !== mapping.operation) {
    throw mediaError('media-capability-invalid', { field: 'operation' })
  }
  const failureCode = mapWindowsOwnerMediaQueryFailure(result)
  if (failureCode) throw mediaError(failureCode, { field: 'outcome' })
  assertWindowsOwnerMediaMetadataOnly(result.payload, 'response.payload')
  if (result.outcome !== 'read' || result.commitStatus !== 'not-applicable') {
    throw mediaError('media-capability-invalid', { field: 'commitStatus' })
  }
  if (!isPlainObject(result.payload) || Object.keys(result.payload).some((key) => key !== 'media')) {
    throw mediaError('media-capability-invalid', { field: 'payload' })
  }
  const descriptor = validateWindowsOwnerMediaDescriptor(result.payload.media, options)
  return Object.freeze({
    domain: options.domain,
    operation: mapping.operation,
    capability: mapping.capability,
    descriptor,
  })
}

export async function probeWindowsOwnerMediaRange(descriptor, options = {}) {
  const normalizedDescriptor = validateWindowsOwnerMediaDescriptor(descriptor, options)
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') throw mediaError('media-not-ready', { field: 'fetch' })

  let response
  try {
    response = await fetchImpl(normalizedDescriptor.authorizedUrl, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-0',
      },
      credentials: 'same-origin',
      cache: 'no-store',
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (error) {
    if (error?.name === 'AbortError' || options.signal?.aborted) {
      throw mediaError('media-aborted')
    }
    throw mediaError('media-upstream')
  }

  const status = Number(response?.status)
  if (status === 200) {
    await cancelResponseBody(response)
    throw mediaError('media-rebind-required')
  }
  if (status === 404 || status === 410) throw mediaError('media-not-found')
  if (status === 401 || status === 403) throw mediaError('media-unauthorized')
  if (status !== 206) throw mediaError('media-range-unsupported', { status })

  const contentRange = readHeader(response.headers, 'content-range')
  const acceptRanges = readHeader(response.headers, 'accept-ranges')
  const etag = readHeader(response.headers, 'etag')
  const mediaId = readHeader(response.headers, 'x-read-web-media-identity')
  const expectedRange = `bytes 0-0/${normalizedDescriptor.size}`
  if (contentRange !== expectedRange || !acceptRanges.split(',').some((item) => item.trim().toLowerCase() === 'bytes')) {
    throw mediaError('media-range-unsupported', { status })
  }
  if (etag !== normalizedDescriptor.etag || mediaId !== normalizedDescriptor.mediaId) {
    throw mediaError('media-rebind-required')
  }

  return Object.freeze({
    status,
    contentRange,
    acceptRanges,
    etag,
    mediaId,
  })
}

export function createWindowsOwnerMediaResourceOwner(options = {}) {
  const profileId = requireMediaIdentity(options.profileId, 'profileId')
  const mediaOwner = options.mediaOwner || createMediaResourceOwner(options)
  if (!mediaOwner || typeof mediaOwner.replace !== 'function' || typeof mediaOwner.dispose !== 'function') {
    throw new TypeError('Windows owner media resource requires a MediaResourceOwner')
  }
  const ownerClient = options.ownerClient
  const fetchImpl = options.fetchImpl
  let generation = 0
  let currentDescriptor = null

  async function bind(request = {}) {
    const mapping = MEDIA_QUERY_OPERATIONS[request.domain]
    if (!mapping) throw mediaError('media-capability-invalid', { field: 'domain' })
    assertWindowsOwnerMediaMetadataOnly(request.payload === undefined ? {} : request.payload, 'request.payload')
    if (!ownerClient || typeof ownerClient.query !== 'function') {
      throw mediaError('media-not-ready', { field: 'ownerClient' })
    }
    const result = await ownerClient.query({
      domain: request.domain,
      operation: mapping.operation,
      payload: request.payload === undefined ? {} : request.payload,
      ...(request.signal ? { signal: request.signal } : {}),
    })
    const validated = validateWindowsOwnerMediaQueryResult(result, { domain: request.domain, profileId })
    return bindDescriptor(validated.descriptor, { signal: request.signal })
  }

  async function bindDescriptor(value, bindOptions = {}) {
    const descriptor = validateWindowsOwnerMediaDescriptor(value, { profileId })
    const bindGeneration = ++generation
    if (currentDescriptor && !sameMediaDescriptor(currentDescriptor, descriptor)) {
      currentDescriptor = null
      safelyDispose(mediaOwner)
    }

    try {
      const range = await probeWindowsOwnerMediaRange(descriptor, {
        fetchImpl,
        signal: bindOptions.signal,
        profileId,
      })
      if (bindGeneration !== generation) throw mediaError('media-binding-stale')
      try {
        mediaOwner.replace(descriptor.authorizedUrl)
      } catch {
        throw mediaError('media-bind-failed')
      }
      currentDescriptor = descriptor
      return Object.freeze({ descriptor, range })
    } catch (error) {
      if (bindGeneration === generation) {
        currentDescriptor = null
        safelyDispose(mediaOwner)
      }
      throw error
    }
  }

  return Object.freeze({
    bind,
    bindDescriptor,
    getDescriptor() {
      return currentDescriptor
    },
    dispose() {
      generation += 1
      currentDescriptor = null
      safelyDispose(mediaOwner)
    },
  })
}

function mediaError(code, details = {}) {
  return new MediaResourceOwnerError(code, details)
}

function mapWindowsOwnerMediaQueryFailure(result) {
  const outcome = typeof result.outcome === 'string' ? result.outcome : ''
  const typedError = isPlainObject(result.error) ? result.error : null
  const errorCode = typeof typedError?.code === 'string' ? typedError.code : ''
  const errorCategory = typeof typedError?.category === 'string' ? typedError.category : ''

  if (MEDIA_QUERY_NOT_READY_VALUES.has(outcome) || MEDIA_QUERY_NOT_READY_VALUES.has(errorCode)) return 'media-not-ready'
  if (MEDIA_QUERY_NOT_FOUND_VALUES.has(errorCode) || MEDIA_QUERY_NOT_FOUND_VALUES.has(errorCategory)) return 'media-not-found'
  if (errorCategory === 'authorization' || MEDIA_QUERY_UNAUTHORIZED_VALUES.has(errorCode)) {
    return 'media-unauthorized'
  }
  return null
}

async function cancelResponseBody(response) {
  const body = response?.body
  if (!body || typeof body.cancel !== 'function') return
  try {
    await body.cancel()
  } catch {
    // The typed rebind result remains authoritative even if stream cancellation rejects.
  }
}

function requireMediaIdentity(value, field) {
  if (typeof value !== 'string' || !SAFE_MEDIA_IDENTITY.test(value)) {
    throw mediaError('media-descriptor-invalid', { field })
  }
  return value
}

function requireMediaRevision(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && SAFE_MEDIA_IDENTITY.test(value)) return value
  throw mediaError('media-descriptor-invalid', { field: 'revision' })
}

function requireVisibleString(value, field, maxLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw mediaError('media-descriptor-invalid', { field })
  }
  return value
}

function validateAuthorizedMediaUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\\\u0000-\u001f\u007f]/u.test(value)) {
    throw mediaError('media-unauthorized-url')
  }
  if (!value.startsWith('/') || value.startsWith('//')) throw mediaError('media-unauthorized-url')
  let parsed
  try {
    parsed = new URL(value, 'http://127.0.0.1')
  } catch {
    throw mediaError('media-unauthorized-url')
  }
  if (parsed.origin !== 'http://127.0.0.1' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw mediaError('media-unauthorized-url')
  }
  const match = MEDIA_ROUTE.exec(parsed.pathname)
  if (!match) throw mediaError('media-unauthorized-url')
  let jobId
  try {
    jobId = decodeURIComponent(match[1])
  } catch {
    throw mediaError('media-unauthorized-url')
  }
  if (!SAFE_MEDIA_JOB_ID.test(jobId) || jobId.includes('/') || jobId.includes('\\')) {
    throw mediaError('media-unauthorized-url')
  }
  return value
}

function walkMediaMetadata(value, seen, context, key) {
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw mediaError('media-payload-rejected', { field: context })
    return
  }
  if (typeof value === 'string') {
    if (MEDIA_DATA_URI.test(value) || (key && MEDIA_BINARY_KEY.test(key)) || (key && MEDIA_BASE64.test(value)) || MEDIA_BASE64_PREFIX.test(value)) {
      throw mediaError('media-payload-rejected', { field: context })
    }
    return
  }
  if (isBinaryValue(value)) throw mediaError('media-payload-rejected', { field: context })
  if (Array.isArray(value)) {
    if (seen.has(value)) throw mediaError('media-payload-rejected', { field: context })
    seen.add(value)
    value.forEach((item, index) => walkMediaMetadata(item, seen, `${context}[${index}]`, key))
    return
  }
  if (!isPlainObject(value)) throw mediaError('media-payload-rejected', { field: context })
  if (seen.has(value)) throw mediaError('media-payload-rejected', { field: context })
  seen.add(value)
  for (const [childKey, childValue] of Object.entries(value)) {
    if (MEDIA_BINARY_KEY.test(childKey)) throw mediaError('media-payload-rejected', { field: context })
    walkMediaMetadata(childValue, seen, `${context}.${childKey}`, childKey)
  }
}

function isBinaryValue(value) {
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return true
  if (typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(value)) return true
  return typeof Blob !== 'undefined' && value instanceof Blob
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function readHeader(headers, name) {
  if (!headers) return ''
  if (typeof headers.get === 'function') return String(headers.get(name) || '').trim()
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return String(value || '').trim()
  }
  return ''
}

function sameMediaDescriptor(left, right) {
  return ['profileId', 'mediaId', 'kind', 'authorizedUrl', 'size', 'contentType', 'etag', 'revision']
    .every((field) => left[field] === right[field])
}

function safelyDispose(mediaOwner) {
  try { mediaOwner.dispose() } catch { /* Resource cleanup remains best effort. */ }
}

export function createMediaResourceOwner(options = {}) {
  const mediaElement = options.mediaElement
  const revokeObjectURL = options.revokeObjectURL ?? defaultRevokeObjectURL
  if (!mediaElement || typeof mediaElement !== 'object') {
    throw new TypeError('MediaResourceOwner requires a mediaElement')
  }
  if (typeof revokeObjectURL !== 'function') {
    throw new TypeError('MediaResourceOwner requires a revokeObjectURL function')
  }

  let currentUrl = null

  function releaseCurrent() {
    if (currentUrl === null) return
    const releasedUrl = currentUrl
    currentUrl = null
    try { mediaElement.pause?.() } catch { /* Cleanup continues. */ }
    try { mediaElement.removeAttribute?.('src') } catch { /* Cleanup continues. */ }
    try { mediaElement.load?.() } catch { /* Cleanup continues. */ }
    if (isBlobUrl(releasedUrl)) {
      try { revokeObjectURL(releasedUrl) } catch { /* Ownership is still released. */ }
    }
  }

  return Object.freeze({
    replace(url) {
      if (typeof url !== 'string' || url.length === 0) {
        throw new TypeError('MediaResourceOwner.replace requires a non-empty URL')
      }
      if (url === currentUrl) return false
      releaseCurrent()
      mediaElement.src = url
      currentUrl = url
      return true
    },

    dispose() {
      releaseCurrent()
    },
  })
}
