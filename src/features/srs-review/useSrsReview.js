import { computed, ref } from 'vue'
import { REVIEW_RATINGS } from '../../services/vocabulary/index.js'
import { diversifyReviewQueue } from './srs-review-queue.js'
import { initialReviewCueLevel } from './srs-review-prompt.js'
import {
  isLegacyReviewService,
  isReviewServiceV2,
} from './srs-review-source-selector.js'

export const SRS_REVIEW_ACTIONS = Object.freeze([
  Object.freeze({ shortcut: '1', label: '忘记', rating: REVIEW_RATINGS.AGAIN, tone: 'again' }),
  Object.freeze({ shortcut: '2', label: '困难', rating: REVIEW_RATINGS.HARD, tone: 'hard' }),
  Object.freeze({ shortcut: '3', label: '一般', rating: REVIEW_RATINGS.GOOD, tone: 'good' }),
  Object.freeze({ shortcut: '4', label: '容易', rating: REVIEW_RATINGS.EASY, tone: 'easy' }),
])

const SAVE_STATUS_LABELS = Object.freeze({
  accepted: '已作答，等待后台保存',
  saving: '已作答，正在保存…',
  confirmed: '已确认保存',
  failed: '保存失败，等待核对',
  unknown: '结果未知，保留原评分',
})

const QUEUE_KIND_LABELS = Object.freeze({
  due_review: '到期复习',
  relearning: '重学',
  reassessment: '重新评估',
  acquisition: '新学习单元',
  revisit: '同日重访',
  legacy_batch: 'legacy 当前批次',
})

const SOURCE_REASON_LABELS = Object.freeze({
  direct_v2: '直接使用 V2 复习服务',
  direct_legacy: '直接使用 legacy 复习服务',
  v2_cards_available: 'V2 有可复习卡',
  v2_cards_available_after_retry: 'V2 重试探测后有可复习卡',
  v2_cards_unavailable: 'V2 当前没有可复习卡，已回退 legacy',
  v2_probe_failed: 'V2 探测失败，已回退 legacy',
  v2_feature_flag_off: 'V2 功能开关关闭，使用 legacy',
})

const RATING_LABELS = Object.freeze({
  again: '忘记',
  hard: '困难',
  good: '一般',
  easy: '容易',
})

export function getReviewActionForShortcut(key) {
  return SRS_REVIEW_ACTIONS.find((action) => action.shortcut === String(key || '')) || null
}

