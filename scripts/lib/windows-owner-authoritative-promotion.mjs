import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  createProductionHostAdapters,
  createWindowsOwnerProductionHostClient,
  loadWindowsOwnerProductionModules,
} from './windows-owner-cutover.mjs'
import { loadBackupModules, writeJsonAtomic } from './read-web-production-backup.mjs'

const APPLICATION_DOMAINS = Object.freeze([
  'reader-session',
  'marks-activity',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'workflow',
])

const HOST_DOMAINS = Object.freeze([
  'reader-session',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'marks-activity',
  'workflow',
])

export const WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_DOMAINS = APPLICATION_DOMAINS
export const WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_HOST_DOMAINS = HOST_DOMAINS
export const WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_MAX_BACKUP_BYTES = 256 * 1024 * 1024

const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAFE_CHALLENGE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAFE_CHECKSUM = /^sha256:[a-f0-9]{64}$/u
const SAFE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function promotionError(code, message = 'Windows owner promotion could not be completed', details = {}) {
  const error = new Error(message)
  error.name = 'WindowsOwnerAuthoritativePromotionError'
  error.code = code
  error.details = details
  return error
}

function clone(value) {
  if (value === undefined) return undefined
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))
}

function canonicalize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw promotionError('OWNER_PROMOTION_JSON_INVALID')
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value !== 'object') throw promotionError('OWNER_PROMOTION_JSON_INVALID')
  if (seen.has(value)) throw promotionError('OWNER_PROMOTION_JSON_INVALID')
  seen.add(value)
  let result
  if (Array.isArray(value)) {
    result = `[${value.map((entry) => canonicalize(entry, seen)).join(',')}]`
  } else {
    result = `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => (
      `${JSON.stringify(key)}:${canonicalize(value[key], seen)}`
    )).join(',')}}`
  }
  seen.delete(value)
  return result
}

function checksum(value) {
  return `sha256:${createHash('sha256').update(canonicalize(value), 'utf8').digest('hex')}`
}

function safeIdentity(value, field = 'identity') {
  if (typeof value !== 'string' || !SAFE_IDENTITY.test(value)) {
    throw promotionError('OWNER_PROMOTION_INVALID_IDENTITY', `${field} is invalid`)
  }
  return value
}

function safeChallenge(value) {
  if (typeof value !== 'string' || !SAFE_CHALLENGE.test(value)) {
    throw promotionError('OWNER_PROMOTION_INVALID_CHALLENGE', 'promotion challenge is invalid')
  }
  return value
}

function safeChecksum(value, field = 'checksum') {
  if (typeof value !== 'string' || !SAFE_CHECKSUM.test(value)) {
    throw promotionError('OWNER_PROMOTION_INVALID_CHECKSUM', `${field} is invalid`)
  }
  return value
}

function safeRevision(value, field = 'revision') {
  if (Number.isInteger(value) && value >= 0) return value
  if (typeof value === 'string' && SAFE_REVISION.test(value)) return value
  throw promotionError('OWNER_PROMOTION_INVALID_REVISION', `${field} is invalid`)
}

function assertDomainOrder(domains, expected = APPLICATION_DOMAINS, code = 'OWNER_PROMOTION_INVALID_DOMAINS') {
  if (!Array.isArray(domains)
    || domains.length !== expected.length
    || domains.some((domain, index) => domain !== expected[index])) {
    throw promotionError(code, 'owner promotion domains do not match the fixed registry')
  }
  return [...expected]
}

function assertDomainSet(domains, expected = APPLICATION_DOMAINS, code = 'OWNER_PROMOTION_SOURCE_NOT_FROZEN') {
  if (!Array.isArray(domains)
    || domains.length !== expected.length
    || new Set(domains).size !== expected.length
    || domains.some((domain) => !expected.includes(domain))) {
    throw promotionError(code, 'owner promotion domain evidence is incomplete')
  }
  return true
}

function loopbackRoot(baseUrl) {
  let root
  try { root = new URL(String(baseUrl || '')) } catch {
    throw promotionError('OWNER_PROMOTION_HOST_URL_INVALID', 'promotion Host URL is invalid')
  }
  if (!['http:', 'https:'].includes(root.protocol)
    || !['127.0.0.1', 'localhost', '::1'].includes(root.hostname.toLowerCase())
    || !['', '/'].includes(root.pathname)
    || root.search
    || root.hash) {
    throw promotionError('OWNER_PROMOTION_HOST_URL_INVALID', 'promotion Host URL must be a loopback origin')
  }
  return root
}

function responseErrorCode(body, fallback) {
  const code = body?.error?.code
  return typeof code === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(code)
    ? code
    : fallback
}

/**
 * Token-protected management client for the optimization-only Host promotion
 * seam.  The ordinary owner API client remains separate; this client can only
 * reach the explicit promotion route and always sends the optimization gate.
 */
