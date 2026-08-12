import { createIndexedDbVocabularyRepository } from './vocabulary-repository.js'
import { createIndexedDbAcquisitionRepository } from './vocabulary-acquisition-repository.js'
import { WORD_STATUSES } from './vocabulary-models.js'
import {
  deriveTargetSenseKey,
  normalizeAcquisitionState,
  normalizeLearningUnit,
} from './vocabulary-learning-models.js'
import { normalizeContextEvidence } from './vocabulary-context-evidence.js'
import { normalizeLearningEvent } from './vocabulary-learning-events.js'
import { runVocabularyLearningUnitOfWork } from './vocabulary-learning-uow.js'

export const LEGACY_VOCABULARY_MIGRATION_VERSION = 'legacy-vocabulary-migration.v1'
export const LEGACY_VOCABULARY_MIGRATION_POLICY_VERSION = 'legacy-vocabulary-migration-policy.v1'

const LEGACY_UNIT_PREFIX = 'legacy-migration:'
const DEFAULT_BATCH_SIZE = 25
const MAX_CONTEXTS_PER_WORD = 3

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function normalizeId(value, fallback) {
  const normalized = normalizeText(value)
  return normalized || fallback
}

function safeIso(value, fallback) {
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback
}

function safeInteger(value, fallback = 0) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : fallback
}

function safeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function clampDifficulty(value) {
  return Math.min(10, Math.max(1, safeNumber(value, 1)))
}

function migrationUnitId(wordId) {
  return `${LEGACY_UNIT_PREFIX}${wordId}`
}

function migrationTargetSenseId(wordId) {
  return `${migrationUnitId(wordId)}:sense`
}

function migrationEventId(wordId) {
  return `${migrationUnitId(wordId)}:event`
}

function migrationCommandId(wordId) {
  return `${migrationUnitId(wordId)}:command`
}

function migrationCorrelationId(wordId) {
  return `${migrationUnitId(wordId)}:correlation`
}

function migrationContextId(wordId, index) {
  return `${migrationUnitId(wordId)}:context:${index}`
}

function migrationEpisodeId(wordId) {
  return `${migrationUnitId(wordId)}:episode`
}

function resolveTargetSense(word, contexts = []) {
  if (!isObject(word)) return null
  const wordGloss = normalizeText(
    word.meaning
      || word.general_meaning
      || word.generalMeaning
      || word.dictionary_definition
      || word.dictionaryDefinition,
  )
  const contextGloss = (Array.isArray(contexts) ? contexts : [])
    .map((context) => normalizeText(
      context?.meaning
        || context?.simple_meaning
        || context?.simpleMeaning,
    ))
    .find(Boolean) || ''
  const gloss = wordGloss || contextGloss
  if (!gloss) return null
  const language = normalizeText(word.language || 'en').toLowerCase() || 'en'
  const targetSense = {
    gloss,
    normalized_gloss: gloss.toLowerCase(),
    part_of_speech: normalizeText(word.part_of_speech || word.partOfSpeech) || null,
    definition: normalizeText(word.dictionary_definition || word.dictionaryDefinition) || null,
    language,
  }
  return {
    source: wordGloss ? 'legacy_word_meaning' : 'legacy_context_meaning',
    target_sense_id: migrationTargetSenseId(word.id),
    target_sense_key: deriveTargetSenseKey(targetSense),
    target_sense: targetSense,
  }
}

function resolveLegacyContexts(word, contexts, nowIso) {
  if (!Array.isArray(contexts)) return []
  return contexts
    .map((context, index) => ({ context, index }))
    .filter(({ context }) => normalizeText(context?.sentence))
    .slice(0, MAX_CONTEXTS_PER_WORD)
    .map(({ context, index }) => {
      const sourceId = normalizeId(
        context.source_id || context.sourceId,
        `${LEGACY_UNIT_PREFIX}${word.id}:source:${index}`,
      )
      const sourceTitle = normalizeText(context.source_title || context.sourceTitle)
        || '历史词条语境'
      const createdAt = safeIso(context.created_at || context.createdAt, safeIso(word.created_at, nowIso))
      return normalizeContextEvidence({
        schema_version: 'context-evidence.v1',
        context_evidence_id: migrationContextId(word.id, index),
        learning_unit_id: migrationUnitId(word.id),
        sentence: normalizeText(context.sentence),
        surrounding_text: normalizeText(context.surrounding_text || context.surroundingText) || null,
        source_kind: 'article',
        source_id: sourceId,
        source_title: sourceTitle,
        source_locator: {
          locator_version: 'source-locator.v1',
          sentence_index: index,
        },
        license_kind: 'unknown',
        ownership: 'third_party',
        quality_status: 'pending',
        quality_reason: 'legacy_migration_source_not_revalidated',
        created_at: createdAt,
        validated_at: null,
        revision: 0,
        extensions: {
          legacy_context_id: normalizeText(context.id) || null,
          source_url: normalizeText(context.source_url || context.sourceUrl) || null,
        },
      })
    })
}

