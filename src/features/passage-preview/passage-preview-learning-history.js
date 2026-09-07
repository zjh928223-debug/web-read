import {
  derivePassagePreviewBatchId,
  loadPassagePreviewDurableState,
  PASSAGE_PREVIEW_DURABLE_KEY,
  updatePassagePreviewDurableState,
} from './passage-preview-durable-state.js'
import {
  commitPassagePreviewOwnerDurableUpdate,
  isPassagePreviewOwnerAuthoritative,
  loadPassagePreviewRecordsFromOwner,
} from './passage-preview-storage.js'

export const PASSAGE_PREVIEW_LEARNING_HISTORY_SCHEMA = 'passage-preview.learning-history.v1'
export const PASSAGE_PREVIEW_LEARNING_SESSION_SCHEMA = 'passage-preview.learning-session.v1'
export const PASSAGE_PREVIEW_LEARNING_HISTORY_FIELD = 'learningHistory'
export const PASSAGE_PREVIEW_LEARNING_HISTORY_KEY = 'vocabulary.passage-preview.learning-history.v1'
export const PASSAGE_PREVIEW_ADAPTIVE_PLAN_SCHEMA = 'passage-preview.adaptive-plan.v1'
export const PASSAGE_PREVIEW_LEARNING_SETTINGS_SCHEMA = 'passage-preview.learning-settings.v1'
export const PASSAGE_PREVIEW_LEARNING_SETTINGS_FIELD = 'learningSettings'
export const PASSAGE_PREVIEW_DEFAULT_BATCH_SIZE = 20
export const PASSAGE_PREVIEW_MIN_BATCH_SIZE = 1
export const PASSAGE_PREVIEW_MAX_BATCH_SIZE = 200

// Difficulty progress is based on completed preview groups. Calendar dates are
// retained for learning-time reports, but a missed day does not block progress
// and multiple groups on one day count as multiple completed sessions.
export const IELTS_ADAPTIVE_PREVIEW_STAGES = Object.freeze([
  Object.freeze({ stage: 0, minCompletedSessions: 0, minBook: 4, maxBook: 6, label: 'Book 4–6' }),
  Object.freeze({ stage: 1, minCompletedSessions: 5, minBook: 4, maxBook: 8, label: 'Book 4–8' }),
  Object.freeze({ stage: 2, minCompletedSessions: 15, minBook: 4, maxBook: 10, label: 'Book 4–10' }),
  Object.freeze({ stage: 3, minCompletedSessions: 30, minBook: 4, maxBook: 13, label: 'Book 4–13' }),
  Object.freeze({ stage: 4, minCompletedSessions: 50, minBook: 4, maxBook: 16, label: 'Book 4–16' }),
  Object.freeze({ stage: 5, minCompletedSessions: 80, minBook: 4, maxBook: 18, label: 'Book 4–18' }),
  Object.freeze({ stage: 6, minCompletedSessions: 120, minBook: 4, maxBook: 21, label: 'Book 4–21' }),
])

export function createDefaultPassagePreviewLearningSettings() {
  return {
    schemaVersion: PASSAGE_PREVIEW_LEARNING_SETTINGS_SCHEMA,
    batchSize: PASSAGE_PREVIEW_DEFAULT_BATCH_SIZE,
  }
}

export function normalizePassagePreviewLearningSettings(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    schemaVersion: PASSAGE_PREVIEW_LEARNING_SETTINGS_SCHEMA,
    batchSize: normalizeBatchSize(source.batchSize),
  }
}

export function createEmptyPassagePreviewLearningHistory() {
  return {
    schemaVersion: PASSAGE_PREVIEW_LEARNING_HISTORY_SCHEMA,
    sessions: [],
    dailySummaries: [],
    updatedAt: null,
  }
}

