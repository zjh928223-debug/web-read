export const PASSAGE_PREVIEW_DURABLE_KEY = 'vocabulary.passage-preview.durable-state.v1'
export const PASSAGE_PREVIEW_DURABLE_SCHEMA = 'passage-preview.durable-state.v1'

export function loadPassagePreviewDurableState(storage = globalThis.localStorage, legacy = {}) {
  const saved = readJson(storage, PASSAGE_PREVIEW_DURABLE_KEY)
  if (saved?.schemaVersion === PASSAGE_PREVIEW_DURABLE_SCHEMA && Number.isInteger(saved.revision)) {
    return normalizeState(saved)
  }
  return normalizeState({
    schemaVersion: PASSAGE_PREVIEW_DURABLE_SCHEMA,
    revision: 0,
    batchId: legacy.batchId || null,
    data: legacy.data || [],
    progress: legacy.progress || null,
    allocations: legacy.allocations || null,
    continuation: legacy.continuation || null,
    archive: legacy.archive || [],
  })
}

export function updatePassagePreviewDurableState(mutator, storage = globalThis.localStorage, legacy = {}) {
  const current = loadPassagePreviewDurableState(storage, legacy)
  const draft = structuredCloneValue(current)
  const changed = mutator(draft) || draft
  const next = normalizeState({ ...changed, revision: current.revision + 1 })
  storage.setItem(PASSAGE_PREVIEW_DURABLE_KEY, JSON.stringify(next))
  return next
}

export function derivePassagePreviewBatchId(items) {
  const ids = (Array.isArray(items) ? items : []).map((item) => String(item?.id || '')).filter(Boolean)
  return ids.length ? `batch:${hashText(ids.join('\u001f'))}` : null
}

function normalizeState(value = {}) {
  const data = Array.isArray(value.data) ? value.data : []
  return {
    schemaVersion: PASSAGE_PREVIEW_DURABLE_SCHEMA,
    revision: Math.max(0, Number.isInteger(value.revision) ? value.revision : 0),
    batchId: String(value.batchId || '').trim() || derivePassagePreviewBatchId(data),
    data,
    progress: value.progress && typeof value.progress === 'object' ? value.progress : null,
    allocations: value.allocations && typeof value.allocations === 'object' ? value.allocations : null,
    continuation: value.continuation && typeof value.continuation === 'object' ? value.continuation : null,
    archive: Array.isArray(value.archive) ? value.archive : [],
  }
}

function readJson(storage, key) {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function structuredCloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function hashText(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
