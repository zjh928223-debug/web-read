import apiContract from '../../docs/architecture/windows-local-owner-thin-reader/api-contract.json'

const OWNER_API_ROUTE = '/api/app/owner'
const DURABLE_DOMAINS = Object.freeze([
  'reader-session',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'marks-activity',
  'workflow',
])
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SAFE_OPERATION = /^[a-z][a-z0-9.-]{0,95}$/
const SAFE_IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/
const OUTCOMES = new Set([
  'read',
  'committed',
  'rejected',
  'conflict',
  'commit-unknown',
  'not-ready',
  'manual-recovery',
])
const COMMIT_STATUSES = new Set([
  'not-applicable',
  'pending',
  'committed',
  'rejected',
  'conflict',
  'commit-unknown',
  'not-ready',
  'manual-recovery',
])
const RESPONSE_KEYS = new Set([
  'contractVersion',
  'requestId',
  'correlationId',
  'domain',
  'operation',
  'outcome',
  'commitStatus',
  'revision',
  'receipt',
  'capability',
  'diagnostic',
  'payload',
  'error',
])
const READ_LIKE_COMMANDS = new Set(['prepare', 'lightweight-export', 'export'])
const SENSITIVE_PAYLOAD_KEY = /(?:token|authorization|cookie|password|secret|api[-_]?key)/i
const SENSITIVE_ERROR_KEY = /(?:token|authorization|cookie|password|secret|api[-_]?key|path|media|receiptId|idempotencyKey|requestId|correlationId)/i
const VOCABULARY_SETTLEMENT_RECORD_PREFIX = 'vocabulary-article-srs-settlement-progress:'
const TYPED_ERROR_CODES = new Set((apiContract.typedErrorCodes || []).map((item) => item.code))
const TYPED_ERROR_CATEGORIES = new Set((apiContract.typedErrorCodes || []).map((item) => item.category))
let generatedIdentityCounter = 0

const contractDomains = apiContract.domainRegistry.map((registration) => registration.domain)
if (JSON.stringify(contractDomains) !== JSON.stringify(DURABLE_DOMAINS)) {
  throw new Error('Windows owner API client domain registry is not the six-domain contract')
}

const operationCapabilities = apiContract.operationCapabilityRegistry?.domains || {}
const domainRegistryEntries = Object.fromEntries(apiContract.domainRegistry.map((registration) => {
  const domain = registration.domain
  const maps = operationCapabilities[domain]
  const allOperations = new Set([
    ...registration.queryOperations,
    ...registration.commandOperations,
  ])
  const operationMap = Object.freeze(Object.fromEntries([
    ...registration.queryOperations.map((operation) => [operation, Object.freeze({ kind: 'query', capability: maps?.query?.[operation] })]),
    ...registration.commandOperations.filter((operation) => operation !== 'receipt-query')
      .map((operation) => [operation, Object.freeze({ kind: 'command', capability: maps?.command?.[operation] })]),
  ]))
  return [domain, Object.freeze({
    domain,
    queryOperations: Object.freeze([...registration.queryOperations]),
    commandOperations: Object.freeze([...registration.commandOperations]),
    capabilities: Object.freeze([...registration.capabilities]),
    receiptCapability: maps?.['receipt-query']?.['receipt-query'],
    operationMap,
    allOperations: Object.freeze([...allOperations]),
  })]
}))

export const WINDOWS_OWNER_API_ROUTE = OWNER_API_ROUTE
export const WINDOWS_OWNER_DOMAIN_REGISTRY = Object.freeze(domainRegistryEntries)

export class WindowsOwnerApiError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'WindowsOwnerApiError'
    this.code = code
    this.category = options.category || 'validation'
    this.retryable = options.retryable === true
    this.outcome = options.outcome || null
    this.details = options.details || {}
    this.responseError = options.responseError || null
  }
}

export function getWindowsOwnerOperation(domain, operation, kind = null) {
  const registration = WINDOWS_OWNER_DOMAIN_REGISTRY[domain]
  if (!registration) return null
  const entry = registration.operationMap[operation]
  if (!entry || (kind && entry.kind !== kind)) return null
  return { domain, operation, kind: entry.kind, capability: entry.capability }
}

