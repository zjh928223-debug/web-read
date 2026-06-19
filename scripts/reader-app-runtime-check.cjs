const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-app-runtime.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeShell } from './reader-runtime-shell.js';"),
    'reader-runtime should delegate app/runtime setup through reader-runtime-shell'
  );
  assert.ok(
    assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
    'reader-runtime-shell should delegate app/runtime setup through reader-feature-runtime'
  );
  assert.ok(
    featureSource.includes("import { initReaderAppRuntime } from './reader-app-runtime.js';"),
    'reader-feature-runtime should import the reader app runtime module'
  );
  assert.ok(
    featureSource.includes('var appRuntime = initReaderAppRuntime({'),
    'reader-feature-runtime should initialize app/runtime wiring through reader app runtime'
  );

  [
    "import { initGlassEffects } from './glass-effects.js';",
    "import { initChunkNoteTransfer } from './chunk-note-transfer-module.js';",
    "import { configureReaderPublicFacades } from './reader-public-facades.js';",
    'chunkNoteTransferApi = initChunkNoteTransfer({',
    'window.__annotationLightweightModule.initManualLightweightAnnotationControls({',
    'window.__appHandlers.initExports({',
    'window.__appHandlers.initMarksImport({',
    'window.__controlsModule.init({',
    'initGlassEffects({',
    'configureReaderPublicFacades({'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own app/runtime wiring: ${pattern}`
    );
  });

  [
    "import { initGlassEffects } from './glass-effects.js'",
    "import { initChunkNoteTransfer } from './chunk-note-transfer-module.js'",
    "import { configureReaderPublicFacades } from './reader-public-facades.js'",
    'export function initReaderAppRuntime',
    'var chunkNoteTransferApi = initChunkNoteTransfer({',
    'deps.annotationLightweightModule.initManualLightweightAnnotationControls({',
    'deps.appHandlers.initExports({',
    'deps.appHandlers.initMarksImport({',
    'deps.controlsModule.init({',
    'initGlassEffects({',
    'configureReaderPublicFacades({',
    'return { chunkNoteTransferApi }'
  ].forEach((pattern) => {
    assert.ok(
      moduleSource.includes(pattern),
      `reader-app-runtime should own app/runtime wiring: ${pattern}`
    );
  });

  assert.equal(moduleSource.includes('window.'), false, 'reader-app-runtime should not read window globals');
  assert.equal(moduleSource.includes('document.'), false, 'reader-app-runtime should not read document globals');

  [
    'processTranscript(transcriptData);',
    'processChunkData(chunkData);',
    'window.toggleChunkMode(true);',
    'bridgeToPinia();'
  ].forEach((pattern) => {
    assert.ok(
      sessionInitSource.includes(pattern),
      `session-init contract should remain intact: ${pattern}`
    );
  });

  const tempSource = moduleSource
    .replace(
      "import { initGlassEffects } from './glass-effects.js'\n",
      "const initGlassEffects = globalThis.__readerAppRuntimeTest.initGlassEffects;\n"
    )
    .replace(
      "import { initChunkNoteTransfer } from './chunk-note-transfer-module.js'\n",
      "const initChunkNoteTransfer = globalThis.__readerAppRuntimeTest.initChunkNoteTransfer;\n"
    )
    .replace(
      "import { configureReaderPublicFacades } from './reader-public-facades.js'\n",
      "const configureReaderPublicFacades = globalThis.__readerAppRuntimeTest.configureReaderPublicFacades;\n"
    );

  const calls = {
    transfer: [],
    annotationLightweight: [],
    exports: [],
    marksImport: [],
    controls: [],
    glass: [],
    publicFacades: []
  };

  globalThis.__readerAppRuntimeTest = {
    initChunkNoteTransfer(deps) {
      calls.transfer.push(deps);
      return { id: 'transfer-api' };
    },
    initGlassEffects(deps) {
      calls.glass.push(deps);
    },
    configureReaderPublicFacades(deps) {
      calls.publicFacades.push(deps);
    }
  };

  const encodedSource = Buffer.from(tempSource, 'utf8').toString('base64');
  const { initReaderAppRuntime } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const markedMap = new Map();
  const deps = {
    annotationLightweightModule: {
      initManualLightweightAnnotationControls(config) { calls.annotationLightweight.push(config); }
    },
    appHandlers: {
      initExports(config) { calls.exports.push(config); },
      initMarksImport(config) { calls.marksImport.push(config); }
    },
    controlsModule: {
      init(config) { calls.controls.push(config); }
    },
    runtimeState: { id: 'runtime' },
    transcriptState: { segments: [{ id: 1 }], words: [{ word: 'one' }] },
    chunkState: { isChunkMode: true, hasAiChunkData: true },
    marksStateApi: { markedMap },
    chunkControlsApi: { toggleChunkMode(value) { return value; } },
    chunkNotesApi: {
      applyImportedChunkNotes(data) { return data; },
      saveChunkNotesNow() {},
      buildChunkNotesSnapshot() { return { notes: [] }; },
      getChunkNotesFileState() { return { fileName: '' }; },
      setChunkNotesFileState(fileState) { return fileState; },
      listChunkNotes() { return [{ id: 'note-1' }]; },
      getChunkNoteTagById(id) { return { id }; },
      getChunkNoteContentBoxSize() { return { width: 1, height: 2 }; },
      handleChunkSelectionContextMenu(event) { return event; }
    },
    sentenceNotesApi: {
      selectSentenceFromChunkTarget() {}
    },
    audioIdentityApi: {
      currentAudioKey: 'audio-key',
      getCurrentAudioFilenameBase() { return 'lesson'; },
      buildCurrentSentenceDocId() { return 'doc-id'; }
    },
    playbackRuntimeHelpersApi: {
      findChunkIndexByTime(time) { return time; }
    },
    audioPlayer: { currentTime: 12.5 },
    getFirstFileFromEvent() {},
    readFileAsText() {},
    validateMarksArray(items) { return items; },
    saveToDB() {},
    setChunkNoteVisible() {},
    loadChunkNotesForCurrentAudio() {},
    loadSentenceNotesForCurrentAudio() {},
    switchSentenceNotesDoc() {},
    applyCurrentAudioMeta() {},
    renderTranscript() { calls.rendered = 'transcript'; },
    renderChunkMode() { calls.rendered = 'chunk'; },
    forceUpdateUI(time) { calls.forcedTime = time; },
    bsFindActiveHelper() {},
    getCurrentSegmentIndexHelper() {},
    toggleFollowBtn: { id: 'follow' },
    mainAppArea: { id: 'main' },
    importChunkNotesBtn: { id: 'import-chunk' },
    importChunkNotesInput: { id: 'import-chunk-input' },
    exportChunkNotesBtn: { id: 'export-chunk' },
    exportAnnotationLightweightBtn: { id: 'export-annotation' },
    importAnnotationLightweightBtn: { id: 'import-annotation' },
    importAnnotationLightweightInput: { id: 'import-annotation-input' },
    exportJsonBtn: { id: 'export-json' },
    exportMdAllBtn: { id: 'export-md' },
    importMarksBtn: { id: 'import-marks' },
    importMarksInput: { id: 'import-marks-input' },
    syncAnnotationGenerationEntryStatus() {},
    showToast() {},
    showError() {}
  };

  const api = initReaderAppRuntime(deps);

  assert.deepEqual(api.chunkNoteTransferApi, { id: 'transfer-api' });
  assert.equal(calls.transfer.length, 1);
  assert.equal(calls.annotationLightweight.length, 1);
  assert.equal(calls.exports.length, 1);
  assert.equal(calls.marksImport.length, 1);
  assert.equal(calls.controls.length, 1);
  assert.equal(calls.glass.length, 1);
  assert.equal(calls.publicFacades.length, 1);

  assert.equal(calls.transfer[0].importButton, deps.importChunkNotesBtn);
  assert.equal(calls.transfer[0].getIsChunkMode(), true);
  assert.equal(calls.transfer[0].enterChunkMode(), true);
  assert.equal(calls.transfer[0].getCurrentAudioKey(), 'audio-key');
  assert.deepEqual(calls.transfer[0].applyImportedChunkNotes({ ok: true }), { ok: true });

  calls.annotationLightweight[0].refreshAfterImport();
  assert.equal(calls.rendered, 'chunk');
  assert.equal(calls.forcedTime, 12.5);
  deps.chunkState.isChunkMode = false;
  calls.annotationLightweight[0].refreshAfterImport();
  assert.equal(calls.rendered, 'transcript');

  assert.deepEqual(calls.exports[0].getSegments(), [{ id: 1 }]);
  assert.equal(calls.exports[0].markedMap, markedMap);
  assert.deepEqual(calls.marksImport[0].getWords(), [{ word: 'one' }]);
  assert.equal(calls.marksImport[0].isChunkModeFn(), false);
  assert.equal(calls.controls[0].state, deps.runtimeState);
  assert.equal(calls.controls[0].findChunkIndexByTime(3), 3);
  assert.deepEqual(calls.glass[0].listChunkNotes(), [{ id: 'note-1' }]);
  assert.equal(calls.publicFacades[0].buildCurrentSentenceDocId(), 'doc-id');
  assert.deepEqual(calls.publicFacades[0].openChunkNoteContextFromEvent({ type: 'ctx' }), { type: 'ctx' });

  delete globalThis.__readerAppRuntimeTest;

  console.log('reader app runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
