const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const contextSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-context.js'), 'utf8');
  const featureDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-bootstrap-runtime.js'), 'utf8');
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
    contextSource.includes("import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';"),
    'reader-runtime-context should import reader bootstrap runtime'
  );
  assert.ok(
    contextSource.includes('var bootstrapRuntime = initReaderBootstrapRuntime({'),
    'reader-runtime-context should initialize bootstrap state through the module'
  );
  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
    'reader-runtime should use reader-runtime-assembly'
  );
  assert.ok(
    assemblySource.includes("import { initReaderRuntimeContext } from './reader-runtime-context.js';"),
    'reader-runtime-assembly should use reader-runtime-context'
  );
  assert.ok(
    assemblySource.includes('var bootstrapRuntime = runtimeContext.bootstrapRuntime;'),
    'reader-runtime-assembly should bind bootstrap state from runtime context'
  );
  [
    "import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';",
    "import { collectReaderRuntimeDeps } from './reader-runtime-deps.js';",
    "import { initAudioIdentity } from './audio-identity-module.js';",
    "import { initHotkeyState } from './hotkey-state-module.js';",
    "import { initMarksState } from './marks-state-module.js';",
    'const _tr = window.__transcriptState;',
    'const _ch = window.__chunkState;',
    'const _clz = window.__clozeState;',
    'const _pb = window.__playbackState;',
    'var saveToDB = function (id, data) { return window.__audioStore.saveToDB(id, data); };',
    'var loadFromDB = function (id) { return window.__audioStore.loadFromDB(id); };',
    '} = collectReaderRuntimeDeps({',
    'var audioIdentityApi = initAudioIdentity({',
    'var hotkeyStateApi = initHotkeyState();',
    'var marksStateApi = initMarksState();'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own bootstrap setup directly: ${pattern}`
    );
  });
  [
    'const transcriptState = bootstrapRuntime.transcriptState;',
    'const chunkState = bootstrapRuntime.chunkState;',
    'const clozeState = bootstrapRuntime.clozeState;',
    'const playbackState = bootstrapRuntime.playbackState;',
    'var saveToDB = bootstrapRuntime.saveToDB;',
    'var loadFromDB = bootstrapRuntime.loadFromDB;',
    '} = bootstrapRuntime.runtimeDeps;',
    'var audioIdentityApi = bootstrapRuntime.audioIdentityApi;',
    'var hotkeyStateApi = bootstrapRuntime.hotkeyStateApi;',
    'var marksStateApi = bootstrapRuntime.marksStateApi;'
  ].forEach((pattern) => {
    assert.equal(shellSource.includes(pattern), false, `reader-runtime-assembly should not bind bootstrap result directly: ${pattern}`);
  });
  [
    'transcriptState: bootstrap.transcriptState',
    'chunkState: bootstrap.chunkState',
    'playbackState: bootstrap.playbackState',
    'hotkeyStateApi: bootstrap.hotkeyStateApi',
    'marksStateApi: bootstrap.marksStateApi'
  ].forEach((pattern) => {
    assert.ok(featureDepsSource.includes(pattern), `reader-feature-runtime-deps should consume bootstrap result: ${pattern}`);
  });

  [
    "import { collectReaderRuntimeDeps } from './reader-runtime-deps.js';",
    "import { initAudioIdentity } from './audio-identity-module.js';",
    "import { initHotkeyState } from './hotkey-state-module.js';",
    "import { initMarksState } from './marks-state-module.js';",
    'export function initReaderBootstrapRuntime',
    'var transcriptState = globalObject.__transcriptState;',
    'var chunkState = globalObject.__chunkState;',
    'var playbackState = globalObject.__playbackState;',
    'return audioStore.saveToDB(id, data);',
    'return audioStore.loadFromDB(id);',
    'var runtimeDeps = collectReaderRuntimeDeps({',
    'var audioIdentityApi = initAudioIdentity({',
    'hotkeyStateApi: initHotkeyState()',
    'marksStateApi: initMarksState()'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `reader-bootstrap-runtime should own ${pattern}`);
  });
  assert.ok(
    moduleSource.includes('globalObject.__vocabularyPreviewController') &&
      moduleSource.includes('previewController.refreshAvailability();'),
    'reader-bootstrap-runtime should refresh vocabulary preview controls when the current article changes'
  );
  assert.equal(moduleSource.includes('window.'), false, 'reader-bootstrap-runtime should receive window through explicit deps');
  assert.equal(moduleSource.includes('document.'), false, 'reader-bootstrap-runtime should not read document globals');

  [
    'applyCurrentAudioMeta(audioMeta);',
    'deps.processTranscript(transcriptData);',
    'deps.processChunkData(chunkData);',
    'deps.bridgeToPinia();'
  ].forEach((pattern) => {
    assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
  });
  const startupSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-startup-runtime.js'), 'utf8');
  assert.equal(startupSource.includes('deps.restoreSession('), false, 'normal startup must leave saved articles unopened');
  assert.equal(startupSource.includes('toggleChunkMode('), false, 'normal startup must not restore the previous article mode');

  const testableSource = moduleSource
    .replace(
      "import { collectReaderRuntimeDeps } from './reader-runtime-deps.js';\n",
      'function collectReaderRuntimeDeps(deps) { globalThis.__runtimeDepsInput = deps; return globalThis.__runtimeDepsResult }\n'
    )
    .replace(
      "import { initAudioIdentity } from './audio-identity-module.js';\n",
      'function initAudioIdentity(deps) { globalThis.__audioIdentityInput = deps; return { currentAudioKey: "audio-key" } }\n'
    )
    .replace(
      "import { initHotkeyState } from './hotkey-state-module.js';\n",
      'function initHotkeyState() { globalThis.__hotkeyInitCount = (globalThis.__hotkeyInitCount || 0) + 1; return { markKey: "m" } }\n'
    )
    .replace(
      "import { initMarksState } from './marks-state-module.js';\n",
      'function initMarksState() { globalThis.__marksInitCount = (globalThis.__marksInitCount || 0) + 1; return { markedMap: new Map([[1, true]]) } }\n'
    )
    .replace(
      "import { initPiniaBridge } from './pinia-bridge-module.js';\n",
      'function initPiniaBridge(deps) { globalThis.__bridgeInput = deps; return function bridgeToPinia() {} }\n'
    )
    .replace(
      "import { requirePiniaRuntimeStores } from '../pinia-stores/runtime-registry.js';\n",
      'function requirePiniaRuntimeStores() { return globalThis.__runtimeStores }\n'
    );

  globalThis.__runtimeDepsInput = null;
  globalThis.__audioIdentityInput = null;
  globalThis.__hotkeyInitCount = 0;
  globalThis.__marksInitCount = 0;
  globalThis.__runtimeDepsResult = {
    buildAudioKey: () => 'build-audio',
    buildCurrentAudioMetaState: () => ({ meta: true }),
    getCurrentAudioFilenameBase: () => 'lesson',
    getChunkNotesStorageKey: () => 'chunk-notes-key',
    getChunkNoteDraftStorageKey: () => 'draft-key',
    getSentenceNotesStorageKey: () => 'sentence-key',
    getLegacySentenceNotesStorageKey: () => 'legacy-key',
    buildCurrentSentenceDocId: () => 'doc-id'
  };

  const encodedSource = Buffer.from(testableSource, 'utf8').toString('base64');
  const { initReaderBootstrapRuntime } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const calls = [];
  globalThis.__runtimeStores = { audio: {
    saveToDB(id, data) { calls.push(['save', id, data]); return 'saved'; },
    loadFromDB(id) { calls.push(['load', id]); return 'loaded'; }
  } };
  const fakeWindow = {
    __transcriptState: { segments: [{ id: 's1' }] },
    __chunkState: { chunkItems: [] },
    __playbackState: { autoFollow: true }
  };
  const api = initReaderBootstrapRuntime({
    getWindow: () => fakeWindow
  });

  assert.equal(api.transcriptState, fakeWindow.__transcriptState);
  assert.equal(api.chunkState, fakeWindow.__chunkState);
  assert.equal(Object.hasOwn(api, 'clozeState'), false);
  assert.deepEqual(Object.keys(globalThis.__bridgeInput).sort(), ['chunkState', 'transcriptState']);
  assert.doesNotMatch(moduleSource, /clozeState|__clozeState/);
  assert.equal(api.playbackState, fakeWindow.__playbackState);
  assert.equal(api.saveToDB('marks', [1]), 'saved');
  assert.equal(api.loadFromDB('marks'), 'loaded');
  assert.deepEqual(calls, [['save', 'marks', [1]], ['load', 'marks']]);
  assert.equal(globalThis.__runtimeDepsInput.transcriptState, fakeWindow.__transcriptState);
  assert.equal(globalThis.__runtimeDepsInput.getWindow(), fakeWindow);
  assert.equal(api.runtimeDeps, globalThis.__runtimeDepsResult);
  assert.equal(globalThis.__audioIdentityInput.buildAudioKey(), 'build-audio');
  assert.equal(globalThis.__audioIdentityInput.getSegments(), fakeWindow.__transcriptState.segments);
  assert.equal(api.audioIdentityApi.currentAudioKey, 'audio-key');
  assert.deepEqual(api.hotkeyStateApi, { markKey: 'm' });
  assert.equal(api.marksStateApi.markedMap.get(1), true);
  assert.equal(globalThis.__hotkeyInitCount, 1);
  assert.equal(globalThis.__marksInitCount, 1);
  fakeWindow.__annotationBackfillAiController = {
    refreshAvailability() {
      calls.push(['refresh-annotation-backfill']);
    }
  };
  fakeWindow.__vocabularyPreviewController = {
    refreshAvailability() {
      calls.push(['refresh-vocabulary-preview']);
    }
  };
  const projectedMeta = { name: 'Material.audio', jobId: 'material' };
  globalThis.__audioIdentityInput.onCurrentAudioMetaChange(projectedMeta);
  assert.equal(globalThis.__runtimeStores.audio.currentAudioMeta, projectedMeta, 'reader title should observe the existing audio identity');
  assert.deepEqual(calls.slice(-2), [['refresh-annotation-backfill'], ['refresh-vocabulary-preview']]);
  globalThis.__audioIdentityInput.onCurrentAudioMetaChange(null);
  assert.equal(globalThis.__runtimeStores.audio.currentAudioMeta, null, 'clearing the identity should clear its title projection');

  console.log('reader bootstrap runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
