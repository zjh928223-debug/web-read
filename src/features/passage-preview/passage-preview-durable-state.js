import { assertWindowsOwnerBrowserWriterAllowed } from '../../services/windows-owner-domain-cutover.js'

export const PASSAGE_PREVIEW_DURABLE_KEY = 'vocabulary.passage-preview.durable-state.v1'
export const PASSAGE_PREVIEW_DURABLE_SCHEMA = 'passage-preview.durable-state.v1'

export function loadPassagePreviewDurableState(storage = globalThis.localStorage, legacy = {}) {
  const inspected = inspectPassagePreviewDurableState(storage, legacy)
  if (inspected.status === 'unknown-schema') {
    throw persistenceError('PASSAGE_PREVIEW_SCHEMA_UNSUPPORTED', 'Unsupported Passage Preview durable state schema', {
      schemaVersion: inspected.schemaVersion,
    })
  }
  if (inspected.status === 'corrupt') {
    throw persistenceError('PASSAGE_PREVIEW_STATE_CORRUPT', 'Passage Preview durable state is corrupt')
  }
  return inspected.state
}

export function inspectPassagePreviewDurableState(storage = globalThis.localStorage, legacy = {}) {
  const result = readJson(storage, PASSAGE_PREVIEW_DURABLE_KEY)
  const legacyState = normalizeState({
    schemaVersion: PASSAGE_PREVIEW_DURABLE_SCHEMA,
    revision: 0,
    batchId: legacy.batchId || null,
    data: legacy.data || [],
    progress: legacy.progress || null,
    allocations: legacy.allocations || null,
    continuation: legacy.continuation || null,
    archive: legacy.archive || [],
    learningHistory: legacy.learningHistory || null,
    learningSettings: legacy.learningSettings || null,
  })
  if (result.status === 'missing') return { status: 'not-found', state: legacyState }
  if (result.status === 'corrupt') {
    return { status: hasLegacyState(legacy) ? 'recovered-legacy' : 'corrupt', state: legacyState, error: result.error }
  }
  const saved = result.value
  if (saved?.schemaVersion !== PASSAGE_PREVIEW_DURABLE_SCHEMA) {
    return { status: 'unknown-schema', schemaVersion: saved?.schemaVersion ?? null, state: legacyState }
  }
  if (!Number.isInteger(saved.revision) || saved.revision < 0) {
    return { status: 'corrupt', state: legacyState, error: persistenceError('PASSAGE_PREVIEW_STATE_CORRUPT', 'Passage Preview durable state is corrupt') }
  }
  return { status: 'loaded', state: normalizeState(saved) }
}

export function updatePassagePreviewDurableState(mutator, storage = globalThis.localStorage, legacy = {}, options = {}) {
  assertWindowsOwnerBrowserWriterAllowed('passage-preview', 'durable-state-update')
  const current = loadPassagePreviewDurableState(storage, legacy)
  if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
    throw persistenceError('PASSAGE_PREVIEW_REVISION_CONFLICT', 'Passage Preview durable state changed in another owner', {
      expectedRevision: options.expectedRevision,
      actualRevision: current.revision,
    })
  }
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
    learningHistory: value.learningHistory && typeof value.learningHistory === 'object'
      ? value.learningHistory
      : null,
    learningSettings: value.learningSettings && typeof value.learningSettings === 'object'
      ? value.learningSettings
      : null,
  }
}

function readJson(storage, key) {
  try {
    const raw = storage?.getItem(key)
    return raw ? { status: 'loaded', value: JSON.parse(raw) } : { status: 'missing', value: null }
  } catch (error) {
    return { status: 'corrupt', value: null, error }
  }
}

function hasLegacyState(legacy) {
  return Boolean(legacy && (legacy.batchId || legacy.progress || legacy.allocations || legacy.continuation
    || legacy.learningHistory || legacy.learningSettings || (Array.isArray(legacy.data) && legacy.data.length)
    || (Array.isArray(legacy.archive) && legacy.archive.length)))
}

function persistenceError(code, message, details = {}) {
  return Object.assign(new Error(message), { name: 'PassagePreviewPersistenceError', code, ...details })
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
