import {
  getAuthoritativeWindowsOwner,
  ownerRecordContent,
  ownerResponseRecords,
  ownerResponseError,
  requireOwnerRead,
  stableOwnerIdempotencyKey,
} from '../windows-owner-domain-adapter.js'
import { createVocabularyRepository } from './vocabulary-repository.js'
import {
  createVocabularyAcquisitionRepository,
} from './vocabulary-acquisition-repository.js'
import {
  createInMemoryContextEvidenceRepository,
} from './vocabulary-context-evidence.js'
import {
  createInMemoryLearningEventRepository,
} from './vocabulary-learning-events.js'
import {
  canonicalJson,
  createInMemoryVocabularyLearningUnitOfWorkRunner,
  normalizeReviewStore,
  sha256Utf8,
} from './vocabulary-learning-uow.js'
import {
  createInMemoryReviewSessionLedgerRepository,
  normalizeReviewSessionLedger,
  SRS_REVIEW_SESSION_LEDGER_STORE_SCHEMA,
} from './srs-review-session-ledger.js'
import {
  createArticleSrsSettlementProgressRepository,
  ARTICLE_SRS_SETTLEMENT_PROGRESS_STORE_KEY,
} from './article-srs-settlement-progress.js'
import {
  createInMemorySrsPendingCandidatesRepository,
  VOCABULARY_PENDING_CANDIDATES_STORE_KEY,
} from './srs-pending-candidates.js'
import {
  createInMemoryPersonalizationShadowReportRepository,
  PERSONALIZATION_SHADOW_REPORT_STORE_SCHEMA_VERSION,
} from './personalization/personalization-shadow-report-repository.js'

const DOMAIN = 'vocabulary-srs'
const VOCABULARY_ROW_ID = 'vocabulary.srs.store.v1'
const ACQUISITION_ROW_ID = 'vocabulary.acquisition.store.v1'
const REVIEW_ROW_ID = 'vocabulary.review.store.v2'
const LEDGER_ROW_ID = 'vocabulary.review-session-ledgers.v1'
const EVENTS_MANIFEST_ROW_ID = 'vocabulary.learning-events.manifest.v1'
const CONTEXT_ROW_ID = 'vocabulary.context-evidence.store.v1'
const PERSONALIZATION_ROW_ID = 'vocabulary.personalization.shadow-reports.v1'
const WATERMARK_ROW_ID = 'vocabulary.revision-watermark.v1'
const LEARNING_RECEIPT_PREFIX = 'vocabulary.learning-command-receipt.v1:'
const EVENT_SHARD_PATTERN = /^vocabulary\.learning-events\.v1\.\d{4}-(?:0[1-9]|1[0-2])(?:\.\d{4})?$/u
const SETTLEMENT_PREFIX = `${ARTICLE_SRS_SETTLEMENT_PROGRESS_STORE_KEY}:`
const integrationCache = new WeakMap()

function isAuthoritativeCheckpoint(windowObject) {
  const cutover = windowObject?.__windowsOwnerDomainCutover
  return cutover?.isAuthoritative?.(DOMAIN) === true
    || cutover?.authoritativeDomains?.includes?.(DOMAIN) === true
}

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function isEventShard(key) {
  return EVENT_SHARD_PATTERN.test(key)
}

function isSettlementKey(key) {
  return typeof key === 'string' && key.startsWith(SETTLEMENT_PREFIX)
}

function isLearningReceiptKey(key) {
  return typeof key === 'string' && key.startsWith(LEARNING_RECEIPT_PREFIX)
}

function isOwnerRecordKey(key) {
  return key === VOCABULARY_ROW_ID
    || key === ACQUISITION_ROW_ID
    || key === REVIEW_ROW_ID
    || key === LEDGER_ROW_ID
    || key === EVENTS_MANIFEST_ROW_ID
    || isEventShard(key)
    || key === CONTEXT_ROW_ID
    || key === PERSONALIZATION_ROW_ID
    || key === VOCABULARY_PENDING_CANDIDATES_STORE_KEY
    || isSettlementKey(key)
    || key === WATERMARK_ROW_ID
    || isLearningReceiptKey(key)
}

