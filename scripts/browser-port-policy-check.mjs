import assert from 'node:assert/strict'
import { isBrowserSafePort } from './lib/browser-port-policy.mjs'

for (const port of [1, 7, 80, 1723, 5060, 6000, 10080]) {
  assert.equal(isBrowserSafePort(port), false, `Chromium-unsafe port must be rejected: ${port}`)
}
for (const port of [1838, 4193, 43127]) {
  assert.equal(isBrowserSafePort(port), true, `ordinary browser port must remain available to the policy: ${port}`)
}
for (const port of [5173, 8765]) {
  assert.equal(isBrowserSafePort(port), false, `daily application port must be rejected by the shared browser policy: ${port}`)
}
assert.equal(isBrowserSafePort(0), false)
assert.equal(isBrowserSafePort(65536), false)

console.log('browser port policy check passed')
