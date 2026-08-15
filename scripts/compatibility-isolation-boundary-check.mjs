import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createIsolatedViteEnvironment, rejectExplicitReadWebUrl, RESERVED_DAILY_PORTS } from './lib/compatibility-isolation.mjs'

const originalEnv = {
  READ_WEB_URL: 'http://127.0.0.1:8765/',
  READ_WEB_RUNTIME_CONFIG: 'E:\\read-web\\config\\runtime.json',
  READ_WEB_PROXY_URL: 'http://127.0.0.1:7897',
  READ_WEB_SUBTITLE_DATA_ROOT: 'E:\\ReadWebData\\SubtitleWorkflow',
  VITE_LOCAL_SERVICE_BASE_URL: 'http://127.0.0.1:8765',
  VITE_READ_WEB_SERVICE_TOKEN: 'daily-token',
  ECDICT_ENABLED: 'true',
  ECDICT_DATABASE_PATH: 'E:\\read-web\\data\\ecdict.sqlite',
}

assert.deepEqual([...RESERVED_DAILY_PORTS].sort((a, b) => a - b), [5173, 8765])
assert.throws(
  () => rejectExplicitReadWebUrl(originalEnv),
  (error) => error?.code === 'COMPATIBILITY_EXPLICIT_URL_FORBIDDEN',
)

const config = createIsolatedViteEnvironment({
  frontendPort: 43127,
  backendPort: 43128,
  dataRoot: 'C:\\Temp\\read-web-compatibility-fixture',
  runtimeConfigPath: 'C:\\Temp\\read-web-compatibility-fixture\\runtime.json',
  serviceToken: 'isolated-token',
  env: originalEnv,
})

assert.equal(config.READ_WEB_FRONTEND_PORT, '43127')
assert.equal(config.READ_WEB_BACKEND_PORT, '43128')
assert.equal(config.READ_WEB_SUBTITLE_DATA_ROOT, 'C:\\Temp\\read-web-compatibility-fixture')
assert.equal(config.READ_WEB_RUNTIME_CONFIG, 'C:\\Temp\\read-web-compatibility-fixture\\runtime.json')
assert.equal(config.VITE_LOCAL_SERVICE_BASE_URL, 'http://127.0.0.1:43128')
assert.equal(config.VITE_READ_WEB_SERVICE_TOKEN, 'isolated-token')
assert.equal(config.ECDICT_ENABLED, 'false')
for (const name of [
  'READ_WEB_URL',
  'READ_WEB_PROXY_URL',
  'ECDICT_DATABASE_PATH',
]) assert.equal(Object.hasOwn(config, name), false, `${name} must not leak into the isolated Vite child`)

const child = spawnSync(process.execPath, ['-e', [
  "if (process.env.READ_WEB_BACKEND_PORT !== '43128') process.exit(1)",
  "if (process.env.READ_WEB_SUBTITLE_DATA_ROOT !== 'C:\\\\Temp\\\\read-web-compatibility-fixture') process.exit(2)",
  "if (process.env.READ_WEB_URL) process.exit(3)",
  "process.stdout.write('isolated child env received')",
].join(';')], { env: config, encoding: 'utf8' })
assert.equal(child.status, 0, child.stderr)
assert.equal(child.stdout, 'isolated child env received')

assert.throws(
  () => createIsolatedViteEnvironment({ frontendPort: 5173, backendPort: 43128, dataRoot: 'x', runtimeConfigPath: 'x', serviceToken: 'x', env: {} }),
  /reserved daily port 5173/,
)
assert.throws(
  () => createIsolatedViteEnvironment({ frontendPort: 43127, backendPort: 8765, dataRoot: 'x', runtimeConfigPath: 'x', serviceToken: 'x', env: {} }),
  /reserved daily port 8765/,
)

console.log('compatibility isolation boundary check passed')
