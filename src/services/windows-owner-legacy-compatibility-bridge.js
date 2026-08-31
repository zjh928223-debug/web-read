import apiContract from '../../docs/architecture/windows-local-owner-thin-reader/api-contract.json'
import domainInventory from '../../docs/architecture/windows-local-owner-thin-reader/domain-inventory.json'
import ownerRegistry from '../../docs/architecture/windows-local-owner-thin-reader/owner-registry.json'

const BRIDGE_SCHEMA_VERSION = 1
const BRIDGE_NAME = 'windows-owner-legacy-compatibility.v1'
const SOURCE_KINDS = Object.freeze(['indexeddb', 'localStorage', 'json'])
const DOMAINS = Object.freeze([
  'reader-session',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'marks-activity',
  'workflow',
])
const FROZEN_INDEXED_DB_SCHEMA = Object.freeze({
  databaseName: 'SeekPlayerDB',
  version: 1,
  objectStore: 'files',
  keyPath: 'id',
})
const SAFE_SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u
const SAFE_RECORD_KEY = /^[^\u0000-\u001f]{1,512}$/u
const SAFE_FINGERPRINT = /^sha256:[a-f0-9]{64}$/u
const SENSITIVE_KEY = /(?:token|authorization|cookie|password|secret|api[-_]?key|credential)/iu
const MEDIA_PAYLOAD_KEY = /(?:blob|arraybuffer|typedarray|byte(?:s|array)|base64|datauri|dataurl|media(?:bytes|buffer|blob|payload)|(?:audio|video)(?:bytes|buffer|blob|payload))/iu
const MEDIA_DATA_URI = /^data:(?:audio|video|image|application\/(?:octet-stream|ogg|mp4|x-7z-compressed))[^,]*;base64,/iu
const MEDIA_BASE64_PREFIX = /^(?:UklGR|SUQz|T2dn|GkXfo|AAAAIGZ0eX)/u
const SENSITIVE_URL_QUERY = /^(?:token|access[_-]?token|api[_-]?key|apikey|authorization|auth|password|secret|credential|cookie|signature|sig)$/iu
const MAX_EVIDENCE_SAMPLE_BYTES = 64 * 1024
const MAX_EVIDENCE_SAMPLE_CHARS = 64 * 1024
const RAW_TEXT_LOCAL_STORAGE_KEYS = new Set([
  'vocabulary.passage-preview.shortcut.translation.v1',
  'vocabulary.passage-preview.shortcut.context.v1',
  'vocabulary.passage-preview.translation-display-mode.v1',
])
const VOCABULARY_SETTLEMENT_PREFIX = 'vocabulary-article-srs-settlement-progress:'
const LEGACY_LOCAL_STORAGE_SCOPE_PREFIXES = Object.freeze([
  'vocabulary.',
  'AnnotationGenerationStorage::',
  'read-web.reader-save-outbox',
  'read-web.workflow-operation-receipt',
])
const READER_SAVE_OUTBOX_V1_KEY = 'read-web.reader-save-outbox.v1'
const READER_SAVE_OUTBOX_V2_PREFIX = 'read-web.reader-save-outbox.v2.'
const CLAIM_CLASSIFICATIONS = Object.freeze({
  canonicalRecords: 'canonical',
  compatibilityRecords: 'compatibility',
  compatibilityKeys: 'compatibility',
  nonCanonicalRecords: 'non-canonical',
  ephemeralOrPreferenceKeys: 'non-canonical',
})
const ALLOWED_IMPORT_CLASSIFICATIONS = new Set(['canonical', 'compatibility'])

const contractDomains = apiContract.domainRegistry?.map((registration) => registration.domain) || []
if (JSON.stringify(contractDomains) !== JSON.stringify(DOMAINS)) {
  throw new Error('Legacy compatibility bridge requires the six-domain owner contract')
}

export const WINDOWS_OWNER_LEGACY_BRIDGE_SCHEMA_VERSION = BRIDGE_SCHEMA_VERSION
export const WINDOWS_OWNER_LEGACY_SOURCE_KINDS = SOURCE_KINDS
export const WINDOWS_OWNER_LEGACY_BRIDGE_METHODS = Object.freeze([
  'inventory',
  'prepareImport',
  'readRollbackWindow',
])

export class WindowsOwnerLegacyBridgeError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WindowsOwnerLegacyBridgeError'
    this.code = code
  }
}

const CLAIMS = buildClaims()

/**
 * Read-only compatibility boundary for legacy browser persistence.
 *
 * The optional applicationPersistence and storage arguments are deliberately
 * consumed into closures. The returned object only exposes inventory,
 * prepareImport, and readRollbackWindow; it never exposes a storage handle or
 * a restore/commit method. jsonSources use the same read-only shape:
 * { kind: 'json', sourceId, read: async () => ({ records }) }.
 */
