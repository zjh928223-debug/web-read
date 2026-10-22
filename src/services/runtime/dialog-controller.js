const controllersByDocument = new WeakMap()

function documentStack(documentObject) {
  let stack = controllersByDocument.get(documentObject)
  if (!stack) {
    stack = []
    controllersByDocument.set(documentObject, stack)
  }
  return stack
}

function focusableElements(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return []
  return [...root.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.disabled && element.getAttribute?.('aria-hidden') !== 'true')
}

function focus(element) {
  if (!element || element.isConnected === false || typeof element.focus !== 'function') return
  try { element.focus({ preventScroll: true }) } catch { element.focus() }
}

export function createDialogController(options = {}) {
  const documentObject = options.documentObject || globalThis.document
  let root = null
  let restoreTarget = null
  let settings = null
  let disposed = false

  function isTopmost() {
    const stack = documentStack(documentObject)
    return stack[stack.length - 1] === api
  }

  function handleKeydown(event) {
    if (!root || !isTopmost()) return
    if (event.key === 'Escape') {
      if (settings.isPending?.()) return
      event.preventDefault()
      event.stopPropagation?.()
      settings.onRequestClose?.()
      return
    }
    if (event.key !== 'Tab') return
    const focusables = focusableElements(root)
    if (!focusables.length) {
      event.preventDefault()
      focus(root)
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (event.shiftKey && documentObject.activeElement === first) {
      event.preventDefault()
      focus(last)
    } else if (!event.shiftKey && documentObject.activeElement === last) {
      event.preventDefault()
      focus(first)
    } else if (!root.contains(documentObject.activeElement)) {
      event.preventDefault()
      focus(event.shiftKey ? last : first)
    }
  }

  function open(dialogRoot, nextSettings = {}) {
    if (disposed) throw new Error('DialogController is disposed')
    if (!dialogRoot) throw new TypeError('dialog root is required')
    if (root) close({ restoreFocus: false })
    root = dialogRoot
    settings = nextSettings
    restoreTarget = nextSettings.restoreFocusTarget || documentObject.activeElement
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-modal', 'true')
    if (nextSettings.label) root.setAttribute('aria-label', nextSettings.label)
    if (nextSettings.labelledBy) root.setAttribute('aria-labelledby', nextSettings.labelledBy)
    if (!root.getAttribute?.('tabindex')) root.setAttribute('tabindex', '-1')
    if (nextSettings.statusElement) {
      nextSettings.statusElement.setAttribute('role', 'status')
      nextSettings.statusElement.setAttribute('aria-live', nextSettings.liveMode || 'polite')
      nextSettings.statusElement.setAttribute('aria-atomic', 'true')
    }
    documentStack(documentObject).push(api)
    documentObject.addEventListener('keydown', handleKeydown, true)
    const target = nextSettings.initialFocus || focusableElements(root)[0] || root
    queueMicrotask(() => { if (root) focus(target) })
  }

  function setBusy(busy) {
    if (!root) return
    if (busy) root.setAttribute('aria-busy', 'true')
    else root.removeAttribute('aria-busy')
  }

  function close(closeOptions = {}) {
    if (!root) return
    const target = restoreTarget
    const stack = documentStack(documentObject)
    const index = stack.lastIndexOf(api)
    if (index >= 0) stack.splice(index, 1)
    documentObject.removeEventListener('keydown', handleKeydown, true)
    root.removeAttribute('aria-busy')
    root = null
    settings = null
    restoreTarget = null
    if (closeOptions.restoreFocus !== false) queueMicrotask(() => focus(target))
  }

  function dispose() {
    if (disposed) return
    close()
    disposed = true
  }

  const api = Object.freeze({ open, close, setBusy, dispose, isTopmost })
  return api
}

export function createPendingActionGuard(options = {}) {
  let pending = false
  let disposed = false

  async function run(action) {
    if (pending || disposed) return { status: 'ignored' }
    pending = true
    options.onChange?.(true)
    try {
      return { status: 'completed', value: await action() }
    } finally {
      pending = false
      if (!disposed) options.onChange?.(false)
    }
  }

  function dispose() {
    disposed = true
    pending = false
  }

  return Object.freeze({ run, isPending: () => pending, dispose })
}
