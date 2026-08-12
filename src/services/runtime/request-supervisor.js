const DEFAULT_TIMEOUT_MS = 30_000

let correlationSequence = 0

function createCorrelationId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  correlationSequence += 1
  return `request-${Date.now().toString(36)}-${correlationSequence.toString(36)}`
}

function errorDetails(code, error, fallbackMessage) {
  return {
    code,
    name: error && error.name ? String(error.name) : 'RequestSupervisorError',
    message: error && error.message ? String(error.message) : fallbackMessage,
  }
}

function failure(record, status, code, error, message) {
  return {
    ok: false,
    status,
    operation: record.operation,
    generation: record.generation,
    correlationId: record.correlationId,
    error: errorDetails(code, error, message),
  }
}

function success(record, value) {
  return {
    ok: true,
    status: 'success',
    operation: record.operation,
    generation: record.generation,
    correlationId: record.correlationId,
    value,
  }
}

/**
 * Supervises independent request lanes keyed by operation name.
 * Each lane is single-flight: starting a new generation supersedes the old one.
 */
export function createRequestSupervisor(options = {}) {
  const active = new Map()
  const generations = new Map()
  const defaultTimeoutMs = options.defaultTimeoutMs === undefined
    ? DEFAULT_TIMEOUT_MS
    : Number(options.defaultTimeoutMs)
  const correlationIdFactory = options.correlationIdFactory || createCorrelationId

  function interrupt(record, status, code, message) {
    if (!record || record.settled) return false
    record.settled = true
    record.controller.abort({ code, message })
    record.resolveInterruption(failure(record, status, code, null, message))
    return true
  }

  function cancel(operation) {
    const key = String(operation || '')
    return interrupt(active.get(key), 'aborted', 'REQUEST_ABORTED', `Request "${key}" was aborted`)
  }

  async function run(operation, task, runOptions = {}) {
    const key = String(operation || '').trim()
    if (!key) throw new TypeError('request operation is required')
    if (typeof task !== 'function') throw new TypeError('request task must be a function')

    const previous = active.get(key)
    interrupt(previous, 'superseded', 'REQUEST_SUPERSEDED', `Request "${key}" was superseded by a newer generation`)

    const generation = (generations.get(key) || 0) + 1
    generations.set(key, generation)
    const controller = new AbortController()
    const correlationId = String(runOptions.correlationId || correlationIdFactory())
    let resolveInterruption
    const interruption = new Promise((resolve) => { resolveInterruption = resolve })
    const record = {
      operation: key,
      generation,
      correlationId,
      controller,
      resolveInterruption,
      settled: false,
      timer: null,
    }
    active.set(key, record)

    const configuredTimeout = runOptions.timeoutMs === undefined ? defaultTimeoutMs : Number(runOptions.timeoutMs)
    if (Number.isFinite(configuredTimeout) && configuredTimeout >= 0) {
      record.timer = setTimeout(() => {
        interrupt(record, 'timeout', 'REQUEST_TIMEOUT', `Request "${key}" timed out after ${configuredTimeout}ms`)
      }, configuredTimeout)
    }

    const taskResult = Promise.resolve()
      .then(() => task({ signal: controller.signal, operation: key, generation, correlationId }))
      .then(
        (value) => success(record, value),
        (error) => {
          if (controller.signal.aborted) {
            return failure(record, 'aborted', 'REQUEST_ABORTED', error, `Request "${key}" was aborted`)
          }
          return failure(record, 'error', 'REQUEST_FAILED', error, `Request "${key}" failed`)
        },
      )

    const result = await Promise.race([taskResult, interruption])
    record.settled = true
    if (record.timer !== null) clearTimeout(record.timer)
    if (active.get(key) === record) active.delete(key)
    return result
  }

  function activeOperations() {
    return Array.from(active.keys())
  }

  return { run, cancel, activeOperations }
}
