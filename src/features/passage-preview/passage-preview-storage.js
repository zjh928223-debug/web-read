import {
  getAuthoritativeWindowsOwner,
  ownerRecordContent,
  ownerResponseRecords,
  requireOwnerCommitted,
  requireOwnerRead,
  stableOwnerIdempotencyKey,
} from '../../services/windows-owner-domain-adapter.js'

export const PASSAGE_PREVIEW_DATA_KEY = 'vocabulary.passage-preview.data.v2'
export const PASSAGE_PREVIEW_PROGRESS_KEY = 'vocabulary.passage-preview.progress.v2'
export const LEGACY_PASSAGE_PREVIEW_DATA_KEY = 'vocabulary.passage-preview.data.v1'
export const LEGACY_PASSAGE_PREVIEW_PROGRESS_KEY = 'vocabulary.passage-preview.progress.v1'

const PASSAGE_PREVIEW_OWNER_DOMAIN = 'passage-preview'
const PASSAGE_PREVIEW_DURABLE_KEY = 'vocabulary.passage-preview.durable-state.v1'
const PASSAGE_PREVIEW_DURABLE_SCHEMA = 'passage-preview.durable-state.v1'

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
  if (isPassagePreviewOwnerAuthoritative()) {
    return commitPassagePreviewOwnerDurableUpdate((state) => ({
      ...state,
      batchId: derivePassagePreviewBatchId(data),
      data,
      progress: state.progress || createInitialPassagePreviewProgress(),
    }), {
      extraRecords: (state) => ({
        [PASSAGE_PREVIEW_DATA_KEY]: {
          schemaVersion: 'passage-preview.local-data.v2',
          items: data,
        },
      }),
    })
  }
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
  if (isPassagePreviewOwnerAuthoritative()) {
    return commitPassagePreviewOwnerDurableUpdate((state) => ({
      ...state,
      progress: normalized,
    }), {
      extraRecords: () => ({
        [PASSAGE_PREVIEW_PROGRESS_KEY]: {
          schemaVersion: 'passage-preview.local-progress.v2',
          ...normalized,
        },
      }),
    })
  }
  updatePassagePreviewDurableState((state) => ({ ...state, progress: normalized }), storage, {
    data: loadLegacyData(storage),
    progress: loadLegacyProgress(storage),
  })
}

export function isPassagePreviewOwnerAuthoritative(windowObject = globalThis) {
  return Boolean(getAuthoritativeWindowsOwner(PASSAGE_PREVIEW_OWNER_DOMAIN, windowObject))
}

export async function loadPassagePreviewDataFromOwner(windowObject = globalThis) {
  const snapshot = await readPassagePreviewOwnerRecords(windowObject)
  if (!snapshot) return null
  const durable = ownerRecordContent(snapshot.records[PASSAGE_PREVIEW_DURABLE_KEY])
  if (Array.isArray(durable?.data)) return durable.data
  const current = ownerRecordContent(snapshot.records[PASSAGE_PREVIEW_DATA_KEY])
  return Array.isArray(current?.items) ? current.items : Array.isArray(current) ? current : []
}

export async function loadPassagePreviewProgressFromOwner(windowObject = globalThis) {
  const snapshot = await readPassagePreviewOwnerRecords(windowObject)
  if (!snapshot) return null
  const durable = ownerRecordContent(snapshot.records[PASSAGE_PREVIEW_DURABLE_KEY])
  const current = durable?.progress || ownerRecordContent(snapshot.records[PASSAGE_PREVIEW_PROGRESS_KEY])
  return normalizeProgress(current)
}

export async function loadPassagePreviewRecordsFromOwner(windowObject = globalThis) {
  const snapshot = await readPassagePreviewOwnerRecords(windowObject)
  if (!snapshot) return null
  return Object.fromEntries(Object.entries(snapshot.records).map(([key, record]) => [
    key,
    ownerRecordContent(record),
  ]))
}

export async function commitPassagePreviewOwnerRecords(records, options = {}, windowObject = globalThis) {
  const snapshot = await readPassagePreviewOwnerRecords(windowObject)
  if (!snapshot) return null
  const normalizedRecords = Object.fromEntries(Object.entries(records || {}).map(([key, content]) => [
    key,
    { id: key, content: cloneOwnerValue(content) },
  ]))
  const expectedRevision = options.expectedRevision === undefined
    ? snapshot.revision
    : options.expectedRevision
  const idempotencyKey = options.idempotencyKey
    || stableOwnerIdempotencyKey('pass-preview', {
      operation: options.operation || 'legacy-import',
      expectedRevision,
      records: normalizedRecords,
    })
  const response = await snapshot.owner.command({
    domain: PASSAGE_PREVIEW_OWNER_DOMAIN,
    operation: options.operation || 'legacy-import',
    payload: { records: normalizedRecords },
    expectedRevision,
    idempotencyKey,
  })
  return requireOwnerCommitted(response, PASSAGE_PREVIEW_OWNER_DOMAIN)
}

export async function commitPassagePreviewOwnerDurableUpdate(mutator, options = {}, windowObject = globalThis) {
  const snapshot = await readPassagePreviewOwnerRecords(windowObject)
  if (!snapshot) return null
  const current = ownerRecordContent(snapshot.records[PASSAGE_PREVIEW_DURABLE_KEY])
  const base = current && typeof current === 'object' && !Array.isArray(current)
    ? cloneOwnerValue(current)
    : {
      schemaVersion: PASSAGE_PREVIEW_DURABLE_SCHEMA,
      revision: 0,
      batchId: null,
      data: [],
      progress: createInitialPassagePreviewProgress(),
      allocations: null,
      continuation: null,
      archive: [],
    }
  const changed = typeof mutator === 'function' ? (mutator(base) || base) : base
  const innerRevision = Number.isInteger(base.revision) && base.revision >= 0 ? base.revision : 0
  const durable = {
    ...changed,
    schemaVersion: PASSAGE_PREVIEW_DURABLE_SCHEMA,
    revision: innerRevision + 1,
  }
  const extras = typeof options.extraRecords === 'function'
    ? options.extraRecords(durable, snapshot.records)
    : options.extraRecords
  const response = await commitPassagePreviewOwnerRecords({
    [PASSAGE_PREVIEW_DURABLE_KEY]: durable,
    ...(extras && typeof extras === 'object' ? extras : {}),
  }, options, windowObject)
  return { state: durable, response, revision: response.revision }
}

async function readPassagePreviewOwnerRecords(windowObject) {
  const owner = getAuthoritativeWindowsOwner(PASSAGE_PREVIEW_OWNER_DOMAIN, windowObject)
  if (!owner) return null
  const response = requireOwnerRead(await owner.query({
    domain: PASSAGE_PREVIEW_OWNER_DOMAIN,
    operation: 'legacy-keys',
    payload: {},
  }), PASSAGE_PREVIEW_OWNER_DOMAIN)
  return {
    owner,
    response,
    revision: Number.isInteger(response.revision) ? response.revision : 0,
    records: ownerResponseRecords(response),
  }
}

function cloneOwnerValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
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
