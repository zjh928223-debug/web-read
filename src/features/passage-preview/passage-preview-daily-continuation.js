import {
  FIRST_CONTACT_PREVIEW_SCHEMA,
  importVocabularyPreview,
} from './passage-preview-import.js'
import {
  loadPassagePreviewDurableState,
  updatePassagePreviewDurableState,
} from './passage-preview-durable-state.js'

export const IELTS_DAILY_PREVIEW_ALLOCATIONS_KEY = 'vocabulary.ielts-daily-preview.allocations.v1'
export const IELTS_DAILY_PREVIEW_CONTINUATION_KEY = 'vocabulary.ielts-daily-preview.continuation.v1'
export const IELTS_DAILY_PREVIEW_ARCHIVE_KEY = 'vocabulary.ielts-daily-preview.archive.v1'
export const IELTS_DAILY_PREVIEW_ALLOCATIONS_SCHEMA = 'ielts-daily-preview.allocations.v1'
export const IELTS_DAILY_PREVIEW_CONTINUATION_SCHEMA = 'ielts-daily-preview.continuation.v1'
export const IELTS_DAILY_PREVIEW_ARCHIVE_SCHEMA = 'ielts-daily-preview.archive.v1'
export const IELTS_DAILY_PREVIEW_DEFAULT_BATCH_SIZE = 50
export const IELTS_DAILY_PREVIEW_CANDIDATE_ENDPOINT = '/api/vocabulary/ielts-learning-pool'

const BATCH_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u
const PREVIEW_ID_PATTERN = /^ielts-reading:(\d{4}-\d{2}-\d{2}):/iu
const DEFAULT_LOCAL_SENTENCE_ENDPOINT = '/api/vocabulary/local-sentences'
const DEFAULT_ECDICT_ENDPOINT = '/api/dev/dictionary/ecdict'
const DEFAULT_BATCH_TITLE = '剑桥雅思阅读 · {date} · 首次接触'
const FALLBACK_MEANING = '暂无本地中文释义'

export function loadIeltsDailyPreviewAllocations(storage = globalThis.localStorage) {
  const envelope = loadPassagePreviewDurableState(storage, {
    allocations: readJson(storage, IELTS_DAILY_PREVIEW_ALLOCATIONS_KEY, null),
  }).allocations
  return envelope?.schemaVersion === IELTS_DAILY_PREVIEW_ALLOCATIONS_SCHEMA
    ? normalizeAllocations(envelope)
    : emptyAllocations()
}

export function saveIeltsDailyPreviewAllocations(allocations = {}, storage = globalThis.localStorage) {
  const normalized = normalizeAllocations(allocations)
  if (typeof storage?.setItem === 'function') {
    const envelope = {
      schemaVersion: IELTS_DAILY_PREVIEW_ALLOCATIONS_SCHEMA,
      batches: Object.fromEntries(normalized.batches.map((batch) => [batch.date, {
        words: batch.words,
        ...(batch.candidateItems?.length ? { candidateItems: batch.candidateItems } : {}),
      }])),
      assignedLemmas: normalized.assignedLemmas,
    }
    updatePassagePreviewDurableState((state) => ({ ...state, allocations: envelope }), storage, {
      allocations: readJson(storage, IELTS_DAILY_PREVIEW_ALLOCATIONS_KEY, null),
    })
  }
  return normalized
}

