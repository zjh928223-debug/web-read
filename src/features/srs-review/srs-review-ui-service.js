import {
  createIndexedDbAcquisitionRepository,
} from '../../services/vocabulary/vocabulary-acquisition-repository.js'
import {
  createIndexedDbContextEvidenceRepository,
} from '../../services/vocabulary/vocabulary-context-evidence.js'
import {
  createIndexedDbLearningEventRepository,
} from '../../services/vocabulary/vocabulary-learning-events.js'
import {
  createIndexedDbVocabularyRepository,
} from '../../services/vocabulary/vocabulary-repository.js'
import {
  createIndexedDbReviewSessionLedgerRepository,
  createIndexedDbReviewStateReader,
} from '../../services/vocabulary/srs-review-session-ledger.js'
import {
  createSrsReviewServiceV2,
} from '../../services/vocabulary/srs-review-service-v2.js'
import {
  createIndexedDbPersonalizationShadowReportRepository,
} from '../../services/vocabulary/personalization/personalization-shadow-report-repository.js'
import {
  createPersonalizationShadowService,
} from '../../services/vocabulary/personalization/personalization-shadow-service.js'
import { normalizeReviewPolicy } from './srs-review-policy.js'

export const SRS_REVIEW_UI_SERVICE_VERSION = 'srs-review-ui-service.v1'

export function createSrsReviewUiService(options = {}) {
  const indexedDBApi = options.indexedDBApi
  const acquisitionRepository = options.acquisitionRepository
    || createIndexedDbAcquisitionRepository({ indexedDBApi })
  const contextEvidenceRepository = options.contextEvidenceRepository
    || createIndexedDbContextEvidenceRepository({ indexedDBApi })
  const learningEventRepository = options.learningEventRepository
    || createIndexedDbLearningEventRepository({ indexedDBApi })
  const sessionLedgerRepository = options.sessionLedgerRepository
    || createIndexedDbReviewSessionLedgerRepository({ indexedDBApi })
  const reviewStateRepository = options.reviewStateRepository
    || createIndexedDbReviewStateReader({ indexedDBApi })
  const contentRepository = options.contentRepository
    || createIndexedDbVocabularyRepository({ indexedDBApi })
  const managementService = options.managementService || null
  let personalizationShadowRunner = options.personalizationShadowRunner || null
  if (!options.reviewService && !personalizationShadowRunner) {
    const personalizationShadowReportRepository = options.personalizationShadowReportRepository
      || createIndexedDbPersonalizationShadowReportRepository({ indexedDBApi })
    personalizationShadowRunner = createPersonalizationShadowService({
      reportRepository: personalizationShadowReportRepository,
    })
  }
  const policyProvider = typeof options.policyProvider === 'function'
    ? options.policyProvider
    : () => options.policy
  const reviewService = options.reviewService || createSrsReviewServiceV2({
    indexedDBApi,
    acquisitionRepository,
    reviewStateRepository,
    learningEventRepository,
    sessionLedgerRepository,
    personalizationShadowRunner,
    personalizationShadowEnabled: options.personalizationShadowEnabled,
    featureFlags: options.featureFlags,
    onPersonalizationShadowError: options.onPersonalizationShadowError,
    now: options.now,
  })

  async function getReviewCards(ledger) {
    const [acquisitionSnapshot, contentSnapshot] = await Promise.all([
      acquisitionRepository.loadSnapshot(),
      contentRepository.loadSnapshot(),
    ])
    const pairs = acquisitionSnapshot.by_learning_unit_id || {}
    const wordsById = new Map(
      (contentSnapshot.words || []).map((word) => [String(word.id), word]),
    )
    const legacyContextsByWordId = groupBy(
      contentSnapshot.contexts || [],
      (context) => String(context.word_id || ''),
    )

    return Promise.all((ledger?.entries || []).map(async (ledgerEntry) => {
      const pair = pairs[ledgerEntry.learning_unit_id]
      if (!pair || pair.acquisition_state?.status !== 'graduated') return null
      const unit = pair.learning_unit
      const [reviewState, evidence] = await Promise.all([
        reviewStateRepository.getByLearningUnitId(unit.learning_unit_id),
        contextEvidenceRepository.listByLearningUnit(unit.learning_unit_id),
      ])
      if (!reviewState) return null
      const word = normalizeReviewWord(wordsById.get(String(unit.word_id)), unit)
      const evidenceContexts = evidence.map((item) => evidenceToReviewContext(item, unit))
      const legacyContexts = legacyContextsByWordId.get(String(unit.word_id)) || []
      const allContexts = deduplicateContexts([...evidenceContexts, ...legacyContexts])
      const prompt = resolvePromptSelection(
        ledgerEntry,
        allContexts,
        pair.acquisition_state?.validated_anchor_id,
      )
      return {
        word,
        contexts: prompt.contexts,
        reviewState,
        learningUnit: unit,
        ledgerEntry,
        promptMode: prompt.mode,
      }
    })).then((items) => items.filter(Boolean))
  }

  async function hasReviewCards(input = {}) {
    const sessionId = input.session_id
    if (sessionId) {
      const existing = await sessionLedgerRepository.getBySessionId(sessionId)
      if (existing) {
        if (existing.status === 'completed' || existing.status === 'abandoned') return false
        const completedIds = completedLedgerItemIds(existing)
        if (existing.entries.some((entry) => !completedIds.has(entry.ledger_item_id))) return true
      }
    }
    const snapshot = await acquisitionRepository.loadSnapshot()
    const graduated = Object.values(snapshot.by_learning_unit_id || {})
      .filter((pair) => pair.acquisition_state?.status === 'graduated')
    const nowMs = Date.parse(input.now || new Date().toISOString())
    for (const pair of graduated) {
      const state = await reviewStateRepository.getByLearningUnitId(
        pair.learning_unit.learning_unit_id,
      )
      if (state && Date.parse(state.due_at) <= nowMs) return true
    }
    return false
  }

  const service = {
    uiServiceVersion: SRS_REVIEW_UI_SERVICE_VERSION,
    startReviewSession: reviewService.startReviewSession,
    resumeReviewSession: reviewService.resumeReviewSession,
    recordReviewAttempt: reviewService.recordReviewAttempt,
    completeReviewSession: reviewService.completeReviewSession,
    hasReviewCards,
    getReviewCards,
    getReviewPolicy() {
      return normalizeReviewPolicy(policyProvider() || {})
    },
    async getReviewEvents() {
      return learningEventRepository.query({ event_type: 'review_attempt_recorded' })
    },
  }

  if (typeof managementService?.cacheGeneralMeanings === 'function') {
    service.cacheGeneralMeanings = (...args) => managementService.cacheGeneralMeanings(...args)
  }
  return service
}

