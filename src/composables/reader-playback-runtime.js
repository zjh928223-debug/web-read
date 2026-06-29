import { configureTranscriptInteractions } from './transcript-interactions.js'
import { configureChunkInteractions } from './chunk-interactions.js'
import { initAnnotationBubbleResolver } from './annotation-bubble-resolver.js'
import { initPlaybackRuntimeHelpers } from './playback-runtime-helpers.js'

export function initReaderPlaybackRuntime(deps = {}) {
  var win = typeof deps.getWindow === 'function' ? deps.getWindow() : deps.window
  var annotationBubbleResolverApi = initAnnotationBubbleResolver({
    getWords() { return deps.transcriptState.words },
    markedMap: deps.markedMap,
    vocabMatchMap: deps.vocabMatchMap
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
    getAudioPlayer() { return deps.audioPlayer },
    forceUpdateUI,
    notifyAnnotationBubbleWordClick,
    isChunkMode() { return deps.chunkState.isChunkMode },
    hasActiveTextSelectionWithinChunk: deps.hasActiveTextSelectionWithinChunk,
    legacyTranscriptContainer: deps.transcriptContainer
  })

  configureChunkInteractions({
    getAudioPlayer() { return deps.audioPlayer },
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
