const DEFAULT_BASE_URL = 'http://127.0.0.1:8765'

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

async function readJsonResponse(response) {
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body && body.detail ? String(body.detail) : ''
    } catch (_err) {}
    throw new Error(detail || `YouTube workflow service returned ${response.status}`)
  }
  return response.json()
}

export function createYoutubeWorkflowClient(options = {}) {
  const baseUrl = trimTrailingSlash(options.baseUrl || DEFAULT_BASE_URL)
  const fetchImpl = options.fetchImpl || fetch

  function apiUrl(path) {
    return `${baseUrl}${path}`
  }

  return {
    baseUrl,
    async health() {
      return readJsonResponse(await fetchImpl(apiUrl('/api/health')))
    },
    async diagnostics() {
      return readJsonResponse(await fetchImpl(apiUrl('/api/diagnostics')))
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
    async clearCanceledJobs() {
      return readJsonResponse(await fetchImpl(apiUrl('/api/jobs/clear-canceled'), {
        method: 'POST'
      }))
    },
    async getSession(jobId) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/session`)))
    },
    async getFile(jobId, kind) {
      const response = await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/file/${encodeURIComponent(kind)}`))
      if (!response.ok) throw new Error(`Unable to fetch ${kind}: ${response.status}`)
      return response.blob()
    },
    async recent(limit = 10) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/recent?limit=${encodeURIComponent(limit)}`)))
    },
    eventsUrl(jobId) {
      return apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/events`)
    }
  }
}

export const youtubeWorkflowClient = createYoutubeWorkflowClient()