export function createWindowsOwnerApiClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new WindowsOwnerApiError('upstream', 'owner API fetch is unavailable', {
      category: 'upstream',
      retryable: true,
    })
  }
  const profileId = requireIdentity(options.profileId, 'profileId')
  const instanceId = options.instanceId === undefined ? null : requireIdentity(options.instanceId, 'instanceId')
  const timeoutMs = normalizeTimeout(options.timeoutMs)

  return Object.freeze({
    async query(request = {}) {
      return execute(buildRequest('query', request), { signal: request.signal, timeoutMs, fetchImpl })
    },
    async command(request = {}) {
      return execute(buildRequest('command', request), { signal: request.signal, timeoutMs, fetchImpl })
    },
    async receipt(request = {}) {
      return execute(buildReceiptRequest(request), { signal: request.signal, timeoutMs, fetchImpl })
    },
  })

  function buildRequest(kind, request) {
    if (!isPlainObject(request)) throw inputError('request must be an object')
    const domain = requireDomain(request.domain)
    const operation = requireOperation(domain, request.operation, kind)
    const entry = WINDOWS_OWNER_DOMAIN_REGISTRY[domain].operationMap[operation]
    const payload = bindPayload(request.payload === undefined ? {} : request.payload, profileId, instanceId)
    const requestId = request.requestId === undefined
      ? createIdentity('owner-request')
      : requireIdentity(request.requestId, 'requestId')
    const correlationId = request.correlationId === undefined
      ? createIdentity('owner-correlation')
      : requireIdentity(request.correlationId, 'correlationId')
    const envelope = {
      contractVersion: apiContract.contractVersion,
      requestId,
      correlationId,
      kind,
      domain,
      operation,
      capability: requireOperationCapability(entry, domain, operation),
      payload,
    }

    if (kind === 'command' && !READ_LIKE_COMMANDS.has(operation)) {
      envelope.expectedRevision = requireMutationRevision(request.expectedRevision)
    } else if (request.expectedRevision !== undefined) {
      envelope.expectedRevision = requireRevision(request.expectedRevision, 'expectedRevision')
    }

    if (kind === 'command' && requiresIdempotency(domain, operation)) {
      envelope.idempotencyKey = requireIdempotency(request.idempotencyKey)
    } else if (request.idempotencyKey !== undefined && request.idempotencyKey !== null) {
      envelope.idempotencyKey = requireIdempotency(request.idempotencyKey)
    }

    return Object.freeze(envelope)
  }

  function buildReceiptRequest(request) {
    if (!isPlainObject(request)) throw inputError('receipt request must be an object')
    const domain = requireDomain(request.domain)
    const registration = WINDOWS_OWNER_DOMAIN_REGISTRY[domain]
    const capability = registration.receiptCapability
    if (!capability || !registration.capabilities.includes(capability)) {
      throw inputError('receipt capability is not registered')
    }
    const hasReceiptId = request.receiptId !== undefined && request.receiptId !== null
    const hasIdempotencyKey = request.idempotencyKey !== undefined && request.idempotencyKey !== null
    if (hasReceiptId === hasIdempotencyKey) {
      throw inputError('receipt query requires exactly one receiptId or idempotencyKey')
    }
    const envelope = {
      contractVersion: apiContract.contractVersion,
      requestId: request.requestId === undefined ? createIdentity('owner-request') : requireIdentity(request.requestId, 'requestId'),
      correlationId: request.correlationId === undefined ? createIdentity('owner-correlation') : requireIdentity(request.correlationId, 'correlationId'),
      kind: 'receipt-query',
      domain,
      operation: 'receipt-query',
      capability,
      payload: bindPayload({
        ...(request.payload === undefined ? {} : request.payload),
        ...(hasReceiptId ? { receiptId: requireIdentity(request.receiptId, 'receiptId') } : {}),
      }, profileId, instanceId),
    }
    if (hasIdempotencyKey) envelope.idempotencyKey = requireIdempotency(request.idempotencyKey)
    return Object.freeze(envelope)
  }
}

