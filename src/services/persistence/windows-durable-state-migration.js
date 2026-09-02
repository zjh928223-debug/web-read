import {
  APPLICATION_BACKUP_REQUIRED_DOMAINS,
  createApplicationBackupService,
  verifyBackupArtifact,
} from './application-backup.js'

export const WINDOWS_DURABLE_STATE_MIGRATION_FORMAT = 'read-web.windows-durable-state-migration'
export const WINDOWS_DURABLE_STATE_MIGRATION_SCHEMA_VERSION = 1
export const WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS = Object.freeze([
  ...APPLICATION_BACKUP_REQUIRED_DOMAINS,
])

const DOMAIN_SET = new Set(WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS)
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAFE_SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u
const SAFE_REVISION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const MEDIA_DATA_URI = /^data:(?:audio|video|application\/octet-stream)\b/i
const FORBIDDEN_STATE_KEY = /(?:^|[_-])(token|cookie|password|secret|authorization|(?:absolute|local|media)[_-]?path|blob|arraybuffer|typed[_-]?array|bytes|base64)(?:$|[_-])/iu
const FORBIDDEN_NORMALIZED_STATE_KEY = /^(?:apikey|accesstoken|authorization|cookie|cookies|cookiepath|cookiespath|password|passwd|secret|credential|privatekey|proxyauth|sessiontoken|token|auth|jwt|bearer|signature|sig)$/iu
const FORBIDDEN_NORMALIZED_MEDIA_KEY = /^(?:blob|arraybuffer|typedarray|bytes|base64|binary|datauri|inlinedata|inlinemedia|mediadata|mediabytes|mediablob|audiodata|audioblob|videodata|videoblob)$/iu
const EMBEDDED_ABSOLUTE_MACHINE_PATH = /(?:^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/][^\s"'<>|]+|\\\\[^\\\s]+\\[^\s"'<>|]+|\/(?:Users|home|private|var|tmp|opt|mnt|Volumes|root)(?:\/[^\s"'<>]+)+)/iu
const VOCABULARY_SETTLEMENT_PREFIX = 'vocabulary-article-srs-settlement-progress:'

function migrationError(code, message = 'Windows durable-state migration request is invalid', details = {}) {
  const error = new Error(message)
  error.name = 'WindowsDurableStateMigrationError'
  error.code = code
  error.details = details
  return error
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  if (value === undefined) return undefined
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))
}

function canonicalize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw migrationError('migration-json-invalid')
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value !== 'object') throw migrationError('migration-json-invalid')
  if (seen.has(value)) throw migrationError('migration-json-invalid')
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

async function digestCanonical(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') {
    throw migrationError('migration-crypto-unavailable')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(value)))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function safeIdentity(value, field) {
  if (typeof value !== 'string' || !SAFE_IDENTITY.test(value)) throw migrationError('migration-invalid-request', `${field} is invalid`)
  return value
}

function domainKey(value) {
  if (typeof value !== 'string' || !DOMAIN_SET.has(value)) throw migrationError('migration-unknown-domain')
  return value
}

function safeRevision(value, field = 'revision') {
  if (Number.isInteger(value) && value >= 0) return value
  if (typeof value === 'string' && SAFE_REVISION_TOKEN.test(value)) return value
  throw migrationError('migration-revision-invalid', `${field} is invalid`)
}

function isRevisionValue(value) {
  return (Number.isInteger(value) && value >= 0)
    || (typeof value === 'string' && SAFE_REVISION_TOKEN.test(value))
}

function normalizeSourceIds(value) {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.length === 0) throw migrationError('migration-source-selection-invalid')
  const seen = new Set()
  const sourceIds = []
  for (const sourceId of value) {
    if (typeof sourceId !== 'string' || !SAFE_SOURCE_ID.test(sourceId)
      || sourceId.includes('..') || /^[\\/]{2}/u.test(sourceId)
      || /^[\\/]/u.test(sourceId) || /^[A-Za-z]:[\\/]/u.test(sourceId)) {
      throw migrationError('migration-source-selection-invalid')
    }
    if (!seen.has(sourceId)) {
      seen.add(sourceId)
      sourceIds.push(sourceId)
    }
  }
  return sourceIds
}

function sourceSelectionRequest(sourceIds) {
  return sourceIds === null ? {} : { sourceIds: [...sourceIds] }
}

function assertSafeJson(value, seen = new WeakSet(), keyHint = '', options = {}) {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && MEDIA_DATA_URI.test(value.trim())) throw migrationError('migration-media-payload-rejected')
    if (typeof value === 'string' && EMBEDDED_ABSOLUTE_MACHINE_PATH.test(value)) throw migrationError('migration-machine-path-rejected')
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw migrationError('migration-json-invalid')
    return
  }
  if (typeof value !== 'object') throw migrationError('migration-json-invalid')
  if (typeof Blob !== 'undefined' && value instanceof Blob) throw migrationError('migration-media-payload-rejected')
  if (typeof File !== 'undefined' && value instanceof File) throw migrationError('migration-media-payload-rejected')
  if (typeof ArrayBuffer !== 'undefined' && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) {
    throw migrationError('migration-media-payload-rejected')
  }
  if (seen.has(value)) throw migrationError('migration-json-invalid')
  seen.add(value)
  const allowSettlementToken = options.allowVocabularySettlementAttemptToken === true
    || ((options.domain === 'vocabulary-srs' || value.domain === 'vocabulary-srs')
      && ((typeof value.recordKey === 'string' && value.recordKey.startsWith(VOCABULARY_SETTLEMENT_PREFIX))
        || (typeof value.id === 'string' && value.id.startsWith(VOCABULARY_SETTLEMENT_PREFIX))))
  if (Array.isArray(value)) {
    value.forEach((entry) => assertSafeJson(entry, seen, keyHint, {
      ...options,
      allowVocabularySettlementAttemptToken: allowSettlementToken,
    }))
  } else {
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.replace(/[_-]/gu, '').toLowerCase()
      if (FORBIDDEN_NORMALIZED_MEDIA_KEY.test(normalizedKey) && !isSafeByteCountMetadata(key, child)) {
        throw migrationError('migration-media-payload-rejected')
      }
      if ((FORBIDDEN_STATE_KEY.test(key) || FORBIDDEN_NORMALIZED_STATE_KEY.test(normalizedKey))
        && !(allowSettlementToken && key === 'attempt_token')
        && !isSafeByteCountMetadata(key, child)) {
        throw migrationError('migration-sensitive-value-rejected')
      }
      assertSafeJson(child, seen, key, {
        ...options,
        domain: options.domain || value.domain,
        allowVocabularySettlementAttemptToken: allowSettlementToken,
      })
    }
  }
  seen.delete(value)
}

function isSafeByteCountMetadata(key, value) {
  // Workflow integrity envelopes use numeric `bytes`/`sizeBytes` fields as
  // file-size metadata. Permit only a non-negative safe integer; byte arrays,
  // encoded strings, and other media-shaped values remain fail-closed.
  const normalizedKey = String(key).replace(/[_-]/gu, '').toLowerCase()
  return (normalizedKey === 'bytes' || normalizedKey === 'sizebytes')
    && Number.isSafeInteger(value)
    && value >= 0
}

function emptyState(profileId) {
  return {
    schemaVersion: WINDOWS_DURABLE_STATE_MIGRATION_SCHEMA_VERSION,
    profileId: profileId || null,
    domains: Object.fromEntries(WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.map((domain) => [domain, {
      status: 'pending',
    }])),
  }
}

function validateState(value, profileId) {
  if (!isPlainObject(value)
    || value.schemaVersion !== WINDOWS_DURABLE_STATE_MIGRATION_SCHEMA_VERSION
    || (value.profileId !== null && value.profileId !== profileId)
    || !isPlainObject(value.domains)
    || Object.keys(value.domains).some((key) => !DOMAIN_SET.has(key))) {
    throw migrationError('migration-state-corrupt')
  }
  for (const domain of WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS) {
    if (!isPlainObject(value.domains[domain])) throw migrationError('migration-state-corrupt')
  }
  return clone(value)
}

export function createMemoryMigrationStateStore(initial = null) {
  let value = initial === null ? null : clone(initial)
  return {
    async read() { return value === null ? null : clone(value) },
    async write(next) { value = clone(next) },
  }
}

function safeFailure(domain, stage, reasonCode, details = {}) {
  const result = {
    ok: false,
    domain,
    stage,
    status: reasonCode === 'migration-conflict' ? 'conflict' : 'not-ready',
    outcome: reasonCode === 'migration-conflict' ? 'conflict' : 'not-ready',
    reasonCode,
  }
  if (isRevisionValue(details.currentRevision)) result.currentRevision = details.currentRevision
  if (typeof details.artifactChecksum === 'string') result.artifactChecksum = details.artifactChecksum
  return result
}