export function normalizePassagePreviewLearningHistory(value) {
  const source = value && typeof value === 'object' ? value : {}
  const sessions = (Array.isArray(source.sessions) ? source.sessions : [])
    .map(normalizeLearningSession)
    .filter(Boolean)
    .sort(compareSessions)
  return {
    schemaVersion: PASSAGE_PREVIEW_LEARNING_HISTORY_SCHEMA,
    sessions,
    dailySummaries: buildDailySummaries(sessions),
    updatedAt: normalizeIso(source.updatedAt) || (sessions.at(-1)?.recordedAt || null),
  }
}

export function createPassagePreviewLearningSession({
  batchId = '',
  items = [],
  progress = {},
  revealedAtByItem = {},
  timeZone = detectTimeZone(),
  calendarDate = '',
  now = new Date(),
} = {}) {
  const nowIso = normalizeIso(now) || new Date().toISOString()
  const startedAt = normalizeIso(progress?.startedAt) || nowIso
  const completedAt = normalizeIso(progress?.completedAt) || nowIso
  const normalizedItems = normalizeSessionItems(items, revealedAtByItem, completedAt, timeZone)
  const normalizedBatchId = normalizeText(batchId) || derivePassagePreviewBatchId(items) || `batch:${hashText(normalizedItems.map((item) => item.id).join('\u001f'))}`
  const normalizedDate = normalizeDate(calendarDate)
    || calendarDateForIso(startedAt, timeZone)
    || calendarDateForIso(completedAt, timeZone)
  const sessionId = `preview:${normalizedBatchId}:${startedAt}`
  const elapsed = Number(progress?.durationMs)
  const durationMs = Number.isFinite(elapsed) && elapsed >= 0
    ? Math.floor(elapsed)
    : Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime())
  return normalizeLearningSession({
    schemaVersion: PASSAGE_PREVIEW_LEARNING_SESSION_SCHEMA,
    sessionId,
    batchId: normalizedBatchId,
    calendarDate: normalizedDate,
    timeZone: normalizeText(timeZone) || 'local',
    status: 'completed',
    startedAt,
    completedAt,
    durationMs,
    itemCount: normalizedItems.length,
    items: normalizedItems,
    recordedAt: nowIso,
  })
}

export function upsertPassagePreviewLearningSession(history, session) {
  const current = normalizePassagePreviewLearningHistory(history)
  const nextSession = normalizeLearningSession(session)
  if (!nextSession) return current
  const sessions = current.sessions.filter((item) => item.sessionId !== nextSession.sessionId)
  sessions.push(nextSession)
  sessions.sort(compareSessions)
  const timestamps = [current.updatedAt, nextSession.recordedAt, nextSession.completedAt]
    .map(normalizeIso)
    .filter(Boolean)
  return {
    schemaVersion: PASSAGE_PREVIEW_LEARNING_HISTORY_SCHEMA,
    sessions,
    dailySummaries: buildDailySummaries(sessions),
    updatedAt: timestamps.sort().at(-1) || null,
  }
}

export function getIeltsAdaptivePreviewPlan(
  history,
  { stages = IELTS_ADAPTIVE_PREVIEW_STAGES, batchSize = PASSAGE_PREVIEW_DEFAULT_BATCH_SIZE } = {},
) {
  const normalized = normalizePassagePreviewLearningHistory(history)
  const completedSessions = normalized.sessions
    .filter((session) => session.status === 'completed').length
  const completedDays = new Set(
    normalized.sessions
      .filter((session) => session.status === 'completed' && session.completedAt && session.calendarDate)
      .map((session) => session.calendarDate),
  ).size
  const orderedStages = (Array.isArray(stages) && stages.length ? stages : IELTS_ADAPTIVE_PREVIEW_STAGES)
    .filter((stage) => stage && Number.isInteger(stage.stage))
    .sort((left, right) => left.minCompletedSessions - right.minCompletedSessions)
  const selected = orderedStages.reduce(
    (current, stage) => stage.minCompletedSessions <= completedSessions ? stage : current,
    orderedStages[0] || IELTS_ADAPTIVE_PREVIEW_STAGES[0],
  )
  return {
    schemaVersion: PASSAGE_PREVIEW_ADAPTIVE_PLAN_SCHEMA,
    stage: selected.stage,
    completedSessions,
    completedDays,
    batchSize: normalizeBatchSize(batchSize),
    minBook: Math.max(1, Math.floor(Number(selected.minBook) || 4)),
    maxBook: Math.max(1, Math.floor(Number(selected.maxBook) || 21)),
    label: normalizeText(selected.label) || `Book ${selected.minBook}–${selected.maxBook}`,
    updatedAt: normalized.updatedAt,
  }
}

