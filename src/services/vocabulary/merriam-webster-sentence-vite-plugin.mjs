import { readWindowsGenericCredential } from './windows-generic-credential.mjs'
import {
  deriveEnglishLemmaCandidates,
  findEnglishInflectionInSentence,
  findExactEnglishWordInSentence,
} from './english-inflection-match.mjs'

export const MERRIAM_WEBSTER_SENTENCE_ENDPOINT = '/api/vocabulary/merriam-webster-examples'
export const MERRIAM_WEBSTER_API_BASE = 'https://www.dictionaryapi.com/api/v3/references'
export const MERRIAM_WEBSTER_SAFE_DAILY_BUDGET = 900
export const MERRIAM_WEBSTER_DICTIONARY_CREDENTIAL = 'SubtitleWorkflow/MerriamWebsterDictionaryApiKey'
export const MERRIAM_WEBSTER_LEARNERS_CREDENTIAL = 'SubtitleWorkflow/MerriamWebsterLearnersDictionaryApiKey'

const REFERENCES = Object.freeze({
  learners: Object.freeze({
    id: 'learners',
    credential: MERRIAM_WEBSTER_LEARNERS_CREDENTIAL,
    title: "Merriam-Webster's Advanced Learner's English Dictionary",
    productUrl: 'https://dictionaryapi.com/products/api-learners-dictionary',
  }),
  dictionary: Object.freeze({
    id: 'collegiate',
    credential: MERRIAM_WEBSTER_DICTIONARY_CREDENTIAL,
    title: "Merriam-Webster's Collegiate® Dictionary",
    productUrl: 'https://dictionaryapi.com/products/api-collegiate-dictionary',
  }),
})

