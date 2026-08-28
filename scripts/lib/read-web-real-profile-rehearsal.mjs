import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import {
  createReadWebProductionBackupComposition,
  writeIsolatedBrowserProfile,
} from './read-web-production-backup.mjs'
import { resolveExecutable, resolveSelectedPython } from './python-runtime.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const READER_SESSION_ROW_IDS = new Set(['audioMeta', 'transcript', 'chunkData', 'marks', 'readerSession'])
const VOCABULARY_ROW_PREFIXES = ['vocabulary.', 'vocabulary-article-srs-settlement-progress:']
const EXCLUDED_BROWSER_ROWS = Object.freeze({
  media: Object.freeze(['audio']),
  retired: Object.freeze(['allSentenceNotesByDoc']),
})
const REAL_PROFILE_MAX_RECORD_BYTES = 16 * 1024 * 1024
const REAL_PROFILE_MAX_BACKUP_BYTES = 128 * 1024 * 1024

function canonicalize(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

function checksum(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex')
}

function browserSnapshotChecksum(snapshot) {
  return checksum({
    databaseVersion: snapshot.databaseVersion,
    indexedDbRows: snapshot.indexedDbRows,
    localStorage: snapshot.localStorage,
  })
}

function isLiveBrowserRowId(id) {
  const value = String(id || '')
  return READER_SESSION_ROW_IDS.has(value)
    || value.startsWith('readerSessionQuarantine:')
    || VOCABULARY_ROW_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function unsafePath(message, details = {}) {
  const error = new Error(message)
  error.code = 'REAL_PROFILE_REHEARSAL_UNSAFE_PATH'
  error.details = details
  return error
}

function overlaps(left, right) {
  const relative = path.relative(left, right)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function existingDirectory(value, label) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value.trim())) {
    throw unsafePath(`${label} must be an explicit absolute directory`)
  }
  const resolved = await realpath(path.resolve(value.trim()))
  if (!(await stat(resolved)).isDirectory()) throw unsafePath(`${label} must be a directory`)
  return resolved
}

export async function validateRealProfileRehearsalLayout(options = {}) {
  const browserProfileDir = await existingDirectory(options.browserProfileDir, 'browserProfileDir')
  const workflowDataRoot = await existingDirectory(options.workflowDataRoot, 'workflowDataRoot')
  const isolatedRoot = await existingDirectory(options.isolatedRoot, 'isolatedRoot')
  const forbidden = [
    browserProfileDir,
    workflowDataRoot,
    ...(process.platform === 'win32' ? ['E:\\read-web', 'E:\\read-web-next', 'E:\\ReadWebData\\SubtitleWorkflow'] : []),
    ...(Array.isArray(options.additionalOutputRoots) ? options.additionalOutputRoots : []),
    ...(Array.isArray(options.forbiddenWriteRoots) ? options.forbiddenWriteRoots : []),
  ]
  for (const value of forbidden) {
    if (typeof value !== 'string' || !value.trim()) continue
    const resolved = path.resolve(value.trim())
    if (overlaps(resolved, isolatedRoot) || overlaps(isolatedRoot, resolved)) {
      throw unsafePath('isolatedRoot overlaps a read-only or forbidden write root', {
        isolatedRoot,
        forbiddenRoot: resolved,
      })
    }
  }
  return Object.freeze({ browserProfileDir, workflowDataRoot, isolatedRoot })
}

function chromiumOriginDirectoryName(browserOrigin) {
  const origin = new URL(browserOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash) {
    throw unsafePath('browserOrigin must be an HTTP(S) origin without a path')
  }
  const port = origin.port || (origin.protocol === 'https:' ? '443' : '80')
  return `${origin.protocol.slice(0, -1)}_${origin.hostname}_${port}.indexeddb.leveldb`
}

async function digestDirectory(directory) {
  const hash = createHash('sha256')
  async function visit(current, relative = '') {
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      if (entry.name === 'LOCK') continue
      const childRelative = relative ? path.join(relative, entry.name) : entry.name
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        hash.update(`d:${childRelative}\n`)
        await visit(absolute, childRelative)
      } else if (entry.isFile()) {
        hash.update(`f:${childRelative}:`)
        hash.update(await readFile(absolute))
        hash.update('\n')
      } else {
        throw unsafePath('browser source contains an unsupported filesystem entry', { path: absolute })
      }
    }
  }
  await visit(directory)
  return hash.digest('hex')
}

