import { initGlassEffects } from './glass-effects.js'
import { initAnnotationBackfillAiControls } from './annotation-backfill-ai-module.js'
import { initVocabularyPreviewControls } from './vocabulary-preview-module.js'
import { youtubeWorkflowClient } from './youtube-workflow-client.js'
import { configureReaderPublicFacades } from './reader-public-facades.js'
import { createOptionalLocalDictionaryClient } from '../dictionary/ecdict/browser/optional-local-dictionary-client.mjs'
import { createDictionaryEnrichmentAdapter } from '../dictionary/ecdict/application/dictionary-enrichment-adapter.mjs'
import { createLifecycleScope } from '../services/runtime/lifecycle-scope.js'
import { createObjectUrlDownloader } from '../services/runtime/download-object-url.js'

function createOptionalDictionaryEnrichmentAdapter() {
  const client = createOptionalLocalDictionaryClient()
  if (!client) return null
  return createDictionaryEnrichmentAdapter({
    client
  })
}

export function initReaderAppRuntime(deps = {}) {
  const lifecycle = createLifecycleScope()
  const downloader = createObjectUrlDownloader()
  lifecycle.add(function () { downloader.dispose() })
  var audioPlayer = (typeof globalThis !== 'undefined' && globalThis.__mediaSource && typeof globalThis.__mediaSource.createActiveMediaProxy === 'function')
    ? globalThis.__mediaSource.createActiveMediaProxy(deps.audioPlayer)
    : deps.audioPlayer
  deps.annotationLightweightModule.initManualLightweightAnnotationControls({
    exportButton: deps.exportAnnotationLightweightBtn,
    importButton: deps.importAnnotationLightweightBtn,
    importInput: deps.importAnnotationLightweightInput,
    getFirstFileFromEvent: deps.getFirstFileFromEvent,
    refreshAfterImport: function () {
      if (deps.chunkState.isChunkMode) deps.renderChunkMode()
      else deps.renderTranscript()
      deps.forceUpdateUI(audioPlayer.currentTime)
    },
    showToast: deps.showToast,
    showError: deps.showError
  })

  const annotationBackfillController = initAnnotationBackfillAiControls({
    button: deps.annotationBackfillAiBtn,
    state: deps.runtimeState,
    annotationLightweightModule: deps.annotationLightweightModule,
    client: youtubeWorkflowClient,
    refreshAfterImport: function () {
      if (deps.chunkState.isChunkMode) deps.renderChunkMode()
      else deps.renderTranscript()
      deps.forceUpdateUI(audioPlayer.currentTime)
    },
    showToast: deps.showToast,
    showError: deps.showError,
    windowObject: globalThis,
    documentObject: globalThis.document
  })
  if (annotationBackfillController && typeof annotationBackfillController.dispose === 'function') {
    lifecycle.add(function () { annotationBackfillController.dispose() })
  }

  const vocabularyPreviewController = initVocabularyPreviewControls({
    previewButton: deps.previewVocabularyBtn,
    togglePreviewButton: deps.togglePreviewVocabularyBtn,
    settleButton: deps.settleArticleVocabularyBtn,
    state: deps.runtimeState,
    client: youtubeWorkflowClient,
    showToast: deps.showToast,
    showError: deps.showError,
    windowObject: globalThis,
    documentObject: globalThis.document,
    dictionaryEnrichmentAdapter: createOptionalDictionaryEnrichmentAdapter()
  })
  if (vocabularyPreviewController && typeof vocabularyPreviewController.dispose === 'function') {
    lifecycle.add(function () { vocabularyPreviewController.dispose() })
  }

  deps.appHandlers.initExports({
    exportJsonBtn: deps.exportJsonBtn,
    exportMdAllBtn: deps.exportMdAllBtn,
    markedMap: deps.marksStateApi.markedMap,
    getSegments: function () { return deps.transcriptState.segments },
    downloadBlob: downloader.download,
    showError: deps.showError,
    showToast: deps.showToast
  })

  deps.appHandlers.initMarksImport({
    importMarksBtn: deps.importMarksBtn,
    importMarksInput: deps.importMarksInput,
    getFirstFileFromEvent: deps.getFirstFileFromEvent,
    readFileAsText: deps.readFileAsText,
    validateMarksArray: deps.validateMarksArray,
    getWords: function () { return deps.transcriptState.words },
    markedMap: deps.marksStateApi.markedMap,
    saveToDB: deps.saveToDB,
    isChunkModeFn: function () { return deps.chunkState.isChunkMode },
    renderTranscript: deps.renderTranscript,
    renderChunkMode: deps.renderChunkMode,
    forceUpdateUI: deps.forceUpdateUI,
    audioPlayer: audioPlayer,
    syncAnnotationGenerationEntryStatus: deps.syncAnnotationGenerationEntryStatus,
    showToast: deps.showToast,
    showError: deps.showError
  })

  const controlsController = deps.controlsModule.init({
    state: deps.runtimeState,
    audioPlayer: audioPlayer,
    bsFindActiveHelper: deps.bsFindActiveHelper,
    findChunkIndexByTime: deps.playbackRuntimeHelpersApi.findChunkIndexByTime,
    getCurrentSegmentIndexHelper: deps.getCurrentSegmentIndexHelper,
    toggleFollowBtn: deps.toggleFollowBtn,
    mainAppArea: deps.mainAppArea
  })
  if (controlsController && typeof controlsController.dispose === 'function') {
    lifecycle.add(function () { controlsController.dispose() })
  }

  const disposeGlassEffects = initGlassEffects()
  if (typeof disposeGlassEffects === 'function') lifecycle.add(disposeGlassEffects)

  configureReaderPublicFacades({
    buildCurrentSentenceDocId: deps.audioIdentityApi.buildCurrentSentenceDocId,
    applyCurrentAudioMeta: deps.applyCurrentAudioMeta
  })

  return {
    dispose: lifecycle.dispose
  }
}
