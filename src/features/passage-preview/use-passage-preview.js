import { ref } from 'vue'
import {
  importVocabularyPreview,
  validatePassagePreviewItems,
} from './passage-preview-import.js'
import {
  createInitialPassagePreviewProgress,
  hasLegacyPassagePreviewData,
  loadPassagePreviewData,
  loadPassagePreviewDataFromOwner,
  loadPassagePreviewProgress,
  loadPassagePreviewProgressFromOwner,
  isPassagePreviewOwnerAuthoritative,
  savePassagePreviewData,
  savePassagePreviewProgress,
} from './passage-preview-storage.js'
import { derivePassagePreviewBatchId } from './passage-preview-durable-state.js'
import {
  IELTS_DAILY_PREVIEW_WAITING_THRESHOLD,
  generateIeltsDailyPreviewBatch,
  getPreviewBatchDate,
  excludePreviouslyIntroducedPreviewItems,
  commitPassagePreviewBatchTransition,
  loadIeltsDailyPreviewAllocations,
  loadIeltsDailyPreviewContinuation,
  loadIeltsPreviewCandidateWords,
  materializeIeltsDailyPreviewBatch,
  saveIeltsDailyPreviewArchive,
  saveIeltsDailyPreviewAllocations,
  saveIeltsDailyPreviewContinuation,
  resolveCompletedIeltsPreviewAction,
  resolveIeltsDailyPreviewContinuationGate,
  selectNextIeltsDailyPreviewBatch,
} from './passage-preview-daily-continuation.js'
import { createPassagePreviewAcquisitionCoordinator } from './passage-preview-acquisition.js'
import {
  createPassagePreviewLearningSession,
  getIeltsAdaptivePreviewPlan,
  loadPassagePreviewLearningSettings,
  loadPassagePreviewLearningHistory,
  savePassagePreviewLearningSession,
} from './passage-preview-learning-history.js'
import { preloadPassagePreviewBatch } from './passage-preview-preload.mjs'
import { sentenceTranslationKey } from './sentence-translation.js'
import {
  loadPassagePreviewSessionCache,
  savePassagePreviewSessionCache,
} from './passage-preview-session-cache.js'

