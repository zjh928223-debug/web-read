const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-import-runtime.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeShell } from './reader-runtime-shell.js';"),
    'reader-runtime should delegate reader import runtime through reader-runtime-shell'
  );
  assert.ok(
    shellSource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
    'reader-runtime-shell should delegate reader import runtime through reader-feature-runtime'
  );
  assert.ok(
    featureSource.includes("import { initReaderImportRuntime } from './reader-import-runtime.js';"),
    'reader-feature-runtime should import reader import runtime'
  );
  assert.ok(
    featureSource.includes('var importRuntime = initReaderImportRuntime({'),
    'reader-feature-runtime should initialize import/runtime wiring through reader import runtime'
  );

  [
    "import { configureSessionStateProvider } from './session-state-provider.js';",
    "import { initVisualVocab } from './visual-vocab-module.js';",
    "import { configureRuntimeStateBindings } from './runtime-state-bindings.js';",
    'configureSessionFacades({',
    'configureSessionStateProvider(runtimeState);',
    'var visualVocabApi = initVisualVocab({',
    'configureRuntimeStateBindings({',
    'window.__importModule.initChunkPipeline({',
    'window.__importModule.initImportHandlers({'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own import/runtime wiring: ${pattern}`
    );
  });

  [
    "import { configureSessionStateProvider } from './session-state-provider.js'",
    "import { initVisualVocab } from './visual-vocab-module.js'",
    "import { configureRuntimeStateBindings } from './runtime-state-bindings.js'",
    'export function initReaderImportRuntime',
    'configureSessionFacades({',
    'configureSessionStateProvider(deps.runtimeState)',
    'var visualVocabApi = initVisualVocab({',
    'configureRuntimeStateBindings({',
    'var chunkPipelineApi = deps.importModule.initChunkPipeline({',
    'var importHandlersApi = deps.importModule.initImportHandlers({',
    'return {'
  ].forEach((pattern) => {
    assert.ok(
      moduleSource.includes(pattern),
      `reader-import-runtime should own import/runtime wiring: ${pattern}`
    );
  });

  assert.equal(moduleSource.includes('window.'), false, 'reader-import-runtime should not read window globals');
  assert.equal(moduleSource.includes('document.'), false, 'reader-import-runtime should not read document globals');

  [
    'processTranscript(transcriptData);',
    'processChunkData(chunkData);',
    'window.toggleChunkMode(true);',
    'bridgeToPinia();',
    'processVisual(visualData);'
  ].forEach((pattern) => {
    assert.ok(
      sessionInitSource.includes(pattern),
      `session-init contract should remain intact: ${pattern}`
    );
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-import-runtime-'));
  const tempModulePath = path.join(tempDir, 'reader-import-runtime.mjs');
  const tempSource = moduleSource
    .replace(
      "import { configureSessionStateProvider } from './session-state-provider.js'\n",
      "const configureSessionStateProvider = globalThis.__readerImportRuntimeTest.configureSessionStateProvider;\n"
    )
    .replace(
      "import { initVisualVocab } from './visual-vocab-module.js'\n",
      "const initVisualVocab = globalThis.__readerImportRuntimeTest.initVisualVocab;\n"
    )
    .replace(
      "import { configureRuntimeStateBindings } from './runtime-state-bindings.js'\n",
      "const configureRuntimeStateBindings = globalThis.__readerImportRuntimeTest.configureRuntimeStateBindings;\n"
    )
    .replace(
      /import \{\n  configureSessionFacades,[\s\S]*?\} from '\.\/session-facades\.js'\n/,
      [
        'const {',
        '  configureSessionFacades,',
        '  clearGeneratedAnnotationIndex,',
        '  clearPersistedChunkSession,',
        '  getAnnotationGenerationScope,',
        '  emitAnnotationDiagnostics,',
        '  scheduleGeneratedAnnotationIndexRefresh,',
        '  syncAnnotationGenerationEntryStatus',
        '} = globalThis.__readerImportRuntimeTest.sessionFacades;\n'
      ].join('\n')
    );
  fs.writeFileSync(tempModulePath, tempSource);

  const calls = {
    sessionFacades: [],
    stateProvider: [],
    visual: [],
    bindings: [],
    chunkPipeline: [],
    importHandlers: []
  };
  const fakeVisualApi = {
    globalVocab: [],
    vocabMatchMap: new Map(),
    rebuildVocabMatching() {}
  };
  const fakeChunkPipelineApi = {
    processChunkData() {}
  };
  const fakeImportHandlersApi = {
    processTranscript() {}
  };
  const sessionFns = {
    clearGeneratedAnnotationIndex() {},
    clearPersistedChunkSession() { return Promise.resolve(); },
    getAnnotationGenerationScope() { return 'scope'; },
    emitAnnotationDiagnostics() {},
    scheduleGeneratedAnnotationIndexRefresh() {},
    syncAnnotationGenerationEntryStatus() {}
  };

  globalThis.__readerImportRuntimeTest = {
    configureSessionStateProvider(state) { calls.stateProvider.push(state); },
    initVisualVocab(deps) {
      calls.visual.push(deps);
      return fakeVisualApi;
    },
    configureRuntimeStateBindings(deps) { calls.bindings.push(deps); },
    sessionFacades: {
      configureSessionFacades(deps) { calls.sessionFacades.push(deps); },
      ...sessionFns
    }
  };

  const { initReaderImportRuntime } = await import(pathToFileURL(tempModulePath).href);

  let toggledChunkMode = null;
  const markedMap = new Map();
  const deps = {
    importModule: {
      initChunkPipeline(config) {
        calls.chunkPipeline.push(config);
        return fakeChunkPipelineApi;
      },
      initImportHandlers(config) {
        calls.importHandlers.push(config);
        return fakeImportHandlersApi;
      }
    },
    runtimeState: { id: 'runtime' },
    transcriptState: { segments: [{ id: 1 }], words: [{ word: 'one' }] },
    chunkState: { isChunkMode: false },
    clozeState: { hasClozeData: false },
    playbackState: { autoFollow: true },
    audioIdentityApi: {
      buildCurrentSentenceDocId() { return 'doc-id'; }
    },
    hotkeyStateApi: { markKey: 'm' },
    marksStateApi: { markedMap },
    visualFileInput: { id: 'visual' },
    validateVisualData(data) { return data; },
    buildVocabMatchMap() { return new Map(); },
    saveToDB() {},
    getFirstFileFromEvent() {},
    readFileAsText() {},
    markFileLoaded() {},
    lblVisual: { id: 'lbl-visual' },
    showToast() {},
    showError() {},
    restoreReaderFocus() {},
    bridgeToPinia() {},
    renderChunkMode() {},
    toggleChunkBtn: { id: 'toggle-chunk' },
    getChunkControlsApi() {
      return {
        toggleChunkMode(value) { toggledChunkMode = value; }
      };
    },
    cleanTextHelper() {},
    tokenizeTextHelper() {},
    findExactMatchRangeHelper() {},
    audioFileInput: { id: 'audio-file' },
    transcriptFileInput: { id: 'transcript-file' },
    chunkFileInput: { id: 'chunk-file' },
    clozeFileInput: { id: 'cloze-file' },
    applyCurrentAudioMeta() {},
    lblAudio: { id: 'lbl-audio' },
    lblTranscript: { id: 'lbl-transcript' },
    validateTranscriptData(data) { return data; },
    validateChunkData(data) { return data; },
    validateClozeData(data) { return data; },
    switchSentenceNotesDoc() {},
    renderTranscript() {},
    forceUpdateUI: undefined,
    closeChunkNoteExportDialog() {},
    loadChunkNotesForCurrentAudio() {},
    chunkNotesApi: {
      clearChunkNotesFileState() { return 'cleared'; }
    },
    audioPlayer: { id: 'audio' },
    transcriptContainer: { id: 'transcript' },
    notesState: { currentDocId: 'doc' }
  };

  const api = initReaderImportRuntime(deps);

  assert.equal(calls.sessionFacades.length, 1);
  assert.equal(calls.sessionFacades[0].getRuntimeState(), deps.runtimeState);
  assert.deepEqual(calls.stateProvider, [deps.runtimeState]);
  assert.equal(calls.visual.length, 1);
  assert.equal(calls.bindings.length, 1);
  assert.equal(calls.chunkPipeline.length, 1);
  assert.equal(calls.importHandlers.length, 1);
  assert.equal(api.visualVocabApi, fakeVisualApi);
  assert.equal(api.chunkPipelineApi, fakeChunkPipelineApi);
  assert.equal(api.importHandlersApi, fakeImportHandlersApi);

  assert.equal(calls.visual[0].visualFileInput, deps.visualFileInput);
  assert.equal(calls.visual[0].hasTranscriptData(), true);
  assert.deepEqual(calls.visual[0].getWords(), [{ word: 'one' }]);
  assert.equal(calls.bindings[0].visualVocabApi, fakeVisualApi);
  assert.equal(calls.bindings[0].runtimeState, deps.runtimeState);
  assert.equal(calls.chunkPipeline[0].state, deps.runtimeState);
  calls.chunkPipeline[0].enterChunkMode();
  assert.equal(toggledChunkMode, true);
  assert.equal(calls.importHandlers[0].processChunkData, fakeChunkPipelineApi.processChunkData);
  assert.equal(calls.importHandlers[0].rebuildVocabMatching, fakeVisualApi.rebuildVocabMatching);
  assert.equal(calls.importHandlers[0].clearGeneratedAnnotationIndex, sessionFns.clearGeneratedAnnotationIndex);
  assert.equal(calls.importHandlers[0].syncAnnotationGenerationEntryStatus, sessionFns.syncAnnotationGenerationEntryStatus);
  assert.equal(calls.importHandlers[0].buildCurrentSentenceDocId(), 'doc-id');
  assert.equal(calls.importHandlers[0].clearChunkNotesFileState(), 'cleared');
  assert.equal(calls.importHandlers[0].markedMap, markedMap);
  assert.equal(calls.importHandlers[0].forceUpdateUI, undefined);

  delete globalThis.__readerImportRuntimeTest;

  console.log('reader import runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
