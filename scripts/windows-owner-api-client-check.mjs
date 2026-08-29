import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contractPath = path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader', 'api-contract.json')
const modulePath = path.join(repositoryRoot, 'src', 'services', 'windows-owner-api-client.js')
const contract = JSON.parse(await readFile(contractPath, 'utf8'))
const clientCode = await readFile(modulePath, 'utf8')
const imported = await importModule(clientCode, contract)
const {
  WINDOWS_OWNER_API_ROUTE,
  WINDOWS_OWNER_DOMAIN_REGISTRY,
  WindowsOwnerApiError,
  createWindowsOwnerApiClient,
  getWindowsOwnerOperation,
} = imported

assert.equal(WINDOWS_OWNER_API_ROUTE, '/api/app/owner')
assert.deepEqual(Object.keys(WINDOWS_OWNER_DOMAIN_REGISTRY), contract.domainRegistry.map((item) => item.domain))
assert.equal(contract.futureImplementationBoundary.authorityReady, false)

for (const registration of contract.domainRegistry) {
  const operationMap = contract.operationCapabilityRegistry.domains[registration.domain]
  for (const operation of registration.queryOperations) {
    const mapped = getWindowsOwnerOperation(registration.domain, operation, 'query')
    assert.deepEqual(mapped, {
      domain: registration.domain,
      operation,
      kind: 'query',
      capability: operationMap.query[operation],
    })
    assert.ok(registration.capabilities.includes(mapped.capability))
  }
  for (const operation of registration.commandOperations.filter((item) => item !== 'receipt-query')) {
    const mapped = getWindowsOwnerOperation(registration.domain, operation, 'command')
    assert.deepEqual(mapped, {
      domain: registration.domain,
      operation,
      kind: 'command',
      capability: operationMap.command[operation],
    })
    assert.ok(registration.capabilities.includes(mapped.capability))
  }
  assert.equal(
    getWindowsOwnerOperation(registration.domain, 'receipt-query', 'query'),
    null,
    'receipt-query must use the receipt method, not query or command guessing',
  )
}

let calls = []
const client = createWindowsOwnerApiClient({
  profileId: 'optimization',
  instanceId: 'instance-test',
  fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body)
    calls.push({ url, options, request })
    if (request.kind === 'query') return jsonResponse(readResponse(request))
    if (request.kind === 'receipt-query') return jsonResponse(readResponse(request))
    return jsonResponse(notReadyResponse(request), 503)
  },
})

const queryOperations = [
  ['reader-session', 'snapshot'],
  ['vocabulary-srs', 'entry'],
  ['passage-preview', 'durable-state'],
  ['annotation', 'bundle'],
  ['marks-activity', 'marks'],
  ['workflow', 'health'],
]
const commandOperations = [
  ['reader-session', 'commit'],
  ['vocabulary-srs', 'review-attempt'],
  ['passage-preview', 'state-commit'],
  ['annotation', 'bundle-commit'],
  ['marks-activity', 'marks-commit'],
  ['workflow', 'job-start'],
]

for (const [domain, operation] of queryOperations) {
  const result = await client.query({ domain, operation, payload: { probe: domain } })
  assert.equal(result.outcome, 'read')
}
for (const [domain, operation] of commandOperations) {
  const result = await client.command({
    domain,
    operation,
    payload: { probe: domain },
    expectedRevision: 0,
    idempotencyKey: `test-${domain}`,
  })
  assert.equal(result.outcome, 'not-ready')
  assert.equal(result.commitStatus, 'not-ready')
}
const receiptResult = await client.receipt({ domain: 'workflow', idempotencyKey: 'test-workflow' })
assert.equal(receiptResult.outcome, 'read')
assert.equal(receiptResult.operation, 'receipt-query')
assert.equal(calls.length, 13)
assert.ok(calls.every(({ url }) => url === WINDOWS_OWNER_API_ROUTE))
assert.ok(calls.every(({ options }) => options.credentials === 'same-origin'))
assert.ok(calls.every(({ options }) => options.headers.accept === 'application/json'))
assert.ok(calls.every(({ options }) => !('Authorization' in options.headers) && !('X-Read-Web-Token' in options.headers)))
assert.ok(calls.every(({ url, options }) => !url.includes('token') && !String(options.body).includes('test-client-token')))
assert.deepEqual(calls[0].request, {
  contractVersion: contract.contractVersion,
  requestId: calls[0].request.requestId,
  correlationId: calls[0].request.correlationId,
  kind: 'query',
  domain: 'reader-session',
  operation: 'snapshot',
  capability: 'reader-session.query',
  payload: { probe: 'reader-session', profileId: 'optimization', instanceId: 'instance-test' },
})
assert.equal(calls[6].request.kind, 'command')
assert.equal(calls[6].request.expectedRevision, 0)
assert.equal(calls[6].request.idempotencyKey, 'test-reader-session')
assert.equal(calls[12].request.kind, 'receipt-query')
assert.equal(calls[12].request.operation, 'receipt-query')
assert.equal(calls[12].request.idempotencyKey, 'test-workflow')

