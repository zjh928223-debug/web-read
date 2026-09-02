#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_DOMAINS as APPLICATION_DOMAINS,
  WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_HOST_DOMAINS as HOST_DOMAINS,
  assertSourceFrozen,
  createAuthoritativePromotionAdapters,
  createAuthoritativePromotionCoordinator,
  createOwnerPromotionClient,
  createProductionPromotionClients,
  createPromotionStateFileStore,
} from './lib/windows-owner-authoritative-promotion.mjs'

const execFileAsync = promisify(execFile)
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATE_ROOT = path.join(PROJECT_ROOT, '.codex', 'runtime-state', 'windows-owner-authoritative-promotion')
const ACTIVE_POINTER_PATH = path.join(STATE_ROOT, 'active.json')
const SOURCE_DATA_ROOT = 'E:\\ReadWebData\\SubtitleWorkflow-Optimization'
const TARGET_DATA_ROOT = 'E:\\ReadWebData\\SubtitleWorkflow-Next'
const SOURCE_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'runtime.optimization.json')
const TARGET_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'runtime.daily-production.json')
const SOURCE_PROFILE_ID = 'optimization'
const TARGET_PROFILE_ID = 'daily-production'
const SOURCE_HOST_PORT = 5200
const SOURCE_FRONT_DOOR_PORT = 5184
const SOURCE_CAPABILITY_PORT = 8776
const TARGET_HOST_PORT = 5174
const TARGET_CAPABILITY_PORT = 8766
const MAX_STARTUP_TIMEOUT_SECONDS = 300
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAFE_CHECKSUM = /^sha256:[a-f0-9]{64}$/u
const COMMANDS = Object.freeze(['Plan', 'Inventory', 'DryRun', 'Apply', 'Resume', 'Rollback'])

function promotionError(code, message = 'Windows owner promotion could not be completed', details = null) {
  const error = new Error(message)
  error.name = 'WindowsOwnerAuthoritativePromotionError'
  error.code = code
  if (details && typeof details === 'object' && !Array.isArray(details)) error.details = clone(details)
  return error
}

function safeId(value, field = 'identity') {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw promotionError('OWNER_PROMOTION_INVALID_IDENTITY', `${field} is invalid`)
  }
  return value
}

function clone(value) {
  return value === undefined
    ? undefined
    : (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)))
}

function samePath(left, right) {
  try {
    return path.resolve(String(left)).toLowerCase() === path.resolve(String(right)).toLowerCase()
  } catch {
    return false
  }
}

function containedPath(root, candidate) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  const relative = path.relative(resolvedRoot, resolvedCandidate)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw promotionError('OWNER_PROMOTION_PATH_INVALID', 'promotion state path is outside the fixed state root')
  }
  return resolvedCandidate
}

async function readJson(filePath, { optional = false } = {}) {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw.replace(/^\uFEFF/u, ''))
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return null
    throw promotionError('OWNER_PROMOTION_STATE_UNAVAILABLE', 'promotion runtime state is unavailable')
  }
}

function writeSafeJson(filePath, value) {
  return import('./lib/read-web-production-backup.mjs').then(({ writeJsonAtomic }) => (
    writeJsonAtomic(filePath, clone(value), { containmentRoot: STATE_ROOT })
  ))
}

function parseOptions(argv) {
  const options = {
    sourceBaseUrl: 'http://127.0.0.1:5200',
    targetBaseUrl: 'http://127.0.0.1:5174',
    sourceProfileId: SOURCE_PROFILE_ID,
    targetProfileId: TARGET_PROFILE_ID,
    sourceDataRoot: SOURCE_DATA_ROOT,
    targetDataRoot: TARGET_DATA_ROOT,
    sourceConfigPath: SOURCE_CONFIG_PATH,
    targetConfigPath: TARGET_CONFIG_PATH,
    sourceHostPort: SOURCE_HOST_PORT,
    sourceFrontDoorPort: SOURCE_FRONT_DOOR_PORT,
    sourceCapabilityPort: SOURCE_CAPABILITY_PORT,
    targetHostPort: TARGET_HOST_PORT,
    targetCapabilityPort: TARGET_CAPABILITY_PORT,
    startupTimeoutSeconds: 60,
    runId: null,
    confirm: false,
  }
  const values = new Map([
    ['--source-base-url', 'sourceBaseUrl'],
    ['--target-base-url', 'targetBaseUrl'],
    ['--source-profile-id', 'sourceProfileId'],
    ['--target-profile-id', 'targetProfileId'],
    ['--source-data-root', 'sourceDataRoot'],
    ['--target-data-root', 'targetDataRoot'],
    ['--source-config-path', 'sourceConfigPath'],
    ['--target-config-path', 'targetConfigPath'],
    ['--source-host-port', 'sourceHostPort'],
    ['--source-front-door-port', 'sourceFrontDoorPort'],
    ['--source-capability-port', 'sourceCapabilityPort'],
    ['--target-host-port', 'targetHostPort'],
    ['--target-capability-port', 'targetCapabilityPort'],
    ['--startup-timeout-seconds', 'startupTimeoutSeconds'],
    ['--run-id', 'runId'],
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--confirm-owner-promotion') {
      options.confirm = true
      continue
    }
    const key = values.get(argument)
    if (!key || index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw promotionError('OWNER_PROMOTION_ARGUMENT_INVALID', 'promotion command arguments are invalid')
    }
    options[key] = argv[++index]
  }
  if (options.runId !== null) safeId(options.runId, 'run id')
  const numericFields = [
    ['sourceHostPort', SOURCE_HOST_PORT],
    ['sourceFrontDoorPort', SOURCE_FRONT_DOOR_PORT],
    ['sourceCapabilityPort', SOURCE_CAPABILITY_PORT],
    ['targetHostPort', TARGET_HOST_PORT],
    ['targetCapabilityPort', TARGET_CAPABILITY_PORT],
  ]
  for (const [field, expected] of numericFields) {
    const value = Number(options[field])
    if (!Number.isInteger(value) || value !== expected) {
      throw promotionError('OWNER_PROMOTION_FIXED_ENDPOINT_REQUIRED', `${field} must use the fixed production endpoint`)
    }
    options[field] = value
  }
  const startupTimeout = Number(options.startupTimeoutSeconds)
  if (!Number.isInteger(startupTimeout) || startupTimeout < 10 || startupTimeout > MAX_STARTUP_TIMEOUT_SECONDS) {
    throw promotionError('OWNER_PROMOTION_TIMEOUT_INVALID', 'startup timeout is invalid')
  }
  options.startupTimeoutSeconds = startupTimeout
  return options
}

