import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowRoot = path.join(repoRoot, 'tools', 'subtitle-workflow')
const distDir = path.join(repoRoot, 'dist')
const python = process.env.READ_WEB_PYTHON || process.env.PYTHON || 'python'
const token = 'isolated-production-host-test-token'
const releaseId = 'isolated-production-host-test'
const profileId = 'isolated-random-port'
const outputRoot = path.join(repoRoot, 'output', 'production-host')

const runtimeConfig = JSON.parse(await readFile(path.join(repoRoot, 'config', 'runtime.next.json'), 'utf8'))
assert.equal(runtimeConfig.frontend.port, 5174, 'next dev fallback must remain on 5174')
assert.equal(runtimeConfig.backend.port, 8766, 'next workflow fallback must remain on 8766')
assert.notEqual(runtimeConfig.frontend.port, 5173)
assert.notEqual(runtimeConfig.backend.port, 8765)

async function randomPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForHealth(baseUrl, instanceId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/app/health`)
      if (response.ok) {
        const health = await response.json()
        if (health.status === 'ready' && health.instanceId === instanceId) return health
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`production host did not become ready at ${baseUrl}`)
}

async function waitForPortClosed(port, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port })
      socket.setTimeout(200)
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
      socket.once('timeout', () => { socket.destroy(); resolve(false) })
    })
    if (!open) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`owned production host port ${port} remained open`)
}

function startHost({ port, instanceId, dataRoot }) {
  const child = spawn(python, [
    '-m', 'youtube_workflow.production_host_prototype',
    '--dist', distDir,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--release-id', releaseId,
    '--profile-id', profileId,
    '--instance-id', instanceId,
    '--release-manifest', manifestPath,
    '--config-schema-version', String(runtimeConfig.schemaVersion),
    '--capability-base-url', capabilityBaseUrl,
  ], {
    cwd: workflowRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      READ_WEB_SUBTITLE_DATA_ROOT: dataRoot,
      READ_WEB_RELEASE_ID: releaseId,
      READ_WEB_PROFILE_ID: profileId,
      READ_WEB_INSTANCE_ID: instanceId,
      READ_WEB_SERVICE_TOKEN: token,
    },
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let output = ''
  child.stdout.on('data', (text) => { output += text })
  child.stderr.on('data', (text) => { output += text })
  return { child, output: () => output }
}

function startCapabilityHost(port) {
  const child = spawn(process.execPath, [path.join(repoRoot, 'tools', 'local-capability-host.mjs'), '--port', String(port)], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      READ_WEB_CAPABILITY_HOST: '127.0.0.1',
      READ_WEB_CAPABILITY_PORT: String(port),
      READ_WEB_SERVICE_TOKEN: token,
    },
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let output = ''
  child.stdout.on('data', (text) => { output += text })
  child.stderr.on('data', (text) => { output += text })
  return { child, output: () => output }
}

async function waitForCapability(baseUrl, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/app/capabilities`)
      if (response.ok) return response.json()
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`capability host did not become ready at ${baseUrl}`)
}

function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`owned process ${child.pid} did not exit`)), timeoutMs)
    child.once('exit', (code) => { clearTimeout(timer); resolve(code) })
  })
}

async function stopOwned(host, signal = 'SIGTERM') {
  if (host.child.exitCode !== null) return
  host.child.kill(signal)
  try {
    await waitForExit(host.child)
  } catch (error) {
    host.child.kill('SIGKILL')
    await waitForExit(host.child)
    if (signal !== 'SIGKILL') throw error
  }
}