export function useSrsReview(service, options = {}) {
  const usesSourceSelector = typeof service?.resolveReviewSource === 'function'
  let activeService = usesSourceSelector ? null : service
  let usesReviewServiceV2 = isReviewServiceV2(activeService)
  let usesLegacyService = isLegacyReviewService(activeService)
  if (!usesSourceSelector && !usesReviewServiceV2 && !usesLegacyService) {
    throw new Error('SRS review requires a vocabulary service')
  }

  const queue = ref([])
  const index = ref(0)
  const viewIndex = ref(0)
  const loading = ref(true)
  const pending = ref(false)
  const backgroundSaving = ref(0)
  const error = ref('')
  const saveErrorNotice = ref('')
  const removeError = ref('')
  const loaded = ref(false)
  const now = options.now
  const dailyTotal = ref(0)
  const completedBeforeOpen = ref(0)
  const reviewLogs = ref([])
  const reviewDate = ref(resolveReviewDate(now))
  const sessionRatingCounts = ref(createEmptyRatingCounts())
  const sessionLedger = ref(null)
  const reviewSource = ref(usesReviewServiceV2 ? 'v2' : (usesLegacyService ? 'legacy' : ''))
  const reviewSourceReason = ref(usesReviewServiceV2 ? 'direct_v2' : (usesLegacyService ? 'direct_legacy' : ''))
  const reviewSourceProbeError = ref('')
  const contextCueLevel = ref('none')
  const eligibilityNowMs = ref(resolveNowMilliseconds(now))
  const legacyBacklogCount = ref(0)
  const committedItemIds = new Set()
  const attemptDrafts = new Map()
  const saveStates = ref(new Map())
  const legacyBatchSize = Math.max(1, Math.floor(Number(options.legacyBatchSize) || 30))
  let legacyPendingQueue = []
  let saveQueue = []
  let savePumpPromise = null
  let saveRunnerPaused = false
  const removalOperationIds = new Map()
  const removedWithoutRating = ref(false)
  const savePipelineBlocked = ref(false)
  let reviewEventsRequest = 0
  let reviewLoadRequest = 0
  let reviewSessionGeneration = 0
  let activeSessionScope = createReviewSessionScope({
    source: reviewSource.value,
    sessionId: '',
    generation: reviewSessionGeneration,
  })
  let cardStartedAt = resolveNowMilliseconds(now)

  const current = computed(() => queue.value[viewIndex.value] || null)
  const total = computed(() => queue.value.length)
  const reviewingPast = computed(() => viewIndex.value < index.value)
  const canPrevious = computed(() => viewIndex.value > 0)
  const canNext = computed(() => viewIndex.value < Math.min(index.value, total.value))
  const hasExcludedReviewItems = computed(() => Boolean(
    removedWithoutRating.value
      || sessionLedger.value?.extensions?.srs_review_excluded_ledger_item_ids?.length,
  ))
  const empty = computed(() => loaded.value && (
    dailyTotal.value === 0
    || (hasExcludedReviewItems.value && !current.value && viewIndex.value >= total.value)
  ))
  const reviewHistory = computed(() => summarizeReviewLogs(reviewLogs.value, reviewDate.value))
  const mode = computed(() => sessionLedger.value?.mode || '')
  const modeLabel = computed(() => formatModeLabel(mode.value))
  const budgetMinutes = computed(() => Math.round(Number(sessionLedger.value?.budget_ms || 0) / 60000))
  const estimatedRemainingMs = computed(() => {
    const ledger = sessionLedger.value
    if (!ledger) return 0
    const completedIds = new Set(ledger.extensions?.completed_item_ids || [])
    const excludedIds = new Set(ledger.extensions?.srs_review_excluded_ledger_item_ids || [])
    return ledger.entries
      .filter((entry) => (
        !completedIds.has(entry.ledger_item_id)
        && !excludedIds.has(entry.ledger_item_id)
      ))
      .reduce((sum, entry) => sum + Number(entry.estimated_duration_ms || 0), 0)
  })
  const estimatedRemainingLabel = computed(() => formatDuration(estimatedRemainingMs.value))
  const backlogCount = computed(() => {
    if (reviewSource.value === 'legacy') return legacyBacklogCount.value
    const rawCount = sessionLedger.value?.backlog?.extensions?.total_count
    if (rawCount === null || rawCount === undefined || rawCount === '') return null
    const count = Number(rawCount)
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null
  })
  const backlogEstimatedMs = computed(() => Number(sessionLedger.value?.backlog?.estimated_ms || 0))
  const backlogLabel = computed(() => {
    if (backlogCount.value === null) return '数量未知'
    if (reviewSource.value === 'legacy') return `${backlogCount.value} 项`
    return `${backlogCount.value} 项（约 ${formatDuration(backlogEstimatedMs.value)}）`
  })
  const sourceLabel = computed(() => formatReviewSourceLabel(reviewSource.value))
  const sourceReasonLabel = computed(() => formatSourceReasonLabel(
    reviewSourceReason.value,
    reviewSourceProbeError.value,
  ))
  const currentQueueKind = computed(() => queueKindForEntry(
    current.value || queue.value[0],
    reviewSource.value,
  ))
  const currentQueueKindLabel = computed(() => formatQueueKindLabel(currentQueueKind.value))
  const currentEnqueueReason = computed(() => String(
    (current.value || queue.value[0])?.ledgerEntry?.enqueue_reason || '',
  ).trim())
  const currentEnqueueReasonLabel = computed(() => formatEnqueueReason(currentEnqueueReason.value))
  const queueSummary = computed(() => {
    if (!loaded.value) return ''
    const batch = dailyTotal.value
      ? `当前批次 ${dailyTotal.value} 张`
      : '当前批次为空（不代表今日全部完成）'
    const backlog = reviewSource.value === 'legacy'
      ? `批次外待处理 ${backlogLabel.value}`
      : `计划外待处理 ${backlogLabel.value}`
    return [sourceLabel.value, currentQueueKindLabel.value, batch, backlog]
      .filter(Boolean)
      .join(' · ')
  })
  const currentCardKey = computed(() => createCurrentCardKey(
    current.value,
    reviewSource.value,
    viewIndex.value,
    sessionLedger.value?.session_id,
  ))
  const revisitReason = computed(() => formatRevisitReason(
    current.value?.ledgerEntry?.queue_kind,
    current.value?.ledgerEntry?.enqueue_reason,
  ))
  const currentEligible = computed(() => {
    const plannedDueAt = current.value?.ledgerEntry?.planned_due_at
    if (!plannedDueAt) return true
    return Date.parse(plannedDueAt) <= eligibilityNowMs.value
  })
  const deferredRevisit = computed(() => Boolean(
    usesReviewServiceV2
    && current.value?.ledgerEntry?.queue_kind === 'revisit'
    && !reviewingPast.value
    && !currentEligible.value
    && index.value >= dailyTotal.value
  ))
  const completed = computed(() => (
    loaded.value
    && dailyTotal.value > 0
    && !hasExcludedReviewItems.value
    && (
      deferredRevisit.value
      || (index.value >= total.value && viewIndex.value >= total.value)
    )
  ))
  const progress = computed(() => {
    if (!current.value) return ''
    if (usesReviewServiceV2) {
      if (!reviewingPast.value && viewIndex.value >= dailyTotal.value) {
        return currentEligible.value ? '同日重访' : `复习 ${dailyTotal.value} / ${dailyTotal.value}`
      }
      const position = Math.min(viewIndex.value + 1, dailyTotal.value)
      return `${reviewingPast.value ? '回顾' : '复习'} ${position} / ${dailyTotal.value}`
    }
    return `${reviewingPast.value ? '回顾' : '复习'} ${completedBeforeOpen.value + viewIndex.value + 1} / ${dailyTotal.value}`
  })
  const currentEligibilityLabel = computed(() => {
    if (currentEligible.value) return ''
    const remaining = Date.parse(current.value?.ledgerEntry?.planned_due_at) - eligibilityNowMs.value
    return `这次同日重访将在约 ${formatDuration(remaining)} 后可评分`
  })
  const isReviewServiceV2Active = computed(() => reviewSource.value === 'v2')
  const hasSurroundingContext = computed(() => {
    const context = selectAttemptContext(
      current.value?.contexts,
      current.value?.contextSelection?.selected_context_id,
    )
    const sentence = String(context?.sentence || '').trim()
    const surrounding = String(context?.surrounding_text || context?.surroundingText || '').trim()
    return Boolean(surrounding && surrounding !== sentence)
  })
  const contextNotice = computed(() => String(
    current.value?.contextSelection?.message || '',
  ).trim())
  const saveItems = computed(() => [...saveStates.value.values()]
    .map(toPublicSaveState))
  const saveSummary = computed(() => summarizeSaveStates(saveItems.value, savePipelineBlocked.value))
  const saveError = computed(() => {
    const unresolved = saveItems.value
      .filter((item) => ['failed', 'unknown'].includes(item.status))
      .map((item) => `${item.wordLabel} · ${item.ratingLabel}：${item.errorMessage || item.statusLabel}`)
    return [saveErrorNotice.value, ...unresolved].filter(Boolean).join('；')
  })
  const hasUnconfirmedSaves = computed(() => saveSummary.value.unconfirmedCount > 0)
  const hasSaveFailure = computed(() => saveSummary.value.unresolvedCount > 0)
  const ratingBlocked = computed(() => savePipelineBlocked.value || hasSaveFailure.value)
  const canRemoveCurrent = computed(() => Boolean(
    options.allowRemove !== false
    && activeService
    && typeof activeService.removeWordFromReview === 'function'
    && current.value
    && !pending.value
    && !reviewingPast.value
    && !hasUnconfirmedSaves.value
    && !saveQueue.length
    && !savePumpPromise
    && !ratingBlocked.value
    && !deferredRevisit.value,
  ))
  const removeUnavailableReason = computed(() => {
    if (!current.value) return ''
    if (options.allowRemove === false) return '独立页仅为样本演示，不写正式学习记录。'
    if (pending.value || hasUnconfirmedSaves.value || saveQueue.length || savePumpPromise) {
      return '有未结评分，先确认或恢复原评分后再移出。'
    }
    if (reviewingPast.value) return '回顾卡不能移出，请返回当前卡后处理。'
    if (typeof activeService?.removeWordFromReview !== 'function') {
      return '当前复习源不支持安全移出。'
    }
    return ''
  })
  const completionPendingSave = computed(() => completed.value && hasUnconfirmedSaves.value)

  function setActiveReviewSessionScope({ source, sessionId }) {
    reviewSessionGeneration += 1
    activeSessionScope = createReviewSessionScope({
      source,
      sessionId,
      generation: reviewSessionGeneration,
    })
  }

  function isCurrentReviewSessionScope(record) {
    return !record || (
      record.sessionGeneration === activeSessionScope.generation
      && record.sessionScopeSource === activeSessionScope.source
      && record.sessionScopeId === activeSessionScope.sessionId
      && record.source === activeSessionScope.source
      && record.sessionId === String(activeSessionScope.sessionId || record.sessionId || '')
    )
  }

  async function load() {
    if (pending.value) return false
    if (hasUnconfirmedSaves.value || saveQueue.length || savePumpPromise) {
      // A generic load retry must not replace the current session while an
      // accepted rating still needs reconciliation. The save row remains the
      // only recovery entry for that original draft/identity.
      savePipelineBlocked.value = true
      error.value = ''
      return false
    }
    const loadRequest = ++reviewLoadRequest
    loading.value = true
    error.value = ''
    try {
      const sessionContext = resolveReviewSessionContext(options, now)
      if (usesSourceSelector) {
        const selection = await service.resolveReviewSource(sessionContext)
        activeService = selection?.service
        usesReviewServiceV2 = isReviewServiceV2(activeService)
        usesLegacyService = isLegacyReviewService(activeService)
        if (!usesReviewServiceV2 && !usesLegacyService) {
          throw new Error('SRS review source selector returned an invalid service')
        }
        reviewSource.value = selection.source
        reviewSourceReason.value = selection.reason || (
          selection.source === 'v2' ? 'direct_v2' : 'direct_legacy'
        )
        reviewSourceProbeError.value = selection.probeError?.message || ''
      }
      if (usesReviewServiceV2) {
        return await loadReviewServiceV2(sessionContext, loadRequest)
      }
      reviewDate.value = resolveReviewDate(now)
      const [due, logs] = await Promise.all([
        activeService.getDueWords(endOfLocalDayIso(reviewDate.value)),
        typeof activeService.getReviewLogs === 'function' ? activeService.getReviewLogs() : [],
      ])
      if (loadRequest !== reviewLoadRequest) return false
      reviewLogs.value = Array.isArray(logs) ? logs : []
      removeError.value = ''
      sessionRatingCounts.value = createEmptyRatingCounts()
      committedItemIds.clear()
      const reviewedToday = reviewedWordIdsForDay(reviewLogs.value, reviewDate.value)
      const eligibleQueue = diversifyReviewQueue(due).filter((entry) => (
        !reviewedToday.has(String(entry?.word?.id || ''))
      ))
      legacyPendingQueue = eligibleQueue
      startNextLegacyBatch()
      setActiveReviewSessionScope({
        source: 'legacy',
        sessionId: `legacy:${localDayKey(reviewDate.value)}`,
      })
      sessionLedger.value = null
      removedWithoutRating.value = false
      loaded.value = true
      return true
    } catch (cause) {
      if (loadRequest !== reviewLoadRequest) return false
      error.value = getErrorMessage(cause, '无法加载今日复习')
      loaded.value = false
      return false
    } finally {
      if (loadRequest === reviewLoadRequest) loading.value = false
    }
  }

  async function loadReviewServiceV2(
    sessionContext = resolveReviewSessionContext(options, now),
    loadRequest = reviewLoadRequest,
  ) {
    const eventsRequest = ++reviewEventsRequest
    reviewDate.value = resolveReviewDate(now)
    const policy = options.policy
      || (typeof activeService.getReviewPolicy === 'function' ? activeService.getReviewPolicy() : {})
    let ledger = await activeService.resumeReviewSession(sessionContext.session_id, {
      now: sessionContext.now,
    })
    if (!ledger) {
      ledger = await activeService.startReviewSession({
        session_id: sessionContext.session_id,
        now: sessionContext.now,
        timezone: sessionContext.timezone,
        local_day: sessionContext.local_day,
        policy,
      })
    }
    if (loadRequest !== reviewLoadRequest) return false
    const cards = await activeService.getReviewCards(ledger)
    if (loadRequest !== reviewLoadRequest) return false
    setActiveReviewSessionScope({
      source: 'v2',
      sessionId: ledger?.session_id || sessionContext.session_id,
    })
    sessionLedger.value = ledger
    removedWithoutRating.value = false
    queue.value = cards
    index.value = reviewQueueIndexForLedger(ledger, queue.value)
    viewIndex.value = index.value
    const completedIds = new Set(ledger.extensions?.completed_item_ids || [])
    committedItemIds.clear()
    completedIds.forEach((itemId) => committedItemIds.add(String(itemId)))
    completedBeforeOpen.value = completedIds.size
    dailyTotal.value = queue.value.length
    sessionRatingCounts.value = ratingCountsFromLedger(ledger)
    removeError.value = ''
    reviewLogs.value = []
    cardStartedAt = resolveNowMilliseconds(now)
    resetContextCue()
    loaded.value = true
    if (typeof activeService.getReviewEvents === 'function') {
      void Promise.resolve(activeService.getReviewEvents()).then((events) => {
        if (eventsRequest === reviewEventsRequest && loadRequest === reviewLoadRequest) {
          reviewLogs.value = Array.isArray(events) ? events : []
        }
      }).catch(() => {})
    }
    return true
  }

  async function submitAction(action, submitOptions = {}) {
    const entry = current.value
    const itemId = currentItemId(entry, usesReviewServiceV2)
    if (
      pending.value
      || !entry
      || reviewingPast.value
      || committedItemIds.has(itemId)
      || ratingBlocked.value
      || (usesReviewServiceV2 && !currentEligible.value)
    ) return false
    if (!SRS_REVIEW_ACTIONS.includes(action)) {
      throw new Error('Unsupported SRS review action')
    }

    const saveInBackground = submitOptions.background === true
    if (!saveInBackground) pending.value = true
    error.value = ''
    saveErrorNotice.value = ''
    try {
      if (usesReviewServiceV2) {
        const draft = prepareReviewServiceV2Attempt(entry, action, submitOptions)
        if (!draft) return false
        const serviceRef = activeService
        if (saveInBackground) {
          commitReviewAction(itemId, action)
          const record = createSaveRecord({
            itemId,
            entry,
            action,
            source: 'v2',
            service: serviceRef,
            draft,
            failureMessage: '后台保存失败，请保留原评分并重试或重新打开复核',
          })
          enqueueReviewServiceV2Save(record)
          if (submitOptions.advance !== false) advanceCurrent()
          return true
        }
        const record = createSaveRecord({
          itemId,
          entry,
          action,
          source: 'v2',
          service: serviceRef,
          draft,
          failureMessage: '评价保存失败，请重试原评分',
        })
        markSaveState(itemId, { status: 'saving', retrying: false })
        try {
          const saved = await persistReviewServiceV2Attempt(draft, serviceRef, record)
          if (!saved) throw new Error('评价服务未确认这次 V2 保存')
          const updated = markSaveState(itemId, { status: 'confirmed', retrying: false, errorMessage: '' }, record)
          if (updated && isCurrentReviewSessionScope(record)) {
            commitReviewAction(itemId, action)
            if (submitOptions.advance !== false) advanceCurrent()
          }
          return true
        } catch (cause) {
          markSaveFailure(record, cause)
          return false
        }
      }
      if (saveInBackground) {
        const serviceRef = activeService
        const reviewedAt = new Date(resolveNowMilliseconds(now)).toISOString()
        commitReviewAction(itemId, action)
        const record = createSaveRecord({
          itemId,
          entry,
          action,
          source: 'legacy',
          service: serviceRef,
          reviewedAt,
          failureMessage: 'legacy 评分结果未知；未自动重投，请重新打开后只读核对',
        })
        enqueueLegacySave(record)
        if (submitOptions.advance !== false) advanceCurrent()
        return true
      }
      const serviceRef = activeService
      const reviewedAt = new Date(resolveNowMilliseconds(now)).toISOString()
      const record = createSaveRecord({
        itemId,
        entry,
        action,
        source: 'legacy',
        service: serviceRef,
        reviewedAt,
        failureMessage: 'legacy 评分保存失败，请重试原评分',
      })
      markSaveState(itemId, { status: 'saving', retrying: false })
      try {
        const saved = await persistLegacyReviewAction(entry.word.id, action, reviewedAt, serviceRef, record)
        if (!saved) throw new Error('legacy 评价服务未确认这次保存')
        const updated = markSaveState(itemId, { status: 'confirmed', retrying: false, errorMessage: '' }, record)
        if (updated && isCurrentReviewSessionScope(record)) {
          commitReviewAction(itemId, action)
          if (submitOptions.advance !== false) advanceCurrent()
        }
        return true
      } catch (cause) {
        markSaveFailure(record, cause)
        return false
      }
    } catch (cause) {
      saveErrorNotice.value = getErrorMessage(cause, '评价保存失败，请重试')
      return false
    } finally {
      if (!saveInBackground) pending.value = false
    }
  }

  function prepareReviewServiceV2Attempt(entry, action, submitOptions) {
    const ledgerEntry = entry.ledgerEntry
    const draftKey = ledgerEntry.ledger_item_id
    let draft = attemptDrafts.get(draftKey)
    if (draft && draft.rating !== action.rating) {
      saveErrorNotice.value = '上次提交状态未知，请先重试原评分'
      return null
    }
    if (!draft) {
      draft = createAttemptDraft({
        action,
        entry,
        ledger: sessionLedger.value,
        now,
        cardStartedAt,
        cueLevel: contextCueLevel.value,
        answerRevealedBeforeRating: submitOptions.answerRevealedBeforeRating === true,
      })
      attemptDrafts.set(draftKey, draft)
    }
    return draft
  }

  async function persistReviewServiceV2Attempt(
    draft,
    serviceRef = activeService,
    record = null,
  ) {
    const previousLedger = record && !isCurrentReviewSessionScope(record)
      ? null
      : sessionLedger.value
    const result = await serviceRef.recordReviewAttempt(draft)
    if (!result) return false
    if (!record || isCurrentReviewSessionScope(record)) {
      if (!result.ledger) throw new Error('评价服务未返回可确认的 V2 ledger')
      let nextQueue = null
      if (ledgerContainsNewEntries(result.ledger, previousLedger)) {
        nextQueue = await serviceRef.getReviewCards(result.ledger)
      }
      if (record && !isCurrentReviewSessionScope(record)) return true
      sessionLedger.value = result.ledger
      if (nextQueue) queue.value = nextQueue
      reviewLogs.value = [{
        ...result.attempt,
        reviewed_at: result.attempt.occurred_at,
      }, ...reviewLogs.value]
    }
    return true
  }

  function commitReviewAction(itemId, action) {
    committedItemIds.add(itemId)
    sessionRatingCounts.value = {
      ...sessionRatingCounts.value,
      [action.tone]: sessionRatingCounts.value[action.tone] + 1,
    }
  }

  function enqueueReviewServiceV2Save(draft) {
    return enqueueBackgroundSave(
      draft,
      (record) => persistReviewServiceV2Attempt(record.draft, record.service, record),
      3,
      draft.failureMessage,
    )
  }

  function enqueueLegacySave(record) {
    return enqueueBackgroundSave(
      record,
      (currentRecord) => persistLegacyReviewAction(
        currentRecord.wordId,
        currentRecord.action,
        currentRecord.reviewedAt,
        currentRecord.service,
        currentRecord,
      ),
      1,
      record.failureMessage,
    )
  }

  async function persistLegacyReviewAction(
    wordId,
    action,
    reviewedAt,
    serviceRef = activeService,
    record = null,
  ) {
    const result = await serviceRef.reviewWord(wordId, action.rating, reviewedAt)
    if (result?.reviewLog && (!record || isCurrentReviewSessionScope(record))) {
      reviewLogs.value = [result.reviewLog, ...reviewLogs.value]
    }
    return true
  }

  function createSaveRecord({ itemId, entry, action, source, service, draft, reviewedAt, failureMessage }) {
    const key = String(itemId)
    const existing = saveStates.value.get(key)
    if (existing) return existing
    const attemptDraft = draft || {}
    const frozenDraft = draft ? Object.freeze({ ...draft }) : null
    const record = {
      itemId: key,
      source,
      service,
      draft: frozenDraft,
      wordId: String(entry?.word?.id || ''),
      wordLabel: String(entry?.word?.word || entry?.word?.id || '当前单词'),
      learningUnitId: String(attemptDraft.learning_unit_id || entry?.learningUnit?.learning_unit_id || ''),
      targetSenseId: String(attemptDraft.target_sense_id || entry?.learningUnit?.target_sense_id || ''),
      sessionId: String(
        attemptDraft.session_id
        || sessionLedger.value?.session_id
        || activeSessionScope.sessionId
        || '',
      ),
      ledgerItemId: String(attemptDraft.ledger_item_id || itemId || ''),
      commandId: String(attemptDraft.command_id || ''),
      attemptId: String(attemptDraft.attempt_id || ''),
      eventId: String(attemptDraft.event_id || ''),
      correlationId: String(attemptDraft.correlation_id || ''),
      contextEvidenceId: String(attemptDraft.context_evidence_id || entry?.contextSelection?.selected_context_id || ''),
      occurredAt: String(attemptDraft.occurred_at || reviewedAt || ''),
      action,
      rating: action.rating,
      ratingLabel: action.label,
      tone: action.tone,
      reviewedAt: reviewedAt || '',
      status: 'accepted',
      retrying: false,
      retryable: false,
      knownNotSubmitted: false,
      errorMessage: '',
      failureMessage: failureMessage || '评分保存失败，请保留原评分并核对',
      sessionGeneration: activeSessionScope.generation,
      sessionScopeSource: activeSessionScope.source,
      sessionScopeId: activeSessionScope.sessionId,
    }
    const next = new Map(saveStates.value)
    next.set(key, Object.freeze(record))
    saveStates.value = next
    return record
  }

  function markSaveState(itemId, patch, expectedRecord = null) {
    const key = String(itemId)
    const previous = saveStates.value.get(key)
    if (!previous || (expectedRecord && !sameSaveRecord(previous, expectedRecord))) return null
    const next = new Map(saveStates.value)
    const updated = { ...previous, ...patch }
    next.set(key, updated)
    saveStates.value = next
    return updated
  }

  function markSaveFailure(record, cause, fallback = record.failureMessage) {
    const status = classifySaveFailure(cause, record.source)
    const knownNotSubmitted = status === 'failed' && isExplicitReviewRejection(cause)
    const updated = markSaveState(record.itemId, {
      status,
      retrying: false,
      retryable: record.source === 'v2' || knownNotSubmitted,
      knownNotSubmitted,
      errorMessage: getErrorMessage(cause, fallback),
    }, record)
    if (!updated) return null
    savePipelineBlocked.value = true
    saveRunnerPaused = true
    return updated
  }

  async function retryReviewSave(itemId) {
    const record = saveStates.value.get(String(itemId))
    if (
      !record
      || !['failed', 'unknown'].includes(record.status)
      || !record.retryable
    ) return false
    const key = String(itemId)
    if (!saveQueue.some((job) => job.itemId === key && sameSaveRecord(job.record, record))) {
      saveQueue.unshift({
        itemId: key,
        record,
        save: record.source === 'v2'
          ? (originalRecord) => persistReviewServiceV2Attempt(originalRecord.draft, originalRecord.service, originalRecord)
          : (originalRecord) => persistLegacyReviewAction(
            originalRecord.wordId,
            originalRecord.action,
            originalRecord.reviewedAt,
            originalRecord.service,
            originalRecord,
          ),
        attempts: record.source === 'v2' ? 3 : 1,
        failureMessage: record.failureMessage,
      })
    }
    savePipelineBlocked.value = true
    saveRunnerPaused = false
    if (isCurrentReviewSessionScope(record)) saveErrorNotice.value = ''
    markSaveState(key, {
      status: 'saving',
      retrying: true,
      errorMessage: '',
    }, record)
    void pumpSaveQueue()
    return true
  }

  function enqueueBackgroundSave(record, save, attempts, failureMessage) {
    const itemId = String(record.itemId)
    if (!saveQueue.some((job) => job.itemId === itemId && sameSaveRecord(job.record, record))) {
      saveQueue.push({ itemId, record, save, attempts, failureMessage })
    }
    markSaveState(itemId, {
      status: 'accepted',
      retrying: false,
      failureMessage,
    }, record)
    void pumpSaveQueue()
    return savePumpPromise
  }

  function pumpSaveQueue() {
    if (savePumpPromise) return savePumpPromise
    if (saveRunnerPaused || !saveQueue.length) return Promise.resolve()
    savePumpPromise = (async () => {
      while (saveQueue.length && !saveRunnerPaused) {
        const job = saveQueue[0]
        const record = job.record
        const currentRecord = saveStates.value.get(job.itemId)
        if (!currentRecord || !sameSaveRecord(currentRecord, record)) {
          removeSaveQueueJob(job)
          continue
        }
        markSaveState(job.itemId, { status: 'saving', retrying: Boolean(currentRecord.retrying) }, record)
        backgroundSaving.value += 1
        try {
          await waitForReviewTransitionPaint()
          await retryBackgroundSave(
            () => job.save(record),
            job.attempts,
          )
          markSaveState(
            job.itemId,
            { status: 'confirmed', retrying: false, errorMessage: '' },
            record,
          )
          if (isCurrentReviewSessionScope(record)) saveErrorNotice.value = ''
          removeSaveQueueJob(job)
          if (!saveQueue.length && saveSummary.value.unresolvedCount === 0) {
            savePipelineBlocked.value = false
          }
        } catch (cause) {
          markSaveFailure(
            record,
            cause,
            job.failureMessage,
          )
          break
        } finally {
          backgroundSaving.value = Math.max(0, backgroundSaving.value - 1)
        }
      }
    })().finally(() => {
      savePumpPromise = null
    })
    return savePumpPromise
  }

  function removeSaveQueueJob(job) {
    const index = saveQueue.indexOf(job)
    if (index >= 0) saveQueue.splice(index, 1)
  }

  async function flushPendingSaves() {
    if (savePumpPromise) await savePumpPromise
    return saveQueue.length === 0
      && saveSummary.value.unresolvedCount === 0
      && saveSummary.value.unconfirmedCount === 0
  }

  function advanceCurrent() {
    const itemId = currentItemId(current.value, usesReviewServiceV2)
    if (!itemId || !committedItemIds.has(itemId) || reviewingPast.value) return false
    index.value = Math.min(index.value + 1, queue.value.length)
    viewIndex.value = index.value
    cardStartedAt = resolveNowMilliseconds(now)
    resetContextCue()
    return true
  }

  function continueLegacyBatch() {
    if (
      !usesLegacyService
      || !completed.value
      || hasUnconfirmedSaves.value
      || legacyPendingQueue.length === 0
    ) return false
    startNextLegacyBatch()
    return true
  }

  function startNextLegacyBatch() {
    queue.value = legacyPendingQueue.slice(0, legacyBatchSize)
    legacyPendingQueue = legacyPendingQueue.slice(queue.value.length)
    legacyBacklogCount.value = legacyPendingQueue.length
    index.value = 0
    viewIndex.value = 0
    completedBeforeOpen.value = 0
    dailyTotal.value = queue.value.length
    sessionRatingCounts.value = createEmptyRatingCounts()
    committedItemIds.clear()
    cardStartedAt = resolveNowMilliseconds(now)
    resetContextCue()
  }

  async function submitRating(rating) {
    const action = SRS_REVIEW_ACTIONS.find((item) => item.rating === rating)
    if (!action) throw new Error(`Unsupported SRS review rating: ${rating}`)
    return submitAction(action)
  }

  async function removeCurrent() {
    const entry = current.value
    if (!canRemoveCurrent.value || !entry) return false
    const wordId = String(entry.word?.id || '')
    if (!wordId) return false
    const operationKey = [
      reviewSource.value,
      activeSessionScope.sessionId,
      wordId,
      entry.ledgerEntry?.ledger_item_id || wordId,
    ].join(':')
    let operation = removalOperationIds.get(operationKey)
    if (!operation) {
      const removedAt = new Date(resolveNowMilliseconds(now)).toISOString()
      operation = Object.freeze({
        operation_id: createReviewId('remove'),
        removed_at: removedAt,
      })
      removalOperationIds.set(operationKey, operation)
    }
    const origin = {
      sessionGeneration: activeSessionScope.generation,
      sessionScopeSource: activeSessionScope.source,
      sessionScopeId: activeSessionScope.sessionId,
      source: reviewSource.value,
      sessionId: activeSessionScope.sessionId,
    }
    const cardKey = currentCardKey.value
    pending.value = true
    removeError.value = ''
    try {
      const result = await activeService.removeWordFromReview({
        source: reviewSource.value,
        session_id: activeSessionScope.sessionId,
        ledger_item_id: entry.ledgerEntry?.ledger_item_id || wordId,
        learning_unit_id: entry.learningUnit?.learning_unit_id || null,
        word_id: wordId,
        operation_id: operation.operation_id,
        removed_at: operation.removed_at,
      })
      if (!result || result.status !== 'removed') {
        throw new Error('复习服务未确认安全移出')
      }
      if (!isCurrentReviewSessionScope(origin) || currentCardKey.value !== cardKey) return true
      removedWithoutRating.value = true
      const previousViewIndex = viewIndex.value
      const nextQueue = queue.value.filter((item) => String(item?.word?.id || '') !== wordId)
      queue.value = nextQueue
      legacyPendingQueue = legacyPendingQueue.filter((item) => (
        String(item?.word?.id || '') !== wordId
      ))
      legacyBacklogCount.value = legacyPendingQueue.length
      if (result.ledger && isCurrentReviewSessionScope(origin)) {
        sessionLedger.value = result.ledger
      }
      const nextLedger = result.ledger || sessionLedger.value
      if (usesReviewServiceV2 && nextLedger) {
        index.value = reviewQueueIndexForLedger(nextLedger, nextQueue)
      } else {
        const remainingBeforeRemovedCard = queue.value
          .slice(0, previousViewIndex)
          .filter((item) => String(item?.word?.id || '') !== wordId)
          .length
        index.value = Math.min(remainingBeforeRemovedCard, nextQueue.length)
      }
      viewIndex.value = index.value
      dailyTotal.value = nextQueue.length
      cardStartedAt = resolveNowMilliseconds(now)
      return true
    } catch (cause) {
      removeError.value = getErrorMessage(cause, '移出失败，当前卡保留，可重试')
      return false
    } finally {
      pending.value = false
    }
  }

  function goPrevious() {
    if (!canPrevious.value) return false
    viewIndex.value -= 1
    resetContextCue()
    return true
  }

  function goNext() {
    if (!canNext.value) return false
    viewIndex.value += 1
    resetContextCue()
    return true
  }

  function showTargetSentence() {
    if (!current.value || contextCueLevel.value !== 'none') return false
    contextCueLevel.value = 'target_sentence'
    return true
  }

  function showSurroundingContext() {
    if (!current.value || contextCueLevel.value === 'surrounding_context') return false
    contextCueLevel.value = 'surrounding_context'
    return true
  }

  function resetContextCue() {
    contextCueLevel.value = initialReviewCueLevel({
      source: reviewSource.value,
      promptMode: current.value?.promptMode,
    })
  }

  function refreshEligibility() {
    eligibilityNowMs.value = resolveNowMilliseconds(now)
    return currentEligible.value
  }

  return {
    queue,
    index,
    viewIndex,
    loading,
    pending,
    backgroundSaving,
    error,
    saveError,
    current,
    total,
    reviewingPast,
    canPrevious,
    canNext,
    dailyTotal,
    completed,
    empty,
    progress,
    reviewHistory,
    sessionRatingCounts,
    sessionLedger,
    mode,
    modeLabel,
    budgetMinutes,
    estimatedRemainingMs,
    estimatedRemainingLabel,
    backlogCount,
    backlogEstimatedMs,
    backlogLabel,
    revisitReason,
    currentEligible,
    currentEligibilityLabel,
    deferredRevisit,
    reviewSource,
    sourceLabel,
    reviewSourceReason,
    sourceReasonLabel,
    queueSummary,
    currentQueueKind,
    currentQueueKindLabel,
    currentEnqueueReason,
    currentEnqueueReasonLabel,
    currentCardKey,
    usesReviewServiceV2: isReviewServiceV2Active,
    contextCueLevel,
    hasSurroundingContext,
    contextNotice,
    canRemoveCurrent,
    removeUnavailableReason,
    removeError,
    saveItems,
    saveSummary,
    hasUnconfirmedSaves,
    ratingBlocked,
    completionPendingSave,
    actions: SRS_REVIEW_ACTIONS,
    load,
    submitAction,
    submitRating,
    advanceCurrent,
    continueLegacyBatch,
    flushPendingSaves,
    retryReviewSave,
    removeCurrent,
    showTargetSentence,
    showSurroundingContext,
    goPrevious,
    goNext,
    refreshEligibility,
  }
}