const receiptCalls = []
const receiptClient = createWindowsOwnerApiClient({
  profileId: 'optimization',
  fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body)
    receiptCalls.push(request)
    return jsonResponse(readResponse(request))
  },
})
for (const domain of contract.domainRegistry.map((item) => item.domain)) {
  const result = await receiptClient.receipt({ domain, receiptId: `receipt-${domain}` })
  assert.equal(result.outcome, 'read')
}
assert.equal(receiptCalls.length, 6)
assert.ok(receiptCalls.every((request) => request.kind === 'receipt-query' && request.operation === 'receipt-query'))
assert.ok(receiptCalls.every((request) => request.capability === `${request.domain}.receipt`))

const beforeInvalid = calls.length
await assert.rejects(
  client.query({ domain: 'unknown-domain', operation: 'snapshot' }),
  (error) => error instanceof WindowsOwnerApiError && error.code === 'invalid-request',
)
await assert.rejects(
  client.query({ domain: 'reader-session', operation: 'commit' }),
  (error) => error instanceof WindowsOwnerApiError && error.code === 'invalid-request',
)
await assert.rejects(
  client.command({ domain: 'reader-session', operation: 'commit', expectedRevision: 0 }),
  (error) => error instanceof WindowsOwnerApiError && error.code === 'invalid-request',
)
await assert.rejects(
  client.command({ domain: 'reader-session', operation: 'commit', idempotencyKey: 'missing-revision' }),
  (error) => error instanceof WindowsOwnerApiError && error.code === 'invalid-request',
)
await assert.rejects(
  client.command({ domain: 'reader-session', operation: 'commit', expectedRevision: null, idempotencyKey: 'null-revision' }),
  (error) => error instanceof WindowsOwnerApiError && error.code === 'invalid-request',
)
await assert.rejects(
  client.command({ domain: 'reader-session', operation: 'commit', expectedRevision: 0, idempotencyKey: 'wrong-profile', payload: { profileId: 'daily' } }),
  (error) => error instanceof WindowsOwnerApiError && error.code === 'invalid-request',
)
await assert.rejects(
  client.receipt({ domain: 'workflow' }),
  (error) => error instanceof WindowsOwnerApiError && error.code === 'invalid-request',
)
assert.equal(calls.length, beforeInvalid, 'invalid operations must fail before fetch')

const conflictClient = createWindowsOwnerApiClient({
  profileId: 'optimization',
  fetchImpl: async (_url, options) => jsonResponse({
    ...baseResponse(JSON.parse(options.body)),
    outcome: 'conflict',
    commitStatus: 'conflict',
    revision: 9,
    payload: {},
    error: typedError(JSON.parse(options.body), 'revision-conflict', 'conflict', { currentRevision: 9 }),
  }, 409),
})
const conflict = await conflictClient.command({
  domain: 'marks-activity',
  operation: 'marks-commit',
  expectedRevision: 8,
  idempotencyKey: 'conflict-1',
})
assert.equal(conflict.outcome, 'conflict')
assert.equal(conflict.error.details.currentRevision, 9)

const unknownResponseClient = createWindowsOwnerApiClient({
  profileId: 'optimization',
  fetchImpl: async (_url, options) => jsonResponse({
    ...baseResponse(JSON.parse(options.body)),
    outcome: 'commit-unknown',
    commitStatus: 'commit-unknown',
    revision: null,
    receipt: null,
    payload: { receiptQuery: { operation: 'receipt-query' } },
    error: typedError(JSON.parse(options.body), 'commit-unknown', 'recovery', { lookupAvailable: true }),
  }),
})
const unknownResponse = await unknownResponseClient.command({
  domain: 'workflow',
  operation: 'job-start',
  expectedRevision: 0,
  idempotencyKey: 'unknown-response-1',
})
assert.equal(unknownResponse.outcome, 'commit-unknown')
assert.equal(unknownResponse.commitStatus, 'commit-unknown')