function contentFrom(records, key, fallback = null) {
  const record = records?.[key]
  if (!record) return fallback
  return clone(ownerRecordContent(record))
}

function ownerRevision(response) {
  const revision = response?.revision ?? response?.payload?.revision
  return Number.isInteger(revision) && revision >= 0 ? revision : 0
}

function ownerCommandError(response, operation) {
  const error = ownerResponseError(response, DOMAIN, operation)
  if (error.code === 'conflict') error.code = 'REVISION_CONFLICT'
  error.message += ` (${error.code})`
  return error
}

function assertCommitted(response, operation) {
  if (response?.outcome === 'committed' && response?.commitStatus === 'committed') return response
  throw ownerCommandError(response, operation)
}

function assertOwnerConflict(code, message, details = {}) {
  const error = new Error(message)
  error.name = 'VocabularyLearningContractError'
  error.code = code
  error.details = details
  throw error
}

function recordForCommand(id, content) {
  return { id, content: clone(content) }
}

function recordChecksum(record) {
  return `sha256:${sha256Utf8(canonicalJson(record?.content))}`
}

function expectedRecordChecksums(records) {
  return [...new Set(Object.values(records || {}).map(recordChecksum))].sort()
}

function requestFingerprint(operation, records, expectedRevision) {
  const capability = ['entry-upsert', 'acquisition-command'].includes(operation)
    ? 'vocabulary-srs.entry-command'
    : operation === 'review-attempt'
      ? 'vocabulary-srs.review-command'
      : 'vocabulary-srs.learning-command'
  return `sha256:${sha256Utf8(canonicalJson({
    domain: DOMAIN,
    operation,
    capability,
    expectedRevision,
    // VocabularySrsOwner adds each row checksum before binding the request receipt.
    payload: { records: Object.fromEntries(Object.entries(records).map(([id, record]) => (
      [id, { ...record, checksum: recordChecksum(record) }]
    ))) },
  }))}`
}

function matchesCommittedReceipt(response, operation, idempotencyKey, records, expectedRevision) {
  const receipt = response?.receipt
  if (response?.outcome !== 'committed'
    || response?.commitStatus !== 'committed'
    || !receipt
    || receipt.commitStatus !== 'committed'
    || receipt.domain !== DOMAIN
    || receipt.operation !== operation
    || receipt.idempotencyKey !== idempotencyKey
    || receipt.expectedRevision !== expectedRevision
    || receipt.requestFingerprint !== requestFingerprint(operation, records, expectedRevision)
    || !Number.isSafeInteger(receipt.revision)
    || receipt.revision !== response.revision
    || !Array.isArray(receipt.recordChecksums)) return false
  const expectedChecksums = expectedRecordChecksums(records)
  const actualChecksums = [...receipt.recordChecksums].sort()
  return expectedChecksums.length === actualChecksums.length
    && expectedChecksums.every((checksum, index) => checksum === actualChecksums[index])
}

async function recoverUnknownCommit(owner, response, operation, records, expectedRevision, idempotencyKey) {
  if (response?.outcome !== 'commit-unknown' || typeof owner.receipt !== 'function') return null
  let receiptResponse
  try {
    receiptResponse = await callOwner(owner, 'receipt', {
      domain: DOMAIN,
      idempotencyKey,
    })
  } catch (_error) {
    return null
  }
  if (!matchesCommittedReceipt(receiptResponse, operation, idempotencyKey, records, expectedRevision)) return null
  return {
    ...response,
    outcome: 'committed',
    commitStatus: 'committed',
    revision: receiptResponse.revision,
    receipt: receiptResponse.receipt,
    error: null,
  }
}

async function callOwner(owner, method, request) {
  try {
    return await owner[method](request)
  } catch (error) {
    if (error?.code !== 'owner-not-ready' || typeof owner.refresh !== 'function') throw error
    await owner.refresh()
    return owner[method](request)
  }
}

async function queryOwnerRecords(owner, operation) {
  const response = await callOwner(owner, 'query', {
    domain: DOMAIN,
    operation,
    payload: {},
  })
  requireOwnerRead(response, DOMAIN)
  return {
    records: clone(ownerResponseRecords(response)),
    revision: ownerRevision(response),
  }
}

