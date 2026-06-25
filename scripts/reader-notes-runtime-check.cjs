const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const notesSessionRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-notes-session-runtime.js'), 'utf8');
  const notesRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-notes-runtime.js'), 'utf8');
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
    'reader-runtime should delegate reader notes runtime through reader-runtime-assembly'
  );
  assert.ok(
    assemblySource.includes("import { initReaderNotesSessionRuntime } from './reader-notes-session-runtime.js';"),
    'reader-runtime-assembly should initialize reader notes runtime through reader notes/session runtime'
  );
  assert.ok(
    assemblySource.includes('var notesSessionRuntime = initReaderNotesSessionRuntime(createReaderNotesSessionRuntimeDeps({'),
    'reader-runtime-assembly should initialize notes runtime through the notes/session module'
  );
  assert.equal(
    runtimeSource.includes("import { initReaderNotesRuntime } from './reader-notes-runtime.js';"),
    false,
    'reader-runtime should not import reader notes runtime directly'
  );
  assert.equal(
    runtimeSource.includes('var notesRuntime = initReaderNotesRuntime({'),
    false,
    'reader-runtime should not initialize notes runtime directly'
  );
  assert.ok(
    notesSessionRuntimeSource.includes("import { initReaderNotesRuntime } from './reader-notes-runtime.js';"),
    'reader-notes-session-runtime should import reader notes runtime module'
  );
  assert.ok(
    notesSessionRuntimeSource.includes('var notesRuntime = initReaderNotesRuntime({'),
    'reader-notes-session-runtime should initialize notes runtime through the module'
  );
  [
    'window.__notesModule.getNotesState()',
    'window.__notesModule.initChunkNotes',
    'window.__notesModule.initSentenceNotes',
    'initPiniaBridge({',
    'sanitizeChunkNoteFontSize: window.__chunkNoteLayout.sanitizeChunkNoteFontSize',
    'saveOpenChunkNotePopover: function ()'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own notes runtime setup: ${pattern}`
    );
  });

  [
    'export function initReaderNotesRuntime',
    "import { initPiniaBridge } from './pinia-bridge-module.js'",
    'function createDisabledChunkNotesApi()',
    'function createDisabledSentenceNotesApi()',
    'var bridgeToPinia = initPiniaBridge({',
    'chunkNotesApi: createDisabledChunkNotesApi()',
    'sentenceNotesApi: createDisabledSentenceNotesApi()'
  ].forEach((pattern) => {
    assert.ok(notesRuntimeSource.includes(pattern), `reader-notes-runtime should own ${pattern}`);
  });
  [
    'notesModule.getNotesState',
    'notesModule.initChunkNotes',
    'notesModule.initSentenceNotes',
    'chunkNoteLayout',
    'selectSentenceFromChunkTarget'
  ].forEach((pattern) => {
    assert.equal(notesRuntimeSource.includes(pattern), false, `retired notes runtime dependency should stay removed: ${pattern}`);
  });
  assert.equal(notesRuntimeSource.includes('window.'), false, 'reader-notes-runtime should not read or write window globals');
  assert.equal(notesRuntimeSource.includes('document.'), false, 'reader-notes-runtime should not read document globals');

  [
    'applyCurrentAudioMeta(audioMeta);',
    'await deps.loadChunkNotesForCurrentAudio();',
    'await deps.loadSentenceNotesForCurrentAudio();',
    'await deps.switchSentenceNotesDoc(transcriptData);'
  ].forEach((pattern) => {
    assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
  });

  const testableSource = notesRuntimeSource.replace(
    "import { initPiniaBridge } from './pinia-bridge-module.js'\n",
    "function initPiniaBridge(deps = {}) { return function bridgeToPinia() { return deps; } }\n"
  );
  const encodedSource = Buffer.from(testableSource, 'utf8').toString('base64');
  const { initReaderNotesRuntime } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const transcriptState = { getSnapshot: () => ({ segments: [] }) };
  const chunkState = { isChunkMode: false, hasAiChunkData: true, getSnapshot: () => ({ chunks: [] }) };
  const clozeState = { getSnapshot: () => ({ cards: [] }) };

  const api = initReaderNotesRuntime({
    transcriptState,
    chunkState,
    clozeState
  });

  assert.deepEqual(api.notesState, {
    chunkNotesMap: {},
    chunkNoteVisible: false,
    sentenceNotesMap: {},
    allSentenceNotesByDoc: {},
    currentDocId: '',
    selectedSentence: null
  });
  assert.equal(typeof api.bridgeToPinia, 'function', 'notes runtime should return the Pinia bridge');
  assert.deepEqual(api.chunkNotesApi.listChunkNotes(), []);
  assert.equal(api.chunkNotesApi.getChunkNoteTagById(), null);
  assert.equal(api.chunkNotesApi.getChunkNoteContentBoxSize(), null);
  assert.equal(api.chunkNotesApi.handleChunkSelectionContextMenu(), false);
  assert.equal(api.chunkNotesApi.setChunkNoteVisible(), false);
  assert.deepEqual(await api.chunkNotesApi.loadChunkNotesForCurrentAudio(), {});
  assert.deepEqual(await api.sentenceNotesApi.loadSentenceNotesForCurrentAudio(), {});
  assert.deepEqual(await api.sentenceNotesApi.switchSentenceNotesDoc(), {});
  assert.equal(api.sentenceNotesApi.hasActiveTextSelectionWithinChunk(), false);

  console.log('reader notes runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
