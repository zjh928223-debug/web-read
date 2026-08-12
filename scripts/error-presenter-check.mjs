import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const typedErrorSource = await fs.readFile(new URL('../src/services/runtime/typed-error.js', import.meta.url), 'utf8')
const typedErrorUrl = `data:text/javascript;base64,${Buffer.from(typedErrorSource).toString('base64')}`
const presenterSource = await fs.readFile(new URL('../src/services/runtime/error-presenter.js', import.meta.url), 'utf8')
const presenterUrl = `data:text/javascript;base64,${Buffer.from(
  presenterSource.replace("'./typed-error.js'", JSON.stringify(typedErrorUrl)),
).toString('base64')}`

const {
  ERROR_CATEGORIES,
  TypedApplicationError,
  createTypedError,
  isTypedError,
  normalizeError,
} = await import(typedErrorUrl)
const { createErrorPresenter } = await import(presenterUrl)

const expectedCategories = [
  'validation',
  'configuration',
  'network',
  'timeout',
  'canceled',
  'conflict',
  'storage',
  'external-tool',
  'permission',
  'internal',
]
assert.deepEqual([...ERROR_CATEGORIES], expectedCategories)

for (const category of expectedCategories) {
  const error = createTypedError({
    code: `FIXTURE_${category.replace('-', '_').toUpperCase()}`,
    category,
    message: `Safe ${category} message`,
    retryable: category === 'network',
    operationId: `operation-${category}`,
    details: { module: 'fixture' },
  })
  assert.equal(error instanceof TypedApplicationError, true)
  assert.equal(isTypedError(error), true)
  assert.deepEqual(
    {
      code: error.code,
      category: error.category,
      message: error.message,
      retryable: error.retryable,
      operationId: error.operationId,
      details: error.details,
    },
    {
      code: `FIXTURE_${category.replace('-', '_').toUpperCase()}`,
      category,
      message: `Safe ${category} message`,
      retryable: category === 'network',
      operationId: `operation-${category}`,
      details: { module: 'fixture' },
    },
  )
}

// Unknown exceptions become internal without exposing their message, stack,
// credentials, authorization, cookies, proxy auth, or private local paths.
const unknown = new Error(
  'request failed at C:\\Users\\alice\\Private\\lesson.json with token=top-secret '
    + 'Authorization: Bearer bearer-secret via http://proxy-user:proxy-pass@127.0.0.1:8080',
)
unknown.stack = 'STACK C:\\Users\\alice\\Private\\lesson.json cookie=session-secret'
unknown.details = {
  token: 'detail-token',
  apiKey: 'detail-api-key',
  cookie: 'detail-cookie',
  authorization: 'Bearer detail-bearer',
  path: 'C:\\Users\\alice\\Private\\lesson.json',
  proxy: 'http://proxy-user:proxy-pass@127.0.0.1:8080',
  nested: { safe: 'kept', password: 'detail-password' },
  stack: unknown.stack,
}
const normalizedUnknown = normalizeError(unknown, {
  operationId: 'operation-unknown',
  details: unknown.details,
})
assert.equal(normalizedUnknown.category, 'internal')
assert.equal(normalizedUnknown.code, 'INTERNAL_ERROR')
assert.equal(normalizedUnknown.message, 'Something went wrong')
assert.equal(normalizedUnknown.retryable, false)
assert.equal(normalizedUnknown.operationId, 'operation-unknown')
assert.equal('stack' in normalizedUnknown, false)
assert.equal(normalizedUnknown.details.nested.safe, 'kept')
assert.equal(Object.hasOwn(normalizedUnknown.details, 'stack'), false)
const unknownJson = JSON.stringify(normalizedUnknown)
for (const secret of [
  'alice', 'Private', 'top-secret', 'bearer-secret', 'session-secret',
  'detail-token', 'detail-api-key', 'detail-cookie', 'detail-bearer',
  'proxy-user', 'proxy-pass', 'detail-password',
]) {
  assert.equal(unknownJson.includes(secret), false, `unknown error must redact ${secret}`)
}

