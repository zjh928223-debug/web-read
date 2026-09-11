import { recordBestEffortFailure } from '../services/runtime/best-effort.js'

const DEFAULT_BASE_URL = import.meta.env?.VITE_LOCAL_SERVICE_BASE_URL
  || 'http://127.0.0.1:8765'
const DEFAULT_ACCESS_TOKEN = import.meta.env?.VITE_READ_WEB_SERVICE_TOKEN || ''
let operationSequence = 0

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function runtimeOrigin() {
  const origin = globalThis.location?.origin
  return typeof origin === 'string' && origin ? origin : ''
}

export function createYoutubeWorkflowOperationKey(prefix = 'workflow') {
  const normalizedPrefix = String(prefix || 'workflow').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow'
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return `${normalizedPrefix}-${globalThis.crypto.randomUUID()}`
    }
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16)
      globalThis.crypto.getRandomValues(bytes)
      return `${normalizedPrefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
    }
  } catch (_error) {
    // The monotonic in-memory fallback still remains stable for the pending action.
  }
  operationSequence += 1
  return `${normalizedPrefix}-${operationSequence}`
}

function mutationHeaders(options = {}, { json = false, idempotent = false, revision = false } = {}) {
  const headers = {}
  if (json) headers['content-type'] = 'application/json'
  const operationKey = options.idempotencyKey || options.operationKey
  if (idempotent && operationKey) headers['Idempotency-Key'] = String(operationKey)
  if (revision && options.expectedRevision !== undefined && options.expectedRevision !== null) {
    const expectedRevision = Number(options.expectedRevision)
    if (Number.isInteger(expectedRevision) && expectedRevision >= 0) {
      headers['X-Expected-Revision'] = String(expectedRevision)
      headers['If-Match'] = `"${expectedRevision}"`
    }
  }
  return headers
}

async function readJsonResponse(response) {
  if (!response.ok) {
    let detail = ''
    let code = ''
    let detailPayload = null
    let category = ''
    let retryable
    let details = null
    try {
      const body = await response.json()
      const structuredError = body?.detail && typeof body.detail === 'object'
        ? body.detail
        : body?.error && typeof body.error === 'object'
          ? body.error
          : null
      if (structuredError) {
        detailPayload = structuredError
        detail = String(structuredError.message || '')
        code = String(structuredError.code || '')
        category = String(structuredError.category || '')
        retryable = structuredError.retryable
        details = structuredError.details && typeof structuredError.details === 'object'
          ? structuredError.details
          : null
      } else {
        detail = body?.detail ? String(body.detail) : ''
      }
    } catch (error) {
      recordBestEffortFailure(error, {
        operationId: 'workflow-error-body-parse',
        reason: 'HTTP status fallback remains actionable when an optional JSON error body is malformed',
        details: { status: response.status },
      })
    }
    const error = new Error(detail || `YouTube workflow service returned ${response.status}`)
    if (code) error.code = code
    if (category) error.category = category
    if (retryable !== undefined) error.retryable = Boolean(retryable)
    if (details) error.details = details
    error.status = response.status
    if (detailPayload) {
      error.detail = detailPayload
      if (detailPayload.expectedRevision !== undefined) error.expectedRevision = detailPayload.expectedRevision
      const actualRevision = detailPayload.currentRevision ?? detailPayload.actualRevision
      if (actualRevision !== undefined) {
        error.actualRevision = actualRevision
        error.currentRevision = actualRevision
      }
    }
    throw error
  }
  return response.json()
}

function activeMarksOwner() {
  const cutover = globalThis.__windowsOwnerDomainCutover
  return cutover
    && typeof cutover.isAuthoritative === 'function'
    && cutover.isAuthoritative('marks-activity')
    && typeof cutover.query === 'function'
    && typeof cutover.command === 'function'
    ? cutover
    : null
}

function activeWorkflowOwner() {
  const cutover = globalThis.__windowsOwnerDomainCutover
  return cutover
    && typeof cutover.isAuthoritative === 'function'
    && cutover.isAuthoritative('workflow')
    && typeof cutover.query === 'function'
    && typeof cutover.command === 'function'
    ? cutover
    : null
}

function workflowJobsRevision(revision) {
  const match = /^w1:j([0-9]+):/u.exec(String(revision || ''))
  return match ? Number(match[1]) : null
}

function workflowMutationError(response, fallbackCode = 'workflow-owner-mutation-not-committed') {
  const outcome = response?.outcome
  const error = new Error(response?.error?.message || 'Host workflow mutation was not committed')
  error.code = response?.error?.code || fallbackCode
  error.category = response?.error?.category
    || (outcome === 'conflict' || response?.commitStatus === 'conflict' ? 'conflict' : 'recovery')
  error.retryable = response?.error?.retryable !== false
  const responseDetails = response?.error?.details
  if (responseDetails && typeof responseDetails === 'object' && !Array.isArray(responseDetails)) {
    error.details = responseDetails
    error.detail = { ...response.error, ...responseDetails }
  } else if (response?.error && typeof response.error === 'object') {
    error.detail = response.error
  }
  const currentRevision = response?.error?.details?.currentRevision ?? response?.revision
  const numericRevision = workflowJobsRevision(currentRevision)
  if (numericRevision !== null) {
    error.currentRevision = numericRevision
    error.actualRevision = numericRevision
  }
  error.status = outcome === 'conflict' || response?.commitStatus === 'conflict' ? 409 : 503
  return error
}

function requireWorkflowCommit(response) {
  if (response?.outcome !== 'committed' || response?.commitStatus !== 'committed') {
    throw workflowMutationError(response)
  }
  return response
}

function workflowUnsupportedError(operation) {
  const error = new Error(`Host workflow operation is not registered: ${operation}`)
  error.code = 'workflow-owner-operation-unsupported'
  error.category = 'not-ready'
  error.retryable = false
  error.status = 503
  return error
}

async function currentMarksRevision(cutover, jobId, contentId, signal) {
  const response = await cutover.query({
    domain: 'marks-activity',
    operation: 'revision',
    payload: { jobId, contentId },
    ...(signal ? { signal } : {}),
  })
  const revision = response?.payload?.revision ?? response?.revision
  if (!Number.isInteger(revision) || revision < 0) {
    const error = new Error('Host marks/activity revision is unavailable')
    error.code = 'marks-owner-not-ready'
    throw error
  }
  return revision
}

function marksOperationKey(operation, jobId, contentId, payload, options = {}) {
  const explicit = options.idempotencyKey
    || options.operationKey
    || payload?.idempotencyKey
    || payload?.operationId
    || payload?.activityOperationId
  if (explicit) return String(explicit)
  const text = JSON.stringify({ operation, jobId, contentId, payload })
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `marks-${operation}-${(hash >>> 0).toString(16)}`
}

function stripMarksControlFields(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const {
    expectedRevision: _expectedRevision,
    operationId: _operationId,
    activityOperationId: _activityOperationId,
    idempotencyKey: _idempotencyKey,
    operationKey: _operationKey,
    ...businessPayload
  } = payload
  return businessPayload
}

function requireCommittedMarksResult(response) {
  const outcome = response?.outcome
  const commitStatus = response?.commitStatus
  const revision = response?.revision ?? response?.payload?.revision
  if (outcome !== 'committed' || commitStatus !== 'committed' || !Number.isInteger(revision) || revision < 0) {
    const error = new Error('Host marks/activity mutation was not committed')
    error.code = response?.error?.code || 'marks-owner-mutation-not-committed'
    error.category = response?.error?.category
      || (outcome === 'conflict' || commitStatus === 'conflict' ? 'conflict' : 'recovery')
    error.retryable = response?.error?.retryable !== false
    if (Number.isInteger(response?.revision)) error.currentRevision = response.revision
    throw error
  }
  return response
}

export function createYoutubeWorkflowClient(options = {}) {
  const baseUrl = trimTrailingSlash(options.baseUrl || DEFAULT_BASE_URL)
  const sameOrigin = baseUrl === ''
  const displayBaseUrl = sameOrigin ? runtimeOrigin() : baseUrl
  const rawFetch = options.fetchImpl || fetch
  const accessToken = String(options.accessToken ?? DEFAULT_ACCESS_TOKEN).trim()

  function authorizedFetch(url, init = {}) {
    if (!accessToken) return rawFetch(url, init)
    const headers = { ...(init.headers || {}), 'X-Read-Web-Token': accessToken }
    return rawFetch(url, { ...init, headers })
  }
  const fetchImpl = authorizedFetch
  let workflowOwnerRevisionToken = null
  let workflowOwnerJobsRevision = null

  function observeWorkflowResponse(response) {
    if (response?.revision !== undefined && response?.revision !== null) {
      workflowOwnerRevisionToken = response.revision
      const parsed = workflowJobsRevision(response.revision)
      if (parsed !== null) workflowOwnerJobsRevision = parsed
    }
    const sourceRevision = response?.payload?.sourceRevision
    if (Number.isInteger(sourceRevision) && sourceRevision >= 0) workflowOwnerJobsRevision = sourceRevision
    return response
  }

  async function workflowQuery(cutover, operation, payload = {}, signal) {
    if (cutover.ownerReady === false && !signal?.aborted && typeof cutover.refresh === 'function') {
      await cutover.refresh()
    }
    const response = observeWorkflowResponse(await cutover.query({
      domain: 'workflow',
      operation,
      payload,
      ...(signal ? { signal } : {}),
    }))
    if (response?.outcome !== 'read') throw workflowMutationError(response, 'workflow-owner-query-not-ready')
    return response
  }

  async function workflowExpectedRevision(cutover, options = {}) {
    const requested = options.expectedRevision
    if (typeof requested === 'string' && requested) return requested
    if (Number.isInteger(requested) && requested >= 0
      && workflowOwnerRevisionToken !== null
      && workflowOwnerJobsRevision === requested) {
      return workflowOwnerRevisionToken
    }
    if (Number.isInteger(requested) && requested >= 0
      && workflowOwnerJobsRevision !== null
      && workflowOwnerJobsRevision !== requested) {
      const error = new Error('Host workflow revision conflicts with the requested client revision')
      error.code = 'WORKFLOW_STATE_CONFLICT'
      error.category = 'conflict'
      error.retryable = true
      error.status = 409
      error.actualRevision = workflowOwnerJobsRevision
      error.currentRevision = workflowOwnerJobsRevision
      throw error
    }
    if (workflowOwnerRevisionToken === null) {
      await workflowQuery(cutover, 'job', {}, options.signal)
    }
    if (Number.isInteger(requested) && requested >= 0
      && workflowOwnerJobsRevision !== null
      && workflowOwnerJobsRevision !== requested) {
      const error = new Error('Host workflow revision conflicts with the requested client revision')
      error.code = 'WORKFLOW_STATE_CONFLICT'
      error.category = 'conflict'
      error.retryable = true
      error.status = 409
      error.actualRevision = workflowOwnerJobsRevision
      error.currentRevision = workflowOwnerJobsRevision
      throw error
    }
    if (workflowOwnerRevisionToken === null) {
      throw workflowUnsupportedError('workflow-revision')
    }
    return workflowOwnerRevisionToken
  }

  function workflowResultRevision(response) {
    const parsed = workflowJobsRevision(response?.revision)
    return parsed !== null ? parsed : workflowOwnerJobsRevision ?? 0
  }

  async function workflowCommand(cutover, operation, payload, options = {}) {
    const expectedRevision = await workflowExpectedRevision(cutover, options)
    const response = observeWorkflowResponse(await cutover.command({
      domain: 'workflow',
      operation,
      payload,
      expectedRevision,
      idempotencyKey: String(options.idempotencyKey || options.operationKey || createYoutubeWorkflowOperationKey(`workflow-${operation}`)),
      ...(options.signal ? { signal: options.signal } : {}),
    }))
    return requireWorkflowCommit(response)
  }

  async function workflowJob(cutover, jobId, signal) {
    const response = await workflowQuery(cutover, 'job', { jobId: String(jobId || '') }, signal)
    const job = response?.payload?.job || response?.payload?.records?.[0]
    if (!job) {
      const error = new Error('Workflow job was not found')
      error.code = 'JOB_NOT_FOUND'
      error.status = 404
      error.retryable = false
      throw error
    }
    return job
  }

  function workflowJobRecord(payload, operationKey) {
    const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    const jobId = String(input.jobId || `workflow-${operationKey}`)
    const request = {}
    for (const key of ['url', 'geminiMode', 'model', 'baseUrl', 'videoPriority', 'autoOpenWhenReady', 'replacePolicy', 'forceReprocess']) {
      if (input[key] !== undefined) request[key] = input[key]
    }
    const record = {
      jobId,
      status: 'queued',
      stage: 'queued',
      title: String(input.title || input.url || jobId),
      url: String(input.url || ''),
      sourceType: 'youtube',
      ...(input.videoPriority !== undefined ? { videoPriority: Boolean(input.videoPriority) } : {}),
      request,
    }
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
    return {
      record,
      ...(apiKey ? { ephemeral: { apiKey } } : {}),
    }
  }

  function workflowCommandResult(response, record) {
    const serviceResult = response?.payload?.serviceResult
    const result = serviceResult && typeof serviceResult === 'object' && !Array.isArray(serviceResult)
      ? (serviceResult.job && typeof serviceResult.job === 'object' ? serviceResult.job : serviceResult)
      : (record || {})
    return {
      ...result,
      revision: workflowResultRevision(response),
      ownerRevision: response.revision,
    }
  }

  async function workflowIndex(cutover, signal) {
    const response = await workflowQuery(cutover, 'reader-index', {}, signal)
    return {
      items: Array.isArray(response?.payload?.records) ? response.payload.records : [],
      revision: workflowResultRevision(response),
      ownerRevision: response.revision,
    }
  }

  function apiUrl(path) {
    return sameOrigin ? path : `${baseUrl}${path}`
  }

  function capabilityUrl(path) {
    const url = new URL(apiUrl(path), runtimeOrigin() || 'http://localhost')
    if (accessToken) url.searchParams.set('access_token', accessToken)
    return sameOrigin ? `${url.pathname}${url.search}${url.hash}` : url.href
  }

  async function requestReaderActivity(payload = {}, options = {}) {
    const cutover = activeMarksOwner()
    if (cutover) {
      const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
      const jobId = String(input.jobId || '')
      const contentId = String(input.contentId || jobId)
      const commandPayload = { ...stripMarksControlFields(input), jobId, contentId }
      const expectedRevision = options.expectedRevision !== undefined
        ? options.expectedRevision
        : input.expectedRevision !== undefined
          ? input.expectedRevision
          : await currentMarksRevision(cutover, jobId, contentId, options.signal)
      const response = await cutover.command({
        domain: 'marks-activity',
        operation: 'activity-append',
        payload: commandPayload,
        expectedRevision,
        idempotencyKey: marksOperationKey('activity-append', jobId, contentId, input, options),
        ...(options.signal ? { signal: options.signal } : {}),
      })
      return requireCommittedMarksResult(response)
    }
    return readJsonResponse(await fetchImpl(apiUrl('/api/reader/activity'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.keepalive ? { keepalive: true } : {}),
    }))
  }

  async function requestReaderMarks(jobId, payload = {}, options = {}) {
    const cutover = activeMarksOwner()
    if (cutover) {
      const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
      const normalizedJobId = String(jobId || '')
      const contentId = String(input.contentId || normalizedJobId)
      const commandPayload = {
        jobId: normalizedJobId,
        contentId,
        marks: Array.isArray(input.marks) ? input.marks : [],
      }
      const expectedRevision = options.expectedRevision !== undefined
        ? options.expectedRevision
        : input.expectedRevision !== undefined
          ? input.expectedRevision
          : await currentMarksRevision(cutover, normalizedJobId, contentId, options.signal)
      const response = await cutover.command({
        domain: 'marks-activity',
        operation: 'marks-commit',
        payload: commandPayload,
        expectedRevision,
        idempotencyKey: marksOperationKey('marks-commit', normalizedJobId, contentId, input, options),
        ...(options.signal ? { signal: options.signal } : {}),
      })
      return requireCommittedMarksResult(response)
    }
    return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.keepalive ? { keepalive: true } : {}),
    }))
  }

  return {
    baseUrl: displayBaseUrl,
    async health() {
      return readJsonResponse(await fetchImpl(apiUrl('/api/health')))
    },
    async diagnostics() {
      return readJsonResponse(await fetchImpl(apiUrl('/api/diagnostics')))
    },
    async diagnosticsPackage() {
      const response = await fetchImpl(apiUrl('/api/diagnostics/package'))
      if (!response.ok) throw new Error(`Unable to fetch diagnostics package: ${response.status}`)
      return response.blob()
    },
    async credentialStatus() {
      return readJsonResponse(await fetchImpl(apiUrl('/api/credentials/gemini/status')))
    },
    async saveCredential(payload) {
      return readJsonResponse(await fetchImpl(apiUrl('/api/credentials/gemini'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
      }))
    },
    async deleteCredential() {
      return readJsonResponse(await fetchImpl(apiUrl('/api/credentials/gemini'), {
        method: 'DELETE'
      }))
    },
    async getConfig() {
      const cutover = activeWorkflowOwner()
      if (cutover) {
        const response = await workflowQuery(cutover, 'config')
        return {
          ...(response.payload?.config || {}),
          revision: workflowResultRevision(response),
          ownerRevision: response.revision,
        }
      }
      return readJsonResponse(await fetchImpl(apiUrl('/api/config')))
    },
    async saveConfig(payload, options = {}) {
      const cutover = activeWorkflowOwner()
      if (cutover) {
        const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
        const config = {}
        for (const key of ['model', 'baseUrl', 'proxyUrl', 'cookiesPath', 'outputDir', 'ytDlpPath', 'whisperxPath']) {
          if (input[key] !== undefined) config[key] = String(input[key] || '').trim()
        }
        const response = await workflowCommand(cutover, 'config-commit', { config }, options)
        return {
          ...config,
          revision: workflowResultRevision(response),
          ownerRevision: response.revision,
        }
      }
      return readJsonResponse(await fetchImpl(apiUrl('/api/config'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
      }))
    },
    async maintenance() {
      return readJsonResponse(await fetchImpl(apiUrl('/api/maintenance')))
    },
    async cleanupMaintenance(payload = {}) {
      return readJsonResponse(await fetchImpl(apiUrl('/api/maintenance/cleanup'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
      }))
    },
    async createJob(payload, options = {}) {
      const cutover = activeWorkflowOwner()
      if (cutover) {
        const operationKey = String(options.idempotencyKey || options.operationKey || createYoutubeWorkflowOperationKey('workflow-job-start'))
        const jobPayload = workflowJobRecord(payload, operationKey)
        const response = await workflowCommand(cutover, 'job-start', jobPayload, {
          ...options,
          idempotencyKey: operationKey,
        })
        return workflowCommandResult(response, jobPayload.record)
      }
      return readJsonResponse(await fetchImpl(apiUrl('/api/jobs'), {
        method: 'POST',
        headers: mutationHeaders(options, { json: true, idempotent: true, revision: true }),
        body: JSON.stringify(payload || {}),
        ...(options.signal ? { signal: options.signal } : {}),
      }))
    },
    async getJob(jobId, options = {}) {
      const cutover = activeWorkflowOwner()
      if (cutover) return workflowJob(cutover, jobId, options.signal)
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}`)))
    },
    async deleteJob(jobId, options = {}) {
      const cutover = activeWorkflowOwner()
      if (cutover) {
        const response = await workflowCommand(cutover, 'job-delete', { jobId: String(jobId || '') }, options)
        return workflowCommandResult(response, { jobId: String(jobId || '') })
      }
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}`), {
        method: 'DELETE',
        headers: mutationHeaders(options, { revision: true }),
        ...(options.signal ? { signal: options.signal } : {}),
      }))
    },
    async getJobsSnapshot(jobIds, options = {}) {
      const uniqueIds = [...new Set((Array.isArray(jobIds) ? jobIds : [])
        .map((jobId) => String(jobId || '').trim())
        .filter(Boolean))]
      const cutover = activeWorkflowOwner()
      if (cutover) {
        const response = await workflowQuery(cutover, 'job', {}, options.signal)
        const jobs = Array.isArray(response.payload?.records) ? response.payload.records : []
        const selected = options.includeAll || uniqueIds.length === 0
          ? jobs
          : jobs.filter((job) => uniqueIds.includes(String(job?.jobId || '')))
        return {
          jobs: selected,
          revision: workflowResultRevision(response),
          ownerRevision: response.revision,
        }
      }
      return readJsonResponse(await fetchImpl(apiUrl('/api/jobs/snapshot'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobIds: uniqueIds, ...(options.includeAll ? { includeAll: true } : {}) }),
        ...(options.signal ? { signal: options.signal } : {}),
      }))
    },
    async getReaderIndex(options = {}) {
      const cutover = activeWorkflowOwner()
      if (!cutover) throw workflowUnsupportedError('reader-index-query')
      return workflowIndex(cutover, options.signal)
    },
    async saveReaderIndex(items, options = {}) {
      const cutover = activeWorkflowOwner()
      if (!cutover) throw workflowUnsupportedError('reader-index-command')
      const response = await workflowCommand(cutover, 'reader-index-commit', {
        readerIndex: { items: Array.isArray(items) ? items : [] },
      }, options)
      return {
        items: Array.isArray(items) ? items : [],
        revision: workflowResultRevision(response),
        ownerRevision: response.revision,
      }
    },
    async cancelJob(jobId, options = {}) {
      const cutover = activeWorkflowOwner()
      if (cutover) {
        await workflowJob(cutover, jobId, options.signal)
        const record = { jobId: String(jobId || ''), status: 'canceled', stage: 'canceled' }
        const response = await workflowCommand(cutover, 'job-cancel', { record }, options)
        return workflowCommandResult(response, record)
      }
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/cancel`), {
        method: 'POST',
        headers: mutationHeaders(options, { idempotent: true, revision: true }),
        ...(options.signal ? { signal: options.signal } : {}),
      }))
    },
    async prioritizeJob(jobId, options = {}) {
      const cutover = activeWorkflowOwner()
      if (cutover) {
        const response = await workflowCommand(cutover, 'job-prioritize', { jobId: String(jobId || '') }, options)
        return workflowCommandResult(response, { jobId: String(jobId || '') })
      }
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/prioritize`), {
        method: 'POST',
        headers: mutationHeaders(options, { idempotent: true, revision: true }),
        ...(options.signal ? { signal: options.signal } : {}),
      }))
    },
    async redoJob(jobId) {
      if (activeWorkflowOwner()) throw workflowUnsupportedError('job-redo')
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/redo`), {
        method: 'POST'
      }))
    },
    async retryJob(jobId, payload = {}, options = {}) {
      const cutover = activeWorkflowOwner()
      if (cutover) {
        const current = await workflowJob(cutover, jobId, options.signal)
        const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
        const request = { ...(current.request && typeof current.request === 'object' ? current.request : {}) }
        delete request.apiKey
        delete request.api_key
        for (const key of ['model', 'baseUrl', 'videoPriority']) {
          if (input[key] !== undefined) request[key] = input[key]
        }
        const retryStage = String(input.stage || current.stage || 'queued')
        const record = {
          jobId: String(current.jobId || jobId || ''),
          status: 'queued',
          stage: 'queued',
          retryOf: String(current.jobId || jobId || ''),
          retryStage,
          request,
        }
        const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
        const response = await workflowCommand(cutover, 'job-retry', {
          record,
          ...(apiKey ? { ephemeral: { apiKey } } : {}),
        }, options)
        return workflowCommandResult(response, record)
      }
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/retry`), {
        method: 'POST',
        headers: mutationHeaders(options, { json: true, idempotent: true, revision: true }),
        body: JSON.stringify(payload || {}),
        ...(options.signal ? { signal: options.signal } : {}),
      }))
    },
    async clearCanceledJobs() {
      if (activeWorkflowOwner()) throw workflowUnsupportedError('job-clear-canceled')
      return readJsonResponse(await fetchImpl(apiUrl('/api/jobs/clear-canceled'), {
        method: 'POST'
      }))
    },
    async clearFailedJobs(options = {}) {
      const cutover = activeWorkflowOwner()
      if (cutover) {
        const response = await workflowCommand(cutover, 'job-clear-failed', {}, options)
        return workflowCommandResult(response, {})
      }
      return readJsonResponse(await fetchImpl(apiUrl('/api/jobs/clear-failed'), {
        method: 'POST',
        headers: mutationHeaders(options, { revision: true }),
        ...(options.signal ? { signal: options.signal } : {}),
      }))
    },
    async pickImportFolder(payload = {}, options = {}) {
      return readJsonResponse(await fetchImpl(apiUrl('/api/import/pick-folder'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: options.signal
      }))
    },
    async pickVideoFile(payload = {}, options = {}) {
      return readJsonResponse(await fetchImpl(apiUrl('/api/media/pick-video'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: options.signal
      }))
    },
    async scanImportRoot(payload = {}) {
      return readJsonResponse(await fetchImpl(apiUrl('/api/import/scan'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
      }))
    },
    async createImportJobs(payload = {}) {
      return readJsonResponse(await fetchImpl(apiUrl('/api/import/jobs'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
      }))
    },
    async getSession(jobId, options = {}) {
      return readJsonResponse(await fetchImpl(
        apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/session`),
        options.signal ? { signal: options.signal } : undefined,
      ))
    },
    async getFile(jobId, kind, options = {}) {
      const response = await fetchImpl(
        apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/file/${encodeURIComponent(kind)}`),
        options.signal ? { signal: options.signal } : undefined,
      )
      if (!response.ok) throw new Error(`Unable to fetch ${kind}: ${response.status}`)
      return response.blob()
    },
    fileUrl(jobId, kind) {
      return capabilityUrl(`/api/jobs/${encodeURIComponent(jobId)}/file/${encodeURIComponent(kind)}`)
    },
    mediaUrl(jobId, kind) {
      return capabilityUrl(`/api/jobs/${encodeURIComponent(jobId)}/media/${encodeURIComponent(kind)}`)
    },
    async probeMediaRange(jobId, kind, options = {}) {
      const response = await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/media/${encodeURIComponent(kind)}`), {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
        ...(options.signal ? { signal: options.signal } : {}),
      })
      if (response.status === 404 || response.status === 410) {
        const error = new Error('Reader media is no longer available')
        error.code = 'MEDIA_RANGE_UNAVAILABLE'
        throw error
      }
      const contentRange = response.headers.get('content-range') || ''
      const acceptRanges = response.headers.get('accept-ranges') || ''
      if (response.status !== 206 || !/^bytes 0-0\/\d+$/i.test(contentRange) || !/\bbytes\b/i.test(acceptRanges)) {
        const error = new Error('Reader media does not support HTTP Range')
        error.code = 'MEDIA_RANGE_UNSUPPORTED'
        error.details = {
          status: response.status,
          contentRange,
          acceptRanges,
        }
        throw error
      }
      return {
        status: response.status,
        contentRange,
        acceptRanges,
        etag: response.headers.get('etag') || '',
      }
    },
    async bindVideoSource(jobId, payload = {}) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/video-source`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
      }))
    },
    async recent(limit = 10) {
      const cutover = activeWorkflowOwner()
      if (cutover) {
        const response = await workflowQuery(cutover, 'history', { limit: Math.min(200, Math.max(1, Number(limit) || 10)) })
        return Array.isArray(response.payload?.records) ? response.payload.records : []
      }
      return readJsonResponse(await fetchImpl(apiUrl(`/api/recent?limit=${encodeURIComponent(limit)}`)))
    },
    async history(options = {}) {
      const cutover = activeWorkflowOwner()
      if (cutover) {
        const response = await workflowQuery(cutover, 'history', {
          ...(options.query ? { query: String(options.query) } : {}),
          ...(options.status ? { status: String(options.status) } : {}),
          limit: Math.min(200, Math.max(1, Number(options.limit) || 50)),
        }, options.signal)
        return Array.isArray(response.payload?.records) ? response.payload.records : []
      }
      const params = new URLSearchParams()
      if (options.query) params.set('query', options.query)
      if (options.status) params.set('status', options.status)
      params.set('limit', options.limit || 50)
      return readJsonResponse(await fetchImpl(apiUrl(`/api/history?${params.toString()}`)))
    },
    async getHistory(jobId, options = {}) {
      const cutover = activeWorkflowOwner()
      if (cutover) {
        const response = await workflowQuery(cutover, 'history', { jobId: String(jobId || '') }, options.signal)
        const item = response?.payload?.records?.[0]
        if (!item) {
          const error = new Error('Workflow history item was not found')
          error.code = 'HISTORY_NOT_FOUND'
          error.status = 404
          error.retryable = false
          throw error
        }
        return item
      }
      return readJsonResponse(await fetchImpl(apiUrl(`/api/history/${encodeURIComponent(jobId)}`)))
    },
    async deleteHistory(jobId, options = {}) {
      if (activeWorkflowOwner()) throw workflowUnsupportedError('history-delete')
      const params = new URLSearchParams()
      if (options.deleteFiles) params.set('deleteFiles', 'true')
      const suffix = params.toString() ? `?${params.toString()}` : ''
      return readJsonResponse(await fetchImpl(apiUrl(`/api/history/${encodeURIComponent(jobId)}${suffix}`), {
        method: 'DELETE'
      }))
    },
    async readerRecent(options = {}) {
      const cutover = activeWorkflowOwner()
      if (cutover) {
        const response = await workflowQuery(cutover, 'history', {
          ...(options.query ? { query: String(options.query) } : {}),
          limit: 200,
        }, options.signal)
        const offset = Number.isInteger(options.offset) && options.offset > 0 ? options.offset : 0
        const limit = Math.min(200, Math.max(1, Number(options.limit) || 50))
        return (Array.isArray(response.payload?.records) ? response.payload.records : []).slice(offset, offset + limit)
      }
      const params = new URLSearchParams()
      if (options.query) params.set('query', options.query)
      if (options.timeScope) params.set('timeScope', options.timeScope)
      if (Number.isInteger(options.offset) && options.offset > 0) params.set('offset', String(options.offset))
      params.set('limit', options.limit || 50)
      return readJsonResponse(await fetchImpl(apiUrl(`/api/reader/recent?${params.toString()}`)))
    },
    async recordReaderActivity(payload = {}, options = {}) {
      return requestReaderActivity(payload, options)
    },
    async keepaliveReaderActivity(payload = {}) {
      return requestReaderActivity(payload, { keepalive: true })
    },
    async getReaderActivity(jobId, options = {}) {
      const params = options.recover ? '?recover=true' : ''
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/reader-activity${params}`), {
        signal: options.signal,
      }))
    },
    async getReaderMarks(jobId, options = {}) {
      const params = options.recover ? '?recover=true' : ''
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks${params}`), {
        signal: options.signal,
      }))
    },
    async saveReaderMarks(jobId, payload = {}, options = {}) {
      return requestReaderMarks(jobId, payload, options)
    },
    async keepaliveReaderMarks(jobId, payload = {}) {
      return requestReaderMarks(jobId, payload, { keepalive: true })
    },
    async startAnnotationBackfill(jobId, payload = {}, options = {}) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/annotation-backfill`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
        ...(options.signal ? { signal: options.signal } : {})
      }))
    },
    async getAnnotationBackfillOperation(jobId, operationId, options = {}) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/annotation-backfill/operations/${encodeURIComponent(operationId)}`), options.signal ? { signal: options.signal } : undefined))
    },
    async cancelAnnotationBackfillOperation(jobId, operationId) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/annotation-backfill/operations/${encodeURIComponent(operationId)}/cancel`), { method: 'POST' }))
    },
    async runAnnotationBackfill(jobId, payload = {}, options = {}) {
      const signal = options.signal
      const operation = await this.startAnnotationBackfill(jobId, payload, { signal })
      while (operation.status === 'queued' || operation.status === 'running' || operation.status === 'retrying') {
        await abortableDelay(250, signal)
        Object.assign(operation, await this.getAnnotationBackfillOperation(jobId, operation.operationId, { signal }))
      }
      if (operation.status === 'ready') return operation.response || { result: operation.result }
      const error = new Error(operation.error?.message || `Annotation backfill ${operation.status}`)
      error.code = operation.error?.category || operation.status
      throw error
    },
    async getAnnotationBackfillResult(jobId) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/annotation-backfill/latest`)))
    },
    async getAnnotationBackfillRunResult(jobId, runId) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/annotation-backfill/runs/${encodeURIComponent(runId)}`)))
    },
    async quality(jobId) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/quality`)))
    },
    eventsUrl(jobId) {
      return capabilityUrl(`/api/jobs/${encodeURIComponent(jobId)}/events`)
    }
  }
}

function abortableDelay(milliseconds, signal) {
  if (!signal) return new Promise(resolve => setTimeout(resolve, milliseconds))
  if (signal.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason || new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export const youtubeWorkflowClient = createYoutubeWorkflowClient()
