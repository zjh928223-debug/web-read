import { ref } from 'vue'
import { youtubeWorkflowClient } from './youtube-workflow-client.js'
import { createJobPollingScheduler } from '../services/workflow/job-polling-scheduler.js'
import { materialTimestamp } from '../services/workflow/material-center-model.js'
import { observeBestEffort, recordBestEffortFailure } from '../services/runtime/best-effort.js'

const terminalStatuses = new Set(['ready', 'failed', 'canceled'])

// One list/polling lifetime per Panel; reader persistence has its own App scope.
export function useWorkflowLibrary({
  client = youtubeWorkflowClient,
  onRevision,
  onRevisionUnavailable,
  onJobsChanged,
  canRetryLibrary,
  hasUntrustedMarksNotice,
}) {
  const queueJobs = ref([])
  const recentJobs = ref([])
  const libraryTimeScope = ref('all')
  const libraryPending = ref(false)
  const libraryHasMore = ref(false)
  const libraryPageSize = 20
  const serviceOnline = ref(false)
  const serviceStatusKnown = ref(false)
  const libraryNotice = ref('')
  const completionSignal = ref(false)
  const visibleCompletedJobIds = ref([])
  const repairStates = new Map()
  const completedTaskTimers = new Map()
  const pollingRestartTimers = new Set()
  let jobPollingScheduler = null
  let workflowSnapshotFlight = null
  let completionSignalTimer = 0
  let libraryRetryTimer = 0
  let libraryRetryCount = 0
  let disposed = false

  async function refreshQueue() {
    if (disposed) return
    onRevisionUnavailable()
    await refreshJobsSnapshot(queueJobs.value.map((job) => job.jobId))
    onJobsChanged()
  }

  function requestWorkflowSnapshot(jobIds, signal, options = {}) {
    if (workflowSnapshotFlight) return workflowSnapshotFlight
    const ids = Array.isArray(jobIds) ? jobIds : []
    const includeAll = options.includeAll === true || ids.length === 0
    let flight
    flight = client.getJobsSnapshot(ids, {
      signal,
      includeAll,
    })
      .then((payload) => {
        if (disposed) return payload
        onRevision(payload)
        const jobs = payload && Array.isArray(payload.jobs) ? payload.jobs : []
        jobs.forEach(updateJob)
        return payload
      })
      .catch((error) => {
        onRevisionUnavailable()
        throw error
      })
      .finally(() => {
        if (workflowSnapshotFlight === flight) workflowSnapshotFlight = null
      })
    workflowSnapshotFlight = flight
    return flight
  }

  async function refreshJobsSnapshot(jobIds, signal) {
    const ids = Array.isArray(jobIds) ? jobIds : []
    const payload = await requestWorkflowSnapshot(ids, signal, { includeAll: ids.length === 0 })
    const jobs = payload && Array.isArray(payload.jobs) ? payload.jobs : []
    return jobs
  }

  async function refreshLibrary(options = {}) {
    const append = options.append === true
    if (disposed || libraryPending.value) return
    libraryPending.value = true
    try {
      const offset = append ? recentJobs.value.length : 0
      const items = await client.readerRecent({
        limit: libraryPageSize,
        offset,
        timeScope: libraryTimeScope.value,
      })
      if (disposed) return
      const normalized = Array.isArray(items)
        ? items.filter((item) => item && item.jobId).map((item) => ({ ...item, ...(repairStates.get(item.jobId) || {}) }))
        : []
      recentJobs.value = append ? [...recentJobs.value, ...normalized] : normalized
      recentJobs.value.sort((left, right) => materialTimestamp(right) - materialTimestamp(left))
      libraryHasMore.value = normalized.length === libraryPageSize
      onJobsChanged()
      serviceOnline.value = true
      serviceStatusKnown.value = true
      libraryRetryCount = 0
      if (!hasUntrustedMarksNotice()) libraryNotice.value = ''
    } catch (err) {
      if (disposed) return
      serviceStatusKnown.value = true
      if (err?.code === 'owner-not-ready') {
        serviceOnline.value = true
        libraryNotice.value = libraryRetryCount === 0
          ? 'Windows 后台正在启动，素材库会自动刷新…'
          : 'Windows 后台尚未就绪，请稍后再打开素材库。'
        if (libraryRetryCount === 0 && !libraryRetryTimer) {
          libraryRetryCount = 1
          libraryRetryTimer = window.setTimeout(() => {
            libraryRetryTimer = 0
            if (!canRetryLibrary()) return
            observeBestEffort(refreshLibrary(), {
              operationId: 'material-center-library-retry',
              reason: 'retry one transient Windows owner startup read after the panel is interactive',
            })
          }, 750)
        }
      } else {
        serviceOnline.value = false
        libraryNotice.value = err && err.message ? err.message : String(err)
      }
    } finally {
      libraryPending.value = false
    }
  }

  function refreshRecent() {
    return refreshLibrary()
  }

  function setLibraryTimeScope(scope) {
    if (libraryTimeScope.value === scope && recentJobs.value.length) return
    libraryTimeScope.value = scope
    recentJobs.value = []
    libraryHasMore.value = false
    refreshLibrary()
  }

  function loadMoreLibrary() {
    return refreshLibrary({ append: true })
  }

  async function refreshJob(jobId) {
    try {
      const fresh = await client.getJob(jobId)
      updateJob(fresh)
    } catch (error) {
      recordBestEffortFailure(error, {
        operationId: 'panel-job-refresh',
        reason: 'polling retains the previous immutable job snapshot until the next scheduled refresh',
        details: { jobId },
      })
    }
  }

  function updateJob(fresh) {
    if (disposed) return
    onRevision(fresh)
    const index = queueJobs.value.findIndex((job) => job.jobId === fresh.jobId)
    const previous = index >= 0 ? queueJobs.value[index] : null
    if (previous?.title && !fresh.title) fresh = { ...fresh, title: previous.title }
    if (index >= 0) queueJobs.value[index] = fresh
    else queueJobs.value.push(fresh)
    if (fresh.status === 'ready' && previous && previous.status !== 'ready') {
      completionSignal.value = true
      visibleCompletedJobIds.value = [...new Set([...visibleCompletedJobIds.value, fresh.jobId])]
      const previousTaskTimer = completedTaskTimers.get(fresh.jobId)
      if (previousTaskTimer) window.clearTimeout(previousTaskTimer)
      completedTaskTimers.set(fresh.jobId, window.setTimeout(() => {
        visibleCompletedJobIds.value = visibleCompletedJobIds.value.filter((jobId) => jobId !== fresh.jobId)
        completedTaskTimers.delete(fresh.jobId)
      }, 5000))
      if (completionSignalTimer) window.clearTimeout(completionSignalTimer)
      completionSignalTimer = window.setTimeout(() => { completionSignal.value = false }, 5000)
      refreshLibrary()
    }
    if (terminalStatuses.has(fresh.status) && (!previous || previous.status !== fresh.status)) {
      refreshRecent()
      const timer = window.setTimeout(() => {
        pollingRestartTimers.delete(timer)
        startPolling()
      }, 0)
      pollingRestartTimers.add(timer)
    }
  }

  function startPolling() {
    if (disposed) return
    if (!jobPollingScheduler) {
      jobPollingScheduler = createJobPollingScheduler({
        fetchJobs: (jobIds, signal) => refreshJobsSnapshot(jobIds, signal),
        onJobs: () => {},
        onError: (error) => {
          libraryNotice.value = error && error.message ? error.message : String(error)
        },
        isHidden: () => document.hidden,
        intervalMs: 2000,
        hiddenIntervalMs: 10000,
      })
    }
    const activeIds = queueJobs.value
      .filter((job) => !terminalStatuses.has(job.status))
      .map((job) => job.jobId)
    if (activeIds.length) jobPollingScheduler.start(activeIds)
    else jobPollingScheduler.stop()
  }

  function stopPolling() {
    jobPollingScheduler?.stop()
  }

  function mergeRecentReaderItem(item) {
    if (disposed) return
    if (!item || !item.jobId) return
    const index = recentJobs.value.findIndex((entry) => entry.jobId === item.jobId)
    if (index >= 0) recentJobs.value[index] = { ...recentJobs.value[index], ...item }
    else recentJobs.value.unshift(item)
  }

  function clearMaterialRepairState(jobId) {
    repairStates.delete(jobId)
    recentJobs.value = recentJobs.value.map((item) => {
      if (item.jobId !== jobId) return item
      const { needsRepair: _needsRepair, repairReason: _repairReason, repairAction: _repairAction, ...readyItem } = item
      return readyItem
    })
  }

  function resetLibraryRetry() {
    libraryRetryCount = 0
    if (libraryRetryTimer) window.clearTimeout(libraryRetryTimer)
    libraryRetryTimer = 0
  }

  function recordMaterialRepair(jobId, repair) {
    repairStates.set(jobId, repair)
    recentJobs.value = recentJobs.value.map(item => item.jobId === jobId ? { ...item, ...repair } : item)
  }

  function removeQueueJobs(jobIds) {
    queueJobs.value = queueJobs.value.filter(job => !jobIds.includes(job.jobId))
  }

  function removeLibraryRecord(jobId) {
    recentJobs.value = recentJobs.value.filter(item => item.jobId !== jobId)
    removeQueueJobs([jobId])
  }

  function removeFailedJobs() {
    queueJobs.value = queueJobs.value.filter(job => job.status !== 'failed')
  }

  function dispose() {
    if (disposed) return
    disposed = true
    resetLibraryRetry()
    if (completionSignalTimer) window.clearTimeout(completionSignalTimer)
    completedTaskTimers.forEach(timer => window.clearTimeout(timer))
    completedTaskTimers.clear()
    pollingRestartTimers.forEach(timer => window.clearTimeout(timer))
    pollingRestartTimers.clear()
    jobPollingScheduler?.dispose()
    jobPollingScheduler = null
  }

  return Object.freeze({
    queueJobs, recentJobs, libraryTimeScope, libraryPending, libraryHasMore,
    serviceOnline, serviceStatusKnown, libraryNotice, completionSignal, visibleCompletedJobIds,
    refreshQueue, requestWorkflowSnapshot, refreshLibrary, refreshRecent, refreshJob,
    setLibraryTimeScope, loadMoreLibrary, resetLibraryRetry, updateJob,
    startPolling, stopPolling, mergeRecentReaderItem, recordMaterialRepair,
    clearMaterialRepairState, removeQueueJobs, removeLibraryRecord, removeFailedJobs, dispose,
  })
}
