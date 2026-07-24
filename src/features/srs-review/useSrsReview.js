import { computed, ref } from 'vue'
import { REVIEW_RATINGS } from '../../services/vocabulary/index.js'
import { diversifyReviewQueue } from './srs-review-queue.js'

export const SRS_REVIEW_ACTIONS = Object.freeze([
  Object.freeze({ shortcut: '1', label: '忘记', rating: REVIEW_RATINGS.AGAIN, tone: 'again' }),
  Object.freeze({ shortcut: '2', label: '困难', rating: REVIEW_RATINGS.HARD, tone: 'hard' }),
  Object.freeze({ shortcut: '3', label: '一般', rating: REVIEW_RATINGS.GOOD, tone: 'good' }),
  Object.freeze({ shortcut: '4', label: '容易', rating: REVIEW_RATINGS.EASY, tone: 'easy' }),
  Object.freeze({ shortcut: '5', label: '掌握', rating: REVIEW_RATINGS.EASY, tone: 'mastered', mastered: true }),
])

export function getReviewActionForShortcut(key) {
  return SRS_REVIEW_ACTIONS.find((action) => action.shortcut === String(key || '')) || null
}

export function useSrsReview(service, options = {}) {
  if (!service || typeof service.getDueWords !== 'function' || typeof service.reviewWord !== 'function') {
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
      ? `${reviewingPast.value ? '回顾' : '复习'} ${completedBeforeOpen.value + viewIndex.value + 1} / ${dailyTotal.value}`
      : ''
  ))
  const reviewHistory = computed(() => summarizeReviewLogs(reviewLogs.value, reviewDate.value))

  async function load() {
    loading.value = true
    error.value = ''
    try {
      reviewDate.value = resolveReviewDate(now)
      const [due, logs] = await Promise.all([
        service.getDueWords(endOfLocalDayIso(reviewDate.value)),
        typeof service.getReviewLogs === 'function' ? service.getReviewLogs() : [],
      ])
      reviewLogs.value = Array.isArray(logs) ? logs : []
      const reviewedToday = reviewedWordIdsForDay(reviewLogs.value, reviewDate.value)
      queue.value = diversifyReviewQueue(due).filter((entry) => (
        !reviewedToday.has(String(entry?.word?.id || ''))
      ))
      index.value = 0
      viewIndex.value = 0
      completedBeforeOpen.value = reviewedToday.size
      dailyTotal.value = completedBeforeOpen.value + queue.value.length
      loaded.value = true
    } catch (cause) {
      error.value = getErrorMessage(cause, '无法加载今日复习')
      loaded.value = false
    } finally {
      loading.value = false
    }
  }

  async function submitAction(action) {
    if (pending.value || !current.value || reviewingPast.value) return false
    if (!SRS_REVIEW_ACTIONS.includes(action)) {
      throw new Error('Unsupported SRS review action')
    }

    pending.value = true
    error.value = ''
    const entry = current.value
    try {
      const result = action.mastered && typeof service.reviewWordKnown === 'function'
        ? await service.reviewWordKnown(entry.word.id)
        : await service.reviewWord(entry.word.id, action.rating)
      if (result?.reviewLog) {
        reviewLogs.value = [result.reviewLog, ...reviewLogs.value]
      }
      index.value += 1
      viewIndex.value = index.value
      return true
    } catch (cause) {
      error.value = getErrorMessage(cause, '评价保存失败，请重试')
      return false
    } finally {
      pending.value = false
    }
  }

  async function submitRating(rating) {
    const action = SRS_REVIEW_ACTIONS.find((item) => item.rating === rating && !item.mastered)
    if (!action) throw new Error(`Unsupported SRS review rating: ${rating}`)
    return submitAction(action)
  }

  function goPrevious() {
    if (!canPrevious.value) return false
    viewIndex.value -= 1
    return true
  }

  function goNext() {
    if (!canNext.value) return false
    viewIndex.value += 1
    return true
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
    actions: SRS_REVIEW_ACTIONS,
    load,
    submitAction,
    submitRating,
    goPrevious,
    goNext,
  }
}

function getErrorMessage(error, fallback) {
  return error && error.message ? String(error.message) : fallback
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
    const reviewedAt = log?.reviewed_at || log?.reviewedAt
    const dateKey = localDayKey(reviewedAt)
    const wordId = String(log?.word_id || log?.wordId || '')
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