function validateFixedOptions(options) {
  const fixedPaths = [
    ['source data root', options.sourceDataRoot, SOURCE_DATA_ROOT],
    ['target data root', options.targetDataRoot, TARGET_DATA_ROOT],
    ['source config path', options.sourceConfigPath, SOURCE_CONFIG_PATH],
    ['target config path', options.targetConfigPath, TARGET_CONFIG_PATH],
  ]
  for (const [field, actual, expected] of fixedPaths) {
    if (!samePath(actual, expected)) throw promotionError('OWNER_PROMOTION_FIXED_PATH_REQUIRED', `${field} must use the fixed production path`)
  }
  const fixedIds = [
    ['source profile id', options.sourceProfileId, SOURCE_PROFILE_ID],
    ['target profile id', options.targetProfileId, TARGET_PROFILE_ID],
  ]
  for (const [field, actual, expected] of fixedIds) {
    if (actual !== expected) throw promotionError('OWNER_PROMOTION_FIXED_PROFILE_REQUIRED', `${field} must use the fixed production profile`)
  }
  const expectedUrls = [
    ['source Host URL', options.sourceBaseUrl, `http://127.0.0.1:${SOURCE_HOST_PORT}`],
    ['target Host URL', options.targetBaseUrl, `http://127.0.0.1:${TARGET_HOST_PORT}`],
  ]
  for (const [field, actual, expected] of expectedUrls) {
    let parsed
    try { parsed = new URL(actual) } catch { parsed = null }
    if (!parsed || parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
      || parsed.port !== String(new URL(expected).port) || !['', '/'].includes(parsed.pathname)
      || parsed.search || parsed.hash) {
      throw promotionError('OWNER_PROMOTION_FIXED_ENDPOINT_REQUIRED', `${field} must use the fixed loopback endpoint`)
    }
  }
}

function profileContract(options, kind) {
  const source = kind === 'source'
  const profileId = source ? options.sourceProfileId : options.targetProfileId
  const dataRoot = source ? options.sourceDataRoot : options.targetDataRoot
  const stateRoot = path.join(PROJECT_ROOT, '.codex', 'runtime-state', source ? 'optimization' : 'daily-production')
  return Object.freeze({
    kind,
    profileId,
    dataRoot,
    stateRoot,
    hostBaseUrl: source ? options.sourceBaseUrl : options.targetBaseUrl,
    hostPort: source ? options.sourceHostPort : options.targetHostPort,
    capabilityPort: source ? options.sourceCapabilityPort : options.targetCapabilityPort,
    hostStatePath: path.join(stateRoot, 'production-host.json'),
    capabilityStatePath: path.join(stateRoot, 'capability-host.json'),
    frontDoorStatePath: source ? path.join(stateRoot, 'front-door.json') : null,
    tokenPath: path.join(stateRoot, 'production-host.token'),
    launcherPath: path.join(PROJECT_ROOT, source ? 'scripts' : 'scripts', source
      ? 'launch-optimization-preview.ps1'
      : 'launch-daily-production.ps1'),
  })
}

function requiredStateIdentity(value, profile, port) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw promotionError('OWNER_PROMOTION_STATE_UNAVAILABLE')
  if (value.status && value.status !== 'active' && value.status !== 'stopped') throw promotionError('OWNER_PROMOTION_STATE_INVALID')
  if (value.profileId !== profile.profileId || Number(value.port) !== port || !safeId(String(value.instanceId || ''), 'instance id')) {
    throw promotionError('OWNER_PROMOTION_STATE_IDENTITY_MISMATCH')
  }
  if (!Number.isInteger(Number(value.pid)) || Number(value.pid) <= 0) throw promotionError('OWNER_PROMOTION_STATE_INVALID')
  return value
}

async function readProfileReceipts(profile) {
  const hostOuter = await readJson(profile.hostStatePath)
  if (hostOuter?.profileId !== profile.profileId || Number(hostOuter?.port) !== profile.hostPort) {
    throw promotionError('OWNER_PROMOTION_STATE_IDENTITY_MISMATCH')
  }
  let host = hostOuter
  if (typeof hostOuter.managerStatePath === 'string' && hostOuter.managerStatePath) {
    const managerPath = containedPath(profile.stateRoot, hostOuter.managerStatePath)
    host = await readJson(managerPath)
  }
  requiredStateIdentity(host, profile, profile.hostPort)
  const capability = requiredStateIdentity(await readJson(profile.capabilityStatePath), profile, profile.capabilityPort)
  let frontDoor = null
  if (profile.frontDoorStatePath) {
    frontDoor = requiredStateIdentity(await readJson(profile.frontDoorStatePath), profile, 5184)
  }
  return { hostOuter, host, capability, frontDoor }
}

async function readToken(profile) {
  try {
    const token = (await readFile(profile.tokenPath, 'utf8')).trim()
    if (!token || /[\u0000-\u001f\u007f]/u.test(token)) throw new Error('invalid')
    return token
  } catch {
    throw promotionError('OWNER_PROMOTION_TOKEN_UNAVAILABLE')
  }
}

function promotionArgsEnabled(state) {
  const args = Array.isArray(state?.argumentList) ? state.argumentList.map((value) => String(value)) : []
  const has = (flag, value) => {
    const index = args.indexOf(flag)
    return index >= 0 && args[index + 1] === value
  }
  const hasDomains = (flag) => HOST_DOMAINS.every((domain) => args.some((value, index) => value === flag && args[index + 1] === domain))
  return has('--owner-migration-mode', 'optimization')
    && has('--owner-promotion-mode', 'optimization')
    && hasDomains('--owner-migration-domain')
    && hasDomains('--owner-promotion-domain')
}

