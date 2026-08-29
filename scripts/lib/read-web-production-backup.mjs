import { Buffer } from 'node:buffer'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

import { resolveSelectedPython } from './python-runtime.mjs'
import {
  OWNER_PENDING_JOURNAL_FILE,
  OWNER_PENDING_JOURNAL_OPERATION_KINDS,
  OWNER_PENDING_JOURNAL_SCHEMA_VERSION,
  OWNER_PROFILE_DOMAINS,
  calculateOwnerPendingJournalChecksum,
  createOwnerPendingCommitEvidence,
  createOwnerPendingPrepareEvidence,
  createOwnerPendingProfileIdentity,
  readOwnerPendingJournalUnlocked,
  recoverOwnerPendingJournalUnlocked,
  runOwnerPendingJournalOperationUnlocked,
  validateOwnerPendingJournal,
  writeOwnerPendingJournalUnlocked,
} from './windows-owner-pending-journal.mjs'

export {
  OWNER_PENDING_JOURNAL_FILE,
  OWNER_PENDING_JOURNAL_OPERATION_KINDS,
  OWNER_PENDING_JOURNAL_SCHEMA_VERSION,
  OWNER_PROFILE_DOMAINS,
  calculateOwnerPendingJournalChecksum,
  createOwnerPendingCommitEvidence,
  createOwnerPendingPrepareEvidence,
  createOwnerPendingProfileIdentity,
  validateOwnerPendingJournal,
}

const repoRoot = path.resolve(import.meta.dirname, '../..')
const workflowRoot = path.join(repoRoot, 'tools', 'subtitle-workflow')
const PROFILE_SCHEMA_VERSION = 1
const APPLICATION_STATE_FILE = 'application-state.json'
const BROWSER_PROFILE_FILE = 'browser-profile.json'
const JOURNAL_SCHEMA_VERSION = 1
const PATH_LOCK_SCHEMA_VERSION = 1
const PATH_LOCK_SUFFIX = '.read-web-path.lock'
const PATH_LOCK_CLAIM_SUFFIX = '.claim-'
const PATH_LOCK_HEARTBEAT_FILE = 'heartbeat.json'
const PATH_LOCK_TIMEOUT_MS = 30_000
const PATH_LOCK_STALE_AFTER_MS = 15_000
const PATH_LOCK_RETRY_MS = 15
const PATH_LOCK_HEARTBEAT_MS = 1_000
const OWNER_PROFILE_EVIDENCE_SCHEMA_VERSION = 1
const OWNER_PROFILE_EVIDENCE_SOURCE = 'read-web-production-backup.composition'
const OWNER_MODE_CHECKPOINT_SCHEMA_VERSION = 1
const OWNER_MODE_CHECKPOINT_DIR = 'owner-mode'
const OWNER_MODE_CHECKPOINT_SUBDIR = 'checkpoints'
const OWNER_MODE_FREEZE_SUBDIR = 'frozen'
const OWNER_MODE_AUTHORITY = 'host-api=authoritative'
const OWNER_MODE_LEASE_SCHEMA_VERSION = 1
const OWNER_MODE_REVISION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const PROFILE_LEASE_MODE_AUTHORITATIVE = 'authoritative'
const PROFILE_LEASE_MODE_STANDBY = 'standby'
const OWNER_PROFILE_READER_ROW_IDS = new Set(['audioMeta', 'transcript', 'chunkData', 'marks', 'readerSession'])
const OWNER_PROFILE_WORKFLOW_RECEIPT_PREFIXES = Object.freeze([
  'read-web.workflow-operation-receipt.v1.',
  'read-web.workflow-operation-receipt-quarantine.v1.',
])

let backupModulesPromise
const applicationPathLockContext = new AsyncLocalStorage()
const applicationPathLeaseContext = new AsyncLocalStorage()

function unsafeIsolationPath(message, details = {}) {
  const error = new Error(message)
  error.code = 'BACKUP_PRODUCTION_COMPOSITION_UNSAFE_PATH'
  error.details = details
  return error
}

async function resolveCanonicalPath(value) {
  const missing = []
  let current = path.resolve(value)
  while (true) {
    try {
      const canonical = await realpath(current)
      return path.resolve(canonical, ...missing.reverse())
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error?.code)) throw error
      const parent = path.dirname(current)
      if (parent === current) return path.resolve(value)
      missing.push(path.basename(current))
      current = parent
    }
  }
}

function comparablePath(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function isStrictDescendant(parent, child) {
  const relative = path.relative(comparablePath(parent), comparablePath(child))
  return Boolean(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
}

async function validateIsolationLayout({ isolationRoot, paths, forbiddenRoots = [] } = {}) {
  if (typeof isolationRoot !== 'string' || !isolationRoot.trim()
    || !paths || typeof paths !== 'object' || Array.isArray(paths)
    || !Object.keys(paths).length
    || Object.values(paths).some((value) => typeof value !== 'string' || !value.trim())) {
    throw unsafeIsolationPath('Isolation layout requires a root and concrete target paths')
  }

  const lexicalIsolationRoot = path.resolve(isolationRoot.trim())
  const lexicalPaths = Object.fromEntries(
    Object.entries(paths).map(([name, value]) => [name, path.resolve(value.trim())]),
  )
  let canonicalIsolationRoot
  let canonicalPaths
  try {
    canonicalIsolationRoot = await resolveCanonicalPath(lexicalIsolationRoot)
    canonicalPaths = Object.fromEntries(
      await Promise.all(Object.entries(lexicalPaths).map(async ([name, value]) => [name, await resolveCanonicalPath(value)])),
    )
  } catch (error) {
    throw unsafeIsolationPath('Isolation layout paths could not be canonicalized safely', {
      isolationRoot: lexicalIsolationRoot,
      paths: lexicalPaths,
      cause: error,
    })
  }

  for (const [name, value] of Object.entries(canonicalPaths)) {
    if (!isStrictDescendant(canonicalIsolationRoot, value)) {
      throw unsafeIsolationPath(`${name} must be a strict descendant of isolationRoot`, {
        name,
        isolationRoot: canonicalIsolationRoot,
        lexicalIsolationRoot,
        value,
        lexicalValue: lexicalPaths[name],
      })
    }
  }

  const entries = Object.entries(canonicalPaths)
  for (let index = 0; index < entries.length; index += 1) {
    for (let candidate = index + 1; candidate < entries.length; candidate += 1) {
      const [leftName, left] = entries[index]
      const [rightName, right] = entries[candidate]
      if (comparablePath(left) === comparablePath(right)
        || isStrictDescendant(left, right)
        || isStrictDescendant(right, left)) {
        throw unsafeIsolationPath(`${leftName} and ${rightName} must not overlap`, { left, right })
      }
    }
  }

  const configuredForbiddenRoots = [
    ...(process.platform === 'win32' ? [
      'E:\\read-web',
      'E:\\read-web-next',
      'E:\\ReadWebData\\SubtitleWorkflow',
    ] : []),
    ...(Array.isArray(forbiddenRoots) ? forbiddenRoots : []),
  ]
  for (const forbiddenRootValue of configuredForbiddenRoots) {
    if (typeof forbiddenRootValue !== 'string' || !forbiddenRootValue.trim()) {
      throw unsafeIsolationPath('Forbidden root must be a non-empty path', { forbiddenRoot: forbiddenRootValue })
    }
    let canonicalForbiddenRoot
    try {
      canonicalForbiddenRoot = await resolveCanonicalPath(path.resolve(forbiddenRootValue.trim()))
    } catch (error) {
      throw unsafeIsolationPath('Forbidden root could not be canonicalized safely', {
        forbiddenRoot: forbiddenRootValue,
        cause: error,
      })
    }
    for (const [name, value] of Object.entries({ isolationRoot: canonicalIsolationRoot, ...canonicalPaths })) {
      if (comparablePath(value) === comparablePath(canonicalForbiddenRoot)
        || isStrictDescendant(canonicalForbiddenRoot, value)
        || isStrictDescendant(value, canonicalForbiddenRoot)) {
        throw unsafeIsolationPath(`${name} overlaps a forbidden root`, {
          name,
          value,
          forbiddenRoot: canonicalForbiddenRoot,
        })
      }
    }
  }

  return Object.freeze({
    isolationRoot: canonicalIsolationRoot,
    paths: Object.freeze(canonicalPaths),
  })
}

async function validateProfileAuthorityLayout(options, instanceLayout) {
  const authorityRootValue = options?.profileAuthorityRoot
  if (typeof authorityRootValue !== 'string' || !authorityRootValue.trim()) {
    return Object.freeze({
      profileAuthorityIsolationRoot: instanceLayout.isolationRoot,
      profileAuthorityRoot: instanceLayout.isolationRoot,
      explicit: false,
    })
  }
  const authorityIsolationRootValue = options?.profileAuthorityIsolationRoot
  if (typeof authorityIsolationRootValue !== 'string' || !authorityIsolationRootValue.trim()) {
    throw unsafeIsolationPath(
      'Stable profile authority lease requires profileAuthorityIsolationRoot',
      { profileAuthorityRoot: authorityRootValue },
    )
  }
  const authorityLayout = await validateIsolationLayout({
    isolationRoot: authorityIsolationRootValue,
    paths: { profileAuthorityRoot: authorityRootValue },
    forbiddenRoots: options?.forbiddenRoots,
  })
  const instanceRoot = instanceLayout.isolationRoot
  const profileAuthorityRoot = authorityLayout.paths.profileAuthorityRoot
  if (comparablePath(instanceRoot) === comparablePath(profileAuthorityRoot)
    || isStrictDescendant(instanceRoot, profileAuthorityRoot)
    || isStrictDescendant(profileAuthorityRoot, instanceRoot)) {
    throw unsafeIsolationPath(
      'Instance isolation root and stable profile authority root must not overlap',
      { instanceRoot, profileAuthorityRoot },
    )
  }
  return Object.freeze({
    profileAuthorityIsolationRoot: authorityLayout.isolationRoot,
    profileAuthorityRoot,
    explicit: true,
  })
}

async function loadTrustedBackupModules() {
  if (backupModulesPromise) return backupModulesPromise
  backupModulesPromise = (async () => {
    const applicationBackupSource = await readFile(
      path.join(repoRoot, 'src', 'services', 'persistence', 'application-backup.js'),
      'utf8',
    )
    const isolationIssuerToken = randomUUID()
    const isolatedApplicationBackupSource = applicationBackupSource.replace(
      'const ISOLATION_ISSUER_TOKEN = null',
      `const ISOLATION_ISSUER_TOKEN = ${JSON.stringify(isolationIssuerToken)}`,
    )
    if (isolatedApplicationBackupSource === applicationBackupSource) {
      throw new Error('Application backup isolation issuer placeholder is missing')
    }
    const applicationBackupUrl = `data:text/javascript;base64,${Buffer.from(isolatedApplicationBackupSource).toString('base64')}`
    const readWebSource = await readFile(
      path.join(repoRoot, 'src', 'services', 'persistence', 'read-web-application-backup.js'),
      'utf8',
    )
    const resolvedReadWebSource = readWebSource.replace(
      "from './application-backup.js'",
      `from '${applicationBackupUrl}'`,
    )
    const readWebUrl = `data:text/javascript;base64,${Buffer.from(resolvedReadWebSource).toString('base64')}`
    const [applicationBackup, readWebBackup] = await Promise.all([
      import(applicationBackupUrl),
      import(readWebUrl),
    ])
    return { applicationBackup, readWebBackup, isolationIssuerToken }
  })()
  return backupModulesPromise
}

export async function loadBackupModules() {
  const { applicationBackup, readWebBackup } = await loadTrustedBackupModules()
  return Object.freeze({ applicationBackup, readWebBackup })
}

function createTrustedIsolationCertificate({ applicationBackup, isolationIssuerToken, validatedLayout } = {}) {
  if (!applicationBackup || typeof isolationIssuerToken !== 'string' || !validatedLayout
    || typeof validatedLayout.isolationRoot !== 'string'
    || !validatedLayout.paths || typeof validatedLayout.paths !== 'object') {
    throw unsafeIsolationPath('Trusted isolation certificates require a validated canonical layout')
  }
  const certificate = applicationBackup.createApplicationBackupIsolationCertificate({
    isolationRoot: validatedLayout.isolationRoot,
    paths: validatedLayout.paths,
    issuerToken: isolationIssuerToken,
  })
  if (!applicationBackup.isApplicationBackupIsolationCertificate(certificate)) {
    throw unsafeIsolationPath('Trusted isolation certificate was not issued by the validated backup module')
  }
  return certificate
}

function registerTrustedRestoreTarget({ applicationBackup, isolationIssuerToken, target } = {}) {
  const registered = applicationBackup?.registerApplicationBackupIsolationTarget?.({
    target,
    isolationCertificate: target?.isolationCertificate,
    isolationLayout: target?.isolationLayout,
    issuerToken: isolationIssuerToken,
  })
  if (registered !== true) {
    throw unsafeIsolationPath('Trusted restore target registration failed')
  }
  return target
}

export async function createProductionOutboxQuarantineProtector(options = {}) {
  const { readWebBackup } = await loadBackupModules()
  return readWebBackup.createReaderSaveOutboxQuarantineProtector(options)
}

function clone(value) {
  return structuredClone(value)
}

function freezeFaultPlan(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    throw unsafeIsolationPath('Restore fault plan must contain only plain data')
  }
  const snapshot = Array.isArray(value) ? [] : Object.create(null)
  seen.set(value, snapshot)
  if (Array.isArray(value)) snapshot.length = value.length
  for (const key of Reflect.ownKeys(value).filter((entry) => !(Array.isArray(value) && entry === 'length'))) {
    if (typeof key !== 'string') throw unsafeIsolationPath('Restore fault plan cannot contain symbol keys')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || (!Object.prototype.hasOwnProperty.call(descriptor, 'value') && typeof descriptor.value !== 'function') || !descriptor.enumerable) {
      throw unsafeIsolationPath('Restore fault plan must contain enumerable data properties')
    }
    snapshot[key] = freezeFaultPlan(descriptor.value, seen)
  }
  return Object.freeze(snapshot)
}

