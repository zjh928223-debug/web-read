import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const workflowRoot = path.join(repoRoot, 'tools', 'subtitle-workflow')
const PROFILE_SCHEMA_VERSION = 1
const APPLICATION_STATE_FILE = 'application-state.json'
const BROWSER_PROFILE_FILE = 'browser-profile.json'
const JOURNAL_SCHEMA_VERSION = 1
const PATH_MUTEXES = new Map()

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

async function withPathMutex(filePath, operation) {
  const key = pathMutexKey(filePath)
  const state = PATH_MUTEXES.get(key) || { tail: Promise.resolve() }
  PATH_MUTEXES.set(key, state)
  const previous = state.tail
  let release
  const current = new Promise((resolve) => { release = resolve })
  const queued = previous.then(() => current)
  state.tail = queued
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (state.tail === queued) PATH_MUTEXES.delete(key)
  }
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

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
  'rolled-back': 1,
  'rollback-failed': 6,
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
  const persistence = {
    async getAllRows() { return clone(state.indexedDbRows) },
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
        const error = new Error(`Python durable backup bridge failed: ${stderr.trim() || `exit ${code}`}`)
        error.code = 'BACKUP_PYTHON_BRIDGE_FAILED'
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
    },
    workflow: {
      key: 'workflow',
      schemaVersion: 1,
      adapterVersion: 1,
      supportedSchemaVersions: [1],
      collect: () => collect('workflow'),
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
    profileDir,
    statePath,
    journalPath,
    rollbackDir,
    quarantineDir,
    rollbackStoreSeparate: true,
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
            if (existing.artifact?.artifactChecksum === entry.artifact?.artifactChecksum) return
            const error = new Error(`Rollback backup already exists for ${entry.restoreId}`)
            error.code = 'RESTORE_ID_CONFLICT'
            throw error
          }
          const current = await readStateUnlocked()
          await writeJsonAtomic(filePath, {
            schemaVersion: 1,
            ...entry,
            rawState: current,
          })
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
    async beginTransaction({ restoreId, signal }) {
      const current = await withPathMutex(profileDir, readStateUnlocked)
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
            if (faultState.commit === 'write-then-fail'
              || (faultState.commit === 'fail-once' && !faultState.failed)) {
              faultState.failed = true
              const error = new Error(`Restore commit fault injected for ${restoreId}`)
              error.code = 'RESTORE_COMMIT_FAILED'
              error.committedRevision = committedRevision
              throw error
            }
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
  if (!options.profileDir || !options.pythonStateDir || !options.pythonOutputDir) {
    const error = new Error('Production backup composition requires isolated browser profile, Python state, and Python output directories')
    error.code = 'BACKUP_PRODUCTION_COMPOSITION_CONFIGURATION'
    throw error
  }
  const { readWebBackup } = await loadBackupModules()
  const browser = await openBrowserProfile(path.resolve(options.profileDir))
  const pythonAdapters = createPythonDomainAdapters({
    stateDir: path.resolve(options.pythonStateDir),
    outputDir: path.resolve(options.pythonOutputDir),
    pythonCommand: options.pythonCommand,
  })
  const adapters = readWebBackup.createReadWebApplicationBackupAdapters({
    applicationPersistence: browser.persistence,
    storage: browser.storage,
    readerSaveOutboxQuarantineProtector: options.readerSaveOutboxQuarantineProtector,
    marksActivityAdapter: pythonAdapters['marks-activity'],
    workflowAdapter: pythonAdapters.workflow,
  })
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
    kind: 'read-web-isolated-restore-engine-foundation',
    requiredDomains: [...service.requiredDomains],
    adapters,
    service,
    browserProfile: browser,
    pythonAdapters,
    async createBackup(backupOptions = {}) {
      return service.createBackup(backupOptions)
    },
    async createIsolatedTarget(targetOptions = {}) {
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