async function querySnapshot(owner) {
  return queryOwnerRecords(owner, 'snapshot')
}

async function commitRecords(owner, operation, records, expectedRevision, idempotencyValue) {
  const idempotencyKey = stableOwnerIdempotencyKey(
    `vocabulary-${operation}`,
    idempotencyValue,
  )
  const response = await callOwner(owner, 'command', {
    domain: DOMAIN,
    operation,
    payload: { records },
    expectedRevision,
    idempotencyKey,
  })
  const recovered = await recoverUnknownCommit(
    owner,
    response,
    operation,
    records,
    expectedRevision,
    idempotencyKey,
  )
  if (recovered) return recovered
  return assertCommitted(response, operation)
}

function rowFromOwnerRecord(id, record, now) {
  const content = ownerRecordContent(record)
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null
  const timestamp = record?.timestamp
    || (isLearningReceiptKey(id) ? content.committed_at : null)
    || now()
  return {
    id,
    content: clone(content),
    timestamp,
    ...(Number.isInteger(record?.revision) ? { revision: record.revision } : {}),
  }
}

function rowsFromOwnerRecords(records, now) {
  return Object.entries(records || {})
    .filter(([id]) => isOwnerRecordKey(id))
    .map(([id, record]) => rowFromOwnerRecord(id, record, now))
    .filter(Boolean)
}

function changedRows(beforeRecords, afterRows) {
  return afterRows.filter((row) => {
    if (!isOwnerRecordKey(row.id)) return false
    const previous = beforeRecords?.[row.id]
    return !previous || canonicalJson(ownerRecordContent(previous)) !== canonicalJson(row.content)
  })
}

function emptyAcquisitionStore() {
  return {
    schema_version: 'acquisition-store.v1',
    by_learning_unit_id: {},
    acquisition_attempts_by_id: {},
  }
}

function emptyReviewStore() {
  return { schema_version: 'review-store.v2', by_learning_unit_id: {} }
}

function emptyLedgerStore() {
  return { schema_version: SRS_REVIEW_SESSION_LEDGER_STORE_SCHEMA, by_session_id: {} }
}

function emptyPendingStore() {
  return { schemaVersion: 1, groups: {} }
}

function emptyPersonalizationStore() {
  return {
    schema_version: PERSONALIZATION_SHADOW_REPORT_STORE_SCHEMA_VERSION,
    by_session_id: {},
  }
}

function createVocabularyOwnerRepository(owner, now) {
  return createVocabularyRepository({
    async loadRecord() {
      const selected = await queryOwnerRecords(owner, 'entry')
      return {
        snapshot: contentFrom(selected.records, VOCABULARY_ROW_ID),
        revision: selected.revision,
      }
    },
    async compareAndSwap(snapshot, expectedRevision) {
      const response = await commitRecords(
        owner,
        'entry-upsert',
        { [VOCABULARY_ROW_ID]: recordForCommand(VOCABULARY_ROW_ID, snapshot) },
        expectedRevision,
        { expectedRevision, content: snapshot, at: now() },
      )
      return response.revision
    },
  })
}

function createAcquisitionOwnerRepository(owner, now) {
  let expectedRevision = 0
  return createVocabularyAcquisitionRepository({
    async loadStore() {
      const selected = await queryOwnerRecords(owner, 'acquisition')
      expectedRevision = selected.revision
      return contentFrom(selected.records, ACQUISITION_ROW_ID, emptyAcquisitionStore())
    },
    async saveStore(store) {
      const response = await commitRecords(
        owner,
        'acquisition-command',
        { [ACQUISITION_ROW_ID]: recordForCommand(ACQUISITION_ROW_ID, store) },
        expectedRevision,
        { expectedRevision, content: store, at: now() },
      )
      expectedRevision = response.revision
    },
  })
}