export function createOwnerPromotionClient({
  baseUrl,
  accessToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000,
} = {}) {
  const root = loopbackRoot(baseUrl)
  const token = String(accessToken || '').trim()
  if (!token) throw promotionError('OWNER_PROMOTION_HOST_TOKEN_REQUIRED', 'promotion Host token is required')
  if (typeof fetchImpl !== 'function') throw promotionError('OWNER_PROMOTION_FETCH_UNAVAILABLE', 'promotion Host fetch is unavailable')
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
    throw promotionError('OWNER_PROMOTION_TIMEOUT_INVALID', 'promotion Host timeout is invalid')
  }

  async function request(operation, payload = null) {
    const normalizedOperation = String(operation || '').trim()
    if (!['status', 'freeze', 'unfreeze', 'commit', 'revoke'].includes(normalizedOperation)) {
      throw promotionError('OWNER_PROMOTION_OPERATION_INVALID', 'promotion Host operation is invalid')
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(new URL(`/api/app/owner-promotion/${normalizedOperation}`, root), {
        method: normalizedOperation === 'status' ? 'GET' : 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'X-Read-Web-Token': token,
          'X-Read-Web-Owner-Promotion': 'optimization',
        },
        ...(normalizedOperation === 'status' ? {} : { body: JSON.stringify(payload || {}) }),
        signal: controller.signal,
      })
      let body
      try { body = await response.json() } catch {
        throw promotionError('OWNER_PROMOTION_INVALID_RESPONSE', 'promotion Host returned invalid JSON')
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw promotionError('OWNER_PROMOTION_INVALID_RESPONSE', 'promotion Host returned an invalid response')
      }
      if (!response.ok) {
        throw promotionError(
          responseErrorCode(body, `OWNER_PROMOTION_HTTP_${response.status}`),
          'promotion Host rejected the management request',
        )
      }
      return body
    } catch (error) {
      if (error?.name === 'AbortError') throw promotionError('OWNER_PROMOTION_TIMEOUT', 'promotion Host request timed out')
      if (error?.code?.startsWith('OWNER_PROMOTION_')) throw error
      throw promotionError('OWNER_PROMOTION_TRANSPORT_FAILED', 'promotion Host management request failed')
    } finally {
      clearTimeout(timeout)
    }
  }

  return Object.freeze({
    status: () => request('status'),
    freeze: (payload) => request('freeze', payload),
    unfreeze: (payload) => request('unfreeze', payload),
    commit: (payload) => request('commit', payload),
    revoke: (payload) => request('revoke', payload),
  })
}

function promotionStatusSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw promotionError('OWNER_PROMOTION_INVALID_STATUS', 'Host promotion status is invalid')
  }
  return {
    status: typeof value.status === 'string' ? value.status : 'unknown',
    mode: typeof value.mode === 'string' ? value.mode : null,
    profileId: typeof value.profileId === 'string' ? value.profileId : null,
    instanceId: typeof value.instanceId === 'string' ? value.instanceId : null,
    frozenDomains: Array.isArray(value.frozenDomains) ? [...value.frozenDomains] : [],
    drainedDomains: Array.isArray(value.drainedDomains) ? [...value.drainedDomains] : [],
    checkpointedDomains: Array.isArray(value.checkpointedDomains) ? [...value.checkpointedDomains] : [],
    invalidDomains: Array.isArray(value.invalidDomains) ? [...value.invalidDomains] : [],
    challenge: typeof value.challenge === 'string' ? value.challenge : null,
    drained: value.drained === true,
    inflightOwnerWrites: Number.isInteger(value.inflightOwnerWrites) ? value.inflightOwnerWrites : null,
  }
}

export function assertSourceFrozen(value) {
  const status = promotionStatusSummary(value)
  if (status.mode !== 'optimization'
    || status.status !== 'frozen'
    || status.invalidDomains.length
    || status.drained !== true
    || status.frozenDomains.length !== HOST_DOMAINS.length
    || status.drainedDomains.length !== HOST_DOMAINS.length
    || new Set(status.frozenDomains).size !== HOST_DOMAINS.length
    || new Set(status.drainedDomains).size !== HOST_DOMAINS.length
    || HOST_DOMAINS.some((domain) => !status.frozenDomains.includes(domain) || !status.drainedDomains.includes(domain))
    || status.inflightOwnerWrites !== null && status.inflightOwnerWrites !== 0) {
    throw promotionError('OWNER_PROMOTION_SOURCE_NOT_FROZEN', 'source Host is not frozen and drained for all six domains')
  }
  safeChallenge(status.challenge)
  return status
}

function backupRelease(release = {}) {
  return {
    applicationVersion: release.applicationVersion || 'read-web-owner-authoritative-promotion',
    backendVersion: release.backendVersion || 'read-web-owner-authoritative-promotion',
    gitSha: release.gitSha || release.commitSha || null,
    releaseId: release.releaseId || 'read-web-owner-authoritative-promotion',
    manifestSha: release.manifestSha || null,
  }
}

