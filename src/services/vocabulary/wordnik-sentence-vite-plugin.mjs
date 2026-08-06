export const WORDNIK_SENTENCE_ENDPOINT = '/api/vocabulary/wordnik-examples'
export const WORDNIK_API_BASE = 'https://api.wordnik.com/v4/word.json'
export const WORDNIK_SAFE_HOURLY_BUDGET = 80

export function createWordnikSentenceVitePlugin(options = {}) {
  const budget = options.budget || createWordnikHourlyBudget({
    limit: options.hourlyBudget || WORDNIK_SAFE_HOURLY_BUDGET,
  })
  const configure = (server) => {
    server.middlewares.use((request, response, next) => {
      void handleWordnikSentenceRequest(request, response, next, {
        apiKey: options.apiKey,
        budget,
        fetchImpl: options.fetchImpl,
      })
    })
  }
  return {
    name: 'read-web-wordnik-sentence-source',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}

export async function handleWordnikSentenceRequest(request, response, next, options = {}) {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
  if (request.method !== 'GET' || requestUrl.pathname !== WORDNIK_SENTENCE_ENDPOINT) {
    next()
    return
  }

  const word = normalizeWord(requestUrl.searchParams.get('word'))
  const limit = normalizeLimit(requestUrl.searchParams.get('limit'))
  if (!word) {
    sendJson(response, 400, { code: 'WORDNIK_INVALID_WORD', error: 'word must be a single English word or hyphenated expression' })
    return
  }

  const apiKey = String(options.apiKey || '').trim()
  if (!apiKey) {
    sendJson(response, 503, { code: 'WORDNIK_NOT_CONFIGURED', error: 'WORDNIK_API_KEY is not configured' })
    return
  }

  const budget = options.budget || createWordnikHourlyBudget()
  if (!budget.tryTake()) {
    sendJson(response, 429, {
      code: 'WORDNIK_LOCAL_BUDGET_EXHAUSTED',
      error: 'The local Wordnik safety budget is exhausted for this hour',
      retryAfterMs: budget.retryAfterMs(),
      remainingHour: 0,
    })
    return
  }

  try {
    const fetchImpl = options.fetchImpl || globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('Wordnik fetch is unavailable')
    const upstreamUrl = new URL(`${WORDNIK_API_BASE}/${encodeURIComponent(word)}/examples`)
    upstreamUrl.searchParams.set('includeDuplicates', 'false')
    upstreamUrl.searchParams.set('useCanonical', 'true')
    upstreamUrl.searchParams.set('skip', '0')
    upstreamUrl.searchParams.set('limit', String(limit))
    const upstream = await fetchImpl(upstreamUrl, {
      headers: {
        accept: 'application/json',
        api_key: apiKey,
        'user-agent': 'Read-Web local personal learning client',
      },
      signal: AbortSignal.timeout(12_000),
    })
    const payload = await readJsonSafely(upstream)
    if (!upstream.ok) {
      sendJson(response, upstream.status === 429 ? 429 : 502, {
        code: upstream.status === 429 ? 'WORDNIK_UPSTREAM_RATE_LIMITED' : 'WORDNIK_UPSTREAM_ERROR',
        error: `Wordnik returned HTTP ${upstream.status}`,
        detail: payload?.message || payload?.error || null,
        remainingHour: readRateLimitHeader(upstream, 'x-ratelimit-remaining-hour'),
        remainingMinute: readRateLimitHeader(upstream, 'x-ratelimit-remaining-minute'),
      })
      return
    }

    const items = (Array.isArray(payload?.examples) ? payload.examples : [])
      .map((item) => normalizeWordnikItem(item, word))
      .filter((item) => item.sentence && containsWord(item.sentence, word))
      .slice(0, limit)
    sendJson(response, 200, {
      schemaVersion: 'wordnik-real-sentences.v1',
      source: 'Wordnik',
      sourceUrl: `https://www.wordnik.com/words/${encodeURIComponent(word)}`,
      remainingHour: readRateLimitHeader(upstream, 'x-ratelimit-remaining-hour'),
      remainingMinute: readRateLimitHeader(upstream, 'x-ratelimit-remaining-minute'),
      localRemainingHour: budget.remaining(),
      items,
    })
  } catch (error) {
    sendJson(response, 502, {
      code: 'WORDNIK_REQUEST_FAILED',
      error: 'Wordnik sentence source is temporarily unavailable',
      detail: error?.message || String(error),
      localRemainingHour: budget.remaining(),
    })
  }
}

export function createWordnikHourlyBudget({ limit = WORDNIK_SAFE_HOURLY_BUDGET, now = Date.now } = {}) {
  const timestamps = []
  const normalizedLimit = Math.max(1, Math.floor(Number(limit) || WORDNIK_SAFE_HOURLY_BUDGET))

  function prune() {
    const cutoff = now() - 60 * 60 * 1000
    while (timestamps.length && timestamps[0] <= cutoff) timestamps.shift()
  }

  return Object.freeze({
    tryTake() {
      prune()
      if (timestamps.length >= normalizedLimit) return false
      timestamps.push(now())
      return true
    },
    remaining() {
      prune()
      return Math.max(0, normalizedLimit - timestamps.length)
    },
    retryAfterMs() {
      prune()
      return timestamps.length >= normalizedLimit
        ? Math.max(0, timestamps[0] + 60 * 60 * 1000 - now())
        : 0
    },
  })
}

function normalizeWordnikItem(item, word) {
  const recordId = item?.exampleId ?? item?.id ?? item?.documentId ?? ''
  return {
    id: String(recordId),
    sentence: String(item?.text || ''),
    title: normalizeText(item?.title) || null,
    providerName: normalizeText(item?.provider?.name) || null,
    originalUrl: normalizeHttpUrl(item?.url),
    wordUrl: `https://www.wordnik.com/words/${encodeURIComponent(word)}`,
  }
}

function normalizeWord(value) {
  const word = normalizeText(value).toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) && word.length <= 64 ? word : ''
}

function normalizeLimit(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(1, Math.min(20, parsed)) : 12
}

function containsWord(sentence, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?<![A-Za-z])${escaped}(?:s|es|ed|ing)?(?![A-Za-z])`, 'iu').test(sentence)
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch (_error) {
    return null
  }
}

async function readJsonSafely(response) {
  try {
    return await response.json()
  } catch (_error) {
    return null
  }
}

function readRateLimitHeader(response, name) {
  const value = Number(response?.headers?.get?.(name))
  return Number.isFinite(value) ? value : null
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}