function ledgerContainsNewEntries(nextLedger, previousLedger) {
  const loadedIds = new Set((Array.isArray(previousLedger?.entries) ? previousLedger.entries : [])
    .map((entry) => String(entry?.ledger_item_id || ''))
    .filter(Boolean))
  return (Array.isArray(nextLedger?.entries) ? nextLedger.entries : [])
    .some((entry) => !loadedIds.has(String(entry?.ledger_item_id || '')))
}

function reviewQueueIndexForLedger(ledger, cards) {
  const entries = Array.isArray(ledger?.entries) ? ledger.entries : []
  const cursor = Math.max(0, Math.min(Number(ledger?.cursor || 0), entries.length))
  const excluded = new Set(
    ledger?.extensions?.srs_review_excluded_ledger_item_ids || [],
  )
  const position = entries
    .slice(0, cursor)
    .filter((entry) => !excluded.has(String(entry?.ledger_item_id || '')))
    .length
  return Math.min(position, Array.isArray(cards) ? cards.length : 0)
}

function getErrorMessage(error, fallback) {
  return error && error.message ? String(error.message) : fallback
}

function createReviewSessionScope({ source, sessionId, generation }) {
  return Object.freeze({
    source: String(source || ''),
    sessionId: String(sessionId || ''),
    generation: Number(generation || 0),
  })
}

