import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const OWNER_PENDING_JOURNAL_SCHEMA_VERSION = 1
const OWNER_PENDING_JOURNAL_FILE = 'owner-pending-journal.json'
const OWNER_PENDING_JOURNAL_OPERATION_KINDS = Object.freeze([
  'restore',
  'migration-cutover',
  'material-publish',
])
const OWNER_PENDING_JOURNAL_PHASES = Object.freeze([
  'prepare',
  'commit',
  'recovery',
  'finalize',
])
const OWNER_PENDING_JOURNAL_STATUSES = Object.freeze([
  'pending',
  'prepared',
  'committing',
  'committed',
  'manual-recovery',
  'finalized',
])
const OWNER_PENDING_CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u
const OWNER_PROFILE_DOMAINS = Object.freeze([
  'reader-session',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'marks-activity',
  'workflow',
])

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

function checksumValue(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

function ownerModeDomain(domain) {
  const value = String(domain || '').trim()
  if (!OWNER_PROFILE_DOMAINS.includes(value)) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_UNKNOWN_DOMAIN',
      `Pending journal domain is not registered: ${value || '[missing]'}`,
      { domain: value || null },
    )
  }
  return value
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

async function readJsonIfPresent(filePath, code = 'OWNER_PENDING_JOURNAL_CORRUPT') {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    const wrapped = new Error(`Pending journal is not valid JSON: ${path.basename(filePath)}`)
    wrapped.code = code
    wrapped.cause = error
    throw wrapped
  }
}

function ownerPendingJournalError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

function ownerPendingSafeText(value, label, { allowPathLike = false } = {}) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256
    || value.includes('\0') || (!allowPathLike && /[\\/]/u.test(value))) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_INVALID',
      `Pending journal ${label} must be a bounded, non-path string`,
      { label },
    )
  }
  return value.trim()
}

function ownerPendingTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_INVALID',
      `Pending journal ${label} must be an ISO timestamp`,
      { label },
    )
  }
  return value
}

function ownerPendingDomainIdentity(value, label = 'domain identity') {
  const candidate = value?.identity && typeof value.identity === 'object' ? value.identity : value
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
    || !Number.isInteger(candidate.revision) || candidate.revision < 0
    || typeof candidate.checksum !== 'string' || !OWNER_PENDING_CHECKSUM_PATTERN.test(candidate.checksum)) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_REVISION_EVIDENCE_MISSING',
      `${label} must contain a non-negative revision and sha256 checksum`,
      { label },
    )
  }
  return {
    revision: candidate.revision,
    checksum: candidate.checksum,
  }
}

function ownerPendingProfileIdentity(value, label = 'profile identity') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_REVISION_EVIDENCE_MISSING',
      `${label} must be an object`,
      { label },
    )
  }
  const profileRevision = value.profileRevision ?? value.revision
  if (!Number.isInteger(profileRevision) || profileRevision < 0) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_REVISION_EVIDENCE_MISSING',
      `${label} must contain a non-negative profile revision`,
      { label },
    )
  }
  if (!value.domains || typeof value.domains !== 'object' || Array.isArray(value.domains)) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_REVISION_EVIDENCE_MISSING',
      `${label} must contain all six domain identities`,
      { label },
    )
  }
  const keys = Object.keys(value.domains)
  if (keys.length !== OWNER_PROFILE_DOMAINS.length || keys.some((domain) => !OWNER_PROFILE_DOMAINS.includes(domain))) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_UNKNOWN_DOMAIN',
      `${label} must claim exactly the registered six domains`,
      { label, domains: keys },
    )
  }
  const domains = Object.fromEntries(OWNER_PROFILE_DOMAINS.map((domain) => [
    domain,
    ownerPendingDomainIdentity(value.domains[domain], `${label}.${domain}`),
  ]))
  const expectedChecksum = checksumValue({ profileRevision, domains })
  if (typeof value.checksum !== 'string' || value.checksum !== expectedChecksum) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_CHECKSUM_INVALID',
      `${label} checksum does not match its revision identities`,
      { label },
    )
  }
  return {
    profileRevision,
    domains,
    checksum: value.checksum,
  }
}

function ownerPendingProfileIdentityEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function ownerPendingPrepareEvidence(value, domain, baseline, staged, label = 'prepare evidence') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_PREPARE_EVIDENCE_MISSING', `${label} is missing`, { domain })
  }
  const normalizedDomain = ownerModeDomain(domain)
  const baselineIdentity = ownerPendingDomainIdentity(baseline, `${label}.${normalizedDomain}.baseline`)
  const stagedIdentity = ownerPendingDomainIdentity(staged, `${label}.${normalizedDomain}.staged`)
  if (value.status !== 'verified'
    || typeof value.source !== 'string' || !value.source.trim()
    || value.baselineRevision !== baselineIdentity.revision
    || value.baselineChecksum !== baselineIdentity.checksum
    || value.stagedRevision !== stagedIdentity.revision
    || value.stagedChecksum !== stagedIdentity.checksum
    || typeof value.evidenceChecksum !== 'string'
    || value.evidenceChecksum !== checksumValue({
      kind: 'prepare',
      domain: normalizedDomain,
      baseline: baselineIdentity,
      staged: stagedIdentity,
    })) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_PREPARE_EVIDENCE_INVALID',
      `Prepare evidence for ${normalizedDomain} is incomplete or inconsistent`,
      { domain: normalizedDomain },
    )
  }
  return {
    status: 'verified',
    source: ownerPendingSafeText(value.source, `${normalizedDomain} prepare source`),
    baselineRevision: baselineIdentity.revision,
    baselineChecksum: baselineIdentity.checksum,
    stagedRevision: stagedIdentity.revision,
    stagedChecksum: stagedIdentity.checksum,
    evidenceChecksum: value.evidenceChecksum,
    preparedAt: ownerPendingTimestamp(value.preparedAt, `${normalizedDomain} preparedAt`),
  }
}