export async function fingerprintChromiumOriginSource({ browserProfileDir, browserOrigin }) {
  const profile = await existingDirectory(browserProfileDir, 'browserProfileDir')
  const originDirectory = chromiumOriginDirectoryName(browserOrigin)
  const indexedDbDir = path.join(profile, 'IndexedDB', originDirectory)
  const indexedDbBlobDir = path.join(profile, 'IndexedDB', originDirectory.replace(/\.leveldb$/u, '.blob'))
  const localStorageDir = path.join(profile, 'Local Storage', 'leveldb')
  await existingDirectory(indexedDbDir, 'browser origin IndexedDB directory')
  await existingDirectory(localStorageDir, 'browser localStorage directory')
  const [indexedDb, indexedDbBlobs, localStorage] = await Promise.all([
    digestDirectory(indexedDbDir),
    stat(indexedDbBlobDir).then(() => digestDirectory(indexedDbBlobDir)).catch((error) => {
      if (error?.code === 'ENOENT') return 'none'
      throw error
    }),
    digestDirectory(localStorageDir),
  ])
  return createHash('sha256').update(`${indexedDb}:${indexedDbBlobs}:${localStorage}`).digest('hex')
}

async function copyIfPresent(source, destination) {
  try {
    await stat(source)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (candidate) => path.basename(candidate).toUpperCase() !== 'LOCK',
  })
}

export async function exportChromiumOriginSnapshot({ browserProfileDir, browserOrigin, isolatedRoot }) {
  const profile = await existingDirectory(browserProfileDir, 'browserProfileDir')
  const destinationRoot = await existingDirectory(isolatedRoot, 'isolatedRoot')
  if (overlaps(profile, destinationRoot) || overlaps(destinationRoot, profile)) {
    throw unsafePath('isolatedRoot must not overlap browserProfileDir')
  }
  const profileName = path.basename(profile)
  const userDataDir = path.dirname(profile)
  const cloneUserDataDir = await mkdtemp(path.join(destinationRoot, 'browser-clone-'))
  const cloneProfile = path.join(cloneUserDataDir, profileName)
  const originDirectory = chromiumOriginDirectoryName(browserOrigin)
  await mkdir(cloneProfile, { recursive: true })
  try {
    await Promise.all([
      copyIfPresent(path.join(userDataDir, 'Local State'), path.join(cloneUserDataDir, 'Local State')),
      copyIfPresent(path.join(profile, 'Preferences'), path.join(cloneProfile, 'Preferences')),
      copyIfPresent(path.join(profile, 'Secure Preferences'), path.join(cloneProfile, 'Secure Preferences')),
      copyIfPresent(
        path.join(profile, 'IndexedDB', originDirectory),
        path.join(cloneProfile, 'IndexedDB', originDirectory),
      ),
      copyIfPresent(
        path.join(profile, 'IndexedDB', originDirectory.replace(/\.leveldb$/u, '.blob')),
        path.join(cloneProfile, 'IndexedDB', originDirectory.replace(/\.leveldb$/u, '.blob')),
      ),
      copyIfPresent(
        path.join(profile, 'Local Storage', 'leveldb'),
        path.join(cloneProfile, 'Local Storage', 'leveldb'),
      ),
    ])
    const context = await chromium.launchPersistentContext(cloneUserDataDir, {
      channel: 'chrome',
      headless: true,
      args: [`--profile-directory=${profileName}`],
    })
    let networkRequests = 0
    let blockedRequests = 0
    try {
      const exportUrl = `${new URL(browserOrigin).origin}/__read_web_read_only_export__`
      await context.route('**/*', async (route) => {
        if (route.request().url() === exportUrl) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><meta charset="utf-8"><title>Read-Web read-only export</title>',
          })
          return
        }
        blockedRequests += 1
        await route.abort('blockedbyclient')
      })
      const page = context.pages()[0] || await context.newPage()
      await page.goto(exportUrl, { waitUntil: 'domcontentloaded' })
      const snapshot = await page.evaluate(async () => {
        const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
        if (databases.length && !databases.some((entry) => entry.name === 'SeekPlayerDB')) {
          throw new Error('SeekPlayerDB is unavailable in the cloned browser origin')
        }
        const database = await new Promise((resolve, reject) => {
          let created = false
          const request = indexedDB.open('SeekPlayerDB')
          request.onupgradeneeded = () => {
            created = true
            request.transaction?.abort()
          }
          request.onsuccess = () => created
            ? reject(new Error('SeekPlayerDB did not exist in the cloned browser origin'))
            : resolve(request.result)
          request.onerror = () => reject(request.error || new Error('SeekPlayerDB open failed'))
          request.onblocked = () => reject(new Error('SeekPlayerDB open was blocked'))
        })
        try {
          if (database.version !== 1 || !database.objectStoreNames.contains('files')) {
            throw new Error('SeekPlayerDB schema is incompatible with the restore contract')
          }
          let rowIds
          try {
            rowIds = await new Promise((resolve, reject) => {
              const transaction = database.transaction('files', 'readonly')
              const request = transaction.objectStore('files').getAllKeys()
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => reject(request.error)
              transaction.onabort = () => reject(transaction.error)
            })
          } catch (error) {
            throw new Error(`READ_KEYS:${error?.name || 'UNKNOWN'}`)
          }
          const claimed = (id) => ['audioMeta', 'transcript', 'chunkData', 'marks', 'readerSession'].includes(id)
            || String(id || '').startsWith('readerSessionQuarantine:')
            || String(id || '').startsWith('vocabulary.')
            || String(id || '').startsWith('vocabulary-article-srs-settlement-progress:')
          const indexedDbRows = []
          for (const id of rowIds) {
            if (!claimed(id)) {
              indexedDbRows.push({ id })
              continue
            }
            try {
              indexedDbRows.push(await new Promise((resolve, reject) => {
                const transaction = database.transaction('files', 'readonly')
                const request = transaction.objectStore('files').get(id)
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
                transaction.onabort = () => reject(transaction.error)
              }))
            } catch (error) {
              throw new Error(`READ_ROW:${String(id).slice(0, 80)}:${error?.name || 'UNKNOWN'}`)
            }
          }
          indexedDbRows.sort((left, right) => (
            String(left?.id || '').localeCompare(String(right?.id || ''), 'en')
          ))
          const localStorageValues = {}
          for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index)
            if (!key) continue
            if (key.startsWith('AnnotationGenerationStorage::')
              || key.startsWith('vocabulary.passage-preview.')
              || key.startsWith('vocabulary.ielts-daily-preview.')
              || key.startsWith('read-web.reader-save-outbox.')) {
              try {
                localStorageValues[key] = localStorage.getItem(key)
              } catch (error) {
                const category = key.startsWith('AnnotationGenerationStorage::')
                  ? 'annotation'
                  : key.startsWith('read-web.reader-save-outbox.') ? 'reader-outbox' : 'passage-preview'
                throw new Error(`READ_LOCAL_STORAGE:${category}:${error?.name || 'UNKNOWN'}`)
              }
            }
          }
          return { indexedDbRows, localStorage: localStorageValues, databaseVersion: database.version }
        } finally {
          database.close()
        }
      })
      return Object.freeze({
        ...snapshot,
        networkRequests,
        blockedRequests,
      })
    } finally {
      await context.close()
    }
  } finally {
    await rm(cloneUserDataDir, { recursive: true, force: true })
  }
}