function sameSaveRecord(left, right) {
  if (!left || !right) return false
  return (
    String(left.itemId || '') === String(right.itemId || '')
    && String(left.source || '') === String(right.source || '')
    && String(left.sessionId || '') === String(right.sessionId || '')
    && Number(left.sessionGeneration || 0) === Number(right.sessionGeneration || 0)
    && String(left.commandId || '') === String(right.commandId || '')
    && String(left.attemptId || '') === String(right.attemptId || '')
    && String(left.eventId || '') === String(right.eventId || '')
    && String(left.correlationId || '') === String(right.correlationId || '')
    && left.draft === right.draft
  )
}

async function retryBackgroundSave(save, attempts) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await save()
    } catch (cause) {
      lastError = cause
      if (attempt + 1 < attempts) await delay(40 * (attempt + 1))
    }
  }
  throw lastError
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function waitForReviewTransitionPaint() {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(fallbackTimer)
      resolve()
    }
    const fallbackTimer = window.setTimeout(finish, 100)
    window.requestAnimationFrame(() => window.setTimeout(finish, 0))
  })
}

function createEmptyRatingCounts() {
  return { again: 0, hard: 0, good: 0, easy: 0 }
}

function resolveReviewDate(value) {
  const candidate = typeof value === 'function' ? value() : value
  const date = candidate ? new Date(candidate) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function endOfLocalDayIso(value) {
  const date = new Date(value)
  date.setHours(23, 59, 59, 999)
  return date.toISOString()
}

function reviewedWordIdsForDay(logs, date) {
  const dayKey = localDayKey(date)
  return new Set(
    (Array.isArray(logs) ? logs : [])
      .filter((log) => localDayKey(log?.reviewed_at || log?.reviewedAt) === dayKey)
      .map((log) => String(log?.word_id || log?.wordId || ''))
      .filter(Boolean),
  )
}

function summarizeReviewLogs(logs, today, limit = 30) {
  const groups = new Map()
  for (const log of Array.isArray(logs) ? logs : []) {
    const reviewedAt = log?.reviewed_at || log?.reviewedAt || log?.occurred_at
    const dateKey = localDayKey(reviewedAt)
    const wordId = String(log?.word_id || log?.wordId || log?.learning_unit_id || '')
    if (!dateKey || !wordId) continue
    if (!groups.has(dateKey)) groups.set(dateKey, new Set())
    groups.get(dateKey).add(wordId)
  }
  const todayKey = localDayKey(today)
  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, limit)
    .map(([date, wordIds]) => ({
      date,
      label: formatHistoryDate(date, date === todayKey),
      wordCount: wordIds.size,
    }))
}