async function createTrustedBackup({ adapters, release, maxBackupBytes, now } = {}) {
  const { applicationBackup } = await loadBackupModules()
  const service = applicationBackup.createApplicationBackupService({
    requiredDomains: APPLICATION_DOMAINS,
    adapters,
    release: backupRelease(release),
    maxBackupBytes,
    ...(typeof now === 'function' ? { now } : {}),
  })
  const artifact = await service.createBackup({ ...(typeof now === 'function' ? { now } : {}) })
  const verification = await applicationBackup.verifyBackupArtifact(artifact, {
    requiredDomains: APPLICATION_DOMAINS,
    maxBackupBytes,
  })
  if (!verification.valid) throw promotionError('OWNER_PROMOTION_BACKUP_INVALID', 'Host backup verification failed')
  return artifact
}

export async function createAuthoritativeSourceFinalBackup({
  sourceControl,
  sourceAdapters,
  profileId,
  instanceId,
  release,
  maxBackupBytes = WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_MAX_BACKUP_BYTES,
  now,
} = {}) {
  safeIdentity(profileId, 'source profile id')
  safeIdentity(instanceId, 'source instance id')
  if (!sourceControl || typeof sourceControl.status !== 'function') {
    throw promotionError('OWNER_PROMOTION_SOURCE_CONTROL_UNAVAILABLE', 'source Host promotion control is unavailable')
  }
  if (!sourceAdapters || typeof sourceAdapters !== 'object') {
    throw promotionError('OWNER_PROMOTION_SOURCE_ADAPTERS_UNAVAILABLE', 'source Host adapters are unavailable')
  }
  for (const domain of APPLICATION_DOMAINS) {
    if (!sourceAdapters[domain] || typeof sourceAdapters[domain].collect !== 'function') {
      throw promotionError('OWNER_PROMOTION_SOURCE_ADAPTER_MISSING', 'source Host adapter is missing')
    }
  }
  const status = assertSourceFrozen(await sourceControl.status())
  if (status.profileId !== profileId || status.instanceId !== instanceId) {
    throw promotionError('OWNER_PROMOTION_SOURCE_IDENTITY_MISMATCH', 'source Host identity does not match the promotion run')
  }
  const artifact = await createTrustedBackup({ adapters: sourceAdapters, release, maxBackupBytes, now })
  const domains = APPLICATION_DOMAINS.map((domain) => {
    const domainArtifact = artifact.domains?.[domain]
    const revision = domainArtifact?.revision
    if (!(Number.isInteger(revision) && revision >= 0)
      && !(typeof revision === 'string' && SAFE_REVISION.test(revision))) {
      throw promotionError('OWNER_PROMOTION_BACKUP_INVALID', 'source Host backup has an invalid domain revision')
    }
    return {
      domain,
      revision,
      checksum: safeChecksum(artifact.manifest?.domainChecksums?.[domain], `${domain} checksum`),
    }
  })
  const capturedAt = typeof now === 'function' ? now() : Date.now()
  const sourceHostFreezeEvidence = {
    kind: 'host-promotion-freeze-evidence.v1',
    sourceProfileId: profileId,
    sourceInstanceId: instanceId,
    challenge: status.challenge,
    frozen: true,
    drained: true,
    capturedAt: new Date(capturedAt).toISOString(),
    domains,
  }
  return Object.freeze({
    artifact,
    sourceHostFreezeEvidence,
    sourceStatus: status,
  })
}

function artifactRecords(artifact) {
  const records = []
  for (const domain of APPLICATION_DOMAINS) {
    const domainArtifact = artifact?.domains?.[domain]
    if (!domainArtifact || !Array.isArray(domainArtifact.records)) {
      throw promotionError('OWNER_PROMOTION_BACKUP_INVALID', 'source backup domain records are invalid')
    }
    for (const record of domainArtifact.records) {
      if (!record || typeof record.id !== 'string' || !record.id) {
        throw promotionError('OWNER_PROMOTION_BACKUP_INVALID', 'source backup record identity is invalid')
      }
      records.push({
        domain,
        recordKey: record.id,
        schemaVersion: record.schemaVersion ?? 1,
        revision: record.revision ?? null,
        contentId: record.contentId ?? null,
        payload: clone(record.payload),
        references: Array.isArray(record.references) ? clone(record.references) : [],
        mediaReferences: Array.isArray(record.mediaReferences) ? clone(record.mediaReferences) : [],
      })
    }
  }
  return records
}

function importInputFromArtifact(artifact) {
  const records = artifactRecords(artifact)
  return {
    schemaVersion: 1,
    mode: 'legacy-import-input',
    profileId: null,
    importIdentity: checksum(records),
    records,
  }
}

