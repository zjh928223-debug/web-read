var runtime = {
  bridgeToPinia: null
}

export function configureRenderRuntime(deps) {
  var config = deps || {}
  runtime.bridgeToPinia = typeof config.bridgeToPinia === 'function' ? config.bridgeToPinia : null
  return runtime
}

export function renderTranscript() {
  if (typeof runtime.bridgeToPinia !== 'function') return undefined
  runtime.bridgeToPinia()
  return undefined
}

export function renderChunkMode() {
  if (typeof runtime.bridgeToPinia === 'function') runtime.bridgeToPinia()
  return undefined
}
