import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, rm, stat } from 'node:fs/promises'
import path from 'node:path'

import {
  createReadWebProductionBackupComposition,
  writeJsonAtomic,
} from './read-web-production-backup.mjs'
import {
  collectReadOnlyWorkflowDomains,
  clearWorkflowWriterFreeze,
  materializeRealProfileSource,
  WORKFLOW_WRITER_ACTIVITY_FILE,
  writeWorkflowWriterFreeze,
} from './read-web-real-profile-rehearsal.mjs'
import {
  runWindowsOwnerProductionCutover,
  runWindowsOwnerProductionDryRun,
  runWindowsOwnerProductionRollback,
  WINDOWS_OWNER_CUTOVER_DOMAINS,
} from './windows-owner-cutover.mjs'

export const WINDOWS_OWNER_PRODUCTION_ENTRY_SCHEMA_VERSION = 1
export const WINDOWS_OWNER_PRODUCTION_DEFAULT_MAX_BACKUP_BYTES = 256 * 1024 * 1024
export const WINDOWS_OWNER_PRODUCTION_ENTRY_COMMANDS = Object.freeze([
  'plan',
  'inventory',
  'dry-run',
  'apply',
  'resume',
  'rollback',
])
export const WINDOWS_OWNER_PRODUCTION_ENTRY_MANIFEST = 'production-migration-run.json'
export const WINDOWS_OWNER_PRODUCTION_ENTRY_RESULT = 'production-entry-result.json'

const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAFE_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u
const SAFE_CHECKSUM = /^(?:sha256:)?[a-f0-9]{64}$/u
const MUTATING_COMMANDS = new Set(['apply', 'resume', 'rollback'])
const KNOWN_ENTRY_ARGUMENTS = new Set([
  'mode',
  'profile-id',
  'host-instance-id',
  'host-access-token-env',
  'browser-origin',
  'host-base-url',
  'browser-profile-dir',
  'workflow-data-root',
  'workflow-state-dir',
  'workflow-output-dir',
  'additional-output-root',
  'run-root',
  'target-isolation-root',
  'target-profile-dir',
  'target-python-state-dir',
  'target-python-output-dir',
  'target-profile-authority-isolation-root',
  'target-profile-authority-root',
  'migration-state-path',
  'browser-freeze-evidence',
  'browser-evidence-timeout-ms',
  'max-backup-bytes',
  'host-scope-file',
  'python-command',
  'rollback-domain',
  'confirm-owner-migration',
])
const WINDOWS_OWNER_ENTRY_SEQUENCE = Object.freeze([
  'read-only inventory',
  'dry-run/capacity-and-format-check',
  'freeze old writer',
  'final backup/checksum',
  'one-time final copy/import',
  'verify',
  'switch Host authoritative writer',
  'smoke check',
])

function entryError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))
}

function canonical(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw entryError('OWNER_PRODUCTION_ENTRY_CONFIGURATION', `${field} is required`, { field })
  }
  return value.trim()
}

function positiveSafeInteger(value, field) {
  const candidate = Number(value)
  if (!Number.isSafeInteger(candidate) || candidate < 1) {
    throw entryError('OWNER_PRODUCTION_ENTRY_CONFIGURATION', `${field} must be a positive safe integer`, { field })
  }
  return candidate
}

function requireAbsolutePath(value, field) {
  const candidate = requireString(value, field)
  if (!path.isAbsolute(candidate)) {
    throw entryError('OWNER_PRODUCTION_ENTRY_CONFIGURATION', `${field} must be an explicit absolute path`, { field })
  }
  return path.resolve(candidate)
}

async function existingDirectory(value, field) {
  const candidate = requireAbsolutePath(value, field)
  let resolved
  try { resolved = await realpath(candidate) } catch {
    throw entryError('OWNER_PRODUCTION_ENTRY_PATH_INVALID', `${field} must be an existing directory`, { field })
  }
  try {
    if (!(await stat(resolved)).isDirectory()) throw new Error('not-directory')
  } catch {
    throw entryError('OWNER_PRODUCTION_ENTRY_PATH_INVALID', `${field} must be an existing directory`, { field })
  }
  return resolved
}

async function existingFile(value, field) {
  const candidate = requireAbsolutePath(value, field)
  let resolved
  try { resolved = await realpath(candidate) } catch {
    throw entryError('OWNER_PRODUCTION_ENTRY_PATH_INVALID', `${field} must be an existing file`, { field })
  }
  try {
    if (!(await stat(resolved)).isFile()) throw new Error('not-file')
  } catch {
    throw entryError('OWNER_PRODUCTION_ENTRY_PATH_INVALID', `${field} must be an existing file`, { field })
  }
  return resolved
}

function overlaps(left, right) {
  const relative = path.relative(left, right)
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function assertStrictChild(root, value, field) {
  if (!overlaps(root, value) || path.resolve(root) === path.resolve(value)) {
    throw entryError('OWNER_PRODUCTION_ENTRY_PATH_INVALID', `${field} must remain inside its declared root`, { field })
  }
  return value
}

function assertNoOverlap(left, right, leftField, rightField) {
  if (overlaps(left, right) || overlaps(right, left)) {
    throw entryError('OWNER_PRODUCTION_ENTRY_PATH_INVALID', `${leftField} and ${rightField} must not overlap`, {
      leftField,
      rightField,
    })
  }
}

function origin(value, field) {
  const raw = requireString(value, field)
  let parsed
  try { parsed = new URL(raw) } catch {
    throw entryError('OWNER_PRODUCTION_ENTRY_CONFIGURATION', `${field} must be an HTTP(S) origin`, { field })
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw entryError('OWNER_PRODUCTION_ENTRY_CONFIGURATION', `${field} must not contain a path, query, hash, or credentials`, { field })
  }
  return parsed.origin
}

function loopbackOrigin(value, field) {
  const parsed = new URL(origin(value, field))
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname.toLowerCase())) {
    throw entryError('OWNER_PRODUCTION_ENTRY_CONFIGURATION', `${field} must be a loopback origin`, { field })
  }
  return parsed.origin
}