function sourceSummary(artifact) {
  const records = artifactRecords(artifact)
  return {
    status: 'ready',
    checksum: checksum(records),
    records,
    sources: APPLICATION_DOMAINS.map((domain) => {
      const selected = records.filter((record) => record.domain === domain)
      return {
        sourceKind: 'windows-host-repository',
        sourceId: `host.${domain}`,
        status: 'ready',
        recordCount: selected.length,
        checksum: checksum(selected),
      }
    }),
  }
}

/**
 * A small compatibility bridge whose only source is the frozen Host owner.
 * It exposes the legacy-import-input shape expected by the existing durable
 * migration transaction, while retaining the Host artifact as the final
 * source capture so the migration cannot fall back to an unfrozen read.
 */
export function createHostSourceBridge({
  sourceControl,
  sourceAdapters,
  profileId,
  release,
  maxBackupBytes = WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_MAX_BACKUP_BYTES,
  now,
} = {}) {
  let requireFrozen = false
  let finalArtifact = null

  async function captureArtifact() {
    if (finalArtifact) {
      if (requireFrozen) assertSourceFrozen(await sourceControl.status())
      return clone(finalArtifact)
    }
    if (requireFrozen) assertSourceFrozen(await sourceControl.status())
    return createTrustedBackup({ adapters: sourceAdapters, release, maxBackupBytes, now })
  }

  return {
    setRequireFrozen(value = true) {
      requireFrozen = value === true
    },
    setFinalCapture(artifact) {
      if (!artifact || typeof artifact !== 'object') {
        throw promotionError('OWNER_PROMOTION_BACKUP_INVALID', 'final source capture is invalid')
      }
      finalArtifact = clone(artifact)
      requireFrozen = true
    },
    clearFinalCapture() {
      finalArtifact = null
    },
    async inventory() {
      const artifact = await captureArtifact()
      return sourceSummary(artifact)
    },
    async prepareImport() {
      const artifact = await captureArtifact()
      return {
        status: 'ready',
        importInput: importInputFromArtifact(artifact),
      }
    },
  }
}

function deriveMarksScopes(workflowSnapshot) {
  const scopes = []
  const seen = new Set()
  for (const record of workflowSnapshot?.records || []) {
    const id = String(record?.id || '')
    if (!id.startsWith('jobs:') && !id.startsWith('items:')) continue
    const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {}
    const jobId = String(payload.jobId || record.contentId || id.slice(id.indexOf(':') + 1) || '')
    const contentId = String(payload.contentId || record.contentId || jobId)
    if (!jobId || !contentId || /[\\/\u0000-\u001f\u007f]/u.test(jobId) || /[\\/\u0000-\u001f\u007f]/u.test(contentId)) continue
    const key = `${jobId}\u0000${contentId}`
    if (seen.has(key)) continue
    seen.add(key)
    scopes.push({ jobId, contentId })
  }
  return scopes
}

async function discoverAnnotationScopes(client) {
  const response = await client.query({
    domain: 'annotation',
    operation: 'scope',
    payload: {},
  })
  if (response?.outcome !== 'read') {
    throw promotionError('OWNER_PROMOTION_SOURCE_ANNOTATION_SCOPE_FAILED', 'source Host annotation scope discovery failed')
  }
  const rawRecords = response.payload?.records
  if (!rawRecords || typeof rawRecords !== 'object' || Array.isArray(rawRecords)) return []
  const scopes = []
  const seen = new Set()
  for (const value of Object.values(rawRecords)) {
    const content = value?.content ?? value?.payload ?? value
    const scope = content?.scope ?? content
    if (typeof scope?.audioKey !== 'string' || !scope.audioKey
      || typeof scope?.documentId !== 'string' || !scope.documentId) continue
    const key = `${scope.audioKey}\u0000${scope.documentId}`
    if (seen.has(key)) continue
    seen.add(key)
    scopes.push({ audioKey: scope.audioKey, documentId: scope.documentId })
  }
  return scopes
}

export async function createAuthoritativePromotionAdapters({
  sourceClient,
  targetClient,
  sourceProfileId,
  targetProfileId,
  sourceWorkflowOutputDir,
} = {}) {
  safeIdentity(sourceProfileId, 'source profile id')
  safeIdentity(targetProfileId, 'target profile id')
  const initialSourceAdapters = createProductionHostAdapters({
    client: sourceClient,
    profileId: sourceProfileId,
  })
  const sourceWorkflowSnapshot = await initialSourceAdapters.workflow.collect({ domain: 'workflow' })
  const sourceScopesByDomain = {
    'marks-activity': deriveMarksScopes(sourceWorkflowSnapshot),
    annotation: await discoverAnnotationScopes(sourceClient),
  }
  const sourceAdapters = createProductionHostAdapters({
    client: sourceClient,
    profileId: sourceProfileId,
    sourceScopesByDomain,
    sourceWorkflowSnapshot: () => sourceWorkflowSnapshot,
    sourceWorkflowOutputDir,
  })
  const targetAdapters = createProductionHostAdapters({
    client: targetClient,
    profileId: targetProfileId,
    sourceScopesByDomain,
    sourceWorkflowSnapshot: () => sourceWorkflowSnapshot,
    sourceWorkflowOutputDir,
  })
  return Object.freeze({
    sourceAdapters,
    targetAdapters,
    sourceWorkflowSnapshot,
    sourceScopesByDomain,
  })
}

