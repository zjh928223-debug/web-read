import {
  APPLICATION_BACKUP_REQUIRED_DOMAINS,
  createApplicationBackupService,
  createIndexedDbDomainAdapter,
} from './application-backup.js'

const READER_SESSION_ROW_IDS = new Set(['audioMeta', 'transcript', 'chunkData', 'marks', 'readerSession'])
const VOCABULARY_ROW_PREFIX = 'vocabulary.'
const ANNOTATION_STORAGE_PREFIX = 'AnnotationGenerationStorage::'
const READER_SAVE_OUTBOX_V1_KEY = 'read-web.reader-save-outbox.v1'
const READER_SAVE_OUTBOX_V2_PREFIX = 'read-web.reader-save-outbox.v2.'
const READER_SAVE_OUTBOX_QUARANTINE_PREFIX = 'read-web.reader-save-outbox-quarantine.v1.'
const READER_SAVE_OUTBOX_LEGACY_QUARANTINE_KEY = `${READER_SAVE_OUTBOX_V1_KEY}.quarantine`
const READER_SAVE_OUTBOX_NAMESPACE = 'read-web.reader-save-outbox.'
const OUTBOX_QUARANTINE_RECOVERY_SCHEMA = 1
const OUTBOX_QUARANTINE_RECOVERY_ALGORITHM = 'AES-256-GCM'
const OUTBOX_QUARANTINE_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const PASSAGE_PREVIEW_STORAGE_KEYS = Object.freeze([
  { key: 'vocabulary.passage-preview.durable-state.v1', schemaVersion: 'passage-preview.durable-state.v1', requiredRevision: true },
  { key: 'vocabulary.passage-preview.data.v2', schemaVersion: 'passage-preview.local-data.v2', allowLegacyValue: true },
  { key: 'vocabulary.passage-preview.progress.v2', schemaVersion: 'passage-preview.local-progress.v2', allowLegacyValue: true },
  { key: 'vocabulary.passage-preview.data.v1', schemaVersion: 'passage-preview.legacy-data.v1', allowLegacyValue: true },
  { key: 'vocabulary.passage-preview.progress.v1', schemaVersion: 'passage-preview.legacy-progress.v1', allowLegacyValue: true },
  { key: 'vocabulary.passage-preview.session-cache.v1', schemaVersion: 'passage-preview.session-cache.v1' },
  { key: 'vocabulary.passage-preview.shortcuts.v2', schemaVersion: 'passage-preview.shortcuts.v2' },
  { key: 'vocabulary.passage-preview.shortcut.translation.v1', schemaVersion: 'passage-preview.shortcut.v1', rawText: true },
  { key: 'vocabulary.passage-preview.shortcut.context.v1', schemaVersion: 'passage-preview.shortcut.v1', rawText: true },
  { key: 'vocabulary.passage-preview.translation-display-mode.v1', schemaVersion: 'passage-preview.display-mode.v1', rawText: true },
  { key: 'vocabulary.passage-preview.acquisition.v1', schemaVersion: 'passage-preview.acquisition.v1' },
  { key: 'vocabulary.ielts-daily-preview.allocations.v1', schemaVersion: 'ielts-preview.allocations.v1' },
  { key: 'vocabulary.ielts-daily-preview.continuation.v1', schemaVersion: 'ielts-preview.continuation.v1' },
  { key: 'vocabulary.ielts-daily-preview.archive.v1', schemaVersion: 'ielts-preview.archive.v1' },
])

export { APPLICATION_BACKUP_REQUIRED_DOMAINS }

export const READ_WEB_READER_SAVE_OUTBOX_KEYS = Object.freeze({
  v1: READER_SAVE_OUTBOX_V1_KEY,
  v2Prefix: READER_SAVE_OUTBOX_V2_PREFIX,
  quarantinePrefix: READER_SAVE_OUTBOX_QUARANTINE_PREFIX,
})

export function createReaderSaveOutboxQuarantineProtector(options = {}) {
  const keyMaterial = options.key
  const hasKeyId = Object.prototype.hasOwnProperty.call(options, 'keyId')
  const rawKeyId = String(options.keyId ?? '')
  const keyId = rawKeyId.trim()
  if (hasKeyId && (rawKeyId !== keyId || !OUTBOX_QUARANTINE_KEY_ID_PATTERN.test(keyId))) {
    throw outboxError(
      'BACKUP_READER_OUTBOX_QUARANTINE_KEY_ID_INVALID',
      'Reader outbox quarantine keyId must be a short ASCII safety label, not a path or URL',
    )
  }
  return {
    async encrypt(rawValue, metadata) {
      if (!keyMaterial || !keyId) {
        throw outboxError(
          'BACKUP_READER_OUTBOX_QUARANTINE_KEY_REQUIRED',
          'Recoverable reader outbox quarantine export requires an encryption key and keyId',
        )
      }
      const cryptoApi = getQuarantineCrypto()
      const key = await importQuarantineKey(cryptoApi, keyMaterial)
      const iv = new Uint8Array(12)
      cryptoApi.getRandomValues(iv)
      const normalizedMetadata = normalizeQuarantineMetadata(metadata)
      const ciphertext = await cryptoApi.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: quarantineAssociatedData(normalizedMetadata) },
        key,
        new TextEncoder().encode(String(rawValue)),
      )
      return {
        schemaVersion: OUTBOX_QUARANTINE_RECOVERY_SCHEMA,
        strategy: 'encrypted-sensitive-sidecar',
        algorithm: OUTBOX_QUARANTINE_RECOVERY_ALGORITHM,
        keyId,
        ...normalizedMetadata,
        iv: encodeQuarantineBase64(new Uint8Array(iv)),
        ciphertext: encodeQuarantineBase64(new Uint8Array(ciphertext)),
      }
    },
    async decrypt(envelope) {
      if (!keyMaterial || !keyId) {
        throw outboxError(
          'BACKUP_READER_OUTBOX_QUARANTINE_KEY_REQUIRED',
          'Reader outbox quarantine decryption requires an encryption key and keyId',
        )
      }
      validateQuarantineRecoveryEnvelope(envelope)
      if (envelope.keyId !== keyId) {
        throw outboxError('BACKUP_READER_OUTBOX_QUARANTINE_KEY_MISMATCH', 'Reader outbox quarantine keyId does not match')
      }
      const cryptoApi = getQuarantineCrypto()
      const key = await importQuarantineKey(cryptoApi, keyMaterial)
      try {
        const plaintext = await cryptoApi.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: decodeQuarantineBase64(envelope.iv),
            additionalData: quarantineAssociatedData(normalizeQuarantineMetadata(envelope)),
          },
          key,
          decodeQuarantineBase64(envelope.ciphertext),
        )
        return new TextDecoder().decode(plaintext)
      } catch (error) {
        throw outboxError('BACKUP_READER_OUTBOX_QUARANTINE_DECRYPT_FAILED', 'Reader outbox quarantine decryption failed', { cause: error?.code })
      }
    },
  }
}

/**
 * Assemble the six durable domains used by Read-Web. Low-level callers may
 * provide the two cross-process adapters (marks/activity and workflow), but
 * production callers should use the public production composition, which
 * wires both owners and never treats a missing adapter as an empty domain.
 */