export function createWindowsOwnerLegacyCompatibilityBridge(options = {}) {
  const profileId = options.profileId === undefined || options.profileId === null
    ? null
    : requireSourceId(options.profileId, 'profileId')
  const sources = createSources(options)
  const sourceById = new Map()
  for (const source of sources) {
    const identity = `${source.kind}:${source.sourceId}`
    if (sourceById.has(identity)) throw bridgeError('legacy-source-duplicate', 'Legacy source identity is duplicated')
    sourceById.set(identity, source)
  }

  return Object.freeze({
    async inventory() {
      const snapshot = await collectAllSources()
      return freezeDeep(await withInventoryChecksum(snapshot, profileId))
    },

    async prepareImport(request = {}) {
      if (!isPlainObject(request)) throw bridgeError('legacy-import-request-invalid', 'Legacy import request must be an object')
      const requestedSourceIds = request.sourceIds === undefined
        ? null
        : requireSourceIdList(request.sourceIds, 'sourceIds')
      const selectedSources = selectSources(requestedSourceIds)
      const snapshot = await collectSources(selectedSources)
      const allRecords = snapshot.sources.flatMap((source) => source.records)
      const blocked = allRecords.filter((record) => record.metadata.status === 'blocked')
      const duplicateEvidence = findDuplicateImportMetadata(allRecords)
      const duplicateIdentities = new Set(duplicateEvidence.map(importIdentityForMetadata))
      const importable = allRecords
        .filter((record) => record.metadata.status === 'ready')
        .filter((record) => ALLOWED_IMPORT_CLASSIFICATIONS.has(record.metadata.classification))
        .filter((record) => !duplicateIdentities.has(importIdentityForMetadata(record.metadata)))
        .sort(compareRecordMetadata)
      const excludedRecords = allRecords
        .filter((record) => record.metadata.status === 'ready' && !ALLOWED_IMPORT_CLASSIFICATIONS.has(record.metadata.classification))
        .map((record) => record.metadata)

      const base = {
        schemaVersion: BRIDGE_SCHEMA_VERSION,
        bridge: BRIDGE_NAME,
        mode: 'one-time-import-plan',
        profileId,
        status: blocked.length > 0 || duplicateEvidence.length > 0 || snapshot.sources.some((source) => source.status === 'blocked') ? 'blocked' : 'ready',
        reasonCode: firstReasonCode(snapshot, [...blocked, ...duplicateEvidence.map((metadata) => ({ metadata }))]),
        frozenIndexedDbSchema: FROZEN_INDEXED_DB_SCHEMA,
        sourceChecksums: snapshot.sources.map((source) => ({
          sourceKind: source.source.kind,
          sourceId: source.source.sourceId,
          checksum: source.checksum,
        })),
        blockedRecords: [...blocked.map((record) => record.metadata), ...duplicateEvidence],
        duplicateRecords: duplicateEvidence,
        excludedRecords,
        importInput: null,
      }

      if (base.status === 'blocked') {
        return freezeDeep({
          ...base,
          importIdentity: await digestCanonical({
            sourceChecksums: base.sourceChecksums,
            blockedRecords: base.blockedRecords,
            duplicateRecords: base.duplicateRecords,
          }),
        })
      }

      const importInput = {
        schemaVersion: BRIDGE_SCHEMA_VERSION,
        mode: 'legacy-import-input',
        profileId,
        records: importable.map((record) => ({
          ...record.metadata,
          payload: record.payload,
        })),
      }
      return freezeDeep({
        ...base,
        importIdentity: await digestCanonical(importInput),
        importInput,
      })
    },

    async readRollbackWindow(request = {}) {
      if (!isPlainObject(request)) throw bridgeError('legacy-rollback-request-invalid', 'Rollback-window request must be an object')
      const sourceId = requireSourceId(request.sourceId, 'sourceId')
      const recordKey = requireRecordKey(request.recordKey ?? request.key, 'recordKey')
      const domain = requireDomain(request.domain)
      const source = sourceById.get(findSourceIdentity(sourceId, sourceById))
      if (!source) throw bridgeError('legacy-source-not-found', 'Requested legacy source is not registered')
      const snapshot = await collectSources([source])
      const matches = snapshot.sources[0].records.filter((candidate) => candidate.metadata.recordKey === recordKey)
      if (matches.length === 0) throw bridgeError('legacy-record-not-found', 'Requested legacy record is not available')
      if (matches.length > 1) throw bridgeError('legacy-duplicate-record', 'Requested legacy record is ambiguous')
      const record = matches[0]
      if (record.metadata.status !== 'ready') {
        throw bridgeError(record.metadata.reasonCode || 'legacy-record-blocked', 'Requested legacy record is blocked')
      }
      if (record.metadata.domain !== domain) {
        throw bridgeError('legacy-domain-mismatch', 'Requested legacy record is not claimed by the requested domain')
      }
      return freezeDeep({
        schemaVersion: BRIDGE_SCHEMA_VERSION,
        bridge: BRIDGE_NAME,
        mode: 'rollback-window-read',
        profileId,
        source: {
          sourceKind: source.kind,
          sourceId: source.sourceId,
        },
        ...record.metadata,
        payload: record.payload,
      })
    },
  })

  async function collectAllSources() {
    return collectSources(sources)
  }

  function selectSources(requestedSourceIds) {
    if (!requestedSourceIds) return sources
    const selected = []
    for (const sourceId of requestedSourceIds) {
      const matches = sources.filter((source) => source.sourceId === sourceId)
      if (matches.length !== 1) throw bridgeError('legacy-source-not-found', 'Requested legacy source is not registered')
      selected.push(matches[0])
    }
    return selected
  }
}