const twoHundredNotReadyClient = createWindowsOwnerApiClient({
  profileId: 'optimization',
  fetchImpl: async (_url, options) => jsonResponse(notReadyResponse(JSON.parse(options.body)), 200),
})
const twoHundredNotReady = await twoHundredNotReadyClient.command({
  domain: 'annotation',
  operation: 'bundle-commit',
  expectedRevision: 0,
  idempotencyKey: 'not-ready-200',
})
assert.equal(twoHundredNotReady.outcome, 'not-ready')
assert.notEqual(twoHundredNotReady.outcome, 'committed')

const sensitiveErrorClient = createWindowsOwnerApiClient({
  profileId: 'optimization',
  fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body)
    return jsonResponse({
      ...baseResponse(request),
      outcome: 'not-ready',
      commitStatus: 'not-ready',
      revision: null,
      diagnostic: { token: 'secret-client-token', path: 'C:\\Users\\daily\\profile' },
      error: {
        ...typedError(request, 'not-ready', 'readiness', {
          path: 'C:\\Users\\daily\\profile',
          nested: { token: 'secret-client-token' },
        }),
        message: 'blocked at C:\\Users\\daily\\profile token=secret-client-token',
      },
    })
  },
})
const sensitiveResult = await sensitiveErrorClient.query({ domain: 'workflow', operation: 'health' })
assert.equal(sensitiveResult.error.details.path, '[redacted]')
assert.equal(sensitiveResult.error.details.nested.token, '[redacted]')
assert.ok(!JSON.stringify(sensitiveResult).includes('secret-client-token'))
assert.ok(!JSON.stringify(sensitiveResult).includes('C:\\Users\\daily'))

let malformedCalls = 0
const malformedClient = createWindowsOwnerApiClient({
  profileId: 'optimization',
  fetchImpl: async () => {
    malformedCalls += 1
    return jsonResponse({ contractVersion: contract.contractVersion, outcome: 'read' })
  },
})
await assert.rejects(
  malformedClient.query({ domain: 'workflow', operation: 'health' }),
  (error) => error instanceof WindowsOwnerApiError && error.code === 'invalid-response',
)
assert.equal(malformedCalls, 1)

const mismatchClient = createWindowsOwnerApiClient({
  profileId: 'optimization',
  fetchImpl: async (_url, options) => ({
    ok: true,
    status: 200,
    async json() {
      return readResponse({ ...JSON.parse(options.body), domain: 'workflow' })
    },
  }),
})
await assert.rejects(
  mismatchClient.query({ domain: 'reader-session', operation: 'snapshot' }),
  (error) => error instanceof WindowsOwnerApiError && error.code === 'invalid-response',
)

const abortController = new AbortController()
let abortCalls = 0
const abortClient = createWindowsOwnerApiClient({
  profileId: 'optimization',
  fetchImpl: async (_url, options) => {
    abortCalls += 1
    await new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
    })
  },
})
const abortPromise = abortClient.query({ domain: 'workflow', operation: 'health', signal: abortController.signal })
abortController.abort()
await assert.rejects(abortPromise, (error) => error.code === 'aborted')
assert.equal(abortCalls, 1)

const timeoutClient = createWindowsOwnerApiClient({
  profileId: 'optimization',
  timeoutMs: 15,
  fetchImpl: async (_url, options) => {
    await new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })), { once: true })
    })
  },
})
await assert.rejects(
  timeoutClient.query({ domain: 'workflow', operation: 'health' }),
  (error) => error.code === 'timeout',
)

let mutationTransportCalls = 0
const transportClient = createWindowsOwnerApiClient({
  profileId: 'optimization',
  timeoutMs: 15,
  fetchImpl: async () => {
    mutationTransportCalls += 1
    throw new Error('connection lost')
  },
})
const transportUnknown = await transportClient.command({
  domain: 'workflow',
  operation: 'job-start',
  expectedRevision: 0,
  idempotencyKey: 'transport-unknown-1',
})
assert.equal(transportUnknown.outcome, 'commit-unknown')
assert.equal(transportUnknown.error.code, 'commit-unknown')
assert.equal(mutationTransportCalls, 1, 'mutation transport failures must not be automatically replayed')

await assert.rejects(
  client.command({ domain: 'workflow', operation: 'job-start', expectedRevision: 0, idempotencyKey: 'binary', payload: { bytes: new ArrayBuffer(2) } }),
  (error) => error.code === 'invalid-request',
)
await assert.rejects(
  client.query({ domain: 'workflow', operation: 'media-capability', payload: { nested: { path: 'data:audio/mpeg;base64,AAAA' } } }),
  (error) => error.code === 'invalid-request',
)
await assert.rejects(
  client.query({ domain: 'workflow', operation: 'health', payload: { accessToken: 'test-client-token' } }),
  (error) => error.code === 'invalid-request',
)
assert.ok(!clientCode.includes('localStorage'))
assert.ok(!clientCode.includes('indexedDB'))
assert.ok(!clientCode.includes('sessionStorage'))
assert.ok(!clientCode.includes('Blob('))
assert.ok(!clientCode.includes('ArrayBuffer('))