function ownerPendingCommitEvidence(value, domain, staged, label = 'commit evidence') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_COMMIT_EVIDENCE_MISSING', `${label} is missing`, { domain })
  }
  const normalizedDomain = ownerModeDomain(domain)
  const stagedIdentity = ownerPendingDomainIdentity(staged, `${label}.${normalizedDomain}.staged`)
  if (value.status !== 'committed'
    || typeof value.source !== 'string' || !value.source.trim()
    || value.revision !== stagedIdentity.revision
    || value.checksum !== stagedIdentity.checksum
    || typeof value.evidenceChecksum !== 'string'
    || value.evidenceChecksum !== checksumValue({
      kind: 'commit',
      domain: normalizedDomain,
      staged: stagedIdentity,
      revision: stagedIdentity.revision,
      checksum: stagedIdentity.checksum,
    })) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_COMMIT_EVIDENCE_INVALID',
      `Commit evidence for ${normalizedDomain} is incomplete or inconsistent`,
      { domain: normalizedDomain },
    )
  }
  return {
    status: 'committed',
    source: ownerPendingSafeText(value.source, `${normalizedDomain} commit source`),
    revision: stagedIdentity.revision,
    checksum: stagedIdentity.checksum,
    evidenceChecksum: value.evidenceChecksum,
    committedAt: ownerPendingTimestamp(value.committedAt, `${normalizedDomain} committedAt`),
  }
}

function ownerPendingRecovery(value, status) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_RECOVERY_EVIDENCE_MISSING', 'Pending journal recovery evidence is missing')
  }
  const decision = value.decision ?? null
  const result = value.result ?? null
  if (decision !== null && !['baseline', 'staged', 'manual-recovery'].includes(decision)) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_RECOVERY_EVIDENCE_INVALID', 'Pending journal recovery decision is unsupported')
  }
  if (result !== null && !['baseline-recovered', 'staged-recovered', 'staged-committed', 'blocked'].includes(result)) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_RECOVERY_EVIDENCE_INVALID', 'Pending journal recovery result is unsupported')
  }
  if (value.recoveredAt !== undefined) ownerPendingTimestamp(value.recoveredAt, 'recoveredAt')
  if (status === 'manual-recovery' && (decision !== 'manual-recovery' || result !== 'blocked')) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_RECOVERY_EVIDENCE_INVALID', 'manual-recovery requires a blocked recovery decision')
  }
  if (status === 'finalized' && (!decision || !result || decision === 'manual-recovery')) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_RECOVERY_EVIDENCE_INVALID', 'finalized journal requires a completed baseline or staged decision')
  }
  let reason = null
  if (value.reason !== undefined && value.reason !== null) {
    if (!value.reason || typeof value.reason !== 'object' || Array.isArray(value.reason)) {
      throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_RECOVERY_EVIDENCE_INVALID', 'Pending journal recovery reason must be an object')
    }
    reason = {
      code: ownerPendingSafeText(value.reason.code, 'recovery reason code'),
      message: ownerPendingSafeText(value.reason.message, 'recovery reason message', { allowPathLike: true }),
    }
  }
  return {
    decision,
    result,
    ...(reason ? { reason } : {}),
    ...(value.recoveredAt ? { recoveredAt: value.recoveredAt } : {}),
  }
}

export function calculateOwnerPendingJournalChecksum(value) {
  const { checksum: _checksum, ...core } = value || {}
  return checksumValue(core)
}

export function createOwnerPendingProfileIdentity({ profileRevision, revision, domains } = {}) {
  const normalizedRevision = profileRevision ?? revision
  if (!Number.isInteger(normalizedRevision) || normalizedRevision < 0) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_REVISION_EVIDENCE_MISSING', 'Profile identity requires a non-negative revision')
  }
  const normalizedDomains = Object.fromEntries(OWNER_PROFILE_DOMAINS.map((domain) => [
    domain,
    ownerPendingDomainIdentity(domains?.[domain], `profile identity.${domain}`),
  ]))
  const core = { profileRevision: normalizedRevision, domains: normalizedDomains }
  return Object.freeze({ ...core, checksum: checksumValue(core) })
}

