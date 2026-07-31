export const REQUIRED_ARIA_SYSTEM_VOICE = 'Microsoft Aria Online (Natural) - English (United States)'
export const REQUIRED_ARIA_EDGE_VOICE = 'en-US-AriaNeural'
const DEFAULT_LOCAL_TTS_BASE_URL = 'http://127.0.0.1:8765'

export function createAriaAmericanPronunciationService(options = {}) {
  const windowObject = options.windowObject || globalThis.window
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const localTtsBaseUrl = resolveLocalTtsBaseUrl(options.localTtsBaseUrl, windowObject)
  let activeAudio = null
  let activeRequest = null

  async function speak(value) {
    const text = String(value || '').trim()
    if (!text) return { source: 'none' }
    stop()
    const controller = new AbortController()
    activeRequest = controller

    try {
      const systemVoice = await resolveRequiredSystemVoice(windowObject, options.voiceWaitMs, controller.signal)
      throwIfAborted(controller.signal)
      if (systemVoice) {
        await speakWithSystemVoice(windowObject, systemVoice, text, controller.signal)
        return { source: 'system', voice: REQUIRED_ARIA_SYSTEM_VOICE }
      }

      const edgeResult = await fetchRequiredEdgeAudio(fetchImpl, localTtsBaseUrl, text, controller.signal)
      throwIfAborted(controller.signal)
      if (!edgeResult) throw createUnavailableError()
      const audioFactory = options.audioFactory || ((url) => new windowObject.Audio(url))
      activeAudio = audioFactory(edgeResult.audioUrl)
      const audio = activeAudio
      try {
        await audio.play()
        await waitForAudioCompletion(audio, controller.signal)
      } catch (_error) {
        if (activeAudio === audio) activeAudio = null
        if (controller.signal.aborted || _error?.name === 'AbortError') throw createAbortError()
        throw createUnavailableError()
      }
      throwIfAborted(controller.signal)
      if (activeAudio === audio) activeAudio = null
      return { source: 'local-tts', voice: REQUIRED_ARIA_EDGE_VOICE }
    } finally {
      if (activeRequest === controller) activeRequest = null
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

  return { speak, stop }
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

function speakWithSystemVoice(windowObject, voice, text, signal) {
  return new Promise((resolve, reject) => {
    const utterance = new windowObject.SpeechSynthesisUtterance(text)
    utterance.voice = voice
    utterance.lang = 'en-US'
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
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