function safeIdentity(value, field) {
  const candidate = requireString(value, field)
  if (!SAFE_IDENTITY.test(candidate)) {
    throw entryError('OWNER_PRODUCTION_ENTRY_CONFIGURATION', `${field} is invalid`, { field })
  }
  return candidate
}

function safeEnvironmentName(value) {
  const candidate = safeIdentity(value, 'hostAccessTokenEnv')
  if (!SAFE_ENV_NAME.test(candidate)) {
    throw entryError('OWNER_PRODUCTION_ENTRY_CONFIGURATION', 'hostAccessTokenEnv is invalid', { field: 'hostAccessTokenEnv' })
  }
  return candidate
}

function safeChecksum(value, field) {
  if (typeof value !== 'string' || !SAFE_CHECKSUM.test(value)) {
    throw entryError('OWNER_PRODUCTION_ENTRY_EVIDENCE_INVALID', `${field} is invalid`, { field })
  }
  return value
}

function lexicalChild(root, value, field) {
  const candidate = requireAbsolutePath(value, field)
  if (!overlaps(path.resolve(root), candidate) || path.resolve(root) === candidate) {
    throw entryError('OWNER_PRODUCTION_ENTRY_PATH_INVALID', `${field} must be a strict child of its root`, { field })
  }
  return candidate
}

function readCommand(args) {
  const command = args[0]
  if (!WINDOWS_OWNER_PRODUCTION_ENTRY_COMMANDS.includes(command)) {
    throw entryError(
      'OWNER_PRODUCTION_ENTRY_COMMAND_INVALID',
      `command must be one of: ${WINDOWS_OWNER_PRODUCTION_ENTRY_COMMANDS.join(', ')}`,
    )
  }
  const values = {}
  const additionalOutputRoots = []
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!name?.startsWith('--') || typeof value !== 'string' || value.startsWith('--')) {
      throw entryError('OWNER_PRODUCTION_ENTRY_ARGUMENT_INVALID', 'arguments must use explicit --name value pairs')
    }
    const key = name.slice(2)
    if (!key) throw entryError('OWNER_PRODUCTION_ENTRY_ARGUMENT_INVALID', 'argument name is empty')
    if (!KNOWN_ENTRY_ARGUMENTS.has(key)) {
      throw entryError('OWNER_PRODUCTION_ENTRY_ARGUMENT_INVALID', `unknown argument: --${key}`)
    }
    if (key === 'additional-output-root') additionalOutputRoots.push(value)
    else if (Object.prototype.hasOwnProperty.call(values, key)) {
      throw entryError('OWNER_PRODUCTION_ENTRY_ARGUMENT_INVALID', `duplicate argument: --${key}`)
    } else values[key] = value
  }
  return { command, values, additionalOutputRoots }
}

export function parseWindowsOwnerProductionEntryArguments(args = []) {
  if (!Array.isArray(args)) throw entryError('OWNER_PRODUCTION_ENTRY_ARGUMENT_INVALID', 'arguments must be an array')
  return readCommand(args)
}

function requireConfirmation(command, values) {
  if (!MUTATING_COMMANDS.has(command)) return
  const expected = command.toUpperCase()
  if (values['confirm-owner-migration'] !== expected) {
    throw entryError(
      'OWNER_PRODUCTION_ENTRY_OPT_IN_REQUIRED',
      `--confirm-owner-migration ${expected} is required for ${command}`,
    )
  }
}

