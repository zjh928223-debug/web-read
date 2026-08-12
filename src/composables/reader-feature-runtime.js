import { createLifecycleScope } from '../services/runtime/lifecycle-scope.js'

export function initReaderFeatureRuntime({ adapters } = {}) {
  if (!adapters) throw new TypeError('reader feature adapters are required')
  const lifecycle = createLifecycleScope()
  const own = (runtime) => {
    if (runtime && typeof runtime.dispose === 'function') lifecycle.add(() => runtime.dispose())
    return runtime
  }

  let chunkControlsApi = null
  let forceUpdateUI
  const importRuntime = own(adapters.startImport({ getChunkControlsApi: () => chunkControlsApi }))
  const controlsRuntime = own(adapters.startControls({ getForceUpdateUI: () => forceUpdateUI }))
  chunkControlsApi = controlsRuntime.chunkControlsApi
  const interactionRuntime = own(adapters.startInteraction({ visualVocabApi: importRuntime.visualVocabApi }))
  forceUpdateUI = interactionRuntime.forceUpdateUI
  const keyboardRuntime = own(adapters.startKeyboard({ chunkControlsApi, interactionRuntime }))
  const appRuntime = own(adapters.startApp({ chunkControlsApi, interactionRuntime }))

  return {
    importRuntime,
    visualVocabApi: importRuntime.visualVocabApi,
    controlsRuntime,
    chunkControlsApi,
    interactionRuntime,
    playbackRuntimeHelpersApi: interactionRuntime.playbackRuntimeHelpersApi,
    forceUpdateUI,
    keyboardRuntime,
    appRuntime,
    dispose: lifecycle.dispose,
  }
}