function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatHistoryDate(dateKey, isToday) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const formatted = `${year}年${month}月${day}日`
  return isToday ? `今天 · ${formatted}` : formatted
}

function currentItemId(entry, usesReviewServiceV2) {
  const value = usesReviewServiceV2
    ? entry?.ledgerEntry?.ledger_item_id
    : entry?.word?.id
  return value == null ? '' : String(value)
}

function createCurrentCardKey(entry, source, position, sessionId) {
  if (!entry) return ''
  if (source === 'v2') {
    const ledgerItemId = entry.ledgerEntry?.ledger_item_id || entry.learningUnit?.learning_unit_id
    return `v2:${sessionId || 'session'}:${ledgerItemId || position}`
  }
  return `legacy:${entry.word?.id || 'word'}:${position}`
}

function queueKindForEntry(entry, source) {
  return String(entry?.ledgerEntry?.queue_kind || (source === 'legacy' ? 'legacy_batch' : '')).trim()
}

function formatReviewSourceLabel(source) {
  if (source === 'v2') return 'V2 复习队列'
  if (source === 'legacy') return 'legacy 复习队列'
  return '复习队列'
}

function formatSourceReasonLabel(reason, probeError) {
  const label = SOURCE_REASON_LABELS[reason]
  if (label) return label
  if (probeError) return `复习源探测异常：${probeError}`
  return '复习源待确认'
}

