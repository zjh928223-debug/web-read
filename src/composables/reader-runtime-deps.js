export function collectReaderRuntimeDeps(deps = {}) {
  var win = typeof deps.getWindow === 'function' ? deps.getWindow() : deps.window
  var transcriptState = deps.transcriptState || {}
  var dataUtils = win.DataUtils
  var clozeUtils = win.ClozeUtils
  var clozeViewModelHelpers = win.ClozeViewModelHelpers
  var playbackIndexHelpers = win.PlaybackIndexHelpers
  var chunkMatchingHelpers = win.ChunkMatchingHelpers
  var vocabMatchingHelpers = win.VocabMatchingHelpers
  var identityStorageKeys = win.IdentityStorageKeys
  var importExportSharedHelpers = win.ImportExportSharedHelpers

  return {
    isPlainObjectRecord: dataUtils.isPlainObjectRecord,
    validateVisualData: dataUtils.validateVisualData,
    validateChunkData: dataUtils.validateChunkData,
    validateMarksArray: dataUtils.validateMarksArray,
    validateTranscriptData(json) {
      return dataUtils.validateTranscriptData(json, transcriptState.segments)
    },
    validateClozeData: clozeUtils.validateClozeData,
    findChunkIndexByTimeHelper: playbackIndexHelpers.findChunkIndexByTime,
    bsFindActiveHelper: playbackIndexHelpers.bsFindActive,
    getCurrentSegmentIndexHelper: playbackIndexHelpers.getCurrentSegmentIndex,
    getSegmentCheckpointsHelper: playbackIndexHelpers.getSegmentCheckpoints,
    cleanTextHelper: chunkMatchingHelpers.cleanText,
    tokenizeTextHelper: chunkMatchingHelpers.tokenizeText,
    findExactMatchRangeHelper: chunkMatchingHelpers.findExactMatchRange,
    buildVocabMatchMapHelper: vocabMatchingHelpers.buildVocabMatchMap,
    buildAudioKey: identityStorageKeys.buildAudioKey,
    getChunkNotesStorageKey: identityStorageKeys.getChunkNotesStorageKey,
    getChunkNoteDraftStorageKey: identityStorageKeys.getChunkNoteDraftStorageKey,
    getSentenceNotesStorageKey: identityStorageKeys.getSentenceNotesStorageKey,
    getLegacySentenceNotesStorageKey: identityStorageKeys.getLegacySentenceNotesStorageKey,
    buildCurrentSentenceDocId: identityStorageKeys.buildCurrentSentenceDocId,
    buildCurrentAudioMetaState: importExportSharedHelpers.buildCurrentAudioMetaState,
    getCurrentAudioFilenameBase: importExportSharedHelpers.getCurrentAudioFilenameBase,
    getFirstFileFromEvent: importExportSharedHelpers.getFirstFileFromEvent,
    markFileLoaded: importExportSharedHelpers.markFileLoaded,
    readFileAsText: importExportSharedHelpers.readFileAsText
  }
}