export function createReadWebApplicationBackupAdapters(options = {}) {
  const explicit = options.adapters || {}
  const persistence = options.applicationPersistence
  const readRows = options.readRows
    || (persistence && typeof persistence.getAllRows === 'function' ? () => persistence.getAllRows() : null)
  const storage = options.storage || globalThis.localStorage
  const claimedRow = typeof options.isClaimedIndexedDbRow === 'function'
    ? options.isClaimedIndexedDbRow
    : (row) => READER_SESSION_ROW_IDS.has(row?.id)
      || String(row?.id || '').startsWith('readerSessionQuarantine:')
      || String(row?.id || '').startsWith(VOCABULARY_ROW_PREFIX)
  const assertRowsConsumed = async (rows) => {
    const unclaimed = rows.find((row) => !claimedRow(row))
    if (!unclaimed) return
    const error = new Error('IndexedDB row is not registered with an application backup domain')
    error.code = String(unclaimed?.id || '').toLowerCase() === 'audio'
      ? 'BACKUP_MEDIA_PAYLOAD_REJECTED'
      : 'BACKUP_UNCLAIMED_PERSISTENCE_ROW'
    throw error
  }

  const indexedDbReaderSessionAdapter = readRows
    ? createIndexedDbDomainAdapter({
            domainKey: 'reader-session',
            schemaVersion: 1,
            readRows,
            assertRows: assertRowsConsumed,
            rowFilter: (row) => READER_SESSION_ROW_IDS.has(row?.id)
              || String(row?.id || '').startsWith('readerSessionQuarantine:'),
          })
    : null
  const readerOutboxAdapter = storage ? createReaderSaveOutboxDomainAdapter({
    storage,
    quarantineProtector: options.readerSaveOutboxQuarantineProtector || options.outboxQuarantineProtector,
  }) : null
  const readerSessionAdapter = explicit['reader-session']
    ? (readerOutboxAdapter
        ? combineDomainAdapters(explicit['reader-session'], readerOutboxAdapter, 'reader-session')
        : null)
    : (indexedDbReaderSessionAdapter && readerOutboxAdapter
        ? combineDomainAdapters(indexedDbReaderSessionAdapter, readerOutboxAdapter, 'reader-session')
        : (indexedDbReaderSessionAdapter || readerOutboxAdapter || null))

  const adapters = {
    'reader-session': readerSessionAdapter,
    'marks-activity': explicit['marks-activity'] || options.marksActivityAdapter || null,
    'vocabulary-srs': explicit['vocabulary-srs'] || (
      readRows
        ? createIndexedDbDomainAdapter({
            domainKey: 'vocabulary-srs',
            schemaVersion: 1,
            readRows,
            assertRows: assertRowsConsumed,
            rowFilter: (row) => String(row?.id || '').startsWith(VOCABULARY_ROW_PREFIX),
          })
        : null
    ),
    'passage-preview': explicit['passage-preview'] || (
      storage
        ? createLocalStorageCollectionDomainAdapter({
            domainKey: 'passage-preview',
            storage,
            keySpecs: PASSAGE_PREVIEW_STORAGE_KEYS,
            prefixes: ['vocabulary.passage-preview.', 'vocabulary.ielts-daily-preview.'],
            rejectUnknownKeys: true,
          })
        : null
    ),
    'annotation': explicit['annotation'] || (
      storage ? createLocalStorageCollectionDomainAdapter({
        domainKey: 'annotation',
        storage,
        prefix: ANNOTATION_STORAGE_PREFIX,
        schemaVersion: 1,
      }) : null
    ),
    'workflow': explicit['workflow'] || options.workflowAdapter || null,
  }
  return adapters
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function outboxError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, details)
  return error
}

function safeOutboxText(value, maxLength = 200) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && !/[\\/]/.test(value)
    && !/[\u0000-\u001f]/.test(value)
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function outboxKeyPart(value) {
  return Array.from(String(value || ''))
    .map((character) => character.codePointAt(0).toString(16))
    .join('_')
}

function getQuarantineCrypto() {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== 'function') {
    throw outboxError('BACKUP_READER_OUTBOX_QUARANTINE_CRYPTO_UNAVAILABLE', 'Web Crypto AES-GCM is required for reader outbox quarantine recovery')
  }
  return cryptoApi
}

function encodeQuarantineBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  if (typeof btoa !== 'function') throw outboxError('BACKUP_READER_OUTBOX_QUARANTINE_CRYPTO_UNAVAILABLE', 'Base64 encoding is unavailable')
  return btoa(binary)
}

function decodeQuarantineBase64(value) {
  if (typeof value !== 'string' || typeof atob !== 'function') {
    throw outboxError('BACKUP_READER_OUTBOX_QUARANTINE_CORRUPT', 'Encrypted reader outbox quarantine base64 is invalid')
  }
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw outboxError('BACKUP_READER_OUTBOX_QUARANTINE_CORRUPT', 'Encrypted reader outbox quarantine base64 is invalid')
  }
}

async function importQuarantineKey(cryptoApi, keyMaterial) {
  if (keyMaterial && typeof keyMaterial === 'object' && keyMaterial.type === 'secret') return keyMaterial
  let bytes
  if (typeof keyMaterial === 'string') bytes = new TextEncoder().encode(keyMaterial)
  else if (keyMaterial instanceof Uint8Array) bytes = keyMaterial
  else if (keyMaterial instanceof ArrayBuffer) bytes = new Uint8Array(keyMaterial)
  else if (ArrayBuffer.isView(keyMaterial)) bytes = new Uint8Array(keyMaterial.buffer, keyMaterial.byteOffset, keyMaterial.byteLength)
  else throw outboxError('BACKUP_READER_OUTBOX_QUARANTINE_KEY_REQUIRED', 'Reader outbox quarantine key material is invalid')
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes)
  return cryptoApi.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function normalizeQuarantineMetadata(value = {}) {
  const sourceKey = String(value.sourceKey || '')
  const detectedAt = String(value.detectedAt || '')
  const rawReason = String(value.reason || '')
  const reason = /^[A-Za-z0-9_.:-]{1,160}$/.test(rawReason) ? rawReason : '[REDACTED_REASON]'
  if (!sourceKey || sourceKey.length > 512 || /[\u0000-\u001f]/.test(sourceKey)
    || !detectedAt || detectedAt.length > 128) {
    throw outboxError('BACKUP_READER_OUTBOX_QUARANTINE_CORRUPT', 'Reader outbox quarantine metadata is invalid')
  }
  return { sourceKey, detectedAt, reason }
}

function quarantineAssociatedData(metadata) {
  return new TextEncoder().encode(JSON.stringify(normalizeQuarantineMetadata(metadata)))
}

function validateQuarantineRecoveryEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== OUTBOX_QUARANTINE_RECOVERY_SCHEMA
    || value.strategy !== 'encrypted-sensitive-sidecar'
    || value.algorithm !== OUTBOX_QUARANTINE_RECOVERY_ALGORITHM
    || typeof value.keyId !== 'string' || !value.keyId
    || typeof value.iv !== 'string' || typeof value.ciphertext !== 'string'
    || Object.prototype.hasOwnProperty.call(value, 'rawValue')) {
    throw outboxError('BACKUP_READER_OUTBOX_QUARANTINE_CORRUPT', 'Encrypted reader outbox quarantine envelope is invalid')
  }
  if (!OUTBOX_QUARANTINE_KEY_ID_PATTERN.test(value.keyId)) {
    throw outboxError('BACKUP_READER_OUTBOX_QUARANTINE_CORRUPT', 'Encrypted reader outbox quarantine keyId is unsafe')
  }
  normalizeQuarantineMetadata(value)
  return value
}

function expectedOutboxEntryKey(entry) {
  return `${READER_SAVE_OUTBOX_V2_PREFIX}${outboxKeyPart(entry.jobId)}.${entry.kind}.${outboxKeyPart(entry.operationId)}`
}

function validOutboxEntry(entry) {
  if (!isPlainObject(entry)
    || !hasOnlyKeys(entry, ['jobId', 'kind', 'operationId', 'expectedRevision', 'intent'])
    || !safeOutboxText(entry.jobId)
    || !['marks', 'activity'].includes(entry.kind)
    || !safeOutboxText(entry.operationId)
    || !Number.isInteger(entry.expectedRevision)
    || entry.expectedRevision < 0
    || !isPlainObject(entry.intent)) return false
  if (entry.kind === 'marks') {
    return hasOnlyKeys(entry.intent, ['marks'])
      && Array.isArray(entry.intent.marks)
      && entry.intent.marks.every((mark) => isPlainObject(mark)
        && hasOnlyKeys(mark, ['globalIndex', 'word', 'start', 'sourceType'])
        && Number.isInteger(mark.globalIndex)
        && mark.globalIndex >= 0
        && typeof mark.word === 'string'
        && typeof mark.sourceType === 'string'
        && (mark.start === null || Number.isFinite(mark.start)))
  }
  return hasOnlyKeys(entry.intent, [
    'event',
    'sessionId',
    'sessionStartedAt',
    'positionSeconds',
    'durationSeconds',
    'intervals',
    'coverageRatio',
    'markCount',
  ])
    && typeof entry.intent.event === 'string'
    && typeof entry.intent.sessionId === 'string'
    && typeof entry.intent.sessionStartedAt === 'string'
    && Number.isFinite(entry.intent.positionSeconds)
    && Number.isFinite(entry.intent.durationSeconds)
    && Number.isFinite(entry.intent.coverageRatio)
    && Number.isInteger(entry.intent.markCount)
    && entry.intent.markCount >= 0
    && Array.isArray(entry.intent.intervals)
    && entry.intent.intervals.every((interval) => Array.isArray(interval)
      && interval.length === 2
      && interval.every((value) => Number.isFinite(value)))
}

function parseOutboxJson(raw, key) {
  try {
    return JSON.parse(raw)
  } catch {
    throw outboxError('BACKUP_READER_OUTBOX_CORRUPT', `Reader save outbox key ${key} contains malformed JSON`, { key })
  }
}