async function execute(envelope, { signal, timeoutMs, fetchImpl }) {
  const isMutation = envelope.kind === 'command'
  const control = composeAbortSignal(signal, timeoutMs)
  let dispatched = false
  try {
    if (signal?.aborted) {
      throw abortedError()
    }
    const body = JSON.stringify(envelope)
    dispatched = true
    const response = await fetchImpl(OWNER_API_ROUTE, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      credentials: 'same-origin',
      body,
      signal: control.signal,
    })
    if (signal?.aborted) {
      if (isMutation) return unknownResult(envelope, 'aborted')
      throw abortedError()
    }
    const raw = await readJsonResponse(response)
    if (signal?.aborted) {
      if (isMutation) return unknownResult(envelope, 'aborted')
      throw abortedError()
    }
    return validateResponse(raw, envelope)
  } catch (error) {
    if (error instanceof WindowsOwnerApiError) {
      if (isMutation && dispatched) return unknownResult(envelope, 'invalid-response')
      throw error
    }
    if (signal?.aborted) {
      if (isMutation && dispatched) return unknownResult(envelope, 'aborted')
      throw abortedError()
    }
    if (control.timedOut()) {
      if (isMutation && dispatched) return unknownResult(envelope, 'timeout')
      throw new WindowsOwnerApiError('timeout', 'owner API request timed out', {
        category: 'timeout',
        retryable: true,
      })
    }
    if (isMutation && dispatched) return unknownResult(envelope, 'upstream')
    throw new WindowsOwnerApiError('upstream', 'owner API transport failed', {
      category: 'upstream',
      retryable: true,
    })
  } finally {
    control.cleanup()
  }
}

function abortedError() {
  return new WindowsOwnerApiError('aborted', 'owner API request was aborted', {
    category: 'timeout',
    retryable: false,
  })
}

async function readJsonResponse(response) {
  if (!response || typeof response.json !== 'function') {
    throw new WindowsOwnerApiError('invalid-response', 'owner API response is not JSON', { category: 'schema' })
  }
  try {
    return await response.json()
  } catch {
    throw new WindowsOwnerApiError('invalid-response', 'owner API response JSON is invalid', { category: 'schema' })
  }
}

function validateResponse(raw, request) {
  if (!isPlainObject(raw)) invalidResponse('owner API response must be an object')
  for (const key of Object.keys(raw)) {
    if (!RESPONSE_KEYS.has(key)) invalidResponse('owner API response contains unsupported fields')
  }
  for (const field of ['contractVersion', 'requestId', 'correlationId', 'domain', 'operation', 'outcome', 'commitStatus', 'revision', 'receipt', 'payload']) {
    if (!(field in raw)) invalidResponse(`owner API response is missing ${field}`)
  }
  if (raw.contractVersion !== apiContract.contractVersion) invalidResponse('owner API response contract version is unsupported')
  if (raw.requestId !== request.requestId || raw.correlationId !== request.correlationId) invalidResponse('owner API response identity does not match request')
  if (raw.domain !== request.domain || raw.operation !== request.operation) invalidResponse('owner API response operation does not match request')
  if (!OUTCOMES.has(raw.outcome) || !COMMIT_STATUSES.has(raw.commitStatus)) invalidResponse('owner API response outcome is invalid')
  if (raw.revision !== null) requireRevision(raw.revision, 'revision')
  if (!isPlainObject(raw.payload)) invalidResponse('owner API response payload must be an object')
  assertJsonSafe(raw.payload, 'response.payload', new WeakSet(), responseValueError)
  if (raw.capability !== undefined) {
    if (!isPlainObject(raw.capability)) invalidResponse('owner API capability is invalid')
    assertJsonSafe(raw.capability, 'response.capability', new WeakSet(), responseValueError)
  }
  if (raw.diagnostic !== undefined) {
    if (!isPlainObject(raw.diagnostic)) invalidResponse('owner API diagnostic is invalid')
    assertJsonSafe(raw.diagnostic, 'response.diagnostic', new WeakSet(), responseValueError)
  }
  if (raw.receipt !== null) validateReceipt(raw.receipt, request)
  const typedError = raw.error === undefined || raw.error === null ? null : validateTypedError(raw.error, raw.correlationId)
  validateOutcomePair(raw.outcome, raw.commitStatus)
  if (raw.outcome === 'committed' && (raw.revision === null || raw.receipt === null)) invalidResponse('committed response lacks revision or receipt')
  if (['rejected', 'conflict', 'commit-unknown', 'not-ready', 'manual-recovery'].includes(raw.outcome) && !raw.error) {
    invalidResponse('non-committed response lacks typed error')
  }
  return Object.freeze({
    contractVersion: raw.contractVersion,
    requestId: raw.requestId,
    correlationId: raw.correlationId,
    domain: raw.domain,
    operation: raw.operation,
    outcome: raw.outcome,
    commitStatus: raw.commitStatus,
    revision: raw.revision,
    receipt: raw.receipt,
    payload: raw.payload,
    error: typedError,
  })
}

