import {
  assertWindowsOwnerMediaMetadataOnly,
  createWindowsOwnerMediaResourceOwner,
  getWindowsOwnerMediaQueryOperation,
  MediaResourceOwnerError,
  validateWindowsOwnerMediaDescriptor,
  validateWindowsOwnerMediaQueryResult,
} from './media/media-resource-owner.js'

export const WINDOWS_OWNER_READER_SESSION_DOMAIN = 'reader-session'
export const WINDOWS_OWNER_READER_SESSION_SCHEMA = 'reader-session-owner.v1'

const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAFE_REVISION = /^(?:[A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/u
const MEDIA_KEYS = ['mediaId', 'kind', 'size', 'contentType', 'etag', 'revision', 'authorizedUrl']
const FORBIDDEN_KEY = /(?:token|authorization|cookie|password|secret|api[-_]?key|directoryhandle|(?:absolute|local|file)[-_]?path|media(?:bytes|blob|data)|(?:audio|video)(?:bytes|blob|data)|arraybuffer|typedarray|base64|datauri)/iu
const PATH_KEY = /^(?:path|file[-_]?path|local[-_]?path|absolute[-_]?path)$/iu
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|mnt|Volumes|private|opt|Program Files|Windows|Documents and Settings)(?:[\\/]|$))/iu
const MEDIA_BASE64 = /^[A-Za-z0-9+/]{128,}={0,2}$/u
const MEDIA_BASE64_PREFIX = /^(?:UklGR|SUQz|T2dn|GkXfo|AAAAIGZ0eX)/u
const GENERIC_DATA_URI = /^data:[^,]{0,128},/iu
const ERROR_MESSAGES = Object.freeze({
  'owner-not-ready': 'reader session owner is not ready',
  'reader-session-invalid': 'reader session owner returned invalid data',
  'reader-session-empty': 'reader session owner has no committed session',
  'reader-session-conflict': 'reader session owner rejected the revision',
  'reader-session-commit-unknown': 'reader session commit status is unknown',
  'media-not-ready': 'reader session media is not ready',
})

export class WindowsOwnerReaderSessionError extends Error {
  constructor(code, options = {}) {
    super(ERROR_MESSAGES[code] || options.message || 'reader session owner operation failed')
    this.name = 'WindowsOwnerReaderSessionError'
    this.code = code
    this.category = options.category || 'owner'
    this.outcome = options.outcome || null
    this.retryable = options.retryable === true
  }
}