function createOutboxRecord(id, schemaVersion, entry, sourceKey) {
  return {
    id,
    schemaVersion,
    revision: entry.expectedRevision ?? 0,
    contentId: entry.jobId ?? null,
    payload: schemaVersion === 1 ? { schemaVersion: 1, ...entry } : entry,
    references: entry.jobId ? [{ type: 'workflow-job', id: entry.jobId }] : [],
    mediaReferences: [],
    sourceKey,
  }
}

async function parseOutboxQuarantine(raw, key, quarantineProtector) {
  const value = parseOutboxJson(raw, key)
  if (!isPlainObject(value)
    || value.schemaVersion !== 1
    || !safeOutboxText(value.sourceKey, 512)
    || typeof value.detectedAt !== 'string'
    || typeof value.reason !== 'string'
    || (typeof value.rawValue !== 'string' && !isPlainObject(value.recovery))) {
    throw outboxError('BACKUP_READER_OUTBOX_CORRUPT', `Reader save outbox quarantine ${key} is invalid`, { key })
  }
  const metadata = normalizeQuarantineMetadata({
    sourceKey: value.sourceKey,
    detectedAt: value.detectedAt,
    reason: value.reason,
  })
  let recovery = value.recovery
  if (recovery) {
    validateQuarantineRecoveryEnvelope(recovery)
  } else if (typeof quarantineProtector?.encrypt !== 'function') {
    throw outboxError(
      'BACKUP_READER_OUTBOX_QUARANTINE_UNRECOVERABLE',
      `Reader save outbox quarantine ${key} requires an encryption protector; raw evidence remains in the source profile`,
      { key },
    )
  } else {
    recovery = await quarantineProtector.encrypt(value.rawValue, metadata)
  }
  validateQuarantineRecoveryEnvelope(recovery)
  return {
    id: `reader-save-outbox:quarantine:${key}`,
    schemaVersion: 'reader-save-outbox-quarantine.v1',
    revision: 0,
    contentId: null,
    payload: {
      schemaVersion: 1,
      ...metadata,
      recovery,
    },
    references: [{
      type: 'reader-save-outbox-quarantine',
      sourceKey: metadata.sourceKey,
      strategy: recovery.strategy,
      keyId: recovery.keyId,
    }],
    mediaReferences: [],
    sourceKey: key,
  }
}

function createReaderSaveOutboxDomainAdapter(options = {}) {
  const storage = options.storage
  const quarantineProtector = options.quarantineProtector
  if (!storage || typeof storage.getItem !== 'function') {
    throw outboxError('BACKUP_STORAGE_UNAVAILABLE', 'Reader save outbox adapter requires storage')
  }
  return {
    key: 'reader-save-outbox',
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      const allKeys = []
      const storageLength = Number(storage.length) || 0
      for (let index = 0; index < storageLength; index += 1) {
        const key = storage.key?.(index)
        if (key) allKeys.push(key)
      }
      const keys = []
      for (const key of allKeys) {
        if (key === READER_SAVE_OUTBOX_V1_KEY
          || key === READER_SAVE_OUTBOX_LEGACY_QUARANTINE_KEY
          || key?.startsWith(READER_SAVE_OUTBOX_V2_PREFIX)
          || key?.startsWith(READER_SAVE_OUTBOX_QUARANTINE_PREFIX)) keys.push(key)
      }
      const unknownKey = allKeys.find((key) => key.startsWith(READER_SAVE_OUTBOX_NAMESPACE) && !keys.includes(key))
      if (unknownKey) {
        throw outboxError('BACKUP_READER_OUTBOX_UNKNOWN_SCHEMA', `Reader save outbox key ${unknownKey} is not registered`, { key: unknownKey })
      }
      const records = []
      if (keys.includes(READER_SAVE_OUTBOX_V1_KEY)) {
        const key = READER_SAVE_OUTBOX_V1_KEY
        const envelope = parseOutboxJson(storage.getItem(key) || '', key)
        if (!isPlainObject(envelope)
          || !hasOnlyKeys(envelope, ['schemaVersion', 'entries'])
          || envelope.schemaVersion !== 1
          || !Array.isArray(envelope.entries)
          || !envelope.entries.every(validOutboxEntry)) {
          throw outboxError('BACKUP_READER_OUTBOX_UNKNOWN_SCHEMA', `Reader save outbox key ${key} has an unknown or invalid envelope`, { key })
        }
        envelope.entries.forEach((entry) => records.push(createOutboxRecord(
          `reader-save-outbox:v1:${entry.kind}:${entry.operationId}`,
          1,
          entry,
          key,
        )))
      }
      for (const key of keys.filter((candidate) => candidate.startsWith(READER_SAVE_OUTBOX_V2_PREFIX)).sort()) {
        const record = parseOutboxJson(storage.getItem(key) || '', key)
        if (!isPlainObject(record)
          || !hasOnlyKeys(record, ['schemaVersion', 'jobId', 'kind', 'operationId', 'expectedRevision', 'intent'])
          || record.schemaVersion !== 2) {
          throw outboxError('BACKUP_READER_OUTBOX_UNKNOWN_SCHEMA', `Reader save outbox key ${key} has an unknown schema`, { key })
        }
        const { schemaVersion, ...entry } = record
        if (!validOutboxEntry(entry)) {
          throw outboxError('BACKUP_READER_OUTBOX_CORRUPT', `Reader save outbox key ${key} is invalid`, { key })
        }
        if (expectedOutboxEntryKey(entry) !== key) {
          throw outboxError('BACKUP_READER_OUTBOX_CORRUPT', `Reader save outbox key ${key} does not match its entry identity`, { key })
        }
        records.push(createOutboxRecord(`reader-save-outbox:v2:${key}`, 2, entry, key))
      }
      for (const key of keys.filter((candidate) => candidate === READER_SAVE_OUTBOX_LEGACY_QUARANTINE_KEY
        || candidate.startsWith(READER_SAVE_OUTBOX_QUARANTINE_PREFIX)).sort()) {
        records.push(await parseOutboxQuarantine(storage.getItem(key) || '', key, quarantineProtector))
      }
      return {
        schemaVersion: 1,
        revision: records.reduce((max, record) => Math.max(max, record.revision), 0),
        records: records.map(({ sourceKey, ...record }) => record),
        references: records.flatMap((record) => record.references || []),
        mediaReferences: [],
      }
    },
  }
}

async function collectDomainSnapshot(adapter, domain) {
  const collector = adapter?.exportRecords || adapter?.collect || adapter?.export
  if (typeof collector !== 'function') throw outboxError('BACKUP_ADAPTER_MISSING', `Backup adapter is missing for ${domain}`)
  return collector.call(adapter, { domain })
}

function combineDomainAdapters(primary, secondary, domainKey) {
  return {
    key: domainKey,
    schemaVersion: primary.schemaVersion ?? 1,
    adapterVersion: primary.adapterVersion ?? 1,
    supportedSchemaVersions: primary.supportedSchemaVersions || [primary.schemaVersion ?? 1],
    async collect(context) {
      const [left, right] = await Promise.all([
        collectDomainSnapshot(primary, domainKey),
        collectDomainSnapshot(secondary, 'reader-save-outbox'),
      ])
      return {
        schemaVersion: left.schemaVersion ?? primary.schemaVersion ?? 1,
        revision: Math.max(Number(left.revision) || 0, Number(right.revision) || 0),
        records: [...(left.records || []), ...(right.records || [])],
        references: [...(left.references || []), ...(right.references || [])],
        mediaReferences: [...(left.mediaReferences || []), ...(right.mediaReferences || [])],
      }
    },
  }
}

export function createReadWebApplicationBackupService(options = {}) {
  const adapters = options.adapters || createReadWebApplicationBackupAdapters(options)
  return createApplicationBackupService({ ...options, adapters })
}