export async function validateWindowsOwnerProductionEntryOptions(parsed) {
  const { command, values, additionalOutputRoots = [] } = parsed?.command
    ? parsed
    : readCommand(parsed)
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw entryError('OWNER_PRODUCTION_ENTRY_ARGUMENT_INVALID', 'parsed entry values are invalid')
  }
  const mode = requireString(values.mode, 'mode')
  if (mode !== 'optimization') {
    throw entryError('OWNER_PRODUCTION_ENTRY_OPTIMIZATION_ONLY', 'mode must be optimization')
  }
  requireConfirmation(command, values)
  const profileId = safeIdentity(values['profile-id'], 'profile-id')
  const hostInstanceId = safeIdentity(values['host-instance-id'], 'host-instance-id')
  const hostAccessTokenEnv = safeEnvironmentName(values['host-access-token-env'])
  const browserOrigin = origin(values['browser-origin'], 'browser-origin')
  const hostBaseUrl = loopbackOrigin(values['host-base-url'], 'host-base-url')
  const browserProfileDir = await existingDirectory(values['browser-profile-dir'], 'browser-profile-dir')
  const workflowDataRoot = await existingDirectory(values['workflow-data-root'], 'workflow-data-root')
  const workflowStateDir = await existingDirectory(values['workflow-state-dir'], 'workflow-state-dir')
  const workflowOutputDir = await existingDirectory(values['workflow-output-dir'], 'workflow-output-dir')
  const runRoot = await existingDirectory(values['run-root'], 'run-root')
  const targetIsolationRoot = await existingDirectory(values['target-isolation-root'], 'target-isolation-root')
  const targetProfileDir = await existingDirectory(values['target-profile-dir'], 'target-profile-dir')
  const targetPythonStateDir = await existingDirectory(values['target-python-state-dir'], 'target-python-state-dir')
  const targetPythonOutputDir = await existingDirectory(values['target-python-output-dir'], 'target-python-output-dir')
  const targetProfileAuthorityIsolationRoot = await existingDirectory(
    values['target-profile-authority-isolation-root'],
    'target-profile-authority-isolation-root',
  )
  const targetProfileAuthorityRoot = await existingDirectory(
    values['target-profile-authority-root'],
    'target-profile-authority-root',
  )
  assertStrictChild(workflowDataRoot, workflowStateDir, 'workflow-state-dir')
  assertStrictChild(workflowDataRoot, workflowOutputDir, 'workflow-output-dir')
  assertStrictChild(targetIsolationRoot, targetProfileDir, 'target-profile-dir')
  assertStrictChild(targetIsolationRoot, targetPythonStateDir, 'target-python-state-dir')
  assertStrictChild(targetIsolationRoot, targetPythonOutputDir, 'target-python-output-dir')
  assertStrictChild(targetProfileAuthorityIsolationRoot, targetProfileAuthorityRoot, 'target-profile-authority-root')

  const additionalRoots = []
  for (const [index, value] of additionalOutputRoots.entries()) {
    additionalRoots.push(await existingDirectory(value, `additional-output-root[${index}]`))
  }
  assertNoOverlap(runRoot, browserProfileDir, 'run-root', 'browser-profile-dir')
  assertNoOverlap(runRoot, workflowDataRoot, 'run-root', 'workflow-data-root')
  assertNoOverlap(runRoot, targetIsolationRoot, 'run-root', 'target-isolation-root')
  assertNoOverlap(runRoot, targetProfileAuthorityIsolationRoot, 'run-root', 'target-profile-authority-isolation-root')
  assertNoOverlap(browserProfileDir, targetIsolationRoot, 'browser-profile-dir', 'target-isolation-root')
  assertNoOverlap(workflowDataRoot, targetIsolationRoot, 'workflow-data-root', 'target-isolation-root')
  assertNoOverlap(browserProfileDir, targetProfileAuthorityIsolationRoot, 'browser-profile-dir', 'target-profile-authority-isolation-root')
  assertNoOverlap(workflowDataRoot, targetProfileAuthorityIsolationRoot, 'workflow-data-root', 'target-profile-authority-isolation-root')
  assertNoOverlap(targetIsolationRoot, targetProfileAuthorityIsolationRoot, 'target-isolation-root', 'target-profile-authority-isolation-root')
  for (const [index, root] of additionalRoots.entries()) {
    assertNoOverlap(runRoot, root, 'run-root', `additional-output-root[${index}]`)
    assertNoOverlap(targetIsolationRoot, root, 'target-isolation-root', `additional-output-root[${index}]`)
    assertNoOverlap(targetProfileAuthorityIsolationRoot, root, 'target-profile-authority-isolation-root', `additional-output-root[${index}]`)
  }

  const migrationStatePath = lexicalChild(targetProfileAuthorityRoot, values['migration-state-path'], 'migration-state-path')
  const manifestPath = path.join(runRoot, WINDOWS_OWNER_PRODUCTION_ENTRY_MANIFEST)
  const resultPath = path.join(runRoot, WINDOWS_OWNER_PRODUCTION_ENTRY_RESULT)
  const browserFreezeEvidencePath = values['browser-freeze-evidence']
    ? lexicalChild(runRoot, values['browser-freeze-evidence'], 'browser-freeze-evidence')
    : null
  if (MUTATING_COMMANDS.has(command) && !browserFreezeEvidencePath && command !== 'rollback') {
    throw entryError('OWNER_PRODUCTION_ENTRY_EVIDENCE_REQUIRED', 'browser-freeze-evidence is required for apply/resume')
  }
  const rollbackDomain = command === 'rollback'
    ? safeIdentity(values['rollback-domain'], 'rollback-domain')
    : null
  if (rollbackDomain && !WINDOWS_OWNER_CUTOVER_DOMAINS.includes(rollbackDomain)) {
    throw entryError('OWNER_PRODUCTION_ENTRY_DOMAIN_INVALID', 'rollback-domain is not a registered owner domain')
  }
  const hostScopeFile = values['host-scope-file']
    ? await existingFile(values['host-scope-file'], 'host-scope-file')
    : null
  const pythonCommand = values['python-command'] ? requireString(values['python-command'], 'python-command') : null
  const maxBackupBytes = values['max-backup-bytes'] === undefined
    ? WINDOWS_OWNER_PRODUCTION_DEFAULT_MAX_BACKUP_BYTES
    : positiveSafeInteger(values['max-backup-bytes'], 'max-backup-bytes')
  const evidenceWaitMs = values['browser-evidence-timeout-ms'] === undefined
    ? 30_000
    : Number(values['browser-evidence-timeout-ms'])
  if (!Number.isInteger(evidenceWaitMs) || evidenceWaitMs < 0 || evidenceWaitMs > 60_000) {
    throw entryError('OWNER_PRODUCTION_ENTRY_CONFIGURATION', 'browser-evidence-timeout-ms must be an integer from 0 to 60000')
  }
  return Object.freeze({
    command,
    mode,
    profileId,
    hostInstanceId,
    hostAccessTokenEnv,
    browserOrigin,
    hostBaseUrl,
    browserProfileDir,
    workflowDataRoot,
    workflowStateDir,
    workflowOutputDir,
    additionalOutputRoots: Object.freeze(additionalRoots),
    runRoot,
    target: Object.freeze({
      isolationRoot: targetIsolationRoot,
      profileDir: targetProfileDir,
      pythonStateDir: targetPythonStateDir,
      pythonOutputDir: targetPythonOutputDir,
      profileAuthorityIsolationRoot: targetProfileAuthorityIsolationRoot,
      profileAuthorityRoot: targetProfileAuthorityRoot,
    }),
    migrationStatePath,
    manifestPath,
    resultPath,
    browserFreezeEvidencePath,
    browserEvidenceTimeoutMs: evidenceWaitMs,
    hostScopeFile,
    pythonCommand,
    maxBackupBytes,
    rollbackDomain,
  })
}