export function createWindowsOwnerReaderSessionConsumer(options = {}) {
  const profileId = requireIdentity(options.profileId, 'profileId')
  const ownerClient = options.ownerClient
  if (!ownerClient || typeof ownerClient.query !== 'function' || typeof ownerClient.command !== 'function' || typeof ownerClient.receipt !== 'function') {
    throw new TypeError('reader session owner consumer requires the typed owner client')
  }

  const mediaOwner = options.mediaOwner || (options.mediaElement
    ? createWindowsOwnerMediaResourceOwner({
      profileId,
      mediaElement: options.mediaElement,
      ownerClient,
      fetchImpl: options.fetchImpl,
    })
    : null)

  async function querySnapshot({ signal } = {}) {
    let result
    try {
      result = await ownerClient.query({
        domain: WINDOWS_OWNER_READER_SESSION_DOMAIN,
        operation: 'snapshot',
        payload: {},
        ...(signal ? { signal } : {}),
      })
    } catch (error) {
      return rejectedResult(error)
    }

    if (isNotFound(result)) return { status: 'empty', source: 'owner', result }
    if (result.outcome !== 'read' || !isPlainObject(result.payload) || !isPlainObject(result.payload.snapshot)) {
      return rejectedResult(errorFromResult(result))
    }

    try {
      const normalized = normalizeSnapshot(result.payload.snapshot, profileId)
      if (result.revision !== undefined && result.revision !== null && result.revision !== normalized.snapshot.revision) {
        throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'schema' })
      }
      return {
        status: 'found',
        source: 'owner',
        snapshot: normalized.snapshot,
        session: normalized.session,
        result,
      }
    } catch (error) {
      return rejectedResult(error)
    }
  }

  async function currentRevision({ signal } = {}) {
    let result
    try {
      result = await ownerClient.query({
        domain: WINDOWS_OWNER_READER_SESSION_DOMAIN,
        operation: 'current-revision',
        payload: {},
        ...(signal ? { signal } : {}),
      })
    } catch (error) {
      throw toOwnerError(error)
    }
    if (isNotFound(result)) return 0
    if (result.outcome !== 'read') throw errorFromResult(result)
    const revision = result.payload?.revision ?? result.revision ?? result.payload?.sessionRevision
    return requireHostRevision(revision, 'currentRevision')
  }

  async function resolveMediaDescriptor(request = {}, options = {}) {
    const payload = request.payload === undefined ? request : request.payload
    return queryMediaDescriptor(WINDOWS_OWNER_READER_SESSION_DOMAIN, payload, options)
  }

  async function resolveWorkflowMediaDescriptor(request = {}, options = {}) {
    const source = request.payload === undefined ? request : request.payload
    const jobId = source?.jobId
      || (typeof source?.contentId === 'string' ? source.contentId.replace(/^youtube-workflow:/u, '') : '')
    const mediaKind = source?.mediaKind || source?.kind || 'audio'
    if (typeof jobId !== 'string' || !jobId || (mediaKind !== 'audio' && mediaKind !== 'video')) {
      throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'validation' })
    }
    return queryMediaDescriptor('workflow', { jobId, mediaKind }, options)
  }

  async function queryMediaDescriptor(domain, payload, { signal } = {}) {
    const mapping = getWindowsOwnerMediaQueryOperation(domain)
    if (!mapping) throw new WindowsOwnerReaderSessionError('owner-not-ready')
    assertWindowsOwnerMediaMetadataOnly(payload, `${domain}.media-query`)

    let result
    try {
      result = await ownerClient.query({
        domain: mapping.domain,
        operation: mapping.operation,
        payload,
        ...(signal ? { signal } : {}),
      })
    } catch (error) {
      throw toOwnerError(error)
    }

    let adapted = result
    if (isPlainObject(result?.payload) && isPlainObject(result.payload.media)) {
      const media = normalizeMediaDescriptor(result.payload.media, profileId)
      adapted = { ...result, payload: { media } }
    }
    try {
      return validateWindowsOwnerMediaQueryResult(adapted, {
        domain: mapping.domain,
        profileId,
      }).descriptor
    } catch (error) {
      throw toOwnerError(error)
    }
  }

  async function bindMediaDescriptor(descriptor, { signal } = {}) {
    if (!mediaOwner || typeof mediaOwner.bindDescriptor !== 'function') {
      throw new WindowsOwnerReaderSessionError('media-not-ready', { category: 'readiness', retryable: true })
    }
    try {
      return await mediaOwner.bindDescriptor(descriptor, signal ? { signal } : {})
    } catch (error) {
      throw toOwnerError(error)
    }
  }

  async function load({ fallbackSession = null, signal } = {}) {
    const queried = await querySnapshot({ signal })
    if (queried.status === 'empty') return queried
    if (queried.status !== 'found') {
      return { ...queried, source: 'owner', session: fallbackSession }
    }

    try {
      const expectedMedia = queried.session.media
      const descriptor = await resolveMediaDescriptor({
        contentId: queried.session.contentId,
        sessionRevision: queried.session.revision,
        mediaId: expectedMedia.mediaId,
        kind: expectedMedia.kind,
      }, { signal })
      if (!sameMediaDescriptor(expectedMedia, descriptor)) {
        safelyDispose()
        throw new MediaResourceOwnerError('media-rebind-required')
      }
      await bindMediaDescriptor(descriptor, { signal })
      return {
        status: 'loaded',
        source: 'owner',
        session: queried.session,
        snapshot: queried.snapshot,
        mediaDescriptor: descriptor,
        revision: queried.snapshot.revision,
        result: queried.result,
      }
    } catch (error) {
      if (isMediaFailure(error)) safelyDispose()
      return {
        status: error?.code || 'rejected',
        source: 'owner',
        session: fallbackSession,
        error: toOwnerError(error),
      }
    }
  }

  async function commitSession(session, options = {}) {
    let expectedRevision
    try {
      assertOwnerSessionSafe(session, 'reader-session')
      expectedRevision = options.expectedRevision === undefined
        ? await currentRevision({ signal: options.signal })
        : requireHostRevision(options.expectedRevision, 'expectedRevision')
    } catch (error) {
      return rejectedResult(error)
    }

    const candidateRevision = options.candidateRevision === undefined
      ? expectedRevision + 1
      : options.candidateRevision
    let candidate
    try {
      candidate = candidateFromSession(session, {
        profileId,
        revision: requireHostRevision(candidateRevision, 'candidateRevision'),
        mediaDescriptor: options.mediaDescriptor,
      })
    } catch (error) {
      return rejectedResult(error)
    }

    let idempotencyKey
    const generatedIdempotencyKey = options.idempotencyKey === undefined
    try {
      idempotencyKey = generatedIdempotencyKey
        ? await createStableCommitIdempotencyKey(session, candidate, profileId)
        : requireIdempotency(options.idempotencyKey)
    } catch (error) {
      return rejectedResult(error)
    }
    let commitOptions = { ...options, idempotencyKey }
    let prior = await lookupExistingCommitReceipt(idempotencyKey, session, candidate, commitOptions, expectedRevision)
    if (prior?.occurrenceRequired) {
      if (!generatedIdempotencyKey) return occurrenceConflict(prior)
      try {
        idempotencyKey = await createStableCommitIdempotencyKey(
          session,
          candidate,
          profileId,
          prior.baseRevision,
        )
        commitOptions = { ...options, idempotencyKey }
      } catch (error) {
        return rejectedResult(error)
      }
      prior = await lookupExistingCommitReceipt(idempotencyKey, session, candidate, commitOptions, expectedRevision)
      if (prior?.occurrenceRequired) return occurrenceConflict(prior)
    }
    if (prior) return prior

    let prepareResult
    try {
      prepareResult = await ownerClient.command({
        domain: WINDOWS_OWNER_READER_SESSION_DOMAIN,
        operation: 'prepare',
        expectedRevision,
        payload: { candidate },
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (error) {
      return rejectedResult(error)
    }
    if (prepareResult.outcome !== 'read' || !isPlainObject(prepareResult.payload?.prepare)) {
      return commandResult(prepareResult)
    }
    const prepareId = prepareResult.payload.prepare.prepareId
    if (typeof prepareId !== 'string' || !SAFE_REVISION.test(prepareId)) {
      return rejectedResult(new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'schema' }))
    }

    let commitResult
    try {
      commitResult = await ownerClient.command({
        domain: WINDOWS_OWNER_READER_SESSION_DOMAIN,
        operation: 'commit',
        expectedRevision,
        idempotencyKey,
        payload: { prepareId },
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (error) {
      return rejectedResult(error)
    }

    if (commitResult.outcome === 'commit-unknown') {
      return resolveUnknownCommit(commitResult, candidate, session, commitOptions)
    }
    if (commitResult.outcome !== 'committed') return commandResult(commitResult)
    return committedResult(commitResult, session, candidate)
  }

  async function restoreSession(snapshot, options = {}) {
    const source = options.source || 'snapshot'
    if (source !== 'snapshot' && source !== 'previous') {
      return rejectedResult(new WindowsOwnerReaderSessionError('reader-session-invalid'))
    }
    try {
      if (snapshot !== undefined) assertOwnerSessionSafe(snapshot, 'reader-session.restore')
      const expectedRevision = requireHostRevision(options.expectedRevision, 'expectedRevision')
      const idempotencyKey = requireIdempotency(options.idempotencyKey)
      const result = await ownerClient.command({
        domain: WINDOWS_OWNER_READER_SESSION_DOMAIN,
        operation: 'restore',
        expectedRevision,
        idempotencyKey,
        payload: {
          source,
          ...(snapshot === undefined ? {} : { snapshot }),
        },
        ...(options.signal ? { signal: options.signal } : {}),
      })
      if (result.outcome === 'commit-unknown') {
        return {
          status: 'commit-unknown',
          result,
          error: new WindowsOwnerReaderSessionError('reader-session-commit-unknown', { category: 'recovery', retryable: true }),
        }
      }
      return commandResult(result)
    } catch (error) {
      return rejectedResult(error)
    }
  }

  function getDescriptor() {
    return mediaOwner && typeof mediaOwner.getDescriptor === 'function'
      ? mediaOwner.getDescriptor()
      : null
  }

  function safelyDispose() {
    try { mediaOwner?.dispose?.() } catch (_error) {}
  }

  return Object.freeze({
    bindMediaDescriptor,
    commitSession,
    currentRevision,
    dispose: safelyDispose,
    getDescriptor,
    load,
    querySnapshot,
    resolveMediaDescriptor,
    resolveWorkflowMediaDescriptor,
    restoreSession,
  })

  async function lookupExistingCommitReceipt(idempotencyKey, session, candidate, commitOptions, expectedRevision) {
    let receiptResult
    try {
      receiptResult = await ownerClient.receipt({
        domain: WINDOWS_OWNER_READER_SESSION_DOMAIN,
        idempotencyKey,
        ...(commitOptions.signal ? { signal: commitOptions.signal } : {}),
      })
    } catch (error) {
      return rejectedResult(error, 'reader-session-commit-unknown')
    }
    if (isNotFound(receiptResult)) return null
    if (receiptResult.outcome === 'conflict'
      || receiptResult.outcome === 'not-ready'
      || receiptResult.outcome === 'manual-recovery') {
      return commandResult(receiptResult)
    }
    if (receiptResult.outcome !== 'committed'
      || receiptResult.commitStatus !== 'committed'
      || !isPlainObject(receiptResult.receipt)) {
      return {
        status: 'commit-unknown',
        result: receiptResult,
        error: new WindowsOwnerReaderSessionError('reader-session-commit-unknown', { category: 'recovery', retryable: true }),
      }
    }

    const receipt = receiptResult.receipt
    if (receipt.operation !== 'commit' || receipt.idempotencyKey !== idempotencyKey) {
      return {
        status: 'conflict',
        result: receiptResult,
        error: new WindowsOwnerReaderSessionError('reader-session-conflict', { category: 'conflict', retryable: true }),
      }
    }
    const queried = await querySnapshot({ signal: commitOptions.signal })
    const snapshot = queried.status === 'found' ? queried.snapshot : null
    if (!snapshot) {
      return {
        status: 'commit-unknown',
        result: receiptResult,
        error: new WindowsOwnerReaderSessionError('reader-session-commit-unknown', { category: 'recovery', retryable: true }),
      }
    }
    const currentMatches = snapshotMatchesStableSession(snapshot, session, candidate, profileId)
    if (currentMatches
      && receipt.revision === snapshot.revision
      && receipt.expectedRevision === snapshot.commit.expectedRevision
      && receipt.requestFingerprint === snapshot.commit.requestFingerprint
      && receipt.effectFingerprint === snapshot.commit.effectFingerprint
      && receipt.recordChecksums?.[0] === snapshot.checksum) {
      return committedResult(receiptResult, session, candidate)
    }
    const baseRevision = currentMatches ? snapshot.commit.expectedRevision : expectedRevision
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
      return {
        status: 'commit-unknown',
        result: receiptResult,
        error: new WindowsOwnerReaderSessionError('reader-session-commit-unknown', { category: 'recovery', retryable: true }),
      }
    }
    return { occurrenceRequired: true, baseRevision, result: receiptResult }
  }

  async function resolveUnknownCommit(command, candidate, session, commitOptions) {
    let receiptResult
    try {
      receiptResult = await ownerClient.receipt({
        domain: WINDOWS_OWNER_READER_SESSION_DOMAIN,
        idempotencyKey: commitOptions.idempotencyKey,
        ...(commitOptions.signal ? { signal: commitOptions.signal } : {}),
      })
    } catch (error) {
      return rejectedResult(error, 'reader-session-commit-unknown')
    }
    if (receiptResult.outcome !== 'committed' || receiptResult.commitStatus !== 'committed') {
      if (receiptResult.outcome === 'conflict') return commandResult(receiptResult)
      return {
        status: 'commit-unknown',
        result: receiptResult,
        error: new WindowsOwnerReaderSessionError('reader-session-commit-unknown', { category: 'recovery', retryable: true }),
      }
    }

    let snapshot = receiptResult.payload?.snapshot
    if (!snapshot) {
      const queried = await querySnapshot({ signal: commitOptions.signal })
      snapshot = queried.status === 'found' ? queried.snapshot : null
    }
    const receipt = receiptResult.receipt
    if (!snapshot || !snapshotMatchesCandidate(snapshot, candidate, profileId)
      || receipt?.operation !== 'commit'
      || receipt?.idempotencyKey !== commitOptions.idempotencyKey
      || receipt?.expectedRevision !== candidate.revision - 1
      || receipt?.revision !== snapshot.revision
      || receipt?.recordChecksums?.[0] !== snapshot.checksum) {
      return {
        status: 'commit-unknown',
        result: receiptResult,
        error: new WindowsOwnerReaderSessionError('reader-session-commit-unknown', { category: 'recovery', retryable: true }),
      }
    }
    return committedResult(receiptResult, session, candidate)
  }
}

export function normalizeReaderSessionSnapshot(value, profileId) {
  return normalizeSnapshot(value, requireIdentity(profileId, 'profileId'))
}

function normalizeSnapshot(value, profileId) {
  if (!isPlainObject(value) || value.schemaVersion !== WINDOWS_OWNER_READER_SESSION_SCHEMA || value.domain !== WINDOWS_OWNER_READER_SESSION_DOMAIN || value.profileId !== profileId) {
    throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'schema' })
  }
  assertOwnerSessionSafe(value, 'reader-session.snapshot')
  const contentId = requireIdentity(value.contentId, 'contentId')
  const revision = requireHostRevision(value.revision, 'revision')
  const media = normalizeMediaDescriptor(value.media, profileId)
  if (!isPlainObject(value.audioMeta) || !isPlainObject(value.transcript) || !Array.isArray(value.marks)
    || (!Array.isArray(value.chunkData) && !isPlainObject(value.chunkData))) {
    throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'schema' })
  }
  if (value.audioMeta.media !== undefined
    && canonicalJson(value.audioMeta.media) !== canonicalJson(stripMediaDescriptor(media))) {
    throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'schema' })
  }
  if (typeof value.checksum !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value.checksum)) {
    throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'schema' })
  }
  if (!isPlainObject(value.commit)
    || !['commit', 'restore'].includes(value.commit.operation)
    || !/^sha256:[a-f0-9]{64}$/u.test(value.commit.requestFingerprint)
    || !Number.isSafeInteger(value.commit.expectedRevision)
    || value.commit.expectedRevision < 0
    || !/^sha256:[a-f0-9]{64}$/u.test(value.commit.effectFingerprint)
    || typeof value.commit.committedAt !== 'string'
    || value.commit.committedAt.length === 0) {
    throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'schema' })
  }
  const audioMeta = cloneJson(value.audioMeta)
  audioMeta.streamUrl = media.authorizedUrl
  audioMeta.media = stripMediaDescriptor(media)
  const session = {
    contentId,
    revision,
    audioMeta,
    transcript: cloneJson(value.transcript),
    chunkData: cloneJson(value.chunkData),
    marks: cloneJson(value.marks),
    media,
  }
  return {
    snapshot: {
      ...cloneJson(value),
      audioMeta,
      media: stripMediaDescriptor(media),
    },
    session,
  }
}