async function readListeners(ports) {
  const normalizedPorts = ports.map((port) => Number(port))
  try {
    const { stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    const result = String(stdout || '').split(/\r?\n/u).flatMap((line) => {
      const match = /^\s*TCP\s+(.+):(\d+)\s+.+:\d+\s+LISTENING\s+(\d+)\s*$/iu.exec(line)
      if (!match) return []
      const port = Number(match[2])
      const pid = Number(match[3])
      if (!normalizedPorts.includes(port) || !Number.isInteger(pid) || pid < 1) return []
      return [{ port, pid, address: match[1].trim() }]
    })
    return result
  } catch {
    throw promotionError('OWNER_PROMOTION_PORT_INSPECTION_FAILED')
  }
}

async function inspectPortOwnership(profile, receipts = null) {
  const expected = profile.frontDoorStatePath
    ? [[5184, receipts?.frontDoor?.pid], [profile.hostPort, receipts?.host?.pid], [profile.capabilityPort, receipts?.capability?.pid]]
    : [[profile.hostPort, receipts?.host?.pid], [profile.capabilityPort, receipts?.capability?.pid]]
  const listeners = await readListeners(expected.map(([port]) => port))
  const byPort = new Map()
  for (const row of listeners) {
    const current = byPort.get(row.port) || []
    current.push(row.pid)
    byPort.set(row.port, current)
  }
  const result = expected.map(([port, expectedPid]) => {
    const pids = [...new Set(byPort.get(port) || [])]
    const owned = Number.isInteger(Number(expectedPid)) && pids.length === 1 && pids[0] === Number(expectedPid)
    return { port, expectedPid: Number.isInteger(Number(expectedPid)) ? Number(expectedPid) : null, pids, owned }
  })
  return { ok: result.every((item) => item.owned), ports: result }
}

async function fetchJson(url, { token, method = 'GET', headers = {}, body = undefined, timeoutMs = 15000 } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method,
      headers: { accept: 'application/json', ...(token ? { 'x-read-web-token': token } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
    let payload = null
    try { payload = await response.json() } catch { throw promotionError('OWNER_PROMOTION_INVALID_RESPONSE') }
    if (!response.ok) {
      const code = payload?.error?.code
      const safeCode = typeof code === 'string' && SAFE_ID.test(code) ? code : `OWNER_PROMOTION_HTTP_${response.status}`
      throw promotionError(safeCode)
    }
    return payload
  } catch (error) {
    if (error?.name === 'AbortError') throw promotionError('OWNER_PROMOTION_TIMEOUT')
    if (error?.code?.startsWith('OWNER_PROMOTION_')) throw error
    throw promotionError('OWNER_PROMOTION_TRANSPORT_FAILED')
  } finally {
    clearTimeout(timeout)
  }
}

function healthSummary(value) {
  if (!value || typeof value !== 'object') return null
  const ownerMode = value.ownerMode && typeof value.ownerMode === 'object' ? value.ownerMode : {}
  const domains = Array.isArray(ownerMode.authoritativeDomains) ? [...ownerMode.authoritativeDomains].sort() : []
  const frozen = Array.isArray(ownerMode.frozenDomains) ? [...ownerMode.frozenDomains].sort() : []
  const range = value.rangeMedia && typeof value.rangeMedia === 'object' ? value.rangeMedia : {}
  return {
    status: typeof value.status === 'string' ? value.status : null,
    profileId: typeof value.profileId === 'string' ? value.profileId : null,
    instanceId: typeof value.instanceId === 'string' ? value.instanceId : null,
    durableOwnerReady: value.durableOwnerReady === true,
    acceptingApiAuthoritativeOperations: value.acceptingApiAuthoritativeOperations === true,
    acceptingRequests: value.acceptingRequests === true,
    profileLeaseMode: typeof value.profileLeaseMode === 'string' ? value.profileLeaseMode : null,
    profileLeaseReady: value.profileLeaseReady === true,
    profileLeaseAlive: value.profileLeaseAlive === true,
    ownerMode: {
      status: typeof ownerMode.status === 'string' ? ownerMode.status : null,
      authoritativeDomains: domains,
      frozenDomains: frozen,
    },
    rangeMedia: {
      status: typeof range.status === 'string' ? range.status : null,
      supports206: range.supports206 === true,
      endpointRegistered: range.endpointRegistered === true,
    },
  }
}

async function getProfileInspection(profile) {
  let receipts = null
  let receiptError = null
  try { receipts = await readProfileReceipts(profile) } catch (error) { receiptError = error }
  let ownership = null
  let ownershipError = null
  if (receipts) {
    try { ownership = await inspectPortOwnership(profile, receipts) } catch (error) { ownershipError = error }
  }
  let health = null
  let healthError = null
  let token = null
  try {
    token = await readToken(profile)
    health = await fetchJson(`${profile.hostBaseUrl}/api/app/health`, { token })
  } catch (error) { healthError = error }
  let promotionStatus = null
  let promotionErrorCode = null
  if (receipts && promotionArgsEnabled(receipts.host)) {
    try {
      promotionStatus = await createOwnerPromotionClient({ baseUrl: profile.hostBaseUrl, accessToken: token || await readToken(profile) }).status()
    } catch (error) { promotionErrorCode = error?.code || 'OWNER_PROMOTION_STATUS_FAILED' }
  } else {
    promotionErrorCode = 'not-enabled'
  }
  const errors = [receiptError, ownershipError, healthError]
    .filter(Boolean)
    .map((error) => error?.code || 'OWNER_PROMOTION_INSPECTION_FAILED')
  return {
    profileId: profile.profileId,
    hostPort: profile.hostPort,
    capabilityPort: profile.capabilityPort,
    promotionEnabled: Boolean(receipts && promotionArgsEnabled(receipts.host)),
    process: receipts ? {
      hostPid: Number(receipts.host.pid),
      capabilityPid: Number(receipts.capability.pid),
      frontDoorPid: receipts.frontDoor ? Number(receipts.frontDoor.pid) : null,
    } : null,
    ports: ownership?.ports || null,
    health: healthSummary(health),
    promotion: promotionStatus ? {
      status: typeof promotionStatus.status === 'string' ? promotionStatus.status : null,
      frozenDomains: Array.isArray(promotionStatus.frozenDomains) ? [...promotionStatus.frozenDomains].sort() : [],
      drainedDomains: Array.isArray(promotionStatus.drainedDomains) ? [...promotionStatus.drainedDomains].sort() : [],
      checkpointedDomains: Array.isArray(promotionStatus.checkpointedDomains) ? [...promotionStatus.checkpointedDomains].sort() : [],
      invalidDomains: Array.isArray(promotionStatus.invalidDomains) ? [...promotionStatus.invalidDomains].sort() : [],
      challenge: typeof promotionStatus.challenge === 'string' ? promotionStatus.challenge : null,
      drained: promotionStatus.drained === true,
    } : { status: promotionErrorCode || 'not-enabled' },
    errors,
  }
}

async function assertOwnedPorts(profile) {
  const receipts = await readProfileReceipts(profile)
  const ownership = await inspectPortOwnership(profile, receipts)
  if (!ownership.ok) throw promotionError('OWNER_PROMOTION_PORT_OWNER_UNKNOWN')
  return { receipts, ownership }
}

async function runLauncher(profile, args) {
  await new Promise((resolve, reject) => {
    let settled = false
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', profile.launcherPath, ...args,
    ], {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      stdio: 'ignore',
    })
    child.once('error', () => {
      if (settled) return
      settled = true
      reject(promotionError('OWNER_PROMOTION_LAUNCH_FAILED'))
    })
    child.once('exit', (code) => {
      if (settled) return
      settled = true
      if (code === 0) resolve()
      else reject(promotionError('OWNER_PROMOTION_LAUNCH_FAILED'))
    })
  })
}

