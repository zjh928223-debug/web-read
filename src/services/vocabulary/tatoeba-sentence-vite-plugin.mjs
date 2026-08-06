export const TATOEBA_SENTENCE_ENDPOINT = '/api/vocabulary/real-sentences'
export const TATOEBA_API_BASE = 'https://api.tatoeba.org/v1/sentences'

export function createTatoebaSentenceVitePlugin(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const configure = (server) => {
    server.middlewares.use((request, response, next) => {
      void handleTatoebaSentenceRequest(request, response, next, { fetchImpl })
    })
  }
  return {
    name: 'read-web-tatoeba-sentence-source',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}

export async function handleTatoebaSentenceRequest(request, response, next, options = {}) {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
  if (request.method !== 'GET' || requestUrl.pathname !== TATOEBA_SENTENCE_ENDPOINT) {
    next()
    return
  }

  const word = normalizeWord(requestUrl.searchParams.get('word'))
  const limit = normalizeLimit(requestUrl.searchParams.get('limit'))
  if (!word) {
    sendJson(response, 400, { error: 'word must be a single English word or hyphenated expression' })
    return
  }

  try {
    const fetchImpl = options.fetchImpl || globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('Sentence source fetch is unavailable')
    const upstreamUrl = new URL(TATOEBA_API_BASE)
    upstreamUrl.searchParams.set('lang', 'eng')
    upstreamUrl.searchParams.set('q', word)
    upstreamUrl.searchParams.set('word_count', '3-16')
    upstreamUrl.searchParams.set('sort', 'words')
    upstreamUrl.searchParams.set('limit', String(Math.min(100, limit * 4)))
    upstreamUrl.searchParams.set('trans:lang', 'cmn')
    upstreamUrl.searchParams.set('showtrans:lang', 'cmn')
    const upstream = await fetchImpl(upstreamUrl, {
      headers: { accept: 'application/json', 'user-agent': 'Read-Web local learning client' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!upstream.ok) throw new Error(`Tatoeba returned HTTP ${upstream.status}`)
    const payload = await upstream.json()
    const items = (Array.isArray(payload?.data) ? payload.data : [])
      .filter((item) => isEligibleEnglishSentence(item, word))
      .map(normalizeTatoebaItem)
      .filter((item) => item.translationZh)
      .slice(0, limit)
    sendJson(response, 200, {
      schemaVersion: 'tatoeba-real-sentences.v1',
      source: 'Tatoeba',
      sourceUrl: 'https://tatoeba.org/',
      items,
    })
  } catch (error) {
    sendJson(response, 502, {
      error: '真实短句服务暂不可用',
      detail: error?.message || String(error),
    })
  }
}

function normalizeWord(value) {
  const word = String(value || '').normalize('NFKC').trim().toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) && word.length <= 64 ? word : ''
}

function normalizeLimit(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(1, Math.min(20, parsed)) : 12
}

function isEligibleEnglishSentence(item, word) {
  if (!item || item.lang !== 'eng' || item.is_unapproved === true || item.license !== 'CC BY 2.0 FR') return false
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const family = new RegExp(`(?<![A-Za-z])${escaped}(?:s|es|ed|ing)?(?![A-Za-z])`, 'iu')
  return family.test(String(item.text || ''))
}

function normalizeTatoebaItem(item) {
  const translations = (Array.isArray(item.translations) ? item.translations : [])
    .filter((entry) => entry?.lang === 'cmn' && entry?.is_unapproved !== true && entry?.license === 'CC BY 2.0 FR')
  const translation = translations.find((entry) => entry.script === 'Hans' && entry.is_direct === true)
    || translations.find((entry) => entry.script === 'Hans')
    || translations.find((entry) => entry.is_direct === true)
    || translations[0]
  return {
    id: String(item.id),
    sentence: String(item.text || '').replace(/\s+/gu, ' ').trim(),
    translationZh: String(translation?.text || '').replace(/\s+/gu, ' ').trim(),
    owner: item.owner || null,
    translationOwner: translation?.owner || null,
    license: item.license,
    url: `https://tatoeba.org/en/sentences/show/${encodeURIComponent(item.id)}`,
  }
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}