function assertContained(root, filePath) {
  const resolvedRoot = path.resolve(root)
  const resolvedFile = path.resolve(filePath)
  const relative = path.relative(resolvedRoot, resolvedFile)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw promotionError('OWNER_PROMOTION_PATH_INVALID', 'promotion state path must remain inside its run directory')
  }
  return resolvedFile
}

export function createPromotionStateFileStore(filePath, containmentRoot = path.dirname(filePath)) {
  const absoluteFile = assertContained(containmentRoot, filePath)
  const root = path.resolve(containmentRoot)
  return {
    async read() {
      try { return JSON.parse(await readFile(absoluteFile, 'utf8')) } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw promotionError('OWNER_PROMOTION_STATE_CORRUPT', 'promotion migration state could not be read')
      }
    },
    async write(value) {
      await mkdir(root, { recursive: true })
      return writeJsonAtomic(absoluteFile, clone(value), { containmentRoot: root })
    },
  }
}

function createMemoryArtifactStore(initial = null) {
  let value = initial === null ? null : clone(initial)
  return {
    async read() { return value === null ? null : clone(value) },
    async write(next) { value = clone(next) },
  }
}

async function verifyStoredArtifact(artifact, maxBackupBytes) {
  const { applicationBackup } = await loadBackupModules()
  const verification = await applicationBackup.verifyBackupArtifact(artifact, {
    requiredDomains: APPLICATION_DOMAINS,
    maxBackupBytes,
  })
  if (!verification.valid) throw promotionError('OWNER_PROMOTION_TARGET_CHECKPOINT_INVALID', 'target checkpoint backup is invalid')
  return verification.artifact
}

export async function createTargetCheckpoint({
  targetAdapters,
  targetCheckpointStore,
  release,
  maxBackupBytes = WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_MAX_BACKUP_BYTES,
  now,
} = {}) {
  if (!targetAdapters || typeof targetAdapters !== 'object') {
    throw promotionError('OWNER_PROMOTION_TARGET_ADAPTERS_UNAVAILABLE', 'target Host adapters are unavailable')
  }
  const store = targetCheckpointStore || createMemoryArtifactStore()
  if (typeof store.read !== 'function' || typeof store.write !== 'function') {
    throw promotionError('OWNER_PROMOTION_TARGET_CHECKPOINT_STORE_INVALID', 'target checkpoint store is invalid')
  }
  const existing = await store.read()
  if (existing !== null && existing !== undefined) {
    return Object.freeze({ artifact: await verifyStoredArtifact(existing, maxBackupBytes), idempotent: true })
  }
  const artifact = await createTrustedBackup({ adapters: targetAdapters, release, maxBackupBytes, now })
  await store.write(artifact)
  const reread = await store.read()
  if (!reread) throw promotionError('OWNER_PROMOTION_TARGET_CHECKPOINT_INVALID', 'target checkpoint could not be reread')
  return Object.freeze({ artifact: await verifyStoredArtifact(reread, maxBackupBytes), idempotent: false })
}

function safeRunId(value) {
  return safeIdentity(value, 'promotion run id')
}

