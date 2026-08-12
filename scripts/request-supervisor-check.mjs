import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const moduleUrl = new URL('../src/services/runtime/request-supervisor.js', import.meta.url)
const moduleSource = await fs.readFile(moduleUrl, 'utf8')
const { createRequestSupervisor } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const supervisor = createRequestSupervisor({ defaultTimeoutMs: 1_000 })

// A newer generation for the same operation wins, aborts its predecessor, and
// prevents a late predecessor value from becoming observable as success.
const oldWork = deferred()
const newWork = deferred()
let oldSignal
const oldRequest = supervisor.run('load-session', ({ signal }) => {
  oldSignal = signal
  return oldWork.promise
}, { correlationId: 'load-old' })
await Promise.resolve()
const newRequest = supervisor.run('load-session', () => newWork.promise, { correlationId: 'load-new' })
assert.equal(oldSignal.aborted, true)

newWork.resolve('new-value')
const newResult = await newRequest
assert.deepEqual(
  { ok: newResult.ok, status: newResult.status, value: newResult.value, generation: newResult.generation, correlationId: newResult.correlationId },
  { ok: true, status: 'success', value: 'new-value', generation: 2, correlationId: 'load-new' },
)

const oldResult = await oldRequest
assert.deepEqual(
  { ok: oldResult.ok, status: oldResult.status, generation: oldResult.generation, correlationId: oldResult.correlationId, code: oldResult.error.code },
  { ok: false, status: 'superseded', generation: 1, correlationId: 'load-old', code: 'REQUEST_SUPERSEDED' },
)
oldWork.resolve('late-old-value')
await Promise.resolve()

// Generation and resource revision are separate commit guards. A task that
// ignores abort and finishes late must not commit after a newer generation.
const generationCommits = []
const ignoredAbortWork = deferred()
const ignoredAbortRequest = supervisor.run('guarded-generation', async ({ commit }) => {
  const value = await ignoredAbortWork.promise
  commit(() => generationCommits.push(value))
  return value
}, { correlationId: 'guarded-old' })
await Promise.resolve()
const currentGenerationResult = await supervisor.run('guarded-generation', async ({ commit }) => {
  commit(() => generationCommits.push('current-generation'))
  return 'current-generation'
}, { correlationId: 'guarded-current' })
ignoredAbortWork.resolve('late-generation')
const ignoredAbortResult = await ignoredAbortRequest
await Promise.resolve()
assert.equal(currentGenerationResult.status, 'success')
assert.equal(ignoredAbortResult.status, 'superseded')
assert.deepEqual(generationCommits, ['current-generation'])

// A resource can advance without starting a new request generation. Revision
// therefore needs an explicit guard rather than being inferred from generation.
let currentRevision = 'revision-1'
const revisionWork = deferred()
const revisionCommits = []
const staleRevisionRequest = supervisor.run('load-revisioned-resource', async ({ revision, commit }) => {
  assert.equal(revision, 'revision-1')
  const value = await revisionWork.promise
  const committed = commit(() => revisionCommits.push(value))
  assert.equal(committed, false)
  return value
}, {
  revision: 'revision-1',
  getCurrentRevision: () => currentRevision,
  correlationId: 'revision-old',
})
await Promise.resolve()
currentRevision = 'revision-2'
revisionWork.resolve('late-revision-1')
const staleRevisionResult = await staleRevisionRequest
assert.deepEqual(
  {
    ok: staleRevisionResult.ok,
    status: staleRevisionResult.status,
    generation: staleRevisionResult.generation,
    revision: staleRevisionResult.revision,
    currentRevision: staleRevisionResult.currentRevision,
    correlationId: staleRevisionResult.correlationId,
    code: staleRevisionResult.error.code,
  },
  {
    ok: false,
    status: 'stale-revision',
    generation: 1,
    revision: 'revision-1',
    currentRevision: 'revision-2',
    correlationId: 'revision-old',
    code: 'REQUEST_REVISION_STALE',
  },
)
assert.deepEqual(revisionCommits, [])

const currentRevisionResult = await supervisor.run('load-revisioned-resource', async ({ commit }) => {
  assert.equal(commit(() => revisionCommits.push('revision-2')), true)
  return 'revision-2-value'
}, {
  revision: 'revision-2',
  getCurrentRevision: () => currentRevision,
  correlationId: 'revision-current',
})
assert.deepEqual(
  { ok: currentRevisionResult.ok, status: currentRevisionResult.status, revision: currentRevisionResult.revision, value: currentRevisionResult.value },
  { ok: true, status: 'success', revision: 'revision-2', value: 'revision-2-value' },
)
assert.deepEqual(revisionCommits, ['revision-2'])

await assert.rejects(
  supervisor.run('invalid-revision-guard', async () => 'unreachable', { revision: 1 }),
  /getCurrentRevision is required/,
)

// Operations have independent single-flight lanes.
const independent = await Promise.all([
  supervisor.run('load-audio', async () => 'audio'),
  supervisor.run('load-transcript', async () => 'transcript'),
])
assert.deepEqual(independent.map((result) => result.value), ['audio', 'transcript'])

let timeoutSignal
const timeoutResult = await supervisor.run('slow-request', ({ signal }) => {
  timeoutSignal = signal
  return new Promise(() => {})
}, { timeoutMs: 10, correlationId: 'slow-1' })
assert.equal(timeoutSignal.aborted, true)
assert.deepEqual(
  { ok: timeoutResult.ok, status: timeoutResult.status, correlationId: timeoutResult.correlationId, code: timeoutResult.error.code },
  { ok: false, status: 'timeout', correlationId: 'slow-1', code: 'REQUEST_TIMEOUT' },
)

let canceledSignal
const canceledRequest = supervisor.run('manual-cancel', ({ signal }) => {
  canceledSignal = signal
  return new Promise(() => {})
})
await Promise.resolve()
assert.equal(supervisor.cancel('manual-cancel'), true)
const canceledResult = await canceledRequest
assert.equal(canceledSignal.aborted, true)
assert.equal(canceledResult.status, 'aborted')
assert.equal(canceledResult.error.code, 'REQUEST_ABORTED')
assert.equal(typeof canceledResult.correlationId, 'string')
assert.ok(canceledResult.correlationId.length > 0)

const failedResult = await supervisor.run('typed-error', async () => {
  throw new TypeError('bad payload')
}, { correlationId: 'failure-1' })
assert.deepEqual(
  { ok: failedResult.ok, status: failedResult.status, correlationId: failedResult.correlationId, code: failedResult.error.code, name: failedResult.error.name, message: failedResult.error.message },
  { ok: false, status: 'error', correlationId: 'failure-1', code: 'REQUEST_FAILED', name: 'TypeError', message: 'bad payload' },
)

assert.equal(supervisor.cancel('not-running'), false)
assert.deepEqual(supervisor.activeOperations(), [])

console.log('request supervisor check passed')
