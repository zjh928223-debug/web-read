const READER_SYNC_INTERVAL_MS = 15000

export function createReaderPlaybackTracker(options = {}) {
  const {
    getCurrentJobId = () => '',
    getReaderMedia = () => null,
    getMediaSource = () => null,
    ensureCurrentJobFromAudioMeta = () => {},
    onActivity = () => {},
    getCurrentMarkCount = () => 0,
  } = options

  const playback = new Map()
  let readerSessionId = ''
  let readerSessionStartedAt = ''
  let readerLastSyncAt = 0
  let playbackTrackedMedia = null
  let unsubscribeMediaSourceTracking = null

  function startReaderSession(job) {
    const jobId = job && job.jobId ? String(job.jobId) : ''
    if (!jobId) return
    readerSessionId = `${jobId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    readerSessionStartedAt = new Date().toISOString()
    readerLastSyncAt = 0
    if (!playback.has(jobId)) {
      playback.set(jobId, { intervals: [], lastTime: null, coverageRatio: 0, completed: false })
    }
  }

  function addPlaybackTrackingListeners(media) {
    if (!media || typeof media.addEventListener !== 'function') return
    media.addEventListener('timeupdate', handleTimeUpdate)
    media.addEventListener('play', handlePlay)
    media.addEventListener('pause', handlePause)
    media.addEventListener('seeking', handleSeeking)
    media.addEventListener('ended', handleEnded)
  }

  function removePlaybackTrackingListeners(media) {
    if (!media || typeof media.removeEventListener !== 'function') return
    media.removeEventListener('timeupdate', handleTimeUpdate)
    media.removeEventListener('play', handlePlay)
    media.removeEventListener('pause', handlePause)
    media.removeEventListener('seeking', handleSeeking)
    media.removeEventListener('ended', handleEnded)
  }

  function bindPlaybackTrackingTo(media) {
    if (!media || playbackTrackedMedia === media) return
    removePlaybackTrackingListeners(playbackTrackedMedia)
    playbackTrackedMedia = media
    addPlaybackTrackingListeners(playbackTrackedMedia)
  }

  function bindPlaybackTracking() {
    bindPlaybackTrackingTo(getReaderMedia())
    const mediaSource = getMediaSource()
    if (mediaSource && typeof mediaSource.subscribe === 'function' && !unsubscribeMediaSourceTracking) {
      unsubscribeMediaSourceTracking = mediaSource.subscribe(() => {
        bindPlaybackTrackingTo(getReaderMedia())
      })
    }
  }

  function unbindPlaybackTracking() {
    if (typeof unsubscribeMediaSourceTracking === 'function') {
      unsubscribeMediaSourceTracking()
      unsubscribeMediaSourceTracking = null
    }
    removePlaybackTrackingListeners(playbackTrackedMedia)
    playbackTrackedMedia = null
  }

  function getPlaybackState(jobId) {
    return playback.get(jobId)
  }

  function playbackState() {
    ensureCurrentJobFromAudioMeta()
    const jobId = getCurrentJobId()
    if (!jobId) return null
    if (!playback.has(jobId)) {
      playback.set(jobId, { intervals: [], lastTime: null, coverageRatio: 0, completed: false })
    }
    return playback.get(jobId)
  }

  function handlePlay() {
    const state = playbackState()
    const audio = getReaderMedia()
    if (state && audio) state.lastTime = audio.currentTime
    if (getCurrentJobId() && readerLastSyncAt === 0) {
      readerLastSyncAt = Date.now()
      onActivity('open')
    }
  }

  function handlePause() {
    const audio = getReaderMedia()
    if (audio && audio.ended) return
    onActivity('pause')
  }

  function handleSeeking() {
    const state = playbackState()
    if (state) state.lastTime = null
  }

  function handleTimeUpdate() {
    const state = playbackState()
    const audio = getReaderMedia()
    if (!state || !audio || audio.paused) return
    const current = audio.currentTime
    const previous = state.lastTime
    if (Number.isFinite(previous) && current > previous) {
      const maxNaturalDelta = Math.max(3, 2.5 * Number(audio.playbackRate || 1))
      if (current - previous <= maxNaturalDelta) {
        addInterval(state, previous, current)
        updateCoverage(state, audio.duration)
        scheduleReaderActivitySync()
      }
    }
    state.lastTime = current
  }

  function handleEnded() {
    const state = playbackState()
    const audio = getReaderMedia()
    if (!state || !audio) return
    updateCoverage(state, audio.duration)
    if (state.coverageRatio >= 0.7) state.completed = true
    onActivity('ended')
  }

  function addInterval(state, start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return
    state.intervals.push([start, end])
    state.intervals.sort((a, b) => a[0] - b[0])
    const merged = []
    for (const interval of state.intervals) {
      const last = merged[merged.length - 1]
      if (last && interval[0] <= last[1] + 0.25) last[1] = Math.max(last[1], interval[1])
      else merged.push(interval)
    }
    state.intervals = merged
  }

  function updateCoverage(state, duration) {
    if (!Number.isFinite(duration) || duration <= 0) return
    const covered = state.intervals.reduce((total, item) => total + Math.max(0, item[1] - item[0]), 0)
    state.coverageRatio = Math.max(0, Math.min(1, covered / duration))
  }

  function scheduleReaderActivitySync() {
    const now = Date.now()
    if (now - readerLastSyncAt < READER_SYNC_INTERVAL_MS) return
    readerLastSyncAt = now
    onActivity('progress')
  }

  function buildReaderActivityPayload(event) {
    const audio = getReaderMedia()
    const state = playbackState()
    const jobId = getCurrentJobId()
    if (!jobId) return null
    return {
      jobId,
      event,
      sessionId: readerSessionId || `${jobId}-session`,
      sessionStartedAt: readerSessionStartedAt || new Date().toISOString(),
      positionSeconds: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      durationSeconds: audio && Number.isFinite(audio.duration) ? audio.duration : 0,
      intervals: state && Array.isArray(state.intervals) ? state.intervals.map((item) => [item[0], item[1]]) : [],
      coverageRatio: state && Number.isFinite(state.coverageRatio) ? state.coverageRatio : 0,
      markCount: getCurrentMarkCount(),
    }
  }

  return Object.freeze({
    startReaderSession,
    getReaderSessionId: () => readerSessionId,
    getPlaybackState,
    buildReaderActivityPayload,
    bindPlaybackTracking,
    unbindPlaybackTracking,
  })
}