async function waitForPorts(profile, shouldBeOwned, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000
  while (Date.now() < deadline) {
    try {
      const { receipts } = await assertOwnedPorts(profile)
      if (shouldBeOwned) return { receipts }
    } catch (error) {
      if (shouldBeOwned && !['OWNER_PROMOTION_PORT_OWNER_UNKNOWN', 'OWNER_PROMOTION_STATE_UNAVAILABLE'].includes(error?.code)) throw error
    }
    if (!shouldBeOwned) {
      const ports = profile.frontDoorStatePath ? [5184, profile.hostPort, profile.capabilityPort] : [profile.hostPort, profile.capabilityPort]
      const listeners = await readListeners(ports)
      if (listeners.length === 0) return { receipts: null }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw promotionError(shouldBeOwned ? 'OWNER_PROMOTION_START_TIMEOUT' : 'OWNER_PROMOTION_STOP_TIMEOUT')
}

async function ensurePromotionProfile(profile, options) {
  const inspection = await getProfileInspection(profile)
  if (inspection.promotionEnabled) {
    await assertOwnedPorts(profile)
    return inspection
  }
  const hasOwnedReceipts = inspection.process !== null
  if (hasOwnedReceipts) {
    if (inspection.errors.length) throw promotionError('OWNER_PROMOTION_PROFILE_NOT_OWNED')
    await assertOwnedPorts(profile)
    if (profile.frontDoorStatePath) {
      await runLauncher(profile, ['-Stop', '-NoOpen'])
    } else {
      await runLauncher(profile, ['-Action', 'Stop', '-NoOpen'])
    }
    await waitForPorts(profile, false, options.startupTimeoutSeconds)
  } else {
    const listeners = await readListeners(profile.frontDoorStatePath
      ? [SOURCE_FRONT_DOOR_PORT, profile.hostPort, profile.capabilityPort]
      : [profile.hostPort, profile.capabilityPort])
    if (listeners.length) throw promotionError('OWNER_PROMOTION_PORT_OWNER_UNKNOWN')
  }
  if (profile.frontDoorStatePath) {
    await runLauncher(profile, [
      '-NoOpen', '-EnableOwnerMigration', '-EnableOwnerPromotion',
      '-StartupTimeoutSeconds', String(options.startupTimeoutSeconds),
    ])
  } else {
    await runLauncher(profile, [
      '-Action', 'Start', '-ConfirmDailyProductionApply', '-EnableOwnerPromotion', '-NoOpen',
      '-StartupTimeoutSeconds', String(options.startupTimeoutSeconds),
    ])
  }
  await waitForPorts(profile, true, options.startupTimeoutSeconds)
  const after = await getProfileInspection(profile)
  if (after.errors.length || !after.promotionEnabled || after.health?.status !== 'ready') {
    throw promotionError('OWNER_PROMOTION_PROFILE_NOT_READY')
  }
  return after
}

async function normalizeDailyProfile(profile, options) {
  const inspection = await getProfileInspection(profile)
  if (inspection.errors.length) throw promotionError('OWNER_PROMOTION_PROFILE_NOT_OWNED')
  if (!inspection.promotionEnabled) {
    await assertOwnedPorts(profile)
    return inspection
  }
  await assertOwnedPorts(profile)
  await runLauncher(profile, ['-Action', 'Stop', '-NoOpen'])
  await waitForPorts(profile, false, options.startupTimeoutSeconds)
  await runLauncher(profile, [
    '-Action', 'Start', '-NoOpen', '-StartupTimeoutSeconds', String(options.startupTimeoutSeconds),
  ])
  await waitForPorts(profile, true, options.startupTimeoutSeconds)
  const after = await getProfileInspection(profile)
  if (after.errors.length || after.promotionEnabled || after.health?.status !== 'ready') {
    throw promotionError('OWNER_PROMOTION_DAILY_NORMALIZATION_FAILED')
  }
  return after
}

function createMemoryStore() {
  let value = null
  return {
    async read() { return value === null ? null : clone(value) },
    async write(next) { value = clone(next) },
  }
}

function releaseIdentity(receipts) {
  const releaseId = safeId(String(receipts.host.releaseId || ''), 'release id')
  return {
    releaseId,
    applicationVersion: releaseId,
    backendVersion: releaseId,
    gitSha: null,
    manifestSha: null,
  }
}

async function createCoordinatorContext(sourceProfile, targetProfile, run) {
  const sourceReceipts = await readProfileReceipts(sourceProfile)
  const targetReceipts = await readProfileReceipts(targetProfile)
  const sourceToken = await readToken(sourceProfile)
  const targetToken = await readToken(targetProfile)
  const clients = await createProductionPromotionClients({
    source: sourceProfile,
    target: targetProfile,
    sourceProfileId: sourceProfile.profileId,
    sourceInstanceId: String(sourceReceipts.host.instanceId),
    targetProfileId: targetProfile.profileId,
    targetInstanceId: String(targetReceipts.host.instanceId),
    sourceBaseUrl: sourceProfile.hostBaseUrl,
    targetBaseUrl: targetProfile.hostBaseUrl,
    sourceAccessToken: sourceToken,
    targetAccessToken: targetToken,
    timeoutMs: 30000,
  })
  const adapters = await createAuthoritativePromotionAdapters({
    sourceClient: clients.sourceClient,
    targetClient: clients.targetClient,
    sourceProfileId: sourceProfile.profileId,
    targetProfileId: targetProfile.profileId,
    sourceWorkflowOutputDir: path.join(sourceProfile.dataRoot, 'output'),
  })
  const release = releaseIdentity(targetReceipts)
  const stateStore = run.persistent
    ? createPromotionStateFileStore(run.migrationStatePath, run.runDir)
    : createMemoryStore()
  const targetCheckpointStore = run.persistent
    ? createPromotionStateFileStore(run.targetCheckpointPath, run.runDir)
    : createMemoryStore()
  const coordinator = await createAuthoritativePromotionCoordinator({
    sourceControl: clients.sourceControl,
    targetControl: clients.targetControl,
    sourceAdapters: adapters.sourceAdapters,
    targetAdapters: adapters.targetAdapters,
    sourceProfileId: sourceProfile.profileId,
    sourceInstanceId: String(sourceReceipts.host.instanceId),
    targetProfileId: targetProfile.profileId,
    targetInstanceId: String(targetReceipts.host.instanceId),
    stateStore,
    targetCheckpointStore,
    runId: run.runId,
    release,
  })
  return {
    sourceProfile,
    targetProfile,
    sourceReceipts,
    targetReceipts,
    sourceToken,
    targetToken,
    clients,
    adapters,
    coordinator,
  }
}

function safeMigrationSummary(value) {
  const results = Array.isArray(value?.migration?.results)
    ? value.migration.results
    : (Array.isArray(value?.rollback?.results) ? value.rollback.results : [])
  return {
    ok: value?.ok === true,
    operation: value?.operation || null,
    domains: results.map((item) => ({
      domain: typeof item?.domain === 'string' ? item.domain : null,
      ok: item?.ok === true,
      status: typeof item?.status === 'string' ? item.status : null,
      stage: typeof item?.stage === 'string' ? item.stage : null,
      reasonCode: typeof item?.reasonCode === 'string' ? item.reasonCode : null,
      stepStatus: item?.steps ? Object.fromEntries(Object.entries(item.steps).map(([name, step]) => [name, step?.status || null])) : {},
    })),
    checkpoint: value?.checkpoint && typeof value.checkpoint === 'object'
      ? { idempotent: value.checkpoint.idempotent === true, artifactChecksum: value.checkpoint.artifactChecksum || null }
      : null,
    failureCode: value?.failure?.code || null,
    manualRecovery: value?.manualRecovery === true,
    rollbackOk: value?.rollback?.ok !== false,
    unfreezeOk: value?.unfreeze ? value.unfreeze.ok === true : null,
  }
}

function relativeMediaPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const normalized = value.trim().replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return null
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f\u007f]/u.test(part))) return null
  return parts.join('/')
}