function validateReceipt(receipt, request) {
  if (!isPlainObject(receipt)) invalidResponse('receipt must be an object')
  const required = [
    'receiptId', 'contractVersion', 'profileId', 'instanceId', 'requestId', 'correlationId',
    'domain', 'operation', 'idempotencyKey', 'expectedRevision', 'requestFingerprint',
    'commitStatus', 'revision', 'effectFingerprint', 'recordChecksums', 'evidenceChecksum',
    'evidenceSource', 'createdAt', 'committedAt', 'queryOperation',
  ]
  for (const field of required) if (!(field in receipt)) invalidResponse(`receipt is missing ${field}`)
  for (const key of Object.keys(receipt)) {
    if (!required.includes(key)) invalidResponse('receipt contains unsupported fields')
  }
  for (const field of ['receiptId', 'profileId', 'instanceId', 'requestId', 'correlationId', 'evidenceSource']) requireIdentity(receipt[field], `receipt.${field}`)
  if (receipt.contractVersion !== apiContract.contractVersion || receipt.queryOperation !== 'receipt-query') invalidResponse('receipt contract identity is invalid')
  if (receipt.domain !== request.domain) invalidResponse('receipt identity does not match response')
  if (receipt.profileId !== request.payload.profileId || (request.payload.instanceId && receipt.instanceId !== request.payload.instanceId)) invalidResponse('receipt profile identity does not match response')
  if (request.kind !== 'receipt-query' && (receipt.requestId !== request.requestId || receipt.correlationId !== request.correlationId || receipt.operation !== request.operation)) invalidResponse('receipt identity does not match response')
  if (request.kind === 'receipt-query' && request.payload.receiptId && receipt.receiptId !== request.payload.receiptId) invalidResponse('receipt id does not match query')
  const registeredOperations = WINDOWS_OWNER_DOMAIN_REGISTRY[receipt.domain]?.allOperations || []
  if (!registeredOperations.includes(receipt.operation) || receipt.operation === 'receipt-query') invalidResponse('receipt operation is not registered')
  if (request.kind === 'receipt-query' && request.idempotencyKey && receipt.idempotencyKey !== request.idempotencyKey) invalidResponse('receipt idempotency identity does not match query')
  requireIdempotency(receipt.idempotencyKey)
  if (receipt.expectedRevision !== null) requireRevision(receipt.expectedRevision, 'receipt.expectedRevision')
  if (!COMMIT_STATUSES.has(receipt.commitStatus) || receipt.commitStatus === 'not-applicable') invalidResponse('receipt commit status is invalid')
  if (receipt.revision !== null) requireRevision(receipt.revision, 'receipt.revision')
  for (const field of ['requestFingerprint', 'effectFingerprint', 'evidenceChecksum']) {
    if (typeof receipt[field] !== 'string' || !FINGERPRINT.test(receipt[field])) invalidResponse(`receipt.${field} is invalid`)
  }
  if (!Array.isArray(receipt.recordChecksums) || receipt.recordChecksums.some((value) => typeof value !== 'string' || !FINGERPRINT.test(value))) invalidResponse('receipt.recordChecksums is invalid')
  if (typeof receipt.createdAt !== 'string' || Number.isNaN(Date.parse(receipt.createdAt))) invalidResponse('receipt.createdAt is invalid')
  if (receipt.committedAt !== null && (typeof receipt.committedAt !== 'string' || Number.isNaN(Date.parse(receipt.committedAt)))) invalidResponse('receipt.committedAt is invalid')
}

function validateTypedError(error, correlationId) {
  if (!isPlainObject(error)) invalidResponse('typed error must be an object')
  for (const field of ['type', 'code', 'category', 'message', 'retryable', 'correlationId', 'details']) if (!(field in error)) invalidResponse(`typed error is missing ${field}`)
  if (Object.keys(error).some((key) => !['type', 'code', 'category', 'message', 'retryable', 'correlationId', 'details'].includes(key))) invalidResponse('typed error contains unsupported fields')
  if (error.type !== 'windows-thin-reader-error.v1' || !TYPED_ERROR_CODES.has(error.code) || !TYPED_ERROR_CATEGORIES.has(error.category) || error.correlationId !== correlationId || typeof error.message !== 'string' || !error.message || error.message.length > 512 || typeof error.retryable !== 'boolean' || !isPlainObject(error.details)) invalidResponse('typed error is invalid')
  assertJsonSafe(error.details, 'response.error.details', new WeakSet(), responseValueError)
  return {
    type: error.type,
    code: error.code,
    category: error.category,
    message: redactSensitiveText(error.message),
    retryable: error.retryable,
    correlationId: error.correlationId,
    details: redactErrorDetails(error.details),
  }
}

