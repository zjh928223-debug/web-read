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

export function createCurrentNoteToggler(deps = {}) {
  return function toggleCurrentNote() {
    var chunkState = deps.chunkState || {}
    if (chunkState.isChunkMode) return

    var transcriptState = deps.transcriptState || {}
    var playbackState = deps.playbackState || {}
    var targetIdx = -1

    if (transcriptState.currentWordIndex !== -1) {
      var words = transcriptState.words || []
      var word = words[transcriptState.currentWordIndex]
      if (word) targetIdx = word.segIndex
    } else if (playbackState.lastActiveSegIndex !== -1) {
      targetIdx = playbackState.lastActiveSegIndex
    }

    if (targetIdx === -1) return
    var doc = getDocument(deps)
    var noteEl = doc && typeof doc.getElementById === 'function'
      ? doc.getElementById('note-' + targetIdx)
      : null
    if (noteEl) noteEl.open = !noteEl.open
  }
}

export function createChunkNoteTransferDialogAccess(deps = {}) {
  function getTransferApi() {
    return callGetter(deps.getTransferApi)
  }

  return {
    closeChunkNoteExportDialog() {
      var api = getTransferApi()
      if (api && typeof api.closeExportDialog === 'function') {
        return api.closeExportDialog()
      }
      return undefined
    },
    getChunkNoteExportDialogEl() {
      var api = getTransferApi()
      return api && typeof api.getExportDialogEl === 'function'
        ? api.getExportDialogEl()
        : null
    }
  }
}

function getDocument(deps) {
  return callGetter(deps.getDocument) || deps.document || null
}

function callGetter(getter) {
  return typeof getter === 'function' ? getter() : null
}