function createSources(options) {
  const sources = []
  if (options.applicationPersistence !== undefined) {
    const persistence = options.applicationPersistence
    if (!persistence || typeof persistence.getAllRows !== 'function') {
      throw bridgeError('legacy-indexeddb-reader-invalid', 'ApplicationPersistence read boundary is unavailable')
    }
    sources.push({
      kind: 'indexeddb',
      sourceId: 'SeekPlayerDB/files',
      defaultSchemaVersion: 1,
      schema: FROZEN_INDEXED_DB_SCHEMA,
      read: async () => ({ records: await persistence.getAllRows() }),
    })
  }

  if (options.storage !== undefined) {
    const storage = options.storage
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.key !== 'function') {
      throw bridgeError('legacy-local-storage-reader-invalid', 'localStorage read boundary is unavailable')
    }
    sources.push({
      kind: 'localStorage',
      sourceId: 'localStorage',
      read: async () => {
        const records = []
        const length = Number(storage.length) || 0
        for (let index = 0; index < length; index += 1) {
          const key = storage.key(index)
          if (key === null || key === undefined) continue
          if (!isLegacyLocalStorageKey(String(key))) continue
          records.push({
            key,
            rawValue: storage.getItem(key),
            rawText: RAW_TEXT_LOCAL_STORAGE_KEYS.has(String(key)),
          })
        }
        return { records }
      },
    })
  }

  for (const descriptor of options.sources || []) sources.push(descriptor)
  for (const descriptor of options.jsonSources || []) sources.push({ ...descriptor, kind: 'json' })
  for (const [domain, adapter] of Object.entries(options.backupAdapters || {})) {
    if (!DOMAINS.includes(domain)) throw bridgeError('legacy-backup-domain-invalid', 'Legacy backup adapter domain is not registered')
    if (!adapter || typeof adapter.collect !== 'function') {
      throw bridgeError('legacy-backup-reader-invalid', 'Legacy backup adapter has no read collector')
    }
    sources.push({
      kind: 'json',
      sourceId: `backup.${domain}`,
      defaultSchemaVersion: adapter.schemaVersion ?? 1,
      read: () => adapter.collect({ domain }),
    })
  }
  return sources.map(normalizeSource).sort(compareSources)
}

function normalizeSource(source) {
  if (!isPlainObject(source)) throw bridgeError('legacy-source-invalid', 'Legacy source must be a descriptor')
  if (!SOURCE_KINDS.includes(source.kind)) throw bridgeError('legacy-source-kind-invalid', 'Legacy source kind is not supported')
  const sourceId = requireSourceId(source.sourceId, 'sourceId')
  if (typeof source.read !== 'function') throw bridgeError('legacy-source-reader-missing', 'Legacy source must provide a read function')
  if (source.path !== undefined || source.filePath !== undefined || source.storage !== undefined
    || source.database !== undefined || source.objectStore !== undefined || source.handle !== undefined) {
    throw bridgeError('legacy-source-handle-exposed', 'Legacy source descriptors cannot carry raw handles or paths')
  }
  return Object.freeze({
    kind: source.kind,
    sourceId,
    defaultSchemaVersion: source.defaultSchemaVersion,
    schema: source.kind === 'indexeddb' ? FROZEN_INDEXED_DB_SCHEMA : null,
    read: source.read,
  })
}

async function collectSources(sources) {
  if (sources.length === 0) {
    return {
      sources: [{
        source: { kind: 'none', sourceId: 'none' },
        schema: null,
        status: 'blocked',
        reasonCode: 'legacy-source-unavailable',
        records: [],
        checksum: null,
      }],
    }
  }

  const snapshots = []
  for (const source of sources) {
    try {
      const result = await source.read()
      const rawRecords = extractRecords(result)
      const records = []
      for (const rawRecord of rawRecords) records.push(await normalizeRecord(rawRecord, source))
      const recordsWithDuplicateEvidence = markDuplicateRecords(records)
      const blocked = recordsWithDuplicateEvidence.some((record) => record.metadata.status === 'blocked')
      const checksum = await digestCanonical(recordsWithDuplicateEvidence.map((record) => record.metadata).sort(compareMetadata))
      snapshots.push({
        source,
        schema: source.schema,
        status: blocked ? 'blocked' : 'ready',
        reasonCode: recordsWithDuplicateEvidence.find((record) => record.metadata.status === 'blocked')?.metadata.reasonCode || null,
        records: recordsWithDuplicateEvidence,
        checksum,
      })
    } catch {
      snapshots.push({
        source,
        schema: source.schema,
        status: 'blocked',
        reasonCode: 'legacy-source-read-failed',
        records: [],
        checksum: null,
      })
    }
  }
  return { sources: snapshots }
}

function extractRecords(result) {
  if (Array.isArray(result)) return result
  if (isPlainObject(result) && Array.isArray(result.records)) return result.records
  throw bridgeError('legacy-source-result-invalid', 'Legacy source did not return records')
}

