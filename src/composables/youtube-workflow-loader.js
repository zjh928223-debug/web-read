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

function validateGeneratedSession({ audioBlob, transcript, chunkData, validateTranscriptData, validateChunkData }) {
  if (!audioBlob || !Number.isFinite(Number(audioBlob.size)) || Number(audioBlob.size) <= 0) {
    throw new Error('audio file is missing or empty')
  }
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
  const saveToDB = deps.saveToDB || (typeof window !== 'undefined' ? window.saveToDB : null)
  const applyCurrentAudioMeta = deps.applyCurrentAudioMeta || function (meta) {
    if (typeof window !== 'undefined' && window.__state) window.__state.currentAudioMeta = meta
  }
  const processTranscript = deps.processTranscript || (typeof window !== 'undefined' ? window.processTranscript : null)
  const processChunkData = deps.processChunkData || (typeof window !== 'undefined' ? window.processChunkData : null)
  const resetChunkDisplay = typeof deps.resetChunkDisplay === 'function' ? deps.resetChunkDisplay : function () {}
  const createObjectURL = deps.createObjectURL || (typeof URL !== 'undefined' ? URL.createObjectURL.bind(URL) : null)

  async function loadJobIntoReader(jobId, options = {}) {
    const replacePolicy = options.replacePolicy || 'ask'
    if (replacePolicy !== 'replace-current' && hasCurrentContent()) {
      return { status: 'conflict', jobId }
    }
    if (typeof saveToDB !== 'function') throw new Error('saveToDB is not available')
    if (typeof processTranscript !== 'function') throw new Error('processTranscript is not available')
    if (typeof processChunkData !== 'function') throw new Error('processChunkData is not available')

    const manifest = await client.getSession(jobId)
    const audioBlob = await client.getFile(jobId, 'audio')
    const transcriptBlob = await client.getFile(jobId, 'transcript')
    const chunkBlob = await client.getFile(jobId, 'chunkData')
    const transcriptRaw = await blobToJson(transcriptBlob, 'transcript')
    const chunkRaw = await blobToJson(chunkBlob, 'chunkData')
    const validated = validateGeneratedSession({
      audioBlob,
      transcript: transcriptRaw,
      chunkData: chunkRaw,
      validateTranscriptData: deps.validateTranscriptData || (typeof window !== 'undefined' && window.DataUtils ? window.DataUtils.validateTranscriptData : null),
      validateChunkData: deps.validateChunkData || (typeof window !== 'undefined' && window.DataUtils ? window.DataUtils.validateChunkData : null)
    })

    const title = manifest.title || `youtube-${jobId}`
    const audioMeta = {
      name: `${title}.audio`,
      size: audioBlob.size || 0,
      lastModified: Date.now(),
      type: audioBlob.type || 'application/octet-stream',
      source: 'youtube-workflow',
      jobId
    }

    await Promise.resolve(saveToDB('audio', audioBlob))
    applyCurrentAudioMeta(audioMeta)
    await Promise.resolve(saveToDB('audioMeta', audioMeta))
    await Promise.resolve(saveToDB('transcript', validated.transcript))
    await Promise.resolve(saveToDB('chunkData', validated.chunkData))

    const audioPlayer = deps.audioPlayer || (typeof document !== 'undefined' ? document.getElementById('audio-player') : null)
    if (audioPlayer && createObjectURL) audioPlayer.src = createObjectURL(audioBlob)
    processTranscript(validated.transcript)
    if (typeof deps.switchSentenceNotesDoc === 'function') {
      await deps.switchSentenceNotesDoc(validated.transcript)
    }
    processChunkData(validated.chunkData)
    resetChunkDisplay()
    if (typeof deps.showToast === 'function') deps.showToast('YouTube result loaded', 'success')
    return { status: 'loaded', jobId, manifest }
  }

  return { loadJobIntoReader, validateGeneratedSession }
}