function buildReviewState(word, legacyState, unitId, nowIso, migrationMetadata) {
  const createdAtCandidate = safeIso(
    legacyState?.last_review_at || legacyState?.lastReviewAt || word.created_at,
    nowIso,
  )
  const createdAt = Date.parse(createdAtCandidate) <= Date.parse(nowIso)
    ? createdAtCandidate
    : nowIso
  return {
    schema_version: 'review-state.v2',
    review_state_id: `${unitId}:review-state`,
    learning_unit_id: unitId,
    word_id: word.id,
    state: ['new', 'learning', 'review', 'relearning'].includes(legacyState?.state)
      ? legacyState.state
      : 'new',
    due_at: safeIso(legacyState?.due_at || legacyState?.dueAt, nowIso),
    stability: safeNumber(legacyState?.stability),
    difficulty: clampDifficulty(legacyState?.difficulty),
    elapsed_days: safeInteger(legacyState?.elapsed_days || legacyState?.elapsedDays),
    scheduled_days: safeInteger(legacyState?.scheduled_days || legacyState?.scheduledDays),
    reps: safeInteger(legacyState?.reps),
    lapses: safeInteger(legacyState?.lapses),
    learning_steps: safeInteger(legacyState?.learning_steps || legacyState?.learningSteps),
    last_review_at: legacyState?.last_review_at || legacyState?.lastReviewAt
      ? safeIso(legacyState.last_review_at || legacyState.lastReviewAt, createdAt)
      : null,
    scheduler_version: 'ts-fsrs.v5.4.1',
    scheduler_parameters_version: 'legacy-migration.v1',
    created_at: createdAt,
    updated_at: nowIso,
    revision: 0,
    extensions: {
      legacy_migration: migrationMetadata,
      original_review_state: clone(legacyState || null),
    },
  }
}

function buildLearningUnit(word, targetSense, nowIso, migrationMetadata) {
  const createdAt = safeIso(word.created_at, nowIso)
  return normalizeLearningUnit({
    schema_version: 'learning-unit.v1',
    learning_unit_id: migrationUnitId(word.id),
    word_id: word.id,
    normalized_form: normalizeText(word.lemma || word.word),
    language: normalizeText(word.language || 'en').toLowerCase() || 'en',
    target_sense_id: targetSense.target_sense_id,
    target_sense_key: targetSense.target_sense_key,
    target_sense: targetSense.target_sense,
    created_at: createdAt,
    updated_at: nowIso,
    archived_at: null,
    revision: 0,
    extensions: {
      legacy_migration: migrationMetadata,
    },
  })
}

function buildMigrationMetadata(word, nowIso, contexts, targetSense) {
  return {
    schema_version: LEGACY_VOCABULARY_MIGRATION_VERSION,
    policy_version: LEGACY_VOCABULARY_MIGRATION_POLICY_VERSION,
    legacy_word_id: word.id,
    migrated_at: nowIso,
    target_sense_source: targetSense?.source || 'missing',
    context_source: contexts.length ? 'legacy_context' : 'none',
    context_quality: contexts.length ? 'pending_revalidation' : 'missing',
    requires_context_confirmation: contexts.length === 0,
  }
}

function buildMigratedAcquisitionState(unit, contexts, nowIso, migrationMetadata, revision, status) {
  const introducedAt = safeIso(unit.created_at, nowIso)
  return normalizeAcquisitionState({
    schema_version: 'acquisition-state.v1',
    learning_unit_id: unit.learning_unit_id,
    status,
    context_evidence_ids: contexts.map((context) => context.context_evidence_id),
    validated_anchor_id: null,
    last_acquisition_attempt_id: null,
    introduction_episode_id: migrationEpisodeId(unit.word_id),
    introduced_at: introducedAt,
    last_exposure_at: nowIso,
    ready_for_check_at: status === 'ready_for_check' || status === 'graduated' ? nowIso : null,
    graduated_at: status === 'graduated' ? nowIso : null,
    skipped_at: null,
    revision,
    extensions: {
      legacy_migration: migrationMetadata,
    },
  })
}

