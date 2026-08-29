import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contractPath = path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader', 'api-contract.json')
const clientPath = path.join(repositoryRoot, 'src', 'services', 'windows-owner-api-client.js')
const statusPath = path.join(repositoryRoot, 'src', 'services', 'windows-owner-durable-status.js')
const contract = JSON.parse(await readFile(contractPath, 'utf8'))
const clientSource = await readFile(clientPath, 'utf8')
const statusSource = await readFile(statusPath, 'utf8')
const FINGERPRINT = `sha256:${'a'.repeat(64)}`

assert.ok(!/\b(?:localStorage|sessionStorage|indexedDB|fetch)\b/.test(statusSource), 'status tracker must not access browser persistence or transport')
assert.ok(!/\b(?:setSaved|markSaved)\b/.test(statusSource), 'status tracker must not expose a generic saved escape hatch')

const clientUrl = toDataUrl(clientSource.replace(
  "import apiContract from '../../docs/architecture/windows-local-owner-thin-reader/api-contract.json'",
  `const apiContract = ${JSON.stringify(contract)}`,
))
const statusImport = "import {\n  WINDOWS_OWNER_DOMAIN_REGISTRY,\n  getWindowsOwnerOperation,\n} from './windows-owner-api-client.js'"
const statusUrl = toDataUrl(statusSource.replace(
  statusImport,
  `import { WINDOWS_OWNER_DOMAIN_REGISTRY, getWindowsOwnerOperation } from '${clientUrl}'`,
))
const {
  WINDOWS_OWNER_DURABLE_STATUSES,
  createWindowsOwnerDurableStatusTracker,
} = await import(statusUrl)
const { WINDOWS_OWNER_DOMAIN_REGISTRY } = await import(clientUrl)

assert.deepEqual([...WINDOWS_OWNER_DURABLE_STATUSES], [
  'dirty',
  'saving',
  'saved',
  'conflict',
  'commit-unknown',
  'not-ready',
])
const domains = Object.keys(WINDOWS_OWNER_DOMAIN_REGISTRY)
assert.deepEqual(domains, [
  'reader-session',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'marks-activity',
  'workflow',
])

for (const [index, domain] of domains.entries()) {
  const tracker = createWindowsOwnerDurableStatusTracker({
    domain,
    profileId: 'optimization',
    instanceId: 'instance-status',
  })
  assert.equal(tracker.getSnapshot().status, 'not-ready')
  const intent = tracker.recordIntent({ intentId: `intent-${index}`, intentFingerprint: FINGERPRINT })
  assert.equal(intent.generation, 1)
  const operation = WINDOWS_OWNER_DOMAIN_REGISTRY[domain].commandOperations.find((item) => item !== 'receipt-query')
  tracker.beginMutation(requestFor(domain, operation, `domain-${index}`))
  assert.equal(tracker.getSnapshot().status, 'saving')
  assert.equal(tracker.getSnapshot().inFlight.domain, domain)
}

const queryTracker = trackerFor('workflow')
queryTracker.observeOwnerQuery({
  ...baseResult({ domain: 'workflow', operation: 'health', requestId: 'query-1', correlationId: 'query-c-1' }, 'read', 'not-applicable', 4),
})
assert.equal(queryTracker.getSnapshot().status, 'not-ready', 'query result cannot create saved')
queryTracker.recordIntent({ intentId: 'query-intent' })
queryTracker.observeOwnerQuery({
  ...baseResult({ domain: 'workflow', operation: 'health', requestId: 'query-2', correlationId: 'query-c-2' }, 'read', 'not-applicable', 5),
})
assert.equal(queryTracker.getSnapshot().status, 'dirty', 'query result cannot clear a local intent')
queryTracker.observeOwnerQuery({
  ...baseResult({ domain: 'workflow', operation: 'health', requestId: 'query-3', correlationId: 'query-c-3' }, 'read', 'not-applicable', 99, {
    contractVersion: 'windows-thin-reader-api.v0',
  }),
})
assert.equal(queryTracker.getSnapshot().authoritativeRevision, 5, 'malformed query result must not update the baseline')

const ordinaryResultTracker = trackerFor('workflow')
ordinaryResultTracker.recordIntent({ intentId: 'ordinary-intent' })
const ordinaryRequest = requestFor('workflow', 'job-start', 'ordinary')
ordinaryResultTracker.beginMutation(ordinaryRequest)
ordinaryResultTracker.applyOwnerResult(baseResult(ordinaryRequest, 'read', 'not-applicable', null))
assert.equal(ordinaryResultTracker.getSnapshot().status, 'dirty', 'ordinary request completion cannot create saved')