function completedLedgerItemIds(ledger) {
  const completed = new Set(ledger?.extensions?.completed_item_ids || [])
  for (const receipt of Object.values(ledger?.extensions?.attempt_results_by_id || {})) {
    const ledgerItemId = receipt?.ledger_item_id
      || receipt?.result?.ledger_item_id
      || receipt?.attempt?.ledger_item_id
    if (ledgerItemId) completed.add(String(ledgerItemId))
  }
  return completed
}

function normalizeReviewWord(existing, unit) {
  const targetSense = unit.target_sense || {}
  return {
    ...(existing || {}),
    id: unit.word_id,
    word: existing?.word || unit.normalized_form,
    lemma: existing?.lemma || unit.normalized_form,
    language: existing?.language || unit.language,
    meaning: existing?.meaning || targetSense.gloss || targetSense.definition || '',
    simple_meaning: existing?.simple_meaning || targetSense.gloss || '',
    part_of_speech: existing?.part_of_speech || targetSense.part_of_speech || '',
  }
}

function evidenceToReviewContext(evidence, unit) {
  return {
    id: evidence.context_evidence_id,
    context_evidence_id: evidence.context_evidence_id,
    word_id: unit.word_id,
    sentence: evidence.sentence,
    surrounding_text: evidence.surrounding_text,
    source_id: evidence.source_id,
    source_title: evidence.source_title,
    source_kind: evidence.source_kind,
    source_locator: evidence.source_locator,
    meaning: unit.target_sense?.gloss || '',
    simple_meaning: unit.target_sense?.gloss || '',
    created_at: evidence.created_at,
    extensions: evidence.extensions || {},
  }
}

function resolvePromptMode(ledgerEntry, contexts) {
  const requested = ledgerEntry?.extensions?.prompt_mode
  if (isPromptMode(requested)) return requested
  const contextMode = contexts.find((context) => isPromptMode(context?.extensions?.prompt_mode))
    ?.extensions?.prompt_mode
  if (isPromptMode(contextMode)) return contextMode
  return contexts.length ? 'original_context' : 'word_only'
}

function resolvePromptSelection(ledgerEntry, contexts, validatedAnchorId) {
  let mode = resolvePromptMode(ledgerEntry, contexts)
  const anchorId = String(validatedAnchorId || '')
  const original = contexts.filter((context) => (
    anchorId
      ? String(context.context_evidence_id || context.id || '') === anchorId
      : true
  ))
  const transfer = anchorId
    ? contexts.filter((context) => (
      Boolean(context.context_evidence_id)
      && String(context.context_evidence_id) !== anchorId
    ))
    : []
  if (mode === 'transfer_context' && !transfer.length) {
    mode = contexts.length ? 'original_context' : 'word_only'
  }
  if (mode === 'transfer_context') return { mode, contexts: transfer }
  if (mode === 'original_context') return { mode, contexts: original.length ? original : contexts }
  return { mode, contexts }
}

function isPromptMode(value) {
  return ['word_only', 'original_context', 'transfer_context'].includes(value)
}

function deduplicateContexts(contexts) {
  const seen = new Set()
  return contexts.filter((context) => {
    const key = [
      context?.context_evidence_id || context?.id || '',
      context?.sentence || '',
      context?.source_id || '',
    ].join('\u001f')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function groupBy(items, keyForItem) {
  const groups = new Map()
  for (const item of items) {
    const key = keyForItem(item)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return groups
}