function createContextOwnerRepository(owner, now) {
  return {
    async loadSnapshot() {
      const selected = await queryOwnerRecords(owner, 'context-evidence')
      return contentFrom(selected.records, CONTEXT_ROW_ID, { schema_version: 'context-evidence-store.v1', by_context_evidence_id: {} })
    },
    async getById(contextEvidenceId) {
      const repository = createInMemoryContextEvidenceRepository(await this.loadSnapshot())
      return repository.getById(contextEvidenceId)
    },
    async listByLearningUnit(learningUnitId) {
      const repository = createInMemoryContextEvidenceRepository(await this.loadSnapshot())
      return repository.listByLearningUnit(learningUnitId)
    },
    async put(evidence, expectedEvidenceRevision) {
      const selected = await queryOwnerRecords(owner, 'context-evidence')
      const repository = createInMemoryContextEvidenceRepository(
        contentFrom(selected.records, CONTEXT_ROW_ID, null),
      )
      const result = await repository.put(evidence, expectedEvidenceRevision)
      const next = await repository.loadSnapshot()
      const current = contentFrom(selected.records, CONTEXT_ROW_ID, null)
      if (canonicalJson(current) === canonicalJson(next)) return result
      await commitRecords(
        owner,
        'learning-event-append',
        { [CONTEXT_ROW_ID]: recordForCommand(CONTEXT_ROW_ID, next) },
        selected.revision,
        { expectedRevision: selected.revision, content: next, at: now() },
      )
      return result
    },
  }
}

function eventSeedFromRecords(records) {
  return Object.entries(records || {})
    .filter(([id]) => isEventShard(id))
    .flatMap(([, record]) => {
      const content = ownerRecordContent(record)
      return Array.isArray(content?.events) ? content.events : []
    })
}

function createLearningEventOwnerRepository(owner, runOwnerUnitOfWork) {
  return {
    async query(query = {}) {
      const selected = await queryOwnerRecords(owner, 'learning-events')
      const repository = createInMemoryLearningEventRepository(eventSeedFromRecords(selected.records))
      return repository.query(query)
    },
    async getById(eventId) {
      const selected = await queryOwnerRecords(owner, 'learning-events')
      const repository = createInMemoryLearningEventRepository(eventSeedFromRecords(selected.records))
      return repository.getById(eventId)
    },
    append(event) {
      const partition = String(event?.occurred_at || event?.recorded_at || '').slice(0, 7)
      const eventId = String(event?.event_id || '')
      const commandId = `owner-event-append:${eventId}`
      return runOwnerUnitOfWork(
        { now: () => new Date().toISOString() },
        {
          command_id: commandId,
          command_type: 'append_learning_event',
          correlation_id: `owner-event:${eventId}`,
          event_partition: partition,
          payload: { event_id: eventId },
        },
        (uow) => uow.events.append(event),
      )
    },
  }
}

function createReviewStateOwnerRepository(owner) {
  return {
    async loadSnapshot() {
      const selected = await queryOwnerRecords(owner, 'review-queue')
      return normalizeReviewStore(contentFrom(selected.records, REVIEW_ROW_ID, null))
    },
    async getByLearningUnitId(learningUnitId) {
      const snapshot = await this.loadSnapshot()
      return snapshot.by_learning_unit_id?.[learningUnitId] || null
    },
  }
}

function createLedgerOwnerRepository(owner, now) {
  return {
    async getBySessionId(sessionId) {
      const selected = await queryOwnerRecords(owner, 'review-queue')
      const repository = createInMemoryReviewSessionLedgerRepository(
        Object.values(contentFrom(selected.records, LEDGER_ROW_ID, emptyLedgerStore()).by_session_id || {}),
      )
      return repository.getBySessionId(sessionId)
    },
    async put(input, expectedLedgerRevision = null) {
      const selected = await queryOwnerRecords(owner, 'review-queue')
      const store = contentFrom(selected.records, LEDGER_ROW_ID, emptyLedgerStore())
      const current = store.by_session_id?.[input?.session_id] || null
      const next = normalizeReviewSessionLedger(input)
      if (!current) {
        if (expectedLedgerRevision !== null || next.revision !== 0) {
          assertOwnerConflict('CONCURRENT_MODIFICATION', 'Session ledger create revision mismatch')
        }
      } else {
        if (expectedLedgerRevision !== current.revision || next.revision !== current.revision) {
          assertOwnerConflict('CONCURRENT_MODIFICATION', 'Session ledger revision mismatch', {
            expected_revision: expectedLedgerRevision,
            actual_revision: current.revision,
          })
        }
        next.revision += 1
      }
      const nextStore = {
        ...store,
        schema_version: SRS_REVIEW_SESSION_LEDGER_STORE_SCHEMA,
        by_session_id: {
          ...(store.by_session_id || {}),
          [next.session_id]: next,
        },
      }
      await commitRecords(
        owner,
        'review-attempt',
        { [LEDGER_ROW_ID]: recordForCommand(LEDGER_ROW_ID, nextStore) },
        selected.revision,
        { expectedRevision: selected.revision, content: nextStore, at: now() },
      )
      return clone(next)
    },
  }
}