function buildMigrationEvent(word, legacyState, reviewState, unit, contexts, nowIso, metadata) {
  return normalizeLearningEvent({
    schema_version: 'learning-event.v1',
    event_id: migrationEventId(word.id),
    command_id: migrationCommandId(word.id),
    correlation_id: migrationCorrelationId(word.id),
    event_type: 'legacy_reassessed',
    attempt_id: null,
    occurred_at: nowIso,
    recorded_at: nowIso,
    session_id: null,
    session_position: null,
    learning_unit_id: unit.learning_unit_id,
    word_id: word.id,
    target_sense_id: unit.target_sense_id,
    policy_version: LEGACY_VOCABULARY_MIGRATION_POLICY_VERSION,
    scheduler_version: reviewState.scheduler_version,
    content_version: LEGACY_VOCABULARY_MIGRATION_VERSION,
    prompt_mode: null,
    cue_level: null,
    rating: null,
    answer_revealed_before_rating: null,
    graduation_eligibility: null,
    duration_ms: null,
    active_duration_ms: null,
    before_state: clone(legacyState || null),
    after_state: clone(reviewState),
    source_kind: contexts[0]?.source_kind || null,
    context_evidence_id: contexts[0]?.context_evidence_id || null,
    is_legacy: true,
    payload: {
      schema_version: 'legacy-vocabulary-migration-result.v1',
      migration_policy_version: LEGACY_VOCABULARY_MIGRATION_POLICY_VERSION,
      migration_metadata: metadata,
      original_word: clone(word),
      original_review_state: clone(legacyState || null),
      imported_context_count: contexts.length,
      context_revalidation_required: contexts.length > 0,
    },
    extensions: {},
  })
}

function migrationCandidateFrom(word, reviewState, contexts) {
  const targetSense = resolveTargetSense(word, contexts)
  return {
    word,
    reviewState,
    contexts,
    targetSense,
    status: targetSense ? 'ready' : 'pending_confirmation',
  }
}

export function buildLegacyVocabularyMigrationPlan(snapshot, migratedWordIds = new Set()) {
  const source = isObject(snapshot) ? snapshot : {}
  const migratedIds = migratedWordIds instanceof Set
    ? migratedWordIds
    : new Set(Array.isArray(migratedWordIds) ? migratedWordIds.map((id) => String(id)) : [])
  const words = Array.isArray(source.words) ? source.words : []
  const reviewStates = Array.isArray(source.reviewStates) ? source.reviewStates : []
  const contexts = Array.isArray(source.contexts) ? source.contexts : []
  const statesByWordId = new Map(reviewStates.map((state) => [String(state.word_id), state]))
  const contextsByWordId = new Map()
  contexts.forEach((context) => {
    const wordId = String(context.word_id || '')
    if (!wordId) return
    if (!contextsByWordId.has(wordId)) contextsByWordId.set(wordId, [])
    contextsByWordId.get(wordId).push(context)
  })
  const candidates = words
    .filter((word) => word && word.status !== WORD_STATUSES.IGNORED)
    .map((word) => {
      const wordId = String(word.id || '')
      const state = statesByWordId.get(wordId)
      if (!wordId || !state || migratedIds.has(wordId)) return null
      return migrationCandidateFrom(
        word,
        state,
        contextsByWordId.get(wordId) || [],
      )
    })
    .filter(Boolean)
    .sort((left, right) => (
      Date.parse(left.reviewState.due_at || 0) - Date.parse(right.reviewState.due_at || 0)
      || String(left.word.id).localeCompare(String(right.word.id))
    ))
  return {
    candidates,
    ready: candidates.filter((item) => item.status === 'ready'),
    pendingConfirmation: candidates.filter((item) => item.status === 'pending_confirmation'),
  }
}

