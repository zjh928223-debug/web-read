export function createReaderWordNavigation(deps) {
  const doc = deps.documentObject
  const store = deps.selectionStore
  const cleanups = []
  let disposed = false

  function setStatus(message) {
    const status = doc.getElementById('annotation-navigation-status')
    if (status) status.textContent = message
  }

  function clearSelection() {
    store.selectedAnnotationWordIndex = -1
    setStatus('')
  }

  function selectSpan(span) {
    if (disposed) return false
    const index = Number(span?.dataset?.wordIndex)
    if (!Number.isInteger(index) || index < 0 || !deps.getWords()[index]) return false
    store.selectedAnnotationWordIndex = index
    return true
  }

  function navigate(direction) {
    if (disposed) return false
    const words = deps.getWords()
    const indices = [...new Set(deps.getNavigableWordIndices())]
      .filter(index => Number.isInteger(index) && index >= 0 && index < words.length)
      .sort((a, b) => a - b)
    if (!indices.length) {
      clearSelection()
      setStatus('本文暂无已解释或手动标记词')
      return false
    }
    const selected = Number(store.selectedAnnotationWordIndex)
    const anchor = selected >= 0 ? selected : Number(deps.getPlaybackWordIndex())
    let position = direction > 0
      ? indices.findIndex(index => index > anchor)
      : indices.findLastIndex(index => index < anchor)
    // Before any word has a position, either direction enters at its respective edge.
    if (anchor < 0) position = direction > 0 ? 0 : indices.length - 1
    if (position < 0) {
      setStatus(direction > 0 ? '已到最后一个标注词' : '已到第一个标注词')
      return false
    }
    const index = indices[position]
    const prefix = deps.isChunkMode() ? 'chunk-word-' : 'word-'
    const span = doc.getElementById(prefix + index)
    if (!span || span.isConnected === false) {
      setStatus('当前阅读模式尚未显示该词')
      return false
    }
    selectSpan(span)
    deps.notifyAnnotationBubbleWordClick(span, { forceShow: true, allowUnmarked: true })
    span.scrollIntoView?.({ block: 'center', inline: 'nearest' })
    setStatus(`标注词 ${position + 1}/${indices.length}：${String(words[index].word || words[index].text || '').trim()}`)
    return true
  }

  function close() {
    deps.closeBubble()
    clearSelection()
  }

  for (const [id, direction] of [['btn-prev-annotation-word', -1], ['btn-next-annotation-word', 1]]) {
    const button = doc.getElementById(id)
    if (!button) continue
    const handler = () => navigate(direction)
    button.addEventListener('click', handler)
    cleanups.push(() => button.removeEventListener('click', handler))
  }
  return {
    navigate,
    selectSpan,
    clearSelection,
    close,
    dispose() {
      if (disposed) return
      disposed = true
      for (const cleanup of cleanups.splice(0)) cleanup()
      clearSelection()
    }
  }
}