function safeResult(value, fallbackRevision = null) {
  const source = isPlainObject(value) ? value : {}
  const status = source.commitStatus || source.outcome || source.status || null
  const revision = isRevisionValue(source.revision) ? source.revision : fallbackRevision
  const receipt = isPlainObject(source.receipt) ? source.receipt : null
  return {
    ...(status ? { status } : {}),
    ...(isRevisionValue(revision) ? { revision } : {}),
    ...(typeof source.receiptId === 'string' ? { receiptId: source.receiptId } : {}),
    ...(typeof receipt?.receiptId === 'string' ? { receiptId: receipt.receiptId } : {}),
    ...(typeof source.idempotent === 'boolean' ? { idempotent: source.idempotent } : {}),
  }
}

function resultIsCommitted(value, method) {
  const source = isPlainObject(value) ? value : {}
  const status = source.commitStatus || source.outcome || source.status
  return status === 'committed'
    || (method === 'restoreRecords' && isRevisionValue(source.revision) && source.ok !== false)
    || (source.ok === true && isRevisionValue(source.revision))
}

function resultIsConflict(value) {
  const source = isPlainObject(value) ? value : {}
  return source.commitStatus === 'conflict' || source.outcome === 'conflict' || source.status === 'conflict'
}

function recordArray(value) {
  if (Array.isArray(value)) return clone(value)
  if (!isPlainObject(value)) return null
  return Object.entries(value).map(([id, record]) => ({
    ...(isPlainObject(record) ? record : {}),
    id: isPlainObject(record) && record.id !== undefined ? record.id : id,
  }))
}

function normalizedHostSnapshot(value, domain) {
  const outer = isPlainObject(value) && isPlainObject(value.domain) && value.records === undefined
    ? value.domain
    : value
  const payload = isPlainObject(outer?.payload) && outer.records === undefined ? outer.payload : outer
  const records = recordArray(payload?.records)
  if (!isPlainObject(payload) || !records || !isRevisionValue(payload.revision)) {
    throw migrationError('migration-host-snapshot-invalid', `Host snapshot for ${domain} is invalid`)
  }
  const normalized = {
    schemaVersion: payload.schemaVersion ?? 1,
    adapterVersion: payload.adapterVersion ?? 1,
    revision: payload.revision,
    records,
    references: Array.isArray(payload.references) ? clone(payload.references) : [],
    mediaReferences: Array.isArray(payload.mediaReferences) ? clone(payload.mediaReferences) : [],
  }
  assertSafeJson(normalized, new WeakSet(), '', { domain })
  return normalized
}

function sourceDomainRevision(domain) {
  return domain?.revision === undefined || domain?.revision === null
    ? 0
    : safeRevision(domain.revision)
}