function createPendingOwnerRepository(owner, now) {
  const storage = {
    async loadStore() {
      const selected = await querySnapshot(owner)
      return contentFrom(selected.records, VOCABULARY_PENDING_CANDIDATES_STORE_KEY, emptyPendingStore())
    },
    async saveStore(store) {
      const selected = await querySnapshot(owner)
      await commitRecords(
        owner,
        'pending-candidates-update',
        { [VOCABULARY_PENDING_CANDIDATES_STORE_KEY]: recordForCommand(VOCABULARY_PENDING_CANDIDATES_STORE_KEY, store) },
        selected.revision,
        { expectedRevision: selected.revision, content: store, at: now() },
      )
    },
  }
  return {
    async loadStore() { return storage.loadStore() },
    async saveStore(store) { return storage.saveStore(store) },
    async getPendingCandidates(scopeKey) {
      const local = createInMemorySrsPendingCandidatesRepository(await storage.loadStore())
      return local.getPendingCandidates(scopeKey)
    },
    async setPendingCandidates(scopeKey, group) {
      const selected = await querySnapshot(owner)
      const local = createInMemorySrsPendingCandidatesRepository(
        contentFrom(selected.records, VOCABULARY_PENDING_CANDIDATES_STORE_KEY, emptyPendingStore()),
      )
      const saved = await local.setPendingCandidates(scopeKey, group)
      const next = await local.loadStore()
      await commitRecords(
        owner,
        'pending-candidates-update',
        { [VOCABULARY_PENDING_CANDIDATES_STORE_KEY]: recordForCommand(VOCABULARY_PENDING_CANDIDATES_STORE_KEY, next) },
        selected.revision,
        { expectedRevision: selected.revision, content: next, at: now() },
      )
      return saved
    },
    async clearPendingCandidates(scopeKey) {
      const selected = await querySnapshot(owner)
      const local = createInMemorySrsPendingCandidatesRepository(
        contentFrom(selected.records, VOCABULARY_PENDING_CANDIDATES_STORE_KEY, emptyPendingStore()),
      )
      await local.clearPendingCandidates(scopeKey)
      const next = await local.loadStore()
      await commitRecords(
        owner,
        'pending-candidates-update',
        { [VOCABULARY_PENDING_CANDIDATES_STORE_KEY]: recordForCommand(VOCABULARY_PENDING_CANDIDATES_STORE_KEY, next) },
        selected.revision,
        { expectedRevision: selected.revision, content: next, at: now() },
      )
    },
  }
}

function createSettlementOwnerRepository(owner, now) {
  return createArticleSrsSettlementProgressRepository({
    async getProgress(articleId) {
      const selected = await querySnapshot(owner)
      return contentFrom(selected.records, `${SETTLEMENT_PREFIX}${encodeURIComponent(articleId)}`)
    },
    async updateProgress(articleId, mutator) {
      const selected = await querySnapshot(owner)
      const key = `${SETTLEMENT_PREFIX}${encodeURIComponent(articleId)}`
      const current = contentFrom(selected.records, key)
      const next = await mutator(clone(current))
      await commitRecords(
        owner,
        'learning-event-append',
        { [key]: recordForCommand(key, next) },
        selected.revision,
        { expectedRevision: selected.revision, content: next, at: now() },
      )
      return clone(next)
    },
  })
}

