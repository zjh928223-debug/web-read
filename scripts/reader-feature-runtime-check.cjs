const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
    'reader-runtime should import reader feature runtime'
  );
  assert.ok(
    runtimeSource.includes('initReaderFeatureRuntime({'),
    'reader-runtime should delegate feature runtime setup'
  );
  [
    'validateMarksArray: validateMarksArray',
    'findChunkIndexByTimeHelper: findChunkIndexByTimeHelper',
    'getSegmentCheckpointsHelper: getSegmentCheckpointsHelper',
    'cleanTextHelper: cleanTextHelper',
    'tokenizeTextHelper: tokenizeTextHelper',
    'findExactMatchRangeHelper: findExactMatchRangeHelper',
    'buildVocabMatchMap: buildVocabMatchMapHelper'
  ].forEach((pattern) => {
    assert.ok(runtimeSource.includes(pattern), `reader-runtime should pass required feature helper: ${pattern}`);
  });
  [
    "import { initReaderImportRuntime } from './reader-import-runtime.js';",
    "import { initReaderControlsRuntime } from './reader-controls-runtime.js';",
    "import { initReaderInteractionRuntime } from './reader-interaction-runtime.js';",
    "import { initReaderKeyboardRuntime } from './reader-keyboard-runtime.js';",
    "import { initReaderAppRuntime } from './reader-app-runtime.js';",
    'var chunkControlsApi = null;',
    'var importRuntime = initReaderImportRuntime({',
    'var controlsRuntime = initReaderControlsRuntime({',
    'var interactionRuntime = initReaderInteractionRuntime({',
    'initReaderKeyboardRuntime({',
    'var appRuntime = initReaderAppRuntime({',
    'var forceUpdateUI'
  ].forEach((pattern) => {
    assert.equal(runtimeSource.includes(pattern), false, `reader-runtime should not own feature setup: ${pattern}`);
  });
  [
    "import { initReaderImportRuntime } from './reader-import-runtime.js';",
    "import { initReaderControlsRuntime } from './reader-controls-runtime.js';",
    "import { initReaderInteractionRuntime } from './reader-interaction-runtime.js';",
    "import { initReaderKeyboardRuntime } from './reader-keyboard-runtime.js';",
    "import { initReaderAppRuntime } from './reader-app-runtime.js';",
    'export function initReaderFeatureRuntime',
    'var chunkControlsApi = null;',
    'var forceUpdateUI;',
    'var importRuntime = initReaderImportRuntime({',
    'getChunkControlsApi: function () { return chunkControlsApi; }',
    'deps.chunkNotesApi.ensureChunkNoteOverlayLayers();',
    'var controlsRuntime = initReaderControlsRuntime({',
    'getForceUpdateUI: function () { return forceUpdateUI; }',
    'chunkControlsApi = controlsRuntime.chunkControlsApi;',
    'var interactionRuntime = initReaderInteractionRuntime({',
    'forceUpdateUI = interactionRuntime.forceUpdateUI;',
    'initReaderKeyboardRuntime({',
    'var appRuntime = initReaderAppRuntime({',
    'deps.setChunkNoteTransferApi(appRuntime.chunkNoteTransferApi);'
  ].forEach((pattern) => {
    assert.ok(featureSource.includes(pattern), `reader-feature-runtime should own ${pattern}`);
  });
  assert.equal(featureSource.includes('window.'), false, 'reader-feature-runtime should receive window through globalObject');
  assert.equal(featureSource.includes('document.'), false, 'reader-feature-runtime should not read document globals');

  [
    'setChunkNoteVisible(_ns.chunkNoteVisible, false);',
    'applyCurrentAudioMeta(audioMeta);',
    'await loadChunkNotesForCurrentAudio();',
    'await loadSentenceNotesForCurrentAudio();',
    'await switchSentenceNotesDoc(transcriptData);',
    'processTranscript(transcriptData);',
    'processChunkData(chunkData);',
    'window.toggleChunkMode(true);',
    'bridgeToPinia();'
  ].forEach((pattern) => {
    assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
  });

  const testableSource = featureSource
    .replace(
      "import { initReaderInteractionRuntime } from './reader-interaction-runtime.js';\n",
      'function initReaderInteractionRuntime(deps) { globalThis.__featureCalls.push(["interaction", deps]); return { playbackRuntimeHelpersApi: { helper: true }, forceUpdateUI() { return "updated"; }, toggleAnnotationBubble() { return "bubble"; }, handleBackwardClick() { return "back"; }, handleForwardClick() { return "forward"; } }; }\n'
    )
    .replace(
      "import { initReaderControlsRuntime } from './reader-controls-runtime.js';\n",
      'function initReaderControlsRuntime(deps) { globalThis.__featureCalls.push(["controls", deps]); return { chunkControlsApi: { chunk: true } }; }\n'
    )
    .replace(
      "import { initReaderKeyboardRuntime } from './reader-keyboard-runtime.js';\n",
      'function initReaderKeyboardRuntime(deps) { globalThis.__featureCalls.push(["keyboard", deps]); return { keyboard: true }; }\n'
    )
    .replace(
      "import { initReaderAppRuntime } from './reader-app-runtime.js';\n",
      'function initReaderAppRuntime(deps) { globalThis.__featureCalls.push(["app", deps]); return { chunkNoteTransferApi: { transfer: true } }; }\n'
    )
    .replace(
      "import { initReaderImportRuntime } from './reader-import-runtime.js';\n",
      'function initReaderImportRuntime(deps) { globalThis.__featureCalls.push(["import", deps]); return { visualVocabApi: { vocabMatchMap: new Map([[1, "vocab"]]) } }; }\n'
    );

  globalThis.__featureCalls = [];
  const transferCalls = [];
  const chunkNotesApi = {
    ensureChunkNoteOverlayLayers() { globalThis.__featureCalls.push(['ensure-overlays']); },
    closeChunkNoteContextMenu() {},
    closeChunkNotePopover() {},
    clearChunkNoteConnectors() {},
    adjustChunkNoteArrowSizeByGap() {},
    renderAllChunkNoteTags() {},
    scheduleChunkNoteConnectorRedraw() {},
    refreshAllChunkNoteVisuals() {},
    handleChunkSelectionContextMenu() { return 'context'; },
    tryRestoreChunkNoteDraft() {}
  };
  const globalObject = {
    __importModule: { id: 'import-module' },
    __styleEditor: { id: 'style-editor' },
    __themeStore: { id: 'theme-store' },
    __lockChunkNoteDimensionsForTheme: () => 'lock',
    __playbackModule: { id: 'playback-module' },
    __buildClozeQuizMarkup: () => '<quiz>',
    __clozeCheck: (index) => `check-${index}`,
    __keyboardModule: { id: 'keyboard-module' },
    __marksStore: { id: 'marks-store' },
    __annotationLightweightModule: { id: 'annotation-lightweight' },
    __appHandlers: { id: 'app-handlers' },
    __controlsModule: { id: 'controls-module' },
    getSelection: () => ({ text: 'selection' })
  };

  const encodedSource = Buffer.from(testableSource, 'utf8').toString('base64');
  const { initReaderFeatureRuntime } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const api = initReaderFeatureRuntime({
    globalObject,
    runtimeState: {},
    transcriptState: {},
    chunkState: {},
    clozeState: {},
    playbackState: {},
    audioIdentityApi: {},
    hotkeyStateApi: {},
    marksStateApi: { markedMap: new Map([[1, true]]) },
    chunkNotesApi,
    sentenceNotesApi: {
      hasActiveTextSelectionWithinChunk() {},
      selectSentenceFromChunkTarget() {}
    },
    notesState: {},
    setChunkNoteTransferApi(api) { transferCalls.push(api); }
  });

  assert.deepEqual(globalThis.__featureCalls.map((entry) => entry[0]), [
    'import',
    'ensure-overlays',
    'controls',
    'interaction',
    'keyboard',
    'app'
  ]);
  const importDeps = globalThis.__featureCalls[0][1];
  const controlsDeps = globalThis.__featureCalls[2][1];
  const interactionDeps = globalThis.__featureCalls[3][1];
  const keyboardDeps = globalThis.__featureCalls[4][1];
  const appDeps = globalThis.__featureCalls[5][1];

  assert.equal(importDeps.importModule, globalObject.__importModule);
  assert.equal(importDeps.forceUpdateUI, undefined, 'import runtime should preserve the previous early undefined forceUpdateUI value');
  assert.deepEqual(importDeps.getChunkControlsApi(), { chunk: true });
  assert.equal(controlsDeps.styleEditor, globalObject.__styleEditor);
  assert.equal(controlsDeps.themeStore, globalObject.__themeStore);
  assert.equal(controlsDeps.getForceUpdateUI(), api.forceUpdateUI);
  assert.equal(interactionDeps.vocabMatchMap.get(1), 'vocab');
  assert.deepEqual(keyboardDeps.chunkControlsApi, { chunk: true });
  assert.equal(appDeps.playbackRuntimeHelpersApi.helper, true);
  assert.equal(appDeps.forceUpdateUI, api.forceUpdateUI);
  assert.deepEqual(transferCalls, [{ transfer: true }]);
  assert.equal(api.chunkControlsApi.chunk, true);
  assert.equal(api.appRuntime.chunkNoteTransferApi.transfer, true);

  console.log('reader feature runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
