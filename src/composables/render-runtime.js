var runtime = {
  bridgeToPinia: null,
  tryRestoreChunkNoteDraft: null
}

export function configureRenderRuntime(deps) {
  var config = deps || {}
  runtime.bridgeToPinia = typeof config.bridgeToPinia === 'function' ? config.bridgeToPinia : null
  runtime.tryRestoreChunkNoteDraft = typeof config.tryRestoreChunkNoteDraft === 'function'
    ? config.tryRestoreChunkNoteDraft
    : null
  return runtime
}

export function renderTranscript() {
  if (typeof runtime.bridgeToPinia !== 'function') return undefined
  runtime.bridgeToPinia()
  return undefined
}

export function renderChunkMode() {
  if (typeof runtime.bridgeToPinia === 'function') runtime.bridgeToPinia()
  if (typeof runtime.tryRestoreChunkNoteDraft === 'function') {
    runtime.tryRestoreChunkNoteDraft()
  }
  return undefined
}