export async function loadPassagePreviewLearningSettings(
  storage = globalThis.localStorage,
  windowObject = globalThis,
) {
  const ownerRecords = await loadPassagePreviewRecordsFromOwner(windowObject, ['durable-state'])
  if (ownerRecords) {
    return normalizePassagePreviewLearningSettings(
      ownerRecords[PASSAGE_PREVIEW_DURABLE_KEY]?.[PASSAGE_PREVIEW_LEARNING_SETTINGS_FIELD],
    )
  }
  return normalizePassagePreviewLearningSettings(loadPassagePreviewDurableState(storage).learningSettings)
}

export async function savePassagePreviewLearningSettings(
  settings,
  storage = globalThis.localStorage,
  windowObject = globalThis,
) {
  const normalized = normalizePassagePreviewLearningSettings(settings)
  if (isPassagePreviewOwnerAuthoritative(windowObject)) {
    await commitPassagePreviewOwnerDurableUpdate(
      (state) => ({ ...state, [PASSAGE_PREVIEW_LEARNING_SETTINGS_FIELD]: normalized }),
      {},
      windowObject,
    )
    return normalized
  }
  updatePassagePreviewDurableState(
    (state) => ({ ...state, [PASSAGE_PREVIEW_LEARNING_SETTINGS_FIELD]: normalized }),
    storage,
    { learningSettings: normalized },
  )
  return normalized
}

export async function loadPassagePreviewLearningHistory(
  storage = globalThis.localStorage,
  windowObject = globalThis,
) {
  const ownerRecords = await loadPassagePreviewRecordsFromOwner(windowObject, ['durable-state'])
  if (ownerRecords) {
    return normalizePassagePreviewLearningHistory(
      ownerRecords[PASSAGE_PREVIEW_DURABLE_KEY]?.[PASSAGE_PREVIEW_LEARNING_HISTORY_FIELD],
    )
  }
  return normalizePassagePreviewLearningHistory(loadPassagePreviewDurableState(storage).learningHistory)
}

export async function savePassagePreviewLearningSession(
  session,
  storage = globalThis.localStorage,
  windowObject = globalThis,
) {
  const current = await loadPassagePreviewLearningHistory(storage, windowObject)
  const next = upsertPassagePreviewLearningSession(current, session)
  if (isPassagePreviewOwnerAuthoritative(windowObject)) {
    await commitPassagePreviewOwnerDurableUpdate(
      (state) => ({ ...state, [PASSAGE_PREVIEW_LEARNING_HISTORY_FIELD]: next }),
      {},
      windowObject,
    )
    return next
  }
  updatePassagePreviewDurableState(
    (state) => ({ ...state, [PASSAGE_PREVIEW_LEARNING_HISTORY_FIELD]: next }),
    storage,
    { learningHistory: current },
  )
  return next
}

