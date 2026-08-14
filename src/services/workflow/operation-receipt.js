export const WORKFLOW_OPERATION_RECEIPT_SCHEMA_VERSION = 1
export const WORKFLOW_OPERATION_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000
export const WORKFLOW_OPERATION_RECEIPT_STORAGE_PREFIX = 'read-web.workflow-operation-receipt.v1.'
export const WORKFLOW_OPERATION_RECEIPT_LIMIT = 32
export const WORKFLOW_OPERATION_RECEIPT_QUARANTINE_SCHEMA_VERSION = 1
export const WORKFLOW_OPERATION_RECEIPT_QUARANTINE_PREFIX = 'read-web.workflow-operation-receipt-quarantine.v1.'

const SENSITIVE_KEY = /(?:api.?key|access.?token|authorization|cookie|password|secret|credential)/i
const PATH_KEY = /(?:path|dir|file|folder)/i

export class WorkflowOperationReceiptError extends Error {
  constructor(message = 'Workflow operation receipt storage is unavailable') {
    super(message)
    this.name = 'WorkflowOperationReceiptError'
    this.code = 'WORKFLOW_OPERATION_RECEIPT_UNAVAILABLE'
    this.category = 'storage'
    this.retryable = true
  }
}

function storageOrNull(storage) {
  if (storage !== undefined) return storage
  try {
    return globalThis.localStorage || null
  } catch (_error) {
    return null
  }
}

function normalizedActionType(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9._:-]+/g, '-') || 'workflow'
}

function normalizedTargetJobId(value) {
  return String(value || '').trim().slice(0, 128)
}

function safeFingerprintValue(value, key = '') {
  if (SENSITIVE_KEY.test(key) || PATH_KEY.test(key)) return undefined
  if (Array.isArray(value)) return value.map((item) => safeFingerprintValue(item, key))
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, childKey) => {
      if (SENSITIVE_KEY.test(childKey) || PATH_KEY.test(childKey)) return result
      const safeValue = safeFingerprintValue(value[childKey], childKey)
      if (safeValue !== undefined) result[childKey] = safeValue
      return result
    }, {})
  }
  if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) return null
  return value
}

function canonicalJson(value) {
  return JSON.stringify(value, (_key, child) => {
    if (typeof child === 'number' && !Number.isFinite(child)) return null
    return child
  })
}