export function createLocalStorageCollectionDomainAdapter(options = {}) {
  const storage = options.storage || globalThis.localStorage
  const domainKey = String(options.domainKey || '').trim()
  const prefix = String(options.prefix || '')
  const prefixes = [...new Set([prefix, ...(Array.isArray(options.prefixes) ? options.prefixes : [])].map(String).filter(Boolean))]
  if (!storage || typeof storage.getItem !== 'function') throw new Error('localStorage collection adapter requires storage')
  const hasExplicitKeys = Array.isArray(options.keySpecs) || Array.isArray(options.keys)
  if (!domainKey || (!prefixes.length && !hasExplicitKeys)) throw new Error('localStorage collection adapter requires domainKey and prefix or explicit keys')
  const schemaVersion = options.schemaVersion ?? 1

  function withEvidence(error, sourceKey, rawValue, parsedValue) {
    const details = error?.details && typeof error.details === 'object' ? { ...error.details } : {}
    details.sourceKey = sourceKey
    details.rawValue = rawValue
    details.detectedAt = new Date().toISOString()
    details.reason = details.reason || error?.code || 'BACKUP_LOCAL_STORAGE_CORRUPT'
    details.checksumEvidence = details.checksumEvidence || parsedValue?.checksum || null
    if (error && typeof error === 'object') {
      error.details = details
      error.sourceKey = sourceKey
    }
    return error
  }

  function keys() {
    if (Array.isArray(options.keySpecs)) return options.keySpecs.map((spec) => String(spec.key)).filter(Boolean)
    if (Array.isArray(options.keys)) return options.keys.map((key) => String(key))
    const result = []
    const length = Number(storage.length) || 0
    for (let index = 0; index < length; index += 1) {
      const key = storage.key?.(index)
      if (key && key.startsWith(prefix)) result.push(key)
    }
    return result.sort()
  }

  function allStorageKeys() {
    const result = []
    const length = Number(storage.length) || 0
    for (let index = 0; index < length; index += 1) {
      const key = storage.key?.(index)
      if (key) result.push(key)
    }
    return result
  }

  return {
    key: domainKey,
    schemaVersion,
    adapterVersion: options.adapterVersion ?? 1,
    supportedSchemaVersions: [schemaVersion],
    async collect() {
      const selectedKeys = keys()
      if (options.rejectUnknownKeys !== false && prefixes.length) {
        const unknownKey = allStorageKeys().find((key) => prefixes.some((candidate) => key.startsWith(candidate)) && !selectedKeys.includes(key))
        if (unknownKey) {
          const error = new Error(`localStorage key ${unknownKey} is not registered with ${domainKey}`)
          error.code = 'BACKUP_UNCLAIMED_LOCAL_STORAGE_KEY'
          throw withEvidence(error, unknownKey, storage.getItem(unknownKey), null)
        }
      }
      const records = []
      for (const key of selectedKeys) {
        const raw = storage.getItem(key)
        if (raw === null) continue
        let value
        try {
          const spec = Array.isArray(options.keySpecs)
            ? options.keySpecs.find((entry) => String(entry.key) === key)
            : null
          try {
            value = spec?.rawText ? raw : JSON.parse(raw)
          } catch {
            const error = new Error(`Invalid JSON in ${domainKey} storage`)
            error.code = 'BACKUP_LOCAL_STORAGE_CORRUPT'
            throw error
          }
          const isObjectEnvelope = value && typeof value === 'object' && !Array.isArray(value)
          if (!isObjectEnvelope && !spec?.allowLegacyValue && !spec?.rawText) throw new Error(`Invalid envelope in ${domainKey} storage`)
          const declaredSchema = isObjectEnvelope ? value.schemaVersion : undefined
          if (declaredSchema !== undefined && spec?.schemaVersion !== undefined && declaredSchema !== spec.schemaVersion) {
            const error = new Error(`Unsupported schema in ${domainKey} storage`)
            error.code = 'BACKUP_LOCAL_STORAGE_UNKNOWN_SCHEMA'
            throw error
          }
          const revision = !isObjectEnvelope || value.revision === undefined
            ? 0
            : value.revision
          if (!Number.isInteger(revision) || revision < 0) throw new Error(`Invalid revision in ${domainKey} storage`)
          if (spec?.requiredRevision && (!isObjectEnvelope || value.revision === undefined)) throw new Error(`Missing revision in ${domainKey} storage`)
          if (isObjectEnvelope && value.schemaVersion !== undefined
            && typeof value.schemaVersion !== 'string'
            && !Number.isInteger(value.schemaVersion)) {
            throw new Error(`Invalid schema version in ${domainKey} storage`)
          }
          if (isObjectEnvelope && value.contentId !== undefined && value.contentId !== null && typeof value.contentId !== 'string') {
            throw new Error(`Invalid contentId in ${domainKey} storage`)
          }
          const contentId = isObjectEnvelope ? value.contentId ?? value.scope?.documentId ?? null : null
          if (contentId !== null && contentId !== undefined && typeof contentId !== 'string') {
            throw new Error(`Invalid contentId in ${domainKey} storage`)
          }
          const payload = isObjectEnvelope
            ? value
            : spec?.rawText
              ? { schemaVersion: spec?.schemaVersion ?? schemaVersion, value }
              : value
          records.push({
            id: key,
            schemaVersion: isObjectEnvelope ? value.schemaVersion ?? spec?.schemaVersion ?? schemaVersion : spec?.schemaVersion ?? schemaVersion,
            revision,
            contentId,
            payload,
          })
        } catch (error) {
          throw withEvidence(error, key, raw, value)
        }
      }
      return {
        schemaVersion,
        adapterVersion: options.adapterVersion ?? 1,
        revision: records.reduce((max, record) => Math.max(max, record.revision), 0),
        records,
      }
    },
    async restoreRecords(domain, context = {}) {
      const current = await this.collect()
      const expectedRevision = context.expectedRevision
      if (Number.isInteger(expectedRevision) && current.revision !== expectedRevision) {
        const error = new Error(`localStorage domain ${domainKey} changed before restore`)
        error.code = 'RESTORE_REVISION_CONFLICT'
        error.expectedRevision = expectedRevision
        error.currentRevision = current.revision
        throw error
      }
      const sourceRecords = Array.isArray(domain?.records) ? domain.records : []
      const sourceById = new Map(sourceRecords.map((record) => [String(record?.id || ''), record]))
      const selectedKeys = keys()
      const ownedCurrentKeys = allStorageKeys().filter((key) => (
        selectedKeys.includes(key) || prefixes.some((candidate) => key.startsWith(candidate))
      ))
      const plannedWrites = []
      for (const record of sourceRecords) {
        const key = String(record?.id || '')
        if (!selectedKeys.includes(key) && !prefixes.some((candidate) => key.startsWith(candidate))) {
          const error = new Error(`localStorage restore key ${key} is outside ${domainKey}`)
          error.code = 'RESTORE_UNKNOWN_KEY'
          throw error
        }
        const spec = Array.isArray(options.keySpecs)
          ? options.keySpecs.find((entry) => String(entry.key) === key)
          : null
        const payload = record?.payload
        let rawValue
        if (spec?.rawText) {
          if (!payload || typeof payload !== 'object' || typeof payload.value !== 'string') {
            throw restoreError('RESTORE_RECORD_INVALID', `localStorage restore payload for ${key} is invalid`)
          }
          rawValue = payload.value
        } else {
          rawValue = JSON.stringify(payload)
          if (rawValue === undefined) throw restoreError('RESTORE_RECORD_INVALID', `localStorage restore payload for ${key} is not serializable`)
        }
        plannedWrites.push({ key, rawValue })
      }
      for (const key of ownedCurrentKeys) {
        if (!sourceById.has(key)) storage.removeItem?.(key)
      }
      for (const { key, rawValue } of plannedWrites) {
        storage.setItem(key, rawValue)
      }
      await storage.flush?.()
      return { revision: domain?.revision ?? current.revision, recordCount: sourceRecords.length }
    },
  }
}

/*
 * Restore target adapters
 * -----------------------
 *
 * The export adapters above intentionally only describe data.  Restore has a
 * separate public boundary so a dry-run can never accidentally gain a write
 * capability.  These adapters call the application's real persistence
 * interfaces (ApplicationPersistence/localStorage and the injected workflow
 * owners); they do not keep an in-memory replacement for a production
 * repository.
 */

export const READ_WEB_RESTORE_TARGET_SCHEMA_VERSION = 1

const RESTORE_JOURNAL_STORAGE_KEY = 'read-web.application-restore.journal.v1'
const RESTORE_PENDING_STORAGE_KEY = 'read-web.application-restore.pending.v1'
const RESTORE_REVISION_STORAGE_KEY = 'read-web.application-restore.revision.v1'
const RESTORE_ROLLBACK_STORAGE_PREFIX = 'read-web.application-restore.rollback.v1.'
const RESTORE_QUARANTINE_STORAGE_PREFIX = 'read-web.application-restore.quarantine.v1.'
const RESTORE_DOMAIN_ORDER = Object.freeze([
  'reader-session',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'marks-activity',
  'workflow',
])

function restoreClone(value) {
  if (value === undefined) return undefined
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))
}

function restoreWithoutChecksum(value) {
  const clone = restoreClone(value)
  if (clone && typeof clone === 'object') delete clone.checksum
  return clone
}

function restoreCanonical(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => restoreCanonical(entry)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${restoreCanonical(value[key])}`).join(',')}}`
}

async function restoreChecksum(value) {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.subtle || typeof TextEncoder !== 'function') {
    const error = new Error('SHA-256 is required for restore journal integrity')
    error.code = 'RESTORE_CRYPTO_UNAVAILABLE'
    throw error
  }
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(restoreCanonical(value)))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function restoreError(code, message, details = {}) {
  const error = new Error(message)
  error.name = 'ReadWebRestoreError'
  error.code = code
  Object.assign(error, details)
  return error
}

