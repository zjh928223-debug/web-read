const pronunciationCache = new Map()
const pronunciationSequenceCache = new Map()
const DEFAULT_MERRIAM_BASE_URL = import.meta.env?.VITE_LOCAL_SERVICE_BASE_URL
  || 'http://127.0.0.1:8765'
const REQUIRED_PHRASE_EDGE_VOICE = 'en-US-AriaNeural'

export async function resolveAmericanPronunciation(word, options = {}) {
  const lookup = String(word || '').trim().toLowerCase()
  if (!lookup) return ''
  if (pronunciationCache.has(lookup)) return pronunciationCache.get(lookup)

  const request = fetchAmericanPronunciation(lookup, options)
  pronunciationCache.set(lookup, request)
  try {
    return await request
  } catch (_error) {
    pronunciationCache.delete(lookup)
    return ''
  }
}

export async function resolveAmericanPronunciationSequence(value, options = {}) {
  const lookup = String(value || '').trim().toLowerCase()
  if (!lookup) return []
  if (pronunciationSequenceCache.has(lookup)) return pronunciationSequenceCache.get(lookup)

  const request = fetchAmericanPronunciationSequence(lookup, options)
  pronunciationSequenceCache.set(lookup, request)
  try {
    return await request
  } catch (_error) {
    pronunciationSequenceCache.delete(lookup)
    return []
  }
}

export async function prefetchAmericanPronunciations(values, options = {}) {
  const texts = [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean))]
    .filter((text) => (
      isSingleDictionaryWord(text)
        ? !pronunciationCache.has(text)
        : !pronunciationSequenceCache.has(text)
    ))
    .slice(0, 20)
  if (!texts.length) return { requested: 0, resolved: 0 }

  const fetchImpl = options.merriamFetchImpl || options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return { requested: 0, resolved: 0 }
  const baseUrl = String(options.merriamBaseUrl || DEFAULT_MERRIAM_BASE_URL).replace(/\/+$/, '')
  const unresolved = new Set(texts)
  let resolved = 0
  try {
    const words = texts.filter(isSingleDictionaryWord)
    if (words.length) {
      const response = await fetchImpl(`${baseUrl}/api/dictionary/pronunciations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ words }),
        signal: options.signal,
      })
      if (response.ok) {
        const payload = await response.json()
        for (const item of Array.isArray(payload?.items) ? payload.items : []) {
          const word = String(item?.word || '').trim().toLowerCase()
          const url = normalizeMerriamAudioUrl(item?.audioUrl)
          if (!word || !url) continue
          pronunciationCache.set(word, Promise.resolve(url))
          unresolved.delete(word)
          resolved += 1
        }
      }
    }
    if (unresolved.size) {
      const edgeResponse = await fetchEdgeBatch([...unresolved], { ...options, edgeBaseUrl: baseUrl })
      for (const item of edgeResponse) {
        const text = String(item?.text || '').trim().toLowerCase()
        const url = normalizeEdgeAudioUrl(item?.audioUrl, baseUrl)
        if (!text || !url || !unresolved.has(text)) continue
        pronunciationCache.set(text, Promise.resolve(url))
        if (!isSingleDictionaryWord(text)) {
          pronunciationSequenceCache.set(text, Promise.resolve([url]))
        }
        unresolved.delete(text)
        resolved += 1
      }
    }
    return { requested: texts.length, resolved }
  } catch (_error) {
    return { requested: texts.length, resolved }
  }
}

export function shouldUseSystemPronunciationFallback(value) {
  return tokenizeDictionaryWords(value).length === 1
}

export function pickAmericanPronunciationUrl(entries) {
  const candidates = (Array.isArray(entries) ? entries : [])
    .flatMap((entry) => Array.isArray(entry?.phonetics) ? entry.phonetics : [])
    .map((phonetic) => normalizeAudioUrl(phonetic?.audio))
    .filter(Boolean)

  return candidates.find(isAmericanAudioUrl) || ''
}

async function fetchAmericanPronunciation(word, options) {
  const merriamUrl = await fetchMerriamPronunciation(word, options)
  if (merriamUrl) return merriamUrl

  const edgeUrl = await fetchEdgePronunciation(word, options)
  if (edgeUrl) return edgeUrl

  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return ''
  const response = await fetchImpl(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
    { signal: options.signal },
  )
  if (!response.ok) return ''
  return pickAmericanPronunciationUrl(await response.json())
}

async function fetchAmericanPronunciationSequence(value, options) {
  const words = tokenizeDictionaryWords(value)
  if (words.length <= 1) {
    const url = await resolveAmericanPronunciation(value, options)
    return url ? [url] : []
  }

  const edgeUrl = await fetchEdgePronunciation(value, {
    ...options,
    requiredVoice: REQUIRED_PHRASE_EDGE_VOICE,
  })
  return edgeUrl ? [edgeUrl] : []
}

async function fetchEdgePronunciation(text, options) {
  if (options.disableEdgeTts) return ''
  const fetchImpl = options.edgeFetchImpl || options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return ''
  const baseUrl = String(options.edgeBaseUrl || options.merriamBaseUrl || DEFAULT_MERRIAM_BASE_URL).replace(/\/+$/, '')
  try {
    const response = await fetchImpl(`${baseUrl}/api/tts/edge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: options.signal,
    })
    if (!response.ok) return ''
    const payload = await response.json()
    if (options.requiredVoice && payload?.voice !== options.requiredVoice) return ''
    return normalizeEdgeAudioUrl(payload?.audioUrl, baseUrl)
  } catch (_error) {
    return ''
  }
}

