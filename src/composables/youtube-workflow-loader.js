function getWordCount(transcript) {
  const segments = transcript && Array.isArray(transcript.segments) ? transcript.segments : []
  return segments.reduce((total, segment) => total + (Array.isArray(segment.words) ? segment.words.length : 0), 0)
}

function getChunkCountAndMaxEnd(chunkData) {
  let count = 0
  let maxEnd = 0
  if (chunkData && Array.isArray(chunkData.s)) {
    chunkData.s.forEach((segment) => {
      const chunks = segment && Array.isArray(segment.chunks) ? segment.chunks : []
      chunks.forEach((chunk) => {
        count += 1
        const end = Number(chunk && chunk.b)
        if (Number.isFinite(end)) maxEnd = Math.max(maxEnd, end)
      })
    })
  } else if (chunkData && Array.isArray(chunkData.items)) {
    count = chunkData.items.length
  } else if (Array.isArray(chunkData)) {
    count = chunkData.length
  }
  return { count, maxEnd }
}

async function blobToJson(blob, label) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const text = new TextDecoder().decode(bytes)
  try {
    return { value: JSON.parse(text), bytes }
  } catch (err) {
    throw new Error(`${label} JSON parse failed: ${err && err.message ? err.message : err}`)
  }
}

function validationError(code, message, details = {}) {
  const error = new Error(message)
  error.name = 'ReaderSessionValidationError'
  error.code = code
  Object.assign(error, details)
  return error
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw validationError('READER_SESSION_INTEGRITY_UNAVAILABLE', 'SHA-256 is unavailable')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function utf8(value) {
  return new TextEncoder().encode(value)
}

function canonicalDecimal(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (Object.is(number, -0) || number === 0) return '0'
  const raw = String(number).toLowerCase()
  if (!raw.includes('e')) return raw.includes('.') ? raw.replace(/0+$/, '').replace(/\.$/, '') : raw
  const [coefficient, exponentText] = raw.split('e')
  const exponent = Number(exponentText)
  const negative = coefficient.startsWith('-')
  const digits = coefficient.replace('-', '').replace('.', '')
  const decimalIndex = coefficient.replace('-', '').indexOf('.')
  const initialPoint = decimalIndex < 0 ? digits.length : decimalIndex
  const point = initialPoint + exponent
  const expanded = point <= 0
    ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length
      ? `${digits}${'0'.repeat(point - digits.length)}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`
  return `${negative ? '-' : ''}${expanded}`.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function marksIntegrityBytes(marks) {
  const projected = marks.map((mark) => ({
    globalIndex: Number(mark.globalIndex),
    word: String(mark.word || ''),
    start: canonicalDecimal(mark.start),
    sourceType: String(mark.sourceType || mark.source || 'manual-mark'),
  }))
  return utf8(canonicalJson(projected))
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('READER_SESSION_INTEGRITY_INVALID', `${label} must be an object`)
  }
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw validationError('READER_SESSION_INTEGRITY_INVALID', `${label} has an invalid shape`)
  }
}

function validateIntegrityEntry(entry, representation, label) {
  assertExactKeys(entry, ['bytes', 'representation', 'sha256'], label)
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0
    || entry.representation !== representation
    || typeof entry.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw validationError('READER_SESSION_INTEGRITY_INVALID', `${label} is invalid`)
  }
}

function normalizeMarksResponseIntegrity(integrity) {
  assertExactKeys(integrity, ['algorithm', 'bytes', 'representation', 'sha256'], 'reader marks response integrity')
  if (integrity.algorithm !== 'sha256') {
    throw validationError('READER_SESSION_INTEGRITY_INVALID', 'reader marks response integrity algorithm is unsupported')
  }
  const entry = {
    bytes: integrity.bytes,
    representation: integrity.representation,
    sha256: integrity.sha256,
  }
  validateIntegrityEntry(entry, 'marks-fields.v1', 'reader marks response integrity entry')
  return entry
}