function createStorageJsonStore(storage, key, { required = true } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    if (required) throw restoreError('RESTORE_DURABLE_STORE_UNAVAILABLE', `Durable restore store ${key} is unavailable`)
    return null
  }
  return {
    async read() {
      const raw = storage.getItem(key)
      if (raw === null || raw === undefined) return null
      let envelope
      try { envelope = JSON.parse(raw) } catch (cause) {
        throw restoreError('RESTORE_JOURNAL_CORRUPT', `Durable restore store ${key} is not valid JSON`, {
          cause,
          details: {
            sourceKey: key,
            rawValue: raw,
            detectedAt: new Date().toISOString(),
            reason: 'RESTORE_JOURNAL_CORRUPT',
            checksumEvidence: null,
          },
        })
      }
      if (!envelope || envelope.schemaVersion !== READ_WEB_RESTORE_TARGET_SCHEMA_VERSION
        || typeof envelope.checksum !== 'string' || !Object.prototype.hasOwnProperty.call(envelope, 'value')) {
        throw restoreError('RESTORE_JOURNAL_CORRUPT', `Durable restore store ${key} has an unsupported envelope`, {
          details: {
            sourceKey: key,
            rawValue: raw,
            detectedAt: new Date().toISOString(),
            reason: 'RESTORE_JOURNAL_CORRUPT',
            checksumEvidence: envelope?.checksum || null,
          },
        })
      }
      const actual = await restoreChecksum(envelope.value)
      if (actual !== envelope.checksum) {
        throw restoreError('RESTORE_JOURNAL_CORRUPT', `Durable restore store ${key} checksum does not match`, {
          details: {
            sourceKey: key,
            rawValue: raw,
            detectedAt: new Date().toISOString(),
            reason: 'RESTORE_JOURNAL_CORRUPT',
            checksumEvidence: envelope.checksum,
          },
        })
      }
      return restoreClone(envelope.value)
    },
    async write(value) {
      const envelope = {
        schemaVersion: READ_WEB_RESTORE_TARGET_SCHEMA_VERSION,
        value: restoreClone(value),
      }
      envelope.checksum = await restoreChecksum(envelope.value)
      storage.setItem(key, JSON.stringify(envelope))
      const reread = await this.read()
      if (restoreCanonical(reread) !== restoreCanonical(envelope.value)) {
        throw restoreError('RESTORE_DURABLE_STORE_UNCONFIRMED', `Durable restore store ${key} could not be read back`)
      }
      await storage.flush?.()
      return reread
    },
    async remove() {
      storage.removeItem?.(key)
      await storage.flush?.()
    },
  }
}

function createDelegatedRestoreAdapter(key, backupAdapter, delegate) {
  if (!backupAdapter || typeof backupAdapter.collect !== 'function') {
    throw restoreError('RESTORE_DOMAIN_UNAVAILABLE', `Backup adapter for ${key} is unavailable`)
  }
  const restore = delegate?.restoreRecords
    || delegate?.restoreSnapshot
    || delegate?.writeSnapshot
    || delegate?.restore
  if (typeof restore !== 'function') {
    throw restoreError('RESTORE_DOMAIN_UNAVAILABLE', `Restore adapter for ${key} does not expose a durable write method`)
  }
  return {
    key,
    schemaVersion: backupAdapter.schemaVersion ?? 1,
    adapterVersion: backupAdapter.adapterVersion ?? 1,
    supportedSchemaVersions: backupAdapter.supportedSchemaVersions || [backupAdapter.schemaVersion ?? 1],
    async collect(...args) {
      const snapshot = await backupAdapter.collect(...args)
      return { ...snapshot, adapterVersion: snapshot?.adapterVersion ?? this.adapterVersion }
    },
    async restoreRecords(domain, context = {}) {
      return restore.call(delegate, domain, context)
    },
  }
}

function rowFromBackupRecord(record, { reader = false, sessionChecksum = null } = {}) {
  const payload = restoreClone(record?.payload)
  if (!record?.id || payload === undefined) {
    throw restoreError('RESTORE_RECORD_INVALID', 'IndexedDB restore record is invalid', { recordId: record?.id })
  }
  const row = {
    id: String(record.id),
    schemaVersion: record.schemaVersion ?? 1,
    revision: record.revision ?? 0,
    contentId: record.contentId ?? null,
    content: payload,
  }
  if (reader && sessionChecksum) row.checksum = sessionChecksum
  if (reader && record.id === 'readerSession' && typeof payload.checksum === 'string') row.checksum = payload.checksum
  return row
}

function isReaderIndexedDbId(id) {
  return READER_SESSION_ROW_IDS.has(id) || String(id).startsWith('readerSessionQuarantine:')
}

function isVocabularyIndexedDbId(id) {
  return String(id).startsWith(VOCABULARY_ROW_PREFIX)
}

function outboxRestoreKey(entry) {
  return `${READER_SAVE_OUTBOX_V2_PREFIX}${outboxKeyPart(entry.jobId)}.${entry.kind}.${outboxKeyPart(entry.operationId)}`
}

function restoreMaxRowRevision(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((maximum, row) => (
    Number.isInteger(row?.revision) && row.revision >= 0
      ? Math.max(maximum, row.revision)
      : maximum
  ), 0)
}