export function generateIeltsDailyPreviewBatch({
  allocations = emptyAllocations(),
  date,
  candidateWords = [],
  excludedLemmas = [],
  batchSize = IELTS_DAILY_PREVIEW_DEFAULT_BATCH_SIZE,
} = {}) {
  const current = normalizeAllocations(allocations)
  const normalizedDate = normalizeDate(date)
  if (!normalizedDate) return {
    allocations: current,
    batch: null,
    created: false,
    reason: 'invalid_date',
  }

  const existing = current.batches.find((batch) => batch.date === normalizedDate)
  if (existing) return {
    allocations: current,
    batch: existing,
    created: false,
    reason: 'already_exists',
  }

  const assigned = new Set(current.assignedLemmas)
  current.batches.forEach((batch) => batch.words.forEach((word) => assigned.add(word)))
  normalizeWords(excludedLemmas).forEach((word) => assigned.add(word))
  const availableItems = normalizeCandidateItems(candidateWords)
    .filter((item) => !assigned.has(item.lemma))
  const requestedSize = Math.max(1, Math.floor(Number(batchSize) || IELTS_DAILY_PREVIEW_DEFAULT_BATCH_SIZE))
  if (availableItems.length < requestedSize) return {
    allocations: current,
    batch: null,
    created: false,
    reason: 'insufficient_candidates',
    availableCount: availableItems.length,
    requestedSize,
  }

  const selectedItems = availableItems.slice(0, requestedSize)
  const batch = {
    date: normalizedDate,
    words: selectedItems.map((item) => item.lemma),
    ...(selectedItems.some((item) => Object.keys(item).length > 1)
      ? { candidateItems: selectedItems }
      : {}),
  }
  const next = normalizeAllocations({
    schemaVersion: IELTS_DAILY_PREVIEW_ALLOCATIONS_SCHEMA,
    batches: [...current.batches, batch],
    assignedLemmas: [...current.assignedLemmas, ...batch.words],
  })
  return { allocations: next, batch, created: true, reason: 'created' }
}

export async function loadIeltsPreviewCandidateWords({
  fetchImpl = globalThis.fetch,
  endpoint = IELTS_DAILY_PREVIEW_CANDIDATE_ENDPOINT,
  poolId = 'readingVocabulary',
} = {}) {
  if (typeof fetchImpl !== 'function' || !endpoint) return []
  try {
    const separator = endpoint.includes('?') ? '&' : '?'
    const response = await fetchImpl(
      `${endpoint}${separator}pool=${encodeURIComponent(poolId)}&mode=summary`,
      { method: 'GET', headers: { accept: 'application/json' } },
    )
    if (!response?.ok) return []
    const payload = await response.json()
    return normalizeCandidateItems(payload?.items || payload?.words)
  } catch (_error) {
    return []
  }
}

export async function loadIeltsPreviewCandidateDetails({
  words = [],
  fetchImpl = globalThis.fetch,
  endpoint = IELTS_DAILY_PREVIEW_CANDIDATE_ENDPOINT,
  poolId = 'readingVocabulary',
} = {}) {
  const requested = normalizeWords(words)
  if (!requested.length || typeof fetchImpl !== 'function' || !endpoint) return []
  try {
    const separator = endpoint.includes('?') ? '&' : '?'
    const response = await fetchImpl(
      `${endpoint}${separator}pool=${encodeURIComponent(poolId)}&lemmas=${requested.map(encodeURIComponent).join(',')}`,
      { method: 'GET', headers: { accept: 'application/json' } },
    )
    if (!response?.ok) return []
    const payload = await response.json()
    return normalizeCandidateItems(payload?.items)
  } catch (_error) {
    return []
  }
}

export function loadIeltsDailyPreviewContinuation(storage = globalThis.localStorage) {
  const saved = loadPassagePreviewDurableState(storage, {
    continuation: readJson(storage, IELTS_DAILY_PREVIEW_CONTINUATION_KEY, null),
  }).continuation
  return normalizeContinuation(saved)
}

export function saveIeltsDailyPreviewContinuation(state = {}, storage = globalThis.localStorage) {
  const normalized = normalizeContinuation(state)
  if (typeof storage?.setItem === 'function') {
    updatePassagePreviewDurableState((state) => ({ ...state, continuation: normalized }), storage, {
      continuation: readJson(storage, IELTS_DAILY_PREVIEW_CONTINUATION_KEY, null),
    })
  }
  return normalized
}

export function loadIeltsDailyPreviewArchive(storage = globalThis.localStorage) {
  const legacy = readJson(storage, IELTS_DAILY_PREVIEW_ARCHIVE_KEY, null)
  const entries = loadPassagePreviewDurableState(storage, {
    archive: legacy?.schemaVersion === IELTS_DAILY_PREVIEW_ARCHIVE_SCHEMA ? legacy.entries : [],
  }).archive
  return entries
    .filter((entry) => normalizeDate(entry?.date) && Array.isArray(entry?.items))
    .map((entry) => ({
      date: normalizeDate(entry.date),
      items: entry.items,
      completedAt: normalizeIso(entry.completedAt),
    }))
}