async function verifyIntegrityEntry(entry, bytes, representation, label) {
  validateIntegrityEntry(entry, representation, label)
  const actualSha256 = await sha256Hex(bytes)
  if (entry.bytes !== bytes.byteLength || entry.sha256 !== actualSha256) {
    throw validationError('READER_SESSION_INTEGRITY_MISMATCH', `${label} does not match its declared integrity`, {
      resource: label,
    })
  }
}

function createJsonFileLike(payload, filename) {
  const text = JSON.stringify(payload, null, 2)
  if (typeof File === 'function') {
    return new File([text], filename, { type: 'application/json' })
  }
  return {
    name: filename,
    type: 'application/json',
    async text() {
      return text
    },
  }
}

function validateGeneratedSession({ audioUrl, transcript, chunkData, validateTranscriptData, validateChunkData }) {
  if (typeof audioUrl !== 'string' || !audioUrl) throw new Error('audio stream is missing')
  const normalizedTranscript = validateTranscriptData ? validateTranscriptData(transcript) : transcript
  if (!normalizedTranscript || !Array.isArray(normalizedTranscript.segments) || !normalizedTranscript.segments.length) {
    throw new Error('transcript JSON must contain segments')
  }
  const normalizedChunkData = validateChunkData ? validateChunkData(chunkData) : chunkData
  const stats = getChunkCountAndMaxEnd(normalizedChunkData)
  if (stats.count <= 0) throw new Error('chunkData output.json must contain chunks')
  const wordCount = getWordCount(normalizedTranscript)
  if (wordCount > 0 && stats.maxEnd > wordCount + 2) {
    throw new Error('chunkData does not match transcript')
  }
  return { transcript: normalizedTranscript, chunkData: normalizedChunkData }
}

function normalizePreparedMarks(marks, transcript) {
  const words = (transcript?.segments || []).flatMap((segment) => Array.isArray(segment?.words) ? segment.words : [])
  return marks.map((mark) => {
    const globalIndex = Number(mark?.globalIndex)
    if (!Number.isInteger(globalIndex) || globalIndex < 0 || globalIndex >= words.length) {
      throw validationError('READER_SESSION_MARK_OUT_OF_RANGE', 'reader mark globalIndex is outside the prepared transcript')
    }
    const word = words[globalIndex] || {}
    return {
      ...mark,
      globalIndex,
      word: String(mark.word || word.word || word.text || ''),
      ...(Number.isFinite(Number(mark.start ?? word.start)) ? { start: Number(mark.start ?? word.start) } : {}),
      sourceType: String(mark.sourceType || mark.source || 'manual-mark'),
    }
  })
}

