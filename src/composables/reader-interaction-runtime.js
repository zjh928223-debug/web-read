import { configureRenderRuntime } from './render-runtime.js';
import { initReaderPlaybackRuntime } from './reader-playback-runtime.js';

export function initReaderInteractionRuntime(deps = {}) {
  configureRenderRuntime({
    bridgeToPinia: deps.bridgeToPinia,
    getTranscriptContainer: deps.getTranscriptContainer,
    getClozeMarkup: deps.getClozeMarkup,
    checkCloze: deps.checkCloze,
    tryRestoreChunkNoteDraft: deps.tryRestoreChunkNoteDraft
  });

  var playbackRuntime = initReaderPlaybackRuntime({
    runtimeState: deps.runtimeState,
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    playbackState: deps.playbackState,
    audioPlayer: deps.audioPlayer,
    mainAppArea: deps.mainAppArea,
    transcriptContainer: deps.transcriptContainer,
    findChunkIndexByTimeHelper: deps.findChunkIndexByTimeHelper,
    getCurrentSegmentIndexHelper: deps.getCurrentSegmentIndexHelper,
    getSegmentCheckpointsHelper: deps.getSegmentCheckpointsHelper,
    bsFindActiveHelper: deps.bsFindActiveHelper,
    markedMap: deps.markedMap,
    vocabMatchMap: deps.vocabMatchMap,
    hasActiveTextSelectionWithinChunk: deps.hasActiveTextSelectionWithinChunk,
    selectSentenceFromChunkTarget: deps.selectSentenceFromChunkTarget,
    openChunkNoteContextFromEvent: deps.openChunkNoteContextFromEvent,
    getSelection: deps.getSelection,
    playbackModule: deps.playbackModule,
    getWindow: deps.getWindow
  });

  return {
    playbackRuntime: playbackRuntime,
    playbackRuntimeHelpersApi: playbackRuntime.playbackRuntimeHelpersApi,
    forceUpdateUI: playbackRuntime.forceUpdateUI,
    toggleAnnotationBubble: playbackRuntime.toggleAnnotationBubble,
    handleBackwardClick: playbackRuntime.handleBackwardClick,
    handleForwardClick: playbackRuntime.handleForwardClick
  };
}