const invalidCommitTracker = trackerFor('workflow')
invalidCommitTracker.recordIntent({ intentId: 'invalid-commit' })
const invalidCommitRequest = requestFor('workflow', 'job-start', 'invalid-commit')
invalidCommitTracker.beginMutation(invalidCommitRequest)
invalidCommitTracker.applyOwnerResult(baseResult(invalidCommitRequest, 'committed', 'committed', 1, { receipt: null }))
assert.equal(invalidCommitTracker.getSnapshot().status, 'saving', 'missing receipt must not create saved')
assert.equal(invalidCommitTracker.getSnapshot().reason, 'invalid-commit-evidence')

const notReadyTracker = trackerFor('workflow')
notReadyTracker.recordIntent({ intentId: 'not-ready' })
const notReadyRequest = requestFor('workflow', 'job-start', 'not-ready')
notReadyTracker.beginMutation(notReadyRequest)
notReadyTracker.applyOwnerResult(baseResult(notReadyRequest, 'not-ready', 'not-ready', null))
assert.equal(notReadyTracker.getSnapshot().status, 'not-ready')
assert.ok(notReadyTracker.getSnapshot().intent)

const rejectedTracker = trackerFor('workflow')
rejectedTracker.recordIntent({ intentId: 'rejected' })
const rejectedRequest = requestFor('workflow', 'job-start', 'rejected')
rejectedTracker.beginMutation(rejectedRequest)
rejectedTracker.applyOwnerResult(baseResult(rejectedRequest, 'rejected', 'rejected', null))
assert.equal(rejectedTracker.getSnapshot().status, 'dirty')

const conflictTracker = trackerFor('workflow')
conflictTracker.recordIntent({ intentId: 'conflict' })
const conflictRequest = requestFor('workflow', 'job-start', 'conflict', { expectedRevision: 1 })
conflictTracker.beginMutation(conflictRequest)
conflictTracker.applyOwnerResult(baseResult(conflictRequest, 'conflict', 'conflict', 2))
assert.equal(conflictTracker.getSnapshot().status, 'conflict')
assert.equal(conflictTracker.getSnapshot().authoritativeRevision, 2)
assert.equal(conflictTracker.getSnapshot().intent.intentId, 'conflict')

const unknownTracker = trackerFor('workflow')
unknownTracker.recordIntent({ intentId: 'unknown' })
const unknownRequest = requestFor('workflow', 'job-start', 'unknown')
unknownTracker.beginMutation(unknownRequest)
unknownTracker.applyOwnerResult(baseResult(unknownRequest, 'commit-unknown', 'commit-unknown', null))
assert.equal(unknownTracker.getSnapshot().status, 'commit-unknown')
assert.deepEqual(unknownTracker.getSnapshot().receiptLookup, {
  domain: 'workflow',
  operation: 'job-start',
  requestId: unknownRequest.requestId,
  correlationId: unknownRequest.correlationId,
  receiptOperation: 'receipt-query',
  idempotencyKey: unknownRequest.idempotencyKey,
})
assert.throws(
  () => unknownTracker.beginMutation(unknownRequest),
  /still unresolved/,
  'commit-unknown must not automatically replay a mutation',
)
unknownTracker.resolveReceipt(receiptQueryResult(receiptFor(unknownRequest, { commitStatus: 'pending', revision: null })))
assert.equal(unknownTracker.getSnapshot().status, 'commit-unknown')
unknownTracker.resolveReceipt({
  ...receiptQueryResult(receiptFor(unknownRequest)),
  contractVersion: 'windows-thin-reader-api.v0',
})
assert.equal(unknownTracker.getSnapshot().status, 'commit-unknown', 'malformed receipt query must stay unresolved')
unknownTracker.resolveReceipt(receiptQueryResult(receiptFor({ ...unknownRequest, idempotencyKey: 'wrong-key' })))
assert.equal(unknownTracker.getSnapshot().status, 'commit-unknown')
assert.equal(unknownTracker.getSnapshot().reason, 'receipt-mismatch')
unknownTracker.resolveReceipt(receiptQueryResult(receiptFor(unknownRequest, { revision: 1 })))
assert.equal(unknownTracker.getSnapshot().status, 'saved')
assert.equal(unknownTracker.getSnapshot().authoritativeRevision, 1)

