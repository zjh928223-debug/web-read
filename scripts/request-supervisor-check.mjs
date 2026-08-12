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
