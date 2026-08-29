import {
  clearOwnerModeFreeze,
  revokeOwnerModeCheckpoint,
  writeOwnerModeCheckpoint,
  writeOwnerModeFreeze,
} from './read-web-production-backup.mjs'

const DOMAINS = Object.freeze([
  'reader-session',
  'marks-activity',
  'passage-preview',
  'annotation',
  'vocabulary-srs',
  'workflow',
])

function safeChecksum(value, field) {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    const error = new Error(`${field} must be a checksum`)
    error.code = 'OWNER_CUTOVER_EVIDENCE_INVALID'
    throw error
  }
  return value
}

function safeRevision(value) {
  if ((Number.isInteger(value) && value >= 0)
    || (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))) return value
  const error = new Error('owner cutover revision is invalid')
  error.code = 'OWNER_CUTOVER_EVIDENCE_INVALID'
  throw error
}

function domainIdentity(domain) {
  if (!DOMAINS.includes(domain)) {
    const error = new Error(`owner cutover domain is not registered: ${domain}`)
    error.code = 'OWNER_CUTOVER_DOMAIN_INVALID'
    throw error
  }
  return `windows-host.repository.${domain}.v1`
}

/**
 * Connect the already-verified migration controller to the existing durable
 * owner-mode checkpoint.  The caller supplies the small domain smoke check;
 * this helper only records one per-domain authority decision and never
 * coordinates multiple domains.
 */
export function createWindowsOwnerCutoverControls(options = {}) {
  const common = {
    isolationRoot: options.isolationRoot,
    profileDir: options.profileDir,
    profileAuthorityIsolationRoot: options.profileAuthorityIsolationRoot,
    profileAuthorityRoot: options.profileAuthorityRoot,
    profileId: options.profileId,
  }
  const smokeCheck = typeof options.smokeCheck === 'function' ? options.smokeCheck : null
  return Object.fromEntries(DOMAINS.map((domain) => [domain, {
    async freeze({ domain: requestedDomain, reason }) {
      if (requestedDomain !== domain) return { ok: false, reasonCode: 'OWNER_CUTOVER_DOMAIN_MISMATCH' }
      const result = await writeOwnerModeFreeze({ ...common, domain, reason })
      return { ok: true, status: result.status, frozen: true }
    },
    async unfreeze({ domain: requestedDomain }) {
      if (requestedDomain !== domain) return { ok: false, reasonCode: 'OWNER_CUTOVER_DOMAIN_MISMATCH' }
      const result = await clearOwnerModeFreeze({ ...common, domain })
      return { ok: true, status: result.status, frozen: false }
    },
    async switch({ domain: requestedDomain, revision, checksum, frozen, finalBackup }) {
      if (requestedDomain !== domain || frozen !== true || !finalBackup?.final) {
        return { ok: false, reasonCode: 'OWNER_CUTOVER_PRECONDITION_FAILED' }
      }
      const revisionEvidence = safeChecksum(checksum, 'revision evidence')
      const baseEvidence = safeChecksum(finalBackup.artifactChecksum, 'base evidence')
      const ownerRevision = safeRevision(revision)
      const result = await writeOwnerModeCheckpoint({
        ...common,
        domain,
        oldWriterBlocked: true,
        compatibilityMode: 'read-only',
        inFlight: 0,
        repository: {
          identity: domainIdentity(domain),
          type: 'host-managed',
          baseRevision: ownerRevision,
          revision: ownerRevision,
          baseEvidence,
          revisionEvidence,
        },
      })
      return {
        ok: true,
        authorityChanged: true,
        status: 'authoritative',
        checkpointStatus: result.status,
      }
    },
    async rollback({ domain: requestedDomain, revision, checksum }) {
      if (requestedDomain !== domain) return { ok: false, reasonCode: 'OWNER_CUTOVER_DOMAIN_MISMATCH' }
      const result = await revokeOwnerModeCheckpoint({
        ...common,
        domain,
        expectedRevision: revision,
        expectedRevisionEvidence: checksum,
      })
      return { ok: true, status: result.status, authorityChanged: false }
    },
    async smoke(context) {
      if (!smokeCheck) return { ok: false, reasonCode: 'OWNER_CUTOVER_SMOKE_UNAVAILABLE' }
      const result = await smokeCheck({ ...context, domain })
      return result === true ? { ok: true } : result
    },
  }]))
}

export const WINDOWS_OWNER_CUTOVER_DOMAINS = DOMAINS
