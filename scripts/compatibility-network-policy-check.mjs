import assert from 'node:assert/strict'
import { shouldContinueStaticRequest } from './lib/compatibility-network-policy.mjs'

const targetOrigin = 'http://127.0.0.1:43127'

assert.equal(
  shouldContinueStaticRequest(`${targetOrigin}/src/main.js`, targetOrigin),
  true,
  'the random Vite origin may serve static resources',
)
assert.equal(
  shouldContinueStaticRequest(`${targetOrigin}/api/health`, targetOrigin),
  false,
  'same-origin API traffic must remain stubbed',
)
assert.equal(
  shouldContinueStaticRequest(`${targetOrigin}/api`, targetOrigin),
  false,
  'the API root must remain stubbed',
)
assert.equal(
  shouldContinueStaticRequest('http://127.0.0.1:43128/src/main.js', targetOrigin),
  false,
  'another loopback origin must remain stubbed',
)
assert.equal(
  shouldContinueStaticRequest('https://example.invalid/assets/app.js', targetOrigin),
  false,
  'external traffic must remain stubbed',
)

console.log('compatibility network policy check passed')
