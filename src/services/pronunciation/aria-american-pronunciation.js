export const REQUIRED_ARIA_SYSTEM_VOICE = 'Microsoft Aria Online (Natural) - English (United States)'
export const REQUIRED_ARIA_EDGE_VOICE = 'en-US-AriaNeural'
const DEFAULT_LOCAL_TTS_BASE_URL = 'http://127.0.0.1:8765'
const PREFETCH_CONCURRENCY = 4
const AUDIO_READY_TIMEOUT_MS = 8000

export function createAriaAmericanPronunciationService(options = {}) {
  const windowObject = options.windowObject || globalThis.window
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const localTtsBaseUrl = resolveLocalTtsBaseUrl(options.localTtsBaseUrl, windowObject)
  const preferLocalTts = options.preferLocalTts === true
  const audioCache = new Map()
  const pendingAudio = new Map()
  const pendingAudioControllers = new Map()
  let activeAudio = null
  let activeRequest = null

  async function speak(value) {
    const text = normalizePronunciationText(value)
    if (!text) return { source: 'none' }
    stop()
    const controller = new AbortController()
    activeRequest = controller

    try {
      let systemVoice = null
      let systemAttempted = false
      const trySystemVoice = async () => {
        if (systemAttempted) return false
        systemAttempted = true
        systemVoice = await resolveRequiredSystemVoice(windowObject, options.voiceWaitMs, controller.signal)
        throwIfAborted(controller.signal)
        if (!systemVoice) return false
        try {
          await speakWithSystemVoice(
            windowObject,
            systemVoice,
            text,
            controller.signal,
            options.systemVoiceTimeoutMs,
          )
          return true
        } catch (error) {
          if (controller.signal.aborted || error?.name === 'AbortError') throw createAbortError()
          windowObject?.speechSynthesis?.cancel?.()
          return false
        }
      }

      const tryEdgeTts = async () => {
        const entry = await getOrCreateEdgeAudio(text, controller.signal)
        throwIfAborted(controller.signal)
        if (!entry) return false
        activeAudio = entry.audio
        const audio = activeAudio
        try {
          audio.currentTime = 0
          await audio.play()
          await waitForAudioCompletion(audio, controller.signal)
        } catch (error) {
          if (activeAudio === audio) activeAudio = null
          if (controller.signal.aborted || error?.name === 'AbortError') throw createAbortError()
          if (audioCache.get(text) === entry) audioCache.delete(text)
          return false
        }
        throwIfAborted(controller.signal)
        if (activeAudio === audio) activeAudio = null
        return true
      }

      if (!preferLocalTts && await trySystemVoice()) {
        return { source: 'system', voice: REQUIRED_ARIA_SYSTEM_VOICE }
      }
      if (await tryEdgeTts()) {
        return { source: 'local-tts', voice: REQUIRED_ARIA_EDGE_VOICE }
      }
      if (preferLocalTts && await trySystemVoice()) {
        return { source: 'system', voice: REQUIRED_ARIA_SYSTEM_VOICE }
      }
      throw createUnavailableError()
    } finally {
      if (activeRequest === controller) activeRequest = null
    }
  }

  async function prefetch(values) {
    const texts = Array.from(new Set((Array.isArray(values) ? values : [values])
      .map((value) => normalizePronunciationText(value))
      .filter(Boolean)))
    if (!texts.length) return { requested: 0, prefetched: 0 }
    if (!preferLocalTts && hasExactSystemVoice(windowObject)) {
      return { requested: texts.length, prefetched: 0, source: 'system' }
    }

    let cursor = 0
    let prefetched = 0
    const worker = async () => {
      while (cursor < texts.length) {
        const text = texts[cursor]
        cursor += 1
        try {
          const entry = await getOrCreateEdgeAudio(text, undefined, { waitForReady: true })
          if (entry) prefetched += 1
        } catch (_error) {
          // A failed warm-up remains retryable on the next manual click.
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, texts.length) }, worker))
    return { requested: texts.length, prefetched }
  }

  async function getOrCreateEdgeAudio(text, signal, { waitForReady = false } = {}) {
    const normalizedText = normalizePronunciationText(text)
    if (!normalizedText) return null
    const cached = audioCache.get(normalizedText)
    if (cached) return waitForAbort(Promise.resolve(cached), signal)

    const pending = pendingAudio.get(normalizedText)
    if (pending) {
      if (!signal) return waitForAbort(pending, signal)
      // Manual playback has priority over the low-priority warm-up started
      // when the dialog opens. Abort the warm-up instead of waiting behind it.
      pendingAudioControllers.get(normalizedText)?.abort()
      pendingAudio.delete(normalizedText)
      pendingAudioControllers.delete(normalizedText)
    }

    const backgroundController = signal ? null : new AbortController()
    const requestSignal = signal || backgroundController.signal

    const request = (async () => {
      const edgeResult = await fetchRequiredEdgeAudio(
        fetchImpl,
        localTtsBaseUrl,
        normalizedText,
        requestSignal,
      )
      throwIfAborted(requestSignal)
      if (!edgeResult) return null
      const audioFactory = options.audioFactory || ((url) => new windowObject.Audio(url))
      const audio = audioFactory(edgeResult.audioUrl)
      try {
        audio.preload = 'auto'
        audio.load?.()
      } catch (_error) {}
      if (waitForReady) await waitForAudioReady(audio, requestSignal)
      return { audioUrl: edgeResult.audioUrl, audio }
    })()
    pendingAudio.set(normalizedText, request)
    if (backgroundController) pendingAudioControllers.set(normalizedText, backgroundController)
    try {
      const entry = await request
      if (entry) audioCache.set(normalizedText, entry)
      return entry
    } finally {
      if (pendingAudio.get(normalizedText) === request) {
        pendingAudio.delete(normalizedText)
        pendingAudioControllers.delete(normalizedText)
      }
    }
  }

  function stop() {
    activeRequest?.abort()
    activeRequest = null
    windowObject?.speechSynthesis?.cancel?.()
    if (activeAudio) {
      activeAudio.pause?.()
      activeAudio.currentTime = 0
      activeAudio = null
    }
  }

  return { speak, stop, prefetch }
}