export function createMerriamWebsterSentenceVitePlugin(options = {}) {
  const budgets = {
    learners: options.learnersBudget || createMerriamWebsterDailyBudget({ limit: options.dailyBudget }),
    dictionary: options.dictionaryBudget || createMerriamWebsterDailyBudget({ limit: options.dailyBudget }),
  }
  const configure = (server) => {
    server.middlewares.use((request, response, next) => {
      void handleMerriamWebsterSentenceRequest(request, response, next, { ...options, budgets })
    })
  }
  return {
    name: 'read-web-merriam-webster-sentence-source',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}

export async function handleMerriamWebsterSentenceRequest(request, response, next, options = {}) {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
  if (request.method !== 'GET' || requestUrl.pathname !== MERRIAM_WEBSTER_SENTENCE_ENDPOINT) {
    next()
    return
  }

  const word = normalizeWord(requestUrl.searchParams.get('word'))
  const referenceName = requestUrl.searchParams.get('reference') === 'dictionary' ? 'dictionary' : 'learners'
  const limit = normalizeLimit(requestUrl.searchParams.get('limit'))
  if (!word) {
    sendJson(response, 400, { code: 'MERRIAM_WEBSTER_INVALID_WORD', error: 'word must be a single English word or hyphenated expression' })
    return
  }

  const reference = REFERENCES[referenceName]
  const credentialReader = options.credentialReader || readWindowsGenericCredential
  const apiKey = String(referenceName === 'learners'
    ? options.learnersApiKey || credentialReader(reference.credential)
    : options.dictionaryApiKey || credentialReader(reference.credential)).trim()
  if (!apiKey) {
    sendJson(response, 503, {
      code: referenceName === 'learners' ? 'MERRIAM_WEBSTER_LEARNERS_NOT_CONFIGURED' : 'MERRIAM_WEBSTER_DICTIONARY_NOT_CONFIGURED',
      error: `${reference.title} API key is not configured`,
    })
    return
  }

  const budget = options.budgets?.[referenceName] || createMerriamWebsterDailyBudget()
  if (!budget.tryTake()) {
    sendJson(response, 429, {
      code: 'MERRIAM_WEBSTER_LOCAL_BUDGET_EXHAUSTED',
      error: `The local ${referenceName} safety budget is exhausted for today`,
      retryAfterMs: budget.retryAfterMs(),
      localRemainingDay: 0,
    })
    return
  }

  try {
    const fetchImpl = options.fetchImpl || globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('Merriam-Webster fetch is unavailable')
    const upstreamUrl = new URL(`${MERRIAM_WEBSTER_API_BASE}/${reference.id}/json/${encodeURIComponent(word)}`)
    upstreamUrl.searchParams.set('key', apiKey)
    const upstream = await fetchImpl(upstreamUrl, {
      headers: { accept: 'application/json', 'user-agent': 'Read-Web local personal learning client' },
      signal: AbortSignal.timeout(12_000),
    })
    const payload = await readJsonSafely(upstream)
    if (!upstream.ok) {
      sendJson(response, upstream.status === 429 ? 429 : 502, {
        code: upstream.status === 429 ? 'MERRIAM_WEBSTER_UPSTREAM_RATE_LIMITED' : 'MERRIAM_WEBSTER_UPSTREAM_ERROR',
        error: `Merriam-Webster returned HTTP ${upstream.status}`,
        localRemainingDay: budget.remaining(),
      })
      return
    }

    sendJson(response, 200, {
      schemaVersion: 'merriam-webster-sense-examples.v1',
      reference: referenceName,
      source: reference.title,
      sourceUrl: reference.productUrl,
      localRemainingDay: budget.remaining(),
      items: extractMerriamWebsterExamples(payload, { word, referenceName, limit }),
    })
  } catch (_error) {
    sendJson(response, 502, {
      code: 'MERRIAM_WEBSTER_REQUEST_FAILED',
      error: 'Merriam-Webster sentence source is temporarily unavailable',
      localRemainingDay: budget.remaining(),
    })
  }
}

export function extractMerriamWebsterExamples(payload, { word, referenceName = 'learners', limit = 20 } = {}) {
  const reference = REFERENCES[referenceName] || REFERENCES.learners
  const items = []
  const queryLemmas = unique([normalizeWord(word), ...deriveEnglishLemmaCandidates(word)])
  for (const [entryIndex, entry] of (Array.isArray(payload) ? payload : []).entries()) {
    if (!entry || typeof entry !== 'object' || entry.meta?.section && entry.meta.section !== 'alpha') continue
    const partOfSpeech = normalizePartOfSpeech(entry.fl)
    const entryId = String(entry.meta?.id || entry.hwi?.hw || word || '').replace(/\*/gu, '')
    const entryHeadword = normalizeEntryHeadword(entryId)
    const targetLemma = queryLemmas.find((candidate) => candidate === entryHeadword)
    if (!targetLemma) continue
    let senseOrder = 0
    visitDefinitionNodes(entry.def, (node) => {
      senseOrder += 1
      const definition = extractDefinition(node.dt)
      for (const [exampleIndex, example] of extractVerbalIllustrations(node.dt).entries()) {
        const sentence = cleanMerriamText(example.t)
        const matchedTerm = findExactEnglishWordInSentence(sentence, word)
          || findEnglishInflectionInSentence(sentence, targetLemma, { preferredForm: word })
        const wordCount = countWords(sentence)
        if (!matchedTerm || wordCount < 3 || wordCount > 20) continue
        items.push({
          id: `${referenceName}:${entryId}:${senseOrder}:${exampleIndex + 1}`,
          sentence,
          definition,
          partOfSpeech,
          entryOrder: entryIndex + 1,
          senseOrder,
          matchedTerm,
          matchedForm: matchedTerm,
          targetLemma,
          reference: referenceName,
          dictionaryTitle: reference.title,
          sourceUrl: reference.productUrl,
          attribution: normalizeAttribution(example.aq),
        })
      }
    })
    if (items.length >= limit) break
  }
  return items.slice(0, normalizeLimit(limit))
}

export function createMerriamWebsterDailyBudget({ limit = MERRIAM_WEBSTER_SAFE_DAILY_BUDGET, now = Date.now } = {}) {
  let day = localDay(now())
  let used = 0
  const normalizedLimit = Math.max(1, Math.floor(Number(limit) || MERRIAM_WEBSTER_SAFE_DAILY_BUDGET))
  function resetIfNeeded() {
    const currentDay = localDay(now())
    if (currentDay !== day) {
      day = currentDay
      used = 0
    }
  }
  return Object.freeze({
    tryTake() {
      resetIfNeeded()
      if (used >= normalizedLimit) return false
      used += 1
      return true
    },
    remaining() {
      resetIfNeeded()
      return Math.max(0, normalizedLimit - used)
    },
    retryAfterMs() {
      resetIfNeeded()
      const date = new Date(now())
      date.setHours(24, 0, 0, 0)
      return Math.max(0, date.getTime() - now())
    },
  })
}

function visitDefinitionNodes(value, visitor) {
  if (Array.isArray(value)) {
    if (value[0] === 'sense' && value[1] && typeof value[1] === 'object') visitor(value[1])
    for (const item of value) visitDefinitionNodes(item, visitor)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const item of Object.values(value)) visitDefinitionNodes(item, visitor)
}

function extractDefinition(dt) {
  if (!Array.isArray(dt)) return ''
  return cleanMerriamText(dt
    .filter((item) => Array.isArray(item) && item[0] === 'text')
    .map((item) => item[1])
    .join(' '))
}

function extractVerbalIllustrations(value) {
  const results = []
  const visit = (node) => {
    if (!Array.isArray(node)) return
    if (node[0] === 'vis' && Array.isArray(node[1])) {
      for (const item of node[1]) if (item && typeof item.t === 'string') results.push(item)
      return
    }
    for (const item of node) visit(item)
  }
  visit(value)
  return results
}

function cleanMerriamText(value) {
  return String(value || '')
    .replace(/\{(?:ldquo|rdquo)\}/gu, '"')
    .replace(/\{(?:lsquo|rsquo)\}/gu, "'")
    .replace(/\{bc\}/gu, ' ')
    .replace(/\{(?:wi|it|phrase|qword|sc)\}|\{\/(?:wi|it|phrase|qword|sc)\}/gu, '')
    .replace(/\{[^{}|]+\|([^|{}]+)(?:\|[^{}]*)?\}/gu, '$1')
    .replace(/\{[^{}]+\}/gu, ' ')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
}

function normalizeAttribution(value) {
  if (!value || typeof value !== 'object') return null
  const attribution = {
    author: cleanMerriamText(value.auth),
    source: cleanMerriamText(value.source),
    date: cleanMerriamText(value.aqdate),
  }
  return Object.values(attribution).some(Boolean) ? attribution : null
}

function normalizePartOfSpeech(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z]/gu, '')
  if (normalized.includes('adjective')) return 'adjective'
  if (normalized.includes('adverb')) return 'adverb'
  if (normalized.includes('noun')) return 'noun'
  if (normalized.includes('verb')) return 'verb'
  return normalized
}

function normalizeWord(value) {
  const word = String(value || '').normalize('NFKC').trim().toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) && word.length <= 64 ? word : ''
}

function normalizeEntryHeadword(value) {
  const headword = String(value || '').split(':')[0].match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/u)?.[0]
  return normalizeWord(headword)
}

function normalizeLimit(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(1, Math.min(40, parsed)) : 20
}

function countWords(value) {
  return (String(value || '').match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/gu) || []).length
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function localDay(value) {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

async function readJsonSafely(response) {
  try {
    return await response.json()
  } catch (_error) {
    return null
  }
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}