function formatQueueKindLabel(kind) {
  return QUEUE_KIND_LABELS[kind] || (kind ? `队列类型：${kind}` : '')
}

function formatEnqueueReason(reason) {
  return reason ? `入队原因：${reason}` : ''
}

function toPublicSaveState(record) {
  const status = record.status
  return {
    itemId: record.itemId,
    wordId: record.wordId,
    wordLabel: record.wordLabel,
    rating: record.rating,
    ratingLabel: record.ratingLabel || RATING_LABELS[record.tone] || record.rating,
    tone: record.tone,
    source: record.source,
    learningUnitId: record.learningUnitId,
    targetSenseId: record.targetSenseId,
    sessionId: record.sessionId,
    ledgerItemId: record.ledgerItemId,
    commandId: record.commandId,
    attemptId: record.attemptId,
    eventId: record.eventId,
    correlationId: record.correlationId,
    contextEvidenceId: record.contextEvidenceId,
    occurredAt: record.occurredAt,
    reviewedAt: record.reviewedAt,
    sessionGeneration: record.sessionGeneration,
    sessionScopeSource: record.sessionScopeSource,
    sessionScopeId: record.sessionScopeId,
    status,
    statusLabel: SAVE_STATUS_LABELS[status] || '保存状态待确认',
    retrying: Boolean(record.retrying),
    retryable: Boolean(record.retryable),
    knownNotSubmitted: Boolean(record.knownNotSubmitted),
    errorMessage: record.errorMessage || '',
  }
}