const committedRequest = {
  requestId: 'old-request-1',
  correlationId: 'old-correlation-1',
  kind: 'command',
  domain: 'workflow',
  operation: 'job-start',
  capability: 'workflow.job-command',
  contractVersion: contract.contractVersion,
  payload: { profileId: 'optimization', instanceId: 'instance-test' },
  expectedRevision: 1,
  idempotencyKey: 'committed-1',
}
const committed = await createWindowsOwnerApiClient({
  profileId: 'optimization',
  instanceId: 'instance-test',
  fetchImpl: async () => jsonResponse(committedResponse(committedRequest)),
}).command({
  domain: 'workflow',
  operation: 'job-start',
  requestId: committedRequest.requestId,
  correlationId: committedRequest.correlationId,
  expectedRevision: 1,
  idempotencyKey: 'committed-1',
})
assert.equal(committed.outcome, 'committed')
assert.equal(committed.receipt.instanceId, 'instance-test')

const receiptQueryWithStoredReceipt = await createWindowsOwnerApiClient({
  profileId: 'optimization',
  fetchImpl: async (_url, options) => jsonResponse({
    ...baseResponse(JSON.parse(options.body)),
    outcome: 'read',
    commitStatus: 'not-applicable',
    revision: 2,
    receipt: receiptFor(committedRequest),
    payload: { found: true },
  }),
}).receipt({ domain: 'workflow', receiptId: 'receipt-1' })
assert.equal(receiptQueryWithStoredReceipt.outcome, 'read')
assert.equal(receiptQueryWithStoredReceipt.receipt.requestId, 'old-request-1')

console.log('windows owner API client check passed')

async function importModule(clientCode, value) {
  const importLine = "import apiContract from '../../docs/architecture/windows-local-owner-thin-reader/api-contract.json'"
  assert.ok(clientCode.includes(importLine), 'client must use the frozen API contract artifact')
  const rewritten = clientCode.replace(importLine, `const apiContract = ${JSON.stringify(value)}`)
  const encoded = Buffer.from(rewritten, 'utf8').toString('base64')
  return import(`data:text/javascript;base64,${encoded}#windows-owner-api-client-check`)
}

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value
    },
  }
}

function baseResponse(request) {
  return {
    contractVersion: contract.contractVersion,
    requestId: request.requestId,
    correlationId: request.correlationId,
    domain: request.domain,
    operation: request.operation,
    outcome: 'read',
    commitStatus: 'not-applicable',
    revision: 0,
    receipt: null,
    payload: {},
  }
}

function readResponse(request) {
  return { ...baseResponse(request), payload: { source: 'focused-fixture' } }
}

function notReadyResponse(request) {
  return {
    ...baseResponse(request),
    outcome: 'not-ready',
    commitStatus: 'not-ready',
    revision: null,
    error: typedError(request, 'not-ready', 'readiness', { reason: 'pre-cutover' }),
  }
}

function typedError(request, code, category, details = {}) {
  return {
    type: 'windows-thin-reader-error.v1',
    code,
    category,
    message: code,
    retryable: false,
    correlationId: request.correlationId,
    details,
  }
}

function committedResponse(request) {
  return {
    ...baseResponse(request),
    outcome: 'committed',
    commitStatus: 'committed',
    revision: 2,
    receipt: receiptFor(request),
    payload: { accepted: true },
  }
}

function receiptFor(request) {
  return {
    receiptId: 'receipt-1',
    contractVersion: contract.contractVersion,
    profileId: 'optimization',
    instanceId: 'instance-test',
    requestId: request.requestId,
    correlationId: request.correlationId,
    domain: request.domain,
    operation: request.operation,
    idempotencyKey: request.idempotencyKey || 'stored-idempotency',
    expectedRevision: request.expectedRevision ?? null,
    requestFingerprint: `sha256:${'1'.repeat(64)}`,
    commitStatus: 'committed',
    revision: 2,
    effectFingerprint: `sha256:${'2'.repeat(64)}`,
    recordChecksums: [`sha256:${'3'.repeat(64)}`],
    evidenceChecksum: `sha256:${'4'.repeat(64)}`,
    evidenceSource: 'focused-fixture',
    createdAt: '2026-08-29T00:00:00.000Z',
    committedAt: '2026-08-29T00:00:01.000Z',
    queryOperation: 'receipt-query',
  }
}