async function resolveReaderSessionIdentity(manifest, requestedJobId, prepared) {
  if (!manifest || typeof manifest !== 'object') throw new Error('reader session manifest is required')
  if (typeof manifest.jobId === 'string' && manifest.jobId && manifest.jobId !== requestedJobId) {
    throw validationError('READER_SESSION_IDENTITY_MISMATCH', 'reader session manifest jobId does not match the requested job')
  }
  const fallbackContentId = `youtube-workflow:${requestedJobId}`
  const contentId = typeof manifest.contentId === 'string' ? manifest.contentId : ''
  const revision = typeof manifest.revision === 'string' ? manifest.revision : ''
  if (!contentId || !revision || !manifest.integrity) {
    return {
      contentId: fallbackContentId,
      revision: `${fallbackContentId}:1`,
      status: {
        status: 'degraded',
        code: 'READER_SESSION_IDENTITY_LEGACY',
        reason: 'manifest-identity-missing',
      },
    }
  }
  const expectedContentId = `youtube-workflow:${requestedJobId}`
  if (contentId !== expectedContentId) {
    throw validationError('READER_SESSION_IDENTITY_MISMATCH', 'reader session contentId does not match the requested job')
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(revision)) {
    throw validationError('READER_SESSION_REVISION_INVALID', 'reader session revision is invalid')
  }
  assertExactKeys(manifest.integrity, ['algorithm', 'chunkData', 'marks', 'transcript'], 'manifest.integrity')
  if (manifest.integrity.algorithm !== 'sha256') {
    throw validationError('READER_SESSION_INTEGRITY_INVALID', 'manifest integrity algorithm is unsupported')
  }
  await Promise.all([
    verifyIntegrityEntry(manifest.integrity.transcript, prepared.transcriptBytes, 'file-bytes', 'transcript'),
    verifyIntegrityEntry(manifest.integrity.chunkData, prepared.chunkBytes, 'file-bytes', 'chunkData'),
  ])
  if (manifest.integrity.marks === null) {
    if (prepared.marks.length || prepared.marksIntegrity !== null) {
      throw validationError('READER_SESSION_INTEGRITY_MISMATCH', 'marks resource existence does not match its manifest')
    }
  } else {
    if (prepared.marksIntegrity === null) {
      throw validationError('READER_SESSION_INTEGRITY_MISMATCH', 'marks integrity is missing from the response')
    }
    const responseEntry = normalizeMarksResponseIntegrity(prepared.marksIntegrity)
    if (canonicalJson(responseEntry) !== canonicalJson(manifest.integrity.marks)) {
      throw validationError('READER_SESSION_INTEGRITY_MISMATCH', 'reader marks response integrity does not match its manifest')
    }
    await verifyIntegrityEntry(manifest.integrity.marks, marksIntegrityBytes(prepared.marks), 'marks-fields.v1', 'marks')
  }
  const descriptorBytes = utf8(canonicalJson({ contentId, integrity: manifest.integrity }))
  const actualRevision = `sha256:${await sha256Hex(descriptorBytes)}`
  if (actualRevision !== revision) {
    throw validationError('READER_SESSION_REVISION_MISMATCH', 'reader session revision does not match its integrity descriptor')
  }
  return { contentId, revision, status: { status: 'verified' } }
}

function defaultHasCurrentContent() {
  const state = typeof window !== 'undefined' ? window.__state : null
  if (state && Array.isArray(state.segments) && state.segments.length) return true
  const audio = typeof document !== 'undefined' ? document.getElementById('audio-player') : null
  return !!(audio && audio.src)
}

