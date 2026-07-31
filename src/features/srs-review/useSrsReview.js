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
  const error = ref('')
  const loaded = ref(false)
  const now = options.now
  const dailyTotal = ref(0)
  const completedBeforeOpen = ref(0)
  const reviewLogs = ref([])
  const reviewDate = ref(resolveReviewDate(now))
  const sessionRatingCounts = ref(createEmptyRatingCounts())
  const sessionLedger = ref(null)
  const reviewSource = ref(usesReviewServiceV2 ? 'v2' : (usesLegacyService ? 'legacy' : ''))
  const contextCueLevel = ref('none')
  const committedItemIds = new Set()
  const attemptDrafts = new Map()
  let cardStartedAt = resolveNowMilliseconds(now)

  const current = computed(() => queue.value[viewIndex.value] || null)
  const total = computed(() => queue.value.length)
  const reviewingPast = computed(() => viewIndex.value < index.value)
  const canPrevious = computed(() => viewIndex.value > 0)
  const canNext = computed(() => viewIndex.value < Math.min(index.value, total.value))
  const completed = computed(() => (
    loaded.value
    && dailyTotal.value > 0
    && index.value >= total.value
    && viewIndex.value >= total.value
  ))
  const empty = computed(() => loaded.value && dailyTotal.value === 0)
  const progress = computed(() => (
    current.value
      ? `${reviewingPast.value ? '回顾' : '复习'} ${usesReviewServiceV2 ? viewIndex.value + 1 : completedBeforeOpen.value + viewIndex.value + 1} / ${dailyTotal.value}`
      : ''
  ))
  const reviewHistory = computed(() => summarizeReviewLogs(reviewLogs.value, reviewDate.value))
  const mode = computed(() => sessionLedger.value?.mode || '')
  const modeLabel = computed(() => formatModeLabel(mode.value))
  const budgetMinutes = computed(() => Math.round(Number(sessionLedger.value?.budget_ms || 0) / 60000))
  const estimatedRemainingMs = computed(() => {
    const ledger = sessionLedger.value
    if (!ledger) return 0
    const completedIds = new Set(ledger.extensions?.completed_item_ids || [])
    return ledger.entries
      .filter((entry) => !completedIds.has(entry.ledger_item_id))
      .reduce((sum, entry) => sum + Number(entry.estimated_duration_ms || 0), 0)
  })
  const estimatedRemainingLabel = computed(() => formatDuration(estimatedRemainingMs.value))
  const backlogCount = computed(() => Number(sessionLedger.value?.backlog?.extensions?.total_count || 0))
  const backlogEstimatedMs = computed(() => Number(sessionLedger.value?.backlog?.estimated_ms || 0))
  const backlogLabel = computed(() => (
    backlogCount.value
      ? `${backlogCount.value} 项（约 ${formatDuration(backlogEstimatedMs.value)}）`
      : '0 项'
  ))
  const revisitReason = computed(() => formatRevisitReason(
    current.value?.ledgerEntry?.queue_kind,
    current.value?.ledgerEntry?.enqueue_reason,
  ))
  const currentEligible = computed(() => {
    const plannedDueAt = current.value?.ledgerEntry?.planned_due_at
    if (!plannedDueAt) return true
    return Date.parse(plannedDueAt) <= resolveNowMilliseconds(now)
  })
  const currentEligibilityLabel = computed(() => {
    if (currentEligible.value) return ''
    const remaining = Date.parse(current.value?.ledgerEntry?.planned_due_at) - resolveNowMilliseconds(now)
    return `这次同日重访将在约 ${formatDuration(remaining)} 后可评分`
  })
  const isReviewServiceV2Active = computed(() => reviewSource.value === 'v2')
  const canRemoveCurrent = computed(() => {
    reviewSource.value
    return typeof activeService?.deleteWord === 'function'
  })
  const removeUnavailableReason = computed(() => (
    current.value && !canRemoveCurrent.value && reviewSource.value === 'v2'
      ? 'V2 复习卡暂不支持安全移除；为避免留下孤立的学习状态，本次仅可继续评分。'
      : ''
  ))
  const hasSurroundingContext = computed(() => {
    const context = selectAttemptContext(current.value?.contexts)
    const sentence = String(context?.sentence || '').trim()
    const surrounding = String(context?.surrounding_text || context?.surroundingText || '').trim()
    return Boolean(surrounding && surrounding !== sentence)
  })

  async function load() {
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
      }
      if (usesReviewServiceV2) {
        await loadReviewServiceV2(sessionContext)
        return
      }
      reviewDate.value = resolveReviewDate(now)
      const [due, logs] = await Promise.all([
        activeService.getDueWords(endOfLocalDayIso(reviewDate.value)),
        typeof activeService.getReviewLogs === 'function' ? activeService.getReviewLogs() : [],
      ])
      reviewLogs.value = Array.isArray(logs) ? logs : []
      sessionRatingCounts.value = createEmptyRatingCounts()
      committedItemIds.clear()
      const reviewedToday = reviewedWordIdsForDay(reviewLogs.value, reviewDate.value)
      queue.value = diversifyReviewQueue(due).filter((entry) => (
        !reviewedToday.has(String(entry?.word?.id || ''))
      ))
      index.value = 0
      viewIndex.value = 0
      completedBeforeOpen.value = reviewedToday.size
      dailyTotal.value = completedBeforeOpen.value + queue.value.length
      sessionLedger.value = null
      resetContextCue()
      loaded.value = true
    } catch (cause) {
      error.value = getErrorMessage(cause, '无法加载今日复习')
      loaded.value = false
    } finally {
      loading.value = false
    }
  }

  async function loadReviewServiceV2(sessionContext = resolveReviewSessionContext(options, now)) {
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
    sessionLedger.value = ledger
    queue.value = await activeService.getReviewCards(ledger)
    index.value = Math.min(Number(ledger.cursor || 0), queue.value.length)
    viewIndex.value = index.value
    const completedIds = new Set(ledger.extensions?.completed_item_ids || [])
    committedItemIds.clear()
    completedIds.forEach((itemId) => committedItemIds.add(String(itemId)))
    completedBeforeOpen.value = completedIds.size
    dailyTotal.value = queue.value.length
    sessionRatingCounts.value = ratingCountsFromLedger(ledger)
    reviewLogs.value = typeof activeService.getReviewEvents === 'function'
      ? await activeService.getReviewEvents()
      : []
    cardStartedAt = resolveNowMilliseconds(now)
    resetContextCue()
    loaded.value = true
  }

  async function submitAction(action, submitOptions = {}) {
    const entry = current.value
    const itemId = currentItemId(entry, usesReviewServiceV2)
    if (
      pending.value
      || !entry
      || reviewingPast.value
      || committedItemIds.has(itemId)
      || (usesReviewServiceV2 && !currentEligible.value)
    ) return false
    if (!SRS_REVIEW_ACTIONS.includes(action)) {
      throw new Error('Unsupported SRS review action')
    }

    pending.value = true
    error.value = ''
    try {
      if (usesReviewServiceV2) {
        const saved = await submitReviewServiceV2(entry, action, submitOptions)
        if (!saved) return false
        if (submitOptions.advance !== false) advanceCurrent()
        return true
      }
      const result = await activeService.reviewWord(entry.word.id, action.rating)
      if (result?.reviewLog) {
        reviewLogs.value = [result.reviewLog, ...reviewLogs.value]
      }
      committedItemIds.add(itemId)
      sessionRatingCounts.value = {
        ...sessionRatingCounts.value,
        [action.tone]: sessionRatingCounts.value[action.tone] + 1,
      }
      if (submitOptions.advance !== false) advanceCurrent()
      return true
    } catch (cause) {
      error.value = getErrorMessage(cause, '评价保存失败，请重试')
      return false
    } finally {
      pending.value = false
    }
  }

  async function submitReviewServiceV2(entry, action, submitOptions) {
    const ledgerEntry = entry.ledgerEntry
    const draftKey = ledgerEntry.ledger_item_id
    let draft = attemptDrafts.get(draftKey)
    if (draft && draft.rating !== action.rating) {
      error.value = '上次提交状态未知，请先重试原评分'
      return false
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
    const result = await activeService.recordReviewAttempt(draft)
    sessionLedger.value = result.ledger
    queue.value = await activeService.getReviewCards(result.ledger)
    committedItemIds.add(draftKey)
    reviewLogs.value = [{
      ...result.attempt,
      reviewed_at: result.attempt.occurred_at,
    }, ...reviewLogs.value]
    sessionRatingCounts.value = {
      ...sessionRatingCounts.value,
      [action.tone]: sessionRatingCounts.value[action.tone] + 1,
    }
    return true
  }

  function advanceCurrent() {
    const itemId = currentItemId(current.value, usesReviewServiceV2)
    if (!itemId || !committedItemIds.has(itemId) || reviewingPast.value) return false
    index.value = usesReviewServiceV2
      ? Math.min(Number(sessionLedger.value?.cursor || index.value + 1), queue.value.length)
      : index.value + 1
    viewIndex.value = index.value
    cardStartedAt = resolveNowMilliseconds(now)
    resetContextCue()
    return true
  }

  async function submitRating(rating) {
    const action = SRS_REVIEW_ACTIONS.find((item) => item.rating === rating)
    if (!action) throw new Error(`Unsupported SRS review rating: ${rating}`)
    return submitAction(action)
  }

  async function removeCurrent() {
    if (pending.value || !current.value || !canRemoveCurrent.value) return false
    pending.value = true
    error.value = ''
    const removedIndex = viewIndex.value
    const entry = current.value
    try {
      await activeService.deleteWord(entry.word.id)
      queue.value.splice(removedIndex, 1)
      reviewLogs.value = reviewLogs.value.filter((log) => (
        String(log?.word_id || log?.wordId || '') !== String(entry.word.id)
      ))
      if (removedIndex < index.value) index.value -= 1
      viewIndex.value = Math.min(removedIndex, queue.value.length)
      dailyTotal.value = Math.max(completedBeforeOpen.value, dailyTotal.value - 1)
      resetContextCue()
      return true
    } catch (cause) {
      error.value = getErrorMessage(cause, '无法移除这个单词，请重试')
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

  return {
    queue,
    index,
    viewIndex,
    loading,
    pending,
    error,
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
    reviewSource,
    usesReviewServiceV2: isReviewServiceV2Active,
    contextCueLevel,
    hasSurroundingContext,
    canRemoveCurrent,
    removeUnavailableReason,
    actions: SRS_REVIEW_ACTIONS,
    load,
    submitAction,
    submitRating,
    advanceCurrent,
    removeCurrent,
    showTargetSentence,
    showSurroundingContext,
    goPrevious,
    goNext,
  }
}

function getErrorMessage(error, fallback) {
  return error && error.message ? String(error.message) : fallback
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
  const context = selectAttemptContext(entry.contexts)
  const promptMode = normalizePromptMode(entry.promptMode, context)
  return {
    command_id: createReviewId('command'),
    attempt_id: attemptId,
    event_id: createReviewId('event'),
    correlation_id: createReviewId('correlation'),
    session_id: ledger.session_id,
    ledger_item_id: entry.ledgerEntry.ledger_item_id,
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

function selectAttemptContext(contexts) {
  return (Array.isArray(contexts) ? contexts : [])
    .filter(Boolean)
    .sort((left, right) => (
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
