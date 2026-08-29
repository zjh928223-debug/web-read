import {
  WINDOWS_OWNER_DOMAIN_REGISTRY,
  getWindowsOwnerOperation,
} from './windows-owner-api-client.js'

const CONTRACT_VERSION = 'windows-thin-reader-api.v1'
const STATUS_VALUES = ['dirty', 'saving', 'saved', 'conflict', 'commit-unknown', 'not-ready']
const OUTCOME_STATUS = Object.freeze({
  read: 'not-applicable',
  committed: 'committed',
  rejected: 'rejected',
  conflict: 'conflict',
  'commit-unknown': 'commit-unknown',
  'not-ready': 'not-ready',
  'manual-recovery': 'manual-recovery',
})
const COMMIT_STATUS_VALUES = new Set([
  'not-applicable', 'pending', 'committed', 'rejected', 'conflict', 'commit-unknown', 'not-ready', 'manual-recovery',
])
const RECEIPT_TERMINAL = new Set(['committed', 'rejected', 'conflict', 'not-ready', 'manual-recovery'])
const RECEIPT_UNKNOWN = new Set(['pending', 'commit-unknown'])
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SAFE_TEXT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/
const DOMAINS = Object.freeze(Object.keys(WINDOWS_OWNER_DOMAIN_REGISTRY))
const RECEIPT_FIELDS = [
  'receiptId', 'contractVersion', 'profileId', 'instanceId', 'requestId', 'correlationId',
  'domain', 'operation', 'idempotencyKey', 'expectedRevision', 'requestFingerprint',
  'commitStatus', 'revision', 'effectFingerprint', 'recordChecksums', 'evidenceChecksum',
  'evidenceSource', 'createdAt', 'committedAt', 'queryOperation',
]

export const WINDOWS_OWNER_DURABLE_STATUSES = Object.freeze([...STATUS_VALUES])

