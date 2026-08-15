import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

import { isBrowserSafePort } from './lib/browser-port-policy.mjs'

for (const port of [5173, 8765, 6000, 10080]) {
  assert.equal(isBrowserSafePort(port), false, `compatibility map must reject unsafe or daily port ${port}`)
}

for (const port of [6000, 10080]) {
  const environment = { ...process.env, READ_WEB_COMPAT_MAP_PORT: String(port) }
  delete environment.READ_WEB_URL
  const result = spawnSync(process.execPath, ['scripts/compatibility-consumer-map.mjs'], {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  })
  assert.equal(result.error, undefined, `explicit unsafe port ${port} must fail without starting Vite`)
  assert.notEqual(result.status, 0, `explicit unsafe port ${port} must fail closed`)
  assert.match(
    `${result.stdout || ''}${result.stderr || ''}`,
    /invalid compatibility map port/,
    `explicit unsafe port ${port} must be rejected before Vite startup`,
  )
}

console.log('compatibility consumer map port checks passed')
