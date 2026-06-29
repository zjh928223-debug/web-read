const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');

  assert.ok(
    assemblySource.includes("import { createReaderFeatureRuntimeDeps } from './reader-feature-runtime-deps.js';"),
    'reader-runtime-assembly should import reader feature runtime dependency assembly'
  );
  assert.ok(
    assemblySource.includes('...createReaderFeatureRuntimeDeps({'),
    'reader-runtime-assembly should pass feature deps through reader-feature-runtime-deps'
  );
  [
    'globalObject: deps.globalObject',
    'transcriptState: bootstrapRuntime.transcriptState',
    'audioIdentityApi: bootstrapRuntime.audioIdentityApi',
    'validateMarksArray: runtimeDeps.validateMarksArray',
    'buildVocabMatchMap: runtimeDeps.buildVocabMatchMapHelper',
    'applyCurrentAudioMeta: notesSessionRuntime.applyCurrentAudioMeta',
    'bridgeToPinia: notesSessionRuntime.bridgeToPinia',
    'restoreReaderFocus: runtimeContext.restoreReaderFocus',
    'audioPlayer: domRefs.audioPlayer'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `reader-feature-runtime-deps should own mapping: ${pattern}`);
  });
  assert.equal(moduleSource.includes('window.'), false, 'reader-feature-runtime-deps should not read or write window globals');
  assert.equal(moduleSource.includes('document.'), false, 'reader-feature-runtime-deps should not read document globals');

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const { createReaderFeatureRuntimeDeps } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const runtimeDeps = {
    getFirstFileFromEvent: () => 'file',
    readFileAsText: () => 'text',
    markFileLoaded: () => 'loaded',
    validateVisualData: () => true,
    validateTranscriptData: () => true,
    validateMarksArray: () => true,
    findChunkIndexByTimeHelper: () => 1,
    bsFindActiveHelper: () => 2,
    getCurrentSegmentIndexHelper: () => 3,
    getSegmentCheckpointsHelper: () => [],
    cleanTextHelper: (value) => value,
    tokenizeTextHelper: (value) => [value],
    findExactMatchRangeHelper: () => null,
    buildVocabMatchMapHelper: () => new Map()
  };
  const bootstrapRuntime = {
    transcriptState: { id: 'transcript' },
    chunkState: { id: 'chunk' },
    clozeState: { id: 'cloze' },
    playbackState: { id: 'playback' },
    audioIdentityApi: { id: 'audio' },
    hotkeyStateApi: { id: 'hotkeys' },
    marksStateApi: { id: 'marks' },
    saveToDB: () => 'saved',
    runtimeDeps
  };
  const domRefs = {
    audioFileInput: { id: 'audio-file' },
    transcriptFileInput: { id: 'transcript-file' },
    visualFileInput: { id: 'visual-file' },
    lblAudio: { id: 'lbl-audio' },
    lblTranscript: { id: 'lbl-transcript' },
    lblVisual: { id: 'lbl-visual' },
    mainAppArea: { id: 'main-app' },
    transcriptContainer: { id: 'transcript-container' },
    audioPlayer: { id: 'audio' },
    toggleChunkBtn: { id: 'toggle-chunk' },
    chunkCnHoldBtn: { id: 'chunk-cn-hold' },
    highlightModeBtn: { id: 'highlight-mode' },
    themeControlsEl: { id: 'theme-controls' },
    themeToggleBtn: { id: 'theme-toggle' },
    themeCustomPanel: { id: 'theme-custom' },
    themeCustomBgInput: { id: 'theme-bg' },
    themeCustomTextInput: { id: 'theme-text' },
    themeCustomSubInput: { id: 'theme-sub' },
    themeCustomBorderInput: { id: 'theme-border' },
    themeCustomButtonInput: { id: 'theme-button' },
    themeCustomResetBtn: { id: 'theme-reset' },
    highlightColorInput: { id: 'highlight-color' },
    sentenceColorInput: { id: 'sentence-color' },
    hotkeyInput: { id: 'hotkey' },
    hotkeyAnnotationBubbleInput: { id: 'hotkey-annotation' },
    hotkeyBackwardInput: { id: 'hotkey-backward' },
    hotkeyForwardInput: { id: 'hotkey-forward' },
    hotkeyChunkCnInput: { id: 'hotkey-chunk-cn' },
    hotkeyChunkShadowInput: { id: 'hotkey-chunk-shadow' },
    toggleFollowBtn: { id: 'toggle-follow' },
    exportAnnotationLightweightBtn: { id: 'export-annotation' },
    importAnnotationLightweightBtn: { id: 'import-annotation' },
    importAnnotationLightweightInput: { id: 'import-annotation-input' },
    exportJsonBtn: { id: 'export-json' },
    exportMdAllBtn: { id: 'export-md' },
    importMarksBtn: { id: 'import-marks' },
    importMarksInput: { id: 'import-marks-input' }
  };
  const runtimeContext = {
    domRefs,
    restoreReaderFocus: () => 'focus'
  };
  const notesSessionRuntime = {
    applyCurrentAudioMeta: () => 'audio-meta',
    switchSentenceNotesDoc: () => 'switch',
    bridgeToPinia: () => 'bridge',
    loadChunkNotesForCurrentAudio: () => 'load-chunk',
    loadSentenceNotesForCurrentAudio: () => 'load-sentence',
    chunkNotesApi: { id: 'chunk-notes' },
    sentenceNotesApi: { id: 'sentence-notes' },
    notesState: { id: 'notes-state' }
  };
  const api = createReaderFeatureRuntimeDeps({
    globalObject: { id: 'window' },
    runtimeState: { id: 'runtime-state' },
    runtimeContext,
    bootstrapRuntime,
    notesSessionRuntime,
    showToast: () => 'toast',
    showError: () => 'error',
    renderTranscript: () => 'transcript',
    renderChunkMode: () => 'chunk',
    syncAnnotationGenerationEntryStatus: () => 'sync'
  });

  assert.equal(api.transcriptState, bootstrapRuntime.transcriptState);
  assert.equal(api.hotkeyStateApi, bootstrapRuntime.hotkeyStateApi);
  assert.equal(api.audioFileInput, domRefs.audioFileInput);
  assert.equal(api.validateMarksArray, runtimeDeps.validateMarksArray);
  assert.equal(api.buildVocabMatchMap, runtimeDeps.buildVocabMatchMapHelper);
  assert.equal(api.applyCurrentAudioMeta, notesSessionRuntime.applyCurrentAudioMeta);
  assert.equal(api.bridgeToPinia, notesSessionRuntime.bridgeToPinia);
  assert.equal(api.restoreReaderFocus, runtimeContext.restoreReaderFocus);
  assert.equal(api.audioPlayer, domRefs.audioPlayer);
  [
    'toggleCurrentNote',
    'closeChunkNoteExportDialog',
    'getChunkNoteExportDialogEl',
    'setChunkNoteTransferApi',
    'chunkFileInput',
    'clozeFileInput',
    'hotkeyNotesInput',
    'hotkeyChunkNoteInput',
    'chunkNoteCtxAddBtn',
    'chunkNoteCtxMenu',
    'importChunkNotesBtn',
    'exportChunkNotesBtn'
  ].forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(api, key), false, `retired feature dep should stay removed: ${key}`);
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(api, 'initAnnotationApiSettingsUi'),
    false,
    'reader feature deps should not carry retired annotation API settings facade'
  );

  console.log('reader feature runtime deps check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