export function createOwnerPendingPrepareEvidence({ domain, baseline, staged, source = 'owner-pending-adapter', preparedAt = new Date().toISOString() } = {}) {
  const normalizedDomain = ownerModeDomain(domain)
  const baselineIdentity = ownerPendingDomainIdentity(baseline, `${normalizedDomain} baseline`)
  const stagedIdentity = ownerPendingDomainIdentity(staged, `${normalizedDomain} staged`)
  return Object.freeze({
    status: 'verified',
    source: ownerPendingSafeText(source, `${normalizedDomain} prepare source`),
    baselineRevision: baselineIdentity.revision,
    baselineChecksum: baselineIdentity.checksum,
    stagedRevision: stagedIdentity.revision,
    stagedChecksum: stagedIdentity.checksum,
    evidenceChecksum: checksumValue({
      kind: 'prepare',
      domain: normalizedDomain,
      baseline: baselineIdentity,
      staged: stagedIdentity,
    }),
    preparedAt: ownerPendingTimestamp(preparedAt, `${normalizedDomain} preparedAt`),
  })
}

export function createOwnerPendingCommitEvidence({ domain, staged, source = 'owner-pending-adapter', committedAt = new Date().toISOString() } = {}) {
  const normalizedDomain = ownerModeDomain(domain)
  const stagedIdentity = ownerPendingDomainIdentity(staged, `${normalizedDomain} staged`)
  return Object.freeze({
    status: 'committed',
    source: ownerPendingSafeText(source, `${normalizedDomain} commit source`),
    revision: stagedIdentity.revision,
    checksum: stagedIdentity.checksum,
    evidenceChecksum: checksumValue({
      kind: 'commit',
      domain: normalizedDomain,
      staged: stagedIdentity,
      revision: stagedIdentity.revision,
      checksum: stagedIdentity.checksum,
    }),
    committedAt: ownerPendingTimestamp(committedAt, `${normalizedDomain} committedAt`),
  })
}

export function validateOwnerPendingJournal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_CORRUPT', 'Pending journal is not an object')
  }
  if (value.schemaVersion !== OWNER_PENDING_JOURNAL_SCHEMA_VERSION) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_UNKNOWN_SCHEMA', 'Pending journal schema is unsupported', {
      schemaVersion: value.schemaVersion ?? null,
    })
  }
  const journalId = ownerPendingSafeText(value.journalId, 'journalId')
  const operationId = ownerPendingSafeText(value.operationId, 'operationId')
  const profileId = ownerPendingSafeText(value.profileId, 'profileId')
  const releaseId = ownerPendingSafeText(value.releaseId, 'releaseId')
  const instanceId = ownerPendingSafeText(value.instanceId, 'instanceId')
  const correlationId = ownerPendingSafeText(value.correlationId, 'correlationId')
  if (!Array.isArray(value.domains)
    || value.domains.length !== OWNER_PROFILE_DOMAINS.length
    || value.domains.some((domain, index) => domain !== OWNER_PROFILE_DOMAINS[index])) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_UNKNOWN_DOMAIN', 'Pending journal domains must use the fixed six-domain order', {
      domains: value.domains ?? null,
    })
  }
  if (!OWNER_PENDING_JOURNAL_OPERATION_KINDS.includes(value.operationKind)) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_OPERATION_INVALID', 'Pending journal operation kind is unsupported', {
      operationKind: value.operationKind ?? null,
    })
  }
  if (!OWNER_PENDING_JOURNAL_PHASES.includes(value.phase)
    || !OWNER_PENDING_JOURNAL_STATUSES.includes(value.status)) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_STATE_INVALID', 'Pending journal phase or status is unsupported')
  }
  const baseline = ownerPendingProfileIdentity(value.baseline, 'baseline')
  const staged = ownerPendingProfileIdentity(value.staged, 'staged')
  if (staged.profileRevision < baseline.profileRevision
    || OWNER_PROFILE_DOMAINS.some((domain) => staged.domains[domain].revision < baseline.domains[domain].revision)) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_REVISION_INVALID', 'Staged revision cannot precede baseline revision')
  }
  if (!value.prepareEvidence || typeof value.prepareEvidence !== 'object' || Array.isArray(value.prepareEvidence)
    || !value.commitEvidence || typeof value.commitEvidence !== 'object' || Array.isArray(value.commitEvidence)) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_EVIDENCE_MISSING', 'Pending journal requires prepare and commit evidence maps')
  }
  const evidenceKeys = (map, label) => {
    const keys = Object.keys(map)
    if (keys.some((domain) => !OWNER_PROFILE_DOMAINS.includes(domain))) {
      throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_UNKNOWN_DOMAIN', `${label} contains an unknown domain`, { domains: keys })
    }
    return keys
  }
  const prepareKeys = evidenceKeys(value.prepareEvidence, 'prepare evidence')
  const commitKeys = evidenceKeys(value.commitEvidence, 'commit evidence')
  const prepareEvidence = Object.fromEntries(prepareKeys.map((domain) => [
    domain,
    ownerPendingPrepareEvidence(value.prepareEvidence[domain], domain, baseline.domains[domain], staged.domains[domain]),
  ]))
  const commitEvidence = Object.fromEntries(commitKeys.map((domain) => [
    domain,
    ownerPendingCommitEvidence(value.commitEvidence[domain], domain, staged.domains[domain]),
  ]))
  const allPrepared = OWNER_PROFILE_DOMAINS.every((domain) => prepareKeys.includes(domain))
  const allCommitted = OWNER_PROFILE_DOMAINS.every((domain) => commitKeys.includes(domain))
  if (['prepared', 'committing', 'committed', 'finalized'].includes(value.status) && !allPrepared) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_PREPARE_EVIDENCE_MISSING', 'Pending journal entered commit before all domains were prepared')
  }
  if (value.status === 'committed' && !allCommitted) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_COMMIT_EVIDENCE_MISSING', 'Committed pending journal lacks all domain commit evidence')
  }
  const recovery = ownerPendingRecovery(value.recovery, value.status)
  if (value.status === 'finalized' && recovery.decision === 'staged' && !allCommitted) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_COMMIT_EVIDENCE_MISSING', 'Staged finalized journal lacks all domain commit evidence')
  }
  if ((value.status === 'pending' && value.phase !== 'prepare')
    || (value.status === 'prepared' && value.phase !== 'prepare')
    || (value.status === 'committing' && value.phase !== 'commit')
    || (value.status === 'committed' && value.phase !== 'commit')
    || (value.status === 'manual-recovery' && value.phase !== 'recovery')
    || (value.status === 'finalized' && value.phase !== 'finalize')) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_STATE_INVALID', 'Pending journal phase does not match status')
  }
  const createdAt = ownerPendingTimestamp(value.createdAt, 'createdAt')
  const updatedAt = ownerPendingTimestamp(value.updatedAt, 'updatedAt')
  if (typeof value.checksum !== 'string' || value.checksum !== calculateOwnerPendingJournalChecksum(value)) {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_CORRUPT', 'Pending journal checksum does not match its content')
  }
  return {
    schemaVersion: OWNER_PENDING_JOURNAL_SCHEMA_VERSION,
    journalId,
    operationId,
    profileId,
    releaseId,
    instanceId,
    correlationId,
    domains: [...OWNER_PROFILE_DOMAINS],
    operationKind: value.operationKind,
    phase: value.phase,
    status: value.status,
    baseline,
    staged,
    prepareEvidence,
    commitEvidence,
    recovery,
    createdAt,
    updatedAt,
    checksum: value.checksum,
  }
}

