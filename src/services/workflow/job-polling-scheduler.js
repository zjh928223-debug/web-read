export function createJobPollingScheduler(options = {}) {
  const fetchJobs = options.fetchJobs
  const setTimeoutResource = options.setTimeout ?? globalThis.setTimeout?.bind(globalThis)
  const clearTimeoutResource = options.clearTimeout ?? globalThis.clearTimeout?.bind(globalThis)
  const intervalMs = options.intervalMs ?? 1000
  const hiddenIntervalMs = options.hiddenIntervalMs ?? Math.max(intervalMs * 5, intervalMs)
  const isHidden = options.isHidden ?? (() => globalThis.document?.visibilityState === 'hidden')
  const onJobs = options.onJobs ?? (() => {})
  const onError = options.onError ?? (() => {})
  if (typeof fetchJobs !== 'function') throw new TypeError('fetchJobs must be a function')
  if (typeof setTimeoutResource !== 'function' || typeof clearTimeoutResource !== 'function') {
    throw new TypeError('setTimeout and clearTimeout are required')
  }

  let jobIds = []
  let timerId = null
  let active = false
  let disposed = false
  let inFlight = false
  let controller = null
  const acceptedVersions = new Map()

  function disposedError() {
    const error = new Error('JobPollingScheduler is disposed')
    error.name = 'JobPollingSchedulerError'
    error.code = 'JOB_POLLING_DISPOSED'
    return error
  }

  function versionFor(job) {
    if (Number.isFinite(job?.revision)) return { kind: 'revision', value: job.revision }
    const updatedAt = Date.parse(job?.updatedAt ?? '')
    if (Number.isFinite(updatedAt)) return { kind: 'updatedAt', value: updatedAt }
    return null
  }

  function acceptFreshJobs(jobs) {
    if (!Array.isArray(jobs)) throw new TypeError('fetchJobs must return an array')
    const fresh = []
    for (const job of jobs) {
      const jobId = typeof job?.jobId === 'string' ? job.jobId : job?.id
      if (!job || typeof jobId !== 'string' || !jobIds.includes(jobId)) continue
      const next = versionFor(job)
      const previous = acceptedVersions.get(jobId)
      if (previous && (!next || previous.kind !== next.kind || next.value <= previous.value)) continue
      if (next) acceptedVersions.set(jobId, next)
      fresh.push(job)
    }
    if (fresh.length > 0) onJobs(fresh)
  }

  function schedule() {
    if (!active || disposed || inFlight || timerId !== null) return
    timerId = setTimeoutResource(run, isHidden() ? hiddenIntervalMs : intervalMs)
  }

  async function run() {
    timerId = null
    if (!active || disposed) return
    inFlight = true
    controller = new AbortController()
    try {
      const jobs = await fetchJobs([...jobIds], controller.signal)
      if (active && !disposed && !controller.signal.aborted) acceptFreshJobs(jobs)
    } catch (error) {
      if (active && !disposed && !controller.signal.aborted) onError(error)
    } finally {
      controller = null
      inFlight = false
      schedule()
    }
  }

  function start(ids) {
    if (disposed) throw disposedError()
    if (!Array.isArray(ids)) throw new TypeError('job ids must be an array')
    jobIds = [...new Set(ids)]
    active = true
    schedule()
  }

  function stop() {
    active = false
    controller?.abort()
    if (timerId !== null) clearTimeoutResource(timerId)
    timerId = null
  }

  function dispose() {
    if (disposed) return
    stop()
    disposed = true
  }

  return Object.freeze({ dispose, start, stop })
}