function relativeWithin(root, value, field) {
  const relative = path.relative(root, value)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw entryError('OWNER_PRODUCTION_ENTRY_PATH_INVALID', `${field} escaped its run root`, { field })
  }
  return relative
}

function resolveRunRelative(root, value, field) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    throw entryError('OWNER_PRODUCTION_ENTRY_MANIFEST_INVALID', `${field} is not a relative path`, { field })
  }
  const resolved = path.resolve(root, value)
  if (!overlaps(root, resolved) || path.resolve(root) === resolved) {
    throw entryError('OWNER_PRODUCTION_ENTRY_MANIFEST_INVALID', `${field} escaped the run root`, { field })
  }
  return resolved
}

function resolveStrictRelative(root, value, field) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    throw entryError('OWNER_PRODUCTION_ENTRY_MANIFEST_INVALID', `${field} is not a relative path`, { field })
  }
  const resolved = path.resolve(root, value)
  if (!overlaps(path.resolve(root), resolved) || path.resolve(root) === resolved) {
    throw entryError('OWNER_PRODUCTION_ENTRY_MANIFEST_INVALID', `${field} escaped its declared root`, { field })
  }
  return resolved
}

async function pathExists(filePath) {
  try { await stat(filePath); return true } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function readJson(filePath, code) {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not-object')
    return value
  } catch (error) {
    if (error?.code === 'ENOENT') throw entryError(code, 'required JSON file is missing')
    if (error?.code === code) throw error
    throw entryError(code, 'required JSON file is invalid')
  }
}

function snapshotAdapter(key, snapshot) {
  return {
    key,
    schemaVersion: snapshot?.schemaVersion ?? 1,
    adapterVersion: snapshot?.adapterVersion ?? 1,
    supportedSchemaVersions: [snapshot?.schemaVersion ?? 1],
    async collect() { return clone(snapshot) },
  }
}

async function sourceArtifact(stage, config) {
  const composition = await createReadWebProductionBackupComposition({
    ...stage.source,
    profileId: config.profileId,
    pythonCommand: config.pythonCommand || undefined,
    maxBackupBytes: config.maxBackupBytes,
    profileLeaseMode: 'standby',
  })
  const artifact = await composition.service.createBackup({
    limits: { maxBackupBytes: config.maxBackupBytes },
    adapters: {
      ...composition.adapters,
      'marks-activity': snapshotAdapter('marks-activity', stage.workflowDomains['marks-activity']),
      workflow: snapshotAdapter('workflow', stage.workflowDomains.workflow),
    },
  })
  const verification = await composition.service.verifyBackup(artifact, { maxBackupBytes: config.maxBackupBytes })
  if (!verification.valid) throw entryError('OWNER_PRODUCTION_ENTRY_INVENTORY_INVALID', 'source artifact verification failed')
  return artifact
}

async function materializeStage(config) {
  const stage = await materializeRealProfileSource({
    browserProfileDir: config.browserProfileDir,
    browserOrigin: config.browserOrigin,
    workflowDataRoot: config.workflowDataRoot,
    workflowStateDir: config.workflowStateDir,
    workflowOutputDir: config.workflowOutputDir,
    additionalOutputRoots: config.additionalOutputRoots,
    isolatedRoot: config.runRoot,
    pythonCommand: config.pythonCommand || undefined,
  })
  const workflowDomains = await readJson(stage.workflowSnapshotsPath, 'OWNER_PRODUCTION_ENTRY_SOURCE_SNAPSHOT_INVALID')
  if (!workflowDomains.workflow || !workflowDomains['marks-activity']) {
    throw entryError('OWNER_PRODUCTION_ENTRY_SOURCE_SNAPSHOT_INVALID', 'staged workflow snapshots are incomplete')
  }
  return Object.freeze({ ...stage, workflowDomains })
}

async function cleanupStage(stage, runRoot) {
  if (!stage?.runRoot) return
  const resolved = path.resolve(stage.runRoot)
  if (!overlaps(path.resolve(runRoot), resolved) || resolved === path.resolve(runRoot)) return
  await rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 250,
  })
}

function createWorkflowLegacyWriterControl(config, manifest) {
  return {
    async freeze({ domain }) {
      if (domain !== 'workflow') return { ok: true, status: 'not-applicable' }
      return writeWorkflowWriterFreeze({
        workflowStateDir: config.workflowStateDir,
        profileId: config.profileId,
        challenge: manifest.freezeChallenge,
        sourceFingerprint: manifest.sourceFingerprint,
      })
    },
    async unfreeze({ domain, reason }) {
      if (domain !== 'workflow') return { ok: true, status: 'not-applicable' }
      if (reason === 'migration-authoritative') {
        return { ok: true, status: 'retired', writerBlocked: true }
      }
      return clearWorkflowWriterFreeze({
        workflowStateDir: config.workflowStateDir,
        profileId: config.profileId,
        challenge: manifest.freezeChallenge,
      })
    },
  }
}