function candidateFromSession(session, { profileId, revision, mediaDescriptor }) {
  if (!isPlainObject(session)) throw new WindowsOwnerReaderSessionError('reader-session-invalid')
  const descriptor = normalizeMediaDescriptor(mediaDescriptor || session.media || session.audioMeta?.media, profileId)
  if (!isPlainObject(session.audioMeta) || !isPlainObject(session.transcript)
    || (!Array.isArray(session.chunkData) && !isPlainObject(session.chunkData)) || !Array.isArray(session.marks)) {
    throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'schema' })
  }
  const audioMeta = cloneJson(session.audioMeta)
  audioMeta.streamUrl = descriptor.authorizedUrl
  audioMeta.media = stripMediaDescriptor(descriptor)
  const candidate = {
    schemaVersion: WINDOWS_OWNER_READER_SESSION_SCHEMA,
    domain: WINDOWS_OWNER_READER_SESSION_DOMAIN,
    profileId,
    contentId: requireIdentity(session.contentId, 'contentId'),
    revision,
    audioMeta,
    transcript: cloneJson(session.transcript),
    chunkData: cloneJson(session.chunkData),
    marks: cloneJson(session.marks),
    media: stripMediaDescriptor(descriptor),
  }
  assertOwnerSessionSafe(candidate, 'reader-session.candidate')
  return candidate
}