const producerUnknownTracker = trackerFor('workflow')
producerUnknownTracker.recordIntent({ intentId: 'producer-unknown' })
const producerUnknownRequest = requestFor('workflow', 'job-start', 'producer-unknown')
producerUnknownTracker.beginMutation(producerUnknownRequest)
producerUnknownTracker.applyOwnerResult(baseResult(producerUnknownRequest, 'commit-unknown', 'commit-unknown', null))
producerUnknownTracker.resolveReceipt(receiptQueryResult(receiptFor(producerUnknownRequest, {
  commitStatus: 'commit-unknown',
  revision: null,
})))
assert.equal(producerUnknownTracker.getSnapshot().status, 'commit-unknown', 'producer commit-unknown receipt must remain unresolved')

const conflictReceiptTracker = trackerFor('workflow')
conflictReceiptTracker.recordIntent({ intentId: 'conflict-receipt' })
const conflictReceiptRequest = requestFor('workflow', 'job-start', 'conflict-receipt')
conflictReceiptTracker.beginMutation(conflictReceiptRequest)
conflictReceiptTracker.applyOwnerResult(baseResult(conflictReceiptRequest, 'commit-unknown', 'commit-unknown', null))
conflictReceiptTracker.resolveReceipt(receiptQueryResult(receiptFor(conflictReceiptRequest, {
  commitStatus: 'conflict',
  revision: 3,
})))
assert.equal(conflictReceiptTracker.getSnapshot().status, 'conflict')
assert.equal(conflictReceiptTracker.getSnapshot().authoritativeRevision, 3)

const newerIntentTracker = trackerFor('workflow')
newerIntentTracker.recordIntent({ intentId: 'old-intent' })
const oldRequest = requestFor('workflow', 'job-start', 'old-request')
newerIntentTracker.beginMutation(oldRequest)
newerIntentTracker.recordIntent({ intentId: 'new-intent' })
newerIntentTracker.applyOwnerResult(committedResult(oldRequest))
assert.equal(newerIntentTracker.getSnapshot().status, 'dirty', 'old commit cannot save a newer intent')
assert.equal(newerIntentTracker.getSnapshot().generation, 2)
assert.equal(newerIntentTracker.getSnapshot().authoritativeRevision, 1)
assert.equal(newerIntentTracker.getSnapshot().inFlight, null)
const lateSnapshot = newerIntentTracker.getSnapshot()
newerIntentTracker.applyOwnerResult(committedResult(oldRequest))
assert.deepEqual(newerIntentTracker.getSnapshot(), lateSnapshot, 'late duplicate result must be idempotent')

const currentCommitTracker = trackerFor('workflow')
currentCommitTracker.recordIntent({ intentId: 'current-intent' })
const currentRequest = requestFor('workflow', 'job-start', 'current-request')
currentCommitTracker.beginMutation(currentRequest)
currentCommitTracker.applyOwnerResult(committedResult(currentRequest))
const savedSnapshot = currentCommitTracker.getSnapshot()
assert.equal(savedSnapshot.status, 'saved')
currentCommitTracker.applyOwnerResult(committedResult(currentRequest))
assert.deepEqual(currentCommitTracker.getSnapshot(), savedSnapshot, 'same-generation duplicate result must be idempotent')

const opaqueRevisionTracker = trackerFor('workflow')
opaqueRevisionTracker.recordIntent({ intentId: 'opaque-revision' })
opaqueRevisionTracker.observeOwnerQuery({
  ...baseResult({ domain: 'workflow', operation: 'health', requestId: 'opaque-query', correlationId: 'opaque-correlation' }, 'read', 'not-applicable', 'rev-a'),
})
opaqueRevisionTracker.observeOwnerQuery({
  ...baseResult({ domain: 'workflow', operation: 'health', requestId: 'opaque-query-2', correlationId: 'opaque-correlation-2' }, 'read', 'not-applicable', 'rev-b'),
})
assert.equal(opaqueRevisionTracker.getSnapshot().authoritativeRevision, 'rev-b', 'sequential opaque query must update the received baseline')
const opaqueRequest = requestFor('workflow', 'job-start', 'opaque-revision', { expectedRevision: 'rev-b' })
opaqueRevisionTracker.beginMutation(opaqueRequest)
opaqueRevisionTracker.applyOwnerResult(committedResult(opaqueRequest, 'rev-c'))
assert.equal(opaqueRevisionTracker.getSnapshot().status, 'saved', 'opaque revision receipt may advance a matching CAS baseline')
assert.equal(opaqueRevisionTracker.getSnapshot().authoritativeRevision, 'rev-c')

