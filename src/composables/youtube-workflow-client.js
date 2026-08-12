import { recordBestEffortFailure } from '../services/runtime/best-effort.js'

const DEFAULT_BASE_URL = import.meta.env?.VITE_LOCAL_SERVICE_BASE_URL
  || 'http://127.0.0.1:8765'
const DEFAULT_ACCESS_TOKEN = import.meta.env?.VITE_READ_WEB_SERVICE_TOKEN || ''

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

async function readJsonResponse(response) {
  if (!response.ok) {
    let detail = ''
    let code = ''
    try {
      const body = await response.json()
      if (body?.detail && typeof body.detail === 'object') {
        detail = String(body.detail.message || '')
        code = String(body.detail.code || '')
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
    error.status = response.status
    throw error
  }
  return response.json()
}

export function createYoutubeWorkflowClient(options = {}) {
  const baseUrl = trimTrailingSlash(options.baseUrl || DEFAULT_BASE_URL)
  const rawFetch = options.fetchImpl || fetch
  const accessToken = String(options.accessToken ?? DEFAULT_ACCESS_TOKEN).trim()

  function authorizedFetch(url, init = {}) {
    if (!accessToken) return rawFetch(url, init)
    const headers = { ...(init.headers || {}), 'X-Read-Web-Token': accessToken }
    return rawFetch(url, { ...init, headers })
  }
  const fetchImpl = authorizedFetch

  function apiUrl(path) {
    return `${baseUrl}${path}`
  }

  function capabilityUrl(path) {
    const url = new URL(apiUrl(path))
    if (accessToken) url.searchParams.set('access_token', accessToken)
    return url.href
  }

  return {
    baseUrl,
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
      return readJsonResponse(await fetchImpl(apiUrl('/api/config')))
    },
    async saveConfig(payload) {
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
    async createJob(payload) {
      return readJsonResponse(await fetchImpl(apiUrl('/api/jobs'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
      }))
    },
    async getJob(jobId) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}`)))
    },
    async getJobsSnapshot(jobIds, options = {}) {
      const uniqueIds = [...new Set((Array.isArray(jobIds) ? jobIds : [])
        .map((jobId) => String(jobId || '').trim())
        .filter(Boolean))]
      return readJsonResponse(await fetchImpl(apiUrl('/api/jobs/snapshot'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobIds: uniqueIds }),
        ...(options.signal ? { signal: options.signal } : {}),
      }))
    },
    async cancelJob(jobId) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/cancel`), {
        method: 'POST'
      }))
    },
    async prioritizeJob(jobId) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/prioritize`), {
        method: 'POST'
      }))
    },
    async redoJob(jobId) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/redo`), {
        method: 'POST'
      }))
    },
    async retryJob(jobId, payload = {}) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/retry`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
      }))
    },
    async clearCanceledJobs() {
      return readJsonResponse(await fetchImpl(apiUrl('/api/jobs/clear-canceled'), {
        method: 'POST'
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
    async bindVideoSource(jobId, payload = {}) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/video-source`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
      }))
    },
    async recent(limit = 10) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/recent?limit=${encodeURIComponent(limit)}`)))
    },
    async history(options = {}) {
      const params = new URLSearchParams()
      if (options.query) params.set('query', options.query)
      if (options.status) params.set('status', options.status)
      params.set('limit', options.limit || 50)
      return readJsonResponse(await fetchImpl(apiUrl(`/api/history?${params.toString()}`)))
    },
    async getHistory(jobId) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/history/${encodeURIComponent(jobId)}`)))
    },
    async deleteHistory(jobId, options = {}) {
      const params = new URLSearchParams()
      if (options.deleteFiles) params.set('deleteFiles', 'true')
      const suffix = params.toString() ? `?${params.toString()}` : ''
      return readJsonResponse(await fetchImpl(apiUrl(`/api/history/${encodeURIComponent(jobId)}${suffix}`), {
        method: 'DELETE'
      }))
    },
    async readerRecent(options = {}) {
      const params = new URLSearchParams()
      if (options.query) params.set('query', options.query)
      params.set('limit', options.limit || 50)
      return readJsonResponse(await fetchImpl(apiUrl(`/api/reader/recent?${params.toString()}`)))
    },
    async recordReaderActivity(payload = {}) {
      return readJsonResponse(await fetchImpl(apiUrl('/api/reader/activity'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
      }))
    },
    async getReaderMarks(jobId) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks`)))
    },
    async saveReaderMarks(jobId, payload = {}) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
      }))
    },
    async runAnnotationBackfill(jobId, payload = {}) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/annotation-backfill`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
      }))
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

export const youtubeWorkflowClient = createYoutubeWorkflowClient()
