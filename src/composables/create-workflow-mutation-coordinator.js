import { ref } from 'vue'
import { createYoutubeWorkflowOperationKey, youtubeWorkflowClient } from './youtube-workflow-client.js'
import {
  createWorkflowOperationFingerprint,
  cleanupWorkflowOperationReceipts,
  readWorkflowOperationReceipt,
  removeWorkflowOperationReceipt,
  writeWorkflowOperationReceipt,
} from '../services/workflow/operation-receipt.js'

// Panel-scoped workflow revision, receipt identity, and pending action ownership.
export function createWorkflowMutationCoordinator({
  client = youtubeWorkflowClient,
  requestWorkflowSnapshot,
  refreshQueue,
}) {
  const workflowRevision = ref(null)
  const workflowMutationNotice = ref('')
  const pendingWorkflowActions = new Map()
  let workflowRevisionNeedsRefresh = true
  let disposed = false

  function rememberWorkflowRevision(payload) {
    const revision = Number(payload && payload.revision)
    if (!Number.isInteger(revision) || revision < 0) return
    if (workflowRevision.value === null || revision >= workflowRevision.value) workflowRevision.value = revision
    workflowRevisionNeedsRefresh = false
  }

  function getPendingWorkflowAction(actionId, actionType, targetJobId = '', payload = {}) {
    const key = String(actionId || '')
    const fingerprint = createWorkflowOperationFingerprint({ actionType, targetJobId, payload })
    const existing = pendingWorkflowActions.get(key)
    if (existing && existing.fingerprint === fingerprint) return existing
    const storedReceipt = readWorkflowOperationReceipt({ actionType, targetJobId, payload })
    const action = {
      key: storedReceipt?.operationKey || createYoutubeWorkflowOperationKey(key || 'workflow-action'),
      actionType: String(actionType || 'workflow'),
      targetJobId: String(targetJobId || ''),
      payload,
      fingerprint,
      inFlight: null,
    }
    if (!storedReceipt) writeWorkflowOperationReceipt({ actionType, targetJobId, payload, operationKey: action.key })
    pendingWorkflowActions.set(key, action)
    return action
  }

  function forgetPendingWorkflowAction(actionId) {
    const key = String(actionId || '')
    const action = pendingWorkflowActions.get(key)
    if (action) {
      removeWorkflowOperationReceipt({
        actionType: action.actionType,
        targetJobId: action.targetJobId,
        payload: action.payload,
      })
    }
    pendingWorkflowActions.delete(key)
  }

  function workflowMutationOptions(action) {
    const revision = workflowRevision.value
    if (!Number.isInteger(revision) || revision < 0 || workflowRevisionNeedsRefresh) {
      throw createWorkflowRevisionUnavailableError()
    }
    return {
      idempotencyKey: action.key,
      expectedRevision: revision,
    }
  }

  function runPendingWorkflowAction(actionId, actionType, targetJobId, payload, send) {
    const action = getPendingWorkflowAction(actionId, actionType, targetJobId, payload)
    if (!action.inFlight) {
      let succeeded = false
      action.inFlight = Promise.resolve()
        .then(() => ensureWorkflowRevision())
        .then(() => send(Object.freeze({ key: action.key, targetJobId: action.targetJobId, payload: action.payload })))
        .then((result) => {
          succeeded = true
          return result
        })
        .finally(() => {
          action.inFlight = null
          if (disposed && !succeeded && pendingWorkflowActions.get(String(actionId || '')) === action) {
            pendingWorkflowActions.delete(String(actionId || ''))
          }
        })
    }
    return action.inFlight
  }

  function isWorkflowMutationConflict(error) {
    return Number(error && error.status) === 409 && (
      error.code === 'WORKFLOW_STATE_CONFLICT'
      || error.actualRevision !== undefined
      || error.currentRevision !== undefined
    )
  }

  function createWorkflowRevisionUnavailableError() {
    const error = new Error('无法获取权威队列版本，操作未发送；请重试。')
    error.code = 'WORKFLOW_REVISION_UNAVAILABLE'
    error.category = 'storage'
    error.retryable = true
    return error
  }

  async function ensureWorkflowRevision() {
    if (Number.isInteger(workflowRevision.value) && workflowRevision.value >= 0 && !workflowRevisionNeedsRefresh) {
      return workflowRevision.value
    }
    try {
      const payload = await requestWorkflowSnapshot([], undefined, { includeAll: true })
      const revision = Number(payload && payload.revision)
      if (!Number.isInteger(revision) || revision < 0) throw createWorkflowRevisionUnavailableError()
      return revision
    } catch (error) {
      workflowRevisionNeedsRefresh = true
      workflowMutationNotice.value = '无法获取权威队列版本，未发送操作；请检查网络后重试。'
      if (error && error.code === 'WORKFLOW_REVISION_UNAVAILABLE') throw error
      throw createWorkflowRevisionUnavailableError()
    }
  }

  async function handleWorkflowMutationConflict(error) {
    const actualRevision = Number(error && (error.actualRevision ?? error.currentRevision))
    if (Number.isInteger(actualRevision) && actualRevision >= 0) {
      if (workflowRevision.value === null || actualRevision >= workflowRevision.value) workflowRevision.value = actualRevision
    }
    workflowRevisionNeedsRefresh = true
    try {
      await refreshQueue()
    } catch (_refreshError) {
      // Keep the typed conflict and known revision visible when the refresh is also offline.
    }
    workflowMutationNotice.value = '素材状态刚刚更新，请再试一次。'
  }

  function invalidateWorkflowRevision() {
    workflowRevisionNeedsRefresh = true
  }

  async function deleteJob(jobId) {
    await ensureWorkflowRevision()
    const deleted = await client.deleteJob(jobId, { expectedRevision: workflowRevision.value })
    rememberWorkflowRevision(deleted)
    return deleted
  }

  async function clearFailedJobs() {
    await ensureWorkflowRevision()
    const cleared = await client.clearFailedJobs({ expectedRevision: workflowRevision.value })
    rememberWorkflowRevision(cleared)
    return cleared
  }

  function dispose() {
    disposed = true
    // Success confirmation still needs the captured receipt after Panel unmount.
    // Failed flights retain their durable receipt, then release this private entry.
    pendingWorkflowActions.forEach((action, key) => {
      if (!action.inFlight) pendingWorkflowActions.delete(key)
    })
  }

  return Object.freeze({
    workflowMutationNotice,
    rememberWorkflowRevision,
    invalidateWorkflowRevision,
    runPendingWorkflowAction,
    forgetPendingWorkflowAction,
    workflowMutationOptions,
    isWorkflowMutationConflict,
    handleWorkflowMutationConflict,
    deleteJob,
    clearFailedJobs,
    cleanupReceipts: cleanupWorkflowOperationReceipts,
    dispose,
  })
}