async function normalizeRecord(rawRecord, source) {
  if (!isPlainObject(rawRecord)) return blockedRecord(source, '[redacted-record]', null, null, 'legacy-record-corrupt', 'corrupt', rawRecord)
  const rawKey = rawRecord.key ?? rawRecord.id ?? rawRecord.sourceKey
  const hasSafeKey = safeRecordKey(rawKey)
  const recordKey = hasSafeKey ? String(rawKey) : '[redacted-record]'
  const rawValue = rawRecord.rawValue
  const size = recordSize(rawRecord, rawValue)
  if (!hasSafeKey) return blockedRecord(source, recordKey, readRevision(rawRecord), size, 'legacy-record-key-invalid', 'corrupt', rawRecord)
  const claimResult = resolveClaim(recordKey, rawRecord.domain)
  const evidenceChecksum = safeFingerprint(rawRecord.checksum) || await evidenceChecksumForRecord(rawRecord, source)
  const base = {
    sourceKind: source.kind,
    sourceId: source.sourceId,
    recordKey,
    domain: claimResult.claim?.domain || registeredDomain(rawRecord.domain),
    classification: claimResult.claim?.classification || 'unclaimed',
    schemaVersion: null,
    revision: readRevision(rawRecord),
      contentId: typeof rawRecord.contentId === 'string' ? rawRecord.contentId : null,
      references: Array.isArray(rawRecord.references) ? rawRecord.references : [],
      mediaReferences: Array.isArray(rawRecord.mediaReferences) ? rawRecord.mediaReferences : [],
    size,
    checksum: evidenceChecksum,
    status: 'blocked',
    reasonCode: null,
  }

  if (claimResult.reasonCode || !claimResult.claim) {
    return { metadata: { ...base, reasonCode: claimResult.reasonCode }, payload: null }
  }
  if (!claimSourceAllows(claimResult.claim, source)) {
    return { metadata: { ...base, reasonCode: claimSourceReason(claimResult.claim, source) }, payload: null }
  }

  let payload
  if (Object.prototype.hasOwnProperty.call(rawRecord, 'rawValue')) {
    if (typeof rawValue !== 'string') return { metadata: { ...base, reasonCode: 'legacy-record-corrupt', classification: 'corrupt' }, payload: null }
    if (rawRecord.rawText === true) payload = rawValue
    else {
      try { payload = JSON.parse(rawValue) } catch {
        return { metadata: { ...base, reasonCode: 'legacy-record-corrupt', classification: 'corrupt' }, payload: null }
      }
    }
  } else if (Object.prototype.hasOwnProperty.call(rawRecord, 'payload')) {
    payload = rawRecord.payload
  } else if (Object.prototype.hasOwnProperty.call(rawRecord, 'content')) {
    payload = rawRecord.content
  } else if (Object.prototype.hasOwnProperty.call(rawRecord, 'value')) {
    payload = rawRecord.value
  } else {
    payload = stripRecordMetadata(rawRecord)
  }

  if (base.revision === null) base.revision = readRevision(payload)
  const schemaVersion = readSchemaVersion(rawRecord, payload, claimResult.claim, source)
  base.schemaVersion = schemaVersion
  if (schemaVersion === null || !claimResult.claim.schemaVersions.some((value) => String(value) === String(schemaVersion))) {
    return { metadata: { ...base, reasonCode: 'legacy-unsupported-schema' }, payload: null }
  }

  try {
    const safePayload = cloneSafeValue(payload, [], {
      allowVocabularySettlementAttemptToken: source.kind === 'indexeddb'
        && recordKey.startsWith(VOCABULARY_SETTLEMENT_PREFIX),
    })
    const metadata = {
      ...base,
      checksum: await digestCanonical({
        recordKey,
        schemaVersion,
        revision: base.revision,
        payload: safePayload,
      }),
      status: 'ready',
      reasonCode: null,
    }
    return { metadata, payload: safePayload }
  } catch (error) {
    const code = error?.code === 'legacy-media-payload'
      ? 'legacy-media-payload'
      : error?.code === 'legacy-sensitive-field' || error?.code === 'legacy-sensitive-value'
        ? error.code
        : 'legacy-record-corrupt'
    return {
      metadata: {
        ...base,
        classification: code === 'legacy-media-payload' ? 'media-blocked' : 'corrupt',
        reasonCode: code,
      },
      payload: null,
    }
  }
}

async function blockedRecord(source, recordKey, revision, size, reasonCode, classification, rawRecord) {
  return {
    metadata: {
      sourceKind: source.kind,
      sourceId: source.sourceId,
      recordKey,
      domain: null,
      classification,
      schemaVersion: null,
      revision,
      size,
      checksum: await evidenceChecksumForRecord(rawRecord, source),
      status: 'blocked',
      reasonCode,
    },
    payload: null,
  }
}

function markDuplicateRecords(records) {
  const byIdentity = new Map()
  for (const record of records) {
    const metadata = record.metadata
    const identity = `${metadata.domain || '[unclaimed]'}\u0000${metadata.recordKey}`
    const group = byIdentity.get(identity) || []
    group.push(record)
    byIdentity.set(identity, group)
  }
  const duplicateIdentities = new Set(
    [...byIdentity.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([identity]) => identity),
  )
  return records.map((record) => {
    const metadata = record.metadata
    const identity = `${metadata.domain || '[unclaimed]'}\u0000${metadata.recordKey}`
    if (!duplicateIdentities.has(identity)) return record
    return {
      metadata: {
        ...metadata,
        status: 'blocked',
        reasonCode: 'legacy-duplicate-record',
      },
      payload: null,
    }
  })
}

function stripRecordMetadata(record) {
  const copy = {}
  for (const [key, value] of Object.entries(record)) {
    if (!['id', 'key', 'sourceKey', 'schemaVersion', 'revision', 'checksum', 'size', 'domain'].includes(key)) copy[key] = value
  }
  return copy
}