export async function waitForWorkflowWriterQuiescence(config) {
  const activityPath = path.join(config.workflowStateDir, WORKFLOW_WRITER_ACTIVITY_FILE)
  const deadline = Date.now() + config.browserEvidenceTimeoutMs
  while (await pathExists(activityPath)) {
    let activity = null
    try {
      activity = JSON.parse(await readFile(activityPath, 'utf8'))
      if (!activity || typeof activity !== 'object' || Array.isArray(activity)) throw new Error('not-object')
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw entryError('OWNER_PRODUCTION_ENTRY_WORKFLOW_ACTIVITY_INVALID', 'workflow writer activity marker is invalid')
    }
    const activityPid = Number(activity?.pid)
    if (Number.isInteger(activityPid) && activityPid > 0) {
      let processAlive = true
      try { process.kill(activityPid, 0) } catch (error) {
        if (error?.code === 'ESRCH') processAlive = false
      }
      if (!processAlive) {
        let currentActivity = null
        try { currentActivity = JSON.parse(await readFile(activityPath, 'utf8')) } catch (error) {
          if (error?.code === 'ENOENT') continue
          throw error
        }
        if (Number(currentActivity?.pid) === activityPid
          && currentActivity?.jobId === activity?.jobId) {
          await rm(activityPath, { force: true })
        }
        continue
      }
    }
    if (Date.now() >= deadline) {
      throw entryError(
        'OWNER_PRODUCTION_ENTRY_WORKFLOW_ACTIVE',
        'workflow writer freeze is waiting for an already-running worker to finish',
        { jobId: typeof activity?.jobId === 'string' ? activity.jobId : null },
      )
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))))
  }
  return { ok: true, status: 'quiescent', activityPath }
}

async function refreshProductionSourceAfterFreeze(config, manifest, domain, refreshedStages) {
  if (domain === 'workflow') {
    await writeWorkflowWriterFreeze({
      workflowStateDir: config.workflowStateDir,
      profileId: config.profileId,
      challenge: manifest.freezeChallenge,
      sourceFingerprint: manifest.sourceFingerprint,
    })
    await waitForWorkflowWriterQuiescence(config)
  }
  const stage = await materializeStage(config)
  refreshedStages.push(stage)
  const composition = await createReadWebProductionBackupComposition({
    ...stage.source,
    profileId: config.profileId,
    pythonCommand: config.pythonCommand || undefined,
    maxBackupBytes: config.maxBackupBytes,
    profileLeaseMode: 'standby',
  })
  return {
    sourceComposition: composition,
    sourceDomainSnapshots: stage.workflowDomains,
    sourceCapture: {
      kind: 'post-freeze-live-source-capture',
      domain,
      capturedAt: new Date().toISOString(),
      fingerprints: {
        browserPhysical: stage.sourceFingerprint.browserPhysical,
        browserLogical: stage.sourceFingerprint.browserLogical,
        workflow: stage.sourceFingerprint.workflow,
      },
      initialFingerprints: clone(manifest.sourceFingerprint),
    },
  }
}

function sourceBinding(config) {
  return digest({
    browserProfileDir: config.browserProfileDir,
    browserOrigin: config.browserOrigin,
    workflowDataRoot: config.workflowDataRoot,
    workflowStateDir: config.workflowStateDir,
    workflowOutputDir: config.workflowOutputDir,
    additionalOutputRoots: [...config.additionalOutputRoots],
  })
}

function targetBinding(config) {
  return digest(config.target)
}

function createRunManifest(config, stage) {
  const runId = randomUUID()
  return {
    schemaVersion: WINDOWS_OWNER_PRODUCTION_ENTRY_SCHEMA_VERSION,
    kind: 'read-web.windows-owner-production-run',
    runId,
    mode: config.mode,
    profileId: config.profileId,
    browserOrigin: config.browserOrigin,
    sourceBinding: sourceBinding(config),
    targetBinding: targetBinding(config),
    maxBackupBytes: config.maxBackupBytes,
    sourceFingerprint: clone(stage.sourceFingerprint),
    freezeChallenge: runId,
    idempotencyPrefix: `owner-${runId}`,
    source: {
      stageRoot: relativeWithin(config.runRoot, stage.runRoot, 'source.stageRoot'),
      profileDir: relativeWithin(config.runRoot, stage.source.profileDir, 'source.profileDir'),
      pythonStateDir: relativeWithin(config.runRoot, stage.source.pythonStateDir, 'source.pythonStateDir'),
      pythonOutputDir: relativeWithin(config.runRoot, stage.source.pythonOutputDir, 'source.pythonOutputDir'),
      workflowSnapshots: relativeWithin(config.runRoot, stage.workflowSnapshotsPath, 'source.workflowSnapshots'),
    },
    statePath: path.relative(config.target.profileAuthorityRoot, config.migrationStatePath),
    createdAt: new Date().toISOString(),
  }
}