async function fetchEdgeBatch(texts, options) {
  const fetchImpl = options.edgeFetchImpl || options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function' || options.disableEdgeTts) return []
  const baseUrl = String(options.edgeBaseUrl || DEFAULT_MERRIAM_BASE_URL).replace(/\/+$/, '')
  try {
    const response = await fetchImpl(`${baseUrl}/api/tts/edge/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: options.signal,
    })
    if (!response.ok) return []
    const payload = await response.json()
    return Array.isArray(payload?.items) ? payload.items : []
  } catch (_error) {
    return []
  }
}

async function fetchMerriamPronunciation(word, options) {
  if (options.disableMerriam) return ''
  const fetchImpl = options.merriamFetchImpl || options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return ''
  const baseUrl = String(options.merriamBaseUrl || DEFAULT_MERRIAM_BASE_URL).replace(/\/+$/, '')
  try {
    const response = await fetchImpl(
      `${baseUrl}/api/dictionary/pronunciation?word=${encodeURIComponent(word)}`,
      { signal: options.signal },
    )
    if (!response.ok) return ''
    const payload = await response.json()
    return normalizeMerriamAudioUrl(payload?.audioUrl)
  } catch (_error) {
    return ''
  }
}

function isSingleDictionaryWord(value) {
  return /^[a-z]+(?:['’-][a-z]+)*$/i.test(String(value || ''))
}

function tokenizeDictionaryWords(value) {
  return String(value || '').toLowerCase().match(/[a-z]+(?:['’][a-z]+)*/g) || []
}

function normalizeMerriamAudioUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || url.hostname !== 'media.merriam-webster.com') return ''
    if (!url.pathname.startsWith('/audio/prons/en/us/')) return ''
    return url.href
  } catch (_error) {
    return ''
  }
}

function normalizeEdgeAudioUrl(value, baseUrl) {
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

function normalizeAudioUrl(value) {
  const url = String(value || '').trim()
  if (!url) return ''
  const absolute = url.startsWith('//') ? `https:${url}` : url
  return absolute.startsWith('https://') ? absolute : ''
}

function isAmericanAudioUrl(url) {
  return /(?:[-_]us(?:[-_.]|$)|\/us\/)/i.test(url)
}