function canonicalJson(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

function pathMutexKey(filePath) {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function pathLockPath(filePath) {
  return `${pathMutexKey(filePath)}${PATH_LOCK_SUFFIX}`
}

function pathLockClaimPath(lockPath, ownerToken) {
  return `${lockPath}${PATH_LOCK_CLAIM_SUFFIX}${ownerToken}`
}

function pathLockNumber(name, fallback, minimum) {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback
}

function pathLockTimeout(options = {}) {
  return Number.isFinite(options.timeoutMs)
    ? Math.max(100, Math.floor(options.timeoutMs))
    : pathLockNumber('READ_WEB_BACKUP_LOCK_TIMEOUT_MS', PATH_LOCK_TIMEOUT_MS, 100)
}

function pathLockStaleAfter(options = {}) {
  return Number.isFinite(options.staleAfterMs)
    ? Math.max(1_000, Math.floor(options.staleAfterMs))
    : pathLockNumber('READ_WEB_BACKUP_LOCK_STALE_AFTER_MS', PATH_LOCK_STALE_AFTER_MS, 1_000)
}

async function readPathLockMetadata(lockPath) {
  try {
    const raw = await readFile(path.join(lockPath, 'owner.json'), 'utf8')
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || value.schemaVersion !== PATH_LOCK_SCHEMA_VERSION
      || typeof value.ownerToken !== 'string' || !value.ownerToken
      || !Number.isInteger(value.pid) || value.pid <= 0
      || typeof value.acquiredAt !== 'string' || typeof value.heartbeatAt !== 'string') return null
    try {
      const heartbeat = JSON.parse(await readFile(path.join(lockPath, PATH_LOCK_HEARTBEAT_FILE), 'utf8'))
      if (heartbeat?.schemaVersion === PATH_LOCK_SCHEMA_VERSION
        && heartbeat.ownerToken === value.ownerToken
        && typeof heartbeat.heartbeatAt === 'string') {
        return { ...value, heartbeatAt: heartbeat.heartbeatAt }
      }
    } catch { /* The immutable owner record remains authoritative during heartbeat publication. */ }
    return value
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    return null
  }
}

async function writePathLockMetadata(lockPath, metadata) {
  const ownerPath = path.join(lockPath, 'owner.json')
  const temporary = `${ownerPath}.tmp-${metadata.ownerToken}`
  let handle
  try {
    handle = await open(temporary, 'wx')
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await renameWithRetry(temporary, ownerPath)
  } finally {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
  }
}

async function writePathLockHeartbeat(lockPath, ownerToken) {
  await writeJsonAtomic(path.join(lockPath, PATH_LOCK_HEARTBEAT_FILE), {
    schemaVersion: PATH_LOCK_SCHEMA_VERSION,
    ownerToken,
    heartbeatAt: new Date().toISOString(),
  })
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function pathLockAge(lockPath, metadata) {
  const value = Date.parse(metadata?.heartbeatAt || metadata?.acquiredAt || '')
  if (Number.isFinite(value)) return Date.now() - value
  try {
    const lockStat = await stat(path.join(lockPath, 'owner.json'))
    return Date.now() - lockStat.mtimeMs
  } catch (error) {
    if (error?.code !== 'ENOENT') return 0
    try {
      const lockStat = await stat(lockPath)
      return Date.now() - lockStat.mtimeMs
    } catch { return 0 }
  }
}

async function recoverStalePathLock(lockPath, staleAfterMs) {
  const first = await readPathLockMetadata(lockPath)
  const age = await pathLockAge(lockPath, first)
  if (age < staleAfterMs) return false
  if (first?.pid && processIsAlive(first.pid)) return false
  const second = await readPathLockMetadata(lockPath)
  if (second?.pid && processIsAlive(second.pid)) return false
  if (first?.ownerToken && (!second || second.ownerToken !== first.ownerToken)) return false
  return moveAndRemoveStalePathLock(lockPath, first?.ownerToken || null)
}

async function moveAndRemoveStalePathLock(lockPath, ownerToken) {
  const stalePath = `${lockPath}.stale-${randomUUID()}`
  try {
    await rename(lockPath, stalePath)
  } catch (error) {
    if (['ENOENT', 'EEXIST', 'ENOTEMPTY', 'EISDIR', 'EPERM', 'EACCES'].includes(error?.code)) return false
    throw error
  }
  try {
    const moved = await readPathLockMetadata(stalePath)
    if (ownerToken && moved?.ownerToken && moved.ownerToken !== ownerToken) return false
    if (moved?.pid && processIsAlive(moved.pid)) return false
    await rm(stalePath, { recursive: true, force: true })
    return true
  } finally {
    await rm(stalePath, { recursive: true, force: true }).catch(() => {})
  }
}

async function cleanupStalePathClaims(lockPath, staleAfterMs) {
  const parent = path.dirname(lockPath)
  const prefix = `${path.basename(lockPath)}${PATH_LOCK_CLAIM_SUFFIX}`
  let entries
  try {
    entries = await readdir(parent)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  await Promise.all(entries.filter((entry) => entry.startsWith(prefix)).map(async (entry) => {
    const claimPath = path.join(parent, entry)
    const metadata = await readPathLockMetadata(claimPath)
    const age = await pathLockAge(claimPath, metadata)
    if (age < staleAfterMs || metadata?.pid && processIsAlive(metadata.pid)) return
    await rm(claimPath, { recursive: true, force: true }).catch(() => {})
  }))
}

async function waitForPathLockClaimTestBarrier(ownerToken) {
  if (process.env.READ_WEB_BACKUP_TEST_MODE !== '1') return
  const barrierDir = process.env.READ_WEB_BACKUP_LOCK_CLAIM_BARRIER_DIR
  if (!barrierDir) return
  const resolvedBarrierDir = path.resolve(barrierDir)
  await mkdir(resolvedBarrierDir, { recursive: true })
  await writeJsonAtomic(path.join(resolvedBarrierDir, 'claim-ready.json'), { ownerToken })
  const releasePath = path.join(resolvedBarrierDir, 'release.json')
  const deadline = Date.now() + pathLockNumber(
    'READ_WEB_BACKUP_LOCK_CLAIM_BARRIER_TIMEOUT_MS',
    5_000,
    100,
  )
  while (!await pathExists(releasePath)) {
    if (Date.now() >= deadline) {
      const error = new Error('Timed out waiting for the backup lock claim test barrier')
      error.code = 'BACKUP_PATH_LOCK_TEST_BARRIER_TIMEOUT'
      throw error
    }
    await delay(10)
  }
}

async function releasePathLock(lockPath, ownerToken) {
  const metadata = await readPathLockMetadata(lockPath)
  if (!metadata || metadata.ownerToken !== ownerToken) return
  await rm(lockPath, { recursive: true, force: true })
}

function startPathLockHeartbeat(lockPath, ownerToken) {
  let stopped = false
  let pending = Promise.resolve()
  const beat = () => {
    pending = pending.then(async () => {
      if (stopped) return
      const metadata = await readPathLockMetadata(lockPath)
      if (metadata?.ownerToken !== ownerToken) return
      await writePathLockHeartbeat(lockPath, ownerToken)
    }).catch(() => {})
  }
  const timer = setInterval(beat, PATH_LOCK_HEARTBEAT_MS)
  timer.unref?.()
  return async () => {
    stopped = true
    clearInterval(timer)
    await pending
  }
}

async function withPathMutex(filePath, operation, options = {}) {
  const lockPath = pathLockPath(filePath)
  const timeoutMs = pathLockTimeout(options)
  const staleAfterMs = pathLockStaleAfter(options)
  const retryMs = Number.isFinite(options.retryMs) ? Math.max(1, Math.floor(options.retryMs)) : PATH_LOCK_RETRY_MS
  await mkdir(path.dirname(lockPath), { recursive: true })
  const deadline = Date.now() + timeoutMs
  const ownerToken = randomUUID()
  while (true) {
    await cleanupStalePathClaims(lockPath, staleAfterMs)
    const claimPath = pathLockClaimPath(lockPath, ownerToken)
    let acquiredAt
    try {
      await mkdir(claimPath)
      acquiredAt = new Date().toISOString()
      await writePathLockMetadata(claimPath, {
        schemaVersion: PATH_LOCK_SCHEMA_VERSION,
        ownerToken,
        pid: process.pid,
        acquiredAt,
        heartbeatAt: acquiredAt,
      })
      await waitForPathLockClaimTestBarrier(ownerToken)
      await rename(claimPath, lockPath)
    } catch (error) {
      await rm(claimPath, { recursive: true, force: true }).catch(() => {})
      const renameContention = error?.syscall === 'rename'
        && path.resolve(error?.path || '') === path.resolve(claimPath)
        && path.resolve(error?.dest || '') === path.resolve(lockPath)
      const contention = ['EEXIST', 'ENOTEMPTY', 'EISDIR', 'EPERM', 'EACCES'].includes(error?.code)
        && (renameContention || await pathExists(lockPath))
      if (!contention) throw error
      await recoverStalePathLock(lockPath, staleAfterMs)
      if (Date.now() >= deadline) {
        const lockError = new Error('Timed out waiting for an isolated backup path lock')
        lockError.code = 'BACKUP_PATH_LOCK_TIMEOUT'
        throw lockError
      }
      await delay(Math.min(retryMs, Math.max(1, deadline - Date.now())))
      continue
    }
    await rm(claimPath, { recursive: true, force: true }).catch(() => {})
    const stopHeartbeat = startPathLockHeartbeat(lockPath, ownerToken)
    const lease = Object.freeze({
      schemaVersion: PATH_LOCK_SCHEMA_VERSION,
      filePath: path.resolve(filePath),
      profileKey: pathMutexKey(filePath),
      lockPath,
      ownerToken,
      pid: process.pid,
      acquiredAt,
    })
    try {
      return await operation(lease)
    } finally {
      await stopHeartbeat()
      await rm(claimPath, { recursive: true, force: true }).catch(() => {})
      await releasePathLock(lockPath, ownerToken)
    }
  }
}

async function withApplicationPathMutex(filePath, operation, options = {}) {
  const key = pathMutexKey(filePath)
  const held = applicationPathLockContext.getStore()
  const heldLeases = applicationPathLeaseContext.getStore()
  if (held?.has(key)) return operation(heldLeases?.get(key) || null)
  const next = new Set(held || [])
  next.add(key)
  return withPathMutex(filePath, (lease) => {
    const nextLeases = new Map(heldLeases || [])
    nextLeases.set(key, lease)
    return applicationPathLockContext.run(next, () => (
      applicationPathLeaseContext.run(nextLeases, () => operation(lease))
    ))
  }, options)
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function pathExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/*
 * The lock is intentionally a directory created with mkdir: creation is an
 * atomic operation on Windows and POSIX. owner.json is a lease record, not a
 * deletion signal; stale recovery only removes a lease whose owner process is
 * gone and whose heartbeat has exceeded the bounded lease age.
 */

async function renameWithRetry(temporary, absolute) {
  const retryDelays = [0, 5, 15, 35, 75, 150]
  let lastError
  for (const milliseconds of retryDelays) {
    if (milliseconds) await delay(milliseconds)
    try {
      await rename(temporary, absolute)
      return
    } catch (error) {
      lastError = error
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || milliseconds === retryDelays.at(-1)) throw error
    }
  }
  throw lastError
}

export async function writeJsonAtomic(filePath, value, { containmentRoot = null } = {}) {
  const absolute = path.resolve(filePath)
  const assertContained = async (temporary = null) => {
    if (!containmentRoot) return
    await assertPathContainedBeforeWrite(containmentRoot, absolute)
    if (temporary) await assertPathContainedBeforeWrite(containmentRoot, temporary)
  }
  await assertContained()
  await mkdir(path.dirname(absolute), { recursive: true })
  await assertContained()
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  let handle
  try {
    await assertContained(temporary)
    handle = await open(temporary, 'wx')
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await assertContained(temporary)
    await renameWithRetry(temporary, absolute)
  } catch (error) {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export async function assertPathContainedBeforeWrite(root, filePath) {
  let canonicalRoot
  let canonicalFilePath
  try {
    canonicalRoot = await resolveCanonicalPath(root)
    canonicalFilePath = await resolveCanonicalPath(filePath)
  } catch (error) {
    throw unsafeIsolationPath('Path could not be canonicalized safely before write', {
      root,
      filePath,
      cause: error,
    })
  }
  if (!isStrictDescendant(canonicalRoot, canonicalFilePath)) {
    throw unsafeIsolationPath('Path must remain inside its isolated profile authority directory', {
      root: canonicalRoot,
      filePath,
      canonicalFilePath,
    })
  }
  return canonicalFilePath
}

function ownerModeError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

function sha256Value(value) {
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`
}

function checksumValue(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

function ownerModeDomain(domain) {
  const value = String(domain || '').trim()
  if (!OWNER_PROFILE_DOMAINS.includes(value)) {
    throw ownerModeError(
      'OWNER_MODE_CHECKPOINT_UNKNOWN_DOMAIN',
      `Owner-mode checkpoint domain is not registered: ${value || '[missing]'}`,
      { domain: value || null },
    )
  }
  return value
}

function resolveProfileId(options, profileDir) {
  const explicit = options?.profileId || process.env.READ_WEB_PROFILE_ID
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  return `isolated-profile-${createHash('sha256').update(pathMutexKey(profileDir)).digest('hex').slice(0, 16)}`
}

function profileLeaseEvidence(lease, { profileAuthorityRoot, isolationRoot, profileId } = {}) {
  const leaseRoot = profileAuthorityRoot || isolationRoot
  if (!lease || typeof lease !== 'object' || typeof lease.ownerToken !== 'string' || !lease.ownerToken
    || typeof lease.profileKey !== 'string' || !lease.profileKey
    || typeof leaseRoot !== 'string' || !leaseRoot.trim()) {
    throw ownerModeError(
      'OWNER_MODE_PROFILE_LEASE_REQUIRED',
      'Owner-mode operation requires the active application profile lease',
    )
  }
  const expectedKey = pathMutexKey(leaseRoot)
  if (lease.profileKey !== expectedKey) {
    throw ownerModeError(
      'OWNER_MODE_PROFILE_LEASE_MISMATCH',
      'Active lease does not belong to the requested application profile',
      { expectedProfileKeyHash: sha256Value(expectedKey), actualProfileKeyHash: sha256Value(lease.profileKey) },
    )
  }
  const normalizedProfileId = String(profileId || '').trim()
  if (!normalizedProfileId) {
    throw ownerModeError('OWNER_MODE_PROFILE_ID_REQUIRED', 'Owner-mode operation requires a profile id')
  }
  return Object.freeze({
    schemaVersion: OWNER_MODE_LEASE_SCHEMA_VERSION,
    status: 'held',
    profileId: normalizedProfileId,
    profileKeyHash: sha256Value(expectedKey),
    leaseIdHash: sha256Value(`read-web.application-profile-lease.v1:${expectedKey}`),
    ownerTokenHash: sha256Value(lease.ownerToken),
    pid: lease.pid,
  })
}

function assertActiveProfileLease(lease, context) {
  return profileLeaseEvidence(lease, context)
}

function ownerModeCheckpointPath(profileAuthorityRoot, domain) {
  return path.join(profileAuthorityRoot, OWNER_MODE_CHECKPOINT_DIR, OWNER_MODE_CHECKPOINT_SUBDIR, `${ownerModeDomain(domain)}.json`)
}

function ownerModeFreezePath(profileAuthorityRoot, domain) {
  return path.join(profileAuthorityRoot, OWNER_MODE_CHECKPOINT_DIR, OWNER_MODE_FREEZE_SUBDIR, `${ownerModeDomain(domain)}.json`)
}

function ownerModeCheckpointChecksum(value) {
  const { checksum: _checksum, ...core } = value || {}
  return checksumValue(core)
}

function ownerModeFreezeChecksum(value) {
  const { checksum: _checksum, ...core } = value || {}
  return checksumValue(core)
}

function normalizedOwnerRepository(repository) {
  if (!repository || typeof repository !== 'object' || Array.isArray(repository)) {
    throw ownerModeError(
      'OWNER_MODE_CHECKPOINT_REPOSITORY_INVALID',
      'Owner-mode checkpoint requires a Host-managed repository descriptor',
    )
  }
  const identity = typeof repository.identity === 'string' ? repository.identity.trim() : ''
  const type = typeof repository.type === 'string' ? repository.type.trim() : ''
  const revisions = {
    baseRevision: repository.baseRevision,
    revision: repository.revision,
  }
  const validRevision = (value) => (
    (Number.isInteger(value) && value >= 0)
    || (typeof value === 'string' && OWNER_MODE_REVISION_TOKEN.test(value))
  )
  const comparableNumbers = Number.isInteger(revisions.baseRevision) && Number.isInteger(revisions.revision)
  if (!identity || type !== 'host-managed'
    || !validRevision(revisions.baseRevision)
    || !validRevision(revisions.revision)
    || (comparableNumbers && revisions.revision < revisions.baseRevision)
    || typeof repository.baseEvidence !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(repository.baseEvidence)
    || typeof repository.revisionEvidence !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(repository.revisionEvidence)) {
    throw ownerModeError(
      'OWNER_MODE_CHECKPOINT_REPOSITORY_INVALID',
      'Owner-mode checkpoint repository evidence is incomplete or not Host-managed',
      { identity: identity || null, type: type || null },
    )
  }
  return {
    identity,
    type,
    baseRevision: revisions.baseRevision,
    revision: revisions.revision,
    baseEvidence: repository.baseEvidence,
    revisionEvidence: repository.revisionEvidence,
  }
}

function validateOwnerModeCheckpoint(value, { profileAuthorityRoot, isolationRoot, profileId, lease, domain } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ownerModeError('OWNER_MODE_CHECKPOINT_CORRUPT', 'Owner-mode checkpoint is not an object')
  }
  if (value.schemaVersion !== OWNER_MODE_CHECKPOINT_SCHEMA_VERSION) {
    throw ownerModeError(
      'OWNER_MODE_CHECKPOINT_UNKNOWN_SCHEMA',
      'Owner-mode checkpoint schema is unsupported',
      { schemaVersion: value.schemaVersion ?? null },
    )
  }
  const expectedDomain = ownerModeDomain(domain || value.domain)
  if (value.domain !== expectedDomain) {
    throw ownerModeError('OWNER_MODE_CHECKPOINT_INVALID', 'Owner-mode checkpoint domain does not match the requested domain')
  }
  const expectedProfileId = String(profileId || '').trim()
  if (!expectedProfileId || value.profileId !== expectedProfileId) {
    throw ownerModeError(
      'OWNER_MODE_CHECKPOINT_PROFILE_MISMATCH',
      'Owner-mode checkpoint belongs to a different application profile',
      { expectedProfileId: expectedProfileId || null, actualProfileId: value.profileId || null },
    )
  }
  const currentLease = assertActiveProfileLease(lease, {
    profileAuthorityRoot: profileAuthorityRoot || isolationRoot,
    profileId: expectedProfileId,
  })
  const checkpointLease = value.lease
  if (!checkpointLease || typeof checkpointLease !== 'object'
    || checkpointLease.schemaVersion !== OWNER_MODE_LEASE_SCHEMA_VERSION
    || checkpointLease.profileKeyHash !== currentLease.profileKeyHash
    || checkpointLease.leaseIdHash !== currentLease.leaseIdHash) {
    throw ownerModeError(
      'OWNER_MODE_CHECKPOINT_LEASE_MISMATCH',
      'Owner-mode checkpoint is not bound to the active application profile lease',
      { profileId: expectedProfileId },
    )
  }
  if (value.oldWriterBlocked !== true
    || value.compatibilityMode !== 'read-only'
    || value.inFlight !== 0) {
    throw ownerModeError(
      'OWNER_MODE_CHECKPOINT_INVALID',
      'Owner-mode checkpoint does not prove the old writer is blocked and drained',
    )
  }
  const repository = normalizedOwnerRepository(value.repository)
  if (value.authorityMode !== OWNER_MODE_AUTHORITY
    || typeof value.committedAt !== 'string' || !Number.isFinite(Date.parse(value.committedAt))
    || typeof value.checksum !== 'string' || value.checksum !== ownerModeCheckpointChecksum(value)) {
    throw ownerModeError(
      'OWNER_MODE_CHECKPOINT_CORRUPT',
      'Owner-mode checkpoint checksum or authority evidence is invalid',
    )
  }
  return Object.freeze({
    schemaVersion: OWNER_MODE_CHECKPOINT_SCHEMA_VERSION,
    profileId: value.profileId,
    domain: value.domain,
    lease: Object.freeze({
      schemaVersion: OWNER_MODE_LEASE_SCHEMA_VERSION,
      profileKeyHash: checkpointLease.profileKeyHash,
      leaseIdHash: checkpointLease.leaseIdHash,
    }),
    oldWriterBlocked: true,
    compatibilityMode: 'read-only',
    inFlight: 0,
    repository: Object.freeze(repository),
    authorityMode: OWNER_MODE_AUTHORITY,
    committedAt: value.committedAt,
    checksum: value.checksum,
  })
}

function validateOwnerModeFreeze(value, { profileAuthorityRoot, isolationRoot, profileId, lease, domain } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ownerModeError('OWNER_MODE_FREEZE_CORRUPT', 'Owner-mode freeze marker is not an object')
  }
  if (value.schemaVersion !== OWNER_MODE_CHECKPOINT_SCHEMA_VERSION) {
    throw ownerModeError('OWNER_MODE_FREEZE_UNKNOWN_SCHEMA', 'Owner-mode freeze marker schema is unsupported')
  }
  const expectedDomain = ownerModeDomain(domain || value.domain)
  if (value.domain !== expectedDomain) {
    throw ownerModeError('OWNER_MODE_FREEZE_INVALID', 'Owner-mode freeze marker domain does not match the requested domain')
  }
  const expectedProfileId = String(profileId || '').trim()
  if (!expectedProfileId || value.profileId !== expectedProfileId) {
    throw ownerModeError('OWNER_MODE_FREEZE_PROFILE_MISMATCH', 'Owner-mode freeze marker belongs to a different profile')
  }
  const currentLease = assertActiveProfileLease(lease, {
    profileAuthorityRoot: profileAuthorityRoot || isolationRoot,
    profileId: expectedProfileId,
  })
  const markerLease = value.lease
  if (!markerLease || typeof markerLease !== 'object'
    || markerLease.schemaVersion !== OWNER_MODE_LEASE_SCHEMA_VERSION
    || markerLease.profileKeyHash !== currentLease.profileKeyHash
    || markerLease.leaseIdHash !== currentLease.leaseIdHash) {
    throw ownerModeError('OWNER_MODE_FREEZE_LEASE_MISMATCH', 'Owner-mode freeze marker is not bound to this profile lease')
  }
  if (value.status !== 'frozen'
    || typeof value.frozenAt !== 'string' || !Number.isFinite(Date.parse(value.frozenAt))
    || typeof value.checksum !== 'string' || value.checksum !== ownerModeFreezeChecksum(value)) {
    throw ownerModeError('OWNER_MODE_FREEZE_CORRUPT', 'Owner-mode freeze marker evidence is invalid')
  }
  return Object.freeze({
    schemaVersion: OWNER_MODE_CHECKPOINT_SCHEMA_VERSION,
    profileId: value.profileId,
    domain: value.domain,
    lease: Object.freeze({
      schemaVersion: OWNER_MODE_LEASE_SCHEMA_VERSION,
      profileKeyHash: markerLease.profileKeyHash,
      leaseIdHash: markerLease.leaseIdHash,
    }),
    status: 'frozen',
    frozenAt: value.frozenAt,
    checksum: value.checksum,
  })
}

async function withOwnerProfileLease(options, operation) {
  if (typeof operation !== 'function') {
    throw ownerModeError('OWNER_MODE_PROFILE_LEASE_CONFIGURATION', 'Owner-mode profile lease requires an operation')
  }
  if (!options?.isolationRoot || !options?.profileDir) {
    throw ownerModeError(
      'OWNER_MODE_PROFILE_LEASE_CONFIGURATION',
      'Owner-mode profile lease requires isolationRoot and profileDir',
    )
  }
  const validatedLayout = await validateIsolationLayout({
    isolationRoot: options.isolationRoot,
    paths: { profileDir: options.profileDir },
    forbiddenRoots: options.forbiddenRoots,
  })
  const authorityLayout = await validateProfileAuthorityLayout(options, validatedLayout)
  const isolationRoot = validatedLayout.isolationRoot
  const profileDir = validatedLayout.paths.profileDir
  const profileAuthorityIsolationRoot = authorityLayout.profileAuthorityIsolationRoot
  const profileAuthorityRoot = authorityLayout.profileAuthorityRoot
  const profileId = resolveProfileId(options, profileDir)
  return withApplicationPathMutex(profileAuthorityRoot, async (lease) => {
    const evidence = assertActiveProfileLease(lease, { profileAuthorityRoot, profileId })
    return operation(Object.freeze({
      isolationRoot,
      profileDir,
      profileId,
      profileAuthorityIsolationRoot,
      profileAuthorityRoot,
      lease,
      profileLease: evidence,
    }))
  })
}

async function readOwnerModeCheckpointUnlocked({ profileAuthorityRoot, profileDir, isolationRoot, profileId, lease, domain }) {
  const checkpointDomain = ownerModeDomain(domain)
  const authorityRoot = profileAuthorityRoot || profileDir
  const filePath = ownerModeCheckpointPath(authorityRoot, checkpointDomain)
  if (!await pathExists(filePath)) return null
  await assertPathContainedBeforeWrite(authorityRoot, filePath)
  const value = await readJsonIfPresent(filePath, 'OWNER_MODE_CHECKPOINT_CORRUPT')
  if (!value) return null
  return validateOwnerModeCheckpoint(value, {
    profileAuthorityRoot: authorityRoot,
    isolationRoot,
    profileId,
    lease,
    domain: checkpointDomain,
  })
}

async function writeOwnerModeCheckpointUnlocked(context, options) {
  const { isolationRoot, profileAuthorityRoot, profileId, lease, profileLease } = context
  if (options.oldWriterBlocked !== true
    || options.compatibilityMode !== 'read-only'
    || options.inFlight !== 0) {
    throw ownerModeError(
      'OWNER_MODE_CHECKPOINT_PRECONDITION_FAILED',
      'Owner-mode checkpoint requires blocked old writer, read-only compatibility, and zero in-flight mutations',
    )
  }
  const domain = ownerModeDomain(options.domain)
  const repository = normalizedOwnerRepository(options.repository)
  const core = {
    schemaVersion: OWNER_MODE_CHECKPOINT_SCHEMA_VERSION,
    profileId,
    domain,
    lease: {
      schemaVersion: OWNER_MODE_LEASE_SCHEMA_VERSION,
      profileKeyHash: profileLease.profileKeyHash,
      leaseIdHash: profileLease.leaseIdHash,
    },
    oldWriterBlocked: true,
    compatibilityMode: 'read-only',
    inFlight: 0,
    repository,
    authorityMode: OWNER_MODE_AUTHORITY,
    committedAt: typeof options.committedAt === 'string' && options.committedAt
      ? options.committedAt
      : new Date().toISOString(),
  }
  const candidate = { ...core, checksum: ownerModeCheckpointChecksum(core) }
  const filePath = ownerModeCheckpointPath(profileAuthorityRoot, domain)
  if (await pathExists(filePath)) {
    await assertPathContainedBeforeWrite(profileAuthorityRoot, filePath)
    const existing = await readJsonIfPresent(filePath, 'OWNER_MODE_CHECKPOINT_CORRUPT')
    const verified = validateOwnerModeCheckpoint(existing, {
      profileAuthorityRoot,
      isolationRoot,
      profileId,
      lease,
      domain,
    })
    if (canonicalJson(verified) === canonicalJson(candidate)) {
      return Object.freeze({ created: false, status: 'existing', path: filePath, checkpoint: verified })
    }
    throw ownerModeError(
      'OWNER_MODE_CHECKPOINT_EXISTS',
      `Owner-mode checkpoint already exists for ${domain}`,
      { domain, path: filePath },
    )
  }
  await writeJsonAtomic(filePath, candidate, { containmentRoot: profileAuthorityRoot })
  await assertPathContainedBeforeWrite(profileAuthorityRoot, filePath)
  const reread = await readJsonIfPresent(filePath, 'OWNER_MODE_CHECKPOINT_CORRUPT')
  const checkpoint = validateOwnerModeCheckpoint(reread, {
    profileAuthorityRoot,
    isolationRoot,
    profileId,
    lease,
    domain,
  })
  return Object.freeze({ created: true, status: 'created', path: filePath, checkpoint })
}

async function readOwnerModeFreezeUnlocked({ profileAuthorityRoot, profileDir, isolationRoot, profileId, lease, domain }) {
  const freezeDomain = ownerModeDomain(domain)
  const authorityRoot = profileAuthorityRoot || profileDir
  const filePath = ownerModeFreezePath(authorityRoot, freezeDomain)
  if (!await pathExists(filePath)) return null
  await assertPathContainedBeforeWrite(authorityRoot, filePath)
  const value = await readJsonIfPresent(filePath, 'OWNER_MODE_FREEZE_CORRUPT')
  if (!value) return null
  return validateOwnerModeFreeze(value, {
    profileAuthorityRoot: authorityRoot,
    isolationRoot,
    profileId,
    lease,
    domain: freezeDomain,
  })
}

async function writeOwnerModeFreezeUnlocked(context, options) {
  const { isolationRoot, profileAuthorityRoot, profileId, lease, profileLease } = context
  const domain = ownerModeDomain(options.domain)
  const core = {
    schemaVersion: OWNER_MODE_CHECKPOINT_SCHEMA_VERSION,
    profileId,
    domain,
    lease: {
      schemaVersion: OWNER_MODE_LEASE_SCHEMA_VERSION,
      profileKeyHash: profileLease.profileKeyHash,
      leaseIdHash: profileLease.leaseIdHash,
    },
    status: 'frozen',
    frozenAt: typeof options.frozenAt === 'string' && options.frozenAt
      ? options.frozenAt
      : new Date().toISOString(),
  }
  const filePath = ownerModeFreezePath(profileAuthorityRoot, domain)
  if (await pathExists(filePath)) {
    await assertPathContainedBeforeWrite(profileAuthorityRoot, filePath)
    const existing = await readJsonIfPresent(filePath, 'OWNER_MODE_FREEZE_CORRUPT')
    const freeze = validateOwnerModeFreeze(existing, {
      profileAuthorityRoot,
      isolationRoot,
      profileId,
      lease,
      domain,
    })
    return Object.freeze({ created: false, status: 'existing', freeze })
  }
  const candidate = { ...core, checksum: ownerModeFreezeChecksum(core) }
  await writeJsonAtomic(filePath, candidate, { containmentRoot: profileAuthorityRoot })
  await assertPathContainedBeforeWrite(profileAuthorityRoot, filePath)
  const reread = await readJsonIfPresent(filePath, 'OWNER_MODE_FREEZE_CORRUPT')
  const freeze = validateOwnerModeFreeze(reread, {
    profileAuthorityRoot,
    isolationRoot,
    profileId,
    lease,
    domain,
  })
  return Object.freeze({ created: true, status: 'created', freeze })
}

async function clearOwnerModeFreezeUnlocked(context, options) {
  const { isolationRoot, profileAuthorityRoot, profileId, lease } = context
  const domain = ownerModeDomain(options.domain)
  const filePath = ownerModeFreezePath(profileAuthorityRoot, domain)
  if (!await pathExists(filePath)) return Object.freeze({ removed: false, status: 'absent', domain })
  const freeze = await readOwnerModeFreezeUnlocked({ ...context, domain })
  await assertPathContainedBeforeWrite(profileAuthorityRoot, filePath)
  await rm(filePath, { force: true })
  return Object.freeze({ removed: true, status: 'cleared', domain, freeze })
}

async function revokeOwnerModeCheckpointUnlocked(context, options) {
  const { profileAuthorityRoot } = context
  const domain = ownerModeDomain(options.domain)
  const filePath = ownerModeCheckpointPath(profileAuthorityRoot, domain)
  if (!await pathExists(filePath)) return Object.freeze({ removed: false, status: 'absent', domain })
  const checkpoint = await readOwnerModeCheckpointUnlocked({ ...context, domain })
  if (options.expectedRevision !== undefined
    && checkpoint.repository.revision !== options.expectedRevision) {
    throw ownerModeError(
      'OWNER_MODE_CHECKPOINT_MISMATCH',
      'Owner-mode checkpoint no longer matches the cutover being rolled back',
      { domain },
    )
  }
  if (options.expectedRevisionEvidence !== undefined
    && checkpoint.repository.revisionEvidence !== options.expectedRevisionEvidence) {
    throw ownerModeError(
      'OWNER_MODE_CHECKPOINT_MISMATCH',
      'Owner-mode checkpoint evidence no longer matches the cutover being rolled back',
      { domain },
    )
  }
  await assertPathContainedBeforeWrite(profileAuthorityRoot, filePath)
  await rm(filePath, { force: true })
  return Object.freeze({ removed: true, status: 'revoked', domain })
}

export async function withReadWebApplicationProfileLease(options = {}, operation) {
  return withOwnerProfileLease(options, operation)
}

function ownerPendingJournalIo() {
  return { assertPathContainedBeforeWrite, writeJsonAtomic }
}

export async function readOwnerPendingJournal(options = {}) {
  return withReadWebApplicationProfileLease(options, ({ profileAuthorityRoot }) => (
    readOwnerPendingJournalUnlocked(profileAuthorityRoot, ownerPendingJournalIo())
  ))
}

export async function writeOwnerPendingJournal(options = {}) {
  return withReadWebApplicationProfileLease(options, ({ profileAuthorityRoot }) => (
    writeOwnerPendingJournalUnlocked(
      profileAuthorityRoot,
      options.journal,
      options.faults,
      ownerPendingJournalIo(),
    )
  ))
}

export async function recoverOwnerPendingJournal(options = {}) {
  return withReadWebApplicationProfileLease(options, (context) => (
    recoverOwnerPendingJournalUnlocked(context, options, ownerPendingJournalIo())
  ))
}

export async function runOwnerPendingJournalOperation(options = {}) {
  return withReadWebApplicationProfileLease(options, (context) => (
    runOwnerPendingJournalOperationUnlocked(context, options, ownerPendingJournalIo())
  ))
}

export async function writeOwnerModeCheckpoint(options = {}) {
  return withOwnerProfileLease(options, (context) => writeOwnerModeCheckpointUnlocked(context, options))
}

export async function writeOwnerModeFreeze(options = {}) {
  return withOwnerProfileLease(options, (context) => writeOwnerModeFreezeUnlocked(context, options))
}

export async function clearOwnerModeFreeze(options = {}) {
  return withOwnerProfileLease(options, (context) => clearOwnerModeFreezeUnlocked(context, options))
}

export async function commitOwnerModeCheckpoint(options = {}) {
  return writeOwnerModeCheckpoint(options)
}

export async function runOwnerModeMigrationCutover(options = {}) {
  return commitOwnerModeCheckpoint(options)
}

export async function readOwnerModeCheckpoint(options = {}) {
  return withOwnerProfileLease(options, async (context) => {
    const checkpoint = await readOwnerModeCheckpointUnlocked({ ...context, domain: options.domain })
    return checkpoint ? Object.freeze(clone(checkpoint)) : null
  })
}

export async function readOwnerModeFreeze(options = {}) {
  return withOwnerProfileLease(options, async (context) => {
    const freeze = await readOwnerModeFreezeUnlocked({ ...context, domain: options.domain })
    return freeze ? Object.freeze(clone(freeze)) : null
  })
}

export async function revokeOwnerModeCheckpoint(options = {}) {
  return withOwnerProfileLease(options, (context) => revokeOwnerModeCheckpointUnlocked(context, options))
}

async function inspectOwnerModeCheckpointsUnlocked(context) {
  const domains = {}
  for (const domain of OWNER_PROFILE_DOMAINS) {
    try {
      const checkpoint = await readOwnerModeCheckpointUnlocked({ ...context, domain })
      const freeze = await readOwnerModeFreezeUnlocked({ ...context, domain })
      domains[domain] = checkpoint
        ? { status: 'authoritative', revision: checkpoint.repository.revision, checksum: checkpoint.checksum, frozen: Boolean(freeze) }
        : freeze
          ? { status: 'frozen', frozen: true }
          : { status: 'pre-cutover', frozen: false }
    } catch (error) {
      domains[domain] = { status: 'invalid', code: error.code || 'OWNER_MODE_CHECKPOINT_INVALID' }
    }
  }
  const authoritativeDomains = OWNER_PROFILE_DOMAINS.filter((domain) => domains[domain].status === 'authoritative')
  const frozenDomains = OWNER_PROFILE_DOMAINS.filter((domain) => domains[domain].frozen === true)
  const invalidDomains = OWNER_PROFILE_DOMAINS.filter((domain) => domains[domain].status === 'invalid')
  return {
    schemaVersion: OWNER_MODE_CHECKPOINT_SCHEMA_VERSION,
    status: invalidDomains.length ? 'invalid' : authoritativeDomains.length ? 'authoritative' : 'pre-cutover',
    profileId: context.profileId,
    profileLease: context.profileLease,
    authoritativeDomains,
    frozenDomains,
    invalidDomains,
    domains,
  }
}

export async function inspectOwnerModeCheckpoints(options = {}) {
  return withOwnerProfileLease(options, (context) => inspectOwnerModeCheckpointsUnlocked(context))
}

export async function readOwnerCanonicalDomain(options = {}) {
  if (!options.repository || typeof options.repository !== 'object'
    || typeof options.repository.read !== 'function') {
    throw ownerModeError(
      'OWNER_MODE_REPOSITORY_UNAVAILABLE',
      'Owner read requires a Host-managed repository reader',
    )
  }
  return withOwnerProfileLease(options, async (context) => {
    const checkpoint = await readOwnerModeCheckpointUnlocked({ ...context, domain: options.domain })
    if (!checkpoint) {
      throw ownerModeError(
        'OWNER_MODE_AUTHORITY_NOT_READY',
        `Owner-mode authority is not enabled for ${options.domain}`,
        { domain: options.domain },
      )
    }
    if (options.repository.type !== 'host-managed'
      || String(options.repository.identity || '').trim() !== checkpoint.repository.identity) {
      throw ownerModeError(
        'OWNER_MODE_REPOSITORY_MISMATCH',
        `Owner read repository does not match the ${options.domain} checkpoint`,
        { domain: options.domain },
      )
    }
    return options.repository.read({
      domain: checkpoint.domain,
      checkpoint: clone(checkpoint),
      profileLease: clone(context.profileLease),
    })
  })
}

function stateChecksum(value) {
  const core = {
    schemaVersion: value.schemaVersion,
    revision: value.revision,
    domains: value.domains,
  }
  return `sha256:${createHash('sha256').update(canonicalJson(core)).digest('hex')}`
}

function createStateEnvelope(domains, revision = 0) {
  const value = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    revision,
    domains: clone(domains),
  }
  return { ...value, checksum: stateChecksum(value) }
}

function assertStateEnvelope(value, label = 'application state') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== PROFILE_SCHEMA_VERSION
    || !Number.isInteger(value.revision) || value.revision < 0
    || !value.domains || typeof value.domains !== 'object' || Array.isArray(value.domains)
    || typeof value.checksum !== 'string'
    || value.checksum !== stateChecksum(value)) {
    const error = new Error(`${label} has an invalid schema, revision, or checksum`)
    error.code = value?.schemaVersion !== PROFILE_SCHEMA_VERSION
      ? 'RESTORE_TARGET_UNKNOWN_SCHEMA'
      : 'RESTORE_TARGET_STATE_CHECKSUM_MISMATCH'
    throw error
  }
  return value
}

function emptyJournal() {
  const value = { schemaVersion: JOURNAL_SCHEMA_VERSION, revision: 0, entries: {} }
  return { ...value, checksum: journalChecksum(value) }
}

function journalChecksum(value) {
  const core = {
    schemaVersion: value.schemaVersion,
    revision: value.revision,
    entries: value.entries,
  }
  return `sha256:${createHash('sha256').update(canonicalJson(core)).digest('hex')}`
}

function assertJournalEnvelope(value) {
  if (!value) return emptyJournal()
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== JOURNAL_SCHEMA_VERSION
    || !Number.isInteger(value.revision) || value.revision < 0
    || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)
    || typeof value.checksum !== 'string'
    || value.checksum !== journalChecksum(value)) {
    const error = new Error('Isolated restore journal schema or checksum is invalid')
    error.code = 'RESTORE_JOURNAL_CORRUPT'
    throw error
  }
  return value
}

const JOURNAL_STATUS_RANK = Object.freeze({
  started: 1,
  applying: 2,
  committing: 3,
  committed: 4,
  completed: 5,
  'rolled-back': 6,
  'rollback-failed': 7,
})

function mergeJournalEntry(previous, incoming) {
  if (!previous) return clone(incoming)
  const previousStatus = String(previous.status || '')
  const incomingStatus = String(incoming.status || '')
  if (previousStatus === 'completed' && incomingStatus !== 'completed') return clone(previous)
  if (previousStatus === 'rollback-failed' && incomingStatus !== 'completed') return clone(previous)
  if (previousStatus === 'rolled-back' && incomingStatus === 'started') return clone(incoming)
  const previousRank = JOURNAL_STATUS_RANK[previousStatus] || 0
  const incomingRank = JOURNAL_STATUS_RANK[incomingStatus] || 0
  const winner = incomingRank >= previousRank ? incoming : previous
  return {
    ...clone(previous),
    ...(incomingRank >= previousRank ? clone(incoming) : {}),
    appliedDomains: [...new Set([
      ...(Array.isArray(previous.appliedDomains) ? previous.appliedDomains : []),
      ...(Array.isArray(incoming.appliedDomains) ? incoming.appliedDomains : []),
    ])],
    status: winner.status,
  }
}

async function readJsonIfPresent(filePath, code = 'PROFILE_CORRUPT') {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    const wrapped = new Error(`Isolated backup state is not valid JSON: ${path.basename(filePath)}`)
    wrapped.code = code
    wrapped.cause = error
    throw wrapped
  }
}

function assertProfileState(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== PROFILE_SCHEMA_VERSION
    || !value.localStorage || typeof value.localStorage !== 'object'
    || !Array.isArray(value.indexedDbRows)) {
    const error = new Error(`${label} has an unsupported profile schema`)
    error.code = 'PROFILE_UNKNOWN_SCHEMA'
    throw error
  }
  return value
}

class MapStorage {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values).map(([key, value]) => [String(key), String(value)]))
    this.durableRestoreStore = true
  }

  get length() { return this.values.size }

  key(index) { return [...this.values.keys()][index] ?? null }

  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }

  setItem(key, value) { this.values.set(String(key), String(value)) }

  removeItem(key) { this.values.delete(String(key)) }

  toJSON() { return Object.fromEntries(this.values.entries()) }
}

export async function writeIsolatedBrowserProfile(profileDir, profile) {
  const state = assertProfileState({
    schemaVersion: PROFILE_SCHEMA_VERSION,
    localStorage: profile?.localStorage || {},
    indexedDbRows: profile?.indexedDbRows || [],
  }, 'browser profile')
  await withPathMutex(profileDir, async () => {
    await writeJsonAtomic(path.join(profileDir, BROWSER_PROFILE_FILE), state)
  })
  return state
}

async function assertExistingBrowserProfilePathIsContained(profileDir, filePath) {
  await assertPathContainedBeforeWrite(profileDir, filePath)
}

export async function initializeIsolatedBrowserProfileIfMissing({
  isolationRoot,
  profileDir,
  forbiddenRoots,
} = {}) {
  const validatedLayout = await validateIsolationLayout({
    isolationRoot,
    paths: { profileDir },
    forbiddenRoots,
  })
  const canonicalIsolationRoot = validatedLayout.isolationRoot
  const canonicalProfileDir = validatedLayout.paths.profileDir
  const filePath = path.join(canonicalProfileDir, BROWSER_PROFILE_FILE)

  return withApplicationPathMutex(canonicalIsolationRoot, async () => {
    if (await pathExists(filePath)) {
      await assertExistingBrowserProfilePathIsContained(canonicalProfileDir, filePath)
      return Object.freeze({
        created: false,
        status: 'existing',
        profilePath: filePath,
        schemaVersion: PROFILE_SCHEMA_VERSION,
      })
    }

    let entries
    try {
      entries = await readdir(canonicalProfileDir)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        entries = []
      } else {
        throw error
      }
    }
    if (entries.length > 0) {
      const initializationError = new Error(
        'Cannot initialize a browser profile that already contains candidate state',
      )
      initializationError.code = 'BACKUP_PROFILE_INITIALIZATION_NOT_EMPTY'
      initializationError.details = {
        profileDir: canonicalProfileDir,
        entryCount: entries.length,
      }
      throw initializationError
    }

    await writeIsolatedBrowserProfile(canonicalProfileDir, {
      localStorage: {},
      indexedDbRows: [],
    })
    return Object.freeze({
      created: true,
      status: 'initialized-empty-candidate',
      profilePath: filePath,
      schemaVersion: PROFILE_SCHEMA_VERSION,
    })
  })
}

async function openBrowserProfile(profileDir) {
  const filePath = path.join(profileDir, BROWSER_PROFILE_FILE)
  const profilePresent = await pathExists(filePath)
  const state = assertProfileState(
    await readJsonIfPresent(filePath, 'PROFILE_CORRUPT') || {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      localStorage: {},
      indexedDbRows: [],
    },
    'browser profile',
  )
  const storage = new MapStorage(state.localStorage)
  const persistProfile = async () => {
    state.localStorage = storage.toJSON()
    await writeIsolatedBrowserProfile(profileDir, state)
  }
  storage.flush = persistProfile
  const persistence = {
    async getAllRows() { return clone(state.indexedDbRows) },
    async replaceRows({ rows = [], deleteIds = [], allowId = () => true, expectedRevision, guardId } = {}) {
      if (Number.isInteger(expectedRevision)) {
        const guarded = typeof guardId === 'string' && guardId
          ? state.indexedDbRows.find((row) => row?.id === guardId)
          : null
        const actualRevision = guarded
          ? (guarded.revision ?? null)
          : state.indexedDbRows
            .filter((row) => allowId(row?.id, row))
            .reduce((maximum, row) => (
              Number.isInteger(row?.revision) && row.revision >= 0
                ? Math.max(maximum, row.revision)
                : maximum
            ), 0)
        if (actualRevision !== expectedRevision) {
          const error = new Error('isolated browser profile restore revision conflict')
          error.code = 'RESTORE_REVISION_CONFLICT'
          error.expectedRevision = expectedRevision
          error.currentRevision = actualRevision
          throw error
        }
      }
      const nextRows = state.indexedDbRows.filter((row) => !deleteIds.includes(row?.id))
      for (const row of rows) {
        if (!allowId(row?.id, row)) {
          const error = new Error(`isolated browser profile restore row is outside its domain: ${row?.id}`)
          error.code = 'RESTORE_UNKNOWN_KEY'
          throw error
        }
        const index = nextRows.findIndex((candidate) => candidate?.id === row.id)
        if (index >= 0) nextRows[index] = clone(row)
        else nextRows.push(clone(row))
      }
      state.indexedDbRows = nextRows
      await persistProfile()
      return clone(rows)
    },
  }
  return { state, storage, persistence, filePath, profilePresent }
}

function runPythonBackup({ pythonCommand, stateDir, outputDir }) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonCommand, [
      '-m',
      'youtube_workflow.application_backup',
      '--state-dir',
      path.resolve(stateDir),
      '--output-dir',
      path.resolve(outputDir),
    ], {
      cwd: workflowRoot,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => reject(error))
    child.once('exit', (code) => {
      if (code !== 0) {
        let parsedError = null
        let details = {}
        try {
          const parsed = JSON.parse(stderr.trim())
          if (parsed && typeof parsed === 'object') {
            parsedError = typeof parsed.error === 'string' ? parsed.error : null
            details = parsed.details || {}
          }
        } catch { /* Preserve the bridge error when stderr is not structured JSON. */ }
        const error = new Error(`Python durable backup bridge failed: ${stderr.trim() || `exit ${code}`}`)
        error.code = parsedError || stderr.match(/([A-Z][A-Z0-9_]+):/)?.[1] || 'BACKUP_PYTHON_BRIDGE_FAILED'
        error.details = details
        reject(error)
        return
      }
      try {
        const value = JSON.parse(stdout)
        if (!value || typeof value !== 'object' || !value['marks-activity'] || !value.workflow) {
          const error = new Error('Python durable backup bridge omitted a required domain')
          error.code = 'BACKUP_PYTHON_DOMAIN_MISSING'
          reject(error)
          return
        }
        resolve(value)
      } catch (error) {
        error.code = 'BACKUP_PYTHON_BRIDGE_INVALID_JSON'
        reject(error)
      }
    })
  })
}

async function runPythonRestore({ pythonCommand, stateDir, outputDir, domain, snapshot, expectedRevision }) {
  const inputPath = path.join(path.resolve(outputDir), `.read-web-restore-${domain}-${randomUUID()}.json`)
  await mkdir(path.dirname(inputPath), { recursive: true })
  await writeFile(inputPath, `${JSON.stringify(snapshot)}\n`, 'utf8')
  try {
    return await new Promise((resolve, reject) => {
      const args = [
        '-m',
        'youtube_workflow.application_backup',
        '--state-dir',
        path.resolve(stateDir),
        '--output-dir',
        path.resolve(outputDir),
        '--restore-domain',
        domain,
        '--restore-input',
        inputPath,
      ]
      if (Number.isInteger(expectedRevision)) args.push('--expected-revision', String(expectedRevision))
      const child = spawn(pythonCommand, args, {
        cwd: workflowRoot,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.once('error', (error) => reject(error))
      child.once('exit', (code) => {
        if (code !== 0) {
          const error = new Error(`Python durable restore bridge failed: ${stderr.trim() || `exit ${code}`}`)
          error.code = stderr.match(/([A-Z][A-Z0-9_]+):/)?.[1] || 'RESTORE_PYTHON_BRIDGE_FAILED'
          reject(error)
          return
        }
        try { resolve(JSON.parse(stdout)) } catch (error) {
          error.code = 'RESTORE_PYTHON_BRIDGE_INVALID_JSON'
          reject(error)
        }
      })
    })
  } finally {
    await rm(inputPath, { force: true }).catch(() => {})
  }
}

function createPythonDomainAdapters(options) {
  const pythonCommand = options.pythonCommand || process.env.READ_WEB_PYTHON || process.env.PYTHON || 'python'
  let batchPromise = null
  async function collect(key) {
    if (!batchPromise) {
      const currentBatch = runPythonBackup({
        pythonCommand,
        stateDir: options.stateDir,
        outputDir: options.outputDir,
      })
      batchPromise = currentBatch
      queueMicrotask(() => {
        if (batchPromise === currentBatch) batchPromise = null
      })
    }
    const value = await batchPromise
    return clone(value[key])
  }
  return {
    'marks-activity': {
      key: 'marks-activity',
      schemaVersion: 1,
      adapterVersion: 1,
      supportedSchemaVersions: [1],
      collect: () => collect('marks-activity'),
      async restoreRecords(snapshot, context = {}) {
        return runPythonRestore({
          pythonCommand,
          stateDir: options.stateDir,
          outputDir: options.outputDir,
          domain: 'marks-activity',
          snapshot,
          expectedRevision: context.expectedRevision,
        })
      },
    },
    workflow: {
      key: 'workflow',
      schemaVersion: 1,
      adapterVersion: 1,
      supportedSchemaVersions: [1],
      collect: () => collect('workflow'),
      async restoreRecords(snapshot, context = {}) {
        return runPythonRestore({
          pythonCommand,
          stateDir: options.stateDir,
          outputDir: options.outputDir,
          domain: 'workflow',
          snapshot,
          expectedRevision: context.expectedRevision,
        })
      },
    },
  }
}

function emptyDomain(key) {
  return {
    schemaVersion: 1,
    adapterVersion: 1,
    revision: 0,
    records: [],
    references: [],
    mediaReferences: [],
  }
}

function normalizedInitialDomains(domains, requiredDomains) {
  return Object.fromEntries(requiredDomains.map((key) => [
    key,
    clone(domains?.[key] || emptyDomain(key)),
  ]))
}

function createFileDomainAdapters(stateRef, requiredDomains, statePath, profileDir) {
  return Object.fromEntries(requiredDomains.map((key) => [key, {
    key,
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      return withPathMutex(profileDir, async () => {
        const latest = assertStateEnvelope(
          await readJsonIfPresent(statePath, 'RESTORE_TARGET_STATE_CORRUPT'),
          'Isolated restore target state',
        )
        if (!latest.domains?.[key]) {
          const error = new Error(`Isolated restore target is missing domain ${key}`)
          error.code = 'RESTORE_TARGET_DOMAIN_MISSING'
          throw error
        }
        stateRef.value = latest
        return clone(latest.domains[key])
      })
    },
  }]))
}

function safeFilePart(value) {
  const raw = String(value || 'restore')
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 16)
  return `${safe || 'restore'}-${digest}`
}

export async function createIsolatedProfileRestoreTarget(options = {}) {
  if (typeof options.profileDir !== 'string' || !options.profileDir.trim()) {
    throw unsafeIsolationPath('Isolated restore target requires a profile directory')
  }
  const lexicalProfileDir = path.resolve(options.profileDir.trim())
  const validatedLayout = await validateIsolationLayout({
    isolationRoot: options.isolationRoot || path.dirname(lexicalProfileDir),
    paths: { profileDir: lexicalProfileDir },
    forbiddenRoots: options.forbiddenRoots,
  })
  const { applicationBackup, isolationIssuerToken } = await loadTrustedBackupModules()
  const requiredDomains = applicationBackup.APPLICATION_BACKUP_REQUIRED_DOMAINS
  const profileDir = validatedLayout.paths.profileDir
  const isolationLayout = Object.freeze({
    isolationRoot: validatedLayout.isolationRoot,
    paths: Object.freeze({ profileDir }),
  })
  const isolationCertificate = createTrustedIsolationCertificate({
    applicationBackup,
    isolationIssuerToken,
    validatedLayout: isolationLayout,
  })
  const statePath = path.join(profileDir, APPLICATION_STATE_FILE)
  const journalPath = path.join(profileDir, 'restore-journal.json')
  const rollbackDir = path.join(profileDir, 'rollback')
  const quarantineDir = path.join(profileDir, 'quarantine')
  const stateRef = {
    value: await withPathMutex(profileDir, async () => {
      const existing = await readJsonIfPresent(statePath, 'RESTORE_TARGET_STATE_CORRUPT')
      if (existing) return assertStateEnvelope(existing, 'Isolated restore target state')
      const initial = createStateEnvelope(normalizedInitialDomains(options.initialDomains, requiredDomains), 0)
      await writeJsonAtomic(statePath, initial)
      return initial
    }),
  }
  const faultState = { ...(options.faults || {}) }
  const operationStates = new WeakMap()
  const directOperationState = { faults: faultState, failed: false }
  const rollbackStoreSeparate = options.rollbackStoreSeparate === false ? false : true
  const configuredCapacityBytes = Number.isFinite(options.capacityBytes) ? options.capacityBytes : 256 * 1024 * 1024

  function operationStateFor(operation) {
    return operationStates.get(operation) || directOperationState
  }

  async function readStateUnlocked() {
    return assertStateEnvelope(
      await readJsonIfPresent(statePath, 'RESTORE_TARGET_STATE_CORRUPT'),
      'Isolated restore target state',
    )
  }

  async function readJournalUnlocked() {
    return assertJournalEnvelope(await readJsonIfPresent(journalPath, 'RESTORE_JOURNAL_CORRUPT'))
  }

  async function readRollbackUnlocked(restoreId) {
    const value = await readJsonIfPresent(
      path.join(rollbackDir, `${safeFilePart(restoreId)}.json`),
      'RESTORE_ROLLBACK_CORRUPT',
    )
    if (value?.rawState) assertStateEnvelope(value.rawState, 'Isolated rollback state')
    return value
  }

  const target = {
    isolated: true,
    isolationCertificate,
    isolationRoot: isolationLayout.isolationRoot,
    isolationLayout,
    profileDir,
    statePath,
    journalPath,
    rollbackDir,
    quarantineDir,
    rollbackStoreSeparate,
    restoreCapabilities: Object.freeze({
      atomicRevisionCommit: true,
      commitRevisionEvidence: true,
      verifyAppliedRevision: true,
    }),
    capacityBytes: configuredCapacityBytes,
    captureRestoreOperation() {
      const operation = {}
      operationStates.set(operation, {
        faults: freezeFaultPlan(faultState),
        failed: false,
      })
      return Object.freeze(operation)
    },
    adapters: createFileDomainAdapters(stateRef, requiredDomains, statePath, profileDir),
    async estimateCapacity({ requiredBytes }) {
      return { ok: configuredCapacityBytes >= requiredBytes, availableBytes: configuredCapacityBytes }
    },
    async readJournal({ restoreId }) {
      return withPathMutex(profileDir, async () => clone((await readJournalUnlocked()).entries[restoreId] || null))
    },
    async writeJournal(entry) {
      if (!entry?.restoreId) {
        const error = new Error('Restore journal entries require restoreId')
        error.code = 'RESTORE_JOURNAL_INVALID'
        throw error
      }
      return withPathMutex(profileDir, async () => {
        const value = await readJournalUnlocked()
        const entries = {
          ...value.entries,
          [entry.restoreId]: mergeJournalEntry(value.entries[entry.restoreId], entry),
        }
        const next = {
          schemaVersion: JOURNAL_SCHEMA_VERSION,
          revision: value.revision + 1,
          entries,
        }
        await writeJsonAtomic(journalPath, { ...next, checksum: journalChecksum(next) })
      })
    },
    rollbackStore: {
      async write(entry, context = {}) {
        const operationState = operationStateFor(context.operation)
        if (operationState.faults.rollbackBackup === 'fail') {
          const error = new Error('Fault injected while writing rollback backup')
          error.code = 'RESTORE_ROLLBACK_UNAVAILABLE'
          throw error
        }
        return withPathMutex(profileDir, async () => {
          const filePath = path.join(rollbackDir, `${safeFilePart(entry.restoreId)}.json`)
          const existing = await readJsonIfPresent(filePath, 'RESTORE_ROLLBACK_CORRUPT')
          if (existing) {
            if (existing.artifact?.artifactChecksum === entry.artifact?.artifactChecksum) return clone(existing)
            const error = new Error(`Rollback backup already exists for ${entry.restoreId}`)
            error.code = 'RESTORE_ID_CONFLICT'
            throw error
          }
          const current = await readStateUnlocked()
          const value = {
            schemaVersion: 1,
            ...entry,
            rawState: current,
            expectedBaseRevision: current.revision,
          }
          await writeJsonAtomic(filePath, value)
          return clone(value)
        })
      },
      async read({ restoreId }) {
        return withPathMutex(profileDir, () => readRollbackUnlocked(restoreId))
      },
    },
    quarantine: {
      async write(entry) {
        return withPathMutex(profileDir, async () => {
          const quarantineId = randomUUID()
          const core = {
            schemaVersion: 1,
            quarantineId,
            quarantinedAt: entry.quarantinedAt || new Date().toISOString(),
            ...entry,
          }
          const fileName = `${Date.now().toString(36)}-${safeFilePart(entry.restoreId)}-${safeFilePart(entry.kind)}-${quarantineId}.json`
          await writeJsonAtomic(path.join(quarantineDir, fileName), {
            ...core,
            checksum: `sha256:${createHash('sha256').update(canonicalJson(core)).digest('hex')}`,
          })
        })
      },
    },
    async beginTransaction({ restoreId, signal, expectedBaseRevision, operation }) {
      const operationState = operationStateFor(operation)
      const activeFaults = operationState.faults
      if (typeof activeFaults.beforeBeginTransaction === 'function') {
        await activeFaults.beforeBeginTransaction({ restoreId, signal, expectedBaseRevision })
      }
      const current = await withPathMutex(profileDir, readStateUnlocked)
      if (Number.isInteger(expectedBaseRevision) && current.revision !== expectedBaseRevision) {
        const error = new Error(`Restore base revision ${expectedBaseRevision} is stale; current is ${current.revision}`)
        error.code = 'RESTORE_REVISION_CONFLICT'
        error.baseRevision = expectedBaseRevision
        error.currentRevision = current.revision
        error.targetUnchanged = true
        throw error
      }
      const baseRevision = current.revision
      let staged = clone(current)
      let appliedCount = 0
      let rolledBack = false
      let committedRevision = null
      return {
        async applyDomain(key, domain) {
          if (signal?.aborted) {
            const error = new Error('Restore was interrupted while staging a domain')
            error.code = 'RESTORE_INTERRUPTED'
            throw error
          }
          if (!requiredDomains.includes(key)) {
            const error = new Error(`Restore attempted to stage unknown domain ${key}`)
            error.code = 'RESTORE_UNKNOWN_DOMAIN'
            throw error
          }
          staged.domains[key] = clone(domain)
          appliedCount += 1
          if (Number.isInteger(activeFaults.interruptAfterDomain)
            && appliedCount >= activeFaults.interruptAfterDomain) {
            const error = new Error(`Restore fault injected after ${appliedCount} domains`)
            error.code = 'RESTORE_INTERRUPTED'
            throw error
          }
        },
        async commit() {
          if (signal?.aborted) {
            const error = new Error('Restore was interrupted before commit')
            error.code = 'RESTORE_INTERRUPTED'
            throw error
          }
          const result = await withPathMutex(profileDir, async () => {
            const latest = await readStateUnlocked()
            if (latest.revision !== baseRevision) {
              const error = new Error(`Restore base revision ${baseRevision} is stale; current is ${latest.revision}`)
              error.code = 'RESTORE_REVISION_CONFLICT'
              error.baseRevision = baseRevision
              error.currentRevision = latest.revision
              error.targetUnchanged = true
              throw error
            }
            const next = createStateEnvelope(staged.domains, latest.revision + 1)
            await writeJsonAtomic(statePath, next)
            stateRef.value = next
            committedRevision = next.revision
            if (activeFaults.commit === 'write-then-block' && activeFaults.commitBarrierDir) {
              const barrierDir = path.resolve(activeFaults.commitBarrierDir)
              await mkdir(barrierDir, { recursive: true })
              await writeJsonAtomic(path.join(barrierDir, 'state-written.json'), {
                restoreId,
                revision: committedRevision,
              })
              const releasePath = path.join(barrierDir, 'release.json')
              while (!await pathExists(releasePath)) await delay(10)
            }
            if (activeFaults.commit === 'write-then-fail'
              || (activeFaults.commit === 'fail-once' && !operationState.failed)) {
              operationState.failed = true
              const error = new Error(`Restore commit fault injected for ${restoreId}`)
              error.code = 'RESTORE_COMMIT_FAILED'
              error.committedRevision = committedRevision
              throw error
            }
            return { revision: committedRevision, checksum: next.checksum }
          })
          if (typeof activeFaults.afterCommit === 'function') {
            await activeFaults.afterCommit({ restoreId, ...result })
          }
          return result
        },
        async rollback() {
          rolledBack = true
          staged = clone(current)
        },
        get rolledBack() { return rolledBack },
        get baseRevision() { return baseRevision },
        get committedRevision() { return committedRevision },
      }
    },
    async restoreSnapshot(artifact, context = {}) {
      return withPathMutex(profileDir, async () => {
        const current = await readStateUnlocked()
        if (Number.isInteger(context.expectedRevision) && current.revision !== context.expectedRevision) {
          const error = new Error(`Rollback expected revision ${context.expectedRevision}; current is ${current.revision}`)
          error.code = 'RESTORE_REVISION_CONFLICT'
          throw error
        }
        const rollback = context.restoreId ? await readRollbackUnlocked(context.restoreId) : null
        const domains = rollback?.rawState?.domains && String(context.reason || '').startsWith('restore-')
          ? rollback.rawState.domains
          : normalizedInitialDomains(artifact.domains, requiredDomains)
        const next = createStateEnvelope(domains, current.revision + 1)
        await writeJsonAtomic(statePath, next)
        stateRef.value = next
        return { revision: next.revision, checksum: next.checksum }
      })
    },
    async verifyApplied({ artifact }) {
      return withPathMutex(profileDir, async () => {
        const latest = await readStateUnlocked()
        for (const key of requiredDomains) {
          if (canonicalJson(latest.domains?.[key]) !== canonicalJson(artifact.domains[key])) {
            return { ok: false, reason: `domain-mismatch:${key}` }
          }
        }
        return { ok: true, revision: latest.revision, checksum: latest.checksum }
      })
    },
    async readState() {
      return withPathMutex(profileDir, async () => clone(await readStateUnlocked()))
    },
    setFaults(nextFaults = {}) {
      Object.keys(faultState).forEach((key) => { delete faultState[key] })
      Object.assign(faultState, nextFaults)
      directOperationState.failed = false
    },
  }
  if (options.enableMergeDomain === true) {
    target.mergeDomain = async (transaction, domainKey, domain, context = {}) => {
      if (!transaction || typeof transaction.applyDomain !== 'function') {
        const error = new Error('Merge restore transaction is unavailable')
        error.code = 'RESTORE_ATOMIC_UNAVAILABLE'
        throw error
      }
      return transaction.applyDomain(domainKey, domain, { decision: 'merge', restoreId: context.restoreId })
    }
  }
  registerTrustedRestoreTarget({ applicationBackup, isolationIssuerToken, target })
  return target
}

function ownerProfileError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

function ownerProfileChecksum(state) {
  return `sha256:${createHash('sha256').update(canonicalJson({
    schemaVersion: state?.schemaVersion ?? null,
    localStorage: state?.localStorage || {},
    indexedDbRows: Array.isArray(state?.indexedDbRows) ? state.indexedDbRows : [],
  })).digest('hex')}`
}

function ownerProfileRow(rows, { domain, key, schemaVersion, source, sourceKey = key }) {
  if (!domain || !key || schemaVersion === undefined || schemaVersion === null) {
    throw ownerProfileError(
      'OWNER_PROFILE_INVENTORY_INVALID',
      'Owner profile source row is missing domain, key, or schema version',
      { domain, key, sourceKey },
    )
  }
  rows.push({ domain, key: String(key), schemaVersion, source, sourceKey: String(sourceKey || key) })
}

function ownerProfileWorkflowKey(recordId) {
  if (recordId === 'config') return 'config.json'
  if (recordId.startsWith('jobs:')) return 'jobs.json'
  if (recordId.startsWith('items:')) return 'history.json'
  if (recordId.startsWith('reader-index:')) return 'reader-index.json'
  if (recordId.startsWith('output:')) return recordId
  return null
}

function ownerProfileMarksKey(recordId) {
  for (const filename of ['reader-marks.json', 'reader-activity.json', 'reader-marks-commit-journal.json']) {
    if (recordId.startsWith(`${filename}:`)) return `_workflow/${filename}`
  }
  return null
}

function assertOwnerProfileIndexedDbRows(state) {
  for (const row of state?.indexedDbRows || []) {
    const key = String(row?.id || '')
    const recognized = OWNER_PROFILE_READER_ROW_IDS.has(key)
      || key.startsWith('readerSessionQuarantine:')
      || key.startsWith('vocabulary.')
      || key === 'vocabulary-srs-pending-candidates'
      || key.startsWith('vocabulary-article-srs-settlement-progress:')
    if (!recognized) {
      throw ownerProfileError(
        'OWNER_PROFILE_UNCLAIMED_ROW',
        `IndexedDB profile row ${key || '[missing-id]'} is outside the registered application adapters`,
        { key },
      )
    }
    const sourceSchemaVersion = row?.schemaVersion ?? 1
    if (sourceSchemaVersion !== 1) {
      throw ownerProfileError(
        'OWNER_PROFILE_UNSUPPORTED_SCHEMA',
        `IndexedDB profile row ${key} uses an unsupported source schema`,
        { key, schemaVersion: sourceSchemaVersion },
      )
    }
  }
}

function assertOwnerProfileWorkflowReceipt(key, rawValue) {
  let value
  try {
    value = JSON.parse(rawValue)
  } catch {
    throw ownerProfileError(
      'OWNER_PROFILE_UNSUPPORTED_SCHEMA',
      `Workflow receipt ${key} is not valid JSON`,
      { key },
    )
  }
  if (value && typeof value === 'object' && value.schemaVersion !== undefined && value.schemaVersion !== 1) {
    throw ownerProfileError(
      'OWNER_PROFILE_UNSUPPORTED_SCHEMA',
      `Workflow receipt ${key} uses an unsupported source schema`,
      { key, schemaVersion: value.schemaVersion },
    )
  }
}

function ownerProfileRowsFromArtifact(browser, artifact) {
  assertOwnerProfileIndexedDbRows(browser.state)
  const rows = []
  for (const [domain, snapshot] of Object.entries(artifact?.domains || {})) {
    for (const record of snapshot?.records || []) {
      const recordId = String(record?.id || '')
      if (!recordId) throw ownerProfileError('OWNER_PROFILE_INVENTORY_INVALID', `Backup record in ${domain} has no id`)
      if (domain === 'reader-session') {
        if (recordId.startsWith('reader-save-outbox:')) continue
        ownerProfileRow(rows, {
          domain,
          key: recordId,
          schemaVersion: record.schemaVersion,
          source: recordId.startsWith('readerSession')
            ? 'browser-profile.indexedDbRows'
            : 'browser-profile.indexedDbRows',
          sourceKey: recordId,
        })
        continue
      }
      if (domain === 'marks-activity') {
        const key = ownerProfileMarksKey(recordId)
        if (!key) throw ownerProfileError('OWNER_PROFILE_UNCLAIMED_ROW', `Marks/activity record ${recordId} is not registered`, { key: recordId })
        ownerProfileRow(rows, {
          domain,
          key,
          schemaVersion: record.schemaVersion,
          source: 'python.application_backup.marks-activity',
          sourceKey: recordId,
        })
        continue
      }
      if (domain === 'workflow') {
        const key = ownerProfileWorkflowKey(recordId)
        if (!key) throw ownerProfileError('OWNER_PROFILE_UNCLAIMED_ROW', `Workflow record ${recordId} is not registered`, { key: recordId })
        ownerProfileRow(rows, {
          domain,
          key,
          schemaVersion: record.schemaVersion,
          source: 'python.application_backup.workflow',
          sourceKey: recordId,
        })
        continue
      }
      ownerProfileRow(rows, {
        domain,
        key: recordId,
        schemaVersion: record.schemaVersion,
        source: domain === 'vocabulary-srs' || domain === 'reader-session'
          ? 'browser-profile.indexedDbRows'
          : 'browser-profile.localStorage',
        sourceKey: recordId,
      })
    }
    if (domain === 'workflow' && (snapshot?.mediaReferences || []).length) {
      ownerProfileRow(rows, {
        domain,
        key: 'mediaReferences[]',
        schemaVersion: 'identity-metadata-rebind',
        source: 'python.application_backup.workflow.mediaReferences',
      })
    }
  }

  const storage = browser.storage.toJSON()
  for (const [key, rawValue] of Object.entries(storage)) {
    if (key === 'read-web.reader-save-outbox.v1') {
      ownerProfileRow(rows, {
        domain: 'reader-session',
        key,
        schemaVersion: 'reader-save-outbox.v1',
        source: 'browser-profile.localStorage',
      })
      continue
    }
    if (key.startsWith('read-web.reader-save-outbox.v2.')) {
      ownerProfileRow(rows, {
        domain: 'reader-session',
        key,
        schemaVersion: 'reader-save-outbox.v2',
        source: 'browser-profile.localStorage',
      })
      continue
    }
    if (key.startsWith('read-web.reader-save-outbox-quarantine.v1.')) {
      ownerProfileRow(rows, {
        domain: 'reader-session',
        key,
        schemaVersion: 'reader-save-outbox-quarantine.v1',
        source: 'browser-profile.localStorage',
      })
      continue
    }
    if (OWNER_PROFILE_WORKFLOW_RECEIPT_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      assertOwnerProfileWorkflowReceipt(key, rawValue)
      ownerProfileRow(rows, {
        domain: 'workflow',
        key,
        schemaVersion: 1,
        source: 'browser-profile.localStorage',
      })
    }
  }
  return rows
}

function ownerProfileBindingEvidence({ adapters, restoreTarget, artifact }) {
  const targetCapabilities = restoreTarget?.restoreCapabilities || {}
  const applicationLeaseBound = targetCapabilities.applicationProfileLease === true
    && restoreTarget?.applicationLeaseRequired === true
    && typeof restoreTarget?.applicationLeaseSource === 'string'
    && restoreTarget.applicationLeaseSource.length > 0
  const transactionBound = targetCapabilities.atomicRevisionCommit === true
    && typeof restoreTarget?.beginTransaction === 'function'
  const revisionBound = !!artifact
    && OWNER_PROFILE_DOMAINS.every((domain) => {
      const snapshot = artifact.domains?.[domain]
      return snapshot && snapshot.revision !== undefined
        && typeof artifact.manifest?.domainChecksums?.[domain] === 'string'
    })
  const recoveryBound = typeof restoreTarget?.recoverPendingRestore === 'function'
    && typeof restoreTarget?.readJournal === 'function'
    && typeof restoreTarget?.rollbackStore?.read === 'function'
    && typeof restoreTarget?.rollbackStore?.write === 'function'
    && typeof restoreTarget?.quarantine?.write === 'function'
    && targetCapabilities.commitRevisionEvidence === true
    && targetCapabilities.verifyAppliedRevision === true
  const adapterRegistryBound = OWNER_PROFILE_DOMAINS.every((domain) => {
    const adapter = adapters?.[domain]
    const targetAdapter = restoreTarget?.adapters?.[domain]
    return !!adapter
      && adapter.key === domain
      && typeof adapter.collect === 'function'
      && Array.isArray(adapter.supportedSchemaVersions)
      && adapter.supportedSchemaVersions.includes(adapter.schemaVersion)
      && !!targetAdapter
      && typeof targetAdapter.collect === 'function'
  })
  const verified = (bound) => ({
    bound,
    status: bound ? 'verified' : 'failed',
    source: 'read-web-production-backup.composition',
  })
  const domains = Object.fromEntries(OWNER_PROFILE_DOMAINS.map((domain) => {
    const adapter = adapters?.[domain]
    const targetAdapter = restoreTarget?.adapters?.[domain]
    const domainRevisionBound = revisionBound && artifact?.domains?.[domain]?.revision !== undefined
    return [domain, {
      backupAdapter: {
        ...verified(adapterRegistryBound && adapter?.key === domain && typeof adapter?.collect === 'function'),
        key: adapter?.key || null,
        schemaVersion: adapter?.schemaVersion ?? null,
        supportedSchemaVersions: Array.isArray(adapter?.supportedSchemaVersions)
          ? [...adapter.supportedSchemaVersions]
          : [],
      },
      revision: verified(domainRevisionBound),
      recovery: verified(recoveryBound && !!targetAdapter && typeof targetAdapter.collect === 'function'),
    }]
  }))
  return {
    backupAdapterRegistry: {
      ...verified(adapterRegistryBound),
      requiredDomains: [...OWNER_PROFILE_DOMAINS],
    },
    applicationLease: {
      ...verified(applicationLeaseBound),
      source: restoreTarget?.applicationLeaseSource || 'read-web-production-backup.composition',
    },
    transaction: verified(transactionBound),
    revision: verified(revisionBound),
    recovery: verified(recoveryBound),
    domains,
  }
}

async function createOwnerProfileEvidence({ browser, adapters, restoreTarget, service, pythonAdapters, startupRecovery, ownerPendingRecovery = { status: 'none', ready: true }, profileLease, profileLeaseMode, profileId, isolationRoot, profileAuthorityRoot }) {
  let artifact = null
  let collectionError = null
  let rows = []
  try {
    artifact = await service.createBackup({ now: () => 0 })
    rows = ownerProfileRowsFromArtifact(browser, artifact)
  } catch (error) {
    collectionError = error
  }
  const bindings = ownerProfileBindingEvidence({ adapters, restoreTarget, artifact })
  const allBindingsBound = [
    bindings.backupAdapterRegistry,
    bindings.applicationLease,
    bindings.transaction,
    bindings.revision,
    bindings.recovery,
    ...Object.values(bindings.domains).flatMap((binding) => [
      binding.backupAdapter,
      binding.revision,
      binding.recovery,
    ]),
  ].every((binding) => binding?.bound === true && binding?.status === 'verified')
  const inventoryPresent = browser.profilePresent === true
  const profileMode = process.env.READ_WEB_APPLICATION_PROFILE_MODE || 'explicit-isolated-profile'
  const currentProfileLease = profileLease
    ? profileLeaseEvidence(profileLease, { profileAuthorityRoot, isolationRoot, profileId })
    : null
  const ownerMode = profileLease
    ? await inspectOwnerModeCheckpointsUnlocked({
      profileDir: browser.filePath ? path.dirname(browser.filePath) : null,
      profileAuthorityRoot,
      isolationRoot,
      profileId,
      lease: profileLease,
      profileLease: currentProfileLease,
    })
    : {
      schemaVersion: OWNER_MODE_CHECKPOINT_SCHEMA_VERSION,
      status: 'not-ready',
      profileId,
      profileLease: null,
      authoritativeDomains: [],
      invalidDomains: [],
      reason: 'profile-authority-lease-busy',
    }
  const ready = inventoryPresent && !collectionError && allBindingsBound && Boolean(profileLease)
    && ownerMode.status !== 'invalid' && ownerPendingRecovery?.ready === true
  return {
    schemaVersion: OWNER_PROFILE_EVIDENCE_SCHEMA_VERSION,
    source: OWNER_PROFILE_EVIDENCE_SOURCE,
    ready,
    profileLease: currentProfileLease,
    profileLeaseMode,
    profileChecksum: ownerProfileChecksum(browser.state),
    inventory: {
      present: inventoryPresent,
      status: inventoryPresent ? 'verified' : 'missing',
      source: 'browser-profile.json + application_backup.py',
      profileMode,
      legacyBrowserData: 'not-read',
      indexedDbRowCount: Array.isArray(browser.state?.indexedDbRows) ? browser.state.indexedDbRows.length : 0,
      localStorageKeyCount: Object.keys(browser.storage.toJSON()).length,
      pythonSourceCount: Object.keys(pythonAdapters || {}).length,
    },
    collection: collectionError
      ? {
        status: 'failed',
        source: 'createReadWebApplicationBackupService.createBackup',
        errorCode: collectionError.code || 'OWNER_PROFILE_COLLECTION_FAILED',
      }
      : {
        status: 'verified',
        source: 'createReadWebApplicationBackupService.createBackup',
        artifactChecksum: artifact.artifactChecksum,
        domainChecksums: Object.fromEntries(OWNER_PROFILE_DOMAINS.map((domain) => [domain, artifact.manifest?.domainChecksums?.[domain] || null])),
        recordCounts: Object.fromEntries(OWNER_PROFILE_DOMAINS.map((domain) => [domain, artifact.domains[domain]?.records?.length || 0])),
      },
    rows,
    bindings,
    ownerMode,
    startupRecovery: startupRecovery || { status: 'none' },
    ownerPendingRecovery: ownerPendingRecovery || { status: 'not-run', ready: false },
  }
}

export async function createReadWebProductionBackupComposition(options = {}) {
  if (!options.profileDir || !options.pythonStateDir || !options.pythonOutputDir || !options.isolationRoot) {
    const error = new Error('Production backup composition requires isolated browser profile, Python state, and Python output directories')
    error.code = 'BACKUP_PRODUCTION_COMPOSITION_CONFIGURATION'
    throw error
  }
  const validatedLayout = await validateIsolationLayout({
    isolationRoot: options.isolationRoot,
    paths: {
      profileDir: options.profileDir,
      pythonStateDir: options.pythonStateDir,
      pythonOutputDir: options.pythonOutputDir,
    },
    forbiddenRoots: options.forbiddenRoots,
  })
  const isolationRoot = validatedLayout.isolationRoot
  const canonicalPaths = validatedLayout.paths
  const authorityLayout = await validateProfileAuthorityLayout(options, validatedLayout)
  const profileAuthorityIsolationRoot = authorityLayout.profileAuthorityIsolationRoot
  const profileAuthorityRoot = authorityLayout.profileAuthorityRoot
  const pythonCommand = options.pythonCommand || (await resolveSelectedPython({
    repoRoot,
    configPath: process.env.READ_WEB_RUNTIME_CONFIG || 'config/runtime.optimization.json',
  })).executable
  const profileId = resolveProfileId(options, canonicalPaths.profileDir)
  const buildComposition = async ({ profileLease = null, profileLeaseMode = PROFILE_LEASE_MODE_AUTHORITATIVE } = {}) => {
  const currentProfileLease = profileLease
    ? assertActiveProfileLease(profileLease, { profileAuthorityRoot, isolationRoot, profileId })
    : null
  const isolationLayout = Object.freeze({
    isolationRoot,
    paths: canonicalPaths,
  })
  const { applicationBackup, readWebBackup, isolationIssuerToken } = await loadTrustedBackupModules()
  const browser = await openBrowserProfile(canonicalPaths.profileDir)
  browser.storage.estimateCapacity = async ({ requiredBytes }) => {
    try {
      const fileSystem = await statfs(isolationRoot)
      const availableBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize)
      return Number.isFinite(availableBytes)
        ? { ok: availableBytes >= requiredBytes, availableBytes }
        : { ok: false, availableBytes: null }
    } catch {
      return { ok: false, availableBytes: null }
    }
  }
  const pythonAdapters = createPythonDomainAdapters({
    stateDir: canonicalPaths.pythonStateDir,
    outputDir: canonicalPaths.pythonOutputDir,
    pythonCommand,
  })
  const adapters = readWebBackup.createReadWebApplicationBackupAdapters({
    applicationPersistence: browser.persistence,
    storage: browser.storage,
    readerSaveOutboxQuarantineProtector: options.readerSaveOutboxQuarantineProtector,
    marksActivityAdapter: pythonAdapters['marks-activity'],
    workflowAdapter: pythonAdapters.workflow,
  })
  function createApplicationRestoreTarget(targetBrowser, targetPythonAdapters, targetAdapters, targetOptions = {}) {
    return readWebBackup.createReadWebApplicationRestoreTarget({
      isolationCertificate: createTrustedIsolationCertificate({
         applicationBackup,
         isolationIssuerToken,
         validatedLayout: isolationLayout,
       }),
      isolationLayout,
      applicationPersistence: targetBrowser.persistence,
      storage: targetBrowser.storage,
      backupAdapters: targetAdapters,
      readerSaveOutboxQuarantineProtector: targetOptions.readerSaveOutboxQuarantineProtector
        || options.readerSaveOutboxQuarantineProtector,
      restoreAdapters: {
        'marks-activity': targetPythonAdapters['marks-activity'],
        workflow: targetPythonAdapters.workflow,
      },
      storageKeyPrefix: targetOptions.storageKeyPrefix || 'isolated.',
      atomicRevisionCommit: true,
      applicationLeaseRequired: true,
      applicationLeaseSource: 'read-web-production-backup.application-profile-lease',
      withApplicationLock: (operation) => {
        if (!profileLease) {
          throw ownerModeError(
            'OWNER_MODE_PROFILE_LEASE_REQUIRED',
            'Restore and migration cutover require the stable profile authority lease',
            { profileId },
          )
        }
        return withApplicationPathMutex(profileAuthorityRoot, async (lease) => {
          assertActiveProfileLease(lease, { profileAuthorityRoot, isolationRoot, profileId })
          return withApplicationPathMutex(isolationRoot, () => operation())
        })
      },
      capacityBytes: targetOptions.capacityBytes,
      faults: targetOptions.faults,
      rollbackStore: targetOptions.rollbackStore,
      quarantine: targetOptions.quarantine,
      journalStore: targetOptions.journalStore,
      pendingStore: targetOptions.pendingStore,
      revisionStore: targetOptions.revisionStore,
      migrationAdapterAccess: targetOptions.migrationAdapterAccess === true,
      migrationAdapterSink: targetOptions.migrationAdapterSink,
    })
  }
  let migrationAdapters = null
  const restoreTarget = createApplicationRestoreTarget(browser, pythonAdapters, adapters, {
    capacityBytes: options.capacityBytes,
    faults: options.faults,
    rollbackStore: options.rollbackStore,
    quarantine: options.quarantine,
    journalStore: options.journalStore,
    pendingStore: options.pendingStore,
    revisionStore: options.revisionStore,
    migrationAdapterAccess: options.migrationAdapterAccess === true,
    migrationAdapterSink: (value) => { migrationAdapters = value },
  })
  registerTrustedRestoreTarget({ applicationBackup, isolationIssuerToken, target: restoreTarget })
  const ownerPendingOptions = {
    ...options,
    isolationRoot,
    profileDir: canonicalPaths.profileDir,
    profileId,
    adapters: options.ownerPendingJournalAdapters,
    ...(authorityLayout.explicit
      ? { profileAuthorityIsolationRoot, profileAuthorityRoot }
      : {}),
  }
  const ownerPendingRecovery = profileLease
    ? await recoverOwnerPendingJournal(ownerPendingOptions)
    : {
      status: 'not-run',
      ready: false,
      reason: 'profile-authority-lease-busy',
      journalRetained: true,
    }
  const startupRecovery = profileLease && ownerPendingRecovery.ready === true
    ? await restoreTarget.recoverPendingRestore()
    : {
      status: 'not-run',
      reason: ownerPendingRecovery.ready === false
        ? 'owner-pending-recovery-required'
        : 'profile-authority-lease-busy',
    }
  const service = readWebBackup.createReadWebApplicationBackupService({
    ...options,
    adapters,
    release: options.release || {
      applicationVersion: 'isolated-rehearsal',
      backendVersion: 'isolated-rehearsal',
      gitSha: 'isolated-rehearsal',
      releaseId: 'isolated-rehearsal',
      manifestSha: null,
    },
  })
  const ownerProfileEvidence = await createOwnerProfileEvidence({
    browser,
    adapters,
    restoreTarget,
    ...(migrationAdapters ? { migrationAdapters } : {}),
    service,
    pythonAdapters,
    startupRecovery,
    ownerPendingRecovery,
    profileLease,
    profileLeaseMode,
    profileId,
    isolationRoot,
    profileAuthorityRoot,
  })
  return Object.freeze({
    kind: 'read-web-isolated-application-restore-target',
    requiredDomains: [...service.requiredDomains],
    adapters,
    service,
    restoreTarget,
    ...(migrationAdapters ? { migrationAdapters } : {}),
    startupRecovery: startupRecovery ? Object.freeze(clone(startupRecovery)) : null,
    ownerPendingRecovery: Object.freeze(clone(ownerPendingRecovery)),
    browserProfile: browser,
    pythonAdapters,
    profileId,
    profileAuthorityIsolationRoot,
    profileAuthorityRoot,
    profileLease: currentProfileLease ? Object.freeze(clone(currentProfileLease)) : null,
    profileLeaseMode,
    ownerMode: Object.freeze(clone(ownerProfileEvidence.ownerMode)),
    ownerProfileEvidence: Object.freeze(clone(ownerProfileEvidence)),
    async createBackup(backupOptions = {}) {
      return service.createBackup(backupOptions)
    },
    async createIsolatedTarget(targetOptions = {}) {
      if (targetOptions.engine === 'application') {
        const declaresSeparatePaths = targetOptions.profileDir
          || targetOptions.pythonStateDir
          || targetOptions.pythonOutputDir
          || targetOptions.isolationRoot
        if (!declaresSeparatePaths) return restoreTarget
        const targetComposition = await createReadWebProductionBackupComposition({
          ...targetOptions,
          pythonCommand: targetOptions.pythonCommand || pythonCommand,
          readerSaveOutboxQuarantineProtector: targetOptions.readerSaveOutboxQuarantineProtector
            || options.readerSaveOutboxQuarantineProtector,
          release: targetOptions.release || options.release,
        })
        return targetComposition.restoreTarget
      }
      return createIsolatedProfileRestoreTarget(targetOptions)
    },
  })
  }
  if (options.profileLeaseMode === PROFILE_LEASE_MODE_STANDBY) {
    return withApplicationPathMutex(isolationRoot, () => buildComposition({
      profileLease: null,
      profileLeaseMode: PROFILE_LEASE_MODE_STANDBY,
    }))
  }
  return withApplicationPathMutex(profileAuthorityRoot, async (profileLease) => (
    withApplicationPathMutex(isolationRoot, () => buildComposition({
      profileLease,
      profileLeaseMode: PROFILE_LEASE_MODE_AUTHORITATIVE,
    }))
  ))
}

export async function readArtifactFromFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

export async function writeArtifactToFile(filePath, artifact) {
  await writeJsonAtomic(filePath, artifact)
  return filePath
}

export async function isolatedPathExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export async function withReadWebApplicationStartupLock(options = {}, operation) {
  if (typeof operation !== 'function') {
    const error = new Error('Application startup lock requires an operation')
    error.code = 'BACKUP_PRODUCTION_COMPOSITION_CONFIGURATION'
    throw error
  }
  const validatedLayout = await validateIsolationLayout({
    isolationRoot: options.isolationRoot,
    paths: {
      profileDir: options.profileDir,
      pythonStateDir: options.pythonStateDir,
      pythonOutputDir: options.pythonOutputDir,
    },
    forbiddenRoots: options.forbiddenRoots,
  })
  const authorityLayout = await validateProfileAuthorityLayout(options, validatedLayout)
  const startupOptions = {
    ...options,
    ...(authorityLayout.explicit
      ? {
        profileAuthorityIsolationRoot: authorityLayout.profileAuthorityIsolationRoot,
        profileAuthorityRoot: authorityLayout.profileAuthorityRoot,
      }
      : {}),
  }
  const profileAuthorityMode = options.profileLeaseMode === PROFILE_LEASE_MODE_STANDBY
    ? PROFILE_LEASE_MODE_STANDBY
    : PROFILE_LEASE_MODE_AUTHORITATIVE
  const authorityLockOptions = options.allowStandby === true
    ? {
      timeoutMs: Number.isFinite(options.profileAuthorityLeaseTimeoutMs)
        ? options.profileAuthorityLeaseTimeoutMs
        : 1_000,
    }
    : {}
  const run = (profileLeaseMode) => withApplicationPathMutex(
    profileLeaseMode === PROFILE_LEASE_MODE_STANDBY
      ? validatedLayout.isolationRoot
      : authorityLayout.profileAuthorityRoot,
    async (profileLease) => {
      const composition = await createReadWebProductionBackupComposition({
        ...startupOptions,
        ...(profileLeaseMode === PROFILE_LEASE_MODE_STANDBY
          ? { profileLeaseMode: PROFILE_LEASE_MODE_STANDBY }
          : {}),
      })
      return operation(Object.freeze({
        composition,
        startupRecovery: composition.startupRecovery,
        ownerPendingRecovery: composition.ownerPendingRecovery,
        profileLease: composition.profileLease,
        profileLeaseMode: composition.profileLeaseMode,
      }))
    },
    profileLeaseMode === PROFILE_LEASE_MODE_STANDBY ? {} : authorityLockOptions,
  )
  if (profileAuthorityMode === PROFILE_LEASE_MODE_STANDBY) return run(PROFILE_LEASE_MODE_STANDBY)
  try {
    return await run(PROFILE_LEASE_MODE_AUTHORITATIVE)
  } catch (error) {
    if (options.allowStandby !== true || error?.code !== 'BACKUP_PATH_LOCK_TIMEOUT') throw error
    return withApplicationPathMutex(validatedLayout.isolationRoot, async () => {
      const composition = await createReadWebProductionBackupComposition({
        ...startupOptions,
        profileLeaseMode: PROFILE_LEASE_MODE_STANDBY,
      })
      return operation(Object.freeze({
        composition,
        startupRecovery: composition.startupRecovery,
        ownerPendingRecovery: composition.ownerPendingRecovery,
        profileLease: null,
        profileLeaseMode: composition.profileLeaseMode,
      }))
    })
  }
}

function ownerProfileReadFailureEvidence(error, { isolationRoot, profileAuthorityRoot, profileId, lease, profileLeaseMode = PROFILE_LEASE_MODE_AUTHORITATIVE } = {}) {
  const sourceError = typeof error?.code === 'string' && error.code
    ? error.code
    : 'OWNER_PROFILE_INVENTORY_READ_FAILED'
  const failedBinding = () => ({
    bound: false,
    status: 'failed',
    source: OWNER_PROFILE_EVIDENCE_SOURCE,
  })
  return {
    schemaVersion: OWNER_PROFILE_EVIDENCE_SCHEMA_VERSION,
    source: OWNER_PROFILE_EVIDENCE_SOURCE,
    ready: false,
    profileLease: lease && profileId
      ? profileLeaseEvidence(lease, { profileAuthorityRoot, isolationRoot, profileId })
      : null,
    profileLeaseMode,
    profileChecksum: null,
    inventory: {
      present: false,
      status: 'failed',
      source: 'browser-profile.json',
      errorCode: sourceError,
      indexedDbRowCount: 0,
      localStorageKeyCount: 0,
      pythonSourceCount: 0,
    },
    collection: {
      status: 'failed',
      source: 'openBrowserProfile',
      errorCode: sourceError,
    },
    rows: [],
    bindings: {
      backupAdapterRegistry: { ...failedBinding(), requiredDomains: [...OWNER_PROFILE_DOMAINS] },
      applicationLease: failedBinding(),
      transaction: failedBinding(),
      revision: failedBinding(),
      recovery: failedBinding(),
      domains: Object.fromEntries(OWNER_PROFILE_DOMAINS.map((domain) => [domain, {
        backupAdapter: failedBinding(),
        revision: failedBinding(),
        recovery: failedBinding(),
      }])),
    },
    ownerMode: {
      schemaVersion: OWNER_MODE_CHECKPOINT_SCHEMA_VERSION,
      status: 'not-ready',
      profileId,
      profileLease: null,
      authoritativeDomains: [],
      invalidDomains: [],
    },
    startupRecovery: { status: 'not-run', reason: 'profile-inventory-read-failed' },
    ownerPendingRecovery: {
      schemaVersion: OWNER_PENDING_JOURNAL_SCHEMA_VERSION,
      status: 'not-run',
      ready: false,
      reason: 'profile-inventory-read-failed',
      journalRetained: true,
    },
  }
}

async function holdApplicationProfileAfterReadFailure(options, error) {
  const validatedLayout = await validateIsolationLayout({
    isolationRoot: options.isolationRoot,
    paths: {
      profileDir: options.profileDir,
      pythonStateDir: options.pythonStateDir,
      pythonOutputDir: options.pythonOutputDir,
    },
    forbiddenRoots: options.forbiddenRoots,
  })
  const profileId = resolveProfileId(options, validatedLayout.paths.profileDir)
  const authorityLayout = await validateProfileAuthorityLayout(options, validatedLayout)
  const emitFailureEvidence = async (lease, profileLeaseMode) => {
    const ownerProfileEvidence = ownerProfileReadFailureEvidence(error, {
      isolationRoot: validatedLayout.isolationRoot,
      profileAuthorityRoot: authorityLayout.profileAuthorityRoot,
      profileId,
      lease,
      profileLeaseMode,
    })
    await new Promise((resolve, reject) => {
      process.stdout.write(`${JSON.stringify({
        status: 'ready',
        startupRecovery: null,
        ownerPendingRecovery: ownerProfileEvidence.ownerPendingRecovery,
        profileLeaseMode,
        ownerProfileEvidence,
      })}\n`, (writeError) => {
        if (writeError) reject(writeError)
        else resolve()
      })
    })
    if (process.stdin.readableEnded || process.stdin.destroyed) return
    process.stdin.resume()
    await new Promise((resolve) => {
      const done = () => resolve()
      process.stdin.once('end', done)
      process.stdin.once('close', done)
    })
  }
  const runAuthoritative = () => withApplicationPathMutex(
    authorityLayout.profileAuthorityRoot,
    async (lease) => withApplicationPathMutex(
      validatedLayout.isolationRoot,
      () => emitFailureEvidence(lease, PROFILE_LEASE_MODE_AUTHORITATIVE),
    ),
    options.allowStandby === true ? {
      timeoutMs: Number.isFinite(options.profileAuthorityLeaseTimeoutMs)
        ? options.profileAuthorityLeaseTimeoutMs
        : 1_000,
    } : {},
  )
  try {
    return await runAuthoritative()
  } catch (failure) {
    if (options.allowStandby !== true || failure?.code !== 'BACKUP_PATH_LOCK_TIMEOUT') throw failure
    return withApplicationPathMutex(
      validatedLayout.isolationRoot,
      () => emitFailureEvidence(null, PROFILE_LEASE_MODE_STANDBY),
    )
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
  && process.argv[2] === '--hold-application-profile') {
  const options = JSON.parse(process.argv[3] || '{}')
  try {
    await withReadWebApplicationStartupLock(options, async ({ composition, startupRecovery, profileLeaseMode }) => {
      await new Promise((resolve, reject) => {
          process.stdout.write(`${JSON.stringify({
            status: 'ready',
            startupRecovery,
            ownerPendingRecovery: composition.ownerPendingRecovery,
            profileLeaseMode,
            ownerProfileEvidence: composition.ownerProfileEvidence,
          })}\n`, (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      if (process.stdin.readableEnded || process.stdin.destroyed) return
      process.stdin.resume()
      await new Promise((resolve) => {
        const done = () => resolve()
        process.stdin.once('end', done)
        process.stdin.once('close', done)
      })
    })
  } catch (error) {
    const profileReadFailure = typeof error?.code === 'string'
      && (error.code.startsWith('PROFILE_') || ['EACCES', 'EIO', 'ENOTDIR', 'EPERM'].includes(error.code))
    if (!profileReadFailure) throw error
    await holdApplicationProfileAfterReadFailure(options, error)
  }
}
