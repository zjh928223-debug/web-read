import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadRuntimeConfig } from '../src/services/runtime/runtime-config-node.mjs'

const legacy = loadRuntimeConfig({ env: {}, cwd: process.cwd() })
assert.equal(legacy.frontend.port, 5173)
assert.equal(legacy.backend.port, 8765)
assert.equal(legacy.python.executable, 'python')
assert.equal(legacy.tools.ytDlp, 'yt-dlp')
assert.match(legacy.tools.cookies, /cookies\.txt$/)
assert.equal(legacy.network.proxyUrl, 'http://127.0.0.1:7897')

const next = loadRuntimeConfig({ configPath: 'config/runtime.next.json', env: {}, cwd: process.cwd() })
assert.equal(next.frontend.url, 'http://127.0.0.1:5174/')
assert.equal(next.backend.healthUrl, 'http://127.0.0.1:8766/api/health')
const legacyProfile = loadRuntimeConfig({ configPath: 'config/runtime.legacy.json', env: {}, cwd: process.cwd() })
assert.equal(legacyProfile.frontend.port, 5173)
assert.equal(legacyProfile.backend.port, 8765)

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'read-web-runtime-config-'))
try {
  const configPath = path.join(root, 'runtime.json')
  await fs.writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    frontend: { port: 5188 },
    backend: { port: 8788 },
    dataRoot: './workflow-data',
    python: { executable: './python/python.exe' },
    tools: { ytDlp: './bin/yt-dlp.exe', whisperx: 'whisperx', ffmpeg: 'ffmpeg' },
    network: { proxyUrl: 'http://127.0.0.1:7000' },
    ai: { model: 'fixture-model' },
  }))
  const runtime = loadRuntimeConfig({ configPath, env: { READ_WEB_BACKEND_PORT: '8799' } })
  assert.equal(runtime.backend.port, 8799)
  assert.equal(runtime.dataRoot, path.join(root, 'workflow-data'))
  assert.equal(runtime.python.executable, path.join(root, 'python', 'python.exe'))
  assert.equal(runtime.ai.model, 'fixture-model')
  const selectedByCanonicalEnv = loadRuntimeConfig({
    configPath,
    env: {
      READ_WEB_PYTHON: './python/canonical.exe',
      READ_WEB_PYTHON_PATH: './python/compatibility-alias.exe',
    },
  })
  assert.equal(selectedByCanonicalEnv.python.executable, path.join(root, 'python', 'canonical.exe'))
} finally {
  await fs.rm(root, { recursive: true, force: true })
}

const vite = await fs.readFile(new URL('../vite.config.mjs', import.meta.url), 'utf8')
assert.match(vite, /loadRuntimeConfig/)
assert.match(vite, /runtime\.frontend\.port/)
assert.match(vite, /runtime\.network\.proxyUrl/)
assert.match(vite, /runtime\.ai\.model/)
assert.doesNotMatch(vite, /port:\s*5173/)

for (const name of ['start-latest-reader.ps1', 'launch-learning-page.ps1']) {
  const source = await fs.readFile(new URL(name, import.meta.url), 'utf8')
  assert.match(source, /READ_WEB_RUNTIME_CONFIG|RuntimeConfigPath/)
  assert.doesNotMatch(source, /C:\\Users\\0/)
  assert.doesNotMatch(source, /D:\\whisper_env/)
}

console.log('runtime config integration check passed')