function ownerPendingJournalPath(profileAuthorityRoot) {
  return path.join(profileAuthorityRoot, OWNER_PENDING_JOURNAL_FILE)
}

function ownerPendingJournalCore(value) {
  const { checksum: _checksum, ...core } = value || {}
  return core
}

function ownerPendingWithChecksum(value) {
  const core = ownerPendingJournalCore(value)
  return { ...core, checksum: calculateOwnerPendingJournalChecksum(core) }
}

function ownerPendingFaultState(faults = {}) {
  return {
    ...(faults && typeof faults === 'object' && !Array.isArray(faults) ? faults : {}),
    journalWriteCount: 0,
  }
}

export async function readOwnerPendingJournalUnlocked(profileAuthorityRoot, io) {
  const filePath = ownerPendingJournalPath(profileAuthorityRoot)
  if (!await pathExists(filePath)) return null
  await io.assertPathContainedBeforeWrite(profileAuthorityRoot, filePath)
  const value = await readJsonIfPresent(filePath, 'OWNER_PENDING_JOURNAL_CORRUPT')
  if (!value) return null
  return validateOwnerPendingJournal(value)
}

export async function writeOwnerPendingJournalUnlocked(profileAuthorityRoot, value, faultState = {}, io) {
  const validated = validateOwnerPendingJournal(value)
  const state = faultState && typeof faultState === 'object' ? faultState : {}
  state.journalWriteCount = Number(state.journalWriteCount || 0) + 1
  const requestedFailure = Number(state.failWriteAt ?? state.failJournalWriteAt)
  if (Number.isInteger(requestedFailure) && requestedFailure === state.journalWriteCount) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_ATOMIC_WRITE_FAILED',
      `Pending journal atomic write failed at write ${state.journalWriteCount}`,
      { writeCount: state.journalWriteCount },
    )
  }
  const filePath = ownerPendingJournalPath(profileAuthorityRoot)
  await io.writeJsonAtomic(filePath, validated, { containmentRoot: profileAuthorityRoot })
  await io.assertPathContainedBeforeWrite(profileAuthorityRoot, filePath)
  const reread = await readJsonIfPresent(filePath, 'OWNER_PENDING_JOURNAL_CORRUPT')
  return validateOwnerPendingJournal(reread)
}

function ownerPendingJournalUpdate(journal, updates = {}) {
  return ownerPendingWithChecksum({
    ...journal,
    ...updates,
    updatedAt: new Date().toISOString(),
  })
}