function workflowJobSelection(snapshot) {
  for (const record of snapshot?.records || []) {
    const recordId = String(record?.id || '')
    if (!recordId.startsWith('jobs:')) continue
    const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {}
    const jobId = String(payload.jobId || recordId.slice('jobs:'.length) || '')
    if (!SAFE_ID.test(jobId)) continue
    const manifest = payload.manifest && typeof payload.manifest === 'object' ? payload.manifest : {}
    const checkpoint = manifest.checkpoint && typeof manifest.checkpoint === 'object' ? manifest.checkpoint : {}
    const files = payload.files && typeof payload.files === 'object'
      ? payload.files
      : (manifest.files && typeof manifest.files === 'object'
        ? manifest.files
        : (checkpoint.files && typeof checkpoint.files === 'object' ? checkpoint.files : {}))
    const mediaKind = typeof files.video === 'string' && files.video ? 'video'
      : (typeof files.audio === 'string' && files.audio ? 'audio' : null)
    if (mediaKind) return { jobId, mediaKind }
  }
  const media = Array.isArray(snapshot?.mediaReferences) ? snapshot.mediaReferences : []
  const first = media.find((item) => relativeMediaPath(item?.relativePath || item?.identity))
  const jobId = String(first?.jobId || first?.contentId || '').trim()
  if (SAFE_ID.test(jobId)) return { jobId, mediaKind: first?.kind === 'audio' ? 'audio' : 'video' }
  return null
}

function sourceMediaRelativePaths(snapshot) {
  const references = [
    ...(Array.isArray(snapshot?.mediaReferences) ? snapshot.mediaReferences : []),
    ...(Array.isArray(snapshot?.records)
      ? snapshot.records.flatMap((record) => Array.isArray(record?.mediaReferences) ? record.mediaReferences : [])
      : []),
  ]
  return [...new Set(references.map((item) => relativeMediaPath(item?.relativePath || item?.identity)).filter(Boolean))]
}