function normalizePronunciationText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function hasExactSystemVoice(windowObject) {
  const voices = windowObject?.speechSynthesis?.getVoices?.()
  return !!findRequiredAriaSystemVoice(voices)
}

function waitForAbort(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(createAbortError())
  return new Promise((resolve, reject) => {
    const abort = () => reject(createAbortError())
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

function waitForAudioReady(audio, signal, timeoutMs = AUDIO_READY_TIMEOUT_MS) {
  if (!audio || typeof audio.addEventListener !== 'function' || Number(audio.readyState) >= 3) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    let timer = null
    let settled = false
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer)
      audio.removeEventListener?.('canplay', ready)
      audio.removeEventListener?.('canplaythrough', ready)
      audio.removeEventListener?.('loadeddata', ready)
      audio.removeEventListener?.('error', failed)
      signal?.removeEventListener('abort', aborted)
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const ready = () => finish(resolve)
    const failed = () => finish(reject, createUnavailableError())
    const aborted = () => finish(reject, createAbortError())
    audio.addEventListener('canplay', ready, { once: true })
    audio.addEventListener('canplaythrough', ready, { once: true })
    audio.addEventListener('loadeddata', ready, { once: true })
    audio.addEventListener('error', failed, { once: true })
    signal?.addEventListener('abort', aborted, { once: true })
    timer = setTimeout(ready, Math.max(0, Number(timeoutMs) || 0))
  })
}

function waitForAudioCompletion(audio, signal) {
  if (typeof audio?.addEventListener !== 'function') return Promise.resolve()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      audio.removeEventListener?.('ended', ended)
      audio.removeEventListener?.('error', failed)
      signal?.removeEventListener('abort', aborted)
      callback(value)
    }
    const ended = () => finish(resolve)
    const failed = () => finish(reject, createUnavailableError())
    const aborted = () => finish(reject, createAbortError())
    audio.addEventListener('ended', ended, { once: true })
    audio.addEventListener('error', failed, { once: true })
    signal?.addEventListener('abort', aborted, { once: true })
  })
}

