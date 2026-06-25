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
    async pickImportFolder(payload = {}) {
      return readJsonResponse(await fetchImpl(apiUrl('/api/import/pick-folder'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {})
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
    async quality(jobId) {
      return readJsonResponse(await fetchImpl(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/quality`)))
    },
    eventsUrl(jobId) {
      return apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/events`)
    }
  }
}

export const youtubeWorkflowClient = createYoutubeWorkflowClient()
