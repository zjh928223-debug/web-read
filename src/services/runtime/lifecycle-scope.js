function scopeDisposedError() {
  const error = new Error('LifecycleScope is already disposed')
  error.name = 'LifecycleScopeError'
  error.code = 'LIFECYCLE_SCOPE_DISPOSED'
  return error
}

export function createLifecycleScope(options = {}) {
  const disposers = []
  let disposed = false
  const clearTimeoutResource = options.clearTimeout ?? globalThis.clearTimeout?.bind(globalThis)
  const clearIntervalResource = options.clearInterval ?? globalThis.clearInterval?.bind(globalThis)
  const cancelAnimationFrameResource = options.cancelAnimationFrame
    ?? globalThis.cancelAnimationFrame?.bind(globalThis)
  const revokeObjectURL = options.revokeObjectURL
    ?? globalThis.URL?.revokeObjectURL?.bind(globalThis.URL)

  function ensureActive() {
    if (disposed) throw scopeDisposedError()
  }

  function add(disposer) {
    ensureActive()
    if (typeof disposer !== 'function') {
      throw new TypeError('LifecycleScope disposer must be a function')
    }
    let active = true
    const once = () => {
      if (!active) return
      active = false
      disposer()
    }
    disposers.push(once)
    return once
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try { disposers[index]() } catch { /* Remaining resources still require cleanup. */ }
    }
    disposers.length = 0
  }

  function listen(target, type, listener, listenerOptions = {}) {
    ensureActive()
    if (!target || typeof target.addEventListener !== 'function') {
      throw new TypeError('LifecycleScope.listen requires an EventTarget')
    }
    const capture = typeof listenerOptions === 'boolean'
      ? listenerOptions
      : Boolean(listenerOptions.capture)
    if (typeof target.removeEventListener === 'function') {
      target.addEventListener(type, listener, listenerOptions)
      add(() => target.removeEventListener(type, listener, capture))
      return null
    }
    if (typeof AbortController === 'function') {
      const controller = new AbortController()
      const optionsWithSignal = typeof listenerOptions === 'boolean'
        ? { capture: listenerOptions, signal: controller.signal }
        : { ...listenerOptions, signal: controller.signal }
      try {
        target.addEventListener(type, listener, optionsWithSignal)
        add(() => controller.abort())
        return controller
      } catch (error) {
        controller.abort()
        throw error
      }
    }
    throw new TypeError('LifecycleScope.listen requires AbortController or removeEventListener')
  }

  function timeout(id) {
    if (typeof clearTimeoutResource !== 'function') {
      throw new TypeError('LifecycleScope requires clearTimeout')
    }
    add(() => clearTimeoutResource(id))
    return id
  }

  function interval(id) {
    if (typeof clearIntervalResource !== 'function') {
      throw new TypeError('LifecycleScope requires clearInterval')
    }
    add(() => clearIntervalResource(id))
    return id
  }

  function animationFrame(id) {
    if (typeof cancelAnimationFrameResource !== 'function') {
      throw new TypeError('LifecycleScope requires cancelAnimationFrame')
    }
    add(() => cancelAnimationFrameResource(id))
    return id
  }

  function observe(observer) {
    if (!observer || typeof observer.disconnect !== 'function') {
      throw new TypeError('LifecycleScope.observe requires a disconnectable observer')
    }
    add(() => observer.disconnect())
    return observer
  }

  function objectURL(url) {
    if (typeof url !== 'string' || !url.startsWith('blob:')) {
      throw new TypeError('LifecycleScope.objectURL requires a blob URL')
    }
    if (typeof revokeObjectURL !== 'function') {
      throw new TypeError('LifecycleScope requires URL.revokeObjectURL')
    }
    add(() => revokeObjectURL(url))
    return url
  }

  return Object.freeze({
    add,
    animationFrame,
    dispose,
    interval,
    listen,
    objectURL,
    observe,
    timeout,
  })
}