function normalizeWorkflowConfigPayload(payload) {
  if (!isPlainObject(payload) || typeof payload.proxyUrl !== 'string') return payload
  // The backup sanitizer serializes an origin URL with its conventional
  // trailing slash, while the Python workflow Host stores the same origin
  // without it.  Only normalize a bare origin; a path, query, or fragment is
  // meaningful proxy configuration and must remain an exact comparison.
  const proxyUrl = payload.proxyUrl.replace(/^(https?|wss?):\/\/([^/?#]+)\/$/iu, '$1://$2')
  return proxyUrl === payload.proxyUrl ? payload : { ...payload, proxyUrl }
}

function normalizeWorkflowDerivedSessionIdentity(value) {
  if (!isPlainObject(value)) return value
  const result = { ...value }
  for (const field of ['contentId', 'revision', 'integrity']) delete result[field]
  return result
}

function domainEquivalent(left, right, domain = null) {
  try {
    // Application backup adapters expose the durable record fields, while
    // the backup artifact adds derived per-record checksums.  Compare the
    // shared record content so a real adapter is not treated as divergent
    // merely because it does not echo that derived field on collect().
    const comparable = (value) => {
      if (!isPlainObject(value) || !Array.isArray(value.records)) return value
      const normalized = {
        ...value,
        records: value.records
          .filter((record) => {
            if (domain !== 'reader-session') return true
            const id = String(record?.id || '')
            // These rows remain in the retained application-backup artifact,
            // but they are compatibility evidence rather than Host canonical
            // reader-session state.
            return !id.startsWith('readerSessionQuarantine:')
              && !id.startsWith('read-web.reader-save-outbox.')
          })
          .filter((record) => {
            if (domain !== 'marks-activity') return true
            // The Host keeps its commit journal privately and exposes only
            // its revision in the query contract; legacy journal rows are
            // receipt evidence, not canonical import records.
            return !String(record?.id || '').startsWith('reader-marks-commit-journal.json:')
          })
          .map((record) => {
          if (!isPlainObject(record)) return record
          const { checksum: _checksum, ...recordContent } = record
          const content = { ...recordContent }
          if (domain === 'workflow' || domain === 'passage-preview' || domain === 'annotation') {
            // The source backup revision is the legacy document/file revision;
            // the Host owns a separate outer CAS revision for its snapshot.
            delete content.revision
          }
          if (domain === 'reader-session') {
            // Browser row revisions are opaque session evidence; the Host
            // assigns a numeric owner revision.  Normalize the marks and
            // readerSession shapes to the five-row Host candidate contract.
            delete content.revision
            const sessionContentId = value.records.find((item) => (
              item?.id === 'audioMeta' || item?.id === 'readerSession'
            ))?.contentId || null
            if (content.id === 'marks') {
              const marks = Array.isArray(content.payload) ? content.payload : content.payload?.marks
              content.contentId = content.contentId || sessionContentId
              content.payload = {
                schemaVersion: 1,
                contentId: content.contentId,
                marks: Array.isArray(marks) ? marks : [],
              }
            } else if (content.id === 'readerSession' && isPlainObject(content.payload)) {
              content.payload = {
                schemaVersion: content.payload.schemaVersion,
                contentId: content.payload.contentId || content.contentId || sessionContentId,
              }
            }
          }
          if (/^(?:reader-marks|reader-activity|reader-marks-commit-journal)\.json:/u.test(String(content.id || ''))
            && isPlainObject(content.payload)
            && typeof content.payload.schemaVersion === 'string'
            && (content.schemaVersion === 1 || content.schemaVersion === content.payload.schemaVersion)) {
            // The Python marks adapter uses the generic application record
            // schema (1), while the nested legacy envelope keeps its
            // reader-marks.v1/reader-activity.v1 marker.
            // Its checksum and timestamps are regenerated on each owner
            // write, so compare the durable marks payload only.
            const legacyEnvelope = clone(content.payload)
            const durablePayload = isPlainObject(legacyEnvelope.payload)
              ? clone(legacyEnvelope.payload)
              : (String(content.id || '').startsWith('reader-marks.json:')
                ? { jobId: legacyEnvelope.jobId, marks: Array.isArray(legacyEnvelope.marks) ? legacyEnvelope.marks : [] }
                : { ...legacyEnvelope })
            delete durablePayload.updatedAt
            delete durablePayload.checksum
            delete durablePayload.revision
            if (String(content.id || '').startsWith('reader-activity.json:')) {
              // Legacy activity keeps operation-id receipts in the JSON row;
              // the Host keeps those receipts in its private commit journal.
              delete durablePayload._activityOperationIds
            }
            content.payload = {
              schemaVersion: legacyEnvelope.schemaVersion,
              domain: legacyEnvelope.domain,
              jobId: legacyEnvelope.jobId || durablePayload.jobId,
              payload: durablePayload,
            }
            delete content.revision
            delete content.schemaVersion
          }
          if (domain === 'workflow') {
            if (content.id === 'config') content.payload = normalizeWorkflowConfigPayload(content.payload)
            if (isPlainObject(content.payload?.manifest)) {
              content.payload = {
                ...content.payload,
                manifest: normalizeWorkflowDerivedSessionIdentity(content.payload.manifest),
              }
            }
            if (String(content.id || '').startsWith('output:')
              && String(content.id || '').replace(/\\/gu, '/').endsWith('/manifest.json')
              && isPlainObject(content.payload)) {
              content.payload = normalizeWorkflowDerivedSessionIdentity(content.payload)
            }
            for (const field of ['references', 'mediaReferences']) {
              if (Array.isArray(content[field])) {
                content[field] = content[field].slice().sort((left, right) => (
                  canonicalize(left).localeCompare(canonicalize(right))
                ))
              }
            }
          }
          return content
        })
          .sort((left, right) => String(left?.id || '').localeCompare(String(right?.id || ''))),
      }
      if (domain === 'marks-activity') {
        // Source file revisions and Host owner CAS revisions are different
        // coordinate systems.  References are aggregated once per legacy
        // record and may contain duplicates in the source artifact.
        delete normalized.revision
        const references = Array.isArray(normalized.references) ? normalized.references : []
        normalized.references = references.filter((reference, index) => (
          references.findIndex((candidate) => canonicalize(candidate) === canonicalize(reference)) === index
        ))
      }
      if (domain === 'workflow') {
        // Workflow references are derived from the records and may be
        // repeated once per output file.  Media references are derived
        // metadata: the staged source excludes media bytes, while the Host
        // may rebind an identity reference from the real output root.  Media
        // integrity is checked separately through the authorized media range
        // smoke check, so it must not turn equivalent durable JSON into a
        // false migration mismatch.
        const references = Array.isArray(normalized.references) ? normalized.references : []
        normalized.references = references
          .filter((reference, index) => (
            references.findIndex((candidate) => canonicalize(candidate) === canonicalize(reference)) === index
          ))
          .sort((left, right) => canonicalize(left).localeCompare(canonicalize(right)))
        normalized.mediaReferences = []
      }
      if (domain === 'passage-preview' || domain === 'annotation' || domain === 'vocabulary-srs') delete normalized.revision
      return normalized
    }
    const leftComparable = comparable(left)
    const rightComparable = comparable(right)
    const leftRevision = leftComparable?.revision
    const rightRevision = rightComparable?.revision
    if ((Number.isInteger(leftRevision) && typeof rightRevision === 'string')
      || (typeof leftRevision === 'string' && Number.isInteger(rightRevision))) {
      // A source backup can carry a numeric file revision while a Host owner
      // exposes an opaque composite CAS revision.  Compare the durable
      // records/references across that coordinate boundary, but preserve
      // exact revision checks wherever both sides use the same coordinate.
      delete leftComparable.revision
      delete rightComparable.revision
    }
    return canonicalize(leftComparable) === canonicalize(rightComparable)
  } catch {
    return false
  }
}

function domainEquivalentIgnoringRevision(left, right, domain = null) {
  const leftCopy = isPlainObject(left) ? clone(left) : left
  const rightCopy = isPlainObject(right) ? clone(right) : right
  if (isPlainObject(leftCopy)) delete leftCopy.revision
  if (isPlainObject(rightCopy)) delete rightCopy.revision
  return domainEquivalent(leftCopy, rightCopy, domain)
}

function maxRevision(records) {
  const revisions = records
    .map((record) => record?.revision)
    .filter((revision) => revision !== undefined && revision !== null)
    .map((revision) => safeRevision(revision))
  if (revisions.length === 0) return 0
  if (revisions.every((revision) => Number.isInteger(revision))) return Math.max(...revisions)
  if (revisions.every((revision) => typeof revision === 'string') && revisions.every((revision) => revision === revisions[0])) {
    return revisions[0]
  }
  // Legacy inputs may mix numeric row versions with one opaque session row.
  // Preserve the established numeric aggregate in that case; an all-opaque
  // domain remains a string revision and is never coerced to a number.
  if (revisions.some((revision) => Number.isInteger(revision))) {
    return Math.max(...revisions.filter((revision) => Number.isInteger(revision)))
  }
  throw migrationError('migration-revision-invalid')
}

function inputAdapters(importInput) {
  const grouped = Object.fromEntries(WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.map((domain) => [domain, []]))
  for (const item of importInput.records) {
    const metadata = item && typeof item === 'object' ? item : null
    const domain = metadata?.domain
    if (!DOMAIN_SET.has(domain) || typeof metadata.recordKey !== 'string' || !Object.prototype.hasOwnProperty.call(metadata, 'payload')) {
      throw migrationError('migration-import-input-invalid')
    }
    grouped[domain].push({
      id: metadata.recordKey,
      schemaVersion: metadata.schemaVersion ?? 1,
      revision: metadata.revision === undefined || metadata.revision === null
        ? null
        : safeRevision(metadata.revision, 'record revision'),
      contentId: metadata.contentId ?? null,
      payload: metadata.payload,
      references: Array.isArray(metadata.references) ? metadata.references : [],
      mediaReferences: Array.isArray(metadata.mediaReferences) ? metadata.mediaReferences : [],
    })
  }
  return Object.fromEntries(WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.map((domain) => {
    const records = grouped[domain]
    return [domain, {
      key: domain,
      schemaVersion: 1,
      adapterVersion: 1,
      supportedSchemaVersions: [1],
      async collect() {
        return {
          schemaVersion: 1,
          adapterVersion: 1,
          revision: maxRevision(records),
          records: clone(records),
          references: records.flatMap((record) => Array.isArray(record.references) ? clone(record.references) : []),
          mediaReferences: records.flatMap((record) => Array.isArray(record.mediaReferences) ? clone(record.mediaReferences) : []),
        }
      },
    }]
  }))
}

async function buildArtifact(importInput, options) {
  if (!isPlainObject(importInput) || importInput.schemaVersion !== 1
    || importInput.mode !== 'legacy-import-input' || !Array.isArray(importInput.records)) {
    throw migrationError('migration-import-input-invalid')
  }
  if (options.profileId && importInput.profileId !== null && importInput.profileId !== options.profileId) {
    throw migrationError('migration-profile-mismatch')
  }
  assertSafeJson(importInput.records)
  const service = createApplicationBackupService({
    requiredDomains: WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS,
    adapters: inputAdapters(importInput),
    release: options.release || {
      applicationVersion: 'isolated-owner-migration',
      backendVersion: 'isolated-owner-migration',
      releaseId: 'isolated-owner-migration',
    },
    ...(typeof options.now === 'function' ? { now: options.now } : {}),
    ...(isPlainObject(options.backupLimits) ? options.backupLimits : {}),
  })
  const artifact = await service.createBackup({
    ...(typeof options.now === 'function' ? { now: options.now } : {}),
  })
  const verification = await verifyBackupArtifact(artifact, {
    requiredDomains: WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS,
    ...(isPlainObject(options.backupLimits) ? options.backupLimits : {}),
  })
  if (!verification.valid) throw migrationError('migration-backup-invalid')
  return {
    artifact,
    importIdentity: typeof importInput.importIdentity === 'string'
      ? importInput.importIdentity
      : await digestCanonical(importInput.records),
  }
}

async function capacityCheck(adapter, bytes, options) {
  const requiredBytes = Math.max(0, bytes * 2)
  if (Number.isFinite(options.capacityBytes)) {
    return { ok: options.capacityBytes >= requiredBytes, requiredBytes, availableBytes: options.capacityBytes }
  }
  const estimate = typeof options.estimateCapacity === 'function'
    ? options.estimateCapacity
    : (typeof adapter?.estimateCapacity === 'function' ? adapter.estimateCapacity.bind(adapter) : null)
  if (!estimate) return { ok: true, requiredBytes, availableBytes: null }
  try {
    const result = await estimate({ requiredBytes })
    const availableBytes = Number(result?.availableBytes ?? result?.remainingBytes)
    return {
      ok: result?.ok !== false && Number.isFinite(availableBytes) && availableBytes >= requiredBytes,
      requiredBytes,
      availableBytes: Number.isFinite(availableBytes) ? availableBytes : null,
    }
  } catch {
    return { ok: false, requiredBytes, availableBytes: null }
  }
}

function bytesOf(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function compareTarget(sourceDomain, target, expectedRevision, allowExistingTarget, domain = null) {
  const sourceRevision = sourceDomainRevision(sourceDomain)
  if (expectedRevision !== undefined && target.revision !== expectedRevision) {
    return { ok: false, reasonCode: 'migration-conflict', currentRevision: target.revision }
  }
  const revisionRelation = compareRevisionValues(target.revision, sourceRevision)
  if (revisionRelation !== null && revisionRelation > 0) {
    return { ok: false, reasonCode: 'migration-conflict', currentRevision: target.revision }
  }
  if (target.records.length && !domainEquivalent(target, sourceDomain, domain) && allowExistingTarget !== true) {
    return { ok: false, reasonCode: 'migration-conflict', currentRevision: target.revision }
  }
  if (revisionRelation === 0 && !domainEquivalent(target, sourceDomain, domain)
    && (target.records.length || sourceDomain.records.length)) {
    return { ok: false, reasonCode: 'migration-conflict', currentRevision: target.revision }
  }
  return { ok: true, sourceRevision, targetRevision: target.revision }
}

function compareRevisionValues(left, right) {
  if (left === right) return 0
  if (Number.isInteger(left) && Number.isInteger(right)) return left > right ? 1 : -1
  return null
}

function domainSummaries(artifact) {
  return WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.map((domain) => {
    const value = artifact.domains[domain]
    return {
      domain,
      schemaVersion: value.schemaVersion,
      recordCount: value.records.length,
      checksum: artifact.manifest.domainChecksums[domain],
      revision: value.revision,
      mediaReferences: clone(artifact.manifest.mediaReferences?.[domain] || []),
    }
  })
}

function validateSourceCapture(value, domain) {
  if (value === undefined || value === null) return null
  if (!isPlainObject(value)
    || value.kind !== 'post-freeze-live-source-capture'
    || value.domain !== domain
    || typeof value.capturedAt !== 'string'
    || !isPlainObject(value.fingerprints)) {
    throw migrationError('migration-source-capture-invalid')
  }
  for (const field of ['browserPhysical', 'browserLogical', 'workflow']) {
    if (typeof value.fingerprints[field] !== 'string'
      || !/^(?:sha256:)?[a-f0-9]{64}$/iu.test(value.fingerprints[field])) {
      throw migrationError('migration-source-capture-invalid')
    }
  }
  assertSafeJson(value)
  return clone(value)
}

function validateSourceHostFreezeEvidence(value) {
  if (value === undefined || value === null) return null
  if (!isPlainObject(value)
    || value.kind !== 'host-promotion-freeze-evidence.v1'
    || value.frozen !== true
    || value.drained !== true
    || typeof value.capturedAt !== 'string'
    || !SAFE_IDENTITY.test(String(value.sourceProfileId || ''))
    || !SAFE_IDENTITY.test(String(value.sourceInstanceId || ''))
    || !SAFE_SOURCE_ID.test(String(value.challenge || ''))
    || !Array.isArray(value.domains)
    || value.domains.length !== WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.length) {
    throw migrationError('migration-source-host-freeze-invalid')
  }
  const expected = WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS
  for (const [index, entry] of value.domains.entries()) {
    if (!isPlainObject(entry)
      || entry.domain !== expected[index]
      || !isRevisionValue(entry.revision)
      || typeof entry.checksum !== 'string'
      || !/^sha256:[a-f0-9]{64}$/u.test(entry.checksum)) {
      throw migrationError('migration-source-host-freeze-invalid')
    }
  }
  assertSafeJson(value)
  return clone(value)
}

async function createFinalManifest(domain, artifact, importIdentity, target, sourceIds, sourceCapture = null, sourceHostFreezeEvidence = null) {
  const core = {
    format: WINDOWS_DURABLE_STATE_MIGRATION_FORMAT,
    schemaVersion: WINDOWS_DURABLE_STATE_MIGRATION_SCHEMA_VERSION,
    domain,
    stage: 'final-backup',
    frozen: true,
    final: true,
    sourceImportIdentity: importIdentity,
    sourceIds: sourceIds === null ? null : [...sourceIds],
    artifactChecksum: artifact.artifactChecksum,
    domains: domainSummaries(artifact),
    rollbackTarget: {
      kind: 'host-canonical-before-import',
      domain,
      revision: target.revision,
      checksum: await digestCanonical(target),
    },
  }
  const validatedSourceCapture = validateSourceCapture(sourceCapture, domain)
  if (validatedSourceCapture) core.sourceCapture = validatedSourceCapture
  const validatedSourceHostFreeze = validateSourceHostFreezeEvidence(sourceHostFreezeEvidence)
  if (validatedSourceHostFreeze) core.sourceHostFreezeEvidence = validatedSourceHostFreeze
  return {
    ...core,
    manifestChecksum: await digestCanonical(core),
    artifact,
  }
}

async function validateFinalBackup(value, domain, backupLimits = {}) {
  if (!isPlainObject(value)
    || value.format !== WINDOWS_DURABLE_STATE_MIGRATION_FORMAT
    || value.schemaVersion !== WINDOWS_DURABLE_STATE_MIGRATION_SCHEMA_VERSION
    || value.domain !== domain
    || value.stage !== 'final-backup'
    || value.frozen !== true
    || value.final !== true
    || !isPlainObject(value.artifact)
    || value.artifactChecksum !== value.artifact.artifactChecksum
    || typeof value.manifestChecksum !== 'string') {
    throw migrationError('migration-backup-invalid')
  }
  const core = { ...value }
  delete core.manifestChecksum
  delete core.artifact
  if (await digestCanonical(core) !== value.manifestChecksum) throw migrationError('migration-backup-invalid')
  const verification = await verifyBackupArtifact(value.artifact, {
    requiredDomains: WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS,
    ...(isPlainObject(backupLimits) ? backupLimits : {}),
  })
  if (!verification.valid) throw migrationError('migration-backup-invalid')
  if (!Array.isArray(value.domains) || value.domains.length !== WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.length
    || value.domains.some((entry, index) => entry?.domain !== WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS[index]
      || entry.checksum !== value.artifact.manifest.domainChecksums[entry.domain])) {
    throw migrationError('migration-backup-invalid')
  }
  if (value.sourceCapture !== undefined) validateSourceCapture(value.sourceCapture, domain)
  if (value.sourceHostFreezeEvidence !== undefined) validateSourceHostFreezeEvidence(value.sourceHostFreezeEvidence)
  return value
}

async function resolveRestoreArtifact(value, domain, backupLimits = {}) {
  if (isPlainObject(value) && value.format === WINDOWS_DURABLE_STATE_MIGRATION_FORMAT) {
    return (await validateFinalBackup(value, domain, backupLimits)).artifact
  }
  return value?.artifact ? value.artifact : value
}

function mutationMethod(adapter, rollback = false) {
  if (rollback && typeof adapter?.rollback === 'function') return 'rollback'
  if (typeof adapter?.importRecords === 'function') return 'importRecords'
  if (typeof adapter?.commit === 'function') return 'commit'
  if (typeof adapter?.restoreRecords === 'function') return 'restoreRecords'
  return null
}

async function invokeMutation(adapter, method, snapshot, context) {
  if (method === 'restoreRecords') return adapter.restoreRecords(snapshot, context)
  if (method === 'rollback') return adapter.rollback({ ...context, snapshot })
  return adapter[method]({ ...context, snapshot, records: snapshot.records, domainSnapshot: snapshot })
}

export function createWindowsDurableStateMigration(options = {}) {
  const profileId = options.profileId === undefined || options.profileId === null
    ? null
    : safeIdentity(options.profileId, 'profileId')
  const legacyBridge = options.legacyBridge
  if (!legacyBridge || typeof legacyBridge.inventory !== 'function' || typeof legacyBridge.prepareImport !== 'function') {
    throw migrationError('migration-legacy-bridge-unavailable')
  }
  const hostAdapters = options.hostAdapters || options.repositories
  if (!isPlainObject(hostAdapters)) throw migrationError('migration-host-adapters-unavailable')
  for (const domain of WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS) {
    if (!hostAdapters[domain] || typeof hostAdapters[domain].collect !== 'function') {
      throw migrationError('migration-host-adapter-missing')
    }
  }
  const writerControls = isPlainObject(options.writerControls) ? options.writerControls : {}
  // B remains an isolated, pre-cutover seam by default.  C2 may provide one
  // small per-domain control pair to make the already verified snapshot
  // authoritative; no cross-domain coordinator is needed here.
  const cutoverControls = isPlainObject(options.cutoverControls) ? options.cutoverControls : {}
  const stateStore = options.stateStore || createMemoryMigrationStateStore()
  if (typeof stateStore.read !== 'function' || typeof stateStore.write !== 'function') {
    throw migrationError('migration-state-store-invalid')
  }
  let localState = null

  async function readState() {
    const stored = await stateStore.read()
    if (stored === null || stored === undefined) {
      if (localState === null) localState = emptyState(profileId)
      return clone(localState)
    }
    const validated = validateState(stored, profileId)
    localState = validated
    return validated
  }

  async function writeState(state) {
    const validated = validateState(state, profileId)
    await stateStore.write(validated)
    localState = validated
    return clone(validated)
  }

  function adapterFor(domain) { return hostAdapters[domain] }

  async function collectHost(domain) {
    const result = await adapterFor(domain).collect({ domain })
    return normalizedHostSnapshot(result, domain)
  }

  async function compensateHostSnapshot(domain, original, observed, reason) {
    if (domainEquivalent(observed, original, domain)) return { ok: true, snapshot: observed }
    const adapter = adapterFor(domain)
    const method = mutationMethod(adapter, true)
    if (!method) return { ok: false, reasonCode: 'migration-compensation-unavailable' }
    let result
    try {
      result = await invokeMutation(adapter, method, original, {
        domain,
        expectedRevision: observed.revision,
        idempotencyKey: `migration-repair-${domain}-${String(observed.revision).slice(0, 24)}-${String(original.revision).slice(0, 24)}`,
        reason,
        migration: true,
      })
    } catch {
      return { ok: false, reasonCode: 'migration-compensation-failed', currentRevision: observed.revision }
    }
    if (!resultIsCommitted(result, method)) {
      return { ok: false, reasonCode: 'migration-compensation-failed', currentRevision: result?.currentRevision ?? observed.revision }
    }
    try {
      const restored = await collectHost(domain)
      return domainEquivalent(restored, original, domain)
        ? { ok: true, snapshot: restored }
        : { ok: false, reasonCode: 'migration-compensation-failed', currentRevision: restored.revision }
    } catch {
      return { ok: false, reasonCode: 'migration-compensation-failed', currentRevision: observed.revision }
    }
  }

  async function inventory() {
    try {
      const value = await legacyBridge.inventory()
      if (!isPlainObject(value)) throw migrationError('migration-inventory-invalid')
      const records = Array.isArray(value.records) ? value.records : []
      const domains = await Promise.all(WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.map(async (domain) => {
        const selected = records.filter((record) => record?.domain === domain)
        return {
          domain,
          recordCount: selected.length,
          revision: maxRevision(selected),
          checksum: await digestCanonical(selected),
        }
      }))
      return {
        schemaVersion: WINDOWS_DURABLE_STATE_MIGRATION_SCHEMA_VERSION,
        mode: 'read-only-inventory',
        profileId,
        status: value.status === 'ready' ? 'ready' : 'blocked',
        reasonCode: value.reasonCode || null,
        sourceChecksum: value.checksum || null,
        frozenIndexedDbSchema: clone(value.frozenIndexedDbSchema || null),
        sources: Array.isArray(value.sources) ? value.sources.map((source) => ({
          sourceKind: source.sourceKind,
          sourceId: source.sourceId,
          status: source.status,
          recordCount: source.recordCount,
          checksum: source.checksum,
        })) : [],
        domains,
      }
    } catch (error) {
      return {
        schemaVersion: WINDOWS_DURABLE_STATE_MIGRATION_SCHEMA_VERSION,
        mode: 'read-only-inventory',
        profileId,
        status: 'blocked',
        reasonCode: error?.code || 'migration-inventory-failed',
        domains: WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.map((domain) => ({ domain, recordCount: 0, revision: 0, checksum: null })),
      }
    }
  }

  async function dryRun(domainInput, dryRunOptions = {}) {
    const domain = domainKey(domainInput)
    let plan
    try {
      const sourceIds = normalizeSourceIds(dryRunOptions.sourceIds)
      plan = await legacyBridge.prepareImport(sourceSelectionRequest(sourceIds))
      if (!isPlainObject(plan) || plan.status !== 'ready' || !plan.importInput) {
        return safeFailure(domain, 'dry-run', plan?.reasonCode || 'migration-import-blocked')
      }
      const built = await buildArtifact(plan.importInput, options)
      const sourceDomain = built.artifact.domains[domain]
      const target = await collectHost(domain)
      const existingImport = stateStore && typeof stateStore.read === 'function'
        ? await readState()
        : null
      const existingEntry = existingImport?.domains?.[domain]
      const expectedRevision = dryRunOptions.expectedRevision === undefined
        ? target.revision
        : safeRevision(dryRunOptions.expectedRevision, 'expectedRevision')
      const repeatableImport = existingEntry?.import?.status === 'committed'
        && existingEntry?.preflight?.sourceImportIdentity === built.importIdentity
        && domainEquivalentIgnoringRevision(target, sourceDomain, domain)
      const targetDecision = repeatableImport
        ? { ok: true, sourceRevision: sourceDomainRevision(sourceDomain), targetRevision: target.revision, idempotent: true }
        : compareTarget(sourceDomain, target, expectedRevision, dryRunOptions.allowExistingTarget, domain)
      const capacity = await capacityCheck(adapterFor(domain), bytesOf(built.artifact), options)
      if (!targetDecision.ok) return safeFailure(domain, 'dry-run', targetDecision.reasonCode, targetDecision)
      if (!capacity.ok) return safeFailure(domain, 'dry-run', 'migration-capacity-insufficient')
      const state = existingImport || await readState()
      const entry = state.domains[domain]
      if (!repeatableImport) {
        entry.status = 'preflight-ready'
        entry.preflight = {
          sourceImportIdentity: built.importIdentity,
          artifactChecksum: built.artifact.artifactChecksum,
          sourceRevision: sourceDomain.revision,
          sourceChecksum: built.artifact.manifest.domainChecksums[domain],
          targetRevision: target.revision,
          targetChecksum: await digestCanonical(target),
          expectedRevision,
          capacity,
          sourceIds: sourceIds === null ? null : [...sourceIds],
        }
        await writeState(state)
      }
      return {
        ok: true,
        domain,
        mode: 'dry-run',
        write: false,
        status: 'ready',
        sourceImportIdentity: built.importIdentity,
        artifactChecksum: built.artifact.artifactChecksum,
        sourceRevision: sourceDomain.revision,
        targetRevision: target.revision,
        sourceChecksum: built.artifact.manifest.domainChecksums[domain],
        targetChecksum: await digestCanonical(target),
        capacity,
        sourceIds: sourceIds === null ? null : [...sourceIds],
        domains: domainSummaries(built.artifact),
        idempotent: repeatableImport,
      }
    } catch (error) {
      return safeFailure(domain, 'dry-run', error?.code || 'migration-dry-run-failed')
    }
  }

  async function freeze(domainInput, freezeOptions = {}) {
    const domain = domainKey(domainInput)
    const state = await readState()
    const entry = state.domains[domain]
    const reconcile = freezeOptions?.reconcile === true
    if (entry.frozen === true && !reconcile) {
      return { ok: true, domain, stage: 'freeze', status: 'frozen', idempotent: true }
    }
    if (entry.preflight?.sourceImportIdentity === undefined) return safeFailure(domain, 'freeze', 'migration-preflight-required')
    const writerControl = writerControls[domain] || adapterFor(domain)
    const cutoverControl = cutoverControls[domain]
    const controls = [writerControl, cutoverControl].filter((control, index, all) => (
      control && typeof control.freeze === 'function' && all.indexOf(control) === index
    ))
    if (!controls.length) return safeFailure(domain, 'freeze', 'migration-freeze-unavailable')
    try {
      for (const control of controls) {
        const result = await control.freeze({ domain, reason: 'one-time-host-owner-migration' })
        if (result === false || result?.ok === false) return safeFailure(domain, 'freeze', 'migration-freeze-failed')
      }
      entry.frozen = true
      entry.status = 'frozen'
      entry.freeze = { status: 'frozen', ...(reconcile ? { reconciled: true } : {}) }
      await writeState(state)
      return { ok: true, domain, stage: 'freeze', status: 'frozen', ...(reconcile ? { reconciled: true } : {}) }
    } catch (error) {
      return safeFailure(domain, 'freeze', error?.code || 'migration-freeze-failed')
    }
  }

  async function createFinalBackup(domainInput, finalBackupOptions = {}) {
    const domain = domainKey(domainInput)
    const state = await readState()
    const entry = state.domains[domain]
    if (entry.finalBackup) {
      try {
        const finalBackup = await validateFinalBackup(entry.finalBackup, domain, options.backupLimits)
        return { ok: true, domain, stage: 'final-backup', status: 'final-backup', finalBackup }
      } catch (error) {
        return safeFailure(domain, 'final-backup', error?.code || 'migration-backup-invalid')
      }
    }
    if (entry.frozen !== true) return safeFailure(domain, 'final-backup', 'migration-freeze-required')
    try {
      const sourceIds = normalizeSourceIds(entry.preflight?.sourceIds)
      const plan = await legacyBridge.prepareImport(sourceSelectionRequest(sourceIds))
      if (!isPlainObject(plan) || plan.status !== 'ready' || !plan.importInput) {
        return safeFailure(domain, 'final-backup', plan?.reasonCode || 'migration-import-blocked')
      }
      const built = await buildArtifact(plan.importInput, options)
      const sourceCapture = validateSourceCapture(finalBackupOptions.sourceCapture, domain)
      const sourceHostFreezeEvidence = validateSourceHostFreezeEvidence(finalBackupOptions.sourceHostFreezeEvidence)
      if (built.importIdentity !== entry.preflight?.sourceImportIdentity) {
        if (!sourceCapture) return safeFailure(domain, 'final-backup', 'migration-source-changed')
        const reboundDomain = built.artifact.domains[domain]
        entry.preflight.sourceImportIdentity = built.importIdentity
        entry.preflight.artifactChecksum = built.artifact.artifactChecksum
        entry.preflight.sourceRevision = reboundDomain.revision
        entry.preflight.sourceChecksum = built.artifact.manifest.domainChecksums[domain]
      }
      const target = await collectHost(domain)
      if (target.revision !== entry.preflight?.targetRevision) {
        return safeFailure(domain, 'final-backup', 'migration-conflict', { currentRevision: target.revision })
      }
      const capacity = await capacityCheck(adapterFor(domain), bytesOf(built.artifact), options)
      if (!capacity.ok) return safeFailure(domain, 'final-backup', 'migration-capacity-insufficient')
      const finalBackup = await createFinalManifest(
        domain,
        built.artifact,
        built.importIdentity,
        target,
        sourceIds,
        sourceCapture,
        sourceHostFreezeEvidence,
      )
      entry.finalBackup = finalBackup
      entry.status = 'final-backup'
      await writeState(state)
      return { ok: true, domain, stage: 'final-backup', status: 'final-backup', finalBackup }
    } catch (error) {
      return safeFailure(domain, 'final-backup', error?.code || 'migration-final-backup-failed')
    }
  }

  async function importDomain(domainInput, importOptions = {}) {
    const domain = domainKey(domainInput)
    const state = await readState()
    const entry = state.domains[domain]
    if (!entry.finalBackup || entry.frozen !== true) return safeFailure(domain, 'import', 'migration-final-backup-required')
    let finalBackup
    try { finalBackup = await validateFinalBackup(entry.finalBackup, domain, options.backupLimits) } catch (error) {
      return safeFailure(domain, 'import', error?.code || 'migration-backup-invalid')
    }
    const idempotencyKey = importOptions.idempotencyKey === undefined
      ? `migration-${domain}-${finalBackup.artifactChecksum.slice(7, 39)}`
      : safeIdentity(importOptions.idempotencyKey, 'idempotencyKey')
    const expectedRevision = importOptions.expectedRevision === undefined
      ? entry.preflight?.expectedRevision
      : safeRevision(importOptions.expectedRevision, 'expectedRevision')
    if (!isRevisionValue(expectedRevision)) return safeFailure(domain, 'import', 'migration-revision-invalid')
    const attempt = entry.importAttempt
    if (isPlainObject(attempt)
      && attempt.idempotencyKey === idempotencyKey
      && attempt.expectedRevision === expectedRevision
      && attempt.artifactChecksum === finalBackup.artifactChecksum) {
      try {
        const observed = await collectHost(domain)
        if (domainEquivalent(observed, finalBackup.artifact.domains[domain], domain)) {
          entry.import = {
            status: 'committed',
            idempotencyKey,
            expectedRevision,
            artifactChecksum: finalBackup.artifactChecksum,
            revision: observed.revision,
            commitStatus: 'committed',
            outcome: 'committed',
          }
          entry.status = 'imported'
          delete entry.importAttempt
          try {
            await writeState(state)
          } catch (error) {
            return safeFailure(domain, 'import', error?.code || 'migration-commit-unknown', { currentRevision: observed.revision })
          }
          return {
            ok: true,
            domain,
            stage: 'import',
            status: 'committed',
            outcome: 'committed',
            commitStatus: 'committed',
            revision: observed.revision,
            receiptId: null,
            idempotent: true,
            artifactChecksum: finalBackup.artifactChecksum,
          }
        }
      } catch {
        // Fall through to the ordinary CAS/evidence path.  The pending
        // attempt remains available for a later reopen when evidence exists.
      }
    }
    if (entry.import?.status === 'committed') {
      if (entry.import.idempotencyKey !== idempotencyKey || entry.import.expectedRevision !== expectedRevision
        || entry.import.artifactChecksum !== finalBackup.artifactChecksum) {
        return safeFailure(domain, 'import', 'migration-conflict', { currentRevision: entry.import.revision })
      }
      return { ok: true, domain, stage: 'import', status: 'committed', outcome: 'committed', commitStatus: 'committed', revision: entry.import.revision, receiptId: entry.import.receiptId || null, idempotent: true, artifactChecksum: finalBackup.artifactChecksum }
    }
    let target
    try {
      target = await collectHost(domain)
    } catch (error) {
      return safeFailure(domain, 'import', error?.code || 'migration-host-snapshot-invalid')
    }
    const targetSnapshot = finalBackup.artifact.domains[domain]
    // A previous process may have committed the Host mutation and then
    // stopped before recording the migration receipt.  If the observed Host
    // state already equals the retained final artifact, reconcile that effect
    // before applying another CAS mutation, even when its revision advanced.
    if (domainEquivalent(target, targetSnapshot, domain)) {
      entry.import = {
        status: 'committed',
        idempotencyKey,
        expectedRevision,
        artifactChecksum: finalBackup.artifact.artifactChecksum,
        revision: target.revision,
        commitStatus: 'committed',
        outcome: 'committed',
        idempotent: true,
      }
      entry.status = 'imported'
      delete entry.importAttempt
      try { await writeState(state) } catch (error) {
        return safeFailure(domain, 'import', error?.code || 'migration-commit-unknown', { currentRevision: target.revision })
      }
      return {
        ok: true,
        domain,
        stage: 'import',
        status: 'committed',
        outcome: 'committed',
        commitStatus: 'committed',
        revision: target.revision,
        receiptId: null,
        idempotent: true,
        artifactChecksum: finalBackup.artifactChecksum,
      }
    }
    if (target.revision !== expectedRevision) return safeFailure(domain, 'import', 'migration-conflict', { currentRevision: target.revision })
    const method = mutationMethod(adapterFor(domain))
    if (!method) return safeFailure(domain, 'import', 'migration-host-import-unavailable')
    entry.preImport = target
    entry.importAttempt = { idempotencyKey, expectedRevision, artifactChecksum: finalBackup.artifactChecksum }
    try {
      await writeState(state)
    } catch (error) {
      return safeFailure(domain, 'import', error?.code || 'migration-state-write-failed')
    }
    let result = null
    let mutationError = null
    try {
      result = await invokeMutation(adapterFor(domain), method, finalBackup.artifact.domains[domain], {
        domain,
        expectedRevision,
        idempotencyKey,
        sourceChecksum: finalBackup.artifact.manifest.domainChecksums[domain],
        migration: true,
      })
    } catch (error) {
      mutationError = error
    }
    let committed
    try {
      committed = await collectHost(domain)
    } catch (error) {
      return safeFailure(domain, 'import', mutationError?.code || error?.code || 'migration-commit-evidence-unavailable')
    }
    const targetMatches = domainEquivalent(committed, targetSnapshot, domain)
    const explicitCommit = !mutationError && resultIsCommitted(result, method)
    if (!targetMatches || (!explicitCommit && !mutationError)) {
      if (!domainEquivalent(committed, target, domain)) {
        const compensation = await compensateHostSnapshot(domain, target, committed, 'migration-import-failed')
        if (!compensation.ok) {
          return safeFailure(domain, 'import', compensation.reasonCode || 'migration-compensation-failed', {
            currentRevision: compensation.currentRevision ?? committed.revision,
          })
        }
      }
      if (resultIsConflict(result)) return safeFailure(domain, 'import', 'migration-conflict', { currentRevision: result?.currentRevision ?? committed.revision })
      if (mutationError) return safeFailure(domain, 'import', mutationError.code || 'migration-import-failed', { currentRevision: committed.revision })
      if (!resultIsCommitted(result, method)) return safeFailure(domain, 'import', 'migration-import-failed', { currentRevision: committed.revision })
      return safeFailure(domain, 'import', 'migration-import-verification-failed', { currentRevision: committed.revision })
    }
    if (mutationError) result = { status: 'committed', revision: committed.revision, idempotent: true }
    entry.import = {
      status: 'committed',
      idempotencyKey,
      expectedRevision,
      artifactChecksum: finalBackup.artifact.artifactChecksum,
      revision: committed.revision,
      ...safeResult(result, committed.revision),
    }
    entry.status = 'imported'
    delete entry.importAttempt
    try { await writeState(state) } catch (error) {
      return safeFailure(domain, 'import', error?.code || 'migration-state-write-failed')
    }
    return { ok: true, domain, stage: 'import', status: 'committed', outcome: 'committed', commitStatus: 'committed', revision: committed.revision, receiptId: safeResult(result).receiptId || null, idempotent: false, artifactChecksum: finalBackup.artifactChecksum }
  }

  async function verify(domainInput) {
    const domain = domainKey(domainInput)
    const state = await readState()
    const entry = state.domains[domain]
    if (entry.import?.status !== 'committed' || !entry.finalBackup) return safeFailure(domain, 'verify', 'migration-import-required')
    try {
      const finalBackup = await validateFinalBackup(entry.finalBackup, domain, options.backupLimits)
      const current = await collectHost(domain)
      if (!domainEquivalent(current, finalBackup.artifact.domains[domain], domain)) {
        return safeFailure(domain, 'verify', 'migration-verify-failed', { currentRevision: current.revision })
      }
      entry.status = 'verified'
      entry.verify = { status: 'verified', revision: current.revision, checksum: finalBackup.artifact.manifest.domainChecksums[domain] }
      await writeState(state)
      return { ok: true, domain, stage: 'verify', status: 'verified', revision: current.revision, checksum: entry.verify.checksum }
    } catch (error) {
      return safeFailure(domain, 'verify', error?.code || 'migration-verify-failed')
    }
  }

  async function switchHostAuthoritative(domainInput) {
    const domain = domainKey(domainInput)
    const state = await readState()
    const entry = state.domains[domain]
    if (!entry.verify) return safeFailure(domain, 'switch', 'migration-verify-required')
    if (entry.switch?.authorityChanged === true) return { ok: true, domain, stage: 'switch', ...clone(entry.switch) }
    const cutover = cutoverControls[domain]
    if (cutover && typeof cutover.switch === 'function') {
      let result
      try {
        result = await cutover.switch({
          domain,
          revision: entry.verify.revision,
          checksum: entry.verify.checksum,
          frozen: entry.frozen === true,
          finalBackup: clone(entry.finalBackup),
        })
      } catch (error) {
        return safeFailure(domain, 'switch', error?.code || 'migration-switch-failed', {
          currentRevision: error?.currentRevision,
        })
      }
      if (result === false || result?.ok === false || result?.authorityChanged !== true) {
        return safeFailure(domain, 'switch', result?.reasonCode || 'migration-switch-not-confirmed', result || {})
      }
      entry.switch = {
        status: 'authoritative',
        outcome: 'committed',
        authorityChanged: true,
        frozen: true,
        reasonCode: null,
      }
      entry.status = 'authoritative'
      try { await writeState(state) } catch (error) {
        return safeFailure(domain, 'switch', error?.code || 'migration-state-write-failed')
      }
      return { ok: true, domain, stage: 'switch', ...clone(entry.switch) }
    }
    // Task B records that the Host snapshot is ready.  C2 owns the real
    // writer/authority change, so this seam never flips production owner mode.
    entry.switch = {
      status: 'ready-to-switch',
      outcome: 'not-ready',
      authorityChanged: false,
      frozen: true,
      reasonCode: 'cutover-deferred',
    }
    entry.status = 'ready-to-switch'
    try { await writeState(state) } catch (error) {
      return safeFailure(domain, 'switch', error?.code || 'migration-state-write-failed')
    }
    return { ok: true, domain, stage: 'switch', ...clone(entry.switch) }
  }

  async function smokeCheck(domainInput) {
    const domain = domainKey(domainInput)
    const state = await readState()
    const entry = state.domains[domain]
    if (!entry.switch) return safeFailure(domain, 'smoke', 'migration-switch-required')
    if (entry.smoke?.status === 'passed') return { ok: true, domain, stage: 'smoke', ...clone(entry.smoke) }
    const cutover = cutoverControls[domain]
    if (cutover && typeof cutover.smoke === 'function') {
      let result
      try {
        result = await cutover.smoke({
          domain,
          revision: entry.verify?.revision ?? entry.import?.revision ?? null,
          checksum: entry.verify?.checksum ?? null,
          authorityChanged: entry.switch.authorityChanged === true,
        })
      } catch (error) {
        return safeFailure(domain, 'smoke', error?.code || 'migration-smoke-failed', {
          currentRevision: error?.currentRevision,
        })
      }
      if (result === false || result?.ok !== true) {
        return safeFailure(domain, 'smoke', result?.reasonCode || 'migration-smoke-failed', result || {})
      }
      entry.smoke = {
        status: 'passed',
        ok: true,
        outcome: 'committed',
        reasonCode: null,
      }
      entry.status = 'authoritative'
      try { await writeState(state) } catch (error) {
        return safeFailure(domain, 'smoke', error?.code || 'migration-state-write-failed')
      }
      if (typeof cutover.unfreeze === 'function') {
        let unfreezeResult
        try {
          unfreezeResult = await cutover.unfreeze({ domain, reason: 'migration-authoritative' })
        } catch (error) {
          return safeFailure(domain, 'smoke', error?.code || 'migration-unfreeze-failed')
        }
        if (unfreezeResult === false || unfreezeResult?.ok === false) {
          return safeFailure(domain, 'smoke', unfreezeResult?.reasonCode || 'migration-unfreeze-failed')
        }
      }
      return { ok: true, domain, stage: 'smoke', ...clone(entry.smoke) }
    }
    try {
      entry.smoke = {
        status: 'deferred',
        ok: false,
        outcome: 'not-ready',
        reasonCode: 'cutover-deferred',
      }
      entry.status = 'ready-to-switch'
      await writeState(state)
      return { ok: true, domain, stage: 'smoke', ...clone(entry.smoke) }
    } catch (error) {
      return safeFailure(domain, 'smoke', error?.code || 'migration-smoke-failed')
    }
  }

  async function rollback(domainInput, rollbackOptions = {}) {
    const domain = domainKey(domainInput)
    const state = await readState()
    const entry = state.domains[domain]
    // A prior rollback may have restored the canonical repository while a
    // target authority checkpoint revoke was interrupted.  Keep walking the
    // rollback transaction so the cutover side effect is retried; returning
    // early here leaves the target checkpoint authoritative forever.
    const previouslyRolledBack = entry.rollback?.status === 'rolled-back'
    if (entry.import?.status !== 'committed' || !entry.preImport) return safeFailure(domain, 'rollback', 'migration-rollback-target-missing')
    let preImport
    try {
      const finalBackup = await validateFinalBackup(entry.finalBackup, domain, options.backupLimits)
      preImport = normalizedHostSnapshot(entry.preImport, domain)
      const rollbackTarget = finalBackup.rollbackTarget
      if (!isPlainObject(rollbackTarget)
        || rollbackTarget.kind !== 'host-canonical-before-import'
        || rollbackTarget.domain !== domain
        || rollbackTarget.revision !== preImport.revision
        || rollbackTarget.checksum !== await digestCanonical(preImport)) {
        return safeFailure(domain, 'rollback', 'migration-state-corrupt')
      }
    } catch (error) {
      return safeFailure(domain, 'rollback', error?.code || 'migration-state-corrupt')
    }
    const adapter = adapterFor(domain)
    const method = mutationMethod(adapter, true)
    if (!method) return safeFailure(domain, 'rollback', 'migration-host-restore-unavailable')
    let current
    try { current = await collectHost(domain) } catch (error) {
      return safeFailure(domain, 'rollback', error?.code || 'migration-host-snapshot-invalid')
    }
    const alreadyRestored = domainEquivalent(current, preImport, domain)
    const acceptedPostImportRevisions = [entry.import.revision, entry.verify?.revision]
      .filter((revision) => revision !== undefined && revision !== null)
    if (!acceptedPostImportRevisions.includes(current.revision) && !alreadyRestored) {
      return safeFailure(domain, 'rollback', 'migration-conflict', { currentRevision: current.revision })
    }
    const cutover = cutoverControls[domain]
    // A previous rollback attempt may have restored the canonical repository
    // before failing while revoking the target authority checkpoint.  The
    // repository CAS is then already satisfied, but the cutover side effect
    // is still required whenever this migration actually switched authority.
    const authorityWasChanged = entry.switch?.authorityChanged === true
    if ((!alreadyRestored || authorityWasChanged) && cutover && typeof cutover.rollback === 'function') {
      let checkpointResult
      try {
        checkpointResult = await cutover.rollback({
          domain,
          // The target checkpoint is committed during switch using the
          // verified Host revision.  The import revision can be lower when
          // the target restore itself advances more than once (for example,
          // marks restore writes one receipt per source scope).
          revision: entry.verify?.revision ?? entry.import.revision,
          checksum: entry.verify?.checksum || null,
          reason: 'migration-rollback',
          frozen: true,
        })
      } catch (error) {
        return safeFailure(domain, 'rollback', error?.code || 'migration-checkpoint-rollback-failed', {
          currentRevision: current.revision,
        })
      }
      if (checkpointResult === false || checkpointResult?.ok === false) {
        return safeFailure(domain, 'rollback', checkpointResult?.reasonCode || 'migration-checkpoint-rollback-failed', {
          currentRevision: current.revision,
        })
      }
    }
    const idempotencyKey = rollbackOptions.idempotencyKey === undefined
      ? `rollback-${domain}-${entry.import.artifactChecksum.slice(7, 39)}`
      : safeIdentity(rollbackOptions.idempotencyKey, 'idempotencyKey')
    let result = { status: 'committed', revision: current.revision, idempotent: true }
    if (!alreadyRestored) {
      try {
        result = await invokeMutation(adapter, method, preImport, {
          domain,
          expectedRevision: current.revision,
          idempotencyKey,
          reason: 'migration-rollback',
          migration: true,
        })
      } catch (error) {
        return safeFailure(domain, 'rollback', error?.code || 'migration-rollback-failed')
      }
      if (!resultIsCommitted(result, method)) return safeFailure(domain, 'rollback', 'migration-rollback-failed')
    }
    try {
      const restored = await collectHost(domain)
      if (!domainEquivalent(restored, preImport, domain)) return safeFailure(domain, 'rollback', 'migration-rollback-verification-failed')
      const controls = [writerControls[domain] || adapter, cutoverControls[domain]]
        .filter((control, index, all) => (
          control && typeof control.unfreeze === 'function' && all.indexOf(control) === index
        ))
      for (const control of controls) {
        const unfreezeResult = await control.unfreeze({ domain, reason: 'migration-rollback' })
        if (unfreezeResult === false || unfreezeResult?.ok === false) {
          return safeFailure(domain, 'rollback', 'migration-unfreeze-failed', { currentRevision: restored.revision })
        }
      }
      entry.rollback = { status: 'rolled-back', revision: restored.revision, idempotencyKey }
      entry.status = 'rolled-back'
      await writeState(state)
      return {
        ok: true,
        domain,
        stage: 'rollback',
        ...clone(entry.rollback),
        idempotent: previouslyRolledBack,
      }
    } catch (error) {
      return safeFailure(domain, 'rollback', error?.code || 'migration-rollback-verification-failed')
    }
  }

  async function dryRunRestore(domainInput, backupInput, restoreOptions = {}) {
    const domain = domainKey(domainInput)
    try {
      const backup = await resolveRestoreArtifact(backupInput, domain, options.backupLimits)
      const verification = await verifyBackupArtifact(backup, {
        requiredDomains: WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS,
        ...(isPlainObject(options.backupLimits) ? options.backupLimits : {}),
      })
      if (!verification.valid) return safeFailure(domain, 'restore-dry-run', 'migration-backup-invalid')
      const sourceDomain = backup.domains[domain]
      const target = await collectHost(domain)
      const expectedRevision = restoreOptions.expectedRevision === undefined
        ? target.revision
        : safeRevision(restoreOptions.expectedRevision, 'expectedRevision')
      const decision = compareTarget(sourceDomain, target, expectedRevision, restoreOptions.allowExistingTarget, domain)
      if (!decision.ok) return safeFailure(domain, 'restore-dry-run', decision.reasonCode, decision)
      const capacity = await capacityCheck(adapterFor(domain), bytesOf(backup), options)
      if (!capacity.ok) return safeFailure(domain, 'restore-dry-run', 'migration-capacity-insufficient')
      return {
        ok: true,
        domain,
        mode: 'restore-dry-run',
        write: false,
        status: 'ready',
        artifactChecksum: backup.artifactChecksum,
        targetRevision: target.revision,
        capacity,
      }
    } catch (error) {
      return safeFailure(domain, 'restore-dry-run', error?.code || 'migration-restore-dry-run-failed')
    }
  }

  async function restore(domainInput, backupInput, restoreOptions = {}) {
    const domain = domainKey(domainInput)
    let backup
    try {
      backup = await resolveRestoreArtifact(backupInput, domain, options.backupLimits)
    } catch (error) {
      return safeFailure(domain, 'restore', error?.code || 'migration-backup-invalid')
    }
    if (!isPlainObject(backup) || typeof backup.artifactChecksum !== 'string') {
      return safeFailure(domain, 'restore', 'migration-backup-invalid')
    }
    try {
      const verification = await verifyBackupArtifact(backup, {
        requiredDomains: WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS,
        ...(isPlainObject(options.backupLimits) ? options.backupLimits : {}),
      })
      if (!verification.valid) return safeFailure(domain, 'restore', 'migration-backup-invalid')
    } catch (error) {
      return safeFailure(domain, 'restore', error?.code || 'migration-backup-invalid')
    }
    const state = await readState()
    const entry = state.domains[domain]
    const idempotencyKey = restoreOptions.idempotencyKey === undefined
      ? `restore-${domain}-${backup.artifactChecksum.slice(7, 39)}`
      : safeIdentity(restoreOptions.idempotencyKey, 'idempotencyKey')
    if (entry.restore?.status === 'committed') {
      if (entry.restore.idempotencyKey !== idempotencyKey || entry.restore.artifactChecksum !== backup.artifactChecksum) {
        return safeFailure(domain, 'restore', 'migration-conflict', { currentRevision: entry.restore.revision })
      }
      return { ok: true, domain, stage: 'restore', status: 'committed', revision: entry.restore.revision, receiptId: entry.restore.receiptId || null, idempotent: true }
    }
    const dry = await dryRunRestore(domain, backupInput, restoreOptions)
    if (!dry.ok) return dry
    const adapter = adapterFor(domain)
    const method = mutationMethod(adapter, true)
    if (!method) return safeFailure(domain, 'restore', 'migration-host-restore-unavailable')
    let target
    try {
      target = await collectHost(domain)
    } catch (error) {
      return safeFailure(domain, 'restore', error?.code || 'migration-host-snapshot-invalid')
    }
    if (target.revision !== dry.targetRevision) {
      return safeFailure(domain, 'restore', 'migration-conflict', { currentRevision: target.revision })
    }
    let result = null
    let mutationError = null
    try {
      result = await invokeMutation(adapter, method, backup.domains[domain], {
        domain,
        expectedRevision: target.revision,
        idempotencyKey,
        reason: 'migration-restore',
        migration: true,
      })
    } catch (error) {
      mutationError = error
    }
    let current
    try {
      current = await collectHost(domain)
    } catch (error) {
      return safeFailure(domain, 'restore', mutationError?.code || error?.code || 'migration-commit-evidence-unavailable')
    }
    const targetSnapshot = backup.domains[domain]
    const targetMatches = domainEquivalent(current, targetSnapshot, domain)
    const explicitCommit = !mutationError && resultIsCommitted(result, method)
    if (!targetMatches || (!explicitCommit && !mutationError)) {
      if (!domainEquivalent(current, target, domain)) {
        const compensation = await compensateHostSnapshot(domain, target, current, 'migration-restore-failed')
        if (!compensation.ok) {
          return safeFailure(domain, 'restore', compensation.reasonCode || 'migration-compensation-failed', {
            currentRevision: compensation.currentRevision ?? current.revision,
          })
        }
      }
      if (resultIsConflict(result)) return safeFailure(domain, 'restore', 'migration-conflict', { currentRevision: result?.currentRevision ?? current.revision })
      if (mutationError) return safeFailure(domain, 'restore', 'migration-restore-failed', { currentRevision: current.revision })
      if (!resultIsCommitted(result, method)) return safeFailure(domain, 'restore', 'migration-restore-failed', { currentRevision: current.revision })
      return safeFailure(domain, 'restore', 'migration-restore-verification-failed', { currentRevision: current.revision })
    }
    if (mutationError) result = { status: 'committed', revision: current.revision, idempotent: true }
    entry.restore = {
      status: 'committed',
      idempotencyKey,
      artifactChecksum: backup.artifactChecksum,
      revision: current.revision,
      receiptId: safeResult(result).receiptId || null,
    }
    await writeState(state)
    return { ok: true, domain, stage: 'restore', status: 'committed', revision: current.revision, receiptId: safeResult(result).receiptId || null, idempotent: false }
  }

  async function migrateDomain(domainInput, runOptions = {}) {
    const domain = domainKey(domainInput)
    const steps = {}
    steps.inventory = await inventory()
    if (steps.inventory.status !== 'ready') return { ok: false, domain, stopped: true, steps }
    steps.dryRun = await dryRun(domain, runOptions)
    if (!steps.dryRun.ok) return { ok: false, domain, stopped: true, steps }
    steps.freeze = await freeze(domain, {
      reconcile: runOptions.reconcilePhysicalFreeze === true,
    })
    if (!steps.freeze.ok) return { ok: false, domain, stopped: true, steps }
    if (typeof runOptions.beforeFinalBackup === 'function') {
      try {
        steps.beforeFinalBackup = await runOptions.beforeFinalBackup({
          domain,
          freeze: steps.freeze,
        })
      } catch (error) {
        steps.beforeFinalBackup = {
          ok: false,
          reasonCode: error?.code || 'migration-pre-final-backup-hook-failed',
        }
      }
      if (steps.beforeFinalBackup === false || steps.beforeFinalBackup?.ok === false) {
        return { ok: false, domain, stopped: true, steps }
      }
    }
    steps.finalBackup = await createFinalBackup(domain, {
      sourceCapture: steps.beforeFinalBackup?.sourceCapture,
      sourceHostFreezeEvidence: steps.beforeFinalBackup?.sourceHostFreezeEvidence,
    })
    if (!steps.finalBackup.ok) return { ok: false, domain, stopped: true, steps }
    steps.import = await importDomain(domain, runOptions)
    if (!steps.import.ok) return { ok: false, domain, stopped: true, steps }
    steps.verify = await verify(domain)
    if (!steps.verify.ok) {
      steps.rollback = await rollback(domain)
      return { ok: false, domain, stopped: true, steps }
    }
    steps.switch = await switchHostAuthoritative(domain)
    if (!steps.switch.ok) {
      steps.rollback = await rollback(domain)
      return { ok: false, domain, stopped: true, steps }
    }
    steps.smoke = await smokeCheck(domain)
    if (!steps.smoke.ok && steps.smoke.reasonCode !== 'cutover-deferred') {
      steps.rollback = await rollback(domain)
      return { ok: false, domain, stopped: true, steps }
    }
    return {
      ok: true,
      domain,
      status: steps.smoke.status === 'passed' ? 'completed' : 'ready-to-switch',
      preCutover: steps.smoke.reasonCode === 'cutover-deferred',
      stopped: false,
      steps,
    }
  }

  async function runAll(runOptions = {}) {
    const requested = runOptions.domains === undefined
      ? WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS
      : runOptions.domains.map(domainKey)
    const results = []
    for (const domain of requested) {
      const result = await migrateDomain(domain, runOptions)
      results.push(result)
      if (!result.ok) break
    }
    return {
      ok: results.length === requested.length && results.every((result) => result.ok),
      stoppedAt: results.find((result) => !result.ok)?.domain || null,
      results,
    }
  }

  async function status() {
    const state = await readState()
    const authoritative = WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.some((domain) => (
      state.domains[domain].switch?.authorityChanged === true
    ))
    return {
      schemaVersion: WINDOWS_DURABLE_STATE_MIGRATION_SCHEMA_VERSION,
      profileId,
      authorityMode: authoritative ? 'authoritative' : 'pre-cutover',
      domains: Object.fromEntries(WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.map((domain) => {
        const entry = state.domains[domain]
        return [domain, {
          status: entry.status,
          frozen: entry.frozen === true,
          finalBackupChecksum: entry.finalBackup?.artifactChecksum || null,
          rollbackTargetRevision: entry.finalBackup?.rollbackTarget?.revision ?? null,
          rollbackTargetChecksum: entry.finalBackup?.rollbackTarget?.checksum || null,
          importStatus: entry.import?.status || null,
          importAttemptStatus: entry.importAttempt ? 'pending' : null,
          rollbackStatus: entry.rollback?.status || null,
          rollbackRevision: entry.rollback?.revision ?? null,
          importedRevision: entry.import?.revision ?? null,
          verified: Boolean(entry.verify),
          authorityChanged: entry.switch?.authorityChanged === true,
          switchStatus: entry.switch?.status || null,
          smokeStatus: entry.smoke?.status || null,
          cutoverDeferred: entry.switch?.reasonCode === 'cutover-deferred',
          authoritative: entry.switch?.authorityChanged === true && entry.smoke?.status === 'passed',
        }]
      })),
    }
  }

  return Object.freeze({
    format: WINDOWS_DURABLE_STATE_MIGRATION_FORMAT,
    schemaVersion: WINDOWS_DURABLE_STATE_MIGRATION_SCHEMA_VERSION,
    domains: [...WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS],
    inventory,
    dryRun,
    freeze,
    createFinalBackup,
    importDomain,
    verify,
    switchHostAuthoritative,
    smokeCheck,
    rollback,
    dryRunRestore,
    restore,
    migrateDomain,
    runDomain: migrateDomain,
    runAll,
    status,
  })
}