export function saveIeltsDailyPreviewArchive({ date, items, completedAt } = {}, storage = globalThis.localStorage) {
  const normalizedDate = normalizeDate(date)
  if (!normalizedDate || !Array.isArray(items) || !items.length) return loadIeltsDailyPreviewArchive(storage)
  const entries = loadIeltsDailyPreviewArchive(storage)
    .filter((entry) => entry.date !== normalizedDate)
  entries.unshift({
    date: normalizedDate,
    items,
    completedAt: normalizeIso(completedAt) || new Date().toISOString(),
  })
  const next = entries.slice(0, 30)
  if (typeof storage?.setItem === 'function') {
    updatePassagePreviewDurableState((state) => ({ ...state, archive: next }), storage, {
      archive: loadIeltsDailyPreviewArchive(storage),
    })
  }
  return next
}

export function getPreviewBatchDate(items) {
  if (!Array.isArray(items) || !items.length) return null
  const dates = items.map((item) => {
    const match = String(item?.id || '').match(PREVIEW_ID_PATTERN)
    return normalizeDate(match?.[1])
  })
  if (dates.some((date) => !date) || new Set(dates).size !== 1) return null
  return dates[0]
}

export function selectNextIeltsDailyPreviewBatch({
  allocations,
  currentBatchDate = null,
  consumedBatchDates = [],
  excludedLemmas = [],
  today = formatDate(new Date()),
} = {}) {
  const current = normalizeDate(currentBatchDate)
  const limit = normalizeDate(today) || formatDate(new Date())
  const consumed = new Set((Array.isArray(consumedBatchDates) ? consumedBatchDates : []).map(normalizeDate).filter(Boolean))
  const excluded = new Set(normalizeWords(excludedLemmas))
  return (Array.isArray(allocations?.batches) ? allocations.batches : [])
    .filter((batch) => (
      batch?.date
      && batch.date <= limit
      && (!current || batch.date > current)
      && !consumed.has(batch.date)
    ))
    .map((batch) => filterExcludedBatchWords(batch, excluded))
    .filter((batch) => batch.words.length > 0)
    .sort((left, right) => left.date.localeCompare(right.date))[0] || null
}

export function excludePreviouslyIntroducedPreviewItems({
  items = [],
  introducedRecords = [],
  currentIndex = 0,
} = {}) {
  const source = Array.isArray(items) ? items : []
  const introducedByLemma = new Map((Array.isArray(introducedRecords) ? introducedRecords : [])
    .map((record) => [normalizeWord(record?.lemma || record?.word), normalizeText(record?.previewItemId)])
    .filter(([lemma]) => lemma))
  const retained = source
    .map((item, originalIndex) => ({ item, originalIndex }))
    .filter(({ item }) => {
      const introducedItemId = introducedByLemma.get(normalizeWord(item?.lemma || item?.word))
      return !introducedItemId || introducedItemId === normalizeText(item?.id)
    })
  if (retained.length === source.length) {
    return { items: source, currentIndex: Math.max(0, Number(currentIndex) || 0), removedCount: 0 }
  }
  const previousIndex = Math.max(0, Math.min(source.length - 1, Number(currentIndex) || 0))
  const nextCurrent = retained.find((entry) => entry.originalIndex >= previousIndex) || retained.at(-1)
  return {
    items: retained.map((entry) => entry.item),
    currentIndex: nextCurrent ? retained.indexOf(nextCurrent) : 0,
    removedCount: source.length - retained.length,
  }
}

function filterExcludedBatchWords(batch, excluded) {
  if (!excluded.size) return batch
  const words = normalizeWords(batch?.words).filter((word) => !excluded.has(word))
  const candidateItems = normalizeCandidateItems(batch?.candidateItems)
    .filter((item) => words.includes(item.lemma))
  const { candidateItems: _previousCandidateItems, ...batchWithoutCandidateItems } = batch
  return {
    ...batchWithoutCandidateItems,
    words,
    ...(candidateItems.length ? { candidateItems } : {}),
  }
}

