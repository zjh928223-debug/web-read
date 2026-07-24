export function createReaderFocusRestorer(deps = {}) {
  return function restoreReaderFocus() {
    var doc = getDocument(deps)
    if (!doc) return
    var focusTarget = callGetter(deps.getFocusTarget) || doc.body
    if (doc.activeElement && typeof doc.activeElement.blur === 'function') {
      try { doc.activeElement.blur() } catch (err) {}
    }
    if (focusTarget && typeof focusTarget.focus === 'function') {
      try { focusTarget.focus({ preventScroll: true }) } catch (err) {}
    }
  }
}

function getDocument(deps) {
  return callGetter(deps.getDocument) || deps.document || null
}

function callGetter(getter) {
  return typeof getter === 'function' ? getter() : null
}