async function runNode(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, script)], {
      cwd: repoRoot,
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)))
  })
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-production-host-'))
const port = await randomPort()
const capabilityPort = await randomPort()
assert.ok(![5173, 5174, 8765, 8766].includes(port), `random isolation port collided with a reserved port: ${port}`)
assert.ok(![5173, 5174, 8765, 8766, port].includes(capabilityPort), `capability isolation port collided with a reserved port: ${capabilityPort}`)
const baseUrl = `http://127.0.0.1:${port}`
const capabilityBaseUrl = `http://127.0.0.1:${capabilityPort}`
const manifestPath = path.join(tempRoot, 'release-manifest.json')
const manifestBytes = Buffer.from(`${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  release: { application: 'read-final', frontendVersion: '1.0.0', backendVersion: '0.2.3', gitSha: releaseId, gitBranch: 'isolated', dirty: false },
  runtime: {}, dataCompatibility: {}, artifacts: [],
}, null, 2)}\n`)
await writeFile(manifestPath, manifestBytes)
const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex')
let host = null
let capability = null
const cycles = []
try {
  capability = startCapabilityHost(capabilityPort)
  const capabilityHealth = await waitForCapability(capabilityBaseUrl)
  assert.equal(capabilityHealth.status, 'ok')
  assert.equal(capabilityHealth.endpoints.length, 9)
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const instanceId = `production-cycle-${cycle}`
    host = startHost({ port, instanceId, dataRoot: path.join(tempRoot, `data-${cycle}`) })
    const health = await waitForHealth(baseUrl, instanceId)
    assert.deepEqual(
      {
        releaseId: health.releaseId,
        profileId: health.profileId,
        instanceId: health.instanceId,
        distReady: health.distReady,
        manifestSha256: health.manifest.sha256,
        manifestGitSha: health.manifest.gitSha,
        configSchemaVersion: health.configCompatibility.schemaVersion,
      },
      {
        releaseId,
        profileId,
        instanceId,
        distReady: true,
        manifestSha256,
        manifestGitSha: releaseId,
        configSchemaVersion: runtimeConfig.schemaVersion,
      },
    )

    const index = await fetch(`${baseUrl}/`)
    assert.equal(index.status, 200)
    const html = await index.text()
    assert.match(html, /assets\/reader-/)
    assert.doesNotMatch(html, /@vite\/client|src\/main\.js/)
    assert.equal((await fetch(`${baseUrl}/reader/session/fixed`)).status, 200)
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200)
    const workflowSnapshot = await fetch(`${baseUrl}/api/jobs/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-read-web-token': token },
      body: JSON.stringify({ jobIds: [] }),
    })
    assert.equal(workflowSnapshot.status, 200)

    const authorization = { 'x-read-web-token': token }
    const capabilities = await fetch(`${baseUrl}/api/app/capabilities`)
    assert.equal(capabilities.status, 200)
    assert.equal((await capabilities.json()).endpoints.length, 9)
    const dictionary = await fetch(`${baseUrl}/api/vocabulary/local-sentences?word=flow`, { headers: authorization })
    assert.equal(dictionary.status, 200)
    assert.match((await dictionary.json()).errorCode || '', /^LOCAL_SENTENCE_/)
    const tts = await fetch(`${baseUrl}/api/tts/edge`, {
      method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body: JSON.stringify({ text: '' }),
    })
    assert.equal(tts.status, 400)
    const translation = await fetch(`${baseUrl}/api/vocabulary/sentence-translations`, {
      method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body: JSON.stringify({ items: Array.from({ length: 1000 }, () => ({})) }),
    })
    assert.equal(translation.status, 400)
    assert.equal((await translation.json()).errorCode, 'SENTENCE_TRANSLATION_BATCH_INVALID')

    if (cycle === 1) {
      await runNode('scripts/perf/browser-journeys.mjs', {
        READ_WEB_PERF_BASE_URL: baseUrl,
        READ_WEB_PERF_OUTPUT: path.join(outputRoot, 'browser-journeys'),
        READ_WEB_PERF_REAL_HOST_APIS: '/api/health,/api/app/capabilities,/api/vocabulary/local-sentences,/api/tts/edge,/api/vocabulary/sentence-translations',
      })
      const browserArtifact = JSON.parse(await readFile(path.join(outputRoot, 'browser-journeys', 'browser-journeys.json'), 'utf8'))
      assert.equal(browserArtifact.isolation.mode, 'browser-route-fixtures-with-real-host-api')
      assert.ok(browserArtifact.isolation.realHostApiPaths.includes('/api/vocabulary/local-sentences'))
      assert.ok(browserArtifact.isolation.realHostApiPaths.includes('/api/tts/edge'))
      assert.equal(browserArtifact.errors.length, 0)
    }

    const pid = host.child.pid
    if (cycle === 2) await stopOwned(host, 'SIGKILL')
    else await stopOwned(host, 'SIGTERM')
    await waitForPortClosed(port)
    cycles.push({ cycle, pid, stop: cycle === 2 ? 'crash' : 'graceful', portReleased: true })
    host = null
  }
  console.log(JSON.stringify({ status: 'passed', port, cycles, viteProcessStarted: false, devFallback: { frontend: 5174, backend: 8766 } }, null, 2))
} finally {
  if (host) await stopOwned(host, 'SIGKILL').catch(() => {})
  if (capability) await stopOwned(capability, 'SIGTERM')
  await waitForPortClosed(capabilityPort)
  await rm(tempRoot, { recursive: true, force: true })
}