function createIndexedDbRestoreAdapter({ key, backupAdapter, persistence, rowPredicate, reader = false, storage, outbox = false } = {}) {
  if (!persistence || typeof persistence.getAllRows !== 'function') {
    throw restoreError('RESTORE_DOMAIN_UNAVAILABLE', `IndexedDB restore adapter for ${key} requires ApplicationPersistence`)
  }
  const replaceRows = persistence.replaceRows
  const writeRows = persistence.writeRows
  if (typeof replaceRows !== 'function' && typeof writeRows !== 'function') {
    throw restoreError('RESTORE_DOMAIN_UNAVAILABLE', `IndexedDB restore adapter for ${key} requires replaceRows/writeRows`)
  }
  const base = {
    key,
    schemaVersion: backupAdapter.schemaVersion ?? 1,
    adapterVersion: backupAdapter.adapterVersion ?? 1,
    supportedSchemaVersions: backupAdapter.supportedSchemaVersions || [backupAdapter.schemaVersion ?? 1],
    async collect(...args) {
      const snapshot = await backupAdapter.collect(...args)
      return { ...snapshot, adapterVersion: snapshot?.adapterVersion ?? base.adapterVersion }
    },
  }
  return {
    ...base,
    async restoreRecords(domain, context = {}) {
      const currentRows = await persistence.getAllRows()
      const currentDomain = await backupAdapter.collect({ domain: key })
      const currentOwnedRows = (Array.isArray(currentRows) ? currentRows : [])
        .filter((row) => rowPredicate(row?.id))
      const sourceRecords = (Array.isArray(domain?.records) ? domain.records : [])
        .filter((record) => rowPredicate(record?.id))
      const sourceIds = new Set(sourceRecords.map((record) => String(record.id)))
      const deleteIds = currentOwnedRows
        .map((row) => String(row.id))
        .filter((id) => !sourceIds.has(id))
      const sessionRecord = sourceRecords.find((record) => record.id === 'readerSession')
      const sessionChecksum = sessionRecord?.payload?.checksum || null
      const rows = sourceRecords.map((record) => rowFromBackupRecord(record, { reader, sessionChecksum }))
      const currentIndexedDbRevision = restoreMaxRowRevision(currentOwnedRows)
      if (Number.isInteger(context.expectedRevision)) {
        // The reader domain also owns the durable save outbox.  Compare the
        // complete public domain revision first, then use the IndexedDB-only
        // revision for the v1 transaction guard so an outbox revision does
        // not falsely conflict with reader rows.
        const currentRevision = Number.isInteger(currentDomain?.revision)
          ? currentDomain.revision
          : currentIndexedDbRevision
        if (currentRevision !== context.expectedRevision) {
          const error = new Error(`IndexedDB domain ${key} changed before restore`)
          error.code = 'RESTORE_REVISION_CONFLICT'
          error.expectedRevision = context.expectedRevision
          error.currentRevision = currentRevision
          throw error
        }
      }
      if (rows.length || deleteIds.length) {
        if (typeof replaceRows === 'function') {
          const replaceOptions = {
            rows,
            deleteIds,
            allowId: rowPredicate,
            operation: `restore:${key}`,
            signal: context.signal,
          }
          if (Number.isInteger(context.expectedRevision)) {
            replaceOptions.expectedRevision = currentIndexedDbRevision
          }
          await replaceRows.call(persistence, replaceOptions)
        } else {
          await writeRows.call(persistence, rows, { deleteIds, expectedRevision: context.expectedRevision, signal: context.signal })
        }
      }

      if (!outbox || !storage) return { recordCount: rows.length, deletedCount: deleteIds.length }
      const outboxRecords = (Array.isArray(domain?.records) ? domain.records : [])
        .filter((record) => String(record?.id || '').startsWith('reader-save-outbox:'))
      const allKeys = []
      for (let index = 0; index < (Number(storage.length) || 0); index += 1) {
        const storageKey = storage.key?.(index)
        if (storageKey && (storageKey === READER_SAVE_OUTBOX_V1_KEY
          || storageKey === READER_SAVE_OUTBOX_LEGACY_QUARANTINE_KEY
          || storageKey.startsWith(READER_SAVE_OUTBOX_V2_PREFIX)
          || storageKey.startsWith(READER_SAVE_OUTBOX_QUARANTINE_PREFIX))) allKeys.push(storageKey)
      }
      const v1Entries = outboxRecords
        .filter((record) => String(record.id).startsWith('reader-save-outbox:v1:'))
        .map((record) => {
          const { schemaVersion, ...entry } = restoreClone(record.payload)
          if (schemaVersion !== 1 || !validOutboxEntry(entry)) {
            throw restoreError('RESTORE_RECORD_INVALID', 'Reader save outbox v1 restore record is invalid')
          }
          return entry
        })
      const v2Entries = outboxRecords
        .filter((record) => String(record.id).startsWith('reader-save-outbox:v2:'))
        .map((record) => restoreClone(record.payload))
        .filter((entry) => entry && typeof entry === 'object' && entry.jobId && entry.kind && entry.operationId)
      const quarantineRecords = outboxRecords
        .filter((record) => String(record.id).startsWith('reader-save-outbox:quarantine:'))
      for (const storageKey of allKeys) storage.removeItem?.(storageKey)
      if (v1Entries.length) storage.setItem(READER_SAVE_OUTBOX_V1_KEY, JSON.stringify({ schemaVersion: 1, entries: v1Entries }))
      for (const entry of v2Entries) storage.setItem(outboxRestoreKey(entry), JSON.stringify({ schemaVersion: 2, ...entry }))
      for (const record of quarantineRecords) {
        const storageKey = String(record.id).slice('reader-save-outbox:quarantine:'.length)
        if (storageKey !== READER_SAVE_OUTBOX_LEGACY_QUARANTINE_KEY
          && !storageKey.startsWith(READER_SAVE_OUTBOX_QUARANTINE_PREFIX)) {
          throw restoreError('RESTORE_RECORD_INVALID', 'Reader save outbox quarantine restore key is invalid')
        }
        const payload = restoreClone(record.payload)
        if (payload?.schemaVersion !== 1) {
          throw restoreError('RESTORE_RECORD_INVALID', 'Reader save outbox quarantine restore payload is invalid')
        }
        validateQuarantineRecoveryEnvelope(payload.recovery)
        const metadata = normalizeQuarantineMetadata(payload)
        storage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, ...metadata, recovery: payload.recovery }))
      }
      await storage.flush?.()
      return { recordCount: rows.length + v1Entries.length + v2Entries.length + quarantineRecords.length, deletedCount: deleteIds.length }
    },
  }
}

export function createReadWebApplicationRestoreAdapters(options = {}) {
  const explicit = options.restoreAdapters || {}
  const backupAdapters = options.backupAdapters || createReadWebApplicationBackupAdapters(options)
  const persistence = options.applicationPersistence
  const storage = options.storage || globalThis.localStorage
  const adapters = {}

  if (explicit['reader-session']) {
    adapters['reader-session'] = createDelegatedRestoreAdapter('reader-session', backupAdapters['reader-session'], explicit['reader-session'])
  } else {
    adapters['reader-session'] = createIndexedDbRestoreAdapter({
      key: 'reader-session',
      backupAdapter: backupAdapters['reader-session'],
      persistence,
      rowPredicate: isReaderIndexedDbId,
      reader: true,
      storage,
      outbox: true,
    })
  }

  if (explicit['vocabulary-srs']) {
    adapters['vocabulary-srs'] = createDelegatedRestoreAdapter('vocabulary-srs', backupAdapters['vocabulary-srs'], explicit['vocabulary-srs'])
  } else {
    adapters['vocabulary-srs'] = createIndexedDbRestoreAdapter({
      key: 'vocabulary-srs',
      backupAdapter: backupAdapters['vocabulary-srs'],
      persistence,
      rowPredicate: isVocabularyIndexedDbId,
    })
  }

  for (const key of ['passage-preview', 'annotation']) {
    const delegate = explicit[key]
    if (delegate) adapters[key] = createDelegatedRestoreAdapter(key, backupAdapters[key], delegate)
    else if (typeof backupAdapters[key]?.restoreRecords === 'function') adapters[key] = backupAdapters[key]
    else adapters[key] = createDelegatedRestoreAdapter(key, backupAdapters[key], delegate)
  }
  for (const key of ['marks-activity', 'workflow']) {
    const delegate = explicit[key] || options[`${key}RestoreAdapter`] || options[`${key}Adapter`]
    adapters[key] = createDelegatedRestoreAdapter(key, backupAdapters[key], delegate)
  }
  return adapters
}

function createRestoreJournalStores(options, storage) {
  const prefix = String(options.storageKeyPrefix || '')
  const durableStorage = storage?.durableRestoreStore === true ? storage : null
  const journal = options.journalStore || options.journal || (durableStorage && createStorageJsonStore(
    durableStorage,
    `${prefix}${RESTORE_JOURNAL_STORAGE_KEY}`,
  ))
  const pending = options.pendingStore || (durableStorage && createStorageJsonStore(
    durableStorage,
    `${prefix}${RESTORE_PENDING_STORAGE_KEY}`,
  ))
  const revision = options.revisionStore || (durableStorage && createStorageJsonStore(
    durableStorage,
    `${prefix}${RESTORE_REVISION_STORAGE_KEY}`,
  ))
  return { journal, pending, revision }
}

function resolveStoreMethod(store, method, label) {
  const fn = store?.[method]
  if (typeof fn !== 'function') throw restoreError('RESTORE_DURABLE_STORE_UNAVAILABLE', `${label} store does not implement ${method}`)
  return fn.bind(store)
}