const outOfOrderOpaqueTracker = trackerFor('workflow')
outOfOrderOpaqueTracker.recordIntent({ intentId: 'opaque-old' })
outOfOrderOpaqueTracker.observeOwnerQuery({
  ...baseResult({ domain: 'workflow', operation: 'health', requestId: 'opaque-old-query', correlationId: 'opaque-old-correlation' }, 'read', 'not-applicable', 'rev-a'),
})
const outOfOrderRequest = requestFor('workflow', 'job-start', 'opaque-old', { expectedRevision: 'rev-a' })
outOfOrderOpaqueTracker.beginMutation(outOfOrderRequest)
outOfOrderOpaqueTracker.recordIntent({ intentId: 'opaque-new' })
outOfOrderOpaqueTracker.observeOwnerQuery({
  ...baseResult({ domain: 'workflow', operation: 'health', requestId: 'opaque-new-query', correlationId: 'opaque-new-correlation' }, 'read', 'not-applicable', 'rev-c'),
})
outOfOrderOpaqueTracker.applyOwnerResult(committedResult(outOfOrderRequest, 'rev-b'))
assert.equal(outOfOrderOpaqueTracker.getSnapshot().authoritativeRevision, 'rev-c', 'late opaque receipt must not roll back a newer observed revision')
assert.equal(outOfOrderOpaqueTracker.getSnapshot().status, 'dirty')

const failureTracker = trackerFor('workflow')
failureTracker.recordIntent({ intentId: 'failure-intent' })
const failureRequest = requestFor('workflow', 'job-start', 'failure')
failureTracker.beginMutation(failureRequest)
failureTracker.recordMutationFailure({ code: 'invalid-request', category: 'validation' }, {
  generation: 1,
  requestId: failureRequest.requestId,
  dispatched: false,
})
assert.equal(failureTracker.getSnapshot().status, 'dirty', 'pre-dispatch validation failure must return dirty')

for (const code of ['timeout', 'aborted', 'upstream']) {
  const preDispatchTracker = trackerFor('workflow')
  preDispatchTracker.recordIntent({ intentId: `pre-dispatch-${code}` })
  const preDispatchRequest = requestFor('workflow', 'job-start', `pre-dispatch-${code}`)
  preDispatchTracker.beginMutation(preDispatchRequest)
  preDispatchTracker.recordMutationFailure({ code, category: 'recovery' }, {
    generation: 1,
    requestId: preDispatchRequest.requestId,
    dispatched: false,
  })
  assert.equal(preDispatchTracker.getSnapshot().status, 'dirty', `${code} before dispatch must return dirty`)
  assert.equal(preDispatchTracker.getSnapshot().receiptLookup, null, `${code} before dispatch must not create receipt lookup`)
}

const dispatchedFailureTracker = trackerFor('workflow')
dispatchedFailureTracker.recordIntent({ intentId: 'dispatched-failure' })
const dispatchedRequest = requestFor('workflow', 'job-start', 'dispatched-failure')
dispatchedFailureTracker.beginMutation(dispatchedRequest)
dispatchedFailureTracker.recordMutationFailure({ code: 'invalid-response', category: 'schema' }, {
  generation: 1,
  requestId: dispatchedRequest.requestId,
  dispatched: true,
})
assert.equal(dispatchedFailureTracker.getSnapshot().status, 'commit-unknown')

for (const code of ['timeout', 'aborted', 'upstream']) {
  const uncertainTracker = trackerFor('workflow')
  uncertainTracker.recordIntent({ intentId: `uncertain-${code}` })
  const uncertainRequest = requestFor('workflow', 'job-start', `uncertain-${code}`)
  uncertainTracker.beginMutation(uncertainRequest)
  uncertainTracker.recordMutationFailure({ code, category: 'recovery' }, {
    generation: 1,
    requestId: uncertainRequest.requestId,
    dispatched: true,
  })
  assert.equal(uncertainTracker.getSnapshot().status, 'commit-unknown', `${code} after dispatch must remain unknown`)
  assert.equal(uncertainTracker.getSnapshot().receiptLookup.idempotencyKey, uncertainRequest.idempotencyKey)
}

const payloadProbe = trackerFor('workflow')
payloadProbe.recordIntent({ intentId: 'memory-only' })
const payloadRequest = requestFor('workflow', 'job-start', 'memory-only')
payloadProbe.beginMutation({ ...payloadRequest, payload: { media: 'data:application/octet-stream;base64,secret' } })
const serializedSnapshot = JSON.stringify(payloadProbe.getSnapshot())
assert.ok(!serializedSnapshot.includes('data:application'))
assert.ok(!serializedSnapshot.includes('payload'))
assert.equal(typeof payloadProbe.setSaved, 'undefined')
assert.equal(typeof payloadProbe.markSaved, 'undefined')