function validateOutcomePair(outcome, commitStatus) {
  const expected = {
    read: 'not-applicable',
    committed: 'committed',
    rejected: 'rejected',
    conflict: 'conflict',
    'commit-unknown': 'commit-unknown',
    'not-ready': 'not-ready',
    'manual-recovery': 'manual-recovery',
  }[outcome]
  if (expected !== commitStatus) invalidResponse('owner API outcome and commitStatus disagree')
}

function unknownResult(request, reason) {
  const lookup = {
    domain: request.domain,
    operation: request.operation,
    requestId: request.requestId,
    correlationId: request.correlationId,
    receiptOperation: 'receipt-query',
    ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
  }
  const message = reason === 'timeout'
    ? 'owner command timed out before commit was known'
    : reason === 'aborted'
      ? 'owner command was aborted after dispatch; commit status is unknown'
      : reason === 'invalid-response'
        ? 'owner command response was invalid; commit status is unknown'
        : 'owner command result was not received'
  return Object.freeze({
    contractVersion: apiContract.contractVersion,
    requestId: request.requestId,
    correlationId: request.correlationId,
    domain: request.domain,
    operation: request.operation,
    outcome: 'commit-unknown',
    commitStatus: 'commit-unknown',
    revision: null,
    receipt: null,
    payload: { receiptQuery: lookup },
    error: {
      type: 'windows-thin-reader-error.v1',
      code: 'commit-unknown',
      category: 'recovery',
      message,
      retryable: false,
      correlationId: request.correlationId,
      details: { lookupAvailable: Boolean(request.idempotencyKey) },
    },
  })
}

function bindPayload(payload, profileId, instanceId) {
  if (!isPlainObject(payload)) throw inputError('payload must be an object')
  const copy = { ...payload }
  if (copy.profileId !== undefined && copy.profileId !== profileId) throw inputError('payload profileId does not match client profile')
  if (instanceId && copy.instanceId !== undefined && copy.instanceId !== instanceId) throw inputError('payload instanceId does not match client instance')
  copy.profileId = profileId
  if (instanceId) copy.instanceId = instanceId
  const allowsVocabularySettlementAttemptToken = typeof copy.recordKey === 'string'
    ? copy.recordKey.startsWith(VOCABULARY_SETTLEMENT_RECORD_PREFIX)
    : isPlainObject(copy.records)
      && Object.keys(copy.records).some((recordKey) => recordKey.startsWith(VOCABULARY_SETTLEMENT_RECORD_PREFIX))
  assertJsonSafe(copy, 'payload', new WeakSet(), inputError, allowsVocabularySettlementAttemptToken ? new Set(['attempt_token']) : new Set())
  return copy
}

function assertJsonSafe(value, field, seen = new WeakSet(), makeError = inputError, allowedSensitiveKeys = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && value.startsWith('data:')) throw makeError(`${field} cannot contain complete media data`)
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw makeError(`${field} must be a finite number`)
    return
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw makeError(`${field} is not JSON-safe`)
  if (typeof Blob !== 'undefined' && value instanceof Blob) throw makeError(`${field} cannot contain Blob data`)
  if (typeof ArrayBuffer !== 'undefined' && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) throw makeError(`${field} cannot contain binary data`)
  if (typeof value !== 'object' || seen.has(value)) {
    if (seen.has(value)) throw makeError(`${field} contains a circular value`)
    throw makeError(`${field} is not JSON-safe`)
  }
  seen.add(value)
  if (Array.isArray(value)) value.forEach((item, index) => assertJsonSafe(item, `${field}[${index}]`, seen, makeError, allowedSensitiveKeys))
  else {
    for (const [key, item] of Object.entries(value)) {
      if (makeError === inputError && SENSITIVE_PAYLOAD_KEY.test(key) && !allowedSensitiveKeys.has(key)) throw makeError(`${field} contains an unsupported credential field`)
      assertJsonSafe(item, `${field}.${key}`, seen, makeError, allowedSensitiveKeys)
    }
  }
  seen.delete(value)
}

