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
import { getWindowsOwnerVocabularySrsIntegration } from '../../services/vocabulary/windows-owner-vocabulary-srs.js'
import { isSrsReviewParticipationExcluded } from '../../services/vocabulary/vocabulary-models.js'
import { normalizeReviewPolicy } from './srs-review-policy.js'
import { isSettlementSimpleMeaningValid } from '../../services/vocabulary/settlement-meaning-refinement.js'

export const SRS_REVIEW_UI_SERVICE_VERSION = 'srs-review-ui-service.v1'

export function createSrsReviewUiService(options = {}) {
  const indexedDBApi = options.indexedDBApi
  const ownerIntegration = options.ownerIntegration
    || getWindowsOwnerVocabularySrsIntegration(options.windowObject || globalThis)
  const acquisitionRepository = options.acquisitionRepository
    || ownerIntegration?.acquisitionRepository
    || createIndexedDbAcquisitionRepository({ indexedDBApi })
  const contextEvidenceRepository = options.contextEvidenceRepository
    || ownerIntegration?.contextEvidenceRepository
    || createIndexedDbContextEvidenceRepository({ indexedDBApi })
  const learningEventRepository = createWarmableLearningEventRepository(
    options.learningEventRepository || ownerIntegration?.learningEventRepository
      || createIndexedDbLearningEventRepository({ indexedDBApi }),
  )
  const sessionLedgerRepository = options.sessionLedgerRepository
    || ownerIntegration?.sessionLedgerRepository
    || createIndexedDbReviewSessionLedgerRepository({ indexedDBApi })
  const reviewStateRepository = options.reviewStateRepository
    || ownerIntegration?.reviewStateRepository
    || createIndexedDbReviewStateReader({ indexedDBApi })
  const contentRepository = options.contentRepository
    || ownerIntegration?.vocabularyRepository
    || createIndexedDbVocabularyRepository({ indexedDBApi })
  const managementService = options.managementService || null
  const personalizationShadowRunner = options.personalizationShadowRunner || null
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
    runUnitOfWork: options.runVocabularyLearningUnitOfWork
      || ownerIntegration?.runVocabularyLearningUnitOfWork,
  })
  function warmReviewData() {
    return learningEventRepository.warmReviewEvents().then(() => true)
  }

  async function loadReviewStatesById(learningUnitIds) {
    if (typeof reviewStateRepository.loadSnapshot === 'function') {
      const snapshot = await reviewStateRepository.loadSnapshot()
      return snapshot.by_learning_unit_id || {}
    }
    const entries = await Promise.all(learningUnitIds.map(async (learningUnitId) => (
      [learningUnitId, await reviewStateRepository.getByLearningUnitId(learningUnitId)]
    )))
    return Object.fromEntries(entries.filter(([, state]) => state))
  }

  async function getReviewCards(ledger) {
    const ledgerEntries = ledger?.entries || []
    const learningUnitIds = ledgerEntries.map((entry) => entry.learning_unit_id)
    const [acquisitionSnapshot, contentSnapshot, reviewStatesById, contextSnapshot] = await Promise.all([
      acquisitionRepository.loadSnapshot(),
      contentRepository.loadSnapshot(),
      loadReviewStatesById(learningUnitIds),
      typeof contextEvidenceRepository.loadSnapshot === 'function'
        ? contextEvidenceRepository.loadSnapshot()
        : Promise.resolve(null),
    ])
    const pairs = acquisitionSnapshot.by_learning_unit_id || {}
    const wordsById = new Map(
      (contentSnapshot.words || []).map((word) => [String(word.id), word]),
    )
    const legacyContextsByWordId = groupBy(
      contentSnapshot.contexts || [],
      (context) => String(context.word_id || ''),
    )

    const evidenceByLearningUnitId = contextSnapshot
      ? groupBy(
        Object.values(contextSnapshot.by_context_evidence_id || {}),
        (evidence) => String(evidence.learning_unit_id || ''),
      )
      : null

    return Promise.all(ledgerEntries.map(async (ledgerEntry) => {
      const pair = pairs[ledgerEntry.learning_unit_id]
      if (!pair
        || pair.acquisition_state?.status !== 'graduated'
        || isSrsReviewParticipationExcluded(
          pair.learning_unit?.extensions?.srs_review_participation,
        )) return null
      const unit = pair.learning_unit
      const reviewState = reviewStatesById[unit.learning_unit_id]
      const evidence = evidenceByLearningUnitId
        ? (evidenceByLearningUnitId.get(String(unit.learning_unit_id)) || [])
        : await contextEvidenceRepository.listByLearningUnit(unit.learning_unit_id)
      if (!reviewState) return null
      const word = normalizeReviewWord(wordsById.get(String(unit.word_id)), unit)
      if (isSrsReviewParticipationExcluded(word.review_participation)) return null
      const legacyContexts = legacyContextsByWordId.get(String(unit.word_id)) || []
      const evidenceContexts = deduplicateContexts(
        evidence.map((item) => evidenceToReviewContext(item, unit, legacyContexts, word.entry_type)),
      )
      const prompt = resolvePromptSelection(
        ledgerEntry,
        evidenceContexts,
        pair.acquisition_state?.validated_anchor_id,
        unit,
      )
      return {
        word,
        contexts: prompt.contexts,
        contextSelection: prompt.contextSelection,
        reviewState,
        learningUnit: unit,
        ledgerEntry,
        promptMode: prompt.mode,
      }
    })).then((items) => items.filter(Boolean))
  }

  async function activatePreviewForNewSession(input = {}) {
    if (typeof managementService?.activatePendingPreviewLearning !== 'function') return null
    const sessionId = input.session_id
    if (sessionId && await sessionLedgerRepository.getBySessionId(sessionId)) return null
    return managementService.activatePendingPreviewLearning({
      now: input.now,
      timezone: input.timezone,
      local_day: input.local_day,
    })
  }

  async function hasReviewCards(input = {}) {
    const sessionId = input.session_id
    let existingSession = null
    if (sessionId) {
      existingSession = await sessionLedgerRepository.getBySessionId(sessionId)
      if (existingSession) {
        if (existingSession.status === 'completed' || existingSession.status === 'abandoned') return false
        const completedIds = completedLedgerItemIds(existingSession)
        const existingCards = await getReviewCards(existingSession)
        if (existingCards.some((card) => !completedIds.has(card.ledgerEntry.ledger_item_id))) return true
      }
    }
    if (!existingSession) await activatePreviewForNewSession(input)
    const snapshot = await acquisitionRepository.loadSnapshot()
    const graduated = Object.values(snapshot.by_learning_unit_id || {})
      .filter((pair) => pair.acquisition_state?.status === 'graduated'
        && !isSrsReviewParticipationExcluded(
          pair.learning_unit?.extensions?.srs_review_participation,
        ))
    const reviewStatesById = await loadReviewStatesById(
      graduated.map((pair) => pair.learning_unit.learning_unit_id),
    )
    const nowMs = Date.parse(input.now || new Date().toISOString())
    for (const pair of graduated) {
      const state = reviewStatesById[pair.learning_unit.learning_unit_id]
      if (state && Date.parse(state.due_at) <= nowMs) return true
    }
    return false
  }

  async function removeWordFromReview(input = {}) {
    if (input.source === 'legacy') {
      if (typeof managementService?.removeWordFromReview !== 'function') {
        throw new Error('Legacy SRS review removal service is unavailable')
      }
      return managementService.removeWordFromReview(input.word_id || input.wordId, input)
    }
    if (typeof reviewService.removeWordFromReview !== 'function') {
      throw new Error('V2 SRS review removal service is unavailable')
    }
    const result = await reviewService.removeWordFromReview(input)
    // The V2 learning-unit/ledger commit is authoritative. Mirror the
    // compatibility word marker only after that commit succeeds so a failed
    // V2 UOW cannot make a reload hide the still-recoverable card.
    let legacyWordResult = null
    if (typeof managementService?.removeWordFromReview === 'function') {
      legacyWordResult = await managementService.removeWordFromReview(
        input.word_id || input.wordId,
        input,
      )
    }
    return { ...result, legacyWordResult }
  }

  async function startReviewSession(input = {}) {
    const sessionId = input.session_id
    const existing = sessionId
      ? await sessionLedgerRepository.getBySessionId(sessionId)
      : null
    if (!existing) await activatePreviewForNewSession(input)
    return reviewService.startReviewSession(input)
  }

  const service = {
    uiServiceVersion: SRS_REVIEW_UI_SERVICE_VERSION,
    startReviewSession,
    resumeReviewSession: reviewService.resumeReviewSession,
    recordReviewAttempt: reviewService.recordReviewAttempt,
    removeWordFromReview,
    completeReviewSession: reviewService.completeReviewSession,
    hasReviewCards,
    warmReviewData,
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

function createWarmableLearningEventRepository(repository) {
  let reviewEventsRequest = null
  const isReviewEventQuery = (input = {}) => (
    Object.keys(input).length === 1 && input.event_type === 'review_attempt_recorded'
  )
  return {
    ...repository,
    async append(...args) {
      reviewEventsRequest = null
      return repository.append(...args)
    },
    query(input = {}) {
      if (!isReviewEventQuery(input)) return repository.query(input)
      if (!reviewEventsRequest) {
        reviewEventsRequest = Promise.resolve(repository.query(input)).catch((error) => {
          reviewEventsRequest = null
          throw error
        })
      }
      return reviewEventsRequest
    },
    warmReviewEvents() {
      return this.query({ event_type: 'review_attempt_recorded' })
    },
  }
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

function evidenceToReviewContext(evidence, unit, legacyContexts = [], entryType) {
  // Article settlement keeps the original sense identity. Its saved short
  // meaning belongs to the same source sentence, not the unit's sense gloss.
  const matches = unit.extensions?.source === 'article-settlement'
    ? legacyContexts.filter((context) => (
      String(context.word_id) === String(unit.word_id)
      && Boolean(evidence.source_id)
      && String(context.source_id) === String(evidence.source_id)
      && context.sentence === evidence.sentence
      && normalizeSenseGloss(context.meaning) === normalizeSenseGloss(unit.target_sense?.gloss)
    ))
    : []
  const savedContext = matches.length === 1 ? matches[0] : null
  const shortMeaning = savedContext?.simple_meaning || savedContext?.simpleMeaning
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
    meaning: savedContext?.meaning || unit.target_sense?.gloss || '',
    simple_meaning: isSettlementSimpleMeaningValid(shortMeaning, entryType)
      ? shortMeaning : unit.target_sense?.gloss || '',
    created_at: evidence.created_at,
    extensions: evidence.extensions || {},
  }
}

function normalizeSenseGloss(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

function resolvePromptMode(ledgerEntry, contexts) {
  const requested = ledgerEntry?.extensions?.prompt_mode
  if (isPromptMode(requested)) return requested
  const contextMode = contexts.find((context) => isPromptMode(context?.extensions?.prompt_mode))
    ?.extensions?.prompt_mode
  if (isPromptMode(contextMode)) return contextMode
  return contexts.length ? 'original_context' : 'word_only'
}

function resolvePromptSelection(ledgerEntry, contexts, validatedAnchorId, unit) {
  let mode = resolvePromptMode(ledgerEntry, contexts)
  const anchorId = String(validatedAnchorId || '')
  const sourceHints = collectContextSourceHints(ledgerEntry, unit)
  const validContexts = (Array.isArray(contexts) ? contexts : []).filter(Boolean)
  const anchor = anchorId
    ? validContexts.find((context) => contextIdentity(context) === anchorId)
    : null
  if (anchorId && !anchor) {
    return {
      mode: 'word_only',
      contexts: [],
      contextSelection: createContextSelection({
        status: 'validated_anchor_missing',
        unit,
        message: '当前学习单元的已验证原句无法读回；未借用同词其他语境。请先核对来源。',
      }),
    }
  }

  let candidates = validContexts
  if (mode === 'transfer_context' && anchor) {
    const transfer = validContexts.filter((context) => contextIdentity(context) !== anchorId)
    if (transfer.length) candidates = transfer
    else mode = 'original_context'
  } else if (anchor) {
    candidates = [anchor]
  }

  const selected = selectUnitContext(candidates, sourceHints)
  if (!selected.context) {
    return {
      mode: 'word_only',
      contexts: [],
      contextSelection: createContextSelection({
        status: selected.status,
        unit,
        message: selected.message,
      }),
    }
  }
  return {
    mode,
    contexts: [selected.context],
    contextSelection: createContextSelection({
      status: anchor ? 'validated_anchor' : selected.status,
      unit,
      context: selected.context,
    }),
  }
}

function selectUnitContext(contexts, sourceHints) {
  const valid = (Array.isArray(contexts) ? contexts : []).filter((context) => (
    hasContextText(context?.sentence)
    || hasContextText(context?.surrounding_text || context?.surroundingText)
  ))
  if (!valid.length) {
    return {
      context: null,
      status: 'missing_unit_evidence',
      message: '当前学习单元没有可确认的原句或来源；未借用同词其他语境。',
    }
  }
  if (valid.length === 1) {
    return { context: valid[0], status: 'single_unit_evidence', message: '' }
  }
  const matched = valid.filter((context) => contextMatchesSourceHints(context, sourceHints))
  if (matched.length === 1) {
    return { context: matched[0], status: 'unit_source_match', message: '' }
  }
  return {
    context: null,
    status: matched.length > 1 ? 'ambiguous_source_match' : 'ambiguous_unit_evidence',
    message: matched.length > 1
      ? '当前学习单元匹配到多个来源语境；未选择最新一条，请先核对来源。'
      : '当前学习单元有多个语境但没有准确来源匹配；未选择最新一条，也未借用同词其他语境。',
  }
}

function collectContextSourceHints(ledgerEntry, unit) {
  const values = [
    ledgerEntry?.extensions?.context_evidence_id,
    ledgerEntry?.extensions?.contextEvidenceId,
    ledgerEntry?.extensions?.source_id,
    ledgerEntry?.extensions?.sourceId,
    ledgerEntry?.extensions?.source_locator?.local_locator,
    ledgerEntry?.extensions?.preview_item_id,
    ledgerEntry?.extensions?.previewItemId,
    unit?.extensions?.context_evidence_id,
    unit?.extensions?.contextEvidenceId,
    unit?.extensions?.source_id,
    unit?.extensions?.sourceId,
    unit?.extensions?.source_locator?.local_locator,
    unit?.extensions?.preview_item_id,
    unit?.extensions?.previewItemId,
  ]
  return new Set(values.map((value) => String(value || '').trim()).filter(Boolean))
}

function contextMatchesSourceHints(context, sourceHints) {
  if (!sourceHints?.size) return false
  const values = [
    contextIdentity(context),
    context?.source_id,
    context?.sourceId,
    context?.source_locator?.local_locator,
    context?.extensions?.preview_item_id,
    context?.extensions?.previewItemId,
  ].map((value) => String(value || '').trim()).filter(Boolean)
  return values.some((value) => sourceHints.has(value))
}

function contextIdentity(context) {
  return String(context?.context_evidence_id || context?.id || '').trim()
}

function hasContextText(value) {
  return Boolean(String(value || '').trim())
}

function createContextSelection({ status, unit, context, message = '' }) {
  return {
    status,
    learning_unit_id: String(unit?.learning_unit_id || ''),
    selected_context_id: contextIdentity(context) || null,
    source_id: String(context?.source_id || context?.sourceId || ''),
    message: String(message || ''),
  }
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