const wrongDomainTracker = trackerFor('workflow')
wrongDomainTracker.recordIntent({ intentId: 'wrong-domain' })
assert.throws(
  () => wrongDomainTracker.beginMutation(requestFor('annotation', 'bundle-commit', 'wrong-domain')),
  /domain does not match/,
)
assert.equal(wrongDomainTracker.getSnapshot().status, 'dirty')

console.log('windows owner durable status focused check passed (six domains, saved evidence, stale/unknown/conflict/not-ready paths)')

function trackerFor(domain) {
  return createWindowsOwnerDurableStatusTracker({
    domain,
    profileId: 'optimization',
    instanceId: 'instance-status',
  })
}

function requestFor(domain, operation, suffix, overrides = {}) {
  return {
    domain,
    operation,
    requestId: `request-${suffix}`,
    correlationId: `correlation-${suffix}`,
    idempotencyKey: `idempotency-${suffix}`,
    expectedRevision: overrides.expectedRevision ?? 0,
    ...overrides,
  }
}

function baseResult(request, outcome, commitStatus, revision, overrides = {}) {
  const result = {
    contractVersion: contract.contractVersion,
    requestId: request.requestId,
    correlationId: request.correlationId,
    domain: request.domain,
    operation: request.operation,
    outcome,
    commitStatus,
    revision,
    receipt: null,
    payload: {},
    error: outcome === 'read' || outcome === 'committed' ? null : typedError(outcome, request.correlationId),
    ...overrides,
  }
  if (outcome === 'commit-unknown' && !overrides.payload) {
    result.payload = {
      receiptQuery: {
        domain: request.domain,
        operation: request.operation,
        requestId: request.requestId,
        correlationId: request.correlationId,
        receiptOperation: 'receipt-query',
        idempotencyKey: request.idempotencyKey,
      },
    }
  }
  return result
}

function committedResult(request, revision = 1) {
  return baseResult(request, 'committed', 'committed', revision, { receipt: receiptFor(request, { revision }) })
}

function receiptFor(request, overrides = {}) {
  const commitStatus = overrides.commitStatus || 'committed'
  const revision = overrides.revision === undefined ? 1 : overrides.revision
  return {
    receiptId: `receipt-${request.idempotencyKey}`,
    contractVersion: contract.contractVersion,
    profileId: 'optimization',
    instanceId: 'instance-status',
    requestId: request.requestId,
    correlationId: request.correlationId,
    domain: request.domain,
    operation: request.operation,
    idempotencyKey: request.idempotencyKey,
    expectedRevision: request.expectedRevision,
    requestFingerprint: FINGERPRINT,
    commitStatus,
    revision,
    effectFingerprint: FINGERPRINT,
    recordChecksums: [FINGERPRINT],
    evidenceChecksum: FINGERPRINT,
    evidenceSource: 'workflow-store',
    createdAt: '2026-08-29T00:00:00.000Z',
    committedAt: commitStatus === 'committed' ? '2026-08-29T00:00:01.000Z' : null,
    queryOperation: 'receipt-query',
    ...overrides,
    commitStatus,
    revision,
  }
}

function receiptQueryResult(receipt) {
  const status = receipt.commitStatus === 'pending' ? 'commit-unknown' : receipt.commitStatus
  const producerReceipt = receipt.commitStatus === status
    ? receipt
    : { ...receipt, commitStatus: status }
  const requestId = `receipt-query-${receipt.receiptId}`
  const correlationId = `receipt-correlation-${receipt.receiptId}`
  return {
    contractVersion: contract.contractVersion,
    requestId,
    correlationId,
    domain: receipt.domain,
    operation: 'receipt-query',
    outcome: status === 'commit-unknown' ? 'commit-unknown' : status,
    commitStatus: status,
    revision: producerReceipt.revision,
    receipt: producerReceipt,
    payload: { found: true },
    error: status === 'committed' ? null : typedError(status, correlationId),
  }
}

function typedError(code, correlationId) {
  return {
    type: 'windows-thin-reader-error.v1',
    code,
    category: code === 'conflict' ? 'conflict' : code === 'not-ready' ? 'readiness' : 'recovery',
    correlationId,
  }
}

function toDataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
}