function responseValueError(message) {
  return new WindowsOwnerApiError('invalid-response', message, { category: 'schema' })
}

function redactErrorDetails(value) {
  if (Array.isArray(value)) return value.map((item) => redactErrorDetails(item))
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_ERROR_KEY.test(key) ? '[redacted]' : redactErrorDetails(item),
  ]))
}

function redactSensitiveText(value) {
  return value
    .replace(/(?:bearer\s+|token[=:]\s*|authorization[=:]\s*|cookie[=:]\s*)[^\s,;]+/gi, '[redacted]')
    .replace(/[A-Za-z]:[\\/][^\n,;]*/g, '[redacted-path]')
}

function requireDomain(domain) {
  if (!DURABLE_DOMAINS.includes(domain)) throw inputError('domain is not registered')
  return domain
}

function requireOperation(domain, operation, kind) {
  if (typeof operation !== 'string' || !SAFE_OPERATION.test(operation)) throw inputError('operation is invalid')
  const entry = getWindowsOwnerOperation(domain, operation, kind)
  if (!entry || !entry.capability) throw inputError('operation is not registered for this domain and kind')
  return operation
}

function requireOperationCapability(entry, domain, operation) {
  if (!entry?.capability || !WINDOWS_OWNER_DOMAIN_REGISTRY[domain].capabilities.includes(entry.capability)) throw inputError(`capability is not registered for ${operation}`)
  return entry.capability
}

function requiresIdempotency(domain, operation) {
  if (READ_LIKE_COMMANDS.has(operation)) return false
  if (domain === 'reader-session') return ['commit', 'restore'].includes(operation)
  if (domain === 'vocabulary-srs') return ['review-attempt', 'acquisition-command', 'learning-event-append', 'pending-candidates-update', 'personalization-report', 'learning-unit-of-work'].includes(operation)
  if (domain === 'passage-preview') return operation !== 'legacy-import'
  if (domain === 'annotation') return ['bundle-commit', 'lightweight-import', 'backfill-result-import'].includes(operation)
  if (domain === 'marks-activity') return ['marks-commit', 'activity-append'].includes(operation)
  if (domain === 'workflow') return ['job-start', 'job-cancel', 'job-retry', 'config-commit', 'reader-index-commit'].includes(operation) || operation.includes('config') || operation.includes('index')
  return false
}

function requireIdentity(value, field) {
  if (typeof value !== 'string' || !SAFE_IDENTITY.test(value)) throw inputError(`${field} is invalid`)
  return value
}

function requireIdempotency(value) {
  if (typeof value !== 'string' || !SAFE_IDEMPOTENCY.test(value)) throw inputError('idempotencyKey is required and invalid')
  return value
}

function requireRevision(value, field) {
  if (value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0) || (typeof value === 'string' && value.length > 0 && value.length <= 128)) return value
  throw inputError(`${field} is required and invalid`)
}

function requireMutationRevision(value) {
  if (value === undefined || value === null) throw inputError('expectedRevision is required for this command')
  return requireRevision(value, 'expectedRevision')
}

function createIdentity(prefix) {
  generatedIdentityCounter += 1
  const cryptoObject = globalThis.crypto
  if (typeof cryptoObject?.randomUUID === 'function') return `${prefix}-${cryptoObject.randomUUID()}`
  return `${prefix}-${Date.now().toString(36)}-${generatedIdentityCounter.toString(36)}`
}

function normalizeTimeout(value) {
  if (value === undefined) return 10000
  if (!Number.isFinite(value) || value <= 0 || value > 60000) throw inputError('timeoutMs must be between 1 and 60000')
  return Math.floor(value)
}

function composeAbortSignal(parentSignal, timeoutMs) {
  const controller = new AbortController()
  let timeout = false
  const onParentAbort = () => controller.abort()
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort()
    else parentSignal.addEventListener('abort', onParentAbort, { once: true })
  }
  const timer = setTimeout(() => {
    timeout = true
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => timeout,
    cleanup() {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParentAbort)
    },
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function inputError(message) {
  return new WindowsOwnerApiError('invalid-request', message, { category: 'validation' })
}

function invalidResponse(message) {
  throw new WindowsOwnerApiError('invalid-response', message, { category: 'schema' })
}
