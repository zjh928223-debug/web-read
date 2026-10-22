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
import { PASSAGE_PREVIEW_ENTRY_STATES } from './passage-preview-entry-state.js'
import {
  buildPassagePreviewContactSummary,
  mergePassagePreviewContactStatuses,
  samePassagePreviewTarget,
} from './passage-preview-contact.js'

export function usePassagePreview({ vocabularyService, requestImportFile } = {}) {
  const requestImportFileHandler = typeof requestImportFile === 'function'
    ? requestImportFile
    : () => {}
  const isPassagePreviewOpen = ref(false)
  let initialPassagePreviewItems = []
  let initialPassagePreviewReadError = ''
  try {
    initialPassagePreviewItems = loadPassagePreviewData()
  } catch (error) {
    initialPassagePreviewReadError = error?.message || '已保存的待预习数据暂时不可读。'
  }
  const passagePreviewItems = ref(initialPassagePreviewItems)
  const passagePreviewOpening = ref(false)
  const passagePreviewPreparing = ref(false)
  const passagePreviewPreparationMessage = ref('正在准备预习句子…')
  const passagePreviewPreloaded = ref({ sentences: {}, translations: {} })
  const passagePreviewLearningRevealTimes = new Map()
  let passagePreviewLearningSavePromise = Promise.resolve()
  let passagePreviewAcquisitionRegistrationPromise = Promise.resolve()
  const isPassagePreviewSettingsOpen = ref(false)
  const passagePreviewWaitingCount = ref(null)
  const passagePreviewWaitingKnown = ref(false)
  const passagePreviewQueueNotice = ref('')
  const passagePreviewContactStatuses = ref({})
  const passagePreviewContactSummary = ref(buildPassagePreviewContactSummary())
  let introducedPassagePreviewRecords = []
  let introducedPassagePreviewRecordsLoaded = false
  let passagePreviewOpenRequestId = 0
  let passagePreviewDurableWriteChain = Promise.resolve()
  const passagePreviewEntryState = ref(initialPassagePreviewReadError
    ? PASSAGE_PREVIEW_ENTRY_STATES.READ_ERROR
    : initialPassagePreviewItems.length
      ? PASSAGE_PREVIEW_ENTRY_STATES.READY
      : PASSAGE_PREVIEW_ENTRY_STATES.NO_CANDIDATES)
  const passagePreviewEntryMessage = ref(initialPassagePreviewReadError)
  const passagePreviewEntrySource = ref(initialPassagePreviewItems.length ? 'saved' : '')
  let lastPassagePreviewProgress = createInitialPassagePreviewProgress()
  let passagePreviewReadCompleted = false
  const passagePreviewAcquisition = createPassagePreviewAcquisitionCoordinator({ vocabularyService })

  function setPassagePreviewEntryState(state, message = '', source = '') {
    passagePreviewEntryState.value = state
    passagePreviewEntryMessage.value = message
    if (source) passagePreviewEntrySource.value = source
  }

  function updatePassagePreviewContactSummary(
    progress = lastPassagePreviewProgress,
    items = passagePreviewItems.value,
    introducedRecords,
    { introducedRecordsLoaded = true } = {},
  ) {
    const nextProgress = progress || createInitialPassagePreviewProgress()
    lastPassagePreviewProgress = {
      ...nextProgress,
      firstContacts: {
        ...(lastPassagePreviewProgress?.firstContacts || {}),
        ...(nextProgress.firstContacts || {}),
      },
    }
    if (introducedRecords !== undefined) {
      introducedPassagePreviewRecords = Array.isArray(introducedRecords) ? introducedRecords : []
      if (introducedRecordsLoaded) {
        introducedPassagePreviewRecordsLoaded = true
      }
    }
    const records = introducedPassagePreviewRecords
    const contacts = lastPassagePreviewProgress.firstContacts || {}
    const nextStatuses = mergePassagePreviewContactStatuses({
      firstContacts: contacts,
      previousStatuses: passagePreviewContactStatuses.value,
      introducedRecords: records,
      introducedRecordsLoaded: introducedPassagePreviewRecordsLoaded,
    })
    passagePreviewContactStatuses.value = nextStatuses
    passagePreviewContactSummary.value = buildPassagePreviewContactSummary({
      items,
      firstContacts: contacts,
      statuses: nextStatuses,
    })
  }

  function createProgressPreservingContacts() {
    return createInitialPassagePreviewProgress({
      firstContacts: lastPassagePreviewProgress?.firstContacts || {},
    })
  }

  function mergeIntroducedPassagePreviewRecords(records) {
    const merged = [...introducedPassagePreviewRecords]
    for (const record of Array.isArray(records) ? records : []) {
      const existingIndex = merged.findIndex((candidate) => samePassagePreviewTarget(candidate, record))
      if (existingIndex >= 0) merged[existingIndex] = record
      else merged.push(record)
    }
    return merged
  }

  function isOpenPassagePreviewRequestCurrent(requestId) {
    return requestId === passagePreviewOpenRequestId
  }

  function enqueuePassagePreviewWrite(operation, requestId = passagePreviewOpenRequestId) {
    const queued = passagePreviewDurableWriteChain.then(async () => {
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      const result = await operation()
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      return result
    })
    passagePreviewDurableWriteChain = queued.catch(() => undefined)
    return queued
  }

  async function openStoredPassagePreviewLegacy(requestId = passagePreviewOpenRequestId) {
    if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
    if (validatePassagePreviewItems(passagePreviewItems.value)) {
      const prepared = await preparePassagePreviewItems(passagePreviewItems.value, { requestId })
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      const saved = await enqueuePassagePreviewWrite(async () => {
        await savePassagePreviewData(prepared)
        return true
      }, requestId)
      if (!saved || !isOpenPassagePreviewRequestCurrent(requestId)) return false
      passagePreviewItems.value = prepared
      isPassagePreviewOpen.value = true
      setPassagePreviewEntryState(PASSAGE_PREVIEW_ENTRY_STATES.READY, '', 'saved')
      return true
    }
    if (passagePreviewItems.value.length) {
      try {
        const migrated = importVocabularyPreview({
          title: '首次接触',
          answers: passagePreviewItems.value,
        })
        const prepared = await preparePassagePreviewItems(migrated, { requestId })
        if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
        const saved = await enqueuePassagePreviewWrite(async () => {
          await savePassagePreviewData(prepared)
          return true
        }, requestId)
        if (!saved || !isOpenPassagePreviewRequestCurrent(requestId)) return false
        passagePreviewItems.value = prepared
        isPassagePreviewOpen.value = true
        setPassagePreviewEntryState(PASSAGE_PREVIEW_ENTRY_STATES.READY, '', 'migrated')
        return true
      } catch (error) {
        if (isPassagePreviewOwnerAuthoritative()) throw error
      }
    }
    return false
  }

  async function refreshPendingPreviewSummary() {
    passagePreviewWaitingKnown.value = false
    passagePreviewWaitingCount.value = null
    try {
      const summary = await vocabularyService.getPendingPreviewLearningSummary()
      passagePreviewWaitingCount.value = Number(summary?.waiting || 0)
      passagePreviewWaitingKnown.value = true
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
      waiting: summary ? Number(summary.waiting || 0) : 0,
      currentBatchCompleted: true,
    })
    passagePreviewQueueNotice.value = decision.notice || ''
    return decision.allowed
  }

  async function reconcilePersistedPassagePreviewContacts(items, progress, introducedRecords = []) {
    const currentItems = new Map((Array.isArray(items) ? items : [])
      .map((item) => [String(item?.id || ''), item])
      .filter(([id]) => id))
    updatePassagePreviewContactSummary(progress, items, introducedRecords)
    for (const [id, contact] of Object.entries(progress?.firstContacts || {})) {
      const item = contact?.item || currentItems.get(id)
      if (!item?.id) continue
      if ((Array.isArray(introducedRecords) ? introducedRecords : [])
        .some((record) => samePassagePreviewTarget(item, record))) continue
      await registerPreviewItem({
        item,
        firstContact: contact,
        introducedAt: contact.seenAt,
      })
    }
    await waitForPassagePreviewAcquisitionRegistrations()
    updatePassagePreviewContactSummary(progress, items, await loadPreviewIntroducedRecords())
  }

  async function replayPersistedPassagePreviewAcquisitions() {
    try {
      const items = await loadPassagePreviewDataFromOwner() ?? loadPassagePreviewData()
      const progress = await loadPassagePreviewProgressFromOwner() ?? loadPassagePreviewProgress()
      const introducedRecords = await loadPreviewIntroducedRecords()
      await reconcilePersistedPassagePreviewContacts(items, progress, introducedRecords)
    } catch (error) {
      console.warn('[passage-preview] startup acquisition replay unavailable', error)
    }
  }

  async function openStoredPassagePreview(requestId = passagePreviewOpenRequestId) {
    if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
    if (passagePreviewOpening.value) return true
    passagePreviewOpening.value = true
    passagePreviewReadCompleted = false
    try {
      passagePreviewPreparationMessage.value = '正在读取已保存的预习批次…'
      await refreshPendingPreviewSummary()
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      const ownerItems = await loadPassagePreviewDataFromOwner()
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      passagePreviewItems.value = ownerItems ?? loadPassagePreviewData()
      passagePreviewEntrySource.value = ownerItems ? 'owner' : 'local'
      let progress = await loadPassagePreviewProgressFromOwner() ?? loadPassagePreviewProgress()
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      passagePreviewReadCompleted = true
      lastPassagePreviewProgress = progress
      updatePassagePreviewContactSummary(progress, passagePreviewItems.value)
      if (passagePreviewItems.value.length) {
        isPassagePreviewOpen.value = true
        setPassagePreviewEntryState(PASSAGE_PREVIEW_ENTRY_STATES.READY, '', passagePreviewEntrySource.value)
      }
      const storedBatchDate = getPreviewBatchDate(passagePreviewItems.value)
      const introducedRecords = await loadPreviewIntroducedRecords()
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
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
            }, requestId)
            if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
            if (!advanced) {
              progress = {
                ...progress,
                status: 'completed',
                completedAt: progress.completedAt || new Date().toISOString(),
              }
              isPassagePreviewOpen.value = true
              setPassagePreviewEntryState(PASSAGE_PREVIEW_ENTRY_STATES.READY, '', passagePreviewEntrySource.value)
              await refreshPendingPreviewSummary()
              return true
            }
            progress = await loadPassagePreviewProgressFromOwner() ?? loadPassagePreviewProgress()
            if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
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
          const saved = await enqueuePassagePreviewWrite(async () => {
            await savePassagePreviewData(passagePreviewItems.value)
            if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
            await savePassagePreviewProgress(progress)
            return true
          }, requestId)
          if (!saved) return false
        }
      }
      await reconcilePersistedPassagePreviewContacts(passagePreviewItems.value, progress, introducedRecords)
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      if (validatePassagePreviewItems(passagePreviewItems.value)) {
        const currentBatchDate = getPreviewBatchDate(passagePreviewItems.value)
        if (progress.status === 'completed') {
          const completionAction = resolveCompletedIeltsPreviewAction({
            waiting: passagePreviewWaitingCount.value,
            hasBatchDate: Boolean(currentBatchDate),
          })
          passagePreviewQueueNotice.value = completionAction.notice || passagePreviewQueueNotice.value
          if (completionAction.action === 'advance_dated_batch') {
            const advanced = await advanceCompletedIeltsPreviewBatch(currentBatchDate, progress, requestId)
            if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
            if (advanced) {
              isPassagePreviewOpen.value = true
              return true
            }
          } else if (completionAction.action === 'open_or_clear_undated_batch') {
            const started = await openFirstAvailableIeltsPreviewBatch(requestId)
            if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
            if (started) return true
            isPassagePreviewOpen.value = true
            setPassagePreviewEntryState(
              PASSAGE_PREVIEW_ENTRY_STATES.READY,
              passagePreviewQueueNotice.value || '当前完成批次已保留，暂无可继续打开的新组。',
              passagePreviewEntrySource.value,
            )
            await refreshPendingPreviewSummary()
            return true
          }
          // Keep the completed surface visible when capacity or the candidate
          // pool prevents a new group from being generated.
          isPassagePreviewOpen.value = true
          setPassagePreviewEntryState(PASSAGE_PREVIEW_ENTRY_STATES.READY, '', passagePreviewEntrySource.value)
          await refreshPendingPreviewSummary()
          return true
        }
        const sourceItems = passagePreviewItems.value
        isPassagePreviewOpen.value = true
        setPassagePreviewEntryState(PASSAGE_PREVIEW_ENTRY_STATES.READY, '', passagePreviewEntrySource.value)
        void prepareStoredPassagePreviewInBackground(sourceItems, requestId)
        return true
      }
      if (await openStoredPassagePreviewLegacy(requestId)) return true
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      passagePreviewPreparationMessage.value = '正在生成今日预习批次…'
      const started = await openFirstAvailableIeltsPreviewBatch(requestId)
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      if (!started) {
        isPassagePreviewOpen.value = true
        setPassagePreviewEntryState(
          hasLegacyPassagePreviewData()
            ? PASSAGE_PREVIEW_ENTRY_STATES.LEGACY_FORMAT
            : PASSAGE_PREVIEW_ENTRY_STATES.NO_CANDIDATES,
          passagePreviewQueueNotice.value || '',
          passagePreviewEntrySource.value,
        )
      }
      return started
    } finally {
      if (isOpenPassagePreviewRequestCurrent(requestId)) {
        passagePreviewOpening.value = false
        passagePreviewPreparing.value = false
      }
    }
  }

  async function openPassagePreview() {
    if (passagePreviewOpening.value) return
    const requestId = ++passagePreviewOpenRequestId
    isPassagePreviewOpen.value = true
    setPassagePreviewEntryState(PASSAGE_PREVIEW_ENTRY_STATES.LOADING, '正在读取待预习队列…')
    passagePreviewPreparing.value = true
    passagePreviewPreparationMessage.value = '正在读取待预习队列…'
    try {
      await Promise.all([
        passagePreviewLearningSavePromise,
        waitForPassagePreviewAcquisitionRegistrations(),
      ])
      await openStoredPassagePreview(requestId)
    } catch (error) {
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return
      console.warn('[passage-preview] open unavailable', error)
      setPassagePreviewEntryState(
        passagePreviewReadCompleted
          ? PASSAGE_PREVIEW_ENTRY_STATES.WRITE_UNAVAILABLE
          : PASSAGE_PREVIEW_ENTRY_STATES.READ_ERROR,
        error?.message || '待预习数据读取失败，请检查 Windows Host 是否正常运行。',
        passagePreviewEntrySource.value,
      )
    } finally {
      if (isOpenPassagePreviewRequestCurrent(requestId)) passagePreviewPreparing.value = false
    }
  }

  async function advanceCompletedIeltsPreviewBatch(currentBatchDate, progress, requestId = passagePreviewOpenRequestId) {
    if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
    if (!await ensurePreviewGenerationCapacity()) return false
    if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
    const continuation = await loadIeltsDailyPreviewContinuation()
    const allocations = await loadIeltsDailyPreviewAllocations()
    const excludedLemmas = await loadPreviewExcludedLemmas()
    if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
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
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      if (generated?.date >= currentBatchDate) resolvedNextBatch = generated
    }
    if (!resolvedNextBatch) {
      try {
        if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
        await saveIeltsDailyPreviewContinuation({
          ...continuation,
          consumedBatchDates: addDate(continuation.consumedBatchDates, currentBatchDate),
          lastLoadedBatchDate: currentBatchDate,
          updatedAt: new Date().toISOString(),
        })
        if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
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
      const preparedNextItems = await preparePassagePreviewItems(nextItems, { requestId })
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      const committed = await enqueuePassagePreviewWrite(() => commitPassagePreviewBatchTransition({
        archive: {
          date: currentBatchDate,
          items: passagePreviewItems.value,
          completedAt: progress.completedAt,
        },
        nextItems: preparedNextItems,
        progress: createProgressPreservingContacts(),
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
        canCommit: () => isOpenPassagePreviewRequestCurrent(requestId),
      }), requestId)
      if (!committed) return false
      passagePreviewLearningRevealTimes.clear()
      passagePreviewItems.value = preparedNextItems
      updatePassagePreviewContactSummary(createProgressPreservingContacts(), preparedNextItems)
      return true
    } catch (error) {
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      console.warn('[passage-preview] daily continuation unavailable', error)
      return false
    }
  }

  async function openFirstAvailableIeltsPreviewBatch(requestId = passagePreviewOpenRequestId) {
    if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
    if (!await ensurePreviewGenerationCapacity()) return false
    if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
    passagePreviewPreparationMessage.value = '正在读取今日候选词池…'
    const allocations = await loadIeltsDailyPreviewAllocations()
    const continuation = await loadIeltsDailyPreviewContinuation()
    const excludedLemmas = await loadPreviewExcludedLemmas()
    if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
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
    if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
    if (!resolvedNextBatch) return false
    try {
      passagePreviewPreparationMessage.value = `正在整理 ${resolvedNextBatch.words.length} 个预习词…`
      const items = await materializeIeltsDailyPreviewBatch({ batch: resolvedNextBatch })
      const preparedItems = await preparePassagePreviewItems(items, { requestId })
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      const committed = await enqueuePassagePreviewWrite(async () => {
        await savePassagePreviewData(preparedItems)
        if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
        const nextProgress = createProgressPreservingContacts()
        await savePassagePreviewProgress(nextProgress)
        if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
        await saveIeltsDailyPreviewContinuation({
          ...continuation,
          lastLoadedBatchDate: resolvedNextBatch.date,
          updatedAt: new Date().toISOString(),
        })
        return nextProgress
      }, requestId)
      if (!committed || !isOpenPassagePreviewRequestCurrent(requestId)) return false
      passagePreviewLearningRevealTimes.clear()
      passagePreviewItems.value = preparedItems
      updatePassagePreviewContactSummary(committed, preparedItems)
      isPassagePreviewOpen.value = true
      setPassagePreviewEntryState(PASSAGE_PREVIEW_ENTRY_STATES.READY, '', 'generated')
      await refreshPendingPreviewSummary()
      return true
    } catch (error) {
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
      console.warn('[passage-preview] daily allocation unavailable', error)
      return false
    }
  }

  async function preparePassagePreviewItems(
    items,
    { requestId = passagePreviewOpenRequestId } = {},
  ) {
    const source = Array.isArray(items) ? items : []
    const isCurrent = () => isOpenPassagePreviewRequestCurrent(requestId)
    if (!source.length) {
      if (isCurrent()) passagePreviewPreloaded.value = { sentences: {}, translations: {} }
      return source
    }
    const cached = loadPassagePreviewSessionCache(source)
    if (cached && isPreparedPassagePreviewCache(cached, source)) {
      if (!isCurrent()) return source
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
          if (!isCurrent()) return
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
      if (!isCurrent()) return source
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
      if (isCurrent()) passagePreviewPreloaded.value = { sentences: {}, translations: {} }
      return source
    }
  }

  async function prepareStoredPassagePreviewInBackground(sourceItems, requestId = passagePreviewOpenRequestId) {
    try {
      const preparedItems = await preparePassagePreviewItems(sourceItems, { requestId })
      if (!isOpenPassagePreviewRequestCurrent(requestId) || passagePreviewItems.value !== sourceItems) return
      const saved = await enqueuePassagePreviewWrite(async () => {
        await savePassagePreviewData(preparedItems)
        return true
      }, requestId)
      if (!saved || !isOpenPassagePreviewRequestCurrent(requestId) || passagePreviewItems.value !== sourceItems) return
      passagePreviewItems.value = preparedItems
    } catch (error) {
      console.warn('[passage-preview] background preparation unavailable', error)
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
    const closeRequestId = ++passagePreviewOpenRequestId
    isPassagePreviewOpen.value = false
    passagePreviewOpening.value = false
    passagePreviewPreparing.value = false
    passagePreviewQueueNotice.value = ''
    await Promise.all([
      passagePreviewLearningSavePromise,
      waitForPassagePreviewAcquisitionRegistrations(),
    ])
    if (!isOpenPassagePreviewRequestCurrent(closeRequestId)) return
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
      const records = await passagePreviewAcquisition.loadRecords()
      introducedPassagePreviewRecords = Array.isArray(records) ? records : []
      introducedPassagePreviewRecordsLoaded = true
      return introducedPassagePreviewRecords
    } catch (error) {
      if (isPassagePreviewOwnerAuthoritative()) throw error
      console.warn('[passage-preview] current-batch exclusion unavailable', error)
      return introducedPassagePreviewRecords
    }
  }

  async function importPassagePreviewFile(event) {
    const file = event.target?.files?.[0]
    event.target.value = ''
    if (!file) return
    const requestId = ++passagePreviewOpenRequestId
    try {
      const items = importVocabularyPreview(JSON.parse(await file.text()))
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return
      passagePreviewPreparing.value = true
      passagePreviewPreparationMessage.value = `正在准备 ${items.length} 条预习材料…`
      const preparedItems = await preparePassagePreviewItems(items, { requestId })
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return
      const committed = await enqueuePassagePreviewWrite(async () => {
        await savePassagePreviewData(preparedItems)
        if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
        const nextProgress = createProgressPreservingContacts()
        await savePassagePreviewProgress(nextProgress)
        return nextProgress
      }, requestId)
      if (!committed || !isOpenPassagePreviewRequestCurrent(requestId)) return
      passagePreviewItems.value = preparedItems
      updatePassagePreviewContactSummary(committed, preparedItems)
      isPassagePreviewOpen.value = true
      setPassagePreviewEntryState(PASSAGE_PREVIEW_ENTRY_STATES.READY, '', 'imported')
    } catch (error) {
      if (!isOpenPassagePreviewRequestCurrent(requestId)) return
      isPassagePreviewOpen.value = true
      setPassagePreviewEntryState(
        PASSAGE_PREVIEW_ENTRY_STATES.READ_ERROR,
        error?.message || '预习结果导入失败；已保存内容未清空。',
        'imported',
      )
    } finally {
      if (isOpenPassagePreviewRequestCurrent(requestId)) passagePreviewPreparing.value = false
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
  }

  function waitForPassagePreviewAcquisitionRegistrations() {
    return passagePreviewAcquisitionRegistrationPromise
  }

  function registerPreviewItem(payload = {}) {
    const firstContact = payload.firstContact || payload.contact
    const item = firstContact?.item || payload.item
    if (!firstContact || !item?.id || (!item?.lemma && !item?.word)) return Promise.resolve(null)
    const progress = payload.progress || lastPassagePreviewProgress
    const introducedAt = firstContact.seenAt || payload.introducedAt || payload.seenAt
    if (item.id && !passagePreviewLearningRevealTimes.has(item.id)) {
      passagePreviewLearningRevealTimes.set(
        item.id,
        introducedAt || new Date().toISOString(),
      )
    }
    passagePreviewContactStatuses.value = {
      ...passagePreviewContactStatuses.value,
      [item.id]: 'pending',
    }
    updatePassagePreviewContactSummary(progress, passagePreviewItems.value)
    const operation = passagePreviewAcquisitionRegistrationPromise
      .catch(() => undefined)
      .then(() => passagePreviewAcquisition.registerItem(item, { introducedAt }))
      .then((result) => {
        passagePreviewContactStatuses.value = {
          ...passagePreviewContactStatuses.value,
          [item.id]: result?.record ? 'committed' : 'failed',
        }
        updatePassagePreviewContactSummary(
          progress,
          passagePreviewItems.value,
          result?.record
            ? mergeIntroducedPassagePreviewRecords([result.record])
            : undefined,
          { introducedRecordsLoaded: introducedPassagePreviewRecordsLoaded },
        )
        return result
      })
      .catch((error) => {
        console.warn('[passage-preview] acquisition registration unavailable', error)
        passagePreviewContactStatuses.value = {
          ...passagePreviewContactStatuses.value,
          [item.id]: 'failed',
        }
        updatePassagePreviewContactSummary(progress, passagePreviewItems.value)
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
      revealedAtByItem: Object.fromEntries(
        Object.entries(progress.firstContacts || {}).map(([itemId, contact]) => [itemId, contact.seenAt]),
      ),
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
    passagePreviewWaitingKnown,
    passagePreviewQueueNotice,
    passagePreviewEntryState,
    passagePreviewEntryMessage,
    passagePreviewEntrySource,
    passagePreviewContactStatuses,
    passagePreviewContactSummary,
    openPassagePreview,
    requestPassagePreviewImport: requestImportFileHandler,
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