function summarizeSaveStates(items, pipelineBlocked = false) {
  const counts = {
    accepted: 0,
    saving: 0,
    confirmed: 0,
    failed: 0,
    unknown: 0,
  }
  for (const item of items) {
    if (Object.hasOwn(counts, item.status)) counts[item.status] += 1
  }
  const unresolvedCount = counts.failed + counts.unknown
  const unconfirmedCount = items.length - counts.confirmed
  let message = ''
  if (unresolvedCount) {
    message = `有 ${unresolvedCount} 个评分尚未确认，已暂停新的评分。`
  } else if (pipelineBlocked) {
    message = '评分保存正在按原顺序恢复，新的评分暂缓。'
  } else if (counts.saving) {
    message = `已作答，正在保存 ${counts.saving} 个评分…`
  } else if (counts.accepted) {
    message = `已作答，等待后台保存 ${counts.accepted} 个评分。`
  } else if (counts.confirmed) {
    message = '最近评分已确认保存。'
  }
  return {
    counts,
    totalCount: items.length,
    confirmedCount: counts.confirmed,
    unresolvedCount,
    unconfirmedCount,
    hasActivity: items.length > 0,
    message,
  }
}

function classifySaveFailure(error, source) {
  if (source === 'legacy' && !isExplicitReviewRejection(error)) return 'unknown'
  return isExplicitReviewRejection(error) ? 'failed' : 'unknown'
}