function readSchemaVersion(record, payload, claim, source) {
  // IndexedDB FileRow.schemaVersion is the frozen row-envelope version (1).
  // Vocabulary/SRS rows carry their domain schema in schema_version, so use
  // that marker before falling back to the envelope version for rows whose
  // current payload deliberately has no domain marker.
  if (source.kind === 'indexeddb'
    && String(record?.id || '').startsWith('vocabulary.')
    && isPlainObject(payload)
    && payload.schema_version !== undefined
    && payload.schema_version !== null) {
    return payload.schema_version
  }
  // Reader save outbox records are intentionally stored as numeric wire
  // envelopes (1 and 2), while the owner registry names those compatibility
  // schemas with stable string identifiers. Keep the raw payload unchanged,
  // but normalize the version only at this claim boundary. A key/version
  // mismatch remains unsupported and therefore still fails closed below.
  if (source.kind === 'localStorage' && isPlainObject(payload)) {
    const key = String(record?.key ?? record?.id ?? record?.sourceKey ?? '')
    if (key === READER_SAVE_OUTBOX_V1_KEY && payload.schemaVersion === 1) {
      return 'reader-save-outbox.v1'
    }
    if (key.startsWith(READER_SAVE_OUTBOX_V2_PREFIX) && payload.schemaVersion === 2) {
      return 'reader-save-outbox.v2'
    }
  }
  if (record.schemaVersion !== undefined && record.schemaVersion !== null) return record.schemaVersion
  if (isPlainObject(payload) && payload.schemaVersion !== undefined && payload.schemaVersion !== null) return payload.schemaVersion
  if (source.defaultSchemaVersion !== undefined && source.defaultSchemaVersion !== null
    && claim.schemaVersions.some((value) => String(value) === String(source.defaultSchemaVersion))) {
    return source.defaultSchemaVersion
  }
  return claim.schemaVersions[0] ?? null
}

function readRevision(record) {
  if (!record || typeof record !== 'object') return null
  const revision = record.revision
  if (typeof revision === 'string' && revision.length > 0 && revision.length <= 128 && SAFE_RECORD_KEY.test(revision)) return revision
  if (Number.isInteger(revision) && revision >= 0) return revision
  return null
}

function recordSize(record, rawValue) {
  if (Number.isFinite(record.size) && record.size >= 0) return Math.floor(record.size)
  if (typeof rawValue === 'string') return utf8ByteLength(rawValue)
  const candidate = record.payload ?? record.content ?? record.value
  if (isBinaryLike(candidate)) return binarySize(candidate)
  try { return utf8ByteLength(JSON.stringify(candidate)) } catch { return null }
}

function resolveClaim(key, requestedDomain) {
  if (requestedDomain !== undefined && requestedDomain !== null && !DOMAINS.includes(requestedDomain)) {
    return { claim: null, reasonCode: 'legacy-domain-invalid' }
  }
  const matching = CLAIMS.filter((claim) => claimKeyCandidates(key).some((candidate) => claim.matcher.test(candidate)))
  const domainMatching = requestedDomain
    ? matching.filter((claim) => claim.domain === requestedDomain)
    : matching
  if (requestedDomain && matching.length > 0 && domainMatching.length === 0) {
    return { claim: null, reasonCode: 'legacy-domain-claim-mismatch' }
  }
  const candidates = requestedDomain ? domainMatching : matching
  if (candidates.length === 0) return { claim: null, reasonCode: 'legacy-unclaimed-record' }
  const highestSpecificity = Math.max(...candidates.map((claim) => claim.specificity))
  const bestCandidates = candidates.filter((claim) => claim.specificity === highestSpecificity)
  const domains = new Set(bestCandidates.map((claim) => claim.domain))
  if (domains.size > 1) return { claim: null, reasonCode: 'legacy-ambiguous-claim' }
  return { claim: bestCandidates[0], reasonCode: null }
}

function claimKeyCandidates(key) {
  const value = String(key)
  const separator = value.indexOf(':')
  if (separator <= 0) return [value]
  const filename = value.slice(0, separator)
  if (!/^(?:reader-marks|reader-activity|reader-marks-commit-journal)\.json$/u.test(filename)) return [value]
  const workflowMarker = value.indexOf('/_workflow/', separator + 1)
  if (workflowMarker > separator) return [value, value.slice(workflowMarker + 1)]
  return [value, value.slice(separator + 1)]
}

function buildClaims() {
  const claims = new Map()
  const add = (domain, group, rawClaim) => {
    const pattern = rawClaim?.key ?? rawClaim?.keyPattern
    if (!pattern) return
    const classification = CLAIM_CLASSIFICATIONS[group]
    if (!classification) return
    const identity = `${domain}\u0000${classification}\u0000${pattern}`
    const existing = claims.get(identity)
    if (existing) {
      existing.schemaVersions = [...new Set([...existing.schemaVersions, ...(rawClaim.schemaVersions || [])])]
      return
    }
    claims.set(identity, {
      domain,
      classification,
      pattern: String(pattern),
      matcher: claimMatcher(String(pattern)),
      specificity: String(pattern).includes('*') || String(pattern).includes('<') ? String(pattern).length : 10000 + String(pattern).length,
      schemaVersions: [...(rawClaim.schemaVersions || [])],
    })
  }
  for (const registration of ownerRegistry.registrations || []) {
    for (const group of ['canonicalRecords', 'compatibilityRecords', 'nonCanonicalRecords']) {
      for (const claim of registration[group] || []) add(registration.domain, group, claim)
    }
  }
  for (const inventory of domainInventory.domains || []) {
    for (const group of ['canonicalRecords', 'compatibilityKeys', 'ephemeralOrPreferenceKeys']) {
      for (const claim of inventory[group] || []) {
        add(inventory.domain, group, {
          ...claim,
          schemaVersions: claim.schemaVersions || [claim.schemaVersion],
        })
      }
    }
  }
  const sourcePolicies = buildSourcePolicies()
  return [...claims.values()].map((claim) => {
    const policies = sourcePolicies.filter((policy) => policy.domain === claim.domain && patternsOverlap(claim.pattern, policy.pattern))
    return {
      ...claim,
      allowedSourceKinds: [...new Set(policies.flatMap((policy) => policy.allowedSourceKinds))],
      allowedSourceIds: [...new Set(policies.flatMap((policy) => policy.allowedSourceIds))],
    }
  })
}