export function createYoutubeWorkflowLoader(deps = {}) {
  const client = deps.client
  if (!client) throw new Error('youtube workflow loader requires a client')
  const hasCurrentContent = deps.hasCurrentContent || defaultHasCurrentContent
  const readerSessionPersistence = deps.readerSessionPersistence
  const annotationLightweightModule = deps.annotationLightweightModule || (typeof window !== 'undefined' ? window.__annotationLightweightModule : null)
  const sessionPublisher = deps.sessionPublisher
  let generation = 0
  let activeLoad = null
  let loadState = { status: 'idle', generation: 0, jobId: '', error: null }

  function getLoadState() {
    return {
      status: loadState.status,
      generation: loadState.generation,
      jobId: loadState.jobId,
      error: loadState.error ? { ...loadState.error } : null,
    }
  }

  function isCurrentLoad(load) {
    return activeLoad === load && generation === load.generation && !load.controller.signal.aborted
  }

  function supersededResult(load) {
    return { status: 'superseded', jobId: load.jobId, generation: load.generation }
  }

  function typedLoadError(error) {
    return {
      code: error && error.code ? String(error.code) : 'READER_SESSION_LOAD_FAILED',
      name: error && error.name ? String(error.name) : 'Error',
      message: error && error.message ? String(error.message) : String(error),
    }
  }

  function cancelLoad() {
    if (!activeLoad) return false
    const load = activeLoad
    load.controller.abort('reader session load canceled')
    activeLoad = null
    loadState = { status: 'aborted', generation: load.generation, jobId: load.jobId, error: null }
    return true
  }

  async function prepareReaderMarks(jobId, requestOptions) {
    if (!client || typeof client.getReaderMarks !== 'function') return { marks: [], integrity: null }
    const payload = await client.getReaderMarks(jobId, requestOptions)
    if (!payload || !Array.isArray(payload.marks)) throw new Error('reader marks response must contain marks')
    if (typeof payload.jobId === 'string' && payload.jobId && payload.jobId !== jobId) {
      throw validationError('READER_SESSION_IDENTITY_MISMATCH', 'reader marks jobId does not match the requested job')
    }
    if (typeof deps.onReaderMarksLoaded === 'function') {
      deps.onReaderMarksLoaded(payload)
    }
    return { marks: payload.marks, integrity: payload.integrity ?? null, revision: payload.revision ?? 0 }
  }

  async function prepareExpectedRevision() {
    if (typeof readerSessionPersistence.loadCommitted !== 'function') return null
    const current = await readerSessionPersistence.loadCommitted()
    return current?.status === 'committed' && typeof current.session?.revision === 'string'
      ? current.session.revision
      : null
  }

  async function commitLatestSession(load, session, requestOptions, expectedRevision) {
    return readerSessionPersistence.commit(session, { ...requestOptions, expectedRevision })
  }

  async function restoreAnnotationBackfillResult(jobId) {
    if (!client || typeof client.getAnnotationBackfillResult !== 'function') return { status: 'skipped', reason: 'missing-client-method' }
    if (!annotationLightweightModule || typeof annotationLightweightModule.importManualLightweightAnnotations !== 'function') {
      return { status: 'skipped', reason: 'missing-importer' }
    }

    try {
      const payload = await client.getAnnotationBackfillResult(jobId)
      const result = payload && payload.result ? payload.result : payload
      if (!result || !Array.isArray(result.items) || !result.items.length) {
        return { status: 'skipped', reason: 'empty-result' }
      }
      const importFile = createJsonFileLike(result, `${jobId}_annotation_backfill_result.json`)
      const imported = await annotationLightweightModule.importManualLightweightAnnotations(importFile, { replaceExisting: false })
      return { status: 'imported', imported }
    } catch (_err) {
      return { status: 'skipped', reason: 'unavailable' }
    }
  }

  async function loadJobIntoReader(jobId, options = {}) {
    const replacePolicy = options.replacePolicy || 'ask'
    if (replacePolicy !== 'replace-current' && hasCurrentContent()) {
      return { status: 'conflict', jobId }
    }
    if (!readerSessionPersistence || typeof readerSessionPersistence.commit !== 'function') {
      throw new Error('readerSessionPersistence is not available')
    }
    if (!sessionPublisher
      || typeof sessionPublisher.captureVisibleSession !== 'function'
      || typeof sessionPublisher.publishPreparedSession !== 'function'
      || typeof sessionPublisher.restoreVisibleSession !== 'function') {
      throw new Error('reader session publisher is not available')
    }

    if (activeLoad) activeLoad.controller.abort('superseded by a newer reader session load')
    const load = {
      jobId,
      generation: ++generation,
      controller: new AbortController(),
    }
    activeLoad = load
    loadState = { status: 'loading', generation: load.generation, jobId, error: null }

    try {
      const requestOptions = { signal: load.controller.signal }
      if (typeof client.mediaUrl !== 'function') throw new Error('workflow Range media URL is not available')
      if (typeof client.probeMediaRange !== 'function') throw new Error('workflow Range media probe is not available')
      const audioUrl = client.mediaUrl(jobId, 'audio')
      const [manifest, transcriptBlob, chunkBlob, marksPayload, , expectedRevision] = await Promise.all([
        client.getSession(jobId, requestOptions),
        client.getFile(jobId, 'transcript', requestOptions),
        client.getFile(jobId, 'chunkData', requestOptions),
        prepareReaderMarks(jobId, requestOptions),
        client.probeMediaRange(jobId, 'audio', requestOptions),
        prepareExpectedRevision(),
      ])
      if (!isCurrentLoad(load)) return supersededResult(load)
      const [transcriptPrepared, chunkPrepared] = await Promise.all([
        blobToJson(transcriptBlob, 'transcript'),
        blobToJson(chunkBlob, 'chunkData'),
      ])
      if (!isCurrentLoad(load)) return supersededResult(load)
      const validated = validateGeneratedSession({
        audioUrl,
        transcript: transcriptPrepared.value,
        chunkData: chunkPrepared.value,
        validateTranscriptData: deps.validateTranscriptData || (typeof window !== 'undefined' && window.DataUtils ? window.DataUtils.validateTranscriptData : null),
        validateChunkData: deps.validateChunkData || (typeof window !== 'undefined' && window.DataUtils ? window.DataUtils.validateChunkData : null)
      })
      const identity = await resolveReaderSessionIdentity(manifest, jobId, {
        transcriptBytes: transcriptPrepared.bytes,
        chunkBytes: chunkPrepared.bytes,
        marks: marksPayload.marks,
        marksIntegrity: marksPayload.integrity,
      })
      const normalizedMarks = normalizePreparedMarks(marksPayload.marks, validated.transcript)
      if (!isCurrentLoad(load)) return supersededResult(load)

      const title = manifest.title || `youtube-${jobId}`
      const manifestFiles = manifest && manifest.files && typeof manifest.files === 'object' ? manifest.files : {}
      const manifestMedia = manifest && manifest.media && typeof manifest.media === 'object' ? manifest.media : {}
      const hasVideo = !!manifestFiles.video
      const videoUrl = hasVideo ? client.mediaUrl(jobId, 'video') : ''
      const audioMeta = {
        name: `${title}.audio`,
        size: 0,
        lastModified: Date.now(),
        type: 'application/octet-stream',
        source: 'youtube-workflow',
        jobId,
        streamUrl: audioUrl,
        readerSessionIdentity: identity.status,
      }

      const { contentId, revision } = identity
      const preparedSession = {
        audioMeta,
        audioUrl,
        transcript: validated.transcript,
        chunkData: validated.chunkData,
        marks: normalizedMarks,
        contentId,
        revision,
        media: {
          jobId,
          title,
          hasVideo,
          videoUrl,
          videoSource: manifestMedia.videoSource || ''
        },
      }
      const visibleSnapshot = await sessionPublisher.captureVisibleSession()
      let committed = false
      try {
        await sessionPublisher.publishPreparedSession(preparedSession)
        if (!isCurrentLoad(load)) {
          await sessionPublisher.restoreVisibleSession(visibleSnapshot)
          return supersededResult(load)
        }
        await commitLatestSession(load, {
          contentId,
          revision,
          audioMeta,
          transcript: validated.transcript,
          chunkData: validated.chunkData,
          marks: normalizedMarks,
        }, requestOptions, expectedRevision)
        committed = true
      } catch (error) {
        if (!committed && isCurrentLoad(load)) {
          try {
            await sessionPublisher.restoreVisibleSession(visibleSnapshot)
          } catch (rollbackError) {
            const failure = new Error('reader session load failed and visible-session rollback failed', { cause: error })
            failure.name = 'ReaderSessionPublishRollbackError'
            failure.code = 'READER_SESSION_PUBLISH_ROLLBACK_FAILED'
            failure.rollbackError = rollbackError
            throw failure
          }
        }
        throw error
      }
      if (!isCurrentLoad(load)) return supersededResult(load)
      await restoreAnnotationBackfillResult(jobId)
      if (!isCurrentLoad(load)) return supersededResult(load)
      try {
        if (typeof deps.showToast === 'function') deps.showToast('YouTube result loaded', 'success')
      } catch (error) {
        if (typeof deps.onBestEffortError === 'function') {
          deps.onBestEffortError('reader-session-success-toast', error)
        }
      }
      loadState = { status: 'loaded', generation: load.generation, jobId, error: null }
      return { status: 'loaded', jobId, manifest, generation: load.generation, identity: identity.status }
    } catch (error) {
      if (!isCurrentLoad(load)) return supersededResult(load)
      loadState = {
        status: 'error',
        generation: load.generation,
        jobId,
        error: typedLoadError(error),
      }
      throw error
    } finally {
      if (activeLoad === load) activeLoad = null
    }
  }

  return { loadJobIntoReader, validateGeneratedSession, getLoadState, cancelLoad }
}
