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
  const text = await blob.text()
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${label} JSON parse failed: ${err && err.message ? err.message : err}`)
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
  const applyCurrentAudioMeta = deps.applyCurrentAudioMeta || function (meta) {
    if (typeof window !== 'undefined' && window.__state) window.__state.currentAudioMeta = meta
  }
  const processTranscript = deps.processTranscript || (typeof window !== 'undefined' ? window.processTranscript : null)
  const processChunkData = deps.processChunkData || (typeof window !== 'undefined' ? window.processChunkData : null)
  const annotationLightweightModule = deps.annotationLightweightModule || (typeof window !== 'undefined' ? window.__annotationLightweightModule : null)
  const resetChunkDisplay = typeof deps.resetChunkDisplay === 'function' ? deps.resetChunkDisplay : function () {}
  const mediaSource = deps.mediaSource || (typeof window !== 'undefined' ? window.__mediaSource : null)
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
      code: 'READER_SESSION_LOAD_FAILED',
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

  async function restoreReaderMarks(jobId) {
    if (!client || typeof client.getReaderMarks !== 'function') return
    if (typeof deps.applyReaderMarks !== 'function') return
    const payload = await client.getReaderMarks(jobId)
    const marks = payload && Array.isArray(payload.marks) ? payload.marks : []
    await deps.applyReaderMarks(marks)
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
    if (typeof processTranscript !== 'function') throw new Error('processTranscript is not available')
    if (typeof processChunkData !== 'function') throw new Error('processChunkData is not available')

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
      const manifest = await client.getSession(jobId, requestOptions)
      if (!isCurrentLoad(load)) return supersededResult(load)
      if (typeof client.mediaUrl !== 'function') throw new Error('workflow Range media URL is not available')
      const audioUrl = client.mediaUrl(jobId, 'audio')
      const [transcriptBlob, chunkBlob] = await Promise.all([
        client.getFile(jobId, 'transcript', requestOptions),
        client.getFile(jobId, 'chunkData', requestOptions),
      ])
      if (!isCurrentLoad(load)) return supersededResult(load)
      const [transcriptRaw, chunkRaw] = await Promise.all([
        blobToJson(transcriptBlob, 'transcript'),
        blobToJson(chunkBlob, 'chunkData'),
      ])
      if (!isCurrentLoad(load)) return supersededResult(load)
      const validated = validateGeneratedSession({
        audioUrl,
        transcript: transcriptRaw,
        chunkData: chunkRaw,
        validateTranscriptData: deps.validateTranscriptData || (typeof window !== 'undefined' && window.DataUtils ? window.DataUtils.validateTranscriptData : null),
        validateChunkData: deps.validateChunkData || (typeof window !== 'undefined' && window.DataUtils ? window.DataUtils.validateChunkData : null)
      })
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
      }

      const contentId = `youtube-workflow:${jobId}`
      const revision = `${contentId}:1`
      await readerSessionPersistence.commit({
        contentId,
        revision,
        audioMeta,
        transcript: validated.transcript,
        chunkData: validated.chunkData,
      })
      if (!isCurrentLoad(load)) return supersededResult(load)

      applyCurrentAudioMeta(audioMeta)
      const audioPlayer = deps.audioPlayer || (typeof document !== 'undefined' ? document.getElementById('audio-player') : null)
      if (audioPlayer) audioPlayer.src = audioUrl
      if (mediaSource && typeof mediaSource.setAudioElement === 'function') {
        mediaSource.setAudioElement(audioPlayer)
      }
      if (mediaSource && typeof mediaSource.loadJobMedia === 'function') {
        mediaSource.loadJobMedia({
          jobId,
          title,
          hasVideo,
          videoUrl,
          videoSource: manifestMedia.videoSource || ''
        })
      }
      processTranscript(validated.transcript)
      processChunkData(validated.chunkData)
      if (!isCurrentLoad(load)) return supersededResult(load)
      await restoreReaderMarks(jobId)
      if (!isCurrentLoad(load)) return supersededResult(load)
      await restoreAnnotationBackfillResult(jobId)
      if (!isCurrentLoad(load)) return supersededResult(load)
      resetChunkDisplay()
      if (typeof deps.showToast === 'function') deps.showToast('YouTube result loaded', 'success')
      loadState = { status: 'loaded', generation: load.generation, jobId, error: null }
      return { status: 'loaded', jobId, manifest, generation: load.generation }
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