async function pathExists(filePath) {
  try { await stat(filePath); return true } catch { return false }
}

async function requestRange(profile, token, job) {
  const url = `${profile.hostBaseUrl}/api/jobs/${encodeURIComponent(job.jobId)}/media/${job.mediaKind}`
  const response = await fetch(url, {
    headers: { accept: '*/*', 'x-read-web-token': token, range: 'bytes=0-15' },
  })
  if (response.status !== 206) {
    let body = ''
    try { body = (await response.text()).slice(0, 512) } catch { body = '' }
    throw promotionError('OWNER_PROMOTION_RANGE_CHECK_FAILED', 'target Host did not return HTTP 206 for the media range probe', {
      jobId: job.jobId,
      mediaKind: job.mediaKind,
      status: response.status,
      contentRange: response.headers.get('content-range') || '',
      contentLength: response.headers.get('content-length') || '',
      body,
    })
  }
  const contentRange = response.headers.get('content-range') || ''
  if (!/^bytes 0-15\/\d+$/u.test(contentRange)) {
    throw promotionError('OWNER_PROMOTION_RANGE_CHECK_FAILED', 'target Host returned an invalid media Content-Range', {
      jobId: job.jobId,
      mediaKind: job.mediaKind,
      status: response.status,
      contentRange,
    })
  }
  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength !== 16) {
    throw promotionError('OWNER_PROMOTION_RANGE_CHECK_FAILED', 'target Host returned an invalid media range body length', {
      jobId: job.jobId,
      mediaKind: job.mediaKind,
      status: response.status,
      contentRange,
      bytes: body.byteLength,
    })
  }
  return { jobId: job.jobId, mediaKind: job.mediaKind, status: response.status, bytes: body.byteLength, contentRange }
}

function assertAuthoritativeHealth(profile, health) {
  const summary = healthSummary(health)
  if (!summary || summary.status !== 'ready'
    || summary.profileId !== profile.profileId
    || summary.durableOwnerReady !== true
    || summary.acceptingApiAuthoritativeOperations !== true
    || summary.ownerMode.status !== 'authoritative'
    || summary.ownerMode.authoritativeDomains.length !== APPLICATION_DOMAINS.length
    || new Set(summary.ownerMode.authoritativeDomains).size !== APPLICATION_DOMAINS.length
    || APPLICATION_DOMAINS.some((domain) => !summary.ownerMode.authoritativeDomains.includes(domain))
    || summary.ownerMode.frozenDomains.length !== 0
    || summary.profileLeaseMode !== 'authoritative'
    || summary.profileLeaseReady !== true
    || summary.profileLeaseAlive !== true) {
    throw promotionError('OWNER_PROMOTION_TARGET_NOT_AUTHORITATIVE')
  }
  return summary
}

async function verifyPromotedRuntime(context) {
  const targetHealth = await fetchJson(`${context.targetProfile.hostBaseUrl}/api/app/health`, { token: context.targetToken })
  const targetSummary = assertAuthoritativeHealth(context.targetProfile, targetHealth)
  const sourceStatus = assertSourceFrozen(await context.clients.sourceControl.status())
  const workflow = await context.adapters.targetAdapters.workflow.collect({ domain: 'workflow' })
  const job = workflowJobSelection(workflow) || workflowJobSelection(context.adapters.sourceWorkflowSnapshot)
  if (!job) throw promotionError('OWNER_PROMOTION_RANGE_JOB_UNAVAILABLE')
  const range = await requestRange(context.targetProfile, context.targetToken, job)
  const sourcePaths = sourceMediaRelativePaths(context.adapters.sourceWorkflowSnapshot)
  let copied = false
  for (const relative of sourcePaths) {
    if (await pathExists(path.join(context.targetProfile.dataRoot, 'output', ...relative.split('/')))) copied = true
  }
  if (copied) throw promotionError('OWNER_PROMOTION_MEDIA_COPIED')
  return {
    target: targetSummary,
    source: {
      status: sourceStatus.status,
      frozenDomains: sourceStatus.frozenDomains.length,
      drainedDomains: sourceStatus.drainedDomains.length,
    },
    media: { copied: false, fallback: true },
    range,
  }
}

async function verifyNormalRuntime(options, sourceProfile, targetProfile, rangeJob = null) {
  const targetInspection = await getProfileInspection(targetProfile)
  if (targetInspection.errors.length || targetInspection.promotionEnabled) {
    throw promotionError('OWNER_PROMOTION_DAILY_NORMALIZATION_FAILED')
  }
  const targetToken = await readToken(targetProfile)
  const targetHealth = await fetchJson(`${targetProfile.hostBaseUrl}/api/app/health`, { token: targetToken })
  const targetSummary = assertAuthoritativeHealth(targetProfile, targetHealth)
  const targetCapability = await fetchJson(`http://127.0.0.1:${targetProfile.capabilityPort}/api/app/health`, { token: targetToken })
  if (targetCapability?.status !== 'ready' || targetCapability?.profileId !== targetProfile.profileId) {
    throw promotionError('OWNER_PROMOTION_CAPABILITY_NOT_READY')
  }
  const range = rangeJob ? await requestRange(targetProfile, targetToken, rangeJob) : null
  const sourceToken = await readToken(sourceProfile)
  const sourceControl = createOwnerPromotionClient({ baseUrl: sourceProfile.hostBaseUrl, accessToken: sourceToken })
  const sourceStatus = assertSourceFrozen(await sourceControl.status())
  return {
    target: targetSummary,
    targetCapability: { status: targetCapability.status, profileId: targetCapability.profileId },
    range,
    source: { status: sourceStatus.status, frozenDomains: sourceStatus.frozenDomains.length, drainedDomains: sourceStatus.drainedDomains.length },
    ordinaryStartupPromotionRoute: 'not-enabled',
    options: { write: false, profile: options.targetProfileId },
  }
}