async function loadRun(config) {
  const manifest = await readJson(config.manifestPath, 'OWNER_PRODUCTION_ENTRY_MANIFEST_INVALID')
  if (manifest.schemaVersion !== WINDOWS_OWNER_PRODUCTION_ENTRY_SCHEMA_VERSION
    || manifest.kind !== 'read-web.windows-owner-production-run'
    || manifest.mode !== 'optimization'
    || manifest.profileId !== config.profileId
    || manifest.browserOrigin !== config.browserOrigin
    || manifest.sourceBinding !== sourceBinding(config)
    || manifest.targetBinding !== targetBinding(config)
    || manifest.maxBackupBytes !== config.maxBackupBytes
    || !SAFE_CHECKSUM.test(String(manifest.sourceFingerprint?.browserPhysical || ''))
    || !SAFE_CHECKSUM.test(String(manifest.sourceFingerprint?.workflow || ''))
    || !manifest.source || typeof manifest.source !== 'object'
    || !SAFE_IDENTITY.test(String(manifest.freezeChallenge || ''))
    || !SAFE_IDENTITY.test(String(manifest.idempotencyPrefix || ''))) {
    throw entryError('OWNER_PRODUCTION_ENTRY_MANIFEST_INVALID', 'run manifest does not match the explicit invocation')
  }
  const source = {
    isolationRoot: resolveRunRelative(config.runRoot, manifest.source.stageRoot, 'source.stageRoot'),
    profileDir: resolveRunRelative(config.runRoot, manifest.source.profileDir, 'source.profileDir'),
    pythonStateDir: resolveRunRelative(config.runRoot, manifest.source.pythonStateDir, 'source.pythonStateDir'),
    pythonOutputDir: resolveRunRelative(config.runRoot, manifest.source.pythonOutputDir, 'source.pythonOutputDir'),
  }
  for (const [field, value] of Object.entries(source)) {
    source[field] = await existingDirectory(value, `manifest.${field}`)
  }
  const workflowSnapshotsPath = resolveRunRelative(config.runRoot, manifest.source.workflowSnapshots, 'source.workflowSnapshots')
  assertStrictChild(config.runRoot, source.isolationRoot, 'manifest.source.stageRoot')
  assertStrictChild(source.isolationRoot, source.profileDir, 'manifest.source.profileDir')
  assertStrictChild(source.isolationRoot, source.pythonStateDir, 'manifest.source.pythonStateDir')
  assertStrictChild(source.isolationRoot, source.pythonOutputDir, 'manifest.source.pythonOutputDir')
  assertStrictChild(source.isolationRoot, workflowSnapshotsPath, 'manifest.source.workflowSnapshots')
  const canonicalWorkflowSnapshotsPath = await existingFile(workflowSnapshotsPath, 'manifest.source.workflowSnapshots')
  assertStrictChild(source.isolationRoot, canonicalWorkflowSnapshotsPath, 'manifest.source.workflowSnapshots')
  const workflowDomains = await readJson(canonicalWorkflowSnapshotsPath, 'OWNER_PRODUCTION_ENTRY_SOURCE_SNAPSHOT_INVALID')
  if (!workflowDomains.workflow || !workflowDomains['marks-activity']) {
    throw entryError('OWNER_PRODUCTION_ENTRY_SOURCE_SNAPSHOT_INVALID', 'run source workflow snapshots are incomplete')
  }
  const manifestStatePath = resolveStrictRelative(
    config.target.profileAuthorityRoot,
    manifest.statePath,
    'statePath',
  )
  if (path.resolve(config.migrationStatePath) !== manifestStatePath) {
    throw entryError('OWNER_PRODUCTION_ENTRY_MANIFEST_INVALID', 'migration state path does not match the run manifest')
  }
  return Object.freeze({
    manifest,
    source: Object.freeze(source),
    workflowDomains,
    workflowSnapshotsPath: canonicalWorkflowSnapshotsPath,
  })
}

async function readHostToken(config, required) {
  const value = process.env[config.hostAccessTokenEnv]
  if (required && (!value || !String(value).trim())) {
    throw entryError('OWNER_PRODUCTION_ENTRY_HOST_TOKEN_REQUIRED', 'the configured host access-token environment variable is empty')
  }
  return value ? String(value).trim() : null
}

async function readHostScopes(config) {
  if (!config.hostScopeFile) return {}
  const value = await readJson(config.hostScopeFile, 'OWNER_PRODUCTION_ENTRY_HOST_SCOPE_INVALID')
  return value
}

function evidenceEntries(value) {
  if (Array.isArray(value.entries)) return value.entries
  return [value]
}

function evidenceForDomain(value, domain) {
  return evidenceEntries(value).find((entry) => entry && entry.domain === domain) || null
}

async function readBrowserFreezeEvidence(config) {
  let resolved
  try {
    resolved = await realpath(config.browserFreezeEvidencePath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw entryError('OWNER_PRODUCTION_ENTRY_EVIDENCE_REQUIRED', 'browser freeze evidence was not provided')
    }
    throw entryError('OWNER_PRODUCTION_ENTRY_EVIDENCE_INVALID', 'browser freeze evidence path could not be resolved')
  }
  if (!overlaps(path.resolve(config.runRoot), resolved) || path.resolve(config.runRoot) === resolved) {
    throw entryError('OWNER_PRODUCTION_ENTRY_EVIDENCE_INVALID', 'browser freeze evidence escaped the run root')
  }
  return readJson(resolved, 'OWNER_PRODUCTION_ENTRY_EVIDENCE_INVALID')
}

function validateBrowserEvidence(entry, config, manifest, domain) {
  if (!entry || entry.schemaVersion !== 'read-web.browser-writer-freeze-evidence.v1'
    || entry.kind !== 'live-browser-owner-freeze'
    || entry.profileId !== config.profileId
    || entry.browserOrigin !== config.browserOrigin
    || entry.domain !== domain
    || entry.challenge !== manifest.freezeChallenge
    || entry.sourceFingerprint !== manifest.sourceFingerprint.browserPhysical
    || !SAFE_CHECKSUM.test(String(entry.sourceFingerprint || ''))
    || !Array.isArray(entry.guard?.observedFrozenDomains)
    || !entry.guard.observedFrozenDomains.includes(domain)
    || entry.guard.implementation !== 'windows-owner-domain-cutover'
    || entry.guard.status !== 'frozen'
    || entry.guard.writerBlocked !== true
    || entry.guard.assertion !== 'assertBrowserWriterAllowed-rejected'
    || typeof entry.capturedAt !== 'string'
    || !Number.isFinite(Date.parse(entry.capturedAt))) {
    throw entryError('OWNER_PRODUCTION_ENTRY_EVIDENCE_INVALID', 'browser freeze evidence is not a live guarded assertion', { domain })
  }
  return entry
}