function migratedWordIdsFromAcquisitionSnapshot(snapshot) {
  const ids = new Set()
  const pairs = isObject(snapshot) && isObject(snapshot.by_learning_unit_id)
    ? Object.values(snapshot.by_learning_unit_id)
    : []
  pairs.forEach((pair) => {
    const marker = pair?.learning_unit?.extensions?.legacy_migration
    if (marker?.legacy_word_id) ids.add(String(marker.legacy_word_id))
  })
  return ids
}

export function createLegacyReviewServiceAdapter(legacyService, migrationService) {
  if (!legacyService || typeof legacyService.getDueWords !== 'function') {
    throw new Error('Legacy review adapter requires a legacy vocabulary service')
  }
  if (!migrationService || typeof migrationService.getMigratedWordIds !== 'function') {
    throw new Error('Legacy review adapter requires the migration service')
  }
  const migratedIds = async () => migrationService.getMigratedWordIds()
  const assertNotMigrated = async (wordId) => {
    const ids = await migratedIds()
    if (ids.has(String(wordId))) {
      throw new Error('该词已接入 V2，请从 V2 复习路径操作')
    }
  }
  return {
    ...legacyService,
    async getDueWords(now) {
      const [dueWords, ids] = await Promise.all([
        legacyService.getDueWords(now),
        migratedIds(),
      ])
      return (Array.isArray(dueWords) ? dueWords : []).filter((entry) => (
        !ids.has(String(entry?.word?.id || ''))
      ))
    },
    async reviewWord(wordId, rating, reviewedAt) {
      await assertNotMigrated(wordId)
      return legacyService.reviewWord(wordId, rating, reviewedAt)
    },
    async reviewWordKnown(wordId, reviewedAt) {
      await assertNotMigrated(wordId)
      return legacyService.reviewWordKnown(wordId, reviewedAt)
    },
  }
}