function buildSourcePolicies() {
  const policies = []
  for (const inventory of domainInventory.domains || []) {
    for (const group of ['canonicalRecords', 'compatibilityKeys', 'ephemeralOrPreferenceKeys']) {
      for (const claim of inventory[group] || []) {
        const pattern = claim.key ?? claim.keyPattern
        if (!pattern) continue
        const policy = sourcePolicyForStorage(claim.storage)
        policies.push({
          domain: inventory.domain,
          pattern: String(pattern),
          allowedSourceKinds: policy.allowedSourceKinds,
          allowedSourceIds: policy.allowedSourceIds,
        })
      }
    }
  }
  return policies
}

function sourcePolicyForStorage(storage) {
  const text = String(storage || '').toLowerCase()
  const allowedSourceKinds = new Set()
  const allowedSourceIds = new Set()
  if (text.includes('seekplayerdb/files')) {
    allowedSourceKinds.add('indexeddb')
    allowedSourceIds.add('SeekPlayerDB/files')
  }
  if (text.includes('localstorage')) allowedSourceKinds.add('localStorage')
  if (text.includes('json') || text.includes('raw ') || text.includes('output') || text.includes('projection')
    || text.includes('audio-folder') || text.includes('authorized output') || text.includes('embedded migration')) {
    allowedSourceKinds.add('json')
  }
  return {
    allowedSourceKinds: [...allowedSourceKinds],
    allowedSourceIds: [...allowedSourceIds],
  }
}

function patternsOverlap(leftPattern, rightPattern) {
  const leftMatcher = claimMatcher(leftPattern)
  const rightMatcher = claimMatcher(rightPattern)
  return leftMatcher.test(patternRepresentative(rightPattern)) || rightMatcher.test(patternRepresentative(leftPattern))
}

function patternRepresentative(pattern) {
  return String(pattern).replace(/\*|<[^>]+>/gu, 'sample')
}

function claimSourceAllows(claim, source) {
  if (!claim.allowedSourceKinds?.length) return false
  if (!claim.allowedSourceKinds.includes(source.kind)) return false
  return !claim.allowedSourceIds?.length || claim.allowedSourceIds.includes(source.sourceId) || source.kind !== 'indexeddb'
}

function claimSourceReason(claim, source) {
  if (!claim.allowedSourceKinds?.length) return 'legacy-source-binding-missing'
  if (!claim.allowedSourceKinds.includes(source.kind)) return 'legacy-source-kind-mismatch'
  return 'legacy-source-id-mismatch'
}

function registeredDomain(value) {
  return DOMAINS.includes(value) ? value : null
}

function claimMatcher(pattern) {
  const tokens = []
  const tokenized = pattern.replace(/\*|<[^>]+>/gu, (token) => {
    const marker = `__WINDOWS_OWNER_LEGACY_TOKEN_${tokens.length}__`
    tokens.push(token === '*' ? '.*' : '[^:]+')
    return marker
  })
  let expression = tokenized.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  tokens.forEach((token, index) => {
    expression = expression.replace(`__WINDOWS_OWNER_LEGACY_TOKEN_${index}__`, token)
  })
  return new RegExp(`^${expression}$`, 'u')
}

function compareRecordMetadata(left, right) {
  return compareMetadata(left.metadata, right.metadata)
}

function compareSources(left, right) {
  const kindOrder = new Map(SOURCE_KINDS.map((kind, index) => [kind, index]))
  const kindDifference = kindOrder.get(left.kind) - kindOrder.get(right.kind)
  return kindDifference || compareCodePoint(left.sourceId, right.sourceId)
}

async function withInventoryChecksum(snapshot, profileId) {
  const sources = snapshot.sources.map((source) => ({
    sourceKind: source.source.kind,
    sourceId: source.source.sourceId,
    schema: source.schema,
    status: source.status,
    reasonCode: source.reasonCode,
    recordCount: source.records.length,
    records: source.records.map((record) => record.metadata).sort(compareMetadata),
    checksum: source.checksum,
  }))
  const sourceRecords = sources.flatMap((source) => source.records)
  const duplicateEvidence = findDuplicateImportMetadata(sourceRecords)
  const duplicateIdentities = new Set(duplicateEvidence.map(importIdentityForMetadata))
  const records = sourceRecords
    .map((metadata) => duplicateIdentities.has(importIdentityForMetadata(metadata))
      ? { ...metadata, status: 'blocked', reasonCode: 'legacy-duplicate-record' }
      : metadata)
    .sort(compareMetadata)
  const base = {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    bridge: BRIDGE_NAME,
    mode: 'read-only-inventory',
    profileId,
    status: sources.some((source) => source.status === 'blocked') || duplicateEvidence.length > 0 ? 'blocked' : 'ready',
    reasonCode: sources.find((source) => source.reasonCode)?.reasonCode || duplicateEvidence[0]?.reasonCode || null,
    frozenIndexedDbSchema: FROZEN_INDEXED_DB_SCHEMA,
    sources,
    records,
    duplicateRecords: duplicateEvidence,
  }
  return {
    ...base,
    checksum: await digestCanonical(base),
  }
}

