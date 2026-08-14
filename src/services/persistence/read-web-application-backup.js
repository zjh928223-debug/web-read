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
  const keyId = String(options.keyId || '').trim()
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
    || typeof value.rawValue !== 'string') {
    throw outboxError('BACKUP_READER_OUTBOX_CORRUPT', `Reader save outbox quarantine ${key} is invalid`, { key })
  }
  const metadata = normalizeQuarantineMetadata({
    sourceKey: value.sourceKey,
    detectedAt: value.detectedAt,
    reason: value.reason,
  })
  if (typeof quarantineProtector?.encrypt !== 'function') {
    throw outboxError(
      'BACKUP_READER_OUTBOX_QUARANTINE_UNRECOVERABLE',
      `Reader save outbox quarantine ${key} requires an encryption protector; raw evidence remains in the source profile`,
      { key },
    )
  }
  const recovery = await quarantineProtector.encrypt(value.rawValue, metadata)
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
          throw error
        }
      }
      const records = []
      for (const key of selectedKeys) {
        const raw = storage.getItem(key)
        if (raw === null) continue
        const spec = Array.isArray(options.keySpecs)
          ? options.keySpecs.find((entry) => String(entry.key) === key)
          : null
        let value
        try {
          value = spec?.rawText ? raw : JSON.parse(raw)
        } catch { throw new Error(`Invalid JSON in ${domainKey} storage`) }
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
          : { schemaVersion: spec?.schemaVersion ?? schemaVersion, value }
        records.push({
          id: key,
          schemaVersion: isObjectEnvelope ? value.schemaVersion ?? spec?.schemaVersion ?? schemaVersion : spec?.schemaVersion ?? schemaVersion,
          revision,
          contentId,
          payload,
        })
      }
      return { schemaVersion, revision: records.reduce((max, record) => Math.max(max, record.revision), 0), records }
    },
  }
}
