var runtime = {
  renderTranscript: null,
  renderChunkMode: null
}

export function configureRenderRuntime(deps) {
  var config = deps || {}
  runtime.renderTranscript = typeof config.renderTranscript === 'function' ? config.renderTranscript : null
  runtime.renderChunkMode = typeof config.renderChunkMode === 'function' ? config.renderChunkMode : null
  return runtime
}

export function renderTranscript() {
  if (typeof runtime.renderTranscript !== 'function') return undefined
  return runtime.renderTranscript()
}

export function renderChunkMode() {
  if (typeof runtime.renderChunkMode !== 'function') return undefined
  return runtime.renderChunkMode()
}
