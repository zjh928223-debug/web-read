const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-notes-session-runtime.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeShell } from './reader-runtime-shell.js';"),
    'reader-runtime should delegate notes/session through reader runtime shell'
  );
  assert.ok(
    shellSource.includes("import { initReaderNotesSessionRuntime } from './reader-notes-session-runtime.js';"),
    'reader-runtime-shell should import reader notes/session runtime'
  );
  assert.ok(
    shellSource.includes('var notesSessionRuntime = initReaderNotesSessionRuntime({'),
    'reader-runtime-shell should initialize notes/session through the combined module'
  );
  assert.equal(
    runtimeSource.includes("import { initReaderNotesRuntime } from './reader-notes-runtime.js';"),
    false,
    'reader-runtime should not import reader notes runtime directly'
  );
  assert.equal(
    runtimeSource.includes("import { initReaderSessionRuntime } from './reader-session-runtime.js';"),
    false,
    'reader-runtime should not import reader session runtime directly'
  );
  assert.equal(runtimeSource.includes('var notesRuntime = initReaderNotesRuntime({'), false);
  assert.equal(runtimeSource.includes('var sessionRuntime = initReaderSessionRuntime({'), false);

  [
    'var notesState = notesSessionRuntime.notesState;',
    'var bridgeToPinia = notesSessionRuntime.bridgeToPinia;',
    'var chunkNotesApi = notesSessionRuntime.chunkNotesApi;',
    'var sentenceNotesApi = notesSessionRuntime.sentenceNotesApi;',
    'var loadChunkNotesForCurrentAudio = notesSessionRuntime.loadChunkNotesForCurrentAudio;',
    'var setChunkNoteVisible = notesSessionRuntime.setChunkNoteVisible;',
    'var loadSentenceNotesForCurrentAudio = notesSessionRuntime.loadSentenceNotesForCurrentAudio;',
    'var switchSentenceNotesDoc = notesSessionRuntime.switchSentenceNotesDoc;',
    'var applyCurrentAudioMeta = notesSessionRuntime.applyCurrentAudioMeta;'
  ].forEach((pattern) => {
    assert.ok(shellSource.includes(pattern), `reader-runtime-shell should bind notes/session result: ${pattern}`);
  });

  [
    "import { initReaderNotesRuntime } from './reader-notes-runtime.js';",
    "import { initReaderSessionRuntime } from './reader-session-runtime.js';",
    'export function initReaderNotesSessionRuntime',
    'var notesRuntime = initReaderNotesRuntime({',
    'var sessionRuntime = initReaderSessionRuntime({',
    'chunkNotesApi: notesRuntime.chunkNotesApi',
    'sentenceNotesApi: notesRuntime.sentenceNotesApi',
    'notesState: notesRuntime.notesState',
    'bridgeToPinia: notesRuntime.bridgeToPinia',
    'loadChunkNotesForCurrentAudio: sessionRuntime.loadChunkNotesForCurrentAudio',
    'applyCurrentAudioMeta: sessionRuntime.applyCurrentAudioMeta'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `reader-notes-session-runtime should own ${pattern}`);
  });
  assert.equal(moduleSource.includes('window.'), false, 'reader-notes-session-runtime should receive window globals through deps');
  assert.equal(moduleSource.includes('document.'), false, 'reader-notes-session-runtime should not read document globals');

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
      "import { initReaderNotesRuntime } from './reader-notes-runtime.js';\n",
      'function initReaderNotesRuntime(deps) { globalThis.__notesRuntimeDeps = deps; return { notesState: { visible: true }, bridgeToPinia: () => "bridge", chunkNotesApi: { chunk: true }, sentenceNotesApi: { sentence: true } } }\n'
    )
    .replace(
      "import { initReaderSessionRuntime } from './reader-session-runtime.js';\n",
      'function initReaderSessionRuntime(deps) { globalThis.__sessionRuntimeDeps = deps; return { loadChunkNotesForCurrentAudio: () => "load-chunk", setChunkNoteVisible: () => "visible", loadSentenceNotesForCurrentAudio: () => "load-sentence", switchSentenceNotesDoc: () => "switch", applyCurrentAudioMeta: () => "audio" } }\n'
    );

  globalThis.__notesRuntimeDeps = null;
  globalThis.__sessionRuntimeDeps = null;

  const encodedSource = Buffer.from(testableSource, 'utf8').toString('base64');
  const { initReaderNotesSessionRuntime } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const deps = {
    notesModule: { id: 'notes' },
    chunkNoteLayout: { id: 'layout' },
    transcriptState: { id: 'transcript' },
    chunkState: { id: 'chunk' },
    clozeState: { id: 'cloze' },
    loadFromDB: () => 'load-db',
    saveToDB: () => 'save-db',
    audioIdentityApi: { currentAudioKey: 'audio-key' },
    isPlainObjectRecord: () => true,
    mainAppArea: { id: 'main' },
    chunkNoteSvgLayer: { id: 'svg' },
    chunkNoteLayer: { id: 'layer' },
    chunkNoteCtxMenu: { id: 'menu' },
    notePreviewSidebar: { id: 'sidebar' },
    notePreviewEmpty: { id: 'empty' },
    notePreviewList: { id: 'list' },
    toggleNotePreviewBtn: { id: 'toggle' },
    notePreviewResizeHandle: { id: 'resize-x' },
    notePreviewResizeHandleY: { id: 'resize-y' }
  };
  const api = initReaderNotesSessionRuntime(deps);

  assert.equal(globalThis.__notesRuntimeDeps.notesModule, deps.notesModule);
  assert.equal(globalThis.__notesRuntimeDeps.chunkNoteLayout, deps.chunkNoteLayout);
  assert.equal(globalThis.__notesRuntimeDeps.transcriptState, deps.transcriptState);
  assert.equal(globalThis.__notesRuntimeDeps.audioIdentityApi, deps.audioIdentityApi);
  assert.equal(globalThis.__notesRuntimeDeps.notePreviewResizeHandleY, deps.notePreviewResizeHandleY);
  assert.deepEqual(globalThis.__sessionRuntimeDeps.chunkNotesApi, { chunk: true });
  assert.deepEqual(globalThis.__sessionRuntimeDeps.sentenceNotesApi, { sentence: true });
  assert.equal(globalThis.__sessionRuntimeDeps.audioIdentityApi, deps.audioIdentityApi);
  assert.deepEqual(api.notesState, { visible: true });
  assert.equal(api.bridgeToPinia(), 'bridge');
  assert.deepEqual(api.chunkNotesApi, { chunk: true });
  assert.deepEqual(api.sentenceNotesApi, { sentence: true });
  assert.equal(api.loadChunkNotesForCurrentAudio(), 'load-chunk');
  assert.equal(api.setChunkNoteVisible(), 'visible');
  assert.equal(api.loadSentenceNotesForCurrentAudio(), 'load-sentence');
  assert.equal(api.switchSentenceNotesDoc(), 'switch');
  assert.equal(api.applyCurrentAudioMeta(), 'audio');

  console.log('reader notes session runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