async function digestWorkflowTree(directory, { includeContent }) {
  const hash = createHash('sha256')
  async function visit(current, relative = '') {
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      if (entry.name === 'LOCK' || entry.name.endsWith('.lock')) continue
      const childRelative = relative ? path.join(relative, entry.name) : entry.name
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        hash.update(`d:${childRelative}\n`)
        await visit(absolute, childRelative)
      } else if (entry.isFile()) {
        const metadata = await stat(absolute, { bigint: true })
        hash.update(`f:${childRelative}:${metadata.size}:${metadata.mtimeNs}`)
        if (includeContent(absolute)) hash.update(await readFile(absolute))
        hash.update('\n')
      } else {
        throw unsafePath('workflow source contains an unsupported filesystem entry', { path: absolute })
      }
    }
  }
  await visit(directory)
  return hash.digest('hex')
}

async function resolveAdditionalOutputRoots(values = []) {
  const roots = await Promise.all([...new Set(values)].map((value) => existingDirectory(value, 'additionalOutputRoot')))
  return [...new Set(roots)].sort((left, right) => left.localeCompare(right, 'en'))
}

export async function fingerprintWorkflowSource({ workflowStateDir, workflowOutputDir, additionalOutputRoots = [] }) {
  const stateDir = await existingDirectory(workflowStateDir, 'workflowStateDir')
  const outputDir = await existingDirectory(workflowOutputDir, 'workflowOutputDir')
  const additionalRoots = await resolveAdditionalOutputRoots(additionalOutputRoots)
  const [state, output, ...additional] = await Promise.all([
    digestWorkflowTree(stateDir, { includeContent: () => true }),
    digestWorkflowTree(outputDir, { includeContent: (filePath) => path.extname(filePath).toLowerCase() === '.json' }),
    ...additionalRoots.map((root) => digestWorkflowTree(root, {
      includeContent: (filePath) => path.extname(filePath).toLowerCase() === '.json',
    })),
  ])
  return createHash('sha256').update([state, output, ...additional].join(':')).digest('hex')
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

export async function collectReadOnlyWorkflowDomains({
  workflowStateDir,
  workflowOutputDir,
  additionalOutputRoots = [],
  pythonCommand = '',
}) {
  const stateDir = await existingDirectory(workflowStateDir, 'workflowStateDir')
  const outputDir = await existingDirectory(workflowOutputDir, 'workflowOutputDir')
  const additionalRoots = await resolveAdditionalOutputRoots(additionalOutputRoots)
  const selectedPython = pythonCommand
    ? await resolveExecutable(repositoryRoot, pythonCommand, repositoryRoot)
    : (await resolveSelectedPython({
      repoRoot: repositoryRoot,
      configPath: process.env.READ_WEB_RUNTIME_CONFIG || 'config/runtime.optimization.json',
    })).executable
  const result = await runProcess(selectedPython, [
    '-m', 'youtube_workflow.application_backup',
    '--state-dir', stateDir,
    '--output-dir', outputDir,
    ...additionalRoots.flatMap((root) => ['--additional-output-root', root]),
  ], {
    cwd: path.join(repositoryRoot, 'tools', 'subtitle-workflow'),
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
  })
  if (result.code !== 0) {
    const error = new Error('Read-only workflow backup collection failed')
    error.code = 'REAL_PROFILE_WORKFLOW_EXPORT_FAILED'
    error.details = { exitCode: result.code, signal: result.signal, stderr: result.stderr.trim().slice(0, 2_000) }
    throw error
  }
  const domains = JSON.parse(result.stdout)
  if (!domains || typeof domains !== 'object' || !domains.workflow || !domains['marks-activity']) {
    const error = new Error('Read-only workflow backup collection returned incomplete domains')
    error.code = 'REAL_PROFILE_WORKFLOW_EXPORT_INVALID'
    throw error
  }
  return domains
}

function snapshotAdapter(key, snapshot) {
  return Object.freeze({
    key,
    schemaVersion: snapshot.schemaVersion ?? 1,
    adapterVersion: snapshot.adapterVersion ?? 1,
    supportedSchemaVersions: [snapshot.schemaVersion ?? 1],
    async collect() {
      return structuredClone(snapshot)
    },
  })
}

export function validateRestoredDomainJourneys(artifact) {
  const records = (domainKey) => artifact?.domains?.[domainKey]?.records || []
  const reader = records('reader-session')
  const vocabulary = records('vocabulary-srs')
  const preview = records('passage-preview')
  const annotation = records('annotation')
  const workflow = records('workflow')
  const journeys = {
    Reader: reader.some((record) => READER_SESSION_ROW_IDS.has(String(record?.id || ''))),
    Vocabulary: vocabulary.some((record) => {
      const id = String(record?.id || '')
      return id.startsWith('vocabulary.')
        && !id.startsWith('vocabulary.srs.')
        && !id.startsWith('vocabulary.review.')
    }),
    SRS: vocabulary.some((record) => {
      const id = String(record?.id || '')
      return id.startsWith('vocabulary.srs.')
        || id.startsWith('vocabulary.review.')
        || id.startsWith('vocabulary-article-srs-settlement-progress:')
    }),
    Preview: preview.length > 0,
    Annotation: annotation.length > 0,
    workflow: workflow.length > 0,
  }
  const failed = Object.entries(journeys).filter(([, passed]) => !passed).map(([name]) => name)
  if (failed.length) {
    const error = new Error('Restored real-profile domain journey validation failed')
    error.code = 'REAL_PROFILE_RESTORED_JOURNEY_FAILED'
    error.details = { failed }
    throw error
  }
  return Object.freeze(Object.fromEntries(Object.keys(journeys).map((name) => [name, Object.freeze({ status: 'passed' })])))
}

export async function rehearseRealProfileCopy(options = {}) {
  const layout = await validateRealProfileRehearsalLayout(options)
  const pythonCommand = options.pythonCommand || (await resolveSelectedPython({
    repoRoot: repositoryRoot,
    configPath: process.env.READ_WEB_RUNTIME_CONFIG || 'config/runtime.optimization.json',
  })).executable
  const workflowStateDir = await existingDirectory(
    options.workflowStateDir || path.join(layout.workflowDataRoot, '.workflow_state'),
    'workflowStateDir',
  )
  const workflowOutputDir = await existingDirectory(
    options.workflowOutputDir || path.join(layout.workflowDataRoot, 'output'),
    'workflowOutputDir',
  )
  const additionalOutputRoots = await resolveAdditionalOutputRoots(options.additionalOutputRoots || [])
  const before = {
    browserPhysical: await fingerprintChromiumOriginSource({
      browserProfileDir: layout.browserProfileDir,
      browserOrigin: options.browserOrigin,
    }),
    workflow: await fingerprintWorkflowSource({ workflowStateDir, workflowOutputDir, additionalOutputRoots }),
  }
  const runRoot = await mkdtemp(path.join(layout.isolatedRoot, 'real-profile-rehearsal-'))
  const sourceProfileDir = path.join(runRoot, 'source', 'browser-profile')
  const sourceStateDir = path.join(runRoot, 'source', 'workflow-data', '.workflow_state')
  const sourceOutputDir = path.join(runRoot, 'source', 'workflow-data', 'output')
  const targetProfileDir = path.join(runRoot, 'restored', 'browser-profile')
  const targetStateDir = path.join(runRoot, 'restored', 'workflow-data', '.workflow_state')
  const targetOutputDir = path.join(runRoot, 'restored', 'workflow-data', 'output')
  await Promise.all([
    mkdir(sourceProfileDir, { recursive: true }),
    mkdir(sourceStateDir, { recursive: true }),
    mkdir(sourceOutputDir, { recursive: true }),
    mkdir(targetProfileDir, { recursive: true }),
    mkdir(targetStateDir, { recursive: true }),
    mkdir(targetOutputDir, { recursive: true }),
  ])

  const [browserSnapshot, workflowDomains] = await Promise.all([
    exportChromiumOriginSnapshot({
      browserProfileDir: layout.browserProfileDir,
      browserOrigin: options.browserOrigin,
      isolatedRoot: runRoot,
    }),
    collectReadOnlyWorkflowDomains({
      workflowStateDir,
      workflowOutputDir,
      additionalOutputRoots,
      pythonCommand,
    }),
  ])
  before.browserLogical = browserSnapshotChecksum(browserSnapshot)
  if (browserSnapshot.networkRequests !== 0) {
    const error = new Error('Browser export attempted to use the daily service')
    error.code = 'REAL_PROFILE_BROWSER_NETWORK_FORBIDDEN'
    throw error
  }
  const excludedIds = new Set([...EXCLUDED_BROWSER_ROWS.media, ...EXCLUDED_BROWSER_ROWS.retired])
  const unexpectedRow = browserSnapshot.indexedDbRows.find((row) => (
    !isLiveBrowserRowId(row?.id) && !excludedIds.has(String(row?.id || ''))
  ))
  if (unexpectedRow) {
    const error = new Error('Browser export contains an unregistered durable row')
    error.code = 'REAL_PROFILE_BROWSER_ROW_UNREGISTERED'
    error.details = { rowId: String(unexpectedRow?.id || '') }
    throw error
  }
  const restorableBrowserRows = browserSnapshot.indexedDbRows.filter((row) => !excludedIds.has(String(row?.id || '')))
  await writeIsolatedBrowserProfile(sourceProfileDir, {
    indexedDbRows: restorableBrowserRows,
    localStorage: browserSnapshot.localStorage,
  })
  const release = options.release || {
    applicationVersion: 'real-profile-rehearsal',
    backendVersion: 'real-profile-rehearsal',
    gitSha: 'real-profile-rehearsal',
    releaseId: 'real-profile-rehearsal',
    manifestSha: null,
  }
  const source = await createReadWebProductionBackupComposition({
    isolationRoot: path.join(runRoot, 'source'),
    profileDir: sourceProfileDir,
    pythonStateDir: sourceStateDir,
    pythonOutputDir: sourceOutputDir,
    pythonCommand,
    release,
    maxRecordBytes: REAL_PROFILE_MAX_RECORD_BYTES,
    maxBackupBytes: REAL_PROFILE_MAX_BACKUP_BYTES,
  })
  const artifact = await source.service.createBackup({
    adapters: {
      ...source.adapters,
      'marks-activity': snapshotAdapter('marks-activity', workflowDomains['marks-activity']),
      workflow: snapshotAdapter('workflow', workflowDomains.workflow),
    },
  })
  const verification = await source.service.verifyBackup(artifact)
  if (!verification.valid) {
    const error = new Error('Real profile backup artifact verification failed')
    error.code = 'REAL_PROFILE_BACKUP_VERIFY_FAILED'
    error.details = verification.error
    throw error
  }
  const artifactPath = path.join(runRoot, 'real-profile-backup.json')
  await writeFile(artifactPath, `${JSON.stringify(artifact)}\n`, 'utf8')

  const targetOptions = {
    isolationRoot: path.join(runRoot, 'restored'),
    profileDir: targetProfileDir,
    pythonStateDir: targetStateDir,
    pythonOutputDir: targetOutputDir,
    pythonCommand,
    release,
    maxRecordBytes: REAL_PROFILE_MAX_RECORD_BYTES,
    maxBackupBytes: REAL_PROFILE_MAX_BACKUP_BYTES,
  }
  const target = await createReadWebProductionBackupComposition(targetOptions)
  const dryRun = await source.service.dryRunRestore(artifact, { target: target.restoreTarget })
  if (!dryRun.ok) {
    const error = new Error('Real profile restore dry-run failed')
    error.code = 'REAL_PROFILE_RESTORE_DRY_RUN_FAILED'
    error.details = { error: dryRun.error, blocked: dryRun.blocked }
    throw error
  }
  const restore = await source.service.restore(artifact, {
    target: target.restoreTarget,
    restoreId: `real-profile-${Date.now()}`,
  })
  if (restore.status !== 'completed') {
    const error = new Error('Real profile restore did not complete')
    error.code = 'REAL_PROFILE_RESTORE_INCOMPLETE'
    throw error
  }
  const reopened = await createReadWebProductionBackupComposition(targetOptions)
  const restoredArtifact = await reopened.createBackup()
  const journeys = validateRestoredDomainJourneys(restoredArtifact)
  const afterBrowserSnapshot = await exportChromiumOriginSnapshot({
    browserProfileDir: layout.browserProfileDir,
    browserOrigin: options.browserOrigin,
    isolatedRoot: runRoot,
  })
  if (afterBrowserSnapshot.networkRequests !== 0) {
    const error = new Error('Browser stability export attempted to use the daily service')
    error.code = 'REAL_PROFILE_BROWSER_NETWORK_FORBIDDEN'
    throw error
  }
  const after = {
    browserPhysical: await fingerprintChromiumOriginSource({
      browserProfileDir: layout.browserProfileDir,
      browserOrigin: options.browserOrigin,
    }),
    browserLogical: browserSnapshotChecksum(afterBrowserSnapshot),
    workflow: await fingerprintWorkflowSource({ workflowStateDir, workflowOutputDir, additionalOutputRoots }),
  }
  const sourceUnchanged = before.browserLogical === after.browserLogical && before.workflow === after.workflow
  if (!sourceUnchanged) {
    const error = new Error('Real profile source changed during the read-only rehearsal')
    error.code = 'REAL_PROFILE_SOURCE_CHANGED'
    error.details = {
      browserLogicalStable: before.browserLogical === after.browserLogical,
      workflowStable: before.workflow === after.workflow,
    }
    throw error
  }
  return Object.freeze({
    status: 'passed',
    sourceUnchanged,
    runRoot,
    artifactPath,
    restoredProfileDir: targetProfileDir,
    restoredWorkflowDataRoot: path.dirname(targetStateDir),
    recordCounts: artifact.manifest.recordCounts,
    domainChecksums: artifact.manifest.domainChecksums,
    restoredRecordCounts: restoredArtifact.manifest.recordCounts,
    restoredDomainChecksums: restoredArtifact.manifest.domainChecksums,
    artifactChecksum: artifact.checksum,
    journeys,
    browserEvidence: {
      databaseVersion: browserSnapshot.databaseVersion,
      blockedRequests: browserSnapshot.blockedRequests,
      networkRequests: browserSnapshot.networkRequests,
      excludedRows: EXCLUDED_BROWSER_ROWS,
      maxRecordBytes: REAL_PROFILE_MAX_RECORD_BYTES,
      maxBackupBytes: REAL_PROFILE_MAX_BACKUP_BYTES,
      logicalSourceStable: before.browserLogical === after.browserLogical,
      physicalProfileStable: before.browserPhysical === after.browserPhysical,
    },
  })
}
