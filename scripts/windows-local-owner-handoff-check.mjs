import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { listenOnBrowserSafePort } from './lib/browser-port-policy.mjs'
import { gateEnvironment, resolveSelectedPython } from './lib/python-runtime.mjs'
import {
  initializeIsolatedBrowserProfileIfMissing,
} from './lib/read-web-production-backup.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowRoot = path.join(repositoryRoot, 'tools', 'subtitle-workflow')
const distRoot = path.join(repositoryRoot, 'dist')
const runtimeConfig = JSON.parse(await readFile(
  path.join(repositoryRoot, 'config', 'runtime.optimization.json'),
  'utf8',
))
const selectedPython = await resolveSelectedPython({
  repoRoot: repositoryRoot,
  configPath: 'config/runtime.optimization.json',
})
const python = selectedPython.executable
const releaseId = 'windows-owner-handoff-focused'
const profileId = 'handoff-focused-profile'
const token = 'windows-owner-handoff-focused-token'
const executionId = randomUUID()

assert.equal(runtimeConfig.frontend.host, '127.0.0.1')
assert.equal(runtimeConfig.frontend.port, 5184)
assert.equal(runtimeConfig.backend.host, '127.0.0.1')
assert.equal(runtimeConfig.backend.port, 8776)
const distIndexStat = await stat(path.join(distRoot, 'index.html'))
assert.ok(distIndexStat.isFile(), 'handoff check requires a built dist')

async function randomPort() {
  const server = net.createServer()
  const port = await listenOnBrowserSafePort(server)
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  assert.ok(![5173, 5174, 8765, 8766, 5184, 8776].includes(port))
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
  throw new Error(`production Host did not become ready at ${baseUrl}`)
}

async function waitForDegraded(baseUrl, instanceId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/app/health`)
      if (response.ok) {
        const health = await response.json()
        if (health.status === 'degraded' && health.instanceId === instanceId) return health
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`production Host did not expose degraded fail-closed health at ${baseUrl}`)
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
  throw new Error(`production Host port ${port} remained open`)
}

async function waitForFile(filePath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await stat(filePath)
      return
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${filePath}`)
}

async function waitForMissing(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await stat(filePath)
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`file remained present: ${filePath}`)
}

function waitForExit(child, timeoutMs = 8_000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`process ${child.pid} did not exit`)), timeoutMs)
    child.once('exit', (code) => { clearTimeout(timer); resolve(code) })
  })
}

function runRealLauncherRecoveryGate(timeoutMs = 10 * 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', path.join(repositoryRoot, 'scripts', 'optimization-launcher-check.ps1'),
      '-PowerShellKind', 'powershell',
    ], {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`real optimization launcher recovery gate timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, signal, output })
    })
  })
}

function isKnownPythonDistributionBlock(result) {
  const normalized = result.output.toLowerCase()
  return result.code !== 0
    && normalized.includes('duplicate_installed_distribution')
    && normalized.includes('networkx')
    && normalized.includes('torchaudio')
}

async function stopOwned(host, signal = 'SIGTERM') {
  if (!host || host.child.exitCode !== null) return
  host.child.kill(signal)
  try {
    await waitForExit(host.child)
  } catch (error) {
    host.child.kill('SIGKILL')
    await waitForExit(host.child)
    if (signal !== 'SIGKILL') throw error
  }
}

function fixturePaths(root, name) {
  const isolationRoot = path.join(root, name)
  return {
    isolationRoot,
    profileDir: path.join(isolationRoot, 'profile'),
    pythonStateDir: path.join(isolationRoot, 'python-state'),
    pythonOutputDir: path.join(isolationRoot, 'python-output'),
  }
}

async function makeProfile(root, name, authority) {
  const paths = {
    ...fixturePaths(root, name),
    profileAuthorityIsolationRoot: authority.isolationRoot,
    profileAuthorityRoot: authority.profileRoot,
  }
  await Promise.all([
    paths.isolationRoot,
    paths.profileDir,
    paths.pythonStateDir,
    paths.pythonOutputDir,
  ].map((directory) => mkdir(directory, { recursive: true })))
  await initializeIsolatedBrowserProfileIfMissing(paths)
  return paths
}

function startCapabilityHost(port) {
  const child = spawn(process.execPath, [
    path.join(repositoryRoot, 'tools', 'local-capability-host.mjs'),
    '--port', String(port),
  ], {
    cwd: repositoryRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      READ_WEB_CAPABILITY_HOST: '127.0.0.1',
      READ_WEB_CAPABILITY_PORT: String(port),
      READ_WEB_SERVICE_TOKEN: token,
    },
  })
  return child
}

async function waitForCapability(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/app/health`)
      if (response.ok) return response.json()
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('focused handoff capability Host did not become ready')
}