function createPersonalizationOwnerRepository(owner, now) {
  async function loadStore() {
    const selected = await queryOwnerRecords(owner, 'personalization')
    return contentFrom(selected.records, PERSONALIZATION_ROW_ID, emptyPersonalizationStore())
  }
  return {
    async getBySessionId(sessionId) {
      const local = createInMemoryPersonalizationShadowReportRepository(
        Object.values((await loadStore()).by_session_id || {}),
      )
      return local.getBySessionId(sessionId)
    },
    async list(options) {
      const local = createInMemoryPersonalizationShadowReportRepository(
        Object.values((await loadStore()).by_session_id || {}),
      )
      return local.list(options)
    },
    async put(report) {
      const selected = await queryOwnerRecords(owner, 'personalization')
      const local = createInMemoryPersonalizationShadowReportRepository(
        Object.values((contentFrom(selected.records, PERSONALIZATION_ROW_ID, emptyPersonalizationStore()).by_session_id || {})),
      )
      const result = await local.put(report)
      const next = local.snapshot()
      await commitRecords(
        owner,
        'personalization-report',
        { [PERSONALIZATION_ROW_ID]: recordForCommand(PERSONALIZATION_ROW_ID, next) },
        selected.revision,
        { expectedRevision: selected.revision, content: next, at: now() },
      )
      return result
    },
    async clear() {
      const selected = await queryOwnerRecords(owner, 'personalization')
      const next = emptyPersonalizationStore()
      await commitRecords(
        owner,
        'personalization-report',
        { [PERSONALIZATION_ROW_ID]: recordForCommand(PERSONALIZATION_ROW_ID, next) },
        selected.revision,
        { expectedRevision: selected.revision, content: next, at: now() },
      )
    },
  }
}

function createLegacyMigrationFacade(acquisitionRepository) {
  return {
    async getMigratedWordIds() {
      const snapshot = await acquisitionRepository.loadSnapshot()
      return new Set(Object.values(snapshot.by_learning_unit_id || {})
        .map((pair) => pair?.learning_unit?.extensions?.legacy_migration?.legacy_word_id)
        .filter(Boolean)
        .map(String))
    },
    async getStatus() {
      return {
        version: 'legacy-vocabulary-migration.v1',
        eligible: 0,
        migrated: (await this.getMigratedWordIds()).size,
        remaining: 0,
        pending_confirmation: 0,
        complete: true,
        authoritative: true,
      }
    },
    async migrateNextBatch() {
      const error = new Error('Legacy vocabulary migration is disabled after Host authority switch')
      error.code = 'windows-owner-writer-frozen'
      throw error
    },
  }
}

function createOwnerLearningRunner(owner, now) {
  function stableClock(clock) {
    let timestamp
    return () => (timestamp ??= clock())
  }

  function run(dependencies, rawCommand, execute) {
    const commandNow = stableClock(dependencies?.now ?? now)
    return recompute((runner) => runner.run(
      { ...dependencies, now: commandNow }, rawCommand, execute,
    ), rawCommand, commandNow)
  }

  function runBatchSession(dependencies, executeSession) {
    const clocks = new Map()
    const batchNow = stableClock(dependencies?.now ?? now)
    return recompute((runner) => runner.runBatchSession(dependencies, (runCommand) => (
      executeSession((commandDependencies, rawCommand, execute) => {
        const id = rawCommand?.command_id
        if (!clocks.has(id)) clocks.set(id, stableClock(commandDependencies?.now ?? batchNow))
        return runCommand({ ...commandDependencies, now: clocks.get(id) }, rawCommand, execute)
      })
    )), { command_id: 'batch', command_type: 'batch' }, batchNow)
  }

  async function recompute(executeAttempt, command, clock) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const selected = await querySnapshot(owner)
      const runner = createInMemoryVocabularyLearningUnitOfWorkRunner({
        rows: rowsFromOwnerRecords(selected.records, clock),
        now: clock,
      })
      // Callbacks must only compute/stage transaction data; replay never wraps external writes.
      const result = await executeAttempt(runner)
      const changed = changedRows(selected.records, runner.snapshot())
      if (!changed.length) return result
      const records = Object.fromEntries(changed.map((row) => [row.id, recordForCommand(row.id, row.content)]))
      const operation = 'learning-unit-of-work'
      const fingerprint = requestFingerprint(operation, records, selected.revision)
      const identity = {
        commandId: command?.command_id || 'unknown',
        commandType: command?.command_type || 'unknown',
        requestFingerprint: fingerprint,
      }
      try {
        await commitRecords(owner, operation, records, selected.revision, identity)
        return result
      } catch (error) {
        const response = error?.response
        const receipt = response?.receipt
        // A key collision or an unknown result is not evidence of an uncommitted CAS attempt.
        const confirmedConflict = response?.outcome === 'conflict'
          && response.commitStatus === 'conflict'
          && receipt?.commitStatus === 'conflict'
          && receipt.domain === DOMAIN
          && receipt.operation === operation
          && receipt.idempotencyKey === stableOwnerIdempotencyKey(`vocabulary-${operation}`, identity)
          && receipt.requestFingerprint === fingerprint
          && receipt.expectedRevision === selected.revision
          && Number.isSafeInteger(receipt.revision)
          && receipt.revision === response.revision
          && receipt.revision > selected.revision
        if (!confirmedConflict || attempt === 2) throw error
      }
    }
  }

  return { run, runBatchSession }
}