function normalizeMediaDescriptor(value, profileId) {
  if (!isPlainObject(value)) throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'schema' })
  const candidate = value.schemaVersion === undefined
    ? { schemaVersion: 1, profileId, ...value }
    : value
  try {
    return validateWindowsOwnerMediaDescriptor(candidate, { profileId })
  } catch (error) {
    throw toOwnerError(error, 'reader-session-invalid')
  }
}

function stripMediaDescriptor(value) {
  return Object.fromEntries(MEDIA_KEYS.map((key) => [key, value[key]]))
}

function snapshotMatchesCandidate(snapshot, candidate, profileId) {
  try {
    const normalized = normalizeSnapshot(snapshot, profileId)
    const actual = candidateFromSession(normalized.session, {
      profileId,
      revision: candidate.revision,
      mediaDescriptor: normalized.session.media,
    })
    return canonicalJson(actual) === canonicalJson(candidate)
      && normalized.snapshot.revision === candidate.revision
  } catch (_error) {
    return false
  }
}

function snapshotMatchesStableSession(snapshot, session, candidate, profileId) {
  try {
    const normalized = normalizeSnapshot(snapshot, profileId)
    return canonicalJson(stableSessionProjection(normalized.session, {
      media: normalized.session.media,
      audioMeta: normalized.session.audioMeta,
      transcript: normalized.session.transcript,
      chunkData: normalized.session.chunkData,
      marks: normalized.session.marks,
    }, profileId)) === canonicalJson(stableSessionProjection(session, candidate, profileId))
  } catch (_error) {
    return false
  }
}

