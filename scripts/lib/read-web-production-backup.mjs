import { Buffer } from 'node:buffer'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const workflowRoot = path.join(repoRoot, 'tools', 'subtitle-workflow')
const PROFILE_SCHEMA_VERSION = 1
const APPLICATION_STATE_FILE = 'application-state.json'
const BROWSER_PROFILE_FILE = 'browser-profile.json'

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
    await rename(temporary, absolute)
  } catch (error) {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
    throw error
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
  await writeJsonAtomic(path.join(profileDir, BROWSER_PROFILE_FILE), state)
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

function createFileDomainAdapters(stateRef, requiredDomains, statePath) {
  return Object.fromEntries(requiredDomains.map((key) => [key, {
    key,
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      const latest = await readJsonIfPresent(statePath, 'RESTORE_TARGET_STATE_CORRUPT')
      if (!latest || latest.schemaVersion !== PROFILE_SCHEMA_VERSION || !latest.domains?.[key]) {
        const error = new Error(`Isolated restore target is missing domain ${key}`)
        error.code = 'RESTORE_TARGET_DOMAIN_MISSING'
        throw error
      }
      stateRef.value = latest
      return clone(latest.domains[key])
    },
  }]))
}

function safeFilePart(value) {
  return String(value || 'restore').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160)
}

export async function createIsolatedProfileRestoreTarget(options = {}) {
  const { applicationBackup } = await loadBackupModules()
  const requiredDomains = applicationBackup.APPLICATION_BACKUP_REQUIRED_DOMAINS
  const profileDir = path.resolve(options.profileDir)
  const statePath = path.join(profileDir, APPLICATION_STATE_FILE)
  const journalPath = path.join(profileDir, 'restore-journal.json')
  const rollbackDir = path.join(profileDir, 'rollback')
  const quarantineDir = path.join(profileDir, 'quarantine')
  const existing = await readJsonIfPresent(statePath, 'RESTORE_TARGET_STATE_CORRUPT')
  const stateRef = {
    value: existing && existing.schemaVersion === PROFILE_SCHEMA_VERSION
      ? existing
      : { schemaVersion: PROFILE_SCHEMA_VERSION, domains: normalizedInitialDomains(options.initialDomains, requiredDomains) },
  }
  if (!existing) await writeJsonAtomic(statePath, stateRef.value)
  if (existing && existing.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    const error = new Error('Isolated restore target has an unsupported state schema')
    error.code = 'RESTORE_TARGET_UNKNOWN_SCHEMA'
    throw error
  }
  let faultState = { ...(options.faults || {}) }

  const target = {
    isolated: true,
    profileDir,
    rollbackStoreSeparate: true,
    capacityBytes: Number.isFinite(options.capacityBytes) ? options.capacityBytes : 256 * 1024 * 1024,
    adapters: createFileDomainAdapters(stateRef, requiredDomains, statePath),
    faults: faultState,
    async estimateCapacity({ requiredBytes }) {
      return { ok: target.capacityBytes >= requiredBytes, availableBytes: target.capacityBytes }
    },
    async readJournal({ restoreId }) {
      const value = await readJsonIfPresent(journalPath, 'RESTORE_JOURNAL_CORRUPT')
      if (!value) return null
      if (value.schemaVersion !== 1 || !value.entries || typeof value.entries !== 'object') {
        const error = new Error('Isolated restore journal schema is invalid')
        error.code = 'RESTORE_JOURNAL_CORRUPT'
        throw error
      }
      return value.entries[restoreId] || null
    },
    async writeJournal(entry) {
      const value = await readJsonIfPresent(journalPath, 'RESTORE_JOURNAL_CORRUPT')
        || { schemaVersion: 1, entries: {} }
      if (value.schemaVersion !== 1 || !value.entries || typeof value.entries !== 'object') {
        const error = new Error('Isolated restore journal schema is invalid')
        error.code = 'RESTORE_JOURNAL_CORRUPT'
        throw error
      }
      value.entries[entry.restoreId] = clone(entry)
      await writeJsonAtomic(journalPath, value)
    },
    rollbackStore: {
      async write(entry) {
        const current = await readJsonIfPresent(statePath, 'RESTORE_TARGET_STATE_CORRUPT')
        await writeJsonAtomic(path.join(rollbackDir, `${safeFilePart(entry.restoreId)}.json`), {
          ...entry,
          rawState: current,
        })
      },
      async read({ restoreId }) {
        return readJsonIfPresent(path.join(rollbackDir, `${safeFilePart(restoreId)}.json`), 'RESTORE_ROLLBACK_CORRUPT')
      },
    },
    quarantine: {
      async write(entry) {
        const fileName = `${Date.now().toString(36)}-${safeFilePart(entry.restoreId)}-${safeFilePart(entry.kind)}.json`
        await writeJsonAtomic(path.join(quarantineDir, fileName), entry)
      },
    },
    async beginTransaction({ restoreId, signal }) {
      const current = await readJsonIfPresent(statePath, 'RESTORE_TARGET_STATE_CORRUPT')
      if (!current || current.schemaVersion !== PROFILE_SCHEMA_VERSION) {
        const error = new Error('Isolated restore target state is unavailable')
        error.code = 'RESTORE_TARGET_STATE_CORRUPT'
        throw error
      }
      let staged = clone(current)
      let appliedCount = 0
      let rolledBack = false
      return {
        async applyDomain(key, domain) {
          if (signal?.aborted) {
            const error = new Error('Restore was interrupted while staging a domain')
            error.code = 'RESTORE_INTERRUPTED'
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
          await writeJsonAtomic(statePath, staged)
          stateRef.value = staged
          if (faultState.commit === 'write-then-fail'
            || (faultState.commit === 'fail-once' && !faultState.failed)) {
            faultState.failed = true
            const error = new Error(`Restore commit fault injected for ${restoreId}`)
            error.code = 'RESTORE_COMMIT_FAILED'
            throw error
          }
        },
        async rollback() {
          rolledBack = true
          staged = clone(current)
        },
        get rolledBack() { return rolledBack },
      }
    },
    async restoreSnapshot(artifact, context = {}) {
      const rollback = context.restoreId
        ? await target.rollbackStore.read({ restoreId: context.restoreId })
        : null
      const next = rollback?.rawState && String(context.reason || '').startsWith('restore-')
        ? rollback.rawState
        : {
            schemaVersion: PROFILE_SCHEMA_VERSION,
            domains: normalizedInitialDomains(artifact.domains, requiredDomains),
          }
      await writeJsonAtomic(statePath, next)
      stateRef.value = next
    },
    async verifyApplied({ artifact }) {
      const latest = await readJsonIfPresent(statePath, 'RESTORE_TARGET_STATE_CORRUPT')
      if (!latest || latest.schemaVersion !== PROFILE_SCHEMA_VERSION) return { ok: false, reason: 'state-missing' }
      for (const key of requiredDomains) {
        if (canonicalJson(latest.domains?.[key]) !== canonicalJson(artifact.domains[key])) {
          return { ok: false, reason: `domain-mismatch:${key}` }
        }
      }
      return { ok: true }
    },
    async readState() {
      return readJsonIfPresent(statePath, 'RESTORE_TARGET_STATE_CORRUPT')
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
    kind: 'read-web-production-backup-composition',
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