export async function materializeIeltsDailyPreviewBatch({
  batch,
  fetchImpl = globalThis.fetch,
  fallbackItems = [],
  localSentenceEndpoint = DEFAULT_LOCAL_SENTENCE_ENDPOINT,
  ecdictEndpoint = DEFAULT_ECDICT_ENDPOINT,
  candidateEndpoint = IELTS_DAILY_PREVIEW_CANDIDATE_ENDPOINT,
  poolId = 'readingVocabulary',
  concurrency = 4,
  batchTitle = '',
} = {}) {
  const date = normalizeDate(batch?.date)
  const words = normalizeWords(batch?.words)
  if (!date || !words.length) throw new Error('雅思每日预习批次缺少日期或单词')

  const batchCandidates = normalizeCandidateItems(batch?.candidateItems)
  const detailCandidates = await loadIeltsPreviewCandidateDetails({
    words: words.filter((word) => !batchCandidates.some((item) => item.lemma === word && item.previewContext)),
    fetchImpl,
    endpoint: candidateEndpoint,
    poolId,
  })
  const fallbackByLemma = mergeCandidateItems([
    ...batchCandidates,
    ...detailCandidates,
    ...(Array.isArray(fallbackItems) ? fallbackItems : []),
  ])
  const hydrated = await mapWithConcurrency(words, concurrency, (word) => hydratePreviewWord({
    date,
    word,
    fallbackItem: fallbackByLemma.get(word),
    fetchImpl,
    localSentenceEndpoint,
    ecdictEndpoint,
    candidateEndpoint,
  }))
  const items = importVocabularyPreview({
    schemaVersion: FIRST_CONTACT_PREVIEW_SCHEMA,
    batchTitle: normalizeText(batchTitle) || DEFAULT_BATCH_TITLE.replace('{date}', date),
    items: hydrated,
  })
  if (items.length !== words.length) {
    throw new Error(`雅思每日预习批次只生成了 ${items.length}/${words.length} 个单词`)
  }
  return items
}

function emptyAllocations() {
  return {
    schemaVersion: IELTS_DAILY_PREVIEW_ALLOCATIONS_SCHEMA,
    batches: [],
    assignedLemmas: [],
  }
}

function normalizeAllocations(value) {
  const source = value && typeof value === 'object' ? value : {}
  const rawBatches = Array.isArray(source.batches)
    ? source.batches.map((batch) => [batch?.date, batch])
    : Object.entries(source.batches || {})
  const batches = rawBatches
    .map(([date, value]) => {
      const batch = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : { words: value }
      const words = normalizeWords(batch.words)
      const candidateItems = normalizeCandidateItems(batch.candidateItems)
        .filter((item) => words.includes(item.lemma))
      return {
        date: normalizeDate(date),
        words,
        ...(candidateItems.length ? { candidateItems } : {}),
      }
    })
    .filter((batch) => batch.date && batch.words.length > 0)
    .sort((left, right) => left.date.localeCompare(right.date))
  const assigned = new Set(normalizeWords(source.assignedLemmas))
  batches.forEach((batch) => batch.words.forEach((word) => assigned.add(word)))
  return {
    schemaVersion: IELTS_DAILY_PREVIEW_ALLOCATIONS_SCHEMA,
    batches,
    assignedLemmas: [...assigned],
  }
}

function normalizeContinuation(saved) {
  const value = saved && typeof saved === 'object' ? saved : {}
  return {
    schemaVersion: IELTS_DAILY_PREVIEW_CONTINUATION_SCHEMA,
    consumedBatchDates: uniqueDates(value.consumedBatchDates),
    lastLoadedBatchDate: normalizeDate(value.lastLoadedBatchDate),
    updatedAt: normalizeIso(value.updatedAt),
  }
}