async function createStableCommitIdempotencyKey(session, candidate, profileId, baseRevision = null) {
  const material = canonicalJson({
    ...stableSessionProjection(session, candidate, profileId),
    sessionRevision: session.revision === undefined ? null : session.revision,
    ...(baseRevision === null ? {} : { baseRevision }),
  })
  if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') {
    throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'schema' })
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `reader-session-${hex}`
}

function stableSessionProjection(session, candidate, profileId) {
  const media = candidate.media || session.mediaDescriptor || session.media || session.audioMeta?.media
  const audioMeta = candidate.audioMeta || session.audioMeta
  return {
    schemaVersion: WINDOWS_OWNER_READER_SESSION_SCHEMA,
    domain: WINDOWS_OWNER_READER_SESSION_DOMAIN,
    profileId,
    contentId: requireIdentity(candidate.contentId || session.contentId, 'contentId'),
    media: stripMediaDescriptor(normalizeMediaDescriptor(media, profileId)),
    audioMeta: stableAudioMeta(audioMeta),
    transcript: cloneJson(candidate.transcript || session.transcript),
    chunkData: cloneJson(candidate.chunkData || session.chunkData),
    marks: cloneJson(candidate.marks || session.marks),
  }
}

function stableAudioMeta(value) {
  if (!isPlainObject(value)) return null
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['lastModified', 'streamUrl', 'media'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right)))
}