function startHost({ port, instanceId, dataRoot, profile, leaseMode = 'authoritative', allowStandbyReadiness = false, manifestPath, capabilityPort }) {
  const args = [
    '-m', 'youtube_workflow.production_host_prototype',
    '--dist', distRoot,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--release-id', releaseId,
    '--profile-id', profileId,
    '--instance-id', instanceId,
    '--release-manifest', manifestPath,
    '--config-schema-version', String(runtimeConfig.schemaVersion),
    '--capability-base-url', `http://127.0.0.1:${capabilityPort}`,
    '--application-isolation-root', profile.isolationRoot,
    '--application-profile-dir', profile.profileDir,
    '--application-profile-authority-root', profile.profileAuthorityRoot,
    '--application-profile-authority-isolation-root', profile.profileAuthorityIsolationRoot,
    '--application-python-state-dir', profile.pythonStateDir,
    '--application-python-output-dir', profile.pythonOutputDir,
  ]
  if (leaseMode !== 'authoritative') args.push('--application-profile-lease-mode', leaseMode)
  if (allowStandbyReadiness) args.push('--allow-standby-readiness')
  const child = spawn(python, args, {
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
      READ_WEB_NODE: process.execPath,
    },
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  return { child, output: () => output }
}

function lockPath(authorityRoot) {
  return `${path.resolve(authorityRoot).toLowerCase()}.read-web-path.lock`
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-windows-owner-handoff-'))
const capabilityPort = await randomPort()
const portA = await randomPort()
const portB = await randomPort()
const authority = {
  isolationRoot: path.join(tempRoot, 'stable-profile-authority'),
  profileRoot: path.join(tempRoot, 'stable-profile-authority', 'profiles', profileId),
}
await mkdir(authority.profileRoot, { recursive: true })
const profileA = await makeProfile(tempRoot, 'instance-a', authority)
const profileB = await makeProfile(tempRoot, 'instance-b', authority)
const dataRootA = path.join(tempRoot, 'data-a')
const dataRootB = path.join(tempRoot, 'data-b')
await mkdir(dataRootA, { recursive: true })
await mkdir(dataRootB, { recursive: true })
const manifestPath = path.join(tempRoot, 'release-manifest.json')
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  release: {
    application: 'read-final',
    frontendVersion: '1.0.0',
    backendVersion: '0.2.3',
    gitSha: releaseId,
    gitBranch: 'isolated',
    dirty: false,
  },
  runtime: {
    toolchainSha256: 'b'.repeat(64),
    pythonIdentity: {
      status: 'verified',
      executable: python,
      version: 'focused-test-runtime',
      packageSetSha256: 'c'.repeat(64),
      environmentSha256: 'd'.repeat(64),
    },
  },
  dataCompatibility: {
    indexedDb: { name: 'SeekPlayerDB', version: 1, objectStore: 'files', keyPath: 'id' },
    workflowServiceVersion: '0.2.3',
  },
  artifacts: [],
}
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(manifestPath, manifestBytes)
const stableLockPath = lockPath(authority.profileRoot)
const activeTargetPath = path.join(tempRoot, 'front-door-committed-target.json')
const instanceA = `${executionId}:a`
const instanceB = `${executionId}:b`
let hostA = null
let hostB = null
let capability = null
try {
  capability = startCapabilityHost(capabilityPort)
  const capabilityHealth = await waitForCapability(capabilityPort)
  assert.equal(capabilityHealth.status, 'ready')

  hostA = startHost({
    port: portA,
    instanceId: instanceA,
    dataRoot: dataRootA,
    profile: profileA,
    manifestPath,
    capabilityPort,
  })
  const healthA = await waitForHealth(`http://127.0.0.1:${portA}`, instanceA)
  assert.equal(healthA.profileLeaseMode, 'authoritative')
  assert.equal(healthA.profileLeaseReady, true)
  assert.equal(healthA.profileLeaseAlive, true)
  assert.equal(healthA.durableOwnerReady, false)
  assert.equal(healthA.acceptingApiAuthoritativeOperations, false)
  assert.equal(healthA.ownerMode.status, 'pre-cutover')
  await waitForFile(stableLockPath)

  hostB = startHost({
    port: portB,
    instanceId: instanceB,
    dataRoot: dataRootB,
    profile: profileB,
    leaseMode: 'standby-if-busy',
    allowStandbyReadiness: true,
    manifestPath,
    capabilityPort,
  })
  const healthBStandby = await waitForHealth(`http://127.0.0.1:${portB}`, instanceB)
  assert.equal(healthBStandby.profileLeaseMode, 'standby')
  assert.equal(healthBStandby.standbyPreflight, true)
  assert.equal(healthBStandby.profileLeaseReady, false)
  assert.equal(healthBStandby.profileLeaseAlive, true)
  assert.equal(healthBStandby.profileLease, null)
  assert.equal(healthBStandby.durableOwnerReady, false)
  assert.equal(healthBStandby.acceptingApiAuthoritativeOperations, false)
  assert.ok(await stat(stableLockPath), 'standby must not replace the first stable lease')

  await stopOwned(hostB)
  hostB = null
  await waitForPortClosed(portB)
  assert.ok(await stat(stableLockPath), 'candidate stop must not release the old stable lease')
  await stopOwned(hostA)
  hostA = null
  await waitForPortClosed(portA)
  await waitForMissing(stableLockPath)

  hostB = startHost({
    port: portB,
    instanceId: instanceB,
    dataRoot: dataRootB,
    profile: profileB,
    manifestPath,
    capabilityPort,
  })
  const promotedHealthB = await waitForHealth(`http://127.0.0.1:${portB}`, instanceB)
  assert.equal(promotedHealthB.profileLeaseMode, 'authoritative')
  assert.equal(promotedHealthB.profileLeaseReady, true)
  assert.equal(promotedHealthB.profileLeaseAlive, true)
  assert.equal(promotedHealthB.durableOwnerReady, false)
  assert.equal(promotedHealthB.acceptingApiAuthoritativeOperations, false)
  assert.equal(promotedHealthB.ownerMode.status, 'pre-cutover')
  await waitForFile(stableLockPath)

  await writeFile(activeTargetPath, `${JSON.stringify({ profileId, instanceId: instanceB, port: portB })}\n`)
  const committedBeforeFailure = await readFile(activeTargetPath, 'utf8')
  await stopOwned(hostB)
  hostB = null
  await waitForPortClosed(portB)
  await waitForMissing(stableLockPath)

  hostA = startHost({
    port: portA,
    instanceId: instanceA,
    dataRoot: dataRootA,
    profile: profileA,
    manifestPath,
    capabilityPort,
  })
  const restoredHealthA = await waitForHealth(`http://127.0.0.1:${portA}`, instanceA)
  assert.equal(restoredHealthA.profileLeaseMode, 'authoritative')
  await writeFile(activeTargetPath, `${JSON.stringify({ profileId, instanceId: instanceA, port: portA })}\n`)
  const activeBeforeFailedPromotion = await readFile(activeTargetPath, 'utf8')

  hostB = startHost({
    port: portB,
    instanceId: instanceB,
    dataRoot: dataRootB,
    profile: profileB,
    leaseMode: 'standby-if-busy',
    allowStandbyReadiness: true,
    manifestPath,
    capabilityPort,
  })
  const failedCandidateStandby = await waitForHealth(`http://127.0.0.1:${portB}`, instanceB)
  assert.equal(failedCandidateStandby.profileLeaseMode, 'standby')
  await stopOwned(hostB)
  hostB = null
  await waitForPortClosed(portB)
  await stopOwned(hostA)
  hostA = null
  await waitForPortClosed(portA)
  await waitForMissing(stableLockPath)

  const profileBeforeFailedPromotion = await readFile(path.join(profileB.profileDir, 'browser-profile.json'), 'utf8')
  await writeFile(path.join(profileB.profileDir, 'browser-profile.json'), `${JSON.stringify({ schemaVersion: 99, localStorage: {}, indexedDbRows: [] })}\n`)
  const failedPromotion = startHost({
    port: portB,
    instanceId: instanceB,
    dataRoot: dataRootB,
    profile: profileB,
    manifestPath,
    capabilityPort,
  })
  const failedPromotionHealth = await waitForDegraded(`http://127.0.0.1:${portB}`, instanceB)
  assert.equal(failedPromotionHealth.profileEvidenceReady, false)
  assert.equal(failedPromotionHealth.profileLeaseReady, false)
  assert.equal(failedPromotionHealth.durableOwnerReady, false)
  assert.equal(failedPromotionHealth.acceptingApiAuthoritativeOperations, false)
  await stopOwned(failedPromotion)
  await waitForPortClosed(portB)
  await waitForMissing(stableLockPath)
  assert.equal(
    await readFile(path.join(profileB.profileDir, 'browser-profile.json'), 'utf8'),
    `${JSON.stringify({ schemaVersion: 99, localStorage: {}, indexedDbRows: [] })}\n`,
    'failed promotion must not reinitialize an existing candidate profile',
  )
  const failedProfileAfter = await readFile(path.join(profileB.profileDir, 'browser-profile.json'), 'utf8')
  assert.notEqual(profileBeforeFailedPromotion, failedProfileAfter)
  assert.equal(await readFile(activeTargetPath, 'utf8'), activeBeforeFailedPromotion, 'failed promotion must not commit a new active pointer')

  hostA = startHost({
    port: portA,
    instanceId: instanceA,
    dataRoot: dataRootA,
    profile: profileA,
    manifestPath,
    capabilityPort,
  })
  const rollbackHealthA = await waitForHealth(`http://127.0.0.1:${portA}`, instanceA)
  assert.equal(rollbackHealthA.profileLeaseMode, 'authoritative')
  assert.equal(await readFile(activeTargetPath, 'utf8'), activeBeforeFailedPromotion)

  await stopOwned(hostA)
  hostA = null
  await waitForPortClosed(portA)
  await waitForMissing(stableLockPath)
  assert.notEqual(committedBeforeFailure, activeBeforeFailedPromotion)

  // The isolated Host lease exercise above proves the stable-profile
  // contender behavior.  The launcher/journal/snapshot rollback contract is
  // exercised by the real optimization launcher gate below, after the
  // temporary capability process has released its port.  Keep a known local
  // Python distribution-health blocker explicit instead of treating the
  // Host-only exercise as launcher rollback evidence.
  await stopOwned({ child: capability })
  capability = null
  await waitForPortClosed(capabilityPort)
  const launcherResult = await runRealLauncherRecoveryGate()
  const launcherOutput = launcherResult.output.trim()
  const launcherOutputChecksum = `sha256:${createHash('sha256').update(launcherOutput).digest('hex')}`
  let launcherRecovery
  if (launcherResult.code === 0) {
    launcherRecovery = {
      status: 'passed',
      command: 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/optimization-launcher-check.ps1 -PowerShellKind powershell',
      exitCode: launcherResult.code,
      outputChecksum: launcherOutputChecksum,
      evidence: 'real launcher crash phases, activation journal recovery, snapshot/pointer restoration, and cleanup',
    }
  } else if (isKnownPythonDistributionBlock(launcherResult)) {
    launcherRecovery = {
      status: 'blocked',
      command: 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/optimization-launcher-check.ps1 -PowerShellKind powershell',
      exitCode: launcherResult.code,
      outputChecksum: launcherOutputChecksum,
      reason: 'DUPLICATE_INSTALLED_DISTRIBUTION(networkx,torchaudio) before BuildAction; no launcher lifecycle result claimed',
      outputTail: launcherOutput.slice(-2_000),
    }
  } else {
    throw new Error(`real optimization launcher recovery gate failed with exit ${launcherResult.code}: ${launcherOutput.slice(-4_000)}`)
  }

  const launcherBlocked = launcherRecovery.status === 'blocked'
  console.log(JSON.stringify({
    schema: 'read-web.windows-local-owner-handoff-check',
    schemaVersion: 1,
    status: launcherBlocked ? 'blocked' : 'passed',
    exitCode: launcherBlocked ? 1 : 0,
    isolation: {
      tempRoot,
      sourceDataRead: false,
      protectedTreesRead: false,
      dailyDataRootRead: false,
      dailyPortsUsed: false,
    },
    handoff: {
      sameProfileId: true,
      differentInstanceRoots: true,
      firstHostAuthoritative: true,
      replacementStandbyPreflight: true,
      standbyNotCommitted: true,
      oldLeaseReleasedBeforePromotion: true,
      replacementPromotedAuthoritative: true,
      noDualStableLease: true,
      failedPromotionNoPointerCommit: true,
      oldHostRestoredAfterFailedPromotion: true,
      invalidCandidateNotReinitialized: true,
      portsReleased: true,
    },
    launcherRecovery,
  }, null, 2))
  if (launcherBlocked) process.exitCode = 1
} finally {
  if (hostB) await stopOwned(hostB, 'SIGKILL').catch(() => {})
  if (hostA) await stopOwned(hostA, 'SIGKILL').catch(() => {})
  if (capability) await stopOwned({ child: capability }, 'SIGTERM').catch(() => {})
  await waitForPortClosed(portA).catch(() => {})
  await waitForPortClosed(portB).catch(() => {})
  await waitForPortClosed(capabilityPort).catch(() => {})
  await rm(tempRoot, { recursive: true, force: true })
}