function normalizeLearningSession(value) {
  if (!value || typeof value !== 'object') return null
  const sessionId = normalizeText(value.sessionId)
  const batchId = normalizeText(value.batchId)
  const calendarDate = normalizeDate(value.calendarDate)
  const startedAt = normalizeIso(value.startedAt)
  const completedAt = normalizeIso(value.completedAt)
  const items = normalizeSessionItems(value.items, {}, completedAt || new Date().toISOString(), value.timeZone)
  if (!sessionId || !batchId || !calendarDate || !startedAt || !completedAt || !items.length) return null
  const rawDuration = Number(value.durationMs)
  const durationMs = Number.isFinite(rawDuration) && rawDuration >= 0
    ? Math.floor(rawDuration)
    : Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime())
  return {
    schemaVersion: PASSAGE_PREVIEW_LEARNING_SESSION_SCHEMA,
    sessionId,
    batchId,
    calendarDate,
    timeZone: normalizeText(value.timeZone) || 'local',
    status: 'completed',
    startedAt,
    completedAt,
    durationMs,
    itemCount: items.length,
    items,
    recordedAt: normalizeIso(value.recordedAt) || completedAt,
  }
}

function normalizeSessionItems(value, revealedAtByItem = {}, fallbackAt = new Date().toISOString(), timeZone = '') {
  const source = Array.isArray(value) ? value : []
  const seen = new Set()
  return source.map((item) => {
    const id = normalizeText(item?.id)
    const lemma = normalizeWord(item?.lemma || item?.word)
    if (!id || !lemma || seen.has(id)) return null
    seen.add(id)
    const learnedAt = normalizeIso(revealedAtByItem?.[id] || item?.learnedAt) || fallbackAt
    const difficultyBook = normalizeBook(item?.ieltsDifficultyBook || item?.difficultyBook)
    return {
      id,
      lemma,
      word: normalizeText(item?.word) || lemma,
      calendarDate: calendarDateForIso(learnedAt, timeZone) || null,
      learnedAt,
      ...(difficultyBook ? { ieltsDifficultyBook: difficultyBook } : {}),
    }
  }).filter(Boolean)
}

function buildDailySummaries(sessions) {
  const byDate = new Map()
  sessions.forEach((session) => {
    const current = byDate.get(session.calendarDate) || {
      calendarDate: session.calendarDate,
      sessionCount: 0,
      wordCount: 0,
      durationMs: 0,
      firstStartedAt: session.startedAt,
      lastCompletedAt: session.completedAt,
    }
    current.sessionCount += 1
    current.wordCount += session.items.length
    current.durationMs += session.durationMs
    if (session.startedAt < current.firstStartedAt) current.firstStartedAt = session.startedAt
    if (session.completedAt > current.lastCompletedAt) current.lastCompletedAt = session.completedAt
    byDate.set(session.calendarDate, current)
  })
  return [...byDate.values()].sort((left, right) => left.calendarDate.localeCompare(right.calendarDate))
}

function compareSessions(left, right) {
  return String(left.completedAt).localeCompare(String(right.completedAt))
    || String(left.sessionId).localeCompare(String(right.sessionId))
}

function calendarDateForIso(value, timeZone = '') {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: normalizeText(timeZone) || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return normalizeDate(`${values.year}-${values.month}-${values.day}`)
  } catch (_error) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }
}

function detectTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  } catch (_error) {
    return 'local'
  }
}

function normalizeBook(value) {
  const book = Number(value)
  return Number.isInteger(book) && book > 0 ? book : 0
}

function normalizeBatchSize(value) {
  const batchSize = Math.floor(Number(value))
  if (!Number.isFinite(batchSize) || batchSize < PASSAGE_PREVIEW_MIN_BATCH_SIZE) {
    return PASSAGE_PREVIEW_DEFAULT_BATCH_SIZE
  }
  return Math.min(PASSAGE_PREVIEW_MAX_BATCH_SIZE, batchSize)
}

function normalizeWord(value) {
  const word = normalizeText(value).toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) ? word : ''
}

function normalizeDate(value) {
  const date = normalizeText(value)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return ''
  const [year, month, day] = date.split('-').map(Number)
  const candidate = new Date(Date.UTC(year, month - 1, day))
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
    ? date
    : ''
}

function normalizeIso(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function hashText(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