function findDuplicateImportMetadata(records) {
  const groups = new Map()
  for (const record of records) {
    const metadata = record.metadata || record
    if (metadata.status !== 'ready' || !ALLOWED_IMPORT_CLASSIFICATIONS.has(metadata.classification)) continue
    const identity = importIdentityForMetadata(metadata)
    const group = groups.get(identity) || []
    group.push(metadata)
    groups.set(identity, group)
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) => group.map((metadata) => ({
      ...metadata,
      status: 'blocked',
      reasonCode: 'legacy-duplicate-record',
    })))
    .sort(compareMetadata)
}

function importIdentityForMetadata(metadata) {
  return `${metadata.domain || '[unclaimed]'}\u0000${metadata.recordKey}`
}

function compareMetadata(left, right) {
  for (const [leftValue, rightValue] of [
    [left.sourceKind, right.sourceKind],
    [left.sourceId, right.sourceId],
    [left.recordKey, right.recordKey],
  ]) {
    const difference = compareCodePoint(leftValue, rightValue)
    if (difference !== 0) return difference
  }
  return compareCodePoint(canonicalJson(left), canonicalJson(right))
}

function firstReasonCode(snapshot, blocked) {
  return snapshot.sources.find((source) => source.reasonCode)?.reasonCode
    || blocked[0]?.metadata.reasonCode
    || null
}

async function evidenceChecksumForRecord(rawRecord, source) {
  const evidence = await evidenceProjection(rawRecord, [])
  return digestCanonical({
    schemaVersion: 'legacy-record-evidence.v1',
    sourceKind: source.kind,
    sourceId: source.sourceId,
    recordKey: String(rawRecord?.key ?? rawRecord?.id ?? rawRecord?.sourceKey ?? '[redacted-record]'),
    evidence,
  })
}

async function evidenceProjection(value, path) {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : { type: 'non-finite-number' }
  if (value === undefined) return { type: 'undefined' }
  if (typeof value !== 'object') return { type: typeof value }
  if (isBinaryLike(value)) return { type: binaryType(value), fingerprint: await binaryEvidenceFingerprint(value) }
  if (path.includes(value)) return { type: 'cycle' }
  const nextPath = [...path, value]
  if (Array.isArray(value)) return Promise.all(value.map((item) => evidenceProjection(item, nextPath)))
  const result = {}
  for (const key of Object.keys(value).sort(compareCodePoint)) {
    let child
    try { child = value[key] } catch { child = { type: 'unreadable-value' } }
    if (SENSITIVE_KEY.test(key) || MEDIA_PAYLOAD_KEY.test(key)) {
      result[key] = { type: 'opaque-value', fingerprint: await opaqueEvidenceFingerprint(child) }
    } else {
      result[key] = await evidenceProjection(child, nextPath)
    }
  }
  return result
}

async function opaqueEvidenceFingerprint(value) {
  if (typeof value === 'string') return digestTextEvidence(value)
  if (isBinaryLike(value)) return binaryEvidenceFingerprint(value)
  return digestCanonical(await evidenceProjection(value, []))
}

async function digestTextEvidence(value) {
  if (value.length <= MAX_EVIDENCE_SAMPLE_CHARS) return digestBytes(new TextEncoder().encode(value))
  const first = new TextEncoder().encode(value.slice(0, MAX_EVIDENCE_SAMPLE_CHARS / 2))
  const last = new TextEncoder().encode(value.slice(-MAX_EVIDENCE_SAMPLE_CHARS / 2))
  return digestCanonical({
    type: 'sampled-string',
    length: value.length,
    first: await digestBytes(first),
    last: await digestBytes(last),
  })
}

async function binaryEvidenceFingerprint(value) {
  const byteLength = binaryByteLength(value)
  try {
    const samples = await binaryEvidenceSamples(value)
    return {
      type: binaryType(value),
      byteLength,
      first: await digestBytes(samples.first),
      last: await digestBytes(samples.last),
      sampled: byteLength > MAX_EVIDENCE_SAMPLE_BYTES,
    }
  } catch {
    return { type: binaryType(value), byteLength, sampled: true, read: 'unavailable' }
  }
}

async function binaryEvidenceSamples(value) {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    const firstEnd = Math.min(value.size, MAX_EVIDENCE_SAMPLE_BYTES)
    const lastStart = Math.max(0, value.size - MAX_EVIDENCE_SAMPLE_BYTES)
    return {
      first: new Uint8Array(await value.slice(0, firstEnd).arrayBuffer()),
      last: new Uint8Array(await value.slice(lastStart, value.size).arrayBuffer()),
    }
  }
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return {
    first: bytes.subarray(0, Math.min(bytes.byteLength, MAX_EVIDENCE_SAMPLE_BYTES)),
    last: bytes.subarray(Math.max(0, bytes.byteLength - MAX_EVIDENCE_SAMPLE_BYTES)),
  }
}

function binaryByteLength(value) {
  if (typeof value?.size === 'number') return value.size
  if (typeof value?.byteLength === 'number') return value.byteLength
  return null
}