async function verifyRecoveredNormalRuntime(options, sourceProfile, targetProfile) {
  const targetInspection = await getProfileInspection(targetProfile)
  if (targetInspection.errors.length || targetInspection.promotionEnabled) {
    throw promotionError('OWNER_PROMOTION_DAILY_NORMALIZATION_FAILED')
  }
  const targetHealth = await fetchJson(`${targetProfile.hostBaseUrl}/api/app/health`, { token: await readToken(targetProfile) })
  const targetSummary = healthSummary(targetHealth)
  if (!targetSummary || targetSummary.status !== 'ready'
    || targetSummary.profileId !== targetProfile.profileId
    || targetSummary.acceptingRequests !== true
    || targetSummary.ownerMode.status !== 'pre-cutover'
    || targetSummary.ownerMode.authoritativeDomains.length !== 0
    || targetSummary.ownerMode.frozenDomains.length !== 0
    || targetSummary.profileLeaseMode !== 'authoritative'
    || targetSummary.profileLeaseReady !== true
    || targetSummary.profileLeaseAlive !== true) {
    throw promotionError('OWNER_PROMOTION_DAILY_RECOVERY_NOT_NORMAL')
  }
  const targetCapability = await fetchJson(`http://127.0.0.1:${targetProfile.capabilityPort}/api/app/health`, { token: await readToken(targetProfile) })
  if (targetCapability?.status !== 'ready' || targetCapability?.profileId !== targetProfile.profileId) {
    throw promotionError('OWNER_PROMOTION_CAPABILITY_NOT_READY')
  }
  const sourceToken = await readToken(sourceProfile)
  const sourceControl = createOwnerPromotionClient({ baseUrl: sourceProfile.hostBaseUrl, accessToken: sourceToken })
  const sourceStatus = await sourceControl.status()
  if (sourceStatus?.status !== 'unfrozen' || sourceStatus.frozenDomains?.length || sourceStatus.drainedDomains?.length) {
    throw promotionError('OWNER_PROMOTION_SOURCE_RECOVERY_NOT_COMPLETE')
  }
  return {
    target: targetSummary,
    targetCapability: { status: targetCapability.status, profileId: targetCapability.profileId },
    source: { status: sourceStatus.status, frozenDomains: 0, drainedDomains: 0 },
    ordinaryStartupPromotionRoute: 'not-enabled',
    options: { write: false, profile: options.targetProfileId },
  }
}

async function activePointer() {
  const value = await readJson(ACTIVE_POINTER_PATH, { optional: true })
  if (value === null) return null
  if (!value || value.schemaVersion !== 1 || !safeId(String(value.runId || ''), 'run id')) {
    throw promotionError('OWNER_PROMOTION_STATE_CORRUPT')
  }
  return value
}

function makeRunId() {
  return safeId(`owner-promotion-${Date.now().toString(36)}`)
}

async function resolveRun(command, options) {
  const pointer = await activePointer()
  if (options.runId) return { runId: options.runId, pointer }
  if (command === 'Apply' && pointer && ['running', 'completed', 'manual-recovery'].includes(pointer.status)) return { runId: pointer.runId, pointer }
  if (command !== 'Apply' && pointer && ['running', 'completed', 'manual-recovery'].includes(pointer.status)) return { runId: pointer.runId, pointer }
  if (command === 'Apply') return { runId: makeRunId(), pointer }
  throw promotionError('OWNER_PROMOTION_RUN_REQUIRED')
}

async function runDescriptor(runId, persistent) {
  const safeRun = safeId(runId, 'run id')
  const runDir = containedPath(STATE_ROOT, path.join(STATE_ROOT, safeRun))
  if (persistent) await mkdir(runDir, { recursive: true })
  return {
    runId: safeRun,
    runDir,
    persistent,
    migrationStatePath: path.join(runDir, 'migration-state.json'),
    targetCheckpointPath: path.join(runDir, 'target-checkpoint.json'),
  }
}

async function updatePointer(pointer) {
  await mkdir(STATE_ROOT, { recursive: true })
  const safe = {
    schemaVersion: 1,
    status: pointer.status,
    operation: pointer.operation,
    runId: safeId(pointer.runId, 'run id'),
    sourceProfileId: SOURCE_PROFILE_ID,
    targetProfileId: TARGET_PROFILE_ID,
    domains: [...APPLICATION_DOMAINS],
    updatedAtUtc: new Date().toISOString(),
    ...(pointer.startedAtUtc ? { startedAtUtc: pointer.startedAtUtc } : {}),
    ...(pointer.completedAtUtc ? { completedAtUtc: pointer.completedAtUtc } : {}),
    ...(pointer.result ? { result: clone(pointer.result) } : {}),
  }
  await writeSafeJson(ACTIVE_POINTER_PATH, safe)
  return safe
}

async function runReadOnly(command, options, sourceProfile, targetProfile) {
  if (command === 'Plan') {
    const [source, target] = await Promise.all([getProfileInspection(sourceProfile), getProfileInspection(targetProfile)])
    return {
      ok: source.errors.length === 0 && target.errors.length === 0,
      command,
      write: false,
      domains: [...APPLICATION_DOMAINS],
      source,
      target,
      promotionReady: source.promotionEnabled && target.promotionEnabled,
    }
  }
  const sourceInspection = await ensurePromotionProfile(sourceProfile, options)
  const targetInspection = await ensurePromotionProfile(targetProfile, options)
  const run = await runDescriptor(`${command.toLowerCase()}-read-only`, false)
  const context = await createCoordinatorContext(sourceProfile, targetProfile, run)
  if (command === 'Inventory') {
    const result = await context.coordinator.inventory()
    return {
      ok: true,
      command,
      write: false,
      source: {
        status: result.source.status,
        checksum: result.source.checksum,
        sources: result.source.sources,
        domains: result.source.domains,
      },
      profiles: { source: sourceInspection, target: targetInspection },
    }
  }
  const result = await context.coordinator.dryRun()
  return {
    ok: result.ok === true,
    command,
    write: false,
    results: result.results.map((item) => ({
      domain: item.domain,
      ok: item.ok === true,
      status: item.status || null,
      reasonCode: item.reasonCode || null,
      idempotent: item.idempotent === true,
    })),
    profiles: { source: sourceInspection, target: targetInspection },
  }
}

