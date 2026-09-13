import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { listenOnBrowserSafePort } from './lib/browser-port-policy.mjs'
import { gateEnvironment, resolveSelectedPython } from './lib/python-runtime.mjs'
import {
  createReadWebProductionBackupComposition,
  initializeIsolatedBrowserProfileIfMissing,
} from './lib/read-web-production-backup.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowRoot = path.join(repoRoot, 'tools', 'subtitle-workflow')
const distDir = path.join(repoRoot, 'dist')
const selectedPython = await resolveSelectedPython({
  repoRoot,
  configPath: process.env.READ_WEB_RUNTIME_CONFIG || 'config/runtime.optimization.json',
})
const python = selectedPython.executable
const token = 'isolated-production-host-test-token'
const releaseId = 'isolated-production-host-test'
const profileId = 'isolated-random-port'
const executionId = randomUUID()
const outputRoot = path.resolve(process.env.READ_WEB_PRODUCTION_HOST_OUTPUT || path.join(repoRoot, 'output', 'production-host'))
const evidencePath = path.resolve(process.env.READ_WEB_PRODUCTION_HOST_EVIDENCE || path.join(outputRoot, 'production-host-lifecycle.json'))
const runEndurance = process.env.READ_WEB_PRODUCTION_HOST_ENDURANCE === '1'
const runBrowserJourneys = process.env.READ_WEB_PRODUCTION_HOST_BROWSER !== '0'

const runtimeConfig = JSON.parse(await readFile(path.join(repoRoot, 'config', 'runtime.next.json'), 'utf8'))
assert.equal(runtimeConfig.frontend.port, 5174, 'next dev fallback must remain on 5174')
assert.equal(runtimeConfig.backend.port, 8766, 'next workflow fallback must remain on 8766')
assert.notEqual(runtimeConfig.frontend.port, 5173)
assert.notEqual(runtimeConfig.backend.port, 8765)