function committedResult(result, session, candidate) {
  return {
    status: 'committed',
    revision: result.revision ?? candidate.revision,
    receipt: result.receipt || null,
    result,
    session,
  }
}

function commandResult(result) {
  if (result?.outcome === 'committed') return { status: 'committed', result, revision: result.revision, receipt: result.receipt }
  const status = result?.outcome === 'conflict'
    ? 'conflict'
    : result?.outcome === 'not-ready' || result?.outcome === 'manual-recovery'
      ? 'not-ready'
      : result?.outcome === 'commit-unknown' ? 'commit-unknown' : 'rejected'
  const error = errorFromResult(result)
  return { status, result, error }
}

function occurrenceConflict(prior) {
  return {
    status: 'conflict',
    result: prior.result,
    error: new WindowsOwnerReaderSessionError('reader-session-conflict', { category: 'conflict', retryable: true }),
  }
}

function rejectedResult(error, overrideCode = null) {
  const normalized = toOwnerError(error, overrideCode)
  return { status: 'rejected', error: normalized }
}

function errorFromResult(result) {
  const code = result?.error?.code || result?.outcome || 'reader-session-invalid'
  const mapped = code === 'not-ready' || code === 'manual-recovery'
    ? 'owner-not-ready'
    : code === 'conflict' || code === 'revision-conflict'
      ? 'reader-session-conflict'
      : code === 'commit-unknown' ? 'reader-session-commit-unknown' : code
  return new WindowsOwnerReaderSessionError(mapped, {
    category: result?.error?.category || 'owner',
    outcome: result?.outcome || null,
    retryable: result?.error?.retryable === true,
  })
}