export function findRequiredAriaSystemVoice(voices) {
  return (Array.isArray(voices) ? voices : [])
    .find((voice) => String(voice?.name || '').trim() === REQUIRED_ARIA_SYSTEM_VOICE) || null
}

async function resolveRequiredSystemVoice(windowObject, waitMs = 300, signal) {
  throwIfAborted(signal)
  const synthesis = windowObject?.speechSynthesis
  if (!synthesis || typeof windowObject?.SpeechSynthesisUtterance !== 'function') return null
  const immediate = findRequiredAriaSystemVoice(synthesis.getVoices?.())
  if (immediate || !synthesis.addEventListener) return immediate

  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    const finish = () => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      synthesis.removeEventListener?.('voiceschanged', finish)
      signal?.removeEventListener('abort', abort)
      resolve(findRequiredAriaSystemVoice(synthesis.getVoices?.()))
    }
    const abort = () => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      synthesis.removeEventListener?.('voiceschanged', finish)
      reject(createAbortError())
    }
    synthesis.addEventListener('voiceschanged', finish, { once: true })
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(finish, Math.max(0, Number(waitMs) || 0))
  })
}

function speakWithSystemVoice(windowObject, voice, text, signal, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const utterance = new windowObject.SpeechSynthesisUtterance(text)
    utterance.voice = voice
    utterance.lang = 'en-US'
    let settled = false
    let timer = null
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      callback(value)
    }
    const abort = () => {
      windowObject.speechSynthesis.cancel()
      finish(reject, createAbortError())
    }
    utterance.onend = () => finish(resolve)
    utterance.onerror = () => finish(reject, createUnavailableError())
    signal?.addEventListener('abort', abort, { once: true })
    windowObject.speechSynthesis.speak(utterance)
    const normalizedTimeout = Math.max(0, Number(timeoutMs) || 0)
    if (normalizedTimeout > 0) {
      timer = setTimeout(() => {
        windowObject.speechSynthesis.cancel()
        finish(reject, createUnavailableError())
      }, normalizedTimeout)
    }
  })
}

async function fetchRequiredEdgeAudio(fetchImpl, baseUrl, text, signal) {
  if (typeof fetchImpl !== 'function') return null
  try {
    const response = await fetchImpl(`${baseUrl}/api/tts/edge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    })
    if (!response.ok) return null
    const payload = await response.json()
    if (payload?.voice !== REQUIRED_ARIA_EDGE_VOICE) return null
    const audioUrl = normalizeLocalTtsAudioUrl(payload?.audioUrl, baseUrl)
    return audioUrl ? { audioUrl } : null
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw createAbortError()
    return null
  }
}

function normalizeLocalTtsAudioUrl(value, baseUrl) {
  try {
    const serviceUrl = new URL(`${baseUrl}/`)
    const url = new URL(String(value || ''), serviceUrl)
    if (url.origin !== serviceUrl.origin) return ''
    if (!/^\/api\/tts\/edge\/audio\/[a-f0-9]{64}\.mp3$/i.test(url.pathname)) return ''
    return url.href
  } catch (_error) {
    return ''
  }
}

function createUnavailableError() {
  const error = new Error('Aria美式发音暂不可用')
  error.code = 'ARIA_PRONUNCIATION_UNAVAILABLE'
  return error
}

function resolveLocalTtsBaseUrl(value, windowObject) {
  const candidate = value ?? windowObject?.location?.origin ?? DEFAULT_LOCAL_TTS_BASE_URL
  return String(candidate).replace(/\/+$/, '')
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError()
}

function createAbortError() {
  const error = new Error('Pronunciation request aborted')
  error.name = 'AbortError'
  return error
}
