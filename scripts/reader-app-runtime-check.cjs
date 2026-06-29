const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-app-runtime.js'), 'utf8');
  const sessionInitSource = [
  'session-runtime-assembly.js',
  'session-restore-runtime.js',
  'session-startup-runtime.js',
  'session-startup-cleanup.js',
  'session-ui-settings-restore.js',
  'session-annotation-context.js',
  'session-annotation-generated-index.js',
  'session-annotation-marks.js',
  'session-annotation-lightweight-io.js',
  'session-annotation-export-payload.js',
  'session-annotation-import-normalization.js',
  'session-annotation-bundle-merge.js',
  'session-annotation-text.js'
].map((file) => fs.readFileSync(path.join(repoRoot, 'src', 'composables', file), 'utf8')).join('\n');

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
    'reader-runtime should delegate app/runtime setup through reader-runtime-assembly'
  );
  assert.ok(
    assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
    'reader-runtime-assembly should delegate app/runtime setup through reader-feature-runtime'
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
    "import { initAnnotationBackfillAiControls } from './annotation-backfill-ai-module.js'",
    "import { youtubeWorkflowClient } from './youtube-workflow-client.js'",
    "import { configureReaderPublicFacades } from './reader-public-facades.js'",
    'export function initReaderAppRuntime',
    'deps.annotationLightweightModule.initManualLightweightAnnotationControls({',
    'initAnnotationBackfillAiControls({',
    'deps.appHandlers.initExports({',
    'deps.appHandlers.initMarksImport({',
    'deps.controlsModule.init({',
    'initGlassEffects({',
    'configureReaderPublicFacades({',
    'return {}'
  ].forEach((pattern) => {
    assert.ok(
      moduleSource.includes(pattern),
      `reader-app-runtime should own app/runtime wiring: ${pattern}`
    );
  });

  assert.equal(moduleSource.includes('window.'), false, 'reader-app-runtime should not read window globals');
  assert.equal(moduleSource.includes('document.'), false, 'reader-app-runtime should not read document globals');
  [
    "import { initChunkNoteTransfer } from './chunk-note-transfer-module.js'",
    'initChunkNoteTransfer(',
    'chunkNoteTransferApi',
    'openChunkNoteContextFromEvent'
  ].forEach((pattern) => {
    assert.equal(moduleSource.includes(pattern), false, `retired chunk-note transfer wiring should stay removed: ${pattern}`);
  });

  [
    'deps.processTranscript(transcriptData);',
    'deps.processChunkData(chunkData);',
    'windowObject.toggleChunkMode(true);',
    'deps.bridgeToPinia();'
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
      "import { initAnnotationBackfillAiControls } from './annotation-backfill-ai-module.js'\n",
      "const initAnnotationBackfillAiControls = globalThis.__readerAppRuntimeTest.initAnnotationBackfillAiControls;\n"
    )
    .replace(
      "import { youtubeWorkflowClient } from './youtube-workflow-client.js'\n",
      "const youtubeWorkflowClient = globalThis.__readerAppRuntimeTest.youtubeWorkflowClient;\n"
    )
    .replace(
      "import { configureReaderPublicFacades } from './reader-public-facades.js'\n",
      "const configureReaderPublicFacades = globalThis.__readerAppRuntimeTest.configureReaderPublicFacades;\n"
    );

  const calls = {
    annotationLightweight: [],
    annotationBackfill: [],
    exports: [],
    marksImport: [],
    controls: [],
    glass: [],
    publicFacades: []
  };

  globalThis.__readerAppRuntimeTest = {
    initGlassEffects(deps) {
      calls.glass.push(deps);
    },
    initAnnotationBackfillAiControls(deps) {
      calls.annotationBackfill.push(deps);
      return { id: 'annotation-backfill-controller' };
    },
    youtubeWorkflowClient: { id: 'youtube-client' },
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
      listChunkNotes() { return [{ id: 'note-1' }]; },
      getChunkNoteTagById(id) { return { id }; },
      getChunkNoteContentBoxSize() { return { width: 1, height: 2 }; }
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
    exportAnnotationLightweightBtn: { id: 'export-annotation' },
    importAnnotationLightweightBtn: { id: 'import-annotation' },
    importAnnotationLightweightInput: { id: 'import-annotation-input' },
    annotationBackfillAiBtn: { id: 'annotation-backfill-ai' },
    exportJsonBtn: { id: 'export-json' },
    exportMdAllBtn: { id: 'export-md' },
    importMarksBtn: { id: 'import-marks' },
    importMarksInput: { id: 'import-marks-input' },
    syncAnnotationGenerationEntryStatus() {},
    showToast() {},
    showError() {}
  };

  const api = initReaderAppRuntime(deps);

  assert.deepEqual(api, {});
  assert.equal(calls.annotationLightweight.length, 1);
  assert.equal(calls.annotationBackfill.length, 1);
  assert.equal(calls.exports.length, 1);
  assert.equal(calls.marksImport.length, 1);
  assert.equal(calls.controls.length, 1);
  assert.equal(calls.glass.length, 1);
  assert.equal(calls.publicFacades.length, 1);

  calls.annotationLightweight[0].refreshAfterImport();
  assert.equal(calls.rendered, 'chunk');
  assert.equal(calls.forcedTime, 12.5);
  calls.annotationBackfill[0].refreshAfterImport();
  assert.equal(calls.rendered, 'chunk');
  assert.equal(calls.annotationBackfill[0].client, globalThis.__readerAppRuntimeTest.youtubeWorkflowClient);
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
  assert.equal(Object.prototype.hasOwnProperty.call(calls.publicFacades[0], 'openChunkNoteContextFromEvent'), false);

  delete globalThis.__readerAppRuntimeTest;

  console.log('reader app runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