async function randomPort() {
  const server = net.createServer()
  const port = await listenOnBrowserSafePort(server)
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
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

function startHost({ port, instanceId, dataRoot, applicationProfile, leaseMode = 'authoritative', allowStandbyReadiness = false }) {
  const argumentsList = [
    '-m', 'youtube_workflow.production_host_prototype',
    '--dist', distDir,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--release-id', releaseId,
    '--profile-id', profileId,
    '--instance-id', instanceId,
    '--release-manifest', manifestPath,
    '--config-schema-version', String(runtimeConfig.schemaVersion),
    '--application-isolation-root', applicationProfile.isolationRoot,
    '--application-profile-dir', applicationProfile.profileDir,
    '--application-python-state-dir', applicationProfile.pythonStateDir,
    '--application-python-output-dir', applicationProfile.pythonOutputDir,
    '--capability-base-url', capabilityBaseUrl,
  ]
  if (applicationProfile.profileAuthorityRoot) {
    argumentsList.push(
      '--application-profile-authority-root', applicationProfile.profileAuthorityRoot,
      '--application-profile-authority-isolation-root', applicationProfile.profileAuthorityIsolationRoot,
    )
  }
  if (leaseMode !== 'authoritative') {
    argumentsList.push('--application-profile-lease-mode', leaseMode)
  }
  if (allowStandbyReadiness) argumentsList.push('--allow-standby-readiness')
  const child = spawn(python, argumentsList, {
    cwd: workflowRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...gateEnvironment(selectedPython),
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
  runtime: {
    toolchainSha256: 'b'.repeat(64),
    pythonIdentity: {
      status: 'verified',
      executable: python,
      version: '3.10.10',
      packageSetSha256: 'c'.repeat(64),
      environmentSha256: 'd'.repeat(64),
    },
  },
  dataCompatibility: {
    indexedDb: { name: 'SeekPlayerDB', version: 1, objectStore: 'files', keyPath: 'id' },
    workflowServiceVersion: '0.2.3',
  },
  artifacts: [],
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
  const profileAuthorityIsolationRoot = path.join(tempRoot, 'application-authority')
  const profileAuthorityRoot = path.join(profileAuthorityIsolationRoot, 'profiles', profileId)
  await mkdir(profileAuthorityRoot, { recursive: true })
  const overlapPortA = await randomPort()
  const overlapPortB = await randomPort()
  assert.notEqual(overlapPortA, overlapPortB)
  const overlapAuthorityProfile = {
    profileAuthorityIsolationRoot,
    profileAuthorityRoot,
  }
  const overlapProfileA = {
    isolationRoot: path.join(tempRoot, 'overlap-instance-a'),
    profileDir: path.join(tempRoot, 'overlap-instance-a', 'profile'),
    pythonStateDir: path.join(tempRoot, 'overlap-instance-a', 'python-state'),
    pythonOutputDir: path.join(tempRoot, 'overlap-instance-a', 'python-output'),
    ...overlapAuthorityProfile,
  }
  const overlapProfileB = {
    isolationRoot: path.join(tempRoot, 'overlap-instance-b'),
    profileDir: path.join(tempRoot, 'overlap-instance-b', 'profile'),
    pythonStateDir: path.join(tempRoot, 'overlap-instance-b', 'python-state'),
    pythonOutputDir: path.join(tempRoot, 'overlap-instance-b', 'python-output'),
    ...overlapAuthorityProfile,
  }
  await Promise.all([
    ...Object.values(overlapProfileA).map((directory) => mkdir(directory, { recursive: true })),
    ...Object.values(overlapProfileB).map((directory) => mkdir(directory, { recursive: true })),
  ])
  await initializeIsolatedBrowserProfileIfMissing(overlapProfileA)
  await initializeIsolatedBrowserProfileIfMissing(overlapProfileB)
  const overlapInstanceA = `${executionId}:overlap-a`
  const overlapInstanceB = `${executionId}:overlap-b`
  let overlapHostA = null
  let overlapHostB = null
  try {
    overlapHostA = startHost({
      port: overlapPortA,
      instanceId: overlapInstanceA,
      dataRoot: path.join(tempRoot, 'overlap-data-a'),
      applicationProfile: overlapProfileA,
    })
    const overlapHealthA = await waitForHealth(`http://127.0.0.1:${overlapPortA}`, overlapInstanceA)
    assert.equal(overlapHealthA.profileLeaseMode, 'authoritative')
    assert.equal(overlapHealthA.profileLeaseReady, true)
    assert.equal(overlapHealthA.durableOwnerReady, false)

    overlapHostB = startHost({
      port: overlapPortB,
      instanceId: overlapInstanceB,
      dataRoot: path.join(tempRoot, 'overlap-data-b'),
      applicationProfile: overlapProfileB,
      leaseMode: 'standby-if-busy',
      allowStandbyReadiness: true,
    })
    const overlapHealthB = await waitForHealth(`http://127.0.0.1:${overlapPortB}`, overlapInstanceB)
    assert.equal(overlapHealthB.profileLeaseMode, 'standby')
    assert.equal(overlapHealthB.standbyPreflight, true)
    assert.equal(overlapHealthB.profileLeaseReady, false)
    assert.equal(overlapHealthB.profileLease, null)
    assert.equal(overlapHealthB.durableOwnerReady, false)
    assert.equal(overlapHealthB.acceptingApiAuthoritativeOperations, false)
    assert.equal((await (await fetch(`http://127.0.0.1:${overlapPortA}/api/app/health`)).json()).profileLeaseMode, 'authoritative')

    await stopOwned(overlapHostB, 'SIGTERM')
    overlapHostB = null
    await waitForPortClosed(overlapPortB)
    await stopOwned(overlapHostA, 'SIGTERM')
    overlapHostA = null
    await waitForPortClosed(overlapPortA)

    overlapHostB = startHost({
      port: overlapPortB,
      instanceId: overlapInstanceB,
      dataRoot: path.join(tempRoot, 'overlap-data-b'),
      applicationProfile: overlapProfileB,
      leaseMode: 'authoritative',
    })
    const promotedHealthB = await waitForHealth(`http://127.0.0.1:${overlapPortB}`, overlapInstanceB)
    assert.equal(promotedHealthB.profileLeaseMode, 'authoritative')
    assert.equal(promotedHealthB.profileLeaseReady, true)
    assert.equal(promotedHealthB.profileLeaseAlive, true)
    assert.equal(promotedHealthB.durableOwnerReady, false)
    assert.equal(promotedHealthB.acceptingApiAuthoritativeOperations, false)
    assert.equal(promotedHealthB.ownerMode.status, 'pre-cutover')
    const promotedOwnerCommand = await fetch(`http://127.0.0.1:${overlapPortB}/api/app/owner/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-read-web-token': token },
      body: JSON.stringify({
        contractVersion: 'windows-thin-reader-api.v1',
        requestId: 'promoted-owner-request',
        correlationId: 'promoted-owner-correlation',
        kind: 'query',
        domain: 'reader-session',
        operation: 'snapshot',
        capability: 'reader-session.query',
        payload: { profileId, instanceId: overlapInstanceB },
      }),
    })
    assert.equal(promotedOwnerCommand.status, 503)
    assert.equal((await promotedOwnerCommand.json()).commitStatus, 'not-ready')
  } finally {
    if (overlapHostB) await stopOwned(overlapHostB, 'SIGTERM').catch(() => {})
    if (overlapHostA) await stopOwned(overlapHostA, 'SIGTERM').catch(() => {})
    await waitForPortClosed(overlapPortA)
    await waitForPortClosed(overlapPortB)
  }
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const instanceId = `${executionId}:production-cycle-${cycle}`
    const applicationProfile = {
      isolationRoot: path.join(tempRoot, `application-${cycle}`),
      profileDir: path.join(tempRoot, `application-${cycle}`, 'profile'),
      pythonStateDir: path.join(tempRoot, `application-${cycle}`, 'python-state'),
      pythonOutputDir: path.join(tempRoot, `application-${cycle}`, 'python-output'),
      profileAuthorityIsolationRoot,
      profileAuthorityRoot,
    }
    await Promise.all(Object.values(applicationProfile).map((directory) => mkdir(directory, { recursive: true })))
    await initializeIsolatedBrowserProfileIfMissing(applicationProfile)
    host = startHost({ port, instanceId, dataRoot: path.join(tempRoot, `data-${cycle}`), applicationProfile })
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
    assert.equal(health.profileLeaseReady, true)
    assert.equal(health.profileLeaseAlive, true)
    assert.equal(health.profileLeaseMode, 'authoritative')
    assert.equal(health.ownerMode?.status, 'pre-cutover')
    assert.deepEqual(health.ownerMode?.authoritativeDomains, [])
    assert.equal(health.durableOwnerReady, false)
    assert.equal(health.acceptingApiAuthoritativeOperations, false)

    const ownerCommand = await fetch(`${baseUrl}/api/app/owner/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-read-web-token': token },
      body: JSON.stringify({
        contractVersion: 'windows-thin-reader-api.v1',
        requestId: `owner-request-${cycle}`,
        correlationId: `owner-correlation-${cycle}`,
        kind: 'query',
        domain: 'reader-session',
        operation: 'snapshot',
        capability: 'reader-session.query',
        payload: { profileId, instanceId },
      }),
    })
    assert.equal(ownerCommand.status, 503)
    const ownerPayload = await ownerCommand.json()
    assert.equal(ownerPayload.contractVersion, 'windows-thin-reader-api.v1')
    assert.equal(ownerPayload.outcome, 'not-ready')
    assert.equal(ownerPayload.commitStatus, 'not-ready')
    assert.deepEqual(ownerPayload.payload, {})
    assert.equal(ownerPayload.error?.details?.reason, 'pre-cutover')

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

    const previousLockTimeout = process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
    process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = '500'
    try {
      await assert.rejects(
        createReadWebProductionBackupComposition(applicationProfile),
        (error) => error?.code === 'BACKUP_PATH_LOCK_TIMEOUT',
        'a running production host must hold the application profile lock against restore',
      )
    } finally {
      if (previousLockTimeout === undefined) delete process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS
      else process.env.READ_WEB_BACKUP_LOCK_TIMEOUT_MS = previousLockTimeout
    }

    if (cycle === 1 && runBrowserJourneys) {
      await runNode('scripts/perf/browser-journeys.mjs', {
        READ_WEB_PERF_BASE_URL: baseUrl,
        READ_WEB_PERF_OUTPUT: path.join(outputRoot, 'browser-journeys'),
        READ_WEB_PERF_REAL_HOST_APIS: '/api/health,/api/app/capabilities,/api/vocabulary/local-sentences,/api/tts/edge,/api/vocabulary/sentence-translations',
      })
      const browserArtifact = JSON.parse(await readFile(path.join(outputRoot, 'browser-journeys', 'browser-journeys.json'), 'utf8'))
      assert.equal(browserArtifact.isolation.mode, 'browser-route-fixtures-with-real-host-api')
      assert.ok(browserArtifact.isolation.realHostApiPaths.includes('/api/vocabulary/local-sentences'))
      assert.ok(browserArtifact.isolation.realHostApiPaths.includes('/api/tts/edge'))
      assert.ok(
        browserArtifact.isolation.realHostApiPaths.some((pathname) => pathname.startsWith('/api/tts/edge/audio/')),
        'the pronunciation audio child request must reach the temporary production host',
      )
      assert.ok(
        (browserArtifact.ttsRequests || []).some((request) => (
          request.kind === 'edge-audio-get'
          && request.journeyAtStart === 'srs-review'
          && request.isolationRoute === 'real-host'
          && request.response?.status < 400
          && request.response?.contentType?.toLowerCase().startsWith('audio/')
          && request.audio?.valid === true
        )),
        'the current SRS card must receive a valid non-mock audio response',
      )
      assert.equal(browserArtifact.errors.length, 0)
      browserArtifact.provenance = {
        hostKind: 'local-app-host',
        distMode: 'built-dist',
        baseUrl,
        releaseId: health.releaseId,
        profileId: health.profileId,
        instanceId: health.instanceId,
        manifestSha256: health.manifest.sha256,
        manifestGitSha: health.manifest.gitSha,
        configSchemaVersion: health.configCompatibility.schemaVersion,
      }
      await writeFile(
        path.join(outputRoot, 'browser-journeys', 'browser-journeys.json'),
        `${JSON.stringify(browserArtifact, null, 2)}\n`,
        'utf8',
      )
      if (runEndurance && runBrowserJourneys) {
        await runNode('scripts/release-playback-endurance.mjs', {
          READ_WEB_STABILITY_BASE_URL: baseUrl,
          READ_WEB_STABILITY_OUTPUT: process.env.READ_WEB_STABILITY_OUTPUT || path.join(outputRoot, 'release-playback-endurance.json'),
        })
      }
    }

    const pid = host.child.pid
    if (cycle === 2) await stopOwned(host, 'SIGKILL')
    else await stopOwned(host, 'SIGTERM')
    await waitForPortClosed(port)
    assert.equal(
      (await createReadWebProductionBackupComposition(applicationProfile)).startupRecovery,
      null,
      'the application profile lock must be released after the owned host exits',
    )
    cycles.push({ cycle, pid, stop: cycle === 2 ? 'crash' : 'graceful', portReleased: true })
    host = null
  }
  const evidence = {
    schema: 'read-web.production-host-lifecycle-evidence',
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'passed',
    isolation: {
      tempRoot,
      profileId,
      reservedPortsUntouched: true,
      sourceDataReadOnly: true,
    },
    port,
    cycles,
    coldStarts: cycles.length,
    serviceRestart: {
      gracefulStops: cycles.filter((item) => item.stop === 'graceful').length,
      crashStops: cycles.filter((item) => item.stop === 'crash').length,
      everyPortReleased: cycles.every((item) => item.portReleased),
    },
    browserJourneys: {
      status: runBrowserJourneys ? 'passed' : 'skipped',
      reason: runBrowserJourneys ? null : 'non-browser production-host lifecycle evidence requested',
    },
    overlappingHosts: {
      sameProfileDifferentInstanceRoots: true,
      firstHostAuthoritative: true,
      replacementStandby: true,
      replacementPromotedAuthoritative: true,
      promotionLeaseReadyBeforeCommit: true,
      promotionRemainsPreCutover: true,
      promotionOwnerCommandNotReady: true,
      noDualAuthority: true,
      portsReleased: true,
    },
    enduranceEvidence: runEndurance && runBrowserJourneys ? path.resolve(process.env.READ_WEB_STABILITY_OUTPUT || path.join(outputRoot, 'release-playback-endurance.json')) : null,
    viteProcessStarted: false,
    devFallback: { frontend: 5174, backend: 8766 },
  }
  await mkdir(path.dirname(evidencePath), { recursive: true })
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  if (host) await stopOwned(host, 'SIGKILL').catch(() => {})
  if (capability) await stopOwned(capability, 'SIGTERM')
  await waitForPortClosed(capabilityPort)
  await rm(tempRoot, { recursive: true, force: true })
}
