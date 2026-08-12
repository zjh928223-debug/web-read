import { createTypedError, isTypedError } from '../runtime/typed-error.js'

export function createNativePickerController(options = {}) {
  const client = options.client
  if (!client || typeof client.pickImportFolder !== 'function' || typeof client.pickVideoFile !== 'function') {
    throw new TypeError('native picker controller requires folder and video client methods')
  }
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 45_000)
  const notify = typeof options.onState === 'function' ? options.onState : () => {}
  const captureFocus = typeof options.captureFocus === 'function'
    ? options.captureFocus
    : () => globalThis.document?.activeElement || null
  const refocus = typeof options.refocus === 'function'
    ? options.refocus
    : (target) => {
        if (target && typeof target.focus === 'function') target.focus()
        else globalThis.window?.focus?.()
      }
  let active = null
  let lastRequest = null
  let state = Object.freeze({ status: 'idle', kind: null, retryable: false, error: null })

  function publish(next) {
    state = Object.freeze({ ...state, ...next })
    notify(state)
    return state
  }

  async function pick(kind, payload = {}) {
    if (!['folder', 'video'].includes(kind)) throw new TypeError(`unsupported picker kind: ${kind}`)
    if (active) {
      const error = typedPickerError('NATIVE_PICKER_BUSY', 'conflict', 'Another picker is already open', true, kind)
      throw error
    }
    lastRequest = { kind, payload: { ...payload } }
    const focusTarget = captureFocus()
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    active = controller
    publish({ status: 'busy', kind, retryable: false, error: null })
    try {
      const method = kind === 'folder' ? client.pickImportFolder : client.pickVideoFile
      const result = await method.call(client, payload, { signal: controller.signal })
      if (!result?.selected || result.status === 'canceled') {
        publish({ status: 'canceled', kind, retryable: true, error: null })
        return { selected: false, path: '', status: 'canceled' }
      }
      publish({ status: 'selected', kind, retryable: false, error: null })
      return result
    } catch (error) {
      const typed = normalizePickerError(error, { kind, timedOut, aborted: controller.signal.aborted })
      publish({ status: typed.category === 'canceled' ? 'canceled' : 'error', kind, retryable: typed.retryable, error: typed })
      throw typed
    } finally {
      clearTimeout(timer)
      if (active === controller) active = null
      refocus(focusTarget)
    }
  }

  function cancel() {
    if (!active) return false
    active.abort()
    return true
  }

  function retry() {
    if (!lastRequest || state.retryable !== true) return Promise.resolve(null)
    return pick(lastRequest.kind, lastRequest.payload)
  }

  return { pick, cancel, retry, getState: () => state }
}

function normalizePickerError(error, context) {
  if (isTypedError(error)) return error
  const code = String(error?.code || '').toUpperCase()
  if (context.timedOut || code === 'NATIVE-PICKER-TIMEOUT' || code === 'NATIVE_PICKER_TIMEOUT') {
    return typedPickerError('NATIVE_PICKER_TIMEOUT', 'timeout', 'Native picker timed out', true, context.kind)
  }
  if (context.aborted || error?.name === 'AbortError') {
    return typedPickerError('NATIVE_PICKER_CANCELED', 'canceled', 'Native picker was canceled', true, context.kind)
  }
  if (code === 'NATIVE-PICKER-BUSY' || code === 'NATIVE_PICKER_BUSY') {
    return typedPickerError('NATIVE_PICKER_BUSY', 'conflict', 'Another picker is already open', true, context.kind)
  }
  return typedPickerError('NATIVE_PICKER_ERROR', 'external-tool', 'Native picker failed', true, context.kind)
}

function typedPickerError(code, category, message, retryable, kind) {
  return createTypedError({ code, category, message, retryable, operationId: `native-picker-${kind}`, details: { kind } })
}