async function hydratePreviewWord({
  date,
  word,
  fallbackItem,
  fetchImpl,
  localSentenceEndpoint,
  ecdictEndpoint,
}) {
  const localPayload = await lookupLocalSentenceDictionary({
    word,
    fetchImpl,
    endpoint: localSentenceEndpoint,
  })
  const localSense = normalizeLocalSense(localPayload?.primarySense)
  const fallbackMeaning = normalizeText(fallbackItem?.primaryMeaningZh)

  let dictionaryEntry = null
  if (!localSense?.meaningZh) {
    dictionaryEntry = selectDictionaryEntry(await lookupEcdict({
      word,
      fetchImpl,
      endpoint: ecdictEndpoint,
    }))
  }

  const ecdictMeaning = selectEcdictMeaning(dictionaryEntry)
  const primaryMeaningZh = localSense?.meaningZh || ecdictMeaning || fallbackMeaning || FALLBACK_MEANING
  const isLocalResolved = Boolean(localSense?.meaningZh)
  const isFallbackResolved = !isLocalResolved
    && !ecdictMeaning
    && fallbackItem?.primarySenseStatus === 'resolved'

  return {
    schemaVersion: FIRST_CONTACT_PREVIEW_SCHEMA,
    id: `ielts-reading:${date}:${word}`,
    lemma: word,
    word: normalizeText(fallbackItem?.word) || word,
    form: normalizeText(fallbackItem?.form) || word,
    pos: normalizeText(localSense?.partOfSpeech)
      || normalizeText(fallbackItem?.pos || fallbackItem?.partOfSpeech)
      || normalizeText(dictionaryEntry?.pos),
    phonetic: normalizeText(fallbackItem?.phonetic) || normalizeText(dictionaryEntry?.phonetic),
    source: normalizeText(fallbackItem?.source) || `ielts-reading-daily:${date}`,
    primaryMeaningZh,
    primarySenseStatus: isLocalResolved || isFallbackResolved ? 'resolved' : 'suggested',
    primarySenseReason: isLocalResolved
      ? '本地阅读词典已提供首要义项'
      : ecdictMeaning
        ? '本地阅读词典缺少首要义项，使用 ECDICT 首项作为预习提示'
        : fallbackMeaning
          ? '沿用已有批次的预习义项'
          : '本地词典暂未提供中文义项，先保留该词等待后续补全',
    targetSenseKey: localSense?.meaningZh
      ? `local-primary:${word}:${normalizeText(localSense.partOfSpeech)}:${localSense.meaningZh}`
      : normalizeText(fallbackItem?.targetSenseKey)
        || `ielts-reading-daily:${word}:${primaryMeaningZh}`,
    realSentence: fallbackItem?.realSentence || null,
    previewContext: normalizePreviewContext(fallbackItem?.previewContext),
  }
}

async function lookupLocalSentenceDictionary({ word, fetchImpl, endpoint }) {
  if (typeof fetchImpl !== 'function' || !endpoint) return null
  try {
    const params = new URLSearchParams({ word, lemma: word, limit: '1', maxWords: '20' })
    const response = await fetchImpl(`${endpoint}?${params}`, { method: 'GET' })
    if (!response?.ok) return null
    return await response.json()
  } catch (_error) {
    return null
  }
}

