export const PASSAGE_PREVIEW_DATA_KEY = 'vocabulary.passage-preview.data.v2'
export const PASSAGE_PREVIEW_PROGRESS_KEY = 'vocabulary.passage-preview.progress.v2'
export const LEGACY_PASSAGE_PREVIEW_DATA_KEY = 'vocabulary.passage-preview.data.v1'
export const LEGACY_PASSAGE_PREVIEW_PROGRESS_KEY = 'vocabulary.passage-preview.progress.v1'

export function loadPassagePreviewData(storage = globalThis.localStorage) {
  const durable = loadPassagePreviewDurableState(storage, { data: loadLegacyData(storage) })
  if (durable.data.length) return durable.data
  return loadLegacyData(storage)
}

function loadLegacyData(storage) {
  const envelope = readJson(storage, PASSAGE_PREVIEW_DATA_KEY, null)
  return envelope?.schemaVersion === 'passage-preview.local-data.v2' && Array.isArray(envelope.items)
    ? envelope.items
    : []
}

export function hasLegacyPassagePreviewData(storage = globalThis.localStorage) {
  return Array.isArray(readJson(storage, LEGACY_PASSAGE_PREVIEW_DATA_KEY, null))
}

export function savePassagePreviewData(items, storage = globalThis.localStorage) {
  const data = Array.isArray(items) ? items : []
  updatePassagePreviewDurableState((state) => ({
    ...state,
    batchId: derivePassagePreviewBatchId(data),
    data,
    progress: state.progress || createInitialPassagePreviewProgress(),
  }), storage, { data: loadLegacyData(storage), progress: loadLegacyProgress(storage) })
}

export function loadPassagePreviewProgress(storage = globalThis.localStorage) {
  const durable = loadPassagePreviewDurableState(storage, { progress: loadLegacyProgress(storage) })
  return normalizeProgress(durable.progress)
}

function loadLegacyProgress(storage) {
  const saved = readJson(
    storage,
    PASSAGE_PREVIEW_PROGRESS_KEY,
    readJson(storage, LEGACY_PASSAGE_PREVIEW_PROGRESS_KEY, null),
  )
  return saved
}

function normalizeProgress(saved) {
  const initial = createInitialPassagePreviewProgress()
  if (!saved || typeof saved !== 'object') return initial
  return {
    status: ['not_started', 'in_progress', 'completed'].includes(saved.status)
      ? saved.status
      : initial.status,
    currentIndex: Math.max(0, Number(saved.currentIndex) || 0),
    revealed: normalizeBooleanMap(saved.revealed),
    contextExpanded: normalizeBooleanMap(saved.contextExpanded || saved.sentenceExpanded),
    startedAt: normalizeIso(saved.startedAt),
    completedAt: normalizeIso(saved.completedAt),
  }
}

export function savePassagePreviewProgress(progress, storage = globalThis.localStorage) {
  const normalized = normalizeProgress(progress)
  updatePassagePreviewDurableState((state) => ({ ...state, progress: normalized }), storage, {
    data: loadLegacyData(storage),
    progress: loadLegacyProgress(storage),
  })
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
import {
  derivePassagePreviewBatchId,
  loadPassagePreviewDurableState,
  updatePassagePreviewDurableState,
} from './passage-preview-durable-state.js'