export function usePassagePreview({ vocabularyService, requestImportFile } = {}) {
  const requestImportFileHandler = typeof requestImportFile === 'function'
    ? requestImportFile
    : () => {}
  const isPassagePreviewOpen = ref(false)
  const passagePreviewItems = ref(loadPassagePreviewData())
  const passagePreviewOpening = ref(false)
  const passagePreviewPreparing = ref(false)
  const passagePreviewPreparationMessage = ref('正在准备预习句子…')
  const passagePreviewPreloaded = ref({ sentences: {}, translations: {} })
  const passagePreviewLearningRevealTimes = new Map()
  let passagePreviewLearningSavePromise = Promise.resolve()
  let passagePreviewAcquisitionRegistrationPromise = Promise.resolve()
  const isPassagePreviewSettingsOpen = ref(false)
  const passagePreviewWaitingCount = ref(0)
  const passagePreviewQueueNotice = ref('')
  const passagePreviewAcquisition = createPassagePreviewAcquisitionCoordinator({ vocabularyService })

  async function openStoredPassagePreviewLegacy() {
    if (validatePassagePreviewItems(passagePreviewItems.value)) {
      passagePreviewItems.value = await preparePassagePreviewItems(passagePreviewItems.value)
      await savePassagePreviewData(passagePreviewItems.value)
      isPassagePreviewOpen.value = true
      return true
    }
    if (passagePreviewItems.value.length) {
      try {
        const migrated = importVocabularyPreview({
          title: '首次接触',
          answers: passagePreviewItems.value,
        })
        const prepared = await preparePassagePreviewItems(migrated)
        await savePassagePreviewData(prepared)
        passagePreviewItems.value = prepared
        isPassagePreviewOpen.value = true
        return true
      } catch (error) {
        if (isPassagePreviewOwnerAuthoritative()) throw error
      }
    }
    return false
  }

  async function refreshPendingPreviewSummary() {
    try {
      const summary = await vocabularyService.getPendingPreviewLearningSummary()
      passagePreviewWaitingCount.value = Number(summary?.waiting || 0)
      if (passagePreviewWaitingCount.value < IELTS_DAILY_PREVIEW_WAITING_THRESHOLD) {
        passagePreviewQueueNotice.value = ''
      }
      return summary
    } catch (error) {
      if (isPassagePreviewOwnerAuthoritative()) throw error
      console.warn('[passage-preview] pending preview summary unavailable', error)
      return null
    }
  }

  async function ensurePreviewGenerationCapacity() {
    const summary = await refreshPendingPreviewSummary()
    const decision = resolveIeltsDailyPreviewContinuationGate({
      waiting: Number(summary?.waiting || 0),
      currentBatchCompleted: true,
    })
    if (decision.allowed) return true
    passagePreviewQueueNotice.value = decision.notice
    return false
  }

  async function reconcileRevealedPreviewAcquisitions(items, progress, introducedRecords = []) {
    const registeredItemIds = new Set((Array.isArray(introducedRecords) ? introducedRecords : [])
      .map((record) => String(record?.previewItemId || '').trim())
      .filter(Boolean))
    for (const item of Array.isArray(items) ? items : []) {
      if (!item?.id || progress?.revealed?.[item.id] !== true) continue
      if (registeredItemIds.has(String(item.id))) continue
      await registerPreviewItem({ item })
    }
    await waitForPassagePreviewAcquisitionRegistrations()
  }

  async function replayPersistedPassagePreviewAcquisitions() {
    try {
      const items = await loadPassagePreviewDataFromOwner() ?? loadPassagePreviewData()
      const progress = await loadPassagePreviewProgressFromOwner() ?? loadPassagePreviewProgress()
      const introducedRecords = await loadPreviewIntroducedRecords()
      await reconcileRevealedPreviewAcquisitions(items, progress, introducedRecords)
    } catch (error) {
      console.warn('[passage-preview] startup acquisition replay unavailable', error)
    }
  }

  async function openStoredPassagePreview() {
    if (passagePreviewOpening.value) return true
    passagePreviewOpening.value = true
    try {
      passagePreviewPreparationMessage.value = '正在读取已保存的预习批次…'
      await refreshPendingPreviewSummary()
      passagePreviewItems.value = await loadPassagePreviewDataFromOwner() ?? loadPassagePreviewData()
      let progress = await loadPassagePreviewProgressFromOwner() ?? loadPassagePreviewProgress()
      const storedBatchDate = getPreviewBatchDate(passagePreviewItems.value)
      const introducedRecords = await loadPreviewIntroducedRecords()
      const reconciledItems = excludePreviouslyIntroducedPreviewItems({
        items: passagePreviewItems.value,
        introducedRecords,
        currentIndex: progress.currentIndex,
      })
      if (reconciledItems.removedCount > 0) {
        if (!reconciledItems.items.length) {
          if (storedBatchDate) {
            const advanced = await advanceCompletedIeltsPreviewBatch(storedBatchDate, {
              ...progress,
              status: 'completed',
              completedAt: progress.completedAt || new Date().toISOString(),
            })
            if (!advanced) {
              progress = {
                ...progress,
                status: 'completed',
                completedAt: progress.completedAt || new Date().toISOString(),
              }
              isPassagePreviewOpen.value = true
              await refreshPendingPreviewSummary()
              return true
            }
            progress = await loadPassagePreviewProgressFromOwner() ?? loadPassagePreviewProgress()
          } else {
            progress = {
              ...progress,
              status: 'completed',
              completedAt: progress.completedAt || new Date().toISOString(),
            }
          }
        } else {
          passagePreviewItems.value = reconciledItems.items
          progress = { ...progress, currentIndex: reconciledItems.currentIndex }
          await savePassagePreviewData(passagePreviewItems.value)
          await savePassagePreviewProgress(progress)
        }
      }
      await reconcileRevealedPreviewAcquisitions(passagePreviewItems.value, progress, introducedRecords)
      if (validatePassagePreviewItems(passagePreviewItems.value)) {
        const currentBatchDate = getPreviewBatchDate(passagePreviewItems.value)
        if (progress.status === 'completed') {
          const completionAction = resolveCompletedIeltsPreviewAction({
            waiting: passagePreviewWaitingCount.value,
            hasBatchDate: Boolean(currentBatchDate),
          })
          if (
            completionAction.action === 'keep_completed'
            && completionAction.reason === 'waiting_threshold'
          ) {
            passagePreviewQueueNotice.value = completionAction.notice
          }
          if (completionAction.action === 'advance_dated_batch') {
            const advanced = await advanceCompletedIeltsPreviewBatch(currentBatchDate, progress)
            if (advanced) {
              isPassagePreviewOpen.value = true
              return true
            }
          } else if (completionAction.action === 'open_or_clear_undated_batch') {
            const started = await openFirstAvailableIeltsPreviewBatch()
            if (started) return true
            await savePassagePreviewData([])
            await savePassagePreviewProgress(createInitialPassagePreviewProgress())
            passagePreviewItems.value = []
            passagePreviewLearningRevealTimes.clear()
            return false
          }
          // Keep the completed surface visible when capacity or the candidate
          // pool prevents a new group from being generated.
          isPassagePreviewOpen.value = true
          await refreshPendingPreviewSummary()
          return true
        }
        passagePreviewItems.value = await preparePassagePreviewItems(passagePreviewItems.value)
        await savePassagePreviewData(passagePreviewItems.value)
        isPassagePreviewOpen.value = true
        return true
      }
      if (await openStoredPassagePreviewLegacy()) return true
      passagePreviewPreparationMessage.value = '正在生成今日预习批次…'
      const started = await openFirstAvailableIeltsPreviewBatch()
      return started
    } finally {
      passagePreviewOpening.value = false
      passagePreviewPreparing.value = false
    }
  }

  async function openPassagePreview() {
    if (passagePreviewOpening.value) return
    await Promise.all([
      passagePreviewLearningSavePromise,
      waitForPassagePreviewAcquisitionRegistrations(),
    ])
    passagePreviewPreparing.value = true
    passagePreviewPreparationMessage.value = '正在读取待预习队列…'
    try {
      if (await openStoredPassagePreview()) return
      if (passagePreviewQueueNotice.value) {
        window.alert(passagePreviewQueueNotice.value)
        return
      }
      if (hasLegacyPassagePreviewData()) {
        window.alert('已有旧版预习进度会保留。请导入新版首次接触词包。')
      } else {
        window.alert('当前没有可打开的待预习批次，请检查 Windows Host 或导入预习词包。')
      }
      requestImportFileHandler()
    } catch (error) {
      console.warn('[passage-preview] open unavailable', error)
      window.alert(error?.message || '待预习数据读取失败，请检查 Windows Host 是否正常运行。')
    } finally {
      passagePreviewPreparing.value = false
    }
  }

  async function advanceCompletedIeltsPreviewBatch(currentBatchDate, progress) {
    if (!await ensurePreviewGenerationCapacity()) return false
    const continuation = await loadIeltsDailyPreviewContinuation()
    const allocations = await loadIeltsDailyPreviewAllocations()
    const excludedLemmas = await loadPreviewExcludedLemmas()
    const nextBatch = selectNextIeltsDailyPreviewBatch({
      allocations,
      currentBatchDate,
      consumedBatchDates: continuation.consumedBatchDates,
      excludedLemmas,
      today: formatLocalDate(new Date()),
    })
    let resolvedNextBatch = nextBatch
    if (!resolvedNextBatch) {
      const generated = await generateTodayIeltsPreviewBatch(excludedLemmas, {
        allowAdditionalSameDayBatch: true,
      })
      if (generated?.date >= currentBatchDate) resolvedNextBatch = generated
    }
    if (!resolvedNextBatch) {
      try {
        await saveIeltsDailyPreviewContinuation({
          ...continuation,
          consumedBatchDates: addDate(continuation.consumedBatchDates, currentBatchDate),
          lastLoadedBatchDate: currentBatchDate,
          updatedAt: new Date().toISOString(),
        })
      } catch (error) {
        console.warn('[passage-preview] daily continuation unavailable', error)
      }
      return false
    }

    try {
      const nextItems = await materializeIeltsDailyPreviewBatch({
        batch: resolvedNextBatch,
        fallbackItems: passagePreviewItems.value,
      })
      const preparedNextItems = await preparePassagePreviewItems(nextItems)
      await commitPassagePreviewBatchTransition({
        archive: {
          date: currentBatchDate,
          items: passagePreviewItems.value,
          completedAt: progress.completedAt,
        },
        nextItems: preparedNextItems,
        progress: createInitialPassagePreviewProgress(),
        continuation: {
          ...continuation,
          consumedBatchDates: addDate(continuation.consumedBatchDates, currentBatchDate),
          lastLoadedBatchDate: resolvedNextBatch.date,
          updatedAt: new Date().toISOString(),
        },
        saveArchive: saveIeltsDailyPreviewArchive,
        saveData: savePassagePreviewData,
        saveProgress: savePassagePreviewProgress,
        saveContinuation: saveIeltsDailyPreviewContinuation,
      })
      passagePreviewLearningRevealTimes.clear()
      passagePreviewItems.value = preparedNextItems
      return true
    } catch (error) {
      console.warn('[passage-preview] daily continuation unavailable', error)
      return false
    }
  }

  async function openFirstAvailableIeltsPreviewBatch() {
    if (!await ensurePreviewGenerationCapacity()) return false
    passagePreviewPreparationMessage.value = '正在读取今日候选词池…'
    const allocations = await loadIeltsDailyPreviewAllocations()
    const continuation = await loadIeltsDailyPreviewContinuation()
    const excludedLemmas = await loadPreviewExcludedLemmas()
    const nextBatch = selectNextIeltsDailyPreviewBatch({
      allocations,
      consumedBatchDates: continuation.consumedBatchDates,
      excludedLemmas,
      today: formatLocalDate(new Date()),
    })
    let resolvedNextBatch = nextBatch
    if (!resolvedNextBatch) {
      resolvedNextBatch = await generateTodayIeltsPreviewBatch(excludedLemmas, {
        allowAdditionalSameDayBatch: true,
      })
    }
    if (!resolvedNextBatch) return false
    try {
      passagePreviewPreparationMessage.value = `正在整理 ${resolvedNextBatch.words.length} 个预习词…`
      const items = await materializeIeltsDailyPreviewBatch({ batch: resolvedNextBatch })
      const preparedItems = await preparePassagePreviewItems(items)
      await savePassagePreviewData(preparedItems)
      await savePassagePreviewProgress(createInitialPassagePreviewProgress())
      await saveIeltsDailyPreviewContinuation({
        ...continuation,
        lastLoadedBatchDate: resolvedNextBatch.date,
        updatedAt: new Date().toISOString(),
      })
      passagePreviewLearningRevealTimes.clear()
      passagePreviewItems.value = preparedItems
      isPassagePreviewOpen.value = true
      await refreshPendingPreviewSummary()
      return true
    } catch (error) {
      console.warn('[passage-preview] daily allocation unavailable', error)
      return false
    }
  }

  async function preparePassagePreviewItems(items) {
    const source = Array.isArray(items) ? items : []
    if (!source.length) {
      passagePreviewPreloaded.value = { sentences: {}, translations: {} }
      return source
    }
    const cached = loadPassagePreviewSessionCache(source)
    if (cached && isPreparedPassagePreviewCache(cached, source)) {
      passagePreviewPreloaded.value = {
        sentences: cached.preloadedSentences || {},
        translations: cached.translations || {},
      }
      passagePreviewPreparationMessage.value = '已复用本次浏览器会话的预习材料。'
      return cached.items
    }
    passagePreviewPreparationMessage.value = `正在准备 ${source.length} 条预习材料…`
    try {
      const prepared = await preloadPassagePreviewBatch(source, {
        // Finish sentence selection and translation before the study surface is
        // shown. The practice page must only render prepared data.
        preloadExternalSources: true,
        ensureSentence: true,
        onProgress(progress) {
          if (progress.phase === 'stored') {
            passagePreviewPreparationMessage.value = `正在读取已保存短句 ${progress.completed}/${progress.total}…`
          } else if (progress.phase === 'sentences') {
            passagePreviewPreparationMessage.value = `正在准备短句 ${progress.completed}/${progress.total}…`
          } else if (progress.phase === 'ai') {
            passagePreviewPreparationMessage.value = `正在补充 AI 辅助句 ${progress.completed}/${progress.total}…`
          } else {
            passagePreviewPreparationMessage.value = progress.total
              ? `正在整理中文 ${progress.completed}/${progress.total}…`
              : '正在整理预习材料…'
          }
        },
      })
      passagePreviewPreloaded.value = {
        sentences: prepared.preloadedSentences,
        translations: prepared.translations,
      }
      savePassagePreviewSessionCache({
        items: prepared.items,
        preloadedSentences: prepared.preloadedSentences,
        translations: prepared.translations,
      })
      return prepared.items
    } catch (error) {
      console.warn('[passage-preview] batch preload unavailable', error)
      passagePreviewPreloaded.value = { sentences: {}, translations: {} }
      return source
    }
  }

  function isPreparedPassagePreviewCache(cached, source) {
    const cachedItems = new Map(
      (Array.isArray(cached?.items) ? cached.items : []).map((item) => [item?.id, item]),
    )
    const preloadedSentences = cached?.preloadedSentences || {}
    const translations = cached?.translations || {}
    return source.every((item) => {
      const cachedItem = cachedItems.get(item.id) || item
      const sentence = preloadedSentences[item.id]
        || cachedItem?.realSentence
        || cachedItem?.previewContext
      return Boolean(
        preloadedSentences[item.id]?.sentence
        || cachedItem?.realSentence?.sentence
        || cachedItem?.previewContext?.sentence,
      ) && Boolean(sentence?.translationZh || translations[sentenceTranslationKey(sentence?.sentence)])
    })
  }

  async function closePassagePreview() {
    await Promise.all([
      passagePreviewLearningSavePromise,
      waitForPassagePreviewAcquisitionRegistrations(),
    ])
    isPassagePreviewOpen.value = false
    passagePreviewQueueNotice.value = ''
    passagePreviewPreloaded.value = { sentences: {}, translations: {} }
  }

  function openPassagePreviewSettings() {
    isPassagePreviewSettingsOpen.value = true
  }

  function closePassagePreviewSettings() {
    isPassagePreviewSettingsOpen.value = false
  }

  async function generateTodayIeltsPreviewBatch(
    excludedLemmas = [],
    { allowAdditionalSameDayBatch = false } = {},
  ) {
    const date = formatLocalDate(new Date())
    const allocations = await loadIeltsDailyPreviewAllocations()
    const candidateWords = await loadIeltsPreviewCandidateWords()
    const learningHistory = await loadPassagePreviewLearningHistory()
    const learningSettings = await loadPassagePreviewLearningSettings()
    const adaptivePlan = getIeltsAdaptivePreviewPlan(learningHistory, {
      batchSize: learningSettings.batchSize,
    })
    const generated = generateIeltsDailyPreviewBatch({
      allocations,
      date,
      candidateWords,
      excludedLemmas,
      adaptivePlan,
      batchSize: learningSettings.batchSize,
      allowExistingDate: allowAdditionalSameDayBatch,
    })
    if (!generated.created) return null
    await saveIeltsDailyPreviewAllocations(generated.allocations)
    return generated.batch
  }

  async function loadPreviewExcludedLemmas() {
    try {
      return await passagePreviewAcquisition.getIntroducedLemmas()
    } catch (error) {
      if (isPassagePreviewOwnerAuthoritative()) throw error
      console.warn('[passage-preview] introduced-word exclusion unavailable', error)
      return []
    }
  }

  async function loadPreviewIntroducedRecords() {
    try {
      return await passagePreviewAcquisition.loadRecords()
    } catch (error) {
      if (isPassagePreviewOwnerAuthoritative()) throw error
      console.warn('[passage-preview] current-batch exclusion unavailable', error)
      return []
    }
  }

  async function importPassagePreviewFile(event) {
    const file = event.target?.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const items = importVocabularyPreview(JSON.parse(await file.text()))
      passagePreviewPreparing.value = true
      passagePreviewPreparationMessage.value = `正在准备 ${items.length} 条预习材料…`
      const preparedItems = await preparePassagePreviewItems(items)
      await savePassagePreviewData(preparedItems)
      await savePassagePreviewProgress(createInitialPassagePreviewProgress())
      passagePreviewItems.value = preparedItems
      isPassagePreviewOpen.value = true
    } catch (error) {
      window.alert(error?.message || '预习结果导入失败。')
    } finally {
      passagePreviewPreparing.value = false
    }
  }

  async function saveEnrichedPreviewItem({
    id,
    realSentence,
    primaryMeaningZh,
    pos,
    primarySenseStatus,
    primarySenseReason,
    targetSenseKey,
  }) {
    if (!id || !realSentence) return
    const previousItems = passagePreviewItems.value
    const nextItems = previousItems.map((item) => (
      item.id === id ? {
        ...item,
        realSentence,
        ...(primaryMeaningZh ? { primaryMeaningZh } : {}),
        ...(pos ? { pos } : {}),
        ...(primarySenseStatus ? { primarySenseStatus } : {}),
        ...(primarySenseReason ? { primarySenseReason } : {}),
        ...(targetSenseKey ? { targetSenseKey } : {}),
      } : item
    ))
    try {
      await savePassagePreviewData(nextItems)
    } catch (error) {
      console.warn('[passage-preview] enriched item save unavailable', error)
      return
    }
    passagePreviewItems.value = nextItems
    savePassagePreviewSessionCache({
      items: passagePreviewItems.value,
      preloadedSentences: passagePreviewPreloaded.value.sentences,
      translations: passagePreviewPreloaded.value.translations,
    })
    const enriched = passagePreviewItems.value.find((item) => item.id === id)
    if (enriched) void registerPreviewItem({ item: enriched })
  }

  function waitForPassagePreviewAcquisitionRegistrations() {
    return passagePreviewAcquisitionRegistrationPromise
  }

  function registerPreviewItem(payload = {}) {
    const item = payload.item || payload
    if (!item?.lemma && !item?.word) return Promise.resolve(null)
    if (item.id && !passagePreviewLearningRevealTimes.has(item.id)) {
      passagePreviewLearningRevealTimes.set(
        item.id,
        payload.revealedAt || new Date().toISOString(),
      )
    }
    const operation = passagePreviewAcquisitionRegistrationPromise
      .catch(() => undefined)
      .then(() => passagePreviewAcquisition.registerItem(item))
      .catch((error) => {
        console.warn('[passage-preview] acquisition registration unavailable', error)
        return null
      })
      .finally(() => refreshPendingPreviewSummary().catch(() => {}))
    passagePreviewAcquisitionRegistrationPromise = operation
    return operation
  }

  async function completePreviewLearningSession(payload = {}) {
    const items = Array.isArray(payload.items) && payload.items.length
      ? payload.items
      : passagePreviewItems.value
    const progress = payload.progress || {}
    if (!items.length || progress.status !== 'completed') return
    await waitForPassagePreviewAcquisitionRegistrations()
    const session = createPassagePreviewLearningSession({
      batchId: derivePassagePreviewBatchId(items),
      items,
      progress,
      revealedAtByItem: Object.fromEntries(passagePreviewLearningRevealTimes),
      timeZone: detectLocalTimeZone(),
    })
    passagePreviewLearningSavePromise = savePassagePreviewLearningSession(session).catch((error) => {
      console.warn('[passage-preview] learning history save unavailable', error)
    })
    await passagePreviewLearningSavePromise
    await refreshPendingPreviewSummary()
  }

  function addDate(dates, date) {
    return [...new Set([...(Array.isArray(dates) ? dates : []), date].filter(Boolean))]
  }

  function formatLocalDate(value) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function detectLocalTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
    } catch (_error) {
      return 'local'
    }
  }

  return {
    isPassagePreviewOpen,
    passagePreviewItems,
    passagePreviewPreparing,
    passagePreviewPreparationMessage,
    passagePreviewPreloaded,
    isPassagePreviewSettingsOpen,
    passagePreviewWaitingCount,
    passagePreviewQueueNotice,
    openPassagePreview,
    importPassagePreviewFile,
    registerPreviewItem,
    completePreviewLearningSession,
    saveEnrichedPreviewItem,
    closePassagePreview,
    openPassagePreviewSettings,
    closePassagePreviewSettings,
    refreshPendingPreviewSummary,
    replayPersistedPassagePreviewAcquisitions,
  }
}