// Contract-shaped errors retain machine semantics while every UI-facing field
// is sanitized at the seam.
const normalizedTyped = normalizeError({
  code: 'UPSTREAM_TEMPORARY',
  category: 'network',
  message: 'Retry C:\\Users\\alice\\lesson.json with token=message-token',
  retryable: true,
  operationId: 'operation-network',
  details: {
    endpoint: 'http://service-user:service-pass@localhost/api',
    file: '/home/alice/private/lesson.json',
    safeCount: 3,
  },
})
assert.equal(normalizedTyped.code, 'UPSTREAM_TEMPORARY')
assert.equal(normalizedTyped.category, 'network')
assert.equal(normalizedTyped.retryable, true)
assert.equal(normalizedTyped.operationId, 'operation-network')
assert.equal(normalizedTyped.details.safeCount, 3)
const typedJson = JSON.stringify(normalizedTyped)
for (const secret of ['alice', 'message-token', 'service-user', 'service-pass', '/home/']) {
  assert.equal(typedJson.includes(secret), false, `typed error must redact ${secret}`)
}

assert.throws(
  () => createTypedError({ code: 'BAD', category: 'not-a-category', message: 'bad', retryable: false, operationId: 'op', details: {} }),
  /unsupported error category/,
)
assert.throws(
  () => createTypedError({ code: 'unstable code', category: 'internal', message: 'bad', retryable: false, operationId: 'op', details: {} }),
  /stable uppercase identifier/,
)

const presenter = createErrorPresenter()
const networkPresentation = presenter.present(normalizedTyped)
assert.deepEqual(networkPresentation.notice, {
  visible: true,
  tone: 'error',
  title: 'Network problem',
  message: normalizedTyped.message,
  operationId: 'operation-network',
})
assert.deepEqual(networkPresentation.status, {
  state: 'failed',
  category: 'network',
  code: 'UPSTREAM_TEMPORARY',
  operationId: 'operation-network',
})
assert.deepEqual(networkPresentation.retry, {
  allowed: true,
  label: 'Retry',
  operationId: 'operation-network',
})
assert.deepEqual(networkPresentation.diagnostic, {
  category: 'network',
  code: 'UPSTREAM_TEMPORARY',
  operationId: 'operation-network',
  details: normalizedTyped.details,
})

const timeoutPresentation = presenter.present(createTypedError({
  code: 'REQUEST_TIMEOUT',
  category: 'timeout',
  message: 'The request timed out',
  retryable: true,
  operationId: 'operation-timeout',
  details: {},
}))
assert.equal(timeoutPresentation.status.state, 'timed-out')
assert.equal(timeoutPresentation.notice.title, 'Timed out')
assert.equal(timeoutPresentation.retry.allowed, true)

const canceledPresentation = presenter.present(createTypedError({
  code: 'REQUEST_CANCELED',
  category: 'canceled',
  message: 'Canceled by user',
  retryable: false,
  operationId: 'operation-canceled',
  details: {},
}))
assert.deepEqual(canceledPresentation.notice, {
  visible: false,
  tone: 'neutral',
  title: 'Canceled',
  message: 'Canceled by user',
  operationId: 'operation-canceled',
})
assert.equal(canceledPresentation.status.state, 'canceled')
assert.equal(canceledPresentation.retry.allowed, false)

const validationPresentation = presenter.present(createTypedError({
  code: 'INVALID_MATERIAL',
  category: 'validation',
  message: 'Choose a supported material',
  retryable: false,
  operationId: 'operation-validation',
  details: { field: 'material' },
}))
assert.equal(validationPresentation.notice.title, 'Check the input')
assert.equal(validationPresentation.status.state, 'failed')
assert.equal(validationPresentation.retry.allowed, false)
assert.equal(Object.hasOwn(validationPresentation.notice, 'details'), false)

// Presenter is itself a safe seam for untyped failures.
const unknownPresentation = presenter.present(new Error('secret at C:\\Users\\alice\\secret.txt'), {
  operationId: 'operation-presenter',
})
assert.equal(unknownPresentation.error.category, 'internal')
assert.equal(unknownPresentation.status.operationId, 'operation-presenter')
assert.equal(JSON.stringify(unknownPresentation).includes('alice'), false)

const generatedOperationError = normalizeError(new Error('untyped failure'))
assert.match(generatedOperationError.operationId, /^operation-/)
assert.equal('stack' in generatedOperationError, false)
const generatedOperationPresentation = presenter.present(new Error('untyped presentation failure'))
assert.match(generatedOperationPresentation.status.operationId, /^operation-/)

console.log('typed error and ErrorPresenter check passed')