function binaryType(value) {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return 'blob'
  if (value instanceof ArrayBuffer) return 'arraybuffer'
  return 'typed-array'
}

function cloneSafeValue(value, path, options = {}) {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (MEDIA_DATA_URI.test(value) || MEDIA_BASE64_PREFIX.test(value)) {
      throw bridgeError('legacy-media-payload', 'Legacy media payload is outside the compatibility bridge')
    }
    if (hasSensitiveUrlMaterial(value)) {
      throw bridgeError('legacy-sensitive-value', 'Legacy sensitive URL material is outside the compatibility bridge')
    }
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw bridgeError('legacy-record-corrupt', 'Legacy record has a non-finite number')
    return value
  }
  if (typeof value !== 'object') throw bridgeError('legacy-record-corrupt', 'Legacy record is not JSON-safe')
  if (isBinaryLike(value)) throw bridgeError('legacy-media-payload', 'Legacy media bytes are outside the compatibility bridge')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    throw bridgeError('legacy-record-corrupt', 'Legacy raw handle is outside the compatibility bridge')
  }
  if (path.includes(value)) throw bridgeError('legacy-record-corrupt', 'Legacy record contains a cycle')
  const nextPath = [...path, value]
  if (Array.isArray(value)) return value.map((item) => cloneSafeValue(item, nextPath, options))
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)
      && !(options.allowVocabularySettlementAttemptToken === true && key === 'attempt_token')) {
      throw bridgeError('legacy-sensitive-field', 'Legacy sensitive fields are not importable')
    }
    if (isMediaPayloadField(key, child)) throw bridgeError('legacy-media-payload', 'Legacy media bytes are outside the compatibility bridge')
    result[key] = cloneSafeValue(child, nextPath, options)
  }
  return result
}

function isMediaPayloadField(key, value) {
  if (!MEDIA_PAYLOAD_KEY.test(key)) return false
  // Workflow integrity envelopes use a numeric `bytes` field as file-size
  // metadata. Preserve that safe identity/size evidence; any non-numeric
  // value under the same key remains blocked, as do all actual media fields.
  return !(String(key).toLowerCase() === 'bytes'
    && Number.isSafeInteger(value)
    && value >= 0)
}

function hasSensitiveUrlMaterial(value) {
  if (!/^(?:https?:|wss?:|\/\/)/iu.test(value)) return false
  try {
    const url = new URL(value, 'http://windows-owner-legacy.invalid')
    if (url.username || url.password) return true
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_URL_QUERY.test(key)) return true
    }
  } catch {
    return false
  }
  return false
}

function isBinaryLike(value) {
  return (typeof Blob !== 'undefined' && value instanceof Blob)
    || (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)
    || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value))
}

function binarySize(value) {
  if (typeof value?.size === 'number') return value.size
  if (typeof value?.byteLength === 'number') return value.byteLength
  return null
}

function safeFingerprint(value) {
  return typeof value === 'string' && SAFE_FINGERPRINT.test(value) ? value : null
}

function isLegacyLocalStorageKey(key) {
  return LEGACY_LOCAL_STORAGE_SCOPE_PREFIXES.some((prefix) => key.startsWith(prefix))
    || CLAIMS.some((claim) => claim.matcher.test(key))
}

function safeRecordKey(value) {
  return typeof value === 'string' && SAFE_RECORD_KEY.test(value) && !isAbsolutePath(value)
}

function isAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/u.test(String(value)) || /^[/\\]{2}/u.test(String(value)) || /^[/\\]/u.test(String(value))
}

function requireSourceId(value, field) {
  if (typeof value !== 'string' || !SAFE_SOURCE_ID.test(value) || value.includes('..') || isAbsolutePath(value)) {
    throw bridgeError('legacy-source-identity-invalid', `${field} is not a safe legacy identity`)
  }
  return value
}

function requireSourceIdList(value, field) {
  if (!Array.isArray(value) || value.length === 0) throw bridgeError('legacy-source-list-invalid', `${field} must be a non-empty list`)
  return [...new Set(value.map((item) => requireSourceId(item, field)))]
}

function requireRecordKey(value, field) {
  if (!safeRecordKey(value)) throw bridgeError('legacy-record-key-invalid', `${field} is not a safe legacy record identity`)
  return String(value)
}

function requireDomain(value) {
  if (!DOMAINS.includes(value)) throw bridgeError('legacy-domain-invalid', 'Legacy domain is not registered')
  return value
}

function findSourceIdentity(sourceId, sourceById) {
  const matches = [...sourceById.keys()].filter((identity) => identity.endsWith(`:${sourceId}`))
  if (matches.length !== 1) return ''
  return matches[0]
}

function utf8ByteLength(value) {
  try { return new TextEncoder().encode(String(value)).byteLength } catch { return String(value).length }
}

async function digestCanonical(value) {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.subtle) throw bridgeError('legacy-checksum-unavailable', 'Web Crypto is required for compatibility evidence')
  const bytes = new TextEncoder().encode(canonicalJson(value))
  return digestBytes(bytes)
}

async function digestBytes(bytes) {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.subtle) throw bridgeError('legacy-checksum-unavailable', 'Web Crypto is required for compatibility evidence')
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  return `{${Object.keys(value).sort(compareCodePoint).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function compareCodePoint(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) freezeDeep(child, seen)
  return Object.freeze(value)
}

function bridgeError(code, message) {
  return new WindowsOwnerLegacyBridgeError(code, message)
}