async function waitForBrowserEvidence(config, manifest, domain) {
  const deadline = Date.now() + config.browserEvidenceTimeoutMs
  let lastError = null
  while (true) {
    try {
      const value = await readBrowserFreezeEvidence(config)
      const entry = evidenceForDomain(value, domain)
      if (!entry) throw entryError('OWNER_PRODUCTION_ENTRY_EVIDENCE_REQUIRED', 'browser freeze evidence for the domain was not provided')
      return validateBrowserEvidence(entry, config, manifest, domain)
    } catch (error) {
      lastError = error
      if (error?.code !== 'OWNER_PRODUCTION_ENTRY_EVIDENCE_REQUIRED') throw error
    }
    if (Date.now() >= deadline) {
      throw lastError || entryError('OWNER_PRODUCTION_ENTRY_EVIDENCE_REQUIRED', 'browser freeze evidence was not provided')
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))))
  }
}

async function readHostHealth(config, token) {
  let response
  try {
    response = await fetch(`${config.hostBaseUrl}/api/app/health`, {
      method: 'GET',
      headers: { accept: 'application/json', 'X-Read-Web-Token': token },
      cache: 'no-store',
    })
  } catch {
    throw entryError('OWNER_PRODUCTION_ENTRY_HOST_UNAVAILABLE', 'Host health could not be read')
  }
  if (!response.ok) throw entryError('OWNER_PRODUCTION_ENTRY_HOST_UNAVAILABLE', 'Host health was not ready')
  try { return await response.json() } catch {
    throw entryError('OWNER_PRODUCTION_ENTRY_HOST_UNAVAILABLE', 'Host health response was invalid')
  }
}

function assertHostFreeze(health, config, domain) {
  if (!health || health.profileId !== config.profileId
    || health.instanceId !== config.hostInstanceId
    || !health.ownerMode?.frozenDomains?.includes?.(domain)
    || health.domains?.find?.((item) => item?.domain === domain)?.writerFrozen !== true
    || health.ownerMode?.authoritativeDomains?.includes?.(domain)) {
    throw entryError('OWNER_PRODUCTION_ENTRY_HOST_FREEZE_NOT_OBSERVED', 'Host did not expose the requested frozen writer', { domain })
  }
  return health
}

function createBrowserFreezeVerifier(config, manifest, token) {
  return async ({ domain }) => {
    const evidence = await waitForBrowserEvidence(config, manifest, domain)
    const health = assertHostFreeze(await readHostHealth(config, token), config, domain)
    return {
      ok: true,
      observedFrozen: true,
      frozenDomains: [...health.ownerMode.frozenDomains],
      evidenceKind: evidence.kind,
      guardImplementation: evidence.guard.implementation,
    }
  }
}

function idempotencyKeys(manifest) {
  return Object.fromEntries(WINDOWS_OWNER_CUTOVER_DOMAINS.map((domain) => [
    domain,
    `${manifest.idempotencyPrefix}-${domain}`.slice(0, 127),
  ]))
}

function summarizeStep(step) {
  if (!step || typeof step !== 'object') return null
  const summary = {}
  for (const key of [
    'ok', 'status', 'outcome', 'commitStatus', 'reasonCode', 'revision', 'currentRevision',
    'receiptId', 'idempotent', 'observedFrozen', 'evidenceKind', 'guardImplementation',
  ]) {
    if (step[key] !== undefined) summary[key] = step[key]
  }
  if (step.sourceCapture?.kind) {
    summary.sourceCapture = {
      kind: step.sourceCapture.kind,
      domain: step.sourceCapture.domain,
      capturedAt: step.sourceCapture.capturedAt,
      fingerprints: clone(step.sourceCapture.fingerprints),
    }
  }
  const finalBackup = step.finalBackup?.finalBackup || step.finalBackup
  if (finalBackup?.artifactChecksum) summary.finalBackupChecksum = finalBackup.artifactChecksum
  if (finalBackup?.rollbackTarget?.checksum) summary.rollbackTargetChecksum = finalBackup.rollbackTarget.checksum
  return summary
}

function summarizeDomain(domainResult) {
  const steps = {}
  for (const [name, value] of Object.entries(domainResult?.steps || {})) steps[name] = summarizeStep(value)
  return {
    domain: domainResult?.domain || null,
    ok: domainResult?.ok === true,
    status: domainResult?.status || null,
    stopped: domainResult?.stopped === true,
    resumed: domainResult?.resumed === true,
    steps,
  }
}

function summarizeResult(result) {
  return {
    ok: result?.ok === true,
    operation: result?.operation || null,
    readOnly: result?.readOnly === true,
    domains: Array.isArray(result?.domains) ? result.domains.map(summarizeDomain) : [],
    stoppedAt: Array.isArray(result?.domains)
      ? result.domains.find((value) => value?.stopped === true)?.domain || null
      : null,
    status: result?.status || null,
  }
}

function commonReport(config, extra = {}) {
  return {
    schemaVersion: `read-web.windows-owner-production-entry.v${WINDOWS_OWNER_PRODUCTION_ENTRY_SCHEMA_VERSION}`,
    command: config.command,
    mode: config.mode,
    write: MUTATING_COMMANDS.has(config.command),
    fixedDomainOrder: [...WINDOWS_OWNER_CUTOVER_DOMAINS],
    sequence: [...WINDOWS_OWNER_ENTRY_SEQUENCE],
    source: {
      browserOrigin: config.browserOrigin,
      sourceAndTargetExplicit: true,
    },
    safeguards: {
      normalStartupInvokesEntry: false,
      optimizationOnly: true,
      browserGuardMustBeLiveEvidence: true,
      mediaPolicy: 'identity-reference-metadata-only',
      indexedDbSchema: 'SeekPlayerDB v1/files/id frozen',
    },
    backupLimits: {
      maxBackupBytes: config.maxBackupBytes,
    },
    ...extra,
  }
}