export function createReadWebApplicationRestoreTarget(options = {}) {
  const storage = options.storage || globalThis.localStorage
  const backupAdapters = options.backupAdapters || createReadWebApplicationBackupAdapters(options)
  const adapters = options.adapters || createReadWebApplicationRestoreAdapters({ ...options, backupAdapters })
  const requiredDomains = [...APPLICATION_BACKUP_REQUIRED_DOMAINS]
  const stores = createRestoreJournalStores(options, storage)
  const readPending = resolveStoreMethod(stores.pending, 'read', 'restore pending')
  const writePending = resolveStoreMethod(stores.pending, 'write', 'restore pending')
  const removePending = resolveStoreMethod(stores.pending, 'remove', 'restore pending')
  const readRevision = resolveStoreMethod(stores.revision, 'read', 'restore revision')
  const writeRevision = resolveStoreMethod(stores.revision, 'write', 'restore revision')
  const readJournalStore = resolveStoreMethod(stores.journal, 'read', 'restore journal')
  const writeJournalStore = resolveStoreMethod(stores.journal, 'write', 'restore journal')
  const rollbackPrefix = String(options.storageKeyPrefix || '') + RESTORE_ROLLBACK_STORAGE_PREFIX
  const quarantinePrefix = String(options.storageKeyPrefix || '') + RESTORE_QUARANTINE_STORAGE_PREFIX
  const rollbackStore = options.rollbackStore || (storage?.durableRestoreStore === true ? {
    async write(entry) {
      const key = `${rollbackPrefix}${encodeURIComponent(String(entry.restoreId || 'restore'))}`
      const store = createStorageJsonStore(storage, key)
      const existing = await store.read()
      if (existing) {
        if (existing.artifact?.artifactChecksum === entry.artifact?.artifactChecksum) return existing
        throw restoreError('RESTORE_ID_CONFLICT', `Rollback backup already exists for ${entry.restoreId}`)
      }
      const domains = await collectAllDomains()
      const value = {
        schemaVersion: 1,
        ...restoreClone(entry),
        rawState: { revision: await currentRevision(), domains },
        expectedBaseRevision: await currentRevision(),
      }
      await store.write(value)
      return value
    },
    async read({ restoreId }) {
      const key = `${rollbackPrefix}${encodeURIComponent(String(restoreId || 'restore'))}`
      return createStorageJsonStore(storage, key).read()
    },
  } : null)
  const quarantine = options.quarantine || (storage ? {
    async write(entry) {
      const quarantineId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      const evidence = entry.report?.error?.details || entry.error?.details || {}
      const value = {
        ...restoreClone(entry),
        schemaVersion: 1,
        quarantineId,
        quarantinedAt: entry.quarantinedAt || new Date().toISOString(),
        sourceKey: entry.sourceKey || evidence.sourceKey || entry.kind || 'restore',
        reason: evidence.reason || entry.reason || 'unknown',
        checksumEvidence: entry.checksumEvidence || evidence.checksumEvidence || entry.artifactChecksum || null,
        ...(entry.rawValue !== undefined || evidence.rawValue !== undefined
          ? { rawValue: entry.rawValue !== undefined ? entry.rawValue : evidence.rawValue }
          : {}),
      }
      const store = createStorageJsonStore(storage, `${quarantinePrefix}${quarantineId}`)
      await store.write(value)
      const reread = await store.read()
      if (!reread || reread.quarantineId !== quarantineId) {
        throw restoreError('RESTORE_QUARANTINE_UNCONFIRMED', 'Restore quarantine could not be read back')
      }
      return { written: true, quarantineId }
    },
  } : null)
  if (!rollbackStore || typeof rollbackStore.write !== 'function' || typeof rollbackStore.read !== 'function') {
    throw restoreError('RESTORE_ROLLBACK_UNAVAILABLE', 'Read-Web restore target requires a durable rollback store')
  }
  if (!quarantine || typeof quarantine.write !== 'function') {
    throw restoreError('RESTORE_QUARANTINE_UNAVAILABLE', 'Read-Web restore target requires corrupt quarantine')
  }

  const faults = { ...(options.faults || {}) }
  let lockTail = Promise.resolve()
  let fallbackRevision = 0

  function withTargetLock(operation) {
    const previous = lockTail
    let release
    lockTail = new Promise((resolve) => { release = resolve })
    return previous.then(operation).finally(() => release())
  }

  async function currentRevision() {
    const value = await readRevision()
    if (Number.isInteger(value)) {
      fallbackRevision = Math.max(fallbackRevision, value)
      return value
    }
    if (value && Number.isInteger(value.revision)) {
      fallbackRevision = Math.max(fallbackRevision, value.revision)
      return value.revision
    }
    return fallbackRevision
  }

  async function setRevision(value) {
    fallbackRevision = value
    await writeRevision({ revision: value })
  }

  async function collectAllDomains() {
    const result = {}
    for (const key of RESTORE_DOMAIN_ORDER) {
      if (typeof adapters[key]?.collect !== 'function') throw restoreError('RESTORE_DOMAIN_UNAVAILABLE', `Restore adapter ${key} cannot read current state`)
      result[key] = restoreClone(await adapters[key].collect({ domain: key }))
    }
    return result
  }

  function comparableDomain(domain) {
    if (!domain || typeof domain !== 'object') return domain
    return {
      schemaVersion: domain.schemaVersion ?? null,
      adapterVersion: domain.adapterVersion ?? null,
      revision: domain.revision ?? null,
      references: domain.references || [],
      mediaReferences: domain.mediaReferences || [],
      records: (Array.isArray(domain.records) ? domain.records : []).map((record) => ({
        id: record?.id ?? null,
        schemaVersion: record?.schemaVersion ?? null,
        revision: record?.revision ?? null,
        contentId: record?.contentId ?? null,
        payload: record?.payload,
        references: record?.references || [],
        mediaReferences: record?.mediaReferences || [],
      })),
    }
  }

  function domainsEqual(left, right) {
    return restoreCanonical(comparableDomain(left)) === restoreCanonical(comparableDomain(right))
  }

  async function recoverPendingUnlocked() {
    const pending = await readPending()
    if (!pending) return null
    const validDomainMap = (value) => value && typeof value === 'object' && !Array.isArray(value)
      && requiredDomains.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    if (pending.schemaVersion !== 1
      || !pending.restoreId
      || !Number.isInteger(pending.baseRevision) || pending.baseRevision < 0
      || !Number.isInteger(pending.nextRevision) || pending.nextRevision <= pending.baseRevision
      || !validDomainMap(pending.baseDomains)
      || !validDomainMap(pending.stagedDomains)
      || !Array.isArray(pending.appliedDomains)) {
      throw restoreError('RESTORE_PENDING_CORRUPT', 'Pending restore checkpoint is invalid', {
        details: {
          sourceKey: RESTORE_PENDING_STORAGE_KEY,
          rawValue: pending,
          detectedAt: new Date().toISOString(),
          reason: 'RESTORE_PENDING_CORRUPT',
          checksumEvidence: pending.checksum || null,
        },
      })
    }
    if (typeof pending.checksum !== 'string' || await restoreChecksum(restoreWithoutChecksum(pending)) !== pending.checksum) {
      throw restoreError('RESTORE_PENDING_CORRUPT', 'Pending restore checkpoint checksum does not match', {
        restoreId: pending.restoreId,
        details: {
          sourceKey: RESTORE_PENDING_STORAGE_KEY,
          rawValue: pending,
          detectedAt: new Date().toISOString(),
          reason: 'RESTORE_PENDING_CORRUPT',
          checksumEvidence: pending.checksum || null,
        },
      })
    }
    const current = await collectAllDomains()
    const allNew = requiredDomains.every((key) => domainsEqual(current[key], pending.stagedDomains[key]))
    if (allNew) {
      await setRevision(pending.nextRevision)
      await removePending()
      return { status: 'completed', restoreId: pending.restoreId, revision: pending.nextRevision }
    }
    const conflictedDomain = requiredDomains.find((key) => (
      !domainsEqual(current[key], pending.baseDomains[key])
      && !domainsEqual(current[key], pending.stagedDomains[key])
    ))
    if (conflictedDomain) {
      throw restoreError(
        'RESTORE_REVISION_CONFLICT',
        `Pending restore domain ${conflictedDomain} changed after interruption`,
        { restoreId: pending.restoreId, domain: conflictedDomain },
      )
    }
    try {
      for (const key of RESTORE_DOMAIN_ORDER) {
        const adapter = adapters[key]
        if (!adapter?.restoreRecords) throw restoreError('RESTORE_DOMAIN_UNAVAILABLE', `Restore adapter ${key} cannot recover a pending restore`)
        const latest = current[key]
        await adapter.restoreRecords(pending.baseDomains[key], {
          restoreId: pending.restoreId,
          expectedRevision: latest?.revision,
          recovery: true,
        })
      }
      await setRevision(pending.baseRevision)
      await removePending()
      return { status: 'rolled-back', restoreId: pending.restoreId, revision: pending.baseRevision }
    } catch (error) {
      await quarantine.write({
        kind: 'pending-restore-recovery-failure',
        restoreId: pending.restoreId,
        reason: error?.code || 'RESTORE_ROLLBACK_FAILED',
        sourceKey: 'read-web.application-restore.pending.v1',
        checksumEvidence: pending.checksum || null,
      }).catch(() => {})
      throw restoreError('RESTORE_ROLLBACK_FAILED', 'Pending restore could not be recovered safely', { restoreId: pending.restoreId })
    }
  }

  async function commitDomains({ restoreId, baseRevision, baseDomains, stagedDomains, signal }) {
    return withTargetLock(async () => {
      await recoverPendingUnlocked()
      const latestRevision = await currentRevision()
      if (latestRevision !== baseRevision) {
        throw restoreError('RESTORE_REVISION_CONFLICT', 'Restore target changed before commit', {
          expectedBaseRevision: baseRevision,
          currentRevision: latestRevision,
        })
      }
      const latestDomains = await collectAllDomains()
      for (const key of requiredDomains) {
        if (!domainsEqual(latestDomains[key], baseDomains[key])) {
          throw restoreError('RESTORE_REVISION_CONFLICT', `Restore domain ${key} changed before commit`, { domain: key })
        }
      }
      const nextRevision = baseRevision + 1
      const pendingCore = {
        schemaVersion: 1,
        restoreId,
        baseRevision,
        nextRevision,
        baseDomains: restoreClone(baseDomains),
        stagedDomains: restoreClone(stagedDomains),
        appliedDomains: [],
        status: 'applying',
        startedAt: new Date().toISOString(),
      }
      pendingCore.checksum = await restoreChecksum(pendingCore)
      await writePending(pendingCore)
      const appliedDomains = []
      try {
        for (const key of RESTORE_DOMAIN_ORDER) {
          if (signal?.aborted) throw restoreError('RESTORE_INTERRUPTED', 'Restore was interrupted before domain commit')
          if (domainsEqual(stagedDomains[key], baseDomains[key])) continue
          if (Number.isInteger(faults.failBeforeDomain) && appliedDomains.length + 1 >= faults.failBeforeDomain) {
            throw restoreError(faults.failCode || 'RESTORE_QUOTA_EXCEEDED', `Restore write fault injected before domain ${key}`)
          }
          if (typeof adapters[key]?.restoreRecords !== 'function') throw restoreError('RESTORE_DOMAIN_UNAVAILABLE', `Restore adapter ${key} cannot write`)
          await adapters[key].restoreRecords(stagedDomains[key], {
            restoreId,
            expectedRevision: baseDomains[key]?.revision,
            signal,
          })
          appliedDomains.push(key)
          const checkpoint = { ...restoreWithoutChecksum(pendingCore), appliedDomains: [...appliedDomains] }
          checkpoint.checksum = await restoreChecksum(checkpoint)
          await writePending(checkpoint)
          if (Number.isInteger(faults.abortAfterDomain) && appliedDomains.length >= faults.abortAfterDomain) {
            throw restoreError('RESTORE_INTERRUPTED', `Restore fault injected after ${appliedDomains.length} domains`)
          }
          if (Number.isInteger(faults.failAfterDomain) && appliedDomains.length >= faults.failAfterDomain) {
            throw restoreError('RESTORE_COMMIT_FAILED', `Restore fault injected after ${appliedDomains.length} domains`)
          }
        }
        await setRevision(nextRevision)
        const committed = { ...restoreWithoutChecksum(pendingCore), status: 'committed', appliedDomains, committedAt: new Date().toISOString() }
        committed.checksum = await restoreChecksum(committed)
        await writePending(committed)
        await removePending()
        const transactionResult = { revision: nextRevision }
        if (faults.commit === 'write-then-fail' || (faults.commit === 'fail-once' && !faults.failed)) {
          faults.failed = true
          const error = restoreError('RESTORE_COMMIT_FAILED', `Restore commit fault injected for ${restoreId}`, {
            committedRevision: nextRevision,
          })
          throw error
        }
        return transactionResult
      } catch (error) {
        const committed = Number.isInteger(error?.committedRevision)
        if (!committed) {
          try {
            const current = await collectAllDomains()
            const conflictedDomain = requiredDomains.find((key) => (
              !domainsEqual(current[key], baseDomains[key])
              && !domainsEqual(current[key], stagedDomains[key])
            ))
            if (conflictedDomain) {
              throw restoreError(
                'RESTORE_REVISION_CONFLICT',
                `Restore domain ${conflictedDomain} changed before rollback`,
                { restoreId, domain: conflictedDomain },
              )
            }
            let rollbackApplied = 0
            for (const key of RESTORE_DOMAIN_ORDER) {
              if (!domainsEqual(current[key], baseDomains[key])) {
                await adapters[key].restoreRecords(baseDomains[key], {
                  restoreId,
                  expectedRevision: current[key]?.revision,
                  recovery: true,
                })
                rollbackApplied += 1
                if (Number.isInteger(faults.failRollbackAfterDomain) && rollbackApplied >= faults.failRollbackAfterDomain) {
                  throw restoreError('RESTORE_ROLLBACK_FAILED', `Restore rollback fault injected after ${rollbackApplied} domains`)
                }
              }
            }
            await setRevision(baseRevision)
            await removePending()
          } catch (rollbackError) {
            await quarantine.write({
              kind: 'restore-commit-rollback-failure',
              restoreId,
              sourceKey: 'read-web.application-restore.pending.v1',
              reason: rollbackError?.code || 'RESTORE_ROLLBACK_FAILED',
              checksumEvidence: pendingCore.checksum,
            }).catch(() => {})
            throw restoreError('RESTORE_ROLLBACK_FAILED', 'Restore commit failed and automatic rollback was not confirmed', { restoreId })
          }
        }
        throw error
      }
    })
  }

  const target = {
    isolated: options.isolated === true,
    restoreCapabilities: Object.freeze({
      atomicRevisionCommit: true,
      commitRevisionEvidence: true,
      verifyAppliedRevision: true,
    }),
    adapters,
    rollbackStore,
    quarantine,
    faults,
    rollbackStoreSeparate: Boolean(options.rollbackStore),
    capacityBytes: Number.isFinite(options.capacityBytes) ? options.capacityBytes : null,
    async estimateCapacity({ requiredBytes }) {
      if (Number.isFinite(target.capacityBytes)) return { ok: target.capacityBytes >= requiredBytes, availableBytes: target.capacityBytes }
      if (typeof options.estimateCapacity === 'function') return options.estimateCapacity({ requiredBytes })
      if (typeof storage?.estimateCapacity === 'function') return storage.estimateCapacity({ requiredBytes })
      const estimate = await globalThis.navigator?.storage?.estimate?.()
      const availableBytes = Number(estimate?.quota) - Number(estimate?.usage)
      return Number.isFinite(availableBytes)
        ? { ok: availableBytes >= requiredBytes, availableBytes }
        : { ok: false, availableBytes: null }
    },
    async readJournal({ restoreId }) {
      return withTargetLock(async () => {
        const recovery = await recoverPendingUnlocked()
        const value = await readJournalStore()
        const entry = value?.entries?.[restoreId] ? restoreClone(value.entries[restoreId]) : null
        if (recovery?.status === 'completed' && entry && entry.status !== 'completed') {
          const completed = {
            ...entry,
            status: 'completed',
            committedRevision: recovery.revision,
            completedAt: new Date().toISOString(),
          }
          const entries = { ...(value.entries || {}), [restoreId]: completed }
          await writeJournalStore({ schemaVersion: 1, entries })
          return completed
        }
        return entry
      })
    },
    async writeJournal(entry) {
      if (!entry?.restoreId) throw restoreError('RESTORE_JOURNAL_INVALID', 'Restore journal entry requires restoreId')
      return withTargetLock(async () => {
        const value = (await readJournalStore()) || { schemaVersion: 1, entries: {} }
        const entries = { ...(value.entries || {}), [entry.restoreId]: restoreClone(entry) }
        await writeJournalStore({ schemaVersion: 1, entries })
        return entry
      })
    },
    async beginTransaction({ restoreId, signal, expectedBaseRevision } = {}) {
      await withTargetLock(recoverPendingUnlocked)
      const baseRevision = await currentRevision()
      if (Number.isInteger(expectedBaseRevision) && baseRevision !== expectedBaseRevision) {
        throw restoreError('RESTORE_REVISION_CONFLICT', 'Restore target base revision is stale', {
          expectedBaseRevision,
          currentRevision: baseRevision,
        })
      }
      const baseDomains = await collectAllDomains()
      const stagedDomains = restoreClone(baseDomains)
      let committedRevision = null
      let rolledBack = false
      const transaction = {
        async applyDomain(key, domain) {
          if (!requiredDomains.includes(key)) throw restoreError('RESTORE_UNKNOWN_DOMAIN', `Unknown restore domain ${key}`)
          if (signal?.aborted) throw restoreError('RESTORE_INTERRUPTED', 'Restore was interrupted while staging')
          stagedDomains[key] = restoreClone(domain)
        },
        async commit() {
          const result = await commitDomains({ restoreId, baseRevision, baseDomains, stagedDomains, signal })
          committedRevision = result.revision
          return result
        },
        async rollback() { rolledBack = true },
        get baseRevision() { return baseRevision },
        get committedRevision() { return committedRevision },
        get rolledBack() { return rolledBack },
      }
      return transaction
    },
    async restoreSnapshot(artifact, context = {}) {
      const expectedRevision = Number.isInteger(context.expectedRevision)
        ? context.expectedRevision
        : await currentRevision()
      const baseDomains = await collectAllDomains()
      const stagedDomains = Object.fromEntries(requiredDomains.map((key) => [key, restoreClone(artifact?.domains?.[key] || baseDomains[key])]))
      const result = await commitDomains({
        restoreId: context.restoreId || `rollback-${Date.now()}`,
        baseRevision: expectedRevision,
        baseDomains,
        stagedDomains,
        signal: context.signal,
      })
      return result
    },
    async verifyApplied({ artifact }) {
      await withTargetLock(recoverPendingUnlocked)
      const domains = await collectAllDomains()
      const ok = requiredDomains.every((key) => domainsEqual(domains[key], artifact?.domains?.[key]))
      return { ok, revision: await currentRevision() }
    },
    async recoverPendingRestore() {
      return withTargetLock(recoverPendingUnlocked)
    },
    setFaults(nextFaults = {}) {
      Object.keys(faults).forEach((key) => { delete faults[key] })
      Object.assign(faults, nextFaults)
    },
  }
  return Object.freeze(target)
}