export function createWindowsOwnerDurableStatusTracker(options = {}) {
  const domain = requireDomain(options.domain)
  const profileId = optionalIdentity(options.profileId, 'profileId')
  const instanceId = optionalIdentity(options.instanceId, 'instanceId')
  const flights = new Map()
  const listeners = new Set()
  let generation = 0
  let intent = null
  let authoritativeRevision = null
  let status = 'not-ready'
  let reason = 'no-typed-owner-commit'
  let error = null
  let disposed = false
  let snapshot = makeSnapshot()

  function recordIntent(metadata = {}) {
    ensureActive()
    if (!isPlainObject(metadata)) throw new TypeError('intent metadata must be an object')
    generation += 1
    intent = Object.freeze({
      generation,
      intentId: metadata.intentId === undefined ? `intent-${generation}` : requiredIdentity(metadata.intentId, 'intentId'),
      intentFingerprint: metadata.intentFingerprint == null ? null : requiredText(metadata.intentFingerprint, 'intentFingerprint'),
    })
    status = 'dirty'
    reason = 'local-intent'
    error = null
    emit()
    return intent
  }

  function beginMutation(request = {}) {
    ensureActive()
    const normalized = normalizeMutationRequest(request)
    if (normalized.domain !== domain) throw new TypeError('mutation domain does not match tracker')
    if (!intent) throw new TypeError('recordIntent must precede beginMutation')
    const requestedGeneration = request.generation === undefined
      ? intent.generation
      : requiredGeneration(request.generation)
    if (requestedGeneration !== intent.generation) throw new TypeError('mutation generation is stale')

    const unresolved = [...flights.values()][0]
    if (unresolved) {
      if (unresolved.phase !== 'unknown'
        && unresolved.generation === requestedGeneration
        && sameRequest(unresolved, normalized)) return snapshot
      throw new TypeError('an owner mutation is still unresolved')
    }

    const flight = {
      ...normalized,
      profileId,
      instanceId,
      generation: requestedGeneration,
      phase: 'active',
      receiptLookup: null,
      lastResultKey: null,
    }
    flights.set(requestedGeneration, flight)
    status = 'saving'
    reason = 'owner-command-in-flight'
    error = null
    emit()
    return publicFlight(flight)
  }

  function applyOwnerResult(result) {
    ensureActive()
    const flight = matchingFlight(result)
    if (!flight) return snapshot
    if (!isTypedResult(result, flight)) return keepFlight(flight, 'invalid-owner-result', 'schema')

    const resultKey = resultIdentityKey(result)
    if (flight.lastResultKey === resultKey) return snapshot
    if (result.outcome === 'committed') {
      if (!isCommittedResult(result, flight)) return keepFlight(flight, 'invalid-commit-evidence', 'schema')
      flight.lastResultKey = resultKey
      return settleCommitted(flight, result.revision)
    }
    if (result.outcome === 'commit-unknown') {
      const lookup = receiptLookupFromResult(result, flight)
      if (!lookup) return keepFlight(flight, 'invalid-receipt-lookup', 'schema')
      flight.lastResultKey = resultKey
      flight.phase = 'unknown'
      flight.receiptLookup = lookup
      status = currentFlight(flight) ? 'commit-unknown' : 'dirty'
      reason = 'commit-unknown'
      error = summarizeError(result.error, 'commit-unknown', 'recovery')
      emit()
      return snapshot
    }
    flight.lastResultKey = resultKey
    if (result.outcome === 'conflict') {
      updateRevision(result.revision ?? result.error?.details?.currentRevision, {
        expectedRevision: flight.expectedRevision,
      })
      return settleNonCommit(flight, currentFlight(flight) ? 'conflict' : 'dirty', 'revision-conflict', result.error)
    }
    if (result.outcome === 'not-ready' || result.outcome === 'manual-recovery') {
      return settleNonCommit(flight, currentFlight(flight) ? 'not-ready' : 'dirty', 'owner-not-ready', result.error)
    }
    return settleNonCommit(flight, 'dirty', result.outcome === 'read' ? 'non-commit-result' : 'mutation-rejected', result.error)
  }

  function observeOwnerQuery(result) {
    ensureActive()
    if (!isTypedQueryResult(result, domain)) return snapshot
    const activeFlight = [...flights.values()].find((candidate) => candidate.phase === 'active')
    const changed = updateRevision(result.revision, {
      expectedRevision: activeFlight?.expectedRevision,
      allowOpaqueObservation: flights.size === 0,
    })
    if (!intent && !flights.size) {
      reason = 'authoritative-query-observed'
      emit()
    } else if (changed) {
      emit()
    }
    return snapshot
  }

  function recordMutationFailure(failure, context = {}) {
    ensureActive()
    const flight = flightForContext(context)
    if (!flight || !contextMatches(flight, context)) return snapshot
    const code = typeof failure?.code === 'string' ? failure.code : ''
    const dispatched = !isPlainObject(context) || context.dispatched !== false
    if (code === 'commit-unknown'
      || (dispatched && (code === 'timeout' || code === 'upstream' || code === 'aborted' || code === 'invalid-response'))) {
      flight.phase = 'unknown'
      flight.receiptLookup = lookupFor(flight)
      status = currentFlight(flight) ? 'commit-unknown' : 'dirty'
      reason = 'commit-unknown'
      error = summarizeError(failure, reason, 'recovery')
      emit()
      return snapshot
    }
    if (code === 'conflict' || code === 'revision-conflict' || failure?.category === 'conflict') {
      updateRevision(failure?.details?.currentRevision, {
        expectedRevision: flight.expectedRevision,
      })
      return settleNonCommit(flight, currentFlight(flight) ? 'conflict' : 'dirty', 'revision-conflict', failure)
    }
    if (code === 'not-ready' || code === 'manual-recovery' || failure?.category === 'readiness') {
      return settleNonCommit(flight, currentFlight(flight) ? 'not-ready' : 'dirty', 'owner-not-ready', failure)
    }
    return settleNonCommit(flight, 'dirty', code === 'invalid-request' ? 'validation-failure' : 'mutation-rejected', failure)
  }

  function resolveReceipt(result) {
    ensureActive()
    const flight = [...flights.values()].find((candidate) => candidate.phase === 'unknown')
    const extracted = flight && extractReceipt(result)
    if (!flight || !extracted || !isTypedReceiptQueryResult(result) || !isReceiptQueryIdentity(result, flight)
      || !isReceiptEvidence(extracted.receipt, flight)
      || (extracted.revision != null && !sameRevision(extracted.revision, extracted.receipt.revision))) {
      return flight ? keepFlight(flight, 'receipt-mismatch', 'schema') : snapshot
    }

    const receiptStatus = extracted.receipt.commitStatus
    if (RECEIPT_UNKNOWN.has(receiptStatus)) {
      status = currentFlight(flight) ? 'commit-unknown' : 'dirty'
      reason = receiptStatus === 'pending' ? 'receipt-pending' : 'commit-unknown'
      error = null
      emit()
      return snapshot
    }
    if (!RECEIPT_TERMINAL.has(receiptStatus)) return keepFlight(flight, 'receipt-mismatch', 'schema')
    if (receiptStatus === 'committed') return settleCommitted(flight, extracted.receipt.revision)
    if (receiptStatus === 'conflict') {
      updateRevision(extracted.receipt.revision, {
        expectedRevision: flight.expectedRevision,
      })
      return settleNonCommit(flight, currentFlight(flight) ? 'conflict' : 'dirty', 'revision-conflict', null)
    }
    if (receiptStatus === 'not-ready' || receiptStatus === 'manual-recovery') {
      return settleNonCommit(flight, currentFlight(flight) ? 'not-ready' : 'dirty', 'owner-not-ready', null)
    }
    return settleNonCommit(flight, 'dirty', 'mutation-rejected', null)
  }

  function subscribe(listener) {
    ensureActive()
    if (typeof listener !== 'function') throw new TypeError('status listener must be a function')
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function dispose() {
    disposed = true
    listeners.clear()
  }

  return Object.freeze({
    applyOwnerResult,
    beginMutation,
    dispose,
    getSnapshot: () => snapshot,
    observeOwnerQuery,
    recordIntent,
    recordMutationFailure,
    resolveReceipt,
    subscribe,
  })

  function ensureActive() {
    if (disposed) throw new Error('durable status tracker is disposed')
  }

  function emit() {
    snapshot = makeSnapshot()
    for (const listener of listeners) listener(snapshot)
  }

  function makeSnapshot() {
    const flight = preferredFlight()
    const unknown = [...flights.values()].find((candidate) => candidate.phase === 'unknown')
    return Object.freeze({
      domain,
      profileId,
      instanceId,
      status,
      authoritativeRevision,
      generation,
      intent,
      inFlight: flight ? publicFlight(flight) : null,
      receiptLookup: unknown?.receiptLookup || null,
      error,
      reason,
    })
  }

  function preferredFlight() {
    return (intent && flights.get(intent.generation))
      || [...flights.values()].sort((left, right) => right.generation - left.generation)[0]
      || null
  }

  function matchingFlight(result) {
    if (!isPlainObject(result)) return null
    return [...flights.values()].find((flight) => result.domain === domain
      && result.operation === flight.operation
      && result.requestId === flight.requestId
      && result.correlationId === flight.correlationId) || null
  }

  function flightForContext(context) {
    if (isPlainObject(context) && context.generation !== undefined) return flights.get(context.generation) || null
    if (isPlainObject(context) && context.requestId) {
      return [...flights.values()].find((flight) => flight.requestId === context.requestId) || null
    }
    return preferredFlight()
  }

  function contextMatches(flight, context) {
    if (!isPlainObject(context)) return true
    return (context.generation === undefined || context.generation === flight.generation)
      && (context.requestId === undefined || context.requestId === flight.requestId)
      && (context.correlationId === undefined || context.correlationId === flight.correlationId)
  }

  function currentFlight(flight) {
    return intent?.generation === flight.generation
  }

  function keepFlight(flight, nextReason, category) {
    status = currentFlight(flight) ? flight.phase === 'unknown' ? 'commit-unknown' : 'saving' : 'dirty'
    reason = nextReason
    error = summarizeError({ code: nextReason, category }, nextReason, category)
    emit()
    return snapshot
  }

  function settleCommitted(flight, revision) {
    const current = currentFlight(flight)
    if (!canAcceptCommitRevision(flight, revision)) {
      if (!current) {
        flights.delete(flight.generation)
        status = intent ? 'dirty' : 'not-ready'
        reason = 'stale-commit-evidence'
        error = summarizeError({ code: reason, category: 'conflict' }, reason, 'conflict')
        emit()
        return snapshot
      }
      return keepFlight(flight, 'stale-commit-evidence', 'conflict')
    }
    updateRevision(revision, { expectedRevision: flight.expectedRevision })
    flights.delete(flight.generation)
    status = current ? 'saved' : intent ? 'dirty' : 'not-ready'
    reason = current ? 'committed-receipt' : intent ? 'newer-intent' : 'committed-baseline'
    error = null
    emit()
    return snapshot
  }

  function settleNonCommit(flight, nextStatus, nextReason, failure) {
    flights.delete(flight.generation)
    status = nextStatus
    reason = nextReason
    error = failure ? summarizeError(failure, nextReason, failure.category)
      : summarizeError({ code: nextReason }, nextReason, nextReason === 'revision-conflict' ? 'conflict' : 'readiness')
    emit()
    return snapshot
  }

  function updateRevision(candidate, options = {}) {
    if (!isRevision(candidate)) return false
    if (authoritativeRevision !== null && !canAdvanceRevision(
      candidate,
      options.expectedRevision,
      options.allowOpaqueObservation,
    )) return false
    const changed = !sameRevision(candidate, authoritativeRevision)
    authoritativeRevision = candidate
    return changed
  }

  function canAcceptCommitRevision(flight, candidate) {
    if (!isRevision(candidate) || authoritativeRevision === null || sameRevision(candidate, authoritativeRevision)) return true
    if (typeof candidate === 'number' && typeof authoritativeRevision === 'number') return candidate >= authoritativeRevision
    return sameRevision(authoritativeRevision, flight.expectedRevision)
  }

  function canAdvanceRevision(candidate, expectedRevision, allowOpaqueObservation = false) {
    if (authoritativeRevision === null || sameRevision(candidate, authoritativeRevision)) return true
    if (typeof candidate === 'number' && typeof authoritativeRevision === 'number') return candidate >= authoritativeRevision
    if (allowOpaqueObservation && typeof candidate === 'string' && typeof authoritativeRevision === 'string') return true
    return expectedRevision !== undefined && sameRevision(authoritativeRevision, expectedRevision)
  }
}

function normalizeMutationRequest(request) {
  if (!isPlainObject(request)) throw new TypeError('mutation request metadata must be an object')
  if (!getWindowsOwnerOperation(request.domain, request.operation, 'command')) throw new TypeError('mutation operation is not registered')
  return {
    domain: request.domain,
    operation: request.operation,
    requestId: requiredIdentity(request.requestId, 'requestId'),
    correlationId: requiredIdentity(request.correlationId, 'correlationId'),
    idempotencyKey: requiredIdentity(request.idempotencyKey, 'idempotencyKey'),
    expectedRevision: requiredRevision(request.expectedRevision, 'expectedRevision'),
  }
}

function isTypedResult(result, flight) {
  return isPlainObject(result)
    && result.contractVersion === CONTRACT_VERSION
    && result.domain === flight.domain
    && result.operation === flight.operation
    && result.requestId === flight.requestId
    && result.correlationId === flight.correlationId
    && Object.prototype.hasOwnProperty.call(OUTCOME_STATUS, result.outcome)
    && COMMIT_STATUS_VALUES.has(result.commitStatus)
    && OUTCOME_STATUS[result.outcome] === result.commitStatus
    && (result.revision === null || isRevision(result.revision))
    && isPlainObject(result.payload)
    && (result.outcome === 'read' || result.outcome === 'committed'
      ? result.error === null
      : isTypedError(result.error, result.correlationId))
}

function isTypedQueryResult(result, domain) {
  return isPlainObject(result)
    && result.contractVersion === CONTRACT_VERSION
    && result.domain === domain
    && result.outcome === 'read'
    && result.commitStatus === 'not-applicable'
    && getWindowsOwnerOperation(domain, result.operation, 'query') !== null
    && (result.revision === null || isRevision(result.revision))
    && isPlainObject(result.payload)
    && result.error === null
}

function isTypedReceiptQueryResult(result) {
  if (!isPlainObject(result)
    || result.contractVersion !== CONTRACT_VERSION
    || result.operation !== 'receipt-query'
    || !WINDOWS_OWNER_DOMAIN_REGISTRY[result.domain]?.commandOperations.includes('receipt-query')
    || !Object.prototype.hasOwnProperty.call(OUTCOME_STATUS, result.outcome)
    || !COMMIT_STATUS_VALUES.has(result.commitStatus)
    || OUTCOME_STATUS[result.outcome] !== result.commitStatus
    || (result.revision !== null && !isRevision(result.revision))
    || !isPlainObject(result.payload)
    || (result.receipt !== null && !isPlainObject(result.receipt))) return false
  if (result.outcome === 'read' || result.outcome === 'committed') {
    if (result.error !== null) return false
  } else if (!isTypedError(result.error, result.correlationId)) {
    return false
  }
  if (result.receipt !== null
    && (result.receipt.commitStatus !== result.commitStatus
      || !sameRevision(result.receipt.revision, result.revision))) return false
  return true
}

function isTypedError(value, correlationId) {
  return isPlainObject(value)
    && value.type === 'windows-thin-reader-error.v1'
    && requiredSafeIdentity(value.correlationId)
    && value.correlationId === correlationId
    && typeof value.code === 'string' && SAFE_TEXT.test(value.code)
    && typeof value.category === 'string' && SAFE_TEXT.test(value.category)
}

function isCommittedResult(result, flight) {
  return result.commitStatus === 'committed'
    && result.revision !== null
    && isRevision(result.revision)
    && isReceiptEvidence(result.receipt, flight)
    && result.receipt.commitStatus === 'committed'
    && sameRevision(result.receipt.revision, result.revision)
}

function isReceiptEvidence(receipt, flight) {
  if (!isPlainObject(receipt) || RECEIPT_FIELDS.some((field) => !(field in receipt))) return false
  if (!['receiptId', 'profileId', 'instanceId', 'requestId', 'correlationId', 'evidenceSource'].every((field) => requiredSafeIdentity(receipt[field]))) return false
  if (receipt.contractVersion !== CONTRACT_VERSION || receipt.queryOperation !== 'receipt-query'
    || receipt.domain !== flight.domain || receipt.operation !== flight.operation
    || receipt.requestId !== flight.requestId || receipt.correlationId !== flight.correlationId
    || receipt.idempotencyKey !== flight.idempotencyKey
    || !sameRevision(receipt.expectedRevision, flight.expectedRevision)) return false
  if (flight.profileId !== null && receipt.profileId !== flight.profileId) return false
  if (flight.instanceId !== null && receipt.instanceId !== flight.instanceId) return false
  if (!COMMIT_STATUS_VALUES.has(receipt.commitStatus) || receipt.commitStatus === 'not-applicable') return false
  if (receipt.revision !== null && !isRevision(receipt.revision)) return false
  if (![receipt.requestFingerprint, receipt.effectFingerprint, receipt.evidenceChecksum].every((value) => FINGERPRINT.test(value))) return false
  if (!Array.isArray(receipt.recordChecksums) || receipt.recordChecksums.some((value) => !FINGERPRINT.test(value))) return false
  if (!validDate(receipt.createdAt) || (receipt.committedAt !== null && !validDate(receipt.committedAt))) return false
  return receipt.commitStatus !== 'committed' || isRevision(receipt.revision)
}

function receiptLookupFromResult(result, flight) {
  const raw = result.payload?.receiptQuery
  if (!isPlainObject(raw)) return null
  const operation = raw.operation === 'receipt-query' ? raw.targetOperation || raw.originalOperation : raw.operation
  if (raw.domain !== flight.domain || operation !== flight.operation || raw.requestId !== flight.requestId
    || raw.correlationId !== flight.correlationId || raw.idempotencyKey !== flight.idempotencyKey) return null
  if (raw.receiptOperation !== undefined && raw.receiptOperation !== 'receipt-query') return null
  return lookupFor(flight)
}

function extractReceipt(value) {
  return isPlainObject(value) && isPlainObject(value.receipt)
    ? { receipt: value.receipt, revision: value.revision }
    : null
}

function isReceiptQueryIdentity(result, flight) {
  return result.domain === flight.domain && result.operation === 'receipt-query'
}

function lookupFor(flight) {
  return Object.freeze({
    domain: flight.domain,
    operation: flight.operation,
    requestId: flight.requestId,
    correlationId: flight.correlationId,
    receiptOperation: 'receipt-query',
    idempotencyKey: flight.idempotencyKey,
  })
}

function publicFlight(flight) {
  return Object.freeze({
    generation: flight.generation,
    phase: flight.phase,
    domain: flight.domain,
    operation: flight.operation,
    requestId: flight.requestId,
    correlationId: flight.correlationId,
    idempotencyKey: flight.idempotencyKey,
    expectedRevision: flight.expectedRevision,
    receiptLookup: flight.receiptLookup,
  })
}

function resultIdentityKey(result) {
  return [result.outcome, result.commitStatus, result.revision, result.receipt?.receiptId, result.error?.code].join('|')
}

function summarizeError(value, fallbackCode, fallbackCategory = 'validation') {
  return Object.freeze({
    type: 'windows-thin-reader-error.v1',
    code: safeText(value?.code) ? value.code : fallbackCode,
    category: safeText(value?.category) ? value.category : fallbackCategory,
    retryable: value?.retryable === true,
    correlationId: requiredSafeIdentity(value?.correlationId) ? value.correlationId : null,
  })
}

function requireDomain(domain) {
  if (!DOMAINS.includes(domain)) throw new TypeError('domain is not registered')
  return domain
}

function optionalIdentity(value, field) {
  return value === undefined || value === null ? null : requiredIdentity(value, field)
}

function requiredIdentity(value, field) {
  if (!requiredSafeIdentity(value)) throw new TypeError(`${field} is invalid`)
  return value
}

function requiredText(value, field) {
  if (!safeText(value)) throw new TypeError(`${field} is invalid`)
  return value
}

function requiredGeneration(value) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError('generation is invalid')
  return value
}

function requiredRevision(value, field) {
  if (!isRevision(value)) throw new TypeError(`${field} is required and invalid`)
  return value
}

function isRevision(value) {
  return (typeof value === 'number' && Number.isInteger(value) && value >= 0)
    || (typeof value === 'string' && value.length > 0 && value.length <= 128)
}

function sameRevision(left, right) {
  return left === right
}

function validDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function safeText(value) {
  return typeof value === 'string' && SAFE_TEXT.test(value)
}

function requiredSafeIdentity(value) {
  return typeof value === 'string' && SAFE_IDENTITY.test(value)
}

function sameRequest(left, right) {
  return left.domain === right.domain && left.operation === right.operation
    && left.requestId === right.requestId && left.correlationId === right.correlationId
    && left.idempotencyKey === right.idempotencyKey
    && sameRevision(left.expectedRevision, right.expectedRevision)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}