export function createWindowsOwnerVocabularySrsIntegration(options = {}) {
  const owner = options.owner || getAuthoritativeWindowsOwner(DOMAIN, options.windowObject || globalThis)
  if (!owner || typeof owner.query !== 'function' || typeof owner.command !== 'function') {
    throw new Error('Vocabulary/SRS Host owner is not authoritative')
  }
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString()
  const learningRunner = createOwnerLearningRunner(owner, now)
  const acquisitionRepository = createAcquisitionOwnerRepository(owner, now)
  const vocabularyRepository = createVocabularyOwnerRepository(owner, now)
  const contextEvidenceRepository = createContextOwnerRepository(owner, now)
  const learningEventRepository = createLearningEventOwnerRepository(owner, learningRunner.run)
  const sessionLedgerRepository = createLedgerOwnerRepository(owner, now)
  const reviewStateRepository = createReviewStateOwnerRepository(owner)
  const settlementProgressRepository = createSettlementOwnerRepository(owner, now)
  const srsPendingCandidatesRepository = createPendingOwnerRepository(owner, now)
  const personalizationShadowReportRepository = createPersonalizationOwnerRepository(owner, now)
  return Object.freeze({
    owner,
    vocabularyRepository,
    acquisitionRepository,
    contextEvidenceRepository,
    learningEventRepository,
    sessionLedgerRepository,
    reviewStateRepository,
    settlementProgressRepository,
    srsPendingCandidatesRepository,
    personalizationShadowReportRepository,
    runVocabularyLearningUnitOfWork: learningRunner.run,
    runVocabularyLearningBatchSession: learningRunner.runBatchSession,
    legacyMigration: createLegacyMigrationFacade(acquisitionRepository),
  })
}

export function getWindowsOwnerVocabularySrsIntegration(windowObject = globalThis) {
  const cutover = windowObject?.__windowsOwnerDomainCutover
  const owner = getAuthoritativeWindowsOwner(DOMAIN, windowObject)
    || (isAuthoritativeCheckpoint(windowObject)
      && typeof cutover?.query === 'function'
      && typeof cutover?.command === 'function'
      ? cutover
      : null)
  if (!owner) {
    return null
  }
  if (windowObject && typeof windowObject === 'object' && integrationCache.has(windowObject)) {
    const cached = integrationCache.get(windowObject)
    if (cached.owner === owner) return cached
  }
  const integration = createWindowsOwnerVocabularySrsIntegration({ owner, windowObject })
  if (windowObject && typeof windowObject === 'object') integrationCache.set(windowObject, integration)
  return integration
}

export {
  ACQUISITION_ROW_ID,
  CONTEXT_ROW_ID,
  DOMAIN,
  EVENTS_MANIFEST_ROW_ID,
  LEDGER_ROW_ID,
  PERSONALIZATION_ROW_ID,
  REVIEW_ROW_ID,
  SETTLEMENT_PREFIX,
  VOCABULARY_ROW_ID,
  WATERMARK_ROW_ID,
}
