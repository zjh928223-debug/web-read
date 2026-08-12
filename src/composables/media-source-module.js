(function () {
  var PREFERENCE_KEY = 'youtubeWorkflow.videoPreferred'
  var WINDOW_KEY = 'youtubeWorkflowVideoWindow'
  var DEFAULT_WINDOW_WIDTH = 360

  function defaultVideoWindow() {
    var viewportWidth = typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280
    var viewportHeight = typeof window !== 'undefined' ? window.innerHeight || 720 : 720
    return {
      x: Math.max(24, viewportWidth - DEFAULT_WINDOW_WIDTH - 24),
      y: Math.max(180, Math.min(320, viewportHeight - 270)),
      width: DEFAULT_WINDOW_WIDTH,
      aspectRatio: 16 / 9,
      minimized: false
    }
  }

  var listeners = new Set()
  var audioElement = null
  var videoElement = null

  function readBool(key, fallback) {
    try {
      var value = window.localStorage.getItem(key)
      if (value === 'true') return true
      if (value === 'false') return false
    } catch (_err) {}
    return fallback
  }

  function readWindowState() {
    try {
      var raw = window.localStorage.getItem(WINDOW_KEY)
      if (raw) {
        var parsed = JSON.parse(raw)
        var next = Object.assign({}, defaultVideoWindow(), parsed || {})
        // The previous default was top-right (y=24), which covered the reader toolbar.
        // Migrate that untouched position once while preserving deliberately moved windows.
        if (parsed && Number(parsed.y) <= 24) next.y = defaultVideoWindow().y
        return next
      }
    } catch (_err) {}
    return Object.assign({}, defaultVideoWindow())
  }

  var state = {
    videoPreferred: readBool(PREFERENCE_KEY, false),
    videoAvailable: false,
    videoUrl: '',
    videoTitle: '',
    videoSource: '',
    jobId: '',
    activeKind: 'audio',
    notice: '',
    window: readWindowState()
  }

  function savePreference() {
    try { window.localStorage.setItem(PREFERENCE_KEY, state.videoPreferred ? 'true' : 'false') } catch (_err) {}
  }

  function saveWindowState() {
    try { window.localStorage.setItem(WINDOW_KEY, JSON.stringify(state.window)) } catch (_err) {}
  }

  function snapshot() {
    return Object.assign({}, state, { window: Object.assign({}, state.window) })
  }

  function emit() {
    var next = snapshot()
    listeners.forEach(function (listener) {
      try { listener(next) } catch (_err) {}
    })
  }

  function getFallbackAudio(fallback) {
    if (audioElement) return audioElement
    if (fallback && fallback.__isActiveMediaProxy) fallback = null
    if (fallback && typeof fallback.addEventListener === 'function') {
      audioElement = fallback
      return audioElement
    }
    audioElement = document.getElementById('audio-player')
    return audioElement
  }

  function syncMediaProps(from, to) {
    if (!from || !to || from === to) return
    try {
      if (Number.isFinite(from.currentTime)) to.currentTime = from.currentTime || 0
    } catch (_err) {}
    try { to.playbackRate = from.playbackRate || 1 } catch (_err) {}
    try { to.volume = from.volume } catch (_err) {}
    try { to.muted = from.muted } catch (_err) {}
  }

  function setAudioInactive(inactive) {
    var audio = getFallbackAudio()
    if (!audio || !audio.classList) return
    audio.classList.toggle('video-media-active', !!inactive)
    audio.dataset.mediaKind = inactive ? 'inactive-audio' : 'audio'
  }

  function ensureVideoSource() {
    if (!videoElement) return
    if (state.videoUrl) {
      if (videoElement.src !== state.videoUrl) {
        videoElement.src = state.videoUrl
        videoElement.preload = 'metadata'
      }
    } else {
      videoElement.removeAttribute('src')
      try { videoElement.load() } catch (_err) {}
    }
  }

  function getActiveMediaElement(fallback) {
    if (state.activeKind === 'video' && videoElement && state.videoAvailable) return videoElement
    return getFallbackAudio(fallback)
  }

  function pauseElement(element) {
    if (!element || typeof element.pause !== 'function') return
    try { element.pause() } catch (_err) {}
  }

  function playElement(element) {
    if (!element || typeof element.play !== 'function') return null
    try {
      var result = element.play()
      if (result && typeof result.catch === 'function') result.catch(function () {})
      return result
    } catch (_err) {
      return null
    }
  }

  function getInactiveMediaElement(fallback) {
    var active = getActiveMediaElement(fallback)
    return active === videoElement ? getFallbackAudio(fallback) : videoElement
  }

  function pauseInactiveMedia(fallback) {
    pauseElement(getInactiveMediaElement(fallback))
  }

  function pauseAllMedia(fallback) {
    pauseElement(videoElement)
    pauseElement(getFallbackAudio(fallback))
  }

  function switchTo(kind) {
    var nextKind = kind === 'video' && state.videoAvailable && videoElement ? 'video' : 'audio'
    var previous = getActiveMediaElement()
    var next = nextKind === 'video' ? videoElement : getFallbackAudio()
    var wasPlaying = previous && previous !== next && previous.paused === false
    if (previous && next && previous !== next) {
      syncMediaProps(previous, next)
      pauseElement(previous)
    }
    state.activeKind = nextKind
    setAudioInactive(nextKind === 'video')
    if (wasPlaying) playElement(next)
    emit()
  }

  function setVideoPreferred(value) {
    state.videoPreferred = !!value
    savePreference()
    if (state.videoPreferred) {
      if (state.videoAvailable && state.videoUrl) {
        state.notice = ''
        ensureVideoSource()
        switchTo('video')
      } else {
        state.notice = '找不到视频源，已回退音频'
        switchTo('audio')
      }
    } else {
      state.notice = ''
      switchTo('audio')
    }
    emit()
  }

  function loadJobMedia(payload) {
    var source = payload || {}
    state.jobId = String(source.jobId || '')
    state.videoTitle = String(source.title || source.videoTitle || '')
    state.videoSource = String(source.videoSource || '')
    state.videoUrl = String(source.videoUrl || '')
    state.videoAvailable = !!(source.hasVideo && state.videoUrl)
    if (!state.videoAvailable) {
      state.notice = state.videoPreferred ? '找不到视频源，已回退音频' : ''
      state.videoUrl = ''
      switchTo('audio')
    } else if (state.videoPreferred) {
      state.notice = ''
      ensureVideoSource()
      switchTo('video')
    } else {
      state.notice = ''
      ensureVideoSource()
      switchTo('audio')
    }
    emit()
  }

  function setVideoElement(element) {
    videoElement = element || null
    ensureVideoSource()
    if (state.videoPreferred && state.videoAvailable) switchTo('video')
    else setAudioInactive(false)
    emit()
  }

  function setAudioElement(element) {
    if (element && element.__isActiveMediaProxy) return
    if (element && typeof element.addEventListener === 'function') audioElement = element
    setAudioInactive(state.activeKind === 'video')
    emit()
  }

  function seekActive(time) {
    var value = Number(time)
    if (!Number.isFinite(value)) return
    var active = getActiveMediaElement()
    var inactive = active === videoElement ? getFallbackAudio() : videoElement
    pauseInactiveMedia()
    if (active === videoElement) ensureVideoSource()
    try { if (active) active.currentTime = value } catch (_err) {}
    try { if (inactive && inactive.src) inactive.currentTime = value } catch (_err) {}
  }

  function createActiveMediaProxy(fallback) {
    if (fallback && fallback.__isActiveMediaProxy) return fallback
    setAudioElement(fallback)
    return {
      __isActiveMediaProxy: true,
      get currentTime() {
        var media = getActiveMediaElement(fallback)
        return media ? media.currentTime : 0
      },
      set currentTime(value) {
        seekActive(value)
      },
      get paused() {
        var media = getActiveMediaElement(fallback)
        return media ? media.paused : true
      },
      get playbackRate() {
        var media = getActiveMediaElement(fallback)
        return media ? media.playbackRate : 1
      },
      set playbackRate(value) {
        var rate = Number(value)
        if (!Number.isFinite(rate) || rate <= 0) return
        var audio = getFallbackAudio(fallback)
        if (audio) audio.playbackRate = rate
        if (videoElement) videoElement.playbackRate = rate
      },
      get volume() {
        var media = getActiveMediaElement(fallback)
        return media ? media.volume : 1
      },
      set volume(value) {
        var media = getActiveMediaElement(fallback)
        if (media) media.volume = value
      },
      play: function () {
        var media = getActiveMediaElement(fallback)
        pauseInactiveMedia(fallback)
        return playElement(media)
      },
      pause: function () {
        return pauseAllMedia(fallback)
      }
    }
  }

  function setVideoWindow(patch) {
    var next = Object.assign({}, state.window, patch || {})
    var fallbackWindow = defaultVideoWindow()
    next.width = Math.max(260, Math.min(760, Number(next.width) || fallbackWindow.width))
    next.aspectRatio = Math.max(1, Math.min(2.4, Number(next.aspectRatio) || fallbackWindow.aspectRatio))
    next.x = Math.max(0, Number(next.x) || 0)
    next.y = Math.max(0, Number(next.y) || 0)
    next.minimized = !!next.minimized
    state.window = next
    saveWindowState()
    emit()
  }

  function closeVideo() {
    setVideoPreferred(false)
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {}
    listeners.add(listener)
    listener(snapshot())
    return function () { listeners.delete(listener) }
  }

  window.__mediaSource = {
    getState: snapshot,
    subscribe: subscribe,
    setAudioElement: setAudioElement,
    setVideoElement: setVideoElement,
    getActiveMediaElement: getActiveMediaElement,
    createActiveMediaProxy: createActiveMediaProxy,
    setVideoPreferred: setVideoPreferred,
    loadJobMedia: loadJobMedia,
    setVideoWindow: setVideoWindow,
    closeVideo: closeVideo,
    switchToAudio: function () { setVideoPreferred(false) },
    seekActive: seekActive
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setAudioElement(document.getElementById('audio-player')) }, { once: true })
  } else {
    setAudioElement(document.getElementById('audio-player'))
  }
}())
