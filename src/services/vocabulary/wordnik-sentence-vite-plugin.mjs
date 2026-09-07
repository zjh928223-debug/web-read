import { findEnglishInflectionInSentence } from './english-inflection-match.mjs'

export const WORDNIK_SENTENCE_ENDPOINT = '/api/vocabulary/wordnik-examples'
export const WORDNIK_API_BASE = 'https://api.wordnik.com/v4/word.json'
export const WORDNIK_SAFE_HOURLY_BUDGET = 100
const WORDNIK_MINUTE_MS = 60 * 1000
const WORDNIK_HOUR_MS = 60 * 60 * 1000

export function createWordnikSentenceVitePlugin(options = {}) {
  const budget = options.budget || createWordnikHourlyBudget({
    limit: options.hourlyBudget || WORDNIK_SAFE_HOURLY_BUDGET,
  })
  const inFlight = options.inFlight || new Map()
  const configure = (server) => {
    server.middlewares.use((request, response, next) => {
      void handleWordnikSentenceRequest(request, response, next, {
        apiKey: options.apiKey,
        budget,
        inFlight,
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
  const inFlight = options.inFlight && typeof options.inFlight.get === 'function'
    ? options.inFlight
    : null
  const requestKey = `${word}\u0000${limit}`
  let upstreamPromise = inFlight?.get(requestKey) || null
  if (!upstreamPromise && !budget.tryTake()) {
    const blockedReason = budget.blockedReason?.() || 'local'
    const observedLimit = blockedReason === 'observed'
    sendJson(response, 429, {
      code: observedLimit ? 'WORDNIK_OBSERVED_RATE_LIMIT' : 'WORDNIK_LOCAL_BUDGET_EXHAUSTED',
      error: observedLimit
        ? 'Wordnik reported that the current minute or hour limit has been reached'
        : 'The local Wordnik safety budget is exhausted for this hour',
      retryAfterMs: budget.retryAfterMs(),
      localRemainingHour: budget.remaining(),
    })
    return
  }

  try {
    const fetchImpl = options.fetchImpl || globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('Wordnik fetch is unavailable')
    if (!upstreamPromise) {
      upstreamPromise = fetchWordnikExamples({ fetchImpl, word, limit, apiKey })
      if (inFlight) {
        inFlight.set(requestKey, upstreamPromise)
        void upstreamPromise.then(
          () => clearInFlightRequest(inFlight, requestKey, upstreamPromise),
          () => clearInFlightRequest(inFlight, requestKey, upstreamPromise),
        )
      }
    }
    const { upstream, payload } = await upstreamPromise
    const rateLimit = readRateLimitSnapshot(upstream)
    budget.observe?.(rateLimit)
    if (!upstream.ok) {
      sendJson(response, upstream.status === 429 ? 429 : 502, {
        code: upstream.status === 429 ? 'WORDNIK_UPSTREAM_RATE_LIMITED' : 'WORDNIK_UPSTREAM_ERROR',
        error: `Wordnik returned HTTP ${upstream.status}`,
        detail: payload?.message || payload?.error || null,
        ...serializeRateLimit(rateLimit),
        localRemainingHour: budget.remaining(),
      })
      return
    }

    const items = (Array.isArray(payload?.examples) ? payload.examples : [])
      .map((item) => normalizeWordnikItem(item, word, payload?.attributionText))
      .filter((item) => item.sentence && containsWord(item.sentence, word))
      .slice(0, limit)
    sendJson(response, 200, {
      schemaVersion: 'wordnik-real-sentences.v1',
      source: 'Wordnik',
      sourceUrl: `https://www.wordnik.com/words/${encodeURIComponent(word)}`,
      ...serializeRateLimit(rateLimit),
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
  let observedRemainingHour = null
  let observedRemainingMinute = null
  let observedHourBlockedUntil = 0
  let observedMinuteBlockedUntil = 0

  function prune() {
    const cutoff = now() - WORDNIK_HOUR_MS
    while (timestamps.length && timestamps[0] <= cutoff) timestamps.shift()
    refreshObservedWindows()
  }

  function refreshObservedWindows() {
    const current = now()
    if (observedMinuteBlockedUntil && current >= observedMinuteBlockedUntil) {
      observedMinuteBlockedUntil = 0
      observedRemainingMinute = null
    }
    if (observedHourBlockedUntil && current >= observedHourBlockedUntil) {
      observedHourBlockedUntil = 0
      observedRemainingHour = null
    }
  }

  function blockedReason() {
    refreshObservedWindows()
    const current = now()
    if (
      (observedMinuteBlockedUntil && current < observedMinuteBlockedUntil)
      || (observedHourBlockedUntil && current < observedHourBlockedUntil)
      || observedRemainingMinute === 0
      || observedRemainingHour === 0
    ) return 'observed'
    if (timestamps.length >= normalizedLimit) return 'local'
    return null
  }

  return Object.freeze({
    tryTake() {
      prune()
      if (blockedReason()) return false
      timestamps.push(now())
      return true
    },
    remaining() {
      prune()
      const localRemaining = Math.max(0, normalizedLimit - timestamps.length)
      return observedRemainingHour === null
        ? localRemaining
        : Math.max(0, Math.min(localRemaining, observedRemainingHour))
    },
    retryAfterMs() {
      prune()
      const localRetry = timestamps.length >= normalizedLimit
        ? Math.max(0, timestamps[0] + WORDNIK_HOUR_MS - now())
        : 0
      const observedRetry = Math.max(
        observedMinuteBlockedUntil ? observedMinuteBlockedUntil - now() : 0,
        observedHourBlockedUntil ? observedHourBlockedUntil - now() : 0,
      )
      return Math.max(localRetry, observedRetry)
    },
    blockedReason,
    observe(rateLimit = {}) {
      const remainingHour = normalizeRateLimitValue(rateLimit.remainingHour)
      const remainingMinute = normalizeRateLimitValue(rateLimit.remainingMinute)
      const observedAt = now()
      if (remainingHour !== null) {
        observedRemainingHour = remainingHour
        observedHourBlockedUntil = remainingHour === 0 ? observedAt + WORDNIK_HOUR_MS : 0
      }
      if (remainingMinute !== null) {
        observedRemainingMinute = remainingMinute
        observedMinuteBlockedUntil = remainingMinute === 0 ? observedAt + WORDNIK_MINUTE_MS : 0
      }
    },
  })
}

async function fetchWordnikExamples({ fetchImpl, word, limit, apiKey }) {
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
  return { upstream, payload: await readJsonSafely(upstream) }
}

function clearInFlightRequest(inFlight, requestKey, promise) {
  if (inFlight.get(requestKey) === promise) inFlight.delete(requestKey)
}

function normalizeWordnikItem(item, word, fallbackAttributionText = null) {
  const recordId = item?.exampleId ?? item?.id ?? item?.documentId ?? ''
  return {
    id: String(recordId),
    sentence: String(item?.text || ''),
    title: normalizeText(item?.title) || null,
    providerName: normalizeText(item?.provider?.name) || null,
    originalUrl: normalizeHttpUrl(item?.url),
    wordUrl: `https://www.wordnik.com/words/${encodeURIComponent(word)}`,
    attributionText: preserveAttributionText(item?.attributionText) || preserveAttributionText(fallbackAttributionText),
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
  return Boolean(findEnglishInflectionInSentence(sentence, word))
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
  const raw = response?.headers?.get?.(name)
  if (raw === null || raw === undefined || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function readRateLimitSnapshot(response) {
  return {
    limitHour: readRateLimitHeader(response, 'x-ratelimit-limit-hour'),
    remainingHour: readRateLimitHeader(response, 'x-ratelimit-remaining-hour'),
    limitMinute: readRateLimitHeader(response, 'x-ratelimit-limit-minute'),
    remainingMinute: readRateLimitHeader(response, 'x-ratelimit-remaining-minute'),
  }
}

function serializeRateLimit(rateLimit) {
  return {
    limitHour: rateLimit.limitHour,
    remainingHour: rateLimit.remainingHour,
    limitMinute: rateLimit.limitMinute,
    remainingMinute: rateLimit.remainingMinute,
    rateLimit: {
      hour: { limit: rateLimit.limitHour, remaining: rateLimit.remainingHour },
      minute: { limit: rateLimit.limitMinute, remaining: rateLimit.remainingMinute },
    },
  }
}

function normalizeRateLimitValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function preserveAttributionText(value) {
  return typeof value === 'string' && value.trim() ? value : null
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}