async function runMutation(command, options, sourceProfile, targetProfile) {
  if (!options.confirm) throw promotionError('OWNER_PROMOTION_CONFIRMATION_REQUIRED')
  const resolved = await resolveRun(command, options)
  const run = await runDescriptor(resolved.runId, true)
  const startedAtUtc = new Date().toISOString()
  await updatePointer({ status: 'running', operation: command, runId: run.runId, startedAtUtc })
  const sourceInspection = await ensurePromotionProfile(sourceProfile, options)
  const targetInspection = await ensurePromotionProfile(targetProfile, options)
  let context = null
  let outcome = null
  try {
    context = await createCoordinatorContext(sourceProfile, targetProfile, run)
    outcome = command === 'Rollback'
      ? await context.coordinator.rollback()
      : (command === 'Resume' ? await context.coordinator.resume() : await context.coordinator.apply())
  } catch (error) {
    outcome = {
      ok: false,
      failure: { code: error?.code || 'OWNER_PROMOTION_APPLY_FAILED' },
      manualRecovery: false,
      rollback: { ok: true },
      unfreeze: null,
    }
  }
  const summary = safeMigrationSummary(outcome)
  if (outcome.ok !== true) {
    if (outcome.manualRecovery === true) {
      await updatePointer({ status: 'manual-recovery', operation: command, runId: run.runId, startedAtUtc, result: summary })
      throw promotionError('OWNER_PROMOTION_MANUAL_RECOVERY_REQUIRED')
    }
    let normalized
    try { normalized = await normalizeDailyProfile(targetProfile, options) } catch {
      await updatePointer({ status: 'manual-recovery', operation: command, runId: run.runId, startedAtUtc, result: summary })
      throw promotionError('OWNER_PROMOTION_DAILY_NORMALIZATION_FAILED')
    }
    const final = await verifyRecoveredNormalRuntime(options, sourceProfile, targetProfile)
    const result = { ok: false, command, write: true, migration: summary, source: sourceInspection, target: normalized, final }
    await updatePointer({ status: 'rolled-back', operation: command, runId: run.runId, startedAtUtc, completedAtUtc: new Date().toISOString(), result: summary })
    return result
  }

  if (command === 'Rollback') {
    const normalized = await normalizeDailyProfile(targetProfile, options)
    const final = await verifyRecoveredNormalRuntime(options, sourceProfile, targetProfile)
    const result = { ok: true, command, write: true, migration: summary, source: sourceInspection, target: normalized, final }
    await updatePointer({ status: 'rolled-back', operation: command, runId: run.runId, startedAtUtc, completedAtUtc: new Date().toISOString(), result: summary })
    return result
  }

  let promoted
  try {
    promoted = await verifyPromotedRuntime(context)
  } catch (error) {
    let rollback = null
    try { rollback = await context.coordinator.rollback() } catch { rollback = { ok: false, manualRecovery: true } }
    if (!rollback.ok || rollback.manualRecovery === true) {
      await updatePointer({ status: 'manual-recovery', operation: command, runId: run.runId, startedAtUtc, result: { ...summary, failureCode: error?.code || 'OWNER_PROMOTION_RUNTIME_VERIFY_FAILED' } })
      throw promotionError('OWNER_PROMOTION_MANUAL_RECOVERY_REQUIRED')
    }
    const normalized = await normalizeDailyProfile(targetProfile, options)
    const final = await verifyRecoveredNormalRuntime(options, sourceProfile, targetProfile)
    const result = {
      ok: false,
      command,
      write: true,
      migration: summary,
      failureCode: error?.code || 'OWNER_PROMOTION_RUNTIME_VERIFY_FAILED',
      failureDetails: error?.details && typeof error.details === 'object' ? clone(error.details) : null,
      automaticRollback: true,
      target: normalized,
      final,
    }
    await updatePointer({ status: 'rolled-back', operation: command, runId: run.runId, startedAtUtc, completedAtUtc: new Date().toISOString(), result: safeMigrationSummary({ ...outcome, failure: { code: result.failureCode, details: result.failureDetails } }) })
    return result
  }

  let normalized
  let final
  try {
    normalized = await normalizeDailyProfile(targetProfile, options)
    final = await verifyNormalRuntime(options, sourceProfile, targetProfile, promoted.range)
  } catch {
    await updatePointer({ status: 'manual-recovery', operation: command, runId: run.runId, startedAtUtc, result: summary })
    throw promotionError('OWNER_PROMOTION_DAILY_NORMALIZATION_FAILED')
  }
  const result = {
    ok: true,
    command,
    write: true,
    migration: summary,
    promoted,
    target: normalized,
    final,
    fallback: { optimizationReadOnly: true, frozenDomains: HOST_DOMAINS.length },
  }
  await updatePointer({ status: 'completed', operation: command, runId: run.runId, startedAtUtc, completedAtUtc: new Date().toISOString(), result: summary })
  return result
}

async function main() {
  const [command, ...argv] = process.argv.slice(2)
  if (!COMMANDS.includes(command)) throw promotionError('OWNER_PROMOTION_COMMAND_INVALID', 'command must be Plan, Inventory, DryRun, Apply, Resume, or Rollback')
  const options = parseOptions(argv)
  validateFixedOptions(options)
  const sourceProfile = profileContract(options, 'source')
  const targetProfile = profileContract(options, 'target')
  if (['Apply', 'Resume', 'Rollback'].includes(command)) return runMutation(command, options, sourceProfile, targetProfile)
  return runReadOnly(command, options, sourceProfile, targetProfile)
}

try {
  const result = await main()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  const code = typeof error?.code === 'string' && SAFE_ID.test(error.code) ? error.code : 'OWNER_PROMOTION_FAILED'
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code } })}\n`)
  process.exitCode = 1
}
