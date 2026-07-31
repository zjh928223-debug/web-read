export const PASSAGE_PREVIEW_DATA_KEY = 'vocabulary.passage-preview.data.v2'
export const PASSAGE_PREVIEW_PROGRESS_KEY = 'vocabulary.passage-preview.progress.v2'
export const LEGACY_PASSAGE_PREVIEW_DATA_KEY = 'vocabulary.passage-preview.data.v1'
export const LEGACY_PASSAGE_PREVIEW_PROGRESS_KEY = 'vocabulary.passage-preview.progress.v1'

export function loadPassagePreviewData(storage = globalThis.localStorage) {
  const envelope = readJson(storage, PASSAGE_PREVIEW_DATA_KEY, null)
  return envelope?.schemaVersion === 'passage-preview.local-data.v2' && Array.isArray(envelope.items)
    ? envelope.items
    : []
}

export function hasLegacyPassagePreviewData(storage = globalThis.localStorage) {
  return Array.isArray(readJson(storage, LEGACY_PASSAGE_PREVIEW_DATA_KEY, null))
}

export function savePassagePreviewData(items, storage = globalThis.localStorage) {
  storage.setItem(PASSAGE_PREVIEW_DATA_KEY, JSON.stringify({
    schemaVersion: 'passage-preview.local-data.v2',
    items: Array.isArray(items) ? items : [],
  }))
  const existing = loadPassagePreviewProgress(storage)
  savePassagePreviewProgress(existing, storage)
}

export function loadPassagePreviewProgress(storage = globalThis.localStorage) {
  const saved = readJson(
    storage,
    PASSAGE_PREVIEW_PROGRESS_KEY,
    readJson(storage, LEGACY_PASSAGE_PREVIEW_PROGRESS_KEY, null),
  )
  const initial = createInitialPassagePreviewProgress()
  if (!saved || typeof saved !== 'object') return initial
  return {
    status: ['not_started', 'in_progress', 'completed'].includes(saved.status)
      ? saved.status
      : initial.status,
    currentIndex: Math.max(0, Math.min(4, Number(saved.currentIndex) || 0)),
    revealed: normalizeBooleanMap(saved.revealed),
    contextExpanded: normalizeBooleanMap(saved.contextExpanded || saved.sentenceExpanded),
    startedAt: normalizeIso(saved.startedAt),
    completedAt: normalizeIso(saved.completedAt),
  }
}

export function savePassagePreviewProgress(progress, storage = globalThis.localStorage) {
  storage.setItem(PASSAGE_PREVIEW_PROGRESS_KEY, JSON.stringify({
    ...createInitialPassagePreviewProgress(),
    ...progress,
  }))
}

export function createInitialPassagePreviewProgress() {
  return {
    status: 'not_started',
    currentIndex: 0,
    revealed: {},
    contextExpanded: {},
    startedAt: null,
    completedAt: null,
  }
}

function normalizeBooleanMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => [String(key), true]),
  )
}

function normalizeIso(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (_error) {
    return fallback
  }
}
