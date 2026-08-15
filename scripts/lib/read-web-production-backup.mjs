import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

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

let backupModulesPromise

async function loadBackupModules() {
  if (backupModulesPromise) return backupModulesPromise
  backupModulesPromise = (async () => {
    const applicationBackupSource = await readFile(
      path.join(repoRoot, 'src', 'services', 'persistence', 'application-backup.js'),
      'utf8',
    )
    const applicationBackupUrl = `data:text/javascript;base64,${Buffer.from(applicationBackupSource).toString('base64')}`
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
    return { applicationBackup, readWebBackup }
  })()
  return backupModulesPromise
}

export async function createProductionOutboxQuarantineProtector(options = {}) {
  const { readWebBackup } = await loadBackupModules()
  return readWebBackup.createReaderSaveOutboxQuarantineProtector(options)
}

function clone(value) {
  return structuredClone(value)
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
    try {
      await mkdir(claimPath)
      const acquiredAt = new Date().toISOString()
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
    try {
      return await operation()
    } finally {
      await stopHeartbeat()
      await rm(claimPath, { recursive: true, force: true }).catch(() => {})
      await releasePathLock(lockPath, ownerToken)
    }
  }
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

async function writeJsonAtomic(filePath, value) {
  const absolute = path.resolve(filePath)
  await mkdir(path.dirname(absolute), { recursive: true })
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  let handle
  try {
    handle = await open(temporary, 'wx')
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await renameWithRetry(temporary, absolute)
  } catch (error) {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
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

async function openBrowserProfile(profileDir) {
  const filePath = path.join(profileDir, BROWSER_PROFILE_FILE)
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
  return { state, storage, persistence, filePath }
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
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
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
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
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
  const snapshots = { promise: null, remaining: 0 }
  async function collect(key) {
    if (!snapshots.promise) {
      snapshots.promise = runPythonBackup({
        pythonCommand,
        stateDir: options.stateDir,
        outputDir: options.outputDir,
      })
      snapshots.remaining = 2
    }
    try {
      const value = await snapshots.promise
      return clone(value[key])
    } finally {
      snapshots.remaining -= 1
      if (snapshots.remaining <= 0) snapshots.promise = null
    }
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
    key,
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
  const { applicationBackup } = await loadBackupModules()
  const requiredDomains = applicationBackup.APPLICATION_BACKUP_REQUIRED_DOMAINS
  const profileDir = path.resolve(options.profileDir)
  const isolationCertificate = applicationBackup.createApplicationBackupIsolationCertificate({
    isolationRoot: path.resolve(options.isolationRoot || path.dirname(profileDir)),
    paths: { profileDir },
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
  let faultState = { ...(options.faults || {}) }

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
    profileDir,
    statePath,
    journalPath,
    rollbackDir,
    quarantineDir,
    rollbackStoreSeparate: true,
    restoreCapabilities: Object.freeze({
      atomicRevisionCommit: true,
      commitRevisionEvidence: true,
      verifyAppliedRevision: true,
    }),
    capacityBytes: Number.isFinite(options.capacityBytes) ? options.capacityBytes : 256 * 1024 * 1024,
    adapters: createFileDomainAdapters(stateRef, requiredDomains, statePath, profileDir),
    faults: faultState,
    async estimateCapacity({ requiredBytes }) {
      return { ok: target.capacityBytes >= requiredBytes, availableBytes: target.capacityBytes }
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
      async write(entry) {
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
    async beginTransaction({ restoreId, signal, expectedBaseRevision }) {
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
          if (Number.isInteger(faultState.interruptAfterDomain)
            && appliedCount >= faultState.interruptAfterDomain) {
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
          return withPathMutex(profileDir, async () => {
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
            if (faultState.commit === 'write-then-block' && faultState.commitBarrierDir) {
              const barrierDir = path.resolve(faultState.commitBarrierDir)
              await mkdir(barrierDir, { recursive: true })
              await writeJsonAtomic(path.join(barrierDir, 'state-written.json'), {
                restoreId,
                revision: committedRevision,
              })
              const releasePath = path.join(barrierDir, 'release.json')
              while (!await pathExists(releasePath)) await delay(10)
            }
            if (faultState.commit === 'write-then-fail'
              || (faultState.commit === 'fail-once' && !faultState.failed)) {
              faultState.failed = true
              const error = new Error(`Restore commit fault injected for ${restoreId}`)
              error.code = 'RESTORE_COMMIT_FAILED'
              error.committedRevision = committedRevision
              throw error
            }
            return { revision: committedRevision, checksum: next.checksum }
          })
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
      faultState = { ...nextFaults }
      target.faults = faultState
    },
  }
  return target
}

export async function createReadWebProductionBackupComposition(options = {}) {
  if (!options.profileDir || !options.pythonStateDir || !options.pythonOutputDir || !options.isolationRoot) {
    const error = new Error('Production backup composition requires isolated browser profile, Python state, and Python output directories')
    error.code = 'BACKUP_PRODUCTION_COMPOSITION_CONFIGURATION'
    throw error
  }
  const resolvedPaths = {
    profileDir: path.resolve(options.profileDir),
    pythonStateDir: path.resolve(options.pythonStateDir),
    pythonOutputDir: path.resolve(options.pythonOutputDir),
  }
  const lexicalIsolationRoot = path.resolve(options.isolationRoot)
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
  let isolationRoot
  let canonicalPaths
  try {
    isolationRoot = await resolveCanonicalPath(lexicalIsolationRoot)
    canonicalPaths = Object.fromEntries(
      await Promise.all(Object.entries(resolvedPaths).map(async ([name, value]) => [name, await resolveCanonicalPath(value)])),
    )
  } catch (error) {
    const validationError = new Error('Production backup composition paths could not be canonicalized safely')
    validationError.code = 'BACKUP_PRODUCTION_COMPOSITION_UNSAFE_PATH'
    validationError.cause = error
    throw validationError
  }
  const comparablePath = (value) => process.platform === 'win32' ? value.toLowerCase() : value
  const isWithin = (parent, child) => {
    const relative = path.relative(comparablePath(parent), comparablePath(child))
    return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  }
  const unsafe = (message, details = {}) => {
    const error = new Error(message)
    error.code = 'BACKUP_PRODUCTION_COMPOSITION_UNSAFE_PATH'
    error.details = details
    return error
  }
  for (const [name, value] of Object.entries(canonicalPaths)) {
    if (!isWithin(isolationRoot, value)) {
      throw unsafe(`${name} must be a strict descendant of isolationRoot`, {
        name,
        isolationRoot,
        lexicalIsolationRoot,
        value,
        lexicalValue: resolvedPaths[name],
      })
    }
  }
  const entries = Object.entries(canonicalPaths)
  for (let index = 0; index < entries.length; index += 1) {
    for (let candidate = index + 1; candidate < entries.length; candidate += 1) {
      const [leftName, left] = entries[index]
      const [rightName, right] = entries[candidate]
      if (comparablePath(left) === comparablePath(right) || isWithin(left, right) || isWithin(right, left)) {
        throw unsafe(`${leftName} and ${rightName} must not overlap`, { left, right })
      }
    }
  }
  const forbiddenRoots = [
    ...(process.platform === 'win32' ? ['E:\\read-web', 'E:\\read-web-next'] : []),
    ...(Array.isArray(options.forbiddenRoots) ? options.forbiddenRoots : []),
  ].map((value) => path.resolve(value))
  for (const forbiddenRoot of forbiddenRoots) {
    let canonicalForbiddenRoot
    try {
      canonicalForbiddenRoot = await resolveCanonicalPath(forbiddenRoot)
    } catch (error) {
      throw unsafe('Forbidden root could not be canonicalized safely', { forbiddenRoot, cause: error?.code || error?.message })
    }
    for (const [name, value] of Object.entries({ isolationRoot, ...canonicalPaths })) {
      if (comparablePath(value) === comparablePath(canonicalForbiddenRoot)
        || isWithin(canonicalForbiddenRoot, value)
        || isWithin(value, canonicalForbiddenRoot)) {
        throw unsafe(`${name} overlaps a forbidden root`, { name, value, forbiddenRoot: canonicalForbiddenRoot })
      }
    }
  }
  const { applicationBackup, readWebBackup } = await loadBackupModules()
  const browser = await openBrowserProfile(resolvedPaths.profileDir)
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
    stateDir: resolvedPaths.pythonStateDir,
    outputDir: resolvedPaths.pythonOutputDir,
    pythonCommand: options.pythonCommand,
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
      isolationCertificate: applicationBackup.createApplicationBackupIsolationCertificate({
        isolationRoot,
        paths: canonicalPaths,
      }),
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
      capacityBytes: targetOptions.capacityBytes,
      faults: targetOptions.faults,
      rollbackStore: targetOptions.rollbackStore,
      quarantine: targetOptions.quarantine,
      journalStore: targetOptions.journalStore,
      pendingStore: targetOptions.pendingStore,
      revisionStore: targetOptions.revisionStore,
    })
  }
  const restoreTarget = createApplicationRestoreTarget(browser, pythonAdapters, adapters, {
    capacityBytes: options.capacityBytes,
    faults: options.faults,
    rollbackStore: options.rollbackStore,
    quarantine: options.quarantine,
    journalStore: options.journalStore,
    pendingStore: options.pendingStore,
    revisionStore: options.revisionStore,
  })
  await restoreTarget.recoverPendingRestore()
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
  return Object.freeze({
    kind: 'read-web-isolated-application-restore-target',
    requiredDomains: [...service.requiredDomains],
    adapters,
    service,
    restoreTarget,
    browserProfile: browser,
    pythonAdapters,
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
          pythonCommand: targetOptions.pythonCommand || options.pythonCommand,
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