async function lookupEcdict({ word, fetchImpl, endpoint }) {
  if (typeof fetchImpl !== 'function' || !endpoint) return null
  try {
    const separator = endpoint.includes('?') ? '&' : '?'
    const response = await fetchImpl(`${endpoint}${separator}q=${encodeURIComponent(word).replace(/'/g, '%27')}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    if (!response?.ok) return null
    return await response.json()
  } catch (_error) {
    return null
  }
}

function selectDictionaryEntry(payload) {
  if (!payload?.available) return null
  return payload.directMatch
    || payload.normalizedCandidates?.[0]
    || payload.lemmaCandidates?.[0]?.entry
    || null
}

function normalizeLocalSense(value) {
  if (!value || typeof value !== 'object') return null
  const meaningZh = normalizeText(value.meaningZh)
  if (!meaningZh) return null
  return {
    meaningZh,
    partOfSpeech: normalizeText(value.partOfSpeech),
  }
}

function selectEcdictMeaning(entry) {
  if (!entry || typeof entry !== 'object') return ''
  const raw = normalizeText(entry.translation || entry.definition)
  if (!raw) return ''
  const firstMeaning = raw
    .split(/[\r\n]+/u)
    .map((line) => line.replace(/^(?:n|v|a|adj|adv|pron|prep|conj|vt|vi)\.?\s*/iu, '').trim())
    .flatMap((line) => line.split(/[;,；，]/u))
    .map((value) => value.trim())
    .find(Boolean)
  return normalizeText(firstMeaning)
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const source = Array.isArray(values) ? values : []
  const result = new Array(source.length)
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(source.length || 1, Math.floor(Number(concurrency) || 1)))
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < source.length) {
      const index = nextIndex
      nextIndex += 1
      result[index] = await mapper(source[index], index)
    }
  }))
  return result
}

function normalizeWords(value) {
  const source = Array.isArray(value) ? value : []
  const seen = new Set()
  const words = []
  source.forEach((item) => {
    const word = normalizeWord(typeof item === 'string' ? item : item?.lemma || item?.word)
    if (!word || seen.has(word)) return
    seen.add(word)
    words.push(word)
  })
  return words
}

function normalizeCandidateItems(value) {
  const source = Array.isArray(value) ? value : []
  const seen = new Set()
  const items = []
  source.forEach((input) => {
    const lemma = normalizeWord(typeof input === 'string' ? input : input?.lemma || input?.word)
    if (!lemma || seen.has(lemma)) return
    seen.add(lemma)
    if (typeof input === 'string') {
      items.push({ lemma })
      return
    }
    items.push({
      ...input,
      lemma,
      word: normalizeText(input?.word) || lemma,
      form: normalizeText(input?.form) || normalizeText(input?.word) || lemma,
      pos: normalizeText(input?.pos || input?.partOfSpeech),
      phonetic: normalizeText(input?.phonetic),
      primaryMeaningZh: normalizeText(input?.primaryMeaningZh || input?.meaning || input?.translation),
      targetSenseKey: normalizeText(input?.targetSenseKey),
      previewContext: normalizePreviewContext(input?.previewContext),
    })
  })
  return items
}

function mergeCandidateItems(values) {
  const merged = new Map()
  values.forEach((value) => {
    const item = normalizeCandidateItems([value])[0]
    if (!item) return
    const previous = merged.get(item.lemma) || {}
    merged.set(item.lemma, {
      ...previous,
      ...item,
      word: item.word || previous.word || item.lemma,
      form: item.form || previous.form || item.lemma,
      pos: item.pos || previous.pos || '',
      phonetic: item.phonetic || previous.phonetic || '',
      primaryMeaningZh: item.primaryMeaningZh || previous.primaryMeaningZh || '',
      targetSenseKey: item.targetSenseKey || previous.targetSenseKey || '',
      realSentence: item.realSentence || previous.realSentence || null,
      previewContext: item.previewContext || previous.previewContext || null,
    })
  })
  return merged
}

function normalizePreviewContext(value) {
  if (!value || typeof value !== 'object') return null
  const sentence = normalizeText(value.sentence)
  if (!sentence) return null
  return {
    ...value,
    sentence,
    surrounding_text: normalizeText(value.surrounding_text || value.surroundingText) || null,
    source_kind: normalizeText(value.source_kind || value.sourceKind) || 'user_local_exam_material',
    source_id: normalizeText(value.source_id || value.sourceId),
    source_title: normalizeText(value.source_title || value.sourceTitle),
    source_locator: value.source_locator || value.sourceLocator || null,
    license_kind: normalizeText(value.license_kind || value.licenseKind) || 'user_owned',
    ownership: normalizeText(value.ownership) || 'private',
    quality_status: normalizeText(value.quality_status || value.qualityStatus) || 'validated',
  }
}

function uniqueDates(value) {
  const seen = new Set()
  return (Array.isArray(value) ? value : [])
    .map(normalizeDate)
    .filter((date) => date && !seen.has(date) && seen.add(date))
}

function normalizeWord(value) {
  const word = normalizeText(value).toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) ? word : ''
}

function normalizeDate(value) {
  const date = normalizeText(value)
  const match = date.match(BATCH_DATE_PATTERN)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const candidate = new Date(Date.UTC(year, month - 1, day))
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
    ? date
    : ''
}

function formatDate(value) {
  const year = value.getUTCFullYear()
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeIso(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (_error) {
    return fallback
  }
}
