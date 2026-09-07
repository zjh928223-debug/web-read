export const PASSAGE_PREVIEW_SESSION_CACHE_KEY = 'vocabulary.passage-preview.session-cache.v2'
export const PASSAGE_PREVIEW_SESSION_CACHE_SCHEMA = 'passage-preview.session-cache.v2'

let memoryCache = null

export function getPassagePreviewSessionBatchKey(items) {
  const normalized = (Array.isArray(items) ? items : []).map((item) => ({
    id: normalizeText(item?.id),
    lemma: normalizeText(item?.lemma || item?.word).toLowerCase(),
    word: normalizeText(item?.word),
    form: normalizeText(item?.form),
    pos: normalizeText(item?.pos || item?.partOfSpeech),
    primaryMeaningZh: normalizeText(item?.primaryMeaningZh),
    targetSenseKey: normalizeText(item?.targetSenseKey),
    contextSentence: normalizeText(item?.previewContext?.sentence),
  }))
  return JSON.stringify({
    schemaVersion: PASSAGE_PREVIEW_SESSION_CACHE_SCHEMA,
    items: normalized,
  })
}

export function loadPassagePreviewSessionCache(items, storage = getSessionStorage()) {
  const batchKey = getPassagePreviewSessionBatchKey(items)
  if (!batchKey || !Array.isArray(items) || !items.length) return null
  const memoryEntry = memoryCache?.batchKey === batchKey ? memoryCache : null
  const saved = memoryEntry || readJson(storage)
  if (!saved || saved.schemaVersion !== PASSAGE_PREVIEW_SESSION_CACHE_SCHEMA || saved.batchKey !== batchKey) {
    return null
  }
  if (!Array.isArray(saved.items)) return null
  return clone(saved)
}

export function savePassagePreviewSessionCache({
  items,
  preloadedSentences = {},
  translations = {},
  storage = getSessionStorage(),
} = {}) {
  const batchKey = getPassagePreviewSessionBatchKey(items)
  if (!batchKey || !Array.isArray(items) || !items.length) return null
  const entry = {
    schemaVersion: PASSAGE_PREVIEW_SESSION_CACHE_SCHEMA,
    batchKey,
    items: clone(items),
    preloadedSentences: clone(preloadedSentences) || {},
    translations: clone(translations) || {},
    cachedAt: new Date().toISOString(),
  }
  memoryCache = entry
  try {
    storage?.setItem(PASSAGE_PREVIEW_SESSION_CACHE_KEY, JSON.stringify(entry))
  } catch (_error) {}
  return clone(entry)
}

export function clearPassagePreviewSessionCache(storage = getSessionStorage()) {
  memoryCache = null
  try {
    storage?.removeItem(PASSAGE_PREVIEW_SESSION_CACHE_KEY)
  } catch (_error) {}
}

function getSessionStorage() {
  try {
    return globalThis.sessionStorage
  } catch (_error) {
    return null
  }
}

function readJson(storage) {
  try {
    const raw = storage?.getItem(PASSAGE_PREVIEW_SESSION_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (_error) {
    return null
  }
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}