export function createLegacyVocabularyMigration(options = {}) {
  const legacyRepository = options.legacyRepository
    || createIndexedDbVocabularyRepository({ indexedDBApi: options.indexedDBApi })
  const acquisitionRepository = options.acquisitionRepository
    || createIndexedDbAcquisitionRepository({ indexedDBApi: options.indexedDBApi })
  const runUnitOfWork = options.runUnitOfWork || runVocabularyLearningUnitOfWork
  const now = options.now || (() => new Date().toISOString())
  const indexedDBApi = options.indexedDBApi

  async function getMigratedWordIds() {
    return migratedWordIdsFromAcquisitionSnapshot(await acquisitionRepository.loadSnapshot())
  }

  async function getStatus() {
    const [legacySnapshot, acquisitionSnapshot] = await Promise.all([
      legacyRepository.loadSnapshot(),
      acquisitionRepository.loadSnapshot(),
    ])
    const migratedWordIds = migratedWordIdsFromAcquisitionSnapshot(acquisitionSnapshot)
    const plan = buildLegacyVocabularyMigrationPlan(legacySnapshot, migratedWordIds)
    const eligibleCount = (
      (Array.isArray(legacySnapshot?.words) ? legacySnapshot.words : [])
        .filter((word) => word && word.status !== WORD_STATUSES.IGNORED)
        .filter((word) => plan.candidates.some((item) => item.word.id === word.id))
        .length
      + migratedWordIds.size
    )
    return {
      version: LEGACY_VOCABULARY_MIGRATION_VERSION,
      eligible: eligibleCount,
      migrated: migratedWordIds.size,
      remaining: plan.ready.length,
      pending_confirmation: plan.pendingConfirmation.length,
      complete: plan.ready.length === 0,
    }
  }

  async function migrateCandidate(candidate) {
    if (candidate.status !== 'ready' || !candidate.targetSense) {
      return {
        status: 'pending_confirmation',
        word_id: candidate.word.id,
        reason: 'missing_legacy_meaning',
      }
    }
    const nowIso = safeIso(now(), new Date().toISOString())
    const metadata = buildMigrationMetadata(
      candidate.word,
      nowIso,
      candidate.contexts,
      candidate.targetSense,
    )
    const unit = buildLearningUnit(candidate.word, candidate.targetSense, nowIso, metadata)
    const contexts = resolveLegacyContexts(candidate.word, candidate.contexts, nowIso)
    const migratedReviewState = buildReviewState(
      candidate.word,
      candidate.reviewState,
      unit.learning_unit_id,
      nowIso,
      metadata,
    )
    const command = {
      command_id: migrationCommandId(candidate.word.id),
      command_type: 'migrate_legacy_vocabulary_word',
      correlation_id: migrationCorrelationId(candidate.word.id),
      event_partition: nowIso.slice(0, 7),
      payload: {
        schema_version: 'legacy-vocabulary-migration-command.v1',
        legacy_word_id: candidate.word.id,
        learning_unit_id: unit.learning_unit_id,
        migration_policy_version: LEGACY_VOCABULARY_MIGRATION_POLICY_VERSION,
        target_sense: clone(candidate.targetSense),
      },
    }
    const result = await runUnitOfWork(
      { indexedDBApi, now: () => nowIso },
      command,
      async (uow) => {
        const existingUnit = await uow.acquisition.getLearningUnit(unit.learning_unit_id)
        if (existingUnit) {
          return {
            status: 'already_migrated',
            word_id: candidate.word.id,
            learning_unit_id: unit.learning_unit_id,
          }
        }
        await uow.acquisition.putLearningUnit(unit, null)
        let state = await uow.acquisition.getState(unit.learning_unit_id)
        state = await uow.acquisition.putState(
          buildMigratedAcquisitionState(unit, [], nowIso, metadata, state.revision, 'introduced'),
          state.revision,
        )
        for (const context of contexts) {
          await uow.contexts.put(context, null)
        }
        state = await uow.acquisition.putState(
          buildMigratedAcquisitionState(unit, contexts, nowIso, metadata, state.revision, 'acquiring'),
          state.revision,
        )
        state = await uow.acquisition.putState(
          buildMigratedAcquisitionState(unit, contexts, nowIso, metadata, state.revision, 'ready_for_check'),
          state.revision,
        )
        await uow.acquisition.putState(
          buildMigratedAcquisitionState(unit, contexts, nowIso, metadata, state.revision, 'graduated'),
          state.revision,
        )

        const initialReviewState = {
          ...migratedReviewState,
          state: 'new',
          due_at: nowIso,
          stability: 0,
          difficulty: 1,
          elapsed_days: 0,
          scheduled_days: 0,
          reps: 0,
          lapses: 0,
          learning_steps: 0,
          last_review_at: null,
          revision: 0,
        }
        await uow.review.putInitial(initialReviewState)
        const storedReviewState = await uow.review.update(migratedReviewState, 0)
        await uow.events.append(buildMigrationEvent(
          candidate.word,
          candidate.reviewState,
          storedReviewState,
          unit,
          contexts,
          nowIso,
          metadata,
        ))
        return {
          status: 'migrated',
          word_id: candidate.word.id,
          learning_unit_id: unit.learning_unit_id,
          context_count: contexts.length,
          context_revalidation_required: contexts.length > 0,
        }
      },
    )
    return result
  }

  async function migrateNextBatch(options = {}) {
    const batchSize = Math.min(100, Math.max(1, Number(options.batchSize || DEFAULT_BATCH_SIZE)))
    const migratedWordIds = await getMigratedWordIds()
    const legacySnapshot = await legacyRepository.loadSnapshot()
    const plan = buildLegacyVocabularyMigrationPlan(legacySnapshot, migratedWordIds)
    const results = []
    for (const candidate of plan.ready.slice(0, batchSize)) {
      try {
        results.push(await migrateCandidate(candidate))
      } catch (error) {
        results.push({
          status: 'error',
          word_id: candidate.word.id,
          message: error?.message || String(error),
        })
      }
    }
    const status = await getStatus()
    return { ...status, results }
  }

  async function migrateAll(options = {}) {
    const allResults = []
    const maxBatches = Math.max(1, Number(options.maxBatches || 1000))
    for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
      const batch = await migrateNextBatch({ batchSize: options.batchSize })
      allResults.push(...batch.results)
      options.onProgress?.(batch)
      const migratedThisBatch = batch.results.filter((item) => (
        item.status === 'migrated' || item.status === 'already_migrated'
      )).length
      if (batch.remaining === 0 || migratedThisBatch === 0) {
        return { ...batch, results: allResults }
      }
    }
    const status = await getStatus()
    return { ...status, results: allResults }
  }

  return {
    migrationVersion: LEGACY_VOCABULARY_MIGRATION_VERSION,
    getMigratedWordIds,
    getStatus,
    migrateNextBatch,
    migrateAll,
  }
}
