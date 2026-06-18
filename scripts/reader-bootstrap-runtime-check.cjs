const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-bootstrap-runtime.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';"),
    'reader-runtime should import reader bootstrap runtime'
  );
  assert.ok(
    runtimeSource.includes('var bootstrapRuntime = initReaderBootstrapRuntime({'),
    'reader-runtime should initialize bootstrap state through the module'
  );
  [
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
    'const _tr = bootstrapRuntime.transcriptState;',
    'const _ch = bootstrapRuntime.chunkState;',
    'const _clz = bootstrapRuntime.clozeState;',
    'const _pb = bootstrapRuntime.playbackState;',
    'var saveToDB = bootstrapRuntime.saveToDB;',
    'var loadFromDB = bootstrapRuntime.loadFromDB;',
    '} = bootstrapRuntime.runtimeDeps;',
    'var audioIdentityApi = bootstrapRuntime.audioIdentityApi;',
    'var hotkeyStateApi = bootstrapRuntime.hotkeyStateApi;',
    'var marksStateApi = bootstrapRuntime.marksStateApi;'
  ].forEach((pattern) => {
    assert.ok(runtimeSource.includes(pattern), `reader-runtime should bind bootstrap result: ${pattern}`);
  });

  [
    "import { collectReaderRuntimeDeps } from './reader-runtime-deps.js';",
    "import { initAudioIdentity } from './audio-identity-module.js';",
    "import { initHotkeyState } from './hotkey-state-module.js';",
    "import { initMarksState } from './marks-state-module.js';",
    'export function initReaderBootstrapRuntime',
    'var transcriptState = globalObject.__transcriptState;',
    'var chunkState = globalObject.__chunkState;',
    'var clozeState = globalObject.__clozeState;',
    'var playbackState = globalObject.__playbackState;',
    'return getWindow().__audioStore.saveToDB(id, data);',
    'return getWindow().__audioStore.loadFromDB(id);',
    'var runtimeDeps = collectReaderRuntimeDeps({',
    'var audioIdentityApi = initAudioIdentity({',
    'hotkeyStateApi: initHotkeyState()',
    'marksStateApi: initMarksState()'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `reader-bootstrap-runtime should own ${pattern}`);
  });
  assert.equal(moduleSource.includes('window.'), false, 'reader-bootstrap-runtime should receive window through explicit deps');
  assert.equal(moduleSource.includes('document.'), false, 'reader-bootstrap-runtime should not read document globals');

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

  const testableSource = moduleSource
    .replace(
      "import { collectReaderRuntimeDeps } from './reader-runtime-deps.js';\n",
      'function collectReaderRuntimeDeps(deps) { globalThis.__runtimeDepsInput = deps; return globalThis.__runtimeDepsResult }\n'
    )
    .replace(
      "import { initAudioIdentity } from './audio-identity-module.js';\n",
      'function initAudioIdentity(deps) { globalThis.__audioIdentityInput = deps; return { currentAudioKey: "audio-key", getChunkNotesStorageKey: deps.getChunkNotesStorageKey } }\n'
    )
    .replace(
      "import { initHotkeyState } from './hotkey-state-module.js';\n",
      'function initHotkeyState() { globalThis.__hotkeyInitCount = (globalThis.__hotkeyInitCount || 0) + 1; return { markKey: "m" } }\n'
    )
    .replace(
      "import { initMarksState } from './marks-state-module.js';\n",
      'function initMarksState() { globalThis.__marksInitCount = (globalThis.__marksInitCount || 0) + 1; return { markedMap: new Map([[1, true]]) } }\n'
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
  const fakeWindow = {
    __transcriptState: { segments: [{ id: 's1' }] },
    __chunkState: { chunkItems: [] },
    __clozeState: { clozeItems: [] },
    __playbackState: { autoFollow: true },
    __audioStore: {
      saveToDB(id, data) {
        calls.push(['save', id, data]);
        return 'saved';
      },
      loadFromDB(id) {
        calls.push(['load', id]);
        return 'loaded';
      }
    }
  };
  const api = initReaderBootstrapRuntime({
    getWindow: () => fakeWindow
  });

  assert.equal(api.transcriptState, fakeWindow.__transcriptState);
  assert.equal(api.chunkState, fakeWindow.__chunkState);
  assert.equal(api.clozeState, fakeWindow.__clozeState);
  assert.equal(api.playbackState, fakeWindow.__playbackState);
  assert.equal(api.saveToDB('marks', [1]), 'saved');
  assert.equal(api.loadFromDB('marks'), 'loaded');
  assert.deepEqual(calls, [['save', 'marks', [1]], ['load', 'marks']]);
  assert.equal(globalThis.__runtimeDepsInput.transcriptState, fakeWindow.__transcriptState);
  assert.equal(globalThis.__runtimeDepsInput.getWindow(), fakeWindow);
  assert.equal(api.runtimeDeps, globalThis.__runtimeDepsResult);
  assert.equal(globalThis.__audioIdentityInput.buildAudioKey(), 'build-audio');
  assert.equal(globalThis.__audioIdentityInput.getChunkNotesStorageKey(), 'chunk-notes-key');
  assert.equal(globalThis.__audioIdentityInput.getSegments(), fakeWindow.__transcriptState.segments);
  assert.equal(api.audioIdentityApi.currentAudioKey, 'audio-key');
  assert.deepEqual(api.hotkeyStateApi, { markKey: 'm' });
  assert.equal(api.marksStateApi.markedMap.get(1), true);
  assert.equal(globalThis.__hotkeyInitCount, 1);
  assert.equal(globalThis.__marksInitCount, 1);

  console.log('reader bootstrap runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