function ownerPendingResult({ status, decision = null, result = null, reason = null, journalRetained = true, journalUpdated = false, journal = null } = {}) {
  return {
    schemaVersion: OWNER_PENDING_JOURNAL_SCHEMA_VERSION,
    status,
    ready: status === 'none' || status === 'finalized',
    decision,
    result,
    ...(reason ? { reason } : {}),
    journalRetained,
    journalUpdated,
    ...(journal ? { journal: clone(journal) } : {}),
    ownerMode: 'pre-cutover',
    ownerApiAuthoritative: false,
  }
}

function ownerPendingReason(error, fallbackCode = 'OWNER_PENDING_JOURNAL_RECOVERY_REQUIRED') {
  return {
    code: typeof error?.code === 'string' && error.code ? error.code : fallbackCode,
    message: typeof error?.message === 'string' && error.message
      ? error.message
      : 'Pending journal recovery requires manual review',
  }
}

async function ownerPendingMarkManual(profileAuthorityRoot, journal, error, faultState, io) {
  const reason = ownerPendingReason(error)
  const next = ownerPendingJournalUpdate(journal, {
    phase: 'recovery',
    status: 'manual-recovery',
    recovery: {
      decision: 'manual-recovery',
      result: 'blocked',
      reason,
      recoveredAt: new Date().toISOString(),
    },
  })
  try {
    const written = await writeOwnerPendingJournalUnlocked(profileAuthorityRoot, next, faultState, io)
    return ownerPendingResult({
      status: 'manual-recovery',
      decision: 'manual-recovery',
      result: 'blocked',
      reason,
      journalRetained: true,
      journalUpdated: true,
      journal: written,
    })
  } catch (writeError) {
    return ownerPendingResult({
      status: 'manual-recovery',
      decision: 'manual-recovery',
      result: 'blocked',
      reason: {
        code: reason.code,
        message: `${reason.message}; recovery evidence could not be updated: ${writeError?.code || writeError?.message || 'write failed'}`,
      },
      journalRetained: true,
      journalUpdated: false,
      journal,
    })
  }
}

function ownerPendingRequireAdapters(adapters, { operation = false, recovery = false } = {}) {
  if (!adapters || typeof adapters !== 'object' || Array.isArray(adapters)) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_ADAPTER_MISSING',
      'Pending journal operation requires all six domain adapters',
    )
  }
  const keys = Object.keys(adapters)
  if (keys.some((domain) => !OWNER_PROFILE_DOMAINS.includes(domain))) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_UNKNOWN_DOMAIN',
      'Pending journal adapters must claim exactly the registered six domains',
      { domains: keys },
    )
  }
  if (keys.length !== OWNER_PROFILE_DOMAINS.length) {
    throw ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_ADAPTER_MISSING',
      'Pending journal adapters must provide all six registered domains',
      { domains: keys },
    )
  }
  for (const domain of OWNER_PROFILE_DOMAINS) {
    const adapter = adapters[domain]
    const restore = typeof adapter?.restore === 'function' || typeof adapter?.restoreRecords === 'function'
    if (!adapter || typeof adapter !== 'object' || typeof adapter.read !== 'function'
      || (operation && (typeof adapter.prepare !== 'function' || typeof adapter.commit !== 'function'))
      || (recovery && !restore)) {
      throw ownerPendingJournalError(
        'OWNER_PENDING_JOURNAL_ADAPTER_MISSING',
        `Pending journal adapter for ${domain} does not expose the required evidence handlers`,
        { domain, operation, recovery },
      )
    }
  }
  return adapters
}

async function ownerPendingReadDomain(adapter, domain, journal) {
  let value
  try {
    value = await adapter.read({ domain, journal: clone(journal) })
  } catch (error) {
    throw ownerPendingJournalError(
      error?.code || 'OWNER_PENDING_JOURNAL_REVISION_READ_FAILED',
      `Could not read current revision evidence for ${domain}`,
      { domain, cause: error?.message || String(error) },
    )
  }
  return ownerPendingDomainIdentity(value?.identity || value, `${domain} current identity`)
}

function ownerPendingReturnedMetadata(value, domain, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ownerPendingJournalError(
      kind === 'prepare'
        ? 'OWNER_PENDING_JOURNAL_PREPARE_EVIDENCE_MISSING'
        : 'OWNER_PENDING_JOURNAL_COMMIT_EVIDENCE_MISSING',
      `${kind} adapter for ${domain} did not return evidence`,
      { domain },
    )
  }
  return value.evidence && typeof value.evidence === 'object' && !Array.isArray(value.evidence)
    ? { ...value.evidence, ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'evidence')) }
    : value
}

async function ownerPendingPrepare(adapter, domain, baseline, staged, journal) {
  const raw = ownerPendingReturnedMetadata(await adapter.prepare({
    domain,
    baseline: clone(baseline),
    staged: clone(staged),
    correlationId: journal.correlationId,
    journal: clone(journal),
  }), domain, 'prepare')
  return ownerPendingPrepareEvidence(
    raw,
    domain,
    baseline,
    staged,
    `Prepare adapter evidence for ${domain}`,
  )
}