function artifactSummary(artifact) {
  return {
    artifactChecksum: artifact.artifactChecksum,
    recordCounts: artifact.manifest.recordCounts,
    domainChecksums: artifact.manifest.domainChecksums,
    mediaReferences: artifact.manifest.mediaReferences,
  }
}

async function executeInventory(config) {
  let stage
  try {
    stage = await materializeStage(config)
    const artifact = await sourceArtifact(stage, config)
    return commonReport(config, {
      status: 'ready',
      result: {
        ok: true,
        operation: 'inventory',
        readOnly: true,
        sourceFingerprint: stage.sourceFingerprint,
        browserEvidence: stage.browserEvidence,
        artifact: artifactSummary(artifact),
      },
    })
  } finally {
    await cleanupStage(stage, config.runRoot)
  }
}

async function executeDryRun(config) {
  let stage
  try {
    stage = await materializeStage(config)
    const token = await readHostToken(config, true)
    const hostScopeByDomain = await readHostScopes(config)
    const result = await runWindowsOwnerProductionDryRun({
      mode: config.mode,
      explicitOptIn: true,
      profileId: config.profileId,
      source: stage.source,
      target: config.target,
      domains: WINDOWS_OWNER_CUTOVER_DOMAINS,
      sourceDomainSnapshots: stage.workflowDomains,
      hostBaseUrl: config.hostBaseUrl,
      hostAccessToken: token,
      hostInstanceId: config.hostInstanceId,
      hostScopeByDomain,
      maxBackupBytes: config.maxBackupBytes,
      statePath: config.migrationStatePath,
      pythonCommand: config.pythonCommand || undefined,
    })
    return commonReport(config, {
      status: result.ok ? 'ready' : 'blocked',
      result: summarizeResult(result),
      sourceFingerprint: stage.sourceFingerprint,
      browserEvidence: stage.browserEvidence,
    })
  } finally {
    await cleanupStage(stage, config.runRoot)
  }
}

async function persistReport(config, report) {
  await writeJsonAtomic(config.resultPath, report, { containmentRoot: config.runRoot })
}

async function executeMutation(config, operation) {
  let run
  let stage = null
  const refreshedStages = []
  if (operation === 'apply') {
    if (await pathExists(config.manifestPath)
      || await pathExists(config.resultPath)
      || await pathExists(config.migrationStatePath)) {
      throw entryError('OWNER_PRODUCTION_ENTRY_RUN_EXISTS', 'an existing production migration run or target state requires resume')
    }
    stage = await materializeStage(config)
    const manifest = createRunManifest(config, stage)
    await writeJsonAtomic(config.manifestPath, manifest, { containmentRoot: config.runRoot })
    run = { manifest, source: stage.source, workflowDomains: stage.workflowDomains, stage }
  } else {
    run = await loadRun(config)
  }
  const token = await readHostToken(config, true)
  const hostScopeByDomain = await readHostScopes(config)
  const baseOptions = {
    mode: config.mode,
    explicitOptIn: true,
    profileId: config.profileId,
    source: run.source,
    target: config.target,
    domains: WINDOWS_OWNER_CUTOVER_DOMAINS,
    sourceDomainSnapshots: run.workflowDomains,
    hostBaseUrl: config.hostBaseUrl,
    hostAccessToken: token,
    hostInstanceId: config.hostInstanceId,
    hostScopeByDomain,
    maxBackupBytes: config.maxBackupBytes,
    statePath: config.migrationStatePath,
    pythonCommand: config.pythonCommand || undefined,
    idempotencyKeyByDomain: idempotencyKeys(run.manifest),
    legacyWriterControl: createWorkflowLegacyWriterControl(config, run.manifest),
  }
  let result
  try {
    if (operation === 'rollback') {
      result = await runWindowsOwnerProductionRollback({
        ...baseOptions,
        rollbackDomain: config.rollbackDomain,
      })
    } else {
      result = await runWindowsOwnerProductionCutover({
        ...baseOptions,
        resume: operation === 'resume',
        refreshBrowserGuard: createBrowserFreezeVerifier(config, run.manifest, token),
        refreshSourceAfterFreeze: ({ domain }) => refreshProductionSourceAfterFreeze(
          config,
          run.manifest,
          domain,
          refreshedStages,
        ),
      })
    }
  } finally {
    await Promise.all(refreshedStages.map((refreshedStage) => cleanupStage(refreshedStage, config.runRoot)))
  }
  const report = commonReport(config, {
    status: result.ok ? 'completed' : 'blocked',
    result: summarizeResult(result),
    run: {
      runId: run.manifest.runId,
      freezeChallenge: run.manifest.freezeChallenge,
      manifest: WINDOWS_OWNER_PRODUCTION_ENTRY_MANIFEST,
      migrationState: path.relative(config.target.profileAuthorityRoot, config.migrationStatePath),
      finalBackupsRetainedInMigrationState: true,
      rollbackStateRetainedInMigrationState: true,
    },
  })
  await persistReport(config, report)
  return report
}

export async function executeWindowsOwnerProductionEntry(parsed) {
  const config = await validateWindowsOwnerProductionEntryOptions(parsed)
  if (config.command === 'plan') {
    return commonReport(config, {
      status: 'ready',
      result: {
        ok: true,
        operation: 'plan',
        readOnly: true,
        noWrites: true,
        requiresForApply: [
          '--confirm-owner-migration APPLY',
          '--browser-freeze-evidence <path inside run-root>',
          'a live page exposing windows-owner-domain-cutover freeze evidence',
        ],
      },
    })
  }
  if (config.command === 'inventory') return executeInventory(config)
  if (config.command === 'dry-run') return executeDryRun(config)
  return executeMutation(config, config.command)
}
