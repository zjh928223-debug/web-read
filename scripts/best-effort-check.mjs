import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const typedErrorSource = await fs.readFile(new URL('../src/services/runtime/typed-error.js', import.meta.url), 'utf8')
const typedErrorUrl = `data:text/javascript;base64,${Buffer.from(typedErrorSource).toString('base64')}`
const presenterSource = await fs.readFile(new URL('../src/services/runtime/error-presenter.js', import.meta.url), 'utf8')
const presenterUrl = `data:text/javascript;base64,${Buffer.from(
  presenterSource.replace("'./typed-error.js'", JSON.stringify(typedErrorUrl)),
).toString('base64')}`
const bestEffortSource = await fs.readFile(new URL('../src/services/runtime/best-effort.js', import.meta.url), 'utf8')
const bestEffortUrl = `data:text/javascript;base64,${Buffer.from(
  bestEffortSource.replace("'./error-presenter.js'", JSON.stringify(presenterUrl)),
).toString('base64')}`
const { observeBestEffort, recordBestEffortFailure } = await import(bestEffortUrl)

const warnings = []
const logger = { warn: (...args) => warnings.push(args) }
const fallback = await observeBestEffort(Promise.reject(new Error('Bearer top-secret')), {
  operationId: 'test-best-effort',
  reason: 'optional refresh must not block the primary action',
  fallback: 'kept-current-value',
  logger,
  details: { path: 'C:\\Users\\private\\secret.txt', token: 'hidden' },
})
assert.equal(fallback, 'kept-current-value')
assert.equal(warnings.length, 1)
assert.equal(warnings[0][1].operationId, 'test-best-effort')
assert.equal(warnings[0][1].details.bestEffort, true)
assert.equal(warnings[0][1].details.reason, 'optional refresh must not block the primary action')
assert.equal(warnings[0][1].details.path, '[private-path]')
assert.ok(!('token' in warnings[0][1].details))

assert.throws(() => recordBestEffortFailure(new Error('x'), { reason: 'missing id', logger }), /operationId/)
assert.throws(() => recordBestEffortFailure(new Error('x'), { operationId: 'missing-reason', logger }), /reason/)
console.log('best-effort failure policy passed')
