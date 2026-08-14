import {
  APPLICATION_BACKUP_REQUIRED_DOMAINS,
  createApplicationBackupService,
  createIndexedDbDomainAdapter,
} from './application-backup.js'

const READER_SESSION_ROW_IDS = new Set(['audioMeta', 'transcript', 'chunkData', 'marks', 'readerSession'])
const VOCABULARY_ROW_PREFIX = 'vocabulary.'
const ANNOTATION_STORAGE_PREFIX = 'AnnotationGenerationStorage::'
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

/**
 * Assemble the six durable domains used by Read-Web. The two adapters that
 * cross a process boundary (marks/activity and workflow) must be supplied by
 * their owners; silently treating either one as empty would make a backup
 * look complete while losing learning state.
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

  const adapters = {
    'reader-session': explicit['reader-session'] || (
      readRows
        ? createIndexedDbDomainAdapter({
            domainKey: 'reader-session',
            schemaVersion: 1,
            readRows,
            assertRows: assertRowsConsumed,
            rowFilter: (row) => READER_SESSION_ROW_IDS.has(row?.id)
              || String(row?.id || '').startsWith('readerSessionQuarantine:'),
          })
        : null
    ),
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
