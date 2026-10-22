import { configureTranscriptInteractions } from './transcript-interactions.js'
import { configureChunkInteractions } from './chunk-interactions.js'
import { initAnnotationBubbleResolver } from './annotation-bubble-resolver.js'
import { initPlaybackRuntimeHelpers } from './playback-runtime-helpers.js'

export function initReaderPlaybackRuntime(deps = {}) {
  var win = typeof deps.getWindow === 'function' ? deps.getWindow() : deps.window
  function getActiveMediaElement() {
    var mediaSource = win && win.__mediaSource
    return mediaSource && typeof mediaSource.getActiveMediaElement === 'function'
      ? mediaSource.getActiveMediaElement(deps.audioPlayer)
      : deps.audioPlayer
  }
  var annotationBubbleResolverApi = initAnnotationBubbleResolver({
    getWords() { return deps.transcriptState.words },
    markedMap: deps.markedMap,
    vocabMatchMap: deps.vocabMatchMap,
    onTargetSelected: deps.onAnnotationTargetSelected,
    onClose: deps.onAnnotationBubbleClose
  })
  var notifyAnnotationBubbleWordClick = annotationBubbleResolverApi.notifyAnnotationBubbleWordClick

  var forceUpdateUI
  var playbackRuntimeHelpersApi = initPlaybackRuntimeHelpers({
    chunkState: deps.chunkState,
    transcriptState: deps.transcriptState,
    playbackState: deps.playbackState,
    audioPlayer: deps.audioPlayer,
    mainAppArea: deps.mainAppArea,
    transcriptContainer: deps.transcriptContainer,
    findChunkIndexByTimeHelper: deps.findChunkIndexByTimeHelper,
    getCurrentSegmentIndexHelper: deps.getCurrentSegmentIndexHelper,
    getForceUpdateUI() { return forceUpdateUI },
    getWindow() { return win }
  })

  deps.playbackModule.init({
    state: deps.runtimeState,
    audioPlayer: deps.audioPlayer,
    getCurrentSegmentIndexHelper: deps.getCurrentSegmentIndexHelper,
    getSegmentCheckpointsHelper: deps.getSegmentCheckpointsHelper,
    bsFindActiveHelper: deps.bsFindActiveHelper,
    findChunkIndexByTime: playbackRuntimeHelpersApi.findChunkIndexByTime,
    swapActiveClass: playbackRuntimeHelpersApi.swapActiveClass,
    followPlaybackTarget: playbackRuntimeHelpersApi.followPlaybackTarget,
    getAnnotationBubble: annotationBubbleResolverApi.getAnnotationBubble,
    jumpPrevSentence: playbackRuntimeHelpersApi.jumpPrevSentence,
    jumpNextSentence: playbackRuntimeHelpersApi.jumpNextSentence
  })

  forceUpdateUI = win.forceUpdateUI
  var toggleAnnotationBubble = win.toggleAnnotationBubble
  var handleBackwardClick = win.handleBackwardClick
  var handleForwardClick = win.handleForwardClick

  configureTranscriptInteractions({
    getAudioPlayer() { return getActiveMediaElement() },
    forceUpdateUI,
    notifyAnnotationBubbleWordClick,
    isChunkMode() { return deps.chunkState.isChunkMode },
    legacyTranscriptContainer: deps.transcriptContainer
  })

  configureChunkInteractions({
    getAudioPlayer() { return getActiveMediaElement() },
    getSelection: deps.getSelection,
    forceUpdateUI,
    notifyAnnotationBubbleWordClick
  })

  return {
    annotationBubbleResolverApi,
    notifyAnnotationBubbleWordClick,
    playbackRuntimeHelpersApi,
    forceUpdateUI,
    toggleAnnotationBubble,
    handleBackwardClick,
    handleForwardClick
  }
}
