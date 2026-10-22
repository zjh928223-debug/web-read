import { readonly, ref } from 'vue'
import { useAudioStore } from '../pinia-stores/audio.js'
import { useMarksStore } from '../pinia-stores/marks.js'
import { runtimeState } from './runtime-state-facade.js'
import { bridgeToPinia } from './pinia-bridge-module.js'
import { youtubeWorkflowClient } from './youtube-workflow-client.js'
import { createReaderMarksHydration } from './create-reader-marks-hydration.js'
import { createReaderPlaybackTracker } from '../services/workflow/reader-playback-tracker.js'
import { createReaderSessionPersistence } from '../services/persistence/reader-session-persistence.js'
import {
  createReaderOutboxEntry,
  isTrustedReaderMarksOutboxEntry,
  READER_MARKS_OUTBOX_SOURCE,
  readReaderOutbox,
  writeReaderOutboxEntry,
  removeReaderOutboxEntry,
} from '../services/persistence/reader-outbox-storage.js'
import { useReaderSaveCoordinator } from './use-reader-save-coordinator.js'
import { observeBestEffort, recordBestEffortFailure } from '../services/runtime/best-effort.js'

// One application scope; UI subscribers and loader registrations may leave independently.
export function useReaderSessionPersistence() {
  const currentJobId = ref('')
  const readerSessionLoadInProgress = ref(false)
  const recentReaderSubscribers = new Set()
  const loaderCancellations = new Set()
  let activeLoad = null
  let loadSequence = 0
  let started = false
  let stopped = false
  const audioStore = useAudioStore()
  const marksStore = useMarksStore()
  const readerSessionPersistence = createReaderSessionPersistence()
  let readerMarksHydration = null
  let readerUnloadFlushed = false
  let readerCloseGeneration = 0
  let readerOutboxReplayPromise = null
  const READER_UNTRUSTED_MARKS_OUTBOX_NOTICE = '发现来源不明的旧标记补发记录，已保留，未自动发送；请核对后重新编辑并保存'

  const readerPlaybackTracker = createReaderPlaybackTracker({
    getCurrentJobId: () => stopped ? '' : currentJobId.value,
    getReaderMedia,
    getMediaSource,
    ensureCurrentJobFromAudioMeta,
    onActivity: (event) => syncReaderActivity(event),
    getCurrentMarkCount,
  })
  const {
    readerActivityNotice,
    readerMarksSaveState,
    readerActivitySaveState,
    readerConflictVisible,
    getReaderMarksLedger,
    getReaderActivityLedger,
    getReaderMarksPendingIntent,
    updateReaderConflictVisibility,
    loadReaderConflict,
    clearReaderConflict,
    resolveReaderConflict,
    rememberReaderRevision,
    getReaderRevision,
    dispose: disposeReaderSaveCoordinator,
  } = useReaderSaveCoordinator({
    currentJobId,
    getReaderSessionId: () => readerPlaybackTracker.getReaderSessionId(),
    mergeRecentReaderItem,
    onReaderMarksAuthority: (jobId, payload) => {
      if (stopped) return
      readerMarksHydration?.rememberAuthoritativeMarks(jobId, payload.marks, payload.revision)
    },
    onReaderMarksSaved: (jobId, marks, revision, localVersion) => {
      if (stopped) return
      readerMarksHydration?.markLocalChangesSaved(jobId, marks, revision, localVersion)
    },
  })
  readerMarksHydration = createReaderMarksHydration({
    getCurrentJobId: () => stopped ? '' : currentJobId.value,
    getCurrentReaderMarks,
    rememberMarksRevision: (jobId, revision) => {
      if (!stopped) rememberReaderRevision('marks', jobId, revision)
    },
    restoreVisibleMarks: async (marks) => {
      if (stopped) return
      replaceReaderMarksVisible(marks)
      if (typeof window.syncAnnotationGenerationEntryStatus === 'function') {
        await window.syncAnnotationGenerationEntryStatus({ source: 'restore' })
      }
    },
    submitLocalChanges: (intent) => {
      if (stopped) return
      if (!intent || !Number.isInteger(intent.sourceRevision)) return
      submitCurrentReaderMarks(intent)
      syncReaderActivity('annotation')
    },
  })

  function ensureCurrentJobFromAudioMeta() {
    if (stopped) return
    if (currentJobId.value) {
      readerMarksHydration.startReaderMarksHydration(currentJobId.value)
      updateReaderConflictVisibility()
      return
    }
    const meta = runtimeState && runtimeState.currentAudioMeta
    const jobId = meta && meta.source === 'youtube-workflow' ? String(meta.jobId || '') : ''
    if (!jobId) return
    currentJobId.value = jobId
    readerPlaybackTracker.startReaderSession({ jobId })
    readerMarksHydration.startReaderMarksHydration(jobId)
    updateReaderConflictVisibility()
  }

  async function syncReaderActivity(event = 'progress') {
    if (stopped) return null
    if (readerSessionLoadInProgress.value && event !== 'switch') return null
    if (!currentJobId.value) return null
    const payload = readerPlaybackTracker.buildReaderActivityPayload(event)
    if (!payload) return null
    const ledger = getReaderActivityLedger(payload.jobId)
    ledger.submit({ jobId: payload.jobId, payload })
    await ledger.waitForIdle()
    return ledger.getState().status === 'saved' ? ledger.getState() : null
  }

  function getCurrentMarkCount() {
    const el = document.getElementById('annotation-mark-count')
    const value = el ? Number(el.dataset.count || 0) : 0
    return Number.isFinite(value) ? Math.max(0, value) : 0
  }

  function normalizeReaderMarks(marks) {
    const words = runtimeState && Array.isArray(runtimeState.words) ? runtimeState.words : []
    const normalized = []
    for (const raw of Array.isArray(marks) ? marks : []) {
      if (!raw || typeof raw !== 'object') continue
      const globalIndex = Number(raw.globalIndex)
      if (!Number.isInteger(globalIndex) || globalIndex < 0 || globalIndex >= words.length) continue
      const word = words[globalIndex] || {}
      normalized.push({
        ...raw,
        globalIndex,
        word: String(raw.word || word.word || ''),
        start: Number.isFinite(Number(raw.start)) ? Number(raw.start) : word.start,
        sourceType: String(raw.sourceType || raw.source || 'manual-mark')
      })
    }
    return normalized
  }

  function getCurrentReaderMarks() {
    const markedMap = runtimeState && runtimeState.markedMap instanceof Map ? runtimeState.markedMap : null
    if (!markedMap) return []
    return normalizeReaderMarks(Array.from(markedMap.values()))
  }

  function syncMarkedWordVisuals(marks) {
    document.querySelectorAll('[data-word-index].marked').forEach((el) => el.classList.remove('marked'))
    marks.forEach((mark) => {
      if (marksStore && typeof marksStore.syncVisual === 'function') {
        marksStore.syncVisual(mark.globalIndex, true)
      } else {
        document.querySelectorAll(`[data-word-index="${mark.globalIndex}"]`).forEach((el) => el.classList.add('marked'))
      }
    })
  }

  function replaceReaderMarksVisible(marks) {
    if (!runtimeState || !(runtimeState.markedMap instanceof Map)) return []
    const normalized = normalizeReaderMarks(marks)
    runtimeState.markedMap.clear()
    normalized.forEach((mark) => runtimeState.markedMap.set(mark.globalIndex, mark))
    syncMarkedWordVisuals(normalized)
    bridgeToPinia()
    return normalized
  }

  async function applyReaderMarks(marks, options = {}) {
    const normalized = replaceReaderMarksVisible(marks)
    const jobId = String(options.jobId || currentJobId.value || '').trim()
    if (!stopped && jobId && readerMarksHydration) {
      readerMarksHydration.rememberAuthoritativeMarks(jobId, normalized, options.revision, { applied: true })
    }
    if (options.persist !== false) await audioStore.saveToDB('marks', normalized)
    if (typeof window.syncAnnotationGenerationEntryStatus === 'function') {
      await window.syncAnnotationGenerationEntryStatus({ source: 'restore' })
    }
  }

  function submitCurrentReaderMarks(intent = {}) {
    if (stopped) return
    ensureCurrentJobFromAudioMeta()
    if (!currentJobId.value) return
    const jobId = currentJobId.value
    const hydrationIntent = readerMarksHydration?.getLocalIntent(jobId)
    const marks = Array.isArray(intent.marks)
      ? intent.marks
      : hydrationIntent?.marks || getCurrentReaderMarks()
    const sourceRevision = Number.isInteger(intent.sourceRevision)
      ? intent.sourceRevision
      : hydrationIntent?.sourceRevision
    if (!Number.isInteger(sourceRevision)) return null
    return getReaderMarksLedger(jobId).submit({
      jobId,
      marks,
      source: READER_MARKS_OUTBOX_SOURCE,
      sourceRevision,
      localVersion: Number.isInteger(intent.localVersion)
        ? intent.localVersion
        : hydrationIntent?.localVersion,
    })
  }

  function handleReaderMarksChanged(event) {
    if (readerSessionLoadInProgress.value || stopped) return
    ensureCurrentJobFromAudioMeta()
    if (!currentJobId.value) return
    const jobId = currentJobId.value
    const source = String(event?.detail?.source || 'system')
    if (source === 'restore') {
      observeBestEffort(readerMarksHydration.handleProgrammaticRestore(jobId), {
        operationId: 'reader-marks-restore-notification',
        reason: 'a late session snapshot must not replace authoritative or locally edited marks',
      })
      return
    }
    if (source !== 'edit') return
    const intent = readerMarksHydration.recordLocalEdit(jobId, {
      marks: getCurrentReaderMarks(),
      operation: event?.detail?.operation,
    })
    if (!intent || readerMarksHydration.deferLocalChange(jobId)) return
    submitCurrentReaderMarks(intent)
    syncReaderActivity('annotation')
  }

  function readerOutboxRequest(entry, expectedRevision, keepalive = false) {
    if (entry.kind === 'marks') {
      if (!isTrustedReaderMarksOutboxEntry(entry)) {
        blockUntrustedReaderMarksOutbox(entry)
        const error = new Error('Reader marks outbox source is not trusted')
        error.code = 'READER_UNTRUSTED_MARKS_OUTBOX'
        throw error
      }
      const payload = {
        marks: entry.intent.marks,
        expectedRevision,
        operationId: entry.operationId,
      }
      return keepalive
        ? youtubeWorkflowClient.keepaliveReaderMarks(entry.jobId, payload)
        : youtubeWorkflowClient.saveReaderMarks(entry.jobId, payload)
    }
    const payload = {
      ...entry.intent,
      jobId: entry.jobId,
      expectedRevision,
      activityOperationId: entry.operationId,
    }
    return keepalive
      ? youtubeWorkflowClient.keepaliveReaderActivity(payload)
      : youtubeWorkflowClient.recordReaderActivity(payload)
  }

  function blockUntrustedReaderMarksOutbox(entry) {
    if (entry?.kind !== 'marks') return false
    readerActivityNotice.value = READER_UNTRUSTED_MARKS_OUTBOX_NOTICE
    if (currentJobId.value === entry.jobId) readerMarksSaveState.value = 'dirty'
    recordBestEffortFailure(new Error('Reader marks outbox source is not trusted'), {
      operationId: 'reader-outbox-untrusted-marks',
      reason: 'source-unknown marks outbox is retained for review and must not be replayed automatically',
    })
    return false
  }

  function isReaderConflictError(error) {
    return error?.category === 'conflict' || String(error?.code || '').endsWith('_REVISION_CONFLICT')
  }

  function setReaderOutboxState(entry, status, notice = '') {
    if (currentJobId.value !== entry.jobId) return
    if (entry.kind === 'marks') readerMarksSaveState.value = status
    else readerActivitySaveState.value = status
    if (notice) readerActivityNotice.value = notice
  }

  function clearReaderOutboxSuccessNotice() {
    if (readerActivityNotice.value.includes('本地最新意图仍未丢失')
      || readerActivityNotice.value.includes('最新进度仍保留')
      || readerActivityNotice.value.includes('权威版本暂时无法读取')) readerActivityNotice.value = ''
  }

  function settleReaderOutboxSuccess(entry, saved) {
    if (entry.kind === 'marks' && !isTrustedReaderMarksOutboxEntry(entry)) {
      return blockUntrustedReaderMarksOutbox(entry)
    }
    if (!stopped && Number.isInteger(saved?.revision)) {
      rememberReaderRevision(entry.kind, entry.jobId, saved.revision)
      if (entry.kind === 'marks') {
        readerMarksHydration?.markLocalChangesSaved(
          entry.jobId,
          entry.intent.marks,
          saved.revision,
          entry.intent.localVersion,
        )
      }
    }
    if (entry.kind === 'activity') mergeRecentReaderItem(saved)
    if (!removeReaderOutboxEntry(entry)) {
      setReaderOutboxState(entry, 'error')
      return false
    }
    clearReaderConflict(entry.kind, entry.jobId, entry.operationId)
    setReaderOutboxState(entry, 'saved')
    clearReaderOutboxSuccessNotice()
    return true
  }

  async function retryReaderOutboxEntry(entry, expectedRevision) {
    if (entry.kind === 'marks' && !isTrustedReaderMarksOutboxEntry(entry)) {
      return blockUntrustedReaderMarksOutbox(entry)
    }
    try {
      return settleReaderOutboxSuccess(entry, await readerOutboxRequest(entry, expectedRevision))
    } catch (error) {
      setReaderOutboxState(entry, 'conflict', '学习记录存在并发冲突，需确认后重试')
      return false
    }
  }

  async function replayReaderOutboxEntry(entry) {
    if (entry.kind === 'marks' && !isTrustedReaderMarksOutboxEntry(entry)) {
      return blockUntrustedReaderMarksOutbox(entry)
    }
    setReaderOutboxState(entry, 'dirty')
    try {
      return settleReaderOutboxSuccess(entry, await readerOutboxRequest(entry, entry.expectedRevision))
    } catch (error) {
      if (stopped) return false
      if (isReaderConflictError(error)) {
        setReaderOutboxState(entry, 'conflict', '学习记录存在并发冲突，需确认后重试')
        const localIntent = entry.kind === 'marks'
          ? { jobId: entry.jobId, marks: entry.intent.marks }
          : { jobId: entry.jobId, payload: { ...entry.intent, jobId: entry.jobId } }
        await loadReaderConflict(
          entry.kind,
          entry.jobId,
          error,
          localIntent,
          { operationId: entry.operationId },
          { retry: (revision) => retryReaderOutboxEntry(entry, revision) },
        )
        return false
      }
      setReaderOutboxState(entry, 'error')
      return false
    }
  }

  function replayReaderOutbox() {
    if (readerOutboxReplayPromise) return readerOutboxReplayPromise
    readerOutboxReplayPromise = (async () => {
      const outbox = readReaderOutbox()
      if (!outbox.valid) return
      await Promise.all(outbox.entries.map((entry) => replayReaderOutboxEntry(entry)))
    })().finally(() => {
      readerOutboxReplayPromise = null
    })
    return readerOutboxReplayPromise
  }

  function queueReaderKeepalive(entry) {
    return observeBestEffort(readerOutboxRequest(entry, entry.expectedRevision, true), {
      operationId: `reader-outbox-keepalive-${entry.kind}`,
      reason: 'page close cannot await reader durability; the versioned outbox remains the recovery receipt',
    }).then((saved) => {
      if (saved) settleReaderOutboxSuccess(entry, saved)
    })
  }

  function handleReaderPageHide(event) {
    handleBeforeUnload(event)
  }

  function handleReaderPageShow(event) {
    if (stopped || !event?.persisted) return
    readerUnloadFlushed = false
    readerCloseGeneration += 1
    ensureCurrentJobFromAudioMeta()
    updateReaderConflictVisibility()
  }

  function handleBeforeUnload() {
    if (readerSessionLoadInProgress.value) return
    if (readerUnloadFlushed) return
    ensureCurrentJobFromAudioMeta()
    const payload = readerPlaybackTracker.buildReaderActivityPayload('close')
    if (!payload) return
    const closeGeneration = readerCloseGeneration
    const activityOperationId = `reader-activity-${payload.jobId}-${payload.sessionId}-close-${closeGeneration}`
    const marksIntent = getReaderMarksPendingIntent(payload.jobId)
      || readerMarksHydration?.getLocalIntent(payload.jobId)
    const marksEntry = marksIntent
      && marksIntent.source === READER_MARKS_OUTBOX_SOURCE
      && Number.isInteger(marksIntent.localVersion)
      && marksIntent.localVersion >= 1
      && Number.isInteger(marksIntent.sourceRevision)
      ? createReaderOutboxEntry(
        'marks',
        {
          jobId: payload.jobId,
          marks: marksIntent.marks,
          source: READER_MARKS_OUTBOX_SOURCE,
          localVersion: marksIntent.localVersion,
        },
        `reader-marks-${payload.jobId}-${payload.sessionId}-close-${closeGeneration}`,
        marksIntent.sourceRevision,
      )
      : null
    const activityEntry = createReaderOutboxEntry(
      'activity',
      payload,
      activityOperationId,
      getReaderRevision('activity', payload.jobId) ?? 0,
    )
    if (!marksEntry && !activityEntry) return
    readerUnloadFlushed = true
    if (marksEntry) readerMarksSaveState.value = 'dirty'
    if (activityEntry) readerActivitySaveState.value = 'dirty'
    if (marksEntry) {
      writeReaderOutboxEntry(marksEntry)
      observeBestEffort(queueReaderKeepalive(marksEntry), {
        operationId: 'reader-outbox-marks-keepalive-settle',
        reason: 'the persisted marks outbox remains authoritative when close-time settlement cannot finish',
      })
    }
    if (activityEntry) {
      writeReaderOutboxEntry(activityEntry)
      observeBestEffort(queueReaderKeepalive(activityEntry), {
        operationId: 'reader-outbox-activity-keepalive-settle',
        reason: 'the persisted activity outbox remains authoritative when close-time settlement cannot finish',
      })
    }
  }

  function start() {
    if (started || stopped) return
    started = true
    readerPlaybackTracker.bindPlaybackTracking()
    ensureCurrentJobFromAudioMeta()
    observeBestEffort(replayReaderOutbox(), {
      operationId: 'reader-outbox-startup-replay',
      reason: 'reader outbox replay remains available for explicit retry after startup failure',
    })
    window.addEventListener('reader-marks-changed', handleReaderMarksChanged)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handleReaderPageHide)
    window.addEventListener('pageshow', handleReaderPageShow)
  }

  function stop() {
    if (stopped) return
    for (const cancel of loaderCancellations) cancel()
    activeLoad = null
    readerSessionLoadInProgress.value = false
    handleBeforeUnload()
    stopped = true
    loaderCancellations.clear()
    recentReaderSubscribers.clear()
    window.removeEventListener('beforeunload', handleBeforeUnload)
    window.removeEventListener('pagehide', handleReaderPageHide)
    window.removeEventListener('pageshow', handleReaderPageShow)
    window.removeEventListener('reader-marks-changed', handleReaderMarksChanged)
    readerPlaybackTracker.unbindPlaybackTracking()
    readerMarksHydration.clear()
    disposeReaderSaveCoordinator()
  }

  function registerLoadCancellation(cancel) {
    if (stopped) throw new Error('Reader session persistence has stopped')
    loaderCancellations.add(cancel)
    return () => {
      if (activeLoad?.cancel === cancel) cancelLoad(activeLoad.token)
      loaderCancellations.delete(cancel)
    }
  }

  function beginLoad(cancel) {
    if (stopped || !loaderCancellations.has(cancel)) return null
    if (activeLoad) cancelLoad(activeLoad.token)
    const token = ++loadSequence
    activeLoad = { token, cancel }
    readerSessionLoadInProgress.value = true
    return token
  }

  function isCurrentLoad(token) {
    return !stopped && token !== null && activeLoad?.token === token
  }

  function endLoad(token) {
    if (!isCurrentLoad(token)) return false
    activeLoad = null
    readerSessionLoadInProgress.value = false
    return true
  }

  function cancelLoad(token) {
    if (!isCurrentLoad(token)) return false
    activeLoad.cancel()
    return endLoad(token)
  }

  function activateJob(job, token) {
    if (!isCurrentLoad(token)) return false
    currentJobId.value = job.jobId
    updateReaderConflictVisibility()
    readerPlaybackTracker.startReaderSession(job)
    observeBestEffort(youtubeWorkflowClient.getReaderActivity(job.jobId).then((activity) => {
      if (!stopped && Number.isInteger(activity?.revision)) rememberReaderRevision('activity', job.jobId, activity.revision)
    }), {
      operationId: `reader-background-activity-load-${job.jobId}`,
      reason: 'activity revision hydration is not required for the first rendered reader frame',
    })
    return true
  }

  function getMediaSource() {
    return typeof window !== 'undefined' ? window.__mediaSource : null
  }

  function getReaderMedia() {
    const audio = document.getElementById('audio-player')
    const mediaSource = getMediaSource()
    return mediaSource?.getActiveMediaElement?.(audio) || audio
  }

  function mergeRecentReaderItem(item) {
    if (stopped) return
    for (const subscriber of recentReaderSubscribers) subscriber(item)
  }

  function subscribeRecentReaderItem(subscriber) {
    if (stopped) throw new Error('Reader session persistence has stopped')
    recentReaderSubscribers.add(subscriber)
    return () => recentReaderSubscribers.delete(subscriber)
  }

  const consumer = Object.freeze({
    currentJobId: readonly(currentJobId),
    loading: readonly(readerSessionLoadInProgress),
    readerSessionPersistence,
    readerActivityNotice: readonly(readerActivityNotice),
    readerConflictVisible: readonly(readerConflictVisible),
    resolveReaderConflict,
    applyReaderMarks,
    syncMarkedWordVisuals,
    syncReaderActivity,
    getPlaybackState: (jobId) => readerPlaybackTracker.getPlaybackState(jobId),
    hasUntrustedMarksNotice: () => readerActivityNotice.value === READER_UNTRUSTED_MARKS_OUTBOX_NOTICE,
    getReaderMedia,
    registerLoadCancellation,
    subscribeRecentReaderItem,
    beginLoad,
    endLoad,
    isCurrentLoad,
    cancelLoad,
    activateJob,
  })
  return Object.freeze({ consumer, start, stop })
}