function safeStatus(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export async function createAuthoritativePromotionCoordinator({
  sourceControl,
  targetControl,
  sourceAdapters,
  targetAdapters,
  sourceProfileId,
  sourceInstanceId,
  targetProfileId,
  targetInstanceId,
  stateStore,
  targetCheckpointStore,
  runId = `owner-promotion-${Date.now().toString(36)}`,
  release,
  maxBackupBytes = WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_MAX_BACKUP_BYTES,
  now,
} = {}) {
  safeIdentity(sourceProfileId, 'source profile id')
  safeIdentity(sourceInstanceId, 'source instance id')
  safeIdentity(targetProfileId, 'target profile id')
  safeIdentity(targetInstanceId, 'target instance id')
  const normalizedRunId = safeRunId(runId)
  if (!sourceControl || typeof sourceControl.status !== 'function' || typeof sourceControl.freeze !== 'function' || typeof sourceControl.unfreeze !== 'function') {
    throw promotionError('OWNER_PROMOTION_SOURCE_CONTROL_UNAVAILABLE', 'source Host promotion control is incomplete')
  }
  if (!targetControl || typeof targetControl.commit !== 'function' || typeof targetControl.revoke !== 'function') {
    throw promotionError('OWNER_PROMOTION_TARGET_CONTROL_UNAVAILABLE', 'target Host promotion control is incomplete')
  }
  if (!stateStore || typeof stateStore.read !== 'function' || typeof stateStore.write !== 'function') {
    throw promotionError('OWNER_PROMOTION_STATE_STORE_INVALID', 'promotion migration state store is invalid')
  }
  for (const adapters of [sourceAdapters, targetAdapters]) {
    for (const domain of APPLICATION_DOMAINS) {
      if (!adapters?.[domain] || typeof adapters[domain].collect !== 'function') {
        throw promotionError('OWNER_PROMOTION_ADAPTER_MISSING', 'promotion Host adapter is missing')
      }
    }
  }

  const sourceBridge = createHostSourceBridge({
    sourceControl,
    sourceAdapters,
    profileId: sourceProfileId,
    release,
    maxBackupBytes,
    now,
  })
  let sourceChallenge = null
  let sourceFinalCapture = null
  let persistentMigrationPromise = null
  let dryRunMigrationPromise = null

  async function sourceStatus() {
    const status = promotionStatusSummary(await sourceControl.status())
    if (status.profileId !== sourceProfileId || status.instanceId !== sourceInstanceId) {
      throw promotionError('OWNER_PROMOTION_SOURCE_IDENTITY_MISMATCH', 'source Host identity does not match the promotion run')
    }
    return status
  }

  async function ensureSourceFrozen() {
    const existing = await sourceStatus()
    if (existing.status === 'frozen') {
      const frozen = assertSourceFrozen(existing)
      sourceChallenge = frozen.challenge
      sourceBridge.setRequireFrozen(true)
      return frozen
    }
    const requestedChallenge = sourceChallenge || `owner-promotion-${normalizedRunId}`.slice(0, 128)
    const response = await sourceControl.freeze({
      profileId: sourceProfileId,
      instanceId: sourceInstanceId,
      domains: [...HOST_DOMAINS],
      challenge: safeChallenge(requestedChallenge),
      timeoutMs: 30000,
    })
    const frozen = assertSourceFrozen(response)
    if (frozen.profileId !== sourceProfileId || frozen.instanceId !== sourceInstanceId) {
      throw promotionError('OWNER_PROMOTION_SOURCE_IDENTITY_MISMATCH', 'source Host freeze identity does not match the promotion run')
    }
    sourceChallenge = frozen.challenge
    sourceBridge.setRequireFrozen(true)
    return frozen
  }

  async function unfreezeSource() {
    const status = await sourceStatus()
    if (status.status === 'unfrozen' && !status.frozenDomains.length) return { ok: true, idempotent: true, status: 'unfrozen' }
    const challenge = sourceChallenge || status.challenge
    safeChallenge(challenge)
    const result = await sourceControl.unfreeze({
      profileId: sourceProfileId,
      instanceId: sourceInstanceId,
      domains: [...HOST_DOMAINS],
      challenge,
    })
    const after = await sourceStatus()
    if (after.status !== 'unfrozen' || after.frozenDomains.length) {
      throw promotionError('OWNER_PROMOTION_SOURCE_UNFREEZE_FAILED', 'source Host remains frozen after unfreeze')
    }
    sourceBridge.setRequireFrozen(false)
    sourceBridge.clearFinalCapture()
    sourceFinalCapture = null
    sourceChallenge = null
    return { ok: true, status: after.status, response: safeStatus(result) }
  }

  async function finalSourceCapture() {
    if (sourceFinalCapture) return sourceFinalCapture
    sourceFinalCapture = await createAuthoritativeSourceFinalBackup({
      sourceControl,
      sourceAdapters,
      profileId: sourceProfileId,
      instanceId: sourceInstanceId,
      release,
      maxBackupBytes,
      now,
    })
    sourceBridge.setFinalCapture(sourceFinalCapture.artifact)
    return sourceFinalCapture
  }

  function cutoverControls() {
    return Object.fromEntries(APPLICATION_DOMAINS.map((domain) => [domain, {
      async freeze() {
        const result = await ensureSourceFrozen()
        return { ok: true, status: result.status, sourceChallenge: result.challenge }
      },
      async unfreeze() {
        // A domain rollback is intentionally not allowed to release the
        // six-domain source gate while other domains are still being restored.
        return { ok: true, status: 'source-remains-frozen' }
      },
      async switch({ revision, checksum: revisionEvidence, finalBackup }) {
        safeRevision(revision)
        safeChecksum(revisionEvidence, 'revision evidence')
        const result = await targetControl.commit({
          profileId: targetProfileId,
          instanceId: targetInstanceId,
          domain,
          revision,
          artifactChecksum: safeChecksum(finalBackup?.artifactChecksum, 'artifact checksum'),
          revisionEvidence,
        })
        return {
          ok: true,
          authorityChanged: true,
          status: 'authoritative',
          targetResponse: safeStatus(result),
        }
      },
      async rollback({ revision, checksum: revisionEvidence }) {
        const state = await stateStore.read()
        const finalBackup = state?.domains?.[domain]?.finalBackup
        if (!finalBackup?.artifactChecksum) {
          throw promotionError('OWNER_PROMOTION_ROLLBACK_TARGET_MISSING', 'promotion rollback artifact is missing')
        }
        const result = await targetControl.revoke({
          profileId: targetProfileId,
          instanceId: targetInstanceId,
          domain,
          revision,
          artifactChecksum: safeChecksum(finalBackup.artifactChecksum, 'artifact checksum'),
          revisionEvidence: safeChecksum(revisionEvidence, 'revision evidence'),
        })
        return { ok: true, status: 'revoked', targetResponse: safeStatus(result) }
      },
      async smoke({ revision }) {
        const current = await targetAdapters[domain].collect({ domain })
        if (current?.revision !== revision) {
          throw promotionError('OWNER_PROMOTION_TARGET_SMOKE_FAILED', 'target Host smoke revision does not match the committed revision')
        }
        return { ok: true, queried: true }
      },
    }]))
  }

  async function createMigration({ persistent = true } = {}) {
    const cache = persistent ? persistentMigrationPromise : dryRunMigrationPromise
    if (cache) return cache
    const next = loadWindowsOwnerProductionModules().then(({ createWindowsDurableStateMigration, createMemoryMigrationStateStore }) => {
      const selectedStateStore = persistent ? stateStore : createMemoryMigrationStateStore()
      return createWindowsDurableStateMigration({
        profileId: targetProfileId,
        legacyBridge: sourceBridge,
        hostAdapters: targetAdapters,
        stateStore: selectedStateStore,
        cutoverControls: cutoverControls(),
        release: backupRelease(release),
        backupLimits: { maxBackupBytes },
      })
    })
    if (persistent) persistentMigrationPromise = next
    else dryRunMigrationPromise = next
    return next
  }

  async function ensureCheckpoint() {
    return createTargetCheckpoint({
      targetAdapters,
      targetCheckpointStore,
      release,
      maxBackupBytes,
      now,
    })
  }

  async function runMigration({ persistent = true } = {}) {
    const migration = await createMigration({ persistent })
    const result = await migration.runAll({
      domains: [...APPLICATION_DOMAINS],
      allowExistingTarget: true,
      beforeFinalBackup: async () => {
        const capture = await finalSourceCapture()
        return {
          ok: true,
          sourceHostFreezeEvidence: capture.sourceHostFreezeEvidence,
        }
      },
    })
    return { migration, result }
  }

  async function rollbackCommittedDomains(migration) {
    const state = await stateStore.read()
    const results = []
    for (const domain of [...APPLICATION_DOMAINS].reverse()) {
      if (state?.domains?.[domain]?.import?.status !== 'committed') continue
      results.push(await migration.rollback(domain))
    }
    return {
      ok: results.every((result) => result.ok),
      results,
    }
  }

  async function recoverAfterFailure(migration, failure) {
    let rollback = { ok: true, results: [] }
    let unfreeze = null
    try { rollback = await rollbackCommittedDomains(migration) } catch (error) {
      rollback = { ok: false, results: [], reasonCode: error?.code || 'OWNER_PROMOTION_ROLLBACK_FAILED' }
    }
    if (rollback.ok) {
      try { unfreeze = await unfreezeSource() } catch (error) {
        unfreeze = { ok: false, reasonCode: error?.code || 'OWNER_PROMOTION_SOURCE_UNFREEZE_FAILED' }
      }
    }
    return {
      ok: false,
      failure: {
        code: failure?.code || 'OWNER_PROMOTION_APPLY_FAILED',
        message: 'authoritative owner promotion failed',
      },
      rollback,
      unfreeze,
      manualRecovery: rollback.ok !== true || unfreeze?.ok !== true,
    }
  }

  async function plan() {
    const source = await sourceStatus()
    let target = null
    if (typeof targetControl.status === 'function') {
      try {
        target = await targetControl.status()
      } catch (error) {
        // An ordinary daily startup deliberately has no promotion route.  A
        // read-only plan should report that boundary instead of treating the
        // missing mutating interface as an apply failure.
        if (!['OWNER_PROMOTION_HTTP_404', 'not-found'].includes(error?.code)) throw error
        target = { status: 'not-enabled', mode: null, profileId: targetProfileId, instanceId: targetInstanceId }
      }
    }
    return {
      mode: 'read-only-plan',
      write: false,
      runId: normalizedRunId,
      source: promotionStatusSummary(source),
      target: target ? promotionStatusSummary(target) : null,
      domains: [...APPLICATION_DOMAINS],
    }
  }

  async function inventory() {
    const source = await sourceBridge.inventory()
    return {
      mode: 'read-only-inventory',
      write: false,
      runId: normalizedRunId,
      source: {
        status: source.status,
        checksum: source.checksum,
        sources: source.sources,
        domains: APPLICATION_DOMAINS.map((domain) => {
          const records = source.records.filter((record) => record.domain === domain)
          return { domain, recordCount: records.length, checksum: checksum(records) }
        }),
      },
    }
  }

  async function dryRun() {
    const migration = await createMigration({ persistent: false })
    const results = []
    for (const domain of APPLICATION_DOMAINS) {
      results.push(await migration.dryRun(domain, { allowExistingTarget: true }))
    }
    return {
      mode: 'read-only-dry-run',
      write: false,
      runId: normalizedRunId,
      ok: results.every((result) => result.ok),
      results,
    }
  }

  async function apply() {
    const checkpoint = await ensureCheckpoint()
    await ensureSourceFrozen()
    try {
      const { migration, result } = await runMigration({ persistent: true })
      if (result.ok) {
        return {
          ok: true,
          operation: 'apply',
          runId: normalizedRunId,
          checkpoint: { idempotent: checkpoint.idempotent, artifactChecksum: checkpoint.artifact.artifactChecksum },
          migration: result,
          source: await sourceStatus(),
        }
      }
      return recoverAfterFailure(migration, promotionError('OWNER_PROMOTION_APPLY_FAILED'))
    } catch (error) {
      const migration = await createMigration({ persistent: true }).catch(() => null)
      return migration
        ? recoverAfterFailure(migration, error)
        : {
          ok: false,
          failure: { code: error?.code || 'OWNER_PROMOTION_APPLY_FAILED', message: 'authoritative owner promotion failed' },
          rollback: { ok: false, results: [], reasonCode: 'OWNER_PROMOTION_MIGRATION_UNAVAILABLE' },
          unfreeze: null,
          manualRecovery: true,
        }
    }
  }

  async function resume() {
    const checkpoint = await ensureCheckpoint()
    await ensureSourceFrozen()
    try {
      const { migration, result } = await runMigration({ persistent: true })
      if (result.ok) {
        return {
          ok: true,
          operation: 'resume',
          runId: normalizedRunId,
          checkpoint: { idempotent: checkpoint.idempotent, artifactChecksum: checkpoint.artifact.artifactChecksum },
          migration: result,
          source: await sourceStatus(),
        }
      }
      return recoverAfterFailure(migration, promotionError('OWNER_PROMOTION_RESUME_FAILED'))
    } catch (error) {
      const migration = await createMigration({ persistent: true }).catch(() => null)
      return migration
        ? recoverAfterFailure(migration, error)
        : {
          ok: false,
          failure: { code: error?.code || 'OWNER_PROMOTION_RESUME_FAILED', message: 'authoritative owner promotion resume failed' },
          rollback: { ok: false, results: [], reasonCode: 'OWNER_PROMOTION_MIGRATION_UNAVAILABLE' },
          unfreeze: null,
          manualRecovery: true,
        }
    }
  }

  async function rollback() {
    const migration = await createMigration({ persistent: true })
    const rollback = await rollbackCommittedDomains(migration)
    if (!rollback.ok) {
      return { ok: false, operation: 'rollback', runId: normalizedRunId, rollback, manualRecovery: true }
    }
    try {
      const unfreeze = await unfreezeSource()
      return { ok: true, operation: 'rollback', runId: normalizedRunId, rollback, unfreeze }
    } catch (error) {
      return {
        ok: false,
        operation: 'rollback',
        runId: normalizedRunId,
        rollback,
        unfreeze: { ok: false, reasonCode: error?.code || 'OWNER_PROMOTION_SOURCE_UNFREEZE_FAILED' },
        manualRecovery: true,
      }
    }
  }

  return Object.freeze({
    runId: normalizedRunId,
    domains: [...APPLICATION_DOMAINS],
    plan,
    inventory,
    dryRun,
    apply,
    resume,
    rollback,
    ensureSourceFrozen,
    unfreezeSource,
    ensureCheckpoint,
    sourceBridge,
  })
}

export async function createProductionPromotionClients({
  source,
  target,
  sourceProfileId,
  sourceInstanceId,
  targetProfileId,
  targetInstanceId,
  sourceBaseUrl,
  targetBaseUrl,
  sourceAccessToken,
  targetAccessToken,
  timeoutMs,
} = {}) {
  const sourceClient = await createWindowsOwnerProductionHostClient({
    baseUrl: sourceBaseUrl,
    accessToken: sourceAccessToken,
    profileId: sourceProfileId,
    instanceId: sourceInstanceId,
    migrationOnly: true,
    mode: 'optimization',
    explicitOptIn: true,
    timeoutMs,
  })
  const targetClient = await createWindowsOwnerProductionHostClient({
    baseUrl: targetBaseUrl,
    accessToken: targetAccessToken,
    profileId: targetProfileId,
    instanceId: targetInstanceId,
    migrationOnly: true,
    mode: 'optimization',
    explicitOptIn: true,
    timeoutMs,
  })
  const sourceControl = createOwnerPromotionClient({ baseUrl: sourceBaseUrl, accessToken: sourceAccessToken, timeoutMs })
  const targetControl = createOwnerPromotionClient({ baseUrl: targetBaseUrl, accessToken: targetAccessToken, timeoutMs })
  return { sourceClient, targetClient, sourceControl, targetControl }
}