function digest(value) {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (const character of String(value || '')) {
    const code = character.codePointAt(0) || 0
    first ^= code
    first = Math.imul(first, 0x01000193)
    second ^= code + 0x9e3779b9
    second = Math.imul(second, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

export function createWorkflowOperationFingerprint({ actionType, targetJobId = '', payload = {} } = {}) {
  const descriptor = {
    actionType: normalizedActionType(actionType),
    targetJobId: normalizedTargetJobId(targetJobId),
    payload: safeFingerprintValue(payload),
  }
  return `v1-${digest(canonicalJson(descriptor))}`
}

function receiptStorageKey(fingerprint) {
  return `${WORKFLOW_OPERATION_RECEIPT_STORAGE_PREFIX}${String(fingerprint || '')}`
}

function removeItem(storage, key) {
  try {
    storage.removeItem(key)
  } catch (_error) {
    // Corrupt optional receipts are never surfaced or copied into diagnostics.
  }
}

function quarantineStorageKey(sourceKey, now) {
  return `${WORKFLOW_OPERATION_RECEIPT_QUARANTINE_PREFIX}${now}.${digest(sourceKey)}`
}

function quarantineStoredReceipt(storage, sourceKey, raw, reason, now) {
  const quarantineKey = quarantineStorageKey(sourceKey, now)
  const quarantine = {
    schemaVersion: WORKFLOW_OPERATION_RECEIPT_QUARANTINE_SCHEMA_VERSION,
    sourceKey,
    detectedAt: new Date(now).toISOString(),
    reason,
    raw,
  }
  try {
    storage.setItem(quarantineKey, JSON.stringify(quarantine))
  } catch (_error) {
    throw new WorkflowOperationReceiptError('Workflow operation receipt quarantine is unavailable')
  }
  try {
    storage.removeItem(sourceKey)
  } catch (_error) {
    throw new WorkflowOperationReceiptError('Workflow operation receipt quarantine cleanup is unavailable')
  }
}

function normalizeReceipt(value, fingerprint, now) {
  if (!value || typeof value !== 'object') return null
  if (value.schemaVersion !== WORKFLOW_OPERATION_RECEIPT_SCHEMA_VERSION) return null
  if (value.fingerprint !== fingerprint) return null
  if (!String(value.actionType || '').trim() || !String(value.operationKey || '').trim()) return null
  if (!Number.isFinite(value.createdAt) || !Number.isFinite(value.expiresAt)) return null
  if (value.expiresAt <= now || value.expiresAt <= value.createdAt) return null
  if (value.expiresAt - value.createdAt > WORKFLOW_OPERATION_RECEIPT_TTL_MS) return null
  return {
    schemaVersion: WORKFLOW_OPERATION_RECEIPT_SCHEMA_VERSION,
    actionType: normalizedActionType(value.actionType),
    fingerprint,
    targetJobId: normalizedTargetJobId(value.targetJobId),
    operationKey: String(value.operationKey).trim().slice(0, 256),
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  }
}

function parseStoredReceipt(storage, key, fingerprint, now) {
  let raw = ''
  try {
    raw = storage.getItem(key) || ''
  } catch (_error) {
    throw new WorkflowOperationReceiptError()
  }
  if (!raw) return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (_error) {
    quarantineStoredReceipt(storage, key, raw, 'malformed-json', now)
    return null
  }
  if (!parsed || typeof parsed !== 'object') {
    quarantineStoredReceipt(storage, key, raw, 'invalid-receipt', now)
    return null
  }
  if (parsed.schemaVersion !== WORKFLOW_OPERATION_RECEIPT_SCHEMA_VERSION) {
    quarantineStoredReceipt(storage, key, raw, 'unsupported-schema', now)
    return null
  }
  if (parsed.fingerprint !== fingerprint) {
    quarantineStoredReceipt(storage, key, raw, 'invalid-reference', now)
    return null
  }
  if (Number.isFinite(parsed.expiresAt) && parsed.expiresAt <= now) {
    removeItem(storage, key)
    return null
  }
  const normalized = normalizeReceipt(parsed, fingerprint, now)
  if (!normalized) {
    quarantineStoredReceipt(storage, key, raw, 'invalid-receipt', now)
    return null
  }
  return normalized
}

export function cleanupWorkflowOperationReceipts({ storage, now = Date.now() } = {}) {
  const target = storageOrNull(storage)
  if (!target) return 0
  const valid = []
  let keys = []
  try {
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index)
      if (key && key.startsWith(WORKFLOW_OPERATION_RECEIPT_STORAGE_PREFIX)) keys.push(key)
    }
  } catch (_error) {
    throw new WorkflowOperationReceiptError()
  }
  for (const key of keys) {
    const fingerprint = key.slice(WORKFLOW_OPERATION_RECEIPT_STORAGE_PREFIX.length)
    const receipt = parseStoredReceipt(target, key, fingerprint, now)
    if (receipt) valid.push({ key, createdAt: receipt.createdAt })
  }
  valid.sort((left, right) => right.createdAt - left.createdAt)
  for (const item of valid.slice(WORKFLOW_OPERATION_RECEIPT_LIMIT)) removeItem(target, item.key)
  return Math.min(valid.length, WORKFLOW_OPERATION_RECEIPT_LIMIT)
}

export function readWorkflowOperationReceipt({ actionType, targetJobId = '', payload = {}, storage, now = Date.now() } = {}) {
  const fingerprint = createWorkflowOperationFingerprint({ actionType, targetJobId, payload })
  const target = storageOrNull(storage)
  if (!target) return null
  cleanupWorkflowOperationReceipts({ storage: target, now })
  return parseStoredReceipt(target, receiptStorageKey(fingerprint), fingerprint, now)
}

export function hasWorkflowOperationReceipt(options = {}) {
  return Boolean(readWorkflowOperationReceipt(options))
}

export function writeWorkflowOperationReceipt({ actionType, targetJobId = '', payload = {}, operationKey, storage, now = Date.now() } = {}) {
  const target = storageOrNull(storage)
  if (!target) throw new WorkflowOperationReceiptError()
  const fingerprint = createWorkflowOperationFingerprint({ actionType, targetJobId, payload })
  cleanupWorkflowOperationReceipts({ storage: target, now })
  const receipt = {
    schemaVersion: WORKFLOW_OPERATION_RECEIPT_SCHEMA_VERSION,
    actionType: normalizedActionType(actionType),
    fingerprint,
    targetJobId: normalizedTargetJobId(targetJobId),
    operationKey: String(operationKey || '').trim().slice(0, 256),
    createdAt: now,
    expiresAt: now + WORKFLOW_OPERATION_RECEIPT_TTL_MS,
  }
  if (!receipt.operationKey) throw new WorkflowOperationReceiptError()
  try {
    target.setItem(receiptStorageKey(fingerprint), JSON.stringify(receipt))
  } catch (_error) {
    throw new WorkflowOperationReceiptError()
  }
  return receipt
}

export function removeWorkflowOperationReceipt({ actionType, targetJobId = '', payload = {}, storage } = {}) {
  const target = storageOrNull(storage)
  if (!target) return
  const fingerprint = createWorkflowOperationFingerprint({ actionType, targetJobId, payload })
  removeItem(target, receiptStorageKey(fingerprint))
}
