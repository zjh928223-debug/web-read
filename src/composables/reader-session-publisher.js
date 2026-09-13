function cloneValue(value) {
  if (value == null || typeof value !== 'object') return value
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value) } catch (_error) {}
  }
  return JSON.parse(JSON.stringify(value))
}

const STATE_FIELDS = [
  'segments', 'words', 'wordStarts', 'currentWordIndex',
  'chunkItems', 'hasAiChunkData', 'isChunkMode', 'chunkCnVisible',
  'chunkCnHoldMode', 'isChunkShadowOn', 'chunkCnMode', 'manualChunkStates',
  'lastActiveChunkIndex', 'lastAiPrevTapChunkIndex', 'lastAiPrevTapAt',
]

function captureState(state) {
  const fields = {}
  STATE_FIELDS.forEach((field) => { fields[field] = cloneValue(state?.[field]) })
  return {
    fields,
    currentAudioMeta: cloneValue(state?.currentAudioMeta),
    currentAudioKey: state?.currentAudioKey,
    marks: state?.markedMap instanceof Map
      ? Array.from(state.markedMap.entries()).map(([key, value]) => [key, cloneValue(value)])
      : [],
  }
}

function captureAudio(audioPlayer) {
  if (!audioPlayer) return null
  return {
    src: typeof audioPlayer.getAttribute === 'function' ? audioPlayer.getAttribute('src') : (audioPlayer.src || ''),
    currentTime: Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0,
    playbackRate: Number.isFinite(audioPlayer.playbackRate) ? audioPlayer.playbackRate : 1,
    volume: Number.isFinite(audioPlayer.volume) ? audioPlayer.volume : 1,
    muted: !!audioPlayer.muted,
  }
}

function restoreAudio(audioPlayer, snapshot) {
  if (!audioPlayer || !snapshot) return
  if (snapshot.src) audioPlayer.src = snapshot.src
  else if (typeof audioPlayer.removeAttribute === 'function') audioPlayer.removeAttribute('src')
  else audioPlayer.src = ''
  audioPlayer.currentTime = snapshot.currentTime
  audioPlayer.playbackRate = snapshot.playbackRate
  audioPlayer.volume = snapshot.volume
  audioPlayer.muted = snapshot.muted
}

export function createReaderSessionPublisher(deps = {}) {
  const state = deps.state
  const audioPlayer = deps.audioPlayer
  const mediaSource = deps.mediaSource

  function captureVisibleSession() {
    return {
      state: captureState(state),
      audio: captureAudio(audioPlayer),
      media: mediaSource && typeof mediaSource.getState === 'function' ? cloneValue(mediaSource.getState()) : null,
    }
  }

  async function restoreVisibleSession(snapshot) {
    const oldState = snapshot.state
    if (typeof deps.applyCurrentAudioMeta === 'function') deps.applyCurrentAudioMeta(oldState.currentAudioMeta)
    if (state) {
      STATE_FIELDS.forEach((field) => { state[field] = cloneValue(oldState.fields[field]) })
      state.currentAudioKey = oldState.currentAudioKey
      state.markedMap = new Map(oldState.marks.map(([key, value]) => [key, cloneValue(value)]))
    }
    restoreAudio(audioPlayer, snapshot.audio)
    if (mediaSource && snapshot.media) {
      if (typeof mediaSource.loadJobMedia === 'function') {
        mediaSource.loadJobMedia({
          jobId: snapshot.media.jobId,
          title: snapshot.media.videoTitle,
          videoSource: snapshot.media.videoSource,
          videoUrl: snapshot.media.videoUrl,
          hasVideo: snapshot.media.videoAvailable,
        })
      }
      if (typeof mediaSource.setVideoPreferred === 'function') mediaSource.setVideoPreferred(snapshot.media.videoPreferred)
      if (typeof mediaSource.setVideoWindow === 'function' && snapshot.media.window) mediaSource.setVideoWindow(snapshot.media.window)
    }
    if (typeof deps.syncReaderMarksVisuals === 'function') deps.syncReaderMarksVisuals(Array.from(state?.markedMap?.values?.() || []))
    if (typeof deps.bridgeToPinia === 'function') deps.bridgeToPinia()
  }

  async function publishPreparedSession(prepared) {
    deps.applyCurrentAudioMeta(prepared.audioMeta)
    if (audioPlayer) audioPlayer.src = prepared.audioUrl
    if (mediaSource && typeof mediaSource.setAudioElement === 'function') mediaSource.setAudioElement(audioPlayer)
    if (mediaSource && typeof mediaSource.loadJobMedia === 'function') mediaSource.loadJobMedia(prepared.media)
    deps.processTranscript(prepared.transcript)
    if (typeof deps.scheduleGeneratedAnnotationIndexRefresh === 'function') {
      deps.scheduleGeneratedAnnotationIndexRefresh()
    }
    deps.processChunkData(prepared.chunkData)
    if (typeof deps.applyReaderMarks === 'function') {
      await deps.applyReaderMarks(prepared.marks, {
        jobId: prepared.audioMeta?.jobId || '',
        persist: false,
        contentId: prepared.contentId,
        revision: prepared.marksRevision,
      })
    }
    if (typeof deps.resetChunkDisplay === 'function') deps.resetChunkDisplay()
    return { status: 'published' }
  }

  return { publishPreparedSession, captureVisibleSession, restoreVisibleSession }
}