function isExplicitReviewRejection(error) {
  const status = Number(error?.status || error?.statusCode || 0)
  return Boolean(
    error?.knownNotSubmitted === true
    || ['REVIEW_REJECTED', 'REVIEW_NOT_SUBMITTED', 'VALIDATION_ERROR'].includes(String(error?.code || ''))
    || (status >= 400 && status < 500),
  )
}

function createAttemptDraft({
  action,
  entry,
  ledger,
  now,
  cardStartedAt,
  cueLevel,
  answerRevealedBeforeRating,
}) {
  const occurredAtMs = resolveNowMilliseconds(now)
  const occurredAt = new Date(occurredAtMs).toISOString()
  const durationMs = Math.max(0, Math.round(occurredAtMs - cardStartedAt))
  const attemptId = createReviewId('attempt')
  const context = selectAttemptContext(
    entry.contexts,
    entry.contextSelection?.selected_context_id,
  )
  const promptMode = normalizePromptMode(entry.promptMode, context)
  return {
    command_id: createReviewId('command'),
    attempt_id: attemptId,
    event_id: createReviewId('event'),
    correlation_id: createReviewId('correlation'),
    session_id: ledger.session_id,
    ledger_item_id: entry.ledgerEntry.ledger_item_id,
    learning_unit_id: entry.learningUnit?.learning_unit_id || null,
    target_sense_id: entry.learningUnit?.target_sense_id || null,
    occurred_at: occurredAt,
    event_partition: occurredAt.slice(0, 7),
    rating: action.rating,
    prompt_mode: promptMode,
    cue_level: resolveCueLevel(cueLevel, answerRevealedBeforeRating),
    answer_revealed_before_rating: answerRevealedBeforeRating,
    duration_ms: durationMs,
    active_duration_ms: durationMs,
    context_evidence_id: context?.context_evidence_id || context?.id || null,
    source_kind: context?.source_kind || null,
    content_version: context?.extensions?.content_version || null,
    active_duration_reliable: true,
  }
}

function selectAttemptContext(contexts, selectedContextId = '') {
  const valid = (Array.isArray(contexts) ? contexts : [])
    .filter(Boolean)
  const selected = String(selectedContextId || '').trim()
  if (selected) {
    return valid.find((context) => (
      String(context?.context_evidence_id || context?.id || '').trim() === selected
    )) || null
  }
  return valid.sort((left, right) => (
    Date.parse(right.created_at || '') - Date.parse(left.created_at || '')
  ))[0] || null
}

function normalizePromptMode(value, context) {
  if (['word_only', 'original_context', 'transfer_context'].includes(value)) return value
  return context ? 'original_context' : 'word_only'
}

function resolveCueLevel(cueLevel, answerRevealedBeforeRating) {
  if (answerRevealedBeforeRating) return 'translation'
  if (['none', 'target_sentence', 'surrounding_context'].includes(cueLevel)) return cueLevel
  return 'none'
}

function createReviewId(kind) {
  const randomId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `srs-ui-${kind}:${randomId}`
}

function resolveNowMilliseconds(value) {
  const candidate = typeof value === 'function' ? value() : value
  const milliseconds = candidate == null ? Date.now() : Date.parse(candidate)
  return Number.isFinite(milliseconds) ? milliseconds : Date.now()
}

function resolveTimezone(value) {
  if (typeof value === 'function') return String(value() || 'UTC')
  if (value) return String(value)
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch (_error) {
    return 'UTC'
  }
}

function resolveReviewSessionContext(options, now) {
  const startedAt = new Date(resolveNowMilliseconds(now)).toISOString()
  const timezone = resolveTimezone(options.timezone)
  const localDay = localDayKeyInTimezone(startedAt, timezone)
  return {
    session_id: resolveSessionId(options.sessionId, localDay),
    now: startedAt,
    timezone,
    local_day: localDay,
  }
}

function localDayKeyInTimezone(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function resolveSessionId(value, localDay) {
  if (typeof value === 'function') return String(value(localDay))
  return String(value || `srs-review-ui:${localDay}`)
}

function ratingCountsFromLedger(ledger) {
  const counts = createEmptyRatingCounts()
  for (const result of Object.values(ledger?.extensions?.attempt_results_by_id || {})) {
    const rating = result?.attempt?.rating
    if (Object.prototype.hasOwnProperty.call(counts, rating)) counts[rating] += 1
  }
  return counts
}

function formatModeLabel(mode) {
  return {
    once_daily: '每日一次',
    balanced: '均衡',
    intensive: '强化',
  }[mode] || '未开始'
}

function formatDuration(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0)
  if (value === 0) return '0 分钟'
  if (value < 60000) return '不足 1 分钟'
  return `${Math.ceil(value / 60000)} 分钟`
}

function formatRevisitReason(queueKind, reason) {
  if (queueKind !== 'revisit') return ''
  return {
    BALANCED_REVISIT_ALLOWED: '答错或学习阶段后的同日巩固',
    INTENSIVE_SHORT_STEP_ALLOWED: '强化模式的调度短间隔复习',
  }[reason] || '同日重访'
}