async function ownerPendingCommit(adapter, domain, current, staged, journal) {
  const raw = ownerPendingReturnedMetadata(await adapter.commit({
    domain,
    current: clone(current),
    baseline: clone(current),
    staged: clone(staged),
    expectedRevision: current.revision,
    correlationId: journal.correlationId,
    journal: clone(journal),
  }), domain, 'commit')
  return ownerPendingCommitEvidence(
    raw,
    domain,
    staged,
    `Commit adapter evidence for ${domain}`,
  )
}

async function ownerPendingRestore(adapter, domain, target, journal, current) {
  const restore = typeof adapter.restore === 'function' ? adapter.restore : adapter.restoreRecords
  if (typeof restore !== 'function') {
    throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_RECOVERY_HANDLER_MISSING', `Recovery handler for ${domain} is missing`, { domain })
  }
  const result = await restore.call(adapter, {
    domain,
    target: clone(target),
    expectedRevision: current.revision,
    identity: clone(target),
    journal: clone(journal),
  })
  if (result !== undefined && result !== null) {
    const returned = ownerPendingDomainIdentity(result?.identity || result, `${domain} recovery identity`)
    if (!ownerPendingProfileIdentityEqual(returned, target)) {
      throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_REVISION_CONFLICT', `Recovery handler for ${domain} returned the wrong revision`, { domain })
    }
  }
}

function ownerPendingStateMap(current, baseline, staged) {
  return Object.fromEntries(OWNER_PROFILE_DOMAINS.map((domain) => {
    if (ownerPendingProfileIdentityEqual(current[domain], baseline.domains[domain])) return [domain, 'baseline']
    if (ownerPendingProfileIdentityEqual(current[domain], staged.domains[domain])) return [domain, 'staged']
    return [domain, 'conflict']
  }))
}

async function ownerPendingFinalize(profileAuthorityRoot, journal, decision, result, faultState, io) {
  const finalized = ownerPendingJournalUpdate(journal, {
    phase: 'finalize',
    status: 'finalized',
    recovery: {
      decision,
      result,
      recoveredAt: new Date().toISOString(),
    },
  })
  return writeOwnerPendingJournalUnlocked(profileAuthorityRoot, finalized, faultState, io)
}

export async function recoverOwnerPendingJournalUnlocked(context, options = {}, io) {
  const { profileAuthorityRoot } = context
  const faultState = ownerPendingFaultState(options.faults)
  let journal
  try {
    journal = await readOwnerPendingJournalUnlocked(profileAuthorityRoot, io)
  } catch (error) {
    const retained = await pathExists(ownerPendingJournalPath(profileAuthorityRoot)).catch(() => true)
    return ownerPendingResult({
      status: 'manual-recovery',
      decision: 'manual-recovery',
      result: 'blocked',
      reason: ownerPendingReason(error, 'OWNER_PENDING_JOURNAL_CORRUPT'),
      journalRetained: retained,
      journalUpdated: false,
    })
  }
  if (!journal) return ownerPendingResult({ status: 'none', journalRetained: false })
  if (journal.status === 'finalized') {
    return ownerPendingResult({
      status: 'finalized',
      decision: journal.recovery.decision,
      result: journal.recovery.result,
      journalRetained: true,
      journalUpdated: false,
      journal,
    })
  }
  if (journal.status === 'manual-recovery') {
    return ownerPendingResult({
      status: 'manual-recovery',
      decision: 'manual-recovery',
      result: 'blocked',
      reason: journal.recovery.reason || ownerPendingReason(null),
      journalRetained: true,
      journalUpdated: false,
      journal,
    })
  }
  const allPrepared = OWNER_PROFILE_DOMAINS.every((domain) => journal.prepareEvidence[domain])
  if (!allPrepared) {
    return ownerPendingMarkManual(profileAuthorityRoot, journal, ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_PREPARE_EVIDENCE_MISSING',
      'Pending journal recovery cannot proceed without prepare evidence for all six domains',
      { domains: OWNER_PROFILE_DOMAINS.filter((domain) => !journal.prepareEvidence[domain]) },
    ), faultState, io)
  }
  let adapters
  try {
    adapters = ownerPendingRequireAdapters(options.adapters, { recovery: true })
  } catch (error) {
    return ownerPendingMarkManual(profileAuthorityRoot, journal, error, faultState, io)
  }
  let current
  try {
    current = Object.fromEntries(await Promise.all(OWNER_PROFILE_DOMAINS.map(async (domain) => [
      domain,
      await ownerPendingReadDomain(adapters[domain], domain, journal),
    ])))
  } catch (error) {
    return ownerPendingMarkManual(profileAuthorityRoot, journal, error, faultState, io)
  }
  const states = ownerPendingStateMap(current, journal.baseline, journal.staged)
  if (Object.values(states).some((state) => state === 'conflict')) {
    return ownerPendingMarkManual(profileAuthorityRoot, journal, ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_REVISION_CONFLICT',
      'Current domain state is neither the verified baseline nor the verified staged revision',
      { domains: Object.entries(states).filter(([, state]) => state === 'conflict').map(([domain]) => domain) },
    ), faultState, io)
  }
  const allCommitted = OWNER_PROFILE_DOMAINS.every((domain) => journal.commitEvidence[domain])
  const allBaseline = OWNER_PROFILE_DOMAINS.every((domain) => states[domain] === 'baseline')
  const allStaged = OWNER_PROFILE_DOMAINS.every((domain) => states[domain] === 'staged')
  let decision
  if (allCommitted) {
    decision = 'staged'
  } else if (allBaseline) {
    decision = 'baseline'
  } else if (allStaged) {
    return ownerPendingMarkManual(profileAuthorityRoot, journal, ownerPendingJournalError(
      'OWNER_PENDING_JOURNAL_COMMIT_EVIDENCE_MISSING',
      'All domains are staged but the journal does not contain all commit evidence',
    ), faultState, io)
  } else {
    decision = 'baseline'
    const missingEvidence = OWNER_PROFILE_DOMAINS.filter((domain) => (
      states[domain] === 'staged' && !journal.commitEvidence[domain]
    ))
    if (missingEvidence.length) {
      return ownerPendingMarkManual(profileAuthorityRoot, journal, ownerPendingJournalError(
        'OWNER_PENDING_JOURNAL_COMMIT_EVIDENCE_MISSING',
        'A partially staged domain has no verified commit evidence',
        { domains: missingEvidence },
      ), faultState, io)
    }
  }
  const target = decision === 'staged' ? journal.staged : journal.baseline
  const differingDomains = OWNER_PROFILE_DOMAINS.filter((domain) => !ownerPendingProfileIdentityEqual(current[domain], target.domains[domain]))
  try {
    for (const domain of differingDomains) {
      await ownerPendingRestore(adapters[domain], domain, target.domains[domain], journal, current[domain])
    }
    const verifiedCurrent = Object.fromEntries(await Promise.all(OWNER_PROFILE_DOMAINS.map(async (domain) => [
      domain,
      await ownerPendingReadDomain(adapters[domain], domain, journal),
    ])))
    const mismatched = OWNER_PROFILE_DOMAINS.filter((domain) => !ownerPendingProfileIdentityEqual(verifiedCurrent[domain], target.domains[domain]))
    if (mismatched.length) {
      throw ownerPendingJournalError(
        'OWNER_PENDING_JOURNAL_RECOVERY_UNVERIFIED',
        'Recovery did not establish one complete profile revision',
        { domains: mismatched },
      )
    }
    const recoveryResult = decision === 'staged'
      ? (differingDomains.length ? 'staged-recovered' : 'staged-committed')
      : 'baseline-recovered'
    const finalized = await ownerPendingFinalize(profileAuthorityRoot, journal, decision, recoveryResult, faultState, io)
    return ownerPendingResult({
      status: 'finalized',
      decision,
      result: recoveryResult,
      journalRetained: true,
      journalUpdated: true,
      journal: finalized,
    })
  } catch (error) {
    return ownerPendingMarkManual(profileAuthorityRoot, journal, error, faultState, io)
  }
}

