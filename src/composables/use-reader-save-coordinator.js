import { ref } from 'vue'
import { youtubeWorkflowClient } from './youtube-workflow-client.js'
import { createLatestWinsLedger } from '../services/persistence/latest-wins-ledger.js'

export function useReaderSaveCoordinator({ currentJobId, getReaderSessionId, mergeRecentReaderItem }) {
  const readerActivityNotice = ref('')
  const readerMarksSaveState = ref('saved')
  const readerActivitySaveState = ref('saved')
  const readerConflictVisible = ref(false)
  const readerMarksLedgers = new Map()
  const readerActivityLedgers = new Map()
  const readerMarksRevisions = new Map()
  const readerActivityRevisions = new Map()
  const readerConflicts = new Map()

  function updateReaderConflictVisibility() {
    const matching = [...readerConflicts.values()].filter(
      (conflict) => conflict.jobId === currentJobId.value,
    )
    readerConflictVisible.value = matching.length > 0
    matching.forEach((conflict) => {
      if (conflict.kind === 'marks') readerMarksSaveState.value = 'conflict'
      else readerActivitySaveState.value = 'conflict'
      setReaderConflictNotice(conflict)
    })
  }

  function setReaderConflictNotice(conflict) {
    if (currentJobId.value !== conflict.jobId) return
    readerActivityNotice.value = conflict.authoritative
      ? '检测到其他标签页更新；本地最新意图仍未丢失，请确认后重试'
      : '检测到并发冲突，权威版本暂时无法读取，请稍后重试'
  }

  function fetchReaderConflictAuthority(conflict) {
    if (conflict.authorityFetch) return conflict.authorityFetch
    conflict.authorityFetch = (async () => {
      try {
        conflict.authoritative = conflict.kind === 'marks'
          ? await youtubeWorkflowClient.getReaderMarks(conflict.jobId)
          : await youtubeWorkflowClient.getReaderActivity(conflict.jobId)
        conflict.reloadError = null
        return conflict.authoritative
      } catch (reloadError) {
        conflict.reloadError = reloadError
        return null
      } finally {
        conflict.authorityFetch = null
        setReaderConflictNotice(conflict)
      }
    })()
    return conflict.authorityFetch
  }

  async function loadReaderConflict(kind, jobId, error, localIntent, context, options = {}) {
    const key = `${kind}:${jobId}`
    const conflict = {
      kind,
      jobId,
      error,
      localIntent,
      context,
      authoritative: null,
      authorityFetch: null,
      resolvePromise: null,
      retry: typeof options.retry === 'function' ? options.retry : null,
    }
    readerConflicts.set(key, conflict)
    updateReaderConflictVisibility()
    await fetchReaderConflictAuthority(conflict)
  }

  function clearReaderConflict(kind, jobId, operationId = '') {
    const key = `${kind}:${jobId}`
    const conflict = readerConflicts.get(key)
    if (operationId && conflict?.context?.operationId && conflict.context.operationId !== operationId) return
    readerConflicts.delete(key)
    updateReaderConflictVisibility()
  }

  async function resolveReaderConflict() {
    const currentConflicts = [...readerConflicts.values()].filter(
      (conflict) => conflict.jobId === currentJobId.value,
    )
    const retries = currentConflicts.map((conflict) => {
      if (conflict.resolvePromise) return conflict.resolvePromise
      conflict.resolvePromise = (async () => {
        const authoritative = conflict.authoritative || await fetchReaderConflictAuthority(conflict)
        if (!authoritative || !Number.isInteger(authoritative.revision)) return false
        if (conflict.kind === 'marks') readerMarksRevisions.set(conflict.jobId, authoritative.revision)
        else readerActivityRevisions.set(conflict.jobId, authoritative.revision)
        if (conflict.retry) return conflict.retry(authoritative.revision)
        const ledger = conflict.kind === 'marks'
          ? getReaderMarksLedger(conflict.jobId)
          : getReaderActivityLedger(conflict.jobId)
        return ledger.resolveConflict()
      })().finally(() => {
        conflict.resolvePromise = null
      })
      return conflict.resolvePromise
    })
    if (!retries.length) {
      readerActivityNotice.value = '正在读取权威版本，请稍后再次确认'
      return
    }
    const results = await Promise.all(retries)
    if (!results.some(Boolean)) readerActivityNotice.value = '正在读取权威版本，请稍后再次确认'
  }

  async function ensureReaderRevision(revisionMap, jobId, loadRevision) {
    if (revisionMap.has(jobId)) return revisionMap.get(jobId)
    try {
      const payload = await loadRevision()
      const revision = Number(payload?.revision)
      if (Number.isInteger(revision) && revision >= 0) {
        revisionMap.set(jobId, revision)
        return revision
      }
    } catch (_error) {
      // A missing or temporarily offline revision keeps the existing zero-based fallback.
    }
    return 0
  }

  function getReaderMarksLedger(jobId) {
    if (readerMarksLedgers.has(jobId)) return readerMarksLedgers.get(jobId)
    const ledger = createLatestWinsLedger({
      async write(entry, context) {
        const expectedRevision = await ensureReaderRevision(
          readerMarksRevisions,
          jobId,
          () => youtubeWorkflowClient.getReaderMarks(jobId),
        )
        const saved = await youtubeWorkflowClient.saveReaderMarks(entry.jobId, {
          marks: entry.marks,
          expectedRevision,
          operationId: context.operationId,
        })
        if (Number.isInteger(saved?.revision)) readerMarksRevisions.set(jobId, saved.revision)
        return saved
      },
      createOperationId(sequence) {
        return `reader-marks-${jobId}-${Date.now()}-${sequence}`
      },
      onStateChange(state) {
        if (currentJobId.value !== jobId) return
        readerMarksSaveState.value = state.status
        if (state.status === 'conflict') readerActivityNotice.value = '标记存在并发冲突，本地最新意图仍保留，请确认后重试'
        else if (state.status === 'error') readerActivityNotice.value = '标记保存失败，将在下次修改时重试'
        else if (state.status === 'saved') {
          clearReaderConflict('marks', jobId)
          if (readerActivityNotice.value.startsWith('标记保存失败')
            || readerActivityNotice.value.startsWith('标记存在并发冲突')
            || readerActivityNotice.value.includes('本地最新意图仍未丢失')
            || readerActivityNotice.value.includes('最新进度仍保留')) readerActivityNotice.value = ''
        }
      },
      onConflict(error, localIntent, context) {
        return loadReaderConflict('marks', jobId, error, localIntent, context)
      }
    })
    readerMarksLedgers.set(jobId, ledger)
    return ledger
  }

  function getReaderActivityLedger(jobId) {
    if (readerActivityLedgers.has(jobId)) return readerActivityLedgers.get(jobId)
    const ledger = createLatestWinsLedger({
      async write(entry, context) {
        const expectedRevision = await ensureReaderRevision(
          readerActivityRevisions,
          jobId,
          () => youtubeWorkflowClient.getReaderActivity(jobId),
        )
        const updated = await youtubeWorkflowClient.recordReaderActivity({
          ...entry.payload,
          activityOperationId: context.operationId,
          activitySequence: context.sequence,
          expectedRevision,
        })
        if (Number.isInteger(updated?.revision)) readerActivityRevisions.set(jobId, updated.revision)
        mergeRecentReaderItem(updated)
        return updated
      },
      createOperationId(sequence) {
        return `reader-activity-${jobId}-${getReaderSessionId() || 'session'}-${sequence}`
      },
      onStateChange(state) {
        if (currentJobId.value !== jobId) return
        readerActivitySaveState.value = state.status
        if (state.status === 'conflict') readerActivityNotice.value = '进度存在并发冲突，最新进度仍保留，请确认后重试'
        else if (state.status === 'error') readerActivityNotice.value = '进度保存失败，将保留最新进度重试'
        else if (state.status === 'saved') {
          clearReaderConflict('activity', jobId)
          if (readerActivityNotice.value.startsWith('进度保存失败')
            || readerActivityNotice.value.startsWith('进度存在并发冲突')
            || readerActivityNotice.value.includes('本地最新意图仍未丢失')
            || readerActivityNotice.value.includes('最新进度仍保留')) readerActivityNotice.value = ''
        }
      },
      onConflict(error, localIntent, context) {
        return loadReaderConflict('activity', jobId, error, localIntent, context)
      }
    })
    readerActivityLedgers.set(jobId, ledger)
    return ledger
  }

  function rememberReaderRevision(kind, jobId, revision) {
    const revisionMap = kind === 'marks' ? readerMarksRevisions : readerActivityRevisions
    revisionMap.set(jobId, revision)
  }

  function getReaderRevision(kind, jobId) {
    const revisionMap = kind === 'marks' ? readerMarksRevisions : readerActivityRevisions
    return revisionMap.get(jobId)
  }

  function dispose() {
    readerMarksLedgers.forEach((ledger) => ledger.dispose())
    readerMarksLedgers.clear()
    readerActivityLedgers.forEach((ledger) => ledger.dispose())
    readerActivityLedgers.clear()
    readerMarksRevisions.clear()
    readerActivityRevisions.clear()
    readerConflicts.clear()
    readerConflictVisible.value = false
  }

  return {
    readerActivityNotice,
    readerMarksSaveState,
    readerActivitySaveState,
    readerConflictVisible,
    getReaderMarksLedger,
    getReaderActivityLedger,
    updateReaderConflictVisibility,
    loadReaderConflict,
    clearReaderConflict,
    resolveReaderConflict,
    rememberReaderRevision,
    getReaderRevision,
    dispose,
  }
}