function toOwnerError(error, fallbackCode = null) {
  if (error instanceof WindowsOwnerReaderSessionError || error instanceof MediaResourceOwnerError) return error
  const code = fallbackCode || (error?.code === 'not-ready' ? 'owner-not-ready' : error?.code === 'commit-unknown' ? 'reader-session-commit-unknown' : 'reader-session-invalid')
  return new WindowsOwnerReaderSessionError(code, {
    category: error?.category || 'owner',
    retryable: error?.retryable === true,
  })
}

function isNotFound(result) {
  return result?.error?.code === 'not-found'
    || result?.error?.category === 'not-found'
    || (result?.outcome === 'read' && result?.payload?.found === false && result?.payload?.empty === true)
}

function isMediaFailure(error) {
  return error instanceof MediaResourceOwnerError
    || ['media-rebind-required', 'media-not-found', 'media-unauthorized', 'media-bind-failed'].includes(error?.code)
}

function sameMediaDescriptor(left, right) {
  return ['profileId', 'mediaId', 'kind', 'authorizedUrl', 'size', 'contentType', 'etag', 'revision']
    .every((field) => left?.[field] === right?.[field])
}

function assertOwnerSessionSafe(value, context, key = '', seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new WindowsOwnerReaderSessionError('reader-session-invalid')
    return
  }
  if (typeof value === 'string') {
    if (GENERIC_DATA_URI.test(value) || /^file:/iu.test(value) || ABSOLUTE_PATH.test(value)) {
      throw new WindowsOwnerReaderSessionError('reader-session-invalid')
    }
    if (key && (FORBIDDEN_KEY.test(key) || PATH_KEY.test(key))) {
      throw new WindowsOwnerReaderSessionError('reader-session-invalid')
    }
    if (key && /(?:base64|(?:^|[-_])(?:audio|video))$/iu.test(key)
      && (MEDIA_BASE64.test(value) || MEDIA_BASE64_PREFIX.test(value))) {
      throw new WindowsOwnerReaderSessionError('reader-session-invalid')
    }
    return
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) throw new WindowsOwnerReaderSessionError('reader-session-invalid')
  if (typeof ArrayBuffer !== 'undefined' && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) throw new WindowsOwnerReaderSessionError('reader-session-invalid')
  if (!isPlainObject(value) && !Array.isArray(value)) throw new WindowsOwnerReaderSessionError('reader-session-invalid')
  if (seen.has(value)) throw new WindowsOwnerReaderSessionError('reader-session-invalid')
  seen.add(value)
  if (Array.isArray(value)) value.forEach((item, index) => assertOwnerSessionSafe(item, `${context}[${index}]`, key, seen))
  else Object.entries(value).forEach(([childKey, childValue]) => {
    if (FORBIDDEN_KEY.test(childKey) || PATH_KEY.test(childKey)) throw new WindowsOwnerReaderSessionError('reader-session-invalid')
    assertOwnerSessionSafe(childValue, `${context}.${childKey}`, childKey, seen)
  })
  seen.delete(value)
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (_error) {
    throw new WindowsOwnerReaderSessionError('reader-session-invalid')
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function requireIdentity(value, field) {
  if (typeof value !== 'string' || !SAFE_IDENTITY.test(value)) throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'validation' })
  return value
}

function requireHostRevision(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'validation' })
  return value
}

function requireIdempotency(value) {
  if (typeof value !== 'string' || !SAFE_REVISION.test(value)) throw new WindowsOwnerReaderSessionError('reader-session-invalid', { category: 'validation' })
  return value
}