export async function runOwnerPendingJournalOperationUnlocked(context, options = {}, io) {
    const operationKind = options.operationKind || 'restore'
    if (!OWNER_PENDING_JOURNAL_OPERATION_KINDS.includes(operationKind)) {
      throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_OPERATION_INVALID', 'Pending journal operation kind is unsupported', { operationKind })
    }
    const adapters = ownerPendingRequireAdapters(options.adapters, { operation: true })
    const baseline = ownerPendingProfileIdentity(options.baseline, 'baseline')
    const staged = ownerPendingProfileIdentity(options.staged, 'staged')
    const releaseId = ownerPendingSafeText(options.releaseId || options.release?.releaseId || 'isolated-release', 'releaseId')
    const instanceId = ownerPendingSafeText(options.instanceId || process.env.READ_WEB_INSTANCE_ID || 'isolated-instance', 'instanceId')
    const operationId = ownerPendingSafeText(options.operationId || randomUUID(), 'operationId')
    const journalId = ownerPendingSafeText(options.journalId || operationId, 'journalId')
    const correlationId = ownerPendingSafeText(options.correlationId || operationId, 'correlationId')
    let existing
    try {
      existing = await readOwnerPendingJournalUnlocked(context.profileAuthorityRoot, io)
    } catch (error) {
      throw error
    }
    if (existing && existing.profileId !== context.profileId) {
      throw ownerPendingJournalError('OWNER_PENDING_JOURNAL_PROFILE_MISMATCH', 'Existing pending journal belongs to another profile')
    }
    if (existing && existing.status !== 'finalized') {
      throw ownerPendingJournalError(
        existing.status === 'manual-recovery'
          ? 'OWNER_PENDING_JOURNAL_MANUAL_RECOVERY_REQUIRED'
          : 'OWNER_PENDING_JOURNAL_RECOVERY_REQUIRED',
        'An unresolved pending journal must be recovered before another operation begins',
      )
    }
    const current = Object.fromEntries(await Promise.all(OWNER_PROFILE_DOMAINS.map(async (domain) => [
      domain,
      await ownerPendingReadDomain(adapters[domain], domain, {
        profileId: context.profileId,
        correlationId,
      }),
    ])))
    const baselineMismatch = OWNER_PROFILE_DOMAINS.filter((domain) => !ownerPendingProfileIdentityEqual(current[domain], baseline.domains[domain]))
    if (baselineMismatch.length) {
      throw ownerPendingJournalError(
        'OWNER_PENDING_JOURNAL_BASELINE_MISMATCH',
        'Current domain state does not match the requested complete baseline',
        { domains: baselineMismatch },
      )
    }
    const now = new Date().toISOString()
    let journal = ownerPendingWithChecksum({
      schemaVersion: OWNER_PENDING_JOURNAL_SCHEMA_VERSION,
      journalId,
      operationId,
      profileId: context.profileId,
      releaseId,
      instanceId,
      correlationId,
      domains: [...OWNER_PROFILE_DOMAINS],
      operationKind,
      phase: 'prepare',
      status: 'pending',
      baseline,
      staged,
      prepareEvidence: {},
      commitEvidence: {},
      recovery: { decision: null, result: null },
      createdAt: now,
      updatedAt: now,
    })
    const faultState = ownerPendingFaultState(options.faults)
    await writeOwnerPendingJournalUnlocked(context.profileAuthorityRoot, journal, faultState, io)
    for (const domain of OWNER_PROFILE_DOMAINS) {
      const evidence = await ownerPendingPrepare(
        adapters[domain],
        domain,
        baseline.domains[domain],
        staged.domains[domain],
        journal,
      )
      journal = ownerPendingJournalUpdate(journal, {
        prepareEvidence: { ...journal.prepareEvidence, [domain]: evidence },
      })
      await writeOwnerPendingJournalUnlocked(context.profileAuthorityRoot, journal, faultState, io)
    }
    journal = ownerPendingJournalUpdate(journal, { status: 'prepared', phase: 'prepare' })
    await writeOwnerPendingJournalUnlocked(context.profileAuthorityRoot, journal, faultState, io)
    if (options.faults?.crashAfterPrepare === true) process.kill(process.pid, 'SIGKILL')
    journal = ownerPendingJournalUpdate(journal, { status: 'committing', phase: 'commit' })
    await writeOwnerPendingJournalUnlocked(context.profileAuthorityRoot, journal, faultState, io)
    for (let index = 0; index < OWNER_PROFILE_DOMAINS.length; index += 1) {
      const domain = OWNER_PROFILE_DOMAINS[index]
      const evidence = await ownerPendingCommit(
        adapters[domain],
        domain,
        current[domain],
        staged.domains[domain],
        journal,
      )
      journal = ownerPendingJournalUpdate(journal, {
        commitEvidence: { ...journal.commitEvidence, [domain]: evidence },
      })
      await writeOwnerPendingJournalUnlocked(context.profileAuthorityRoot, journal, faultState, io)
      const crashAfter = options.faults?.crashAfterCommitDomain
      if ((Number.isInteger(crashAfter) && crashAfter === index + 1)
        || (typeof crashAfter === 'string' && crashAfter === domain)
        || (Number.isInteger(options.faults?.crashAfterCommitIndex) && options.faults.crashAfterCommitIndex === index)) {
        process.kill(process.pid, 'SIGKILL')
      }
    }
    const committedState = Object.fromEntries(await Promise.all(OWNER_PROFILE_DOMAINS.map(async (domain) => [
      domain,
      await ownerPendingReadDomain(adapters[domain], domain, journal),
    ])))
    const commitStateMismatches = OWNER_PROFILE_DOMAINS.filter((domain) => (
      !ownerPendingProfileIdentityEqual(committedState[domain], staged.domains[domain])
    ))
    if (commitStateMismatches.length) {
      throw ownerPendingJournalError(
        'OWNER_PENDING_JOURNAL_COMMIT_VERIFICATION_FAILED',
        'Committed domain evidence does not match the staged profile state',
        { domains: commitStateMismatches },
      )
    }
    journal = ownerPendingJournalUpdate(journal, { status: 'committed', phase: 'commit' })
    await writeOwnerPendingJournalUnlocked(context.profileAuthorityRoot, journal, faultState, io)
    if (options.faults?.crashBeforeFinalize === true) process.kill(process.pid, 'SIGKILL')
    journal = ownerPendingJournalUpdate(journal, {
      status: 'finalized',
      phase: 'finalize',
      recovery: {
        decision: 'staged',
        result: 'staged-committed',
        recoveredAt: new Date().toISOString(),
      },
    })
    const finalized = await writeOwnerPendingJournalUnlocked(context.profileAuthorityRoot, journal, faultState, io)
    return ownerPendingResult({
      status: 'finalized',
      decision: 'staged',
      result: 'staged-committed',
      journalRetained: true,
      journalUpdated: true,
      journal: finalized,
    })
}


export {
  OWNER_PENDING_JOURNAL_FILE,
  OWNER_PENDING_JOURNAL_OPERATION_KINDS,
  OWNER_PENDING_JOURNAL_SCHEMA_VERSION,
  OWNER_PROFILE_DOMAINS,
}
