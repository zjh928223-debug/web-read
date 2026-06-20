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
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

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
    'var notesState = notesModule.getNotesState()',
    'var bridgeToPinia = initPiniaBridge({',
    'chunkNotesApi = notesModule.initChunkNotes({',
    'var sentenceNotesApi = notesModule.initSentenceNotes({'
  ].forEach((pattern) => {
    assert.ok(notesRuntimeSource.includes(pattern), `reader-notes-runtime should own ${pattern}`);
  });
  assert.equal(notesRuntimeSource.includes('window.'), false, 'reader-notes-runtime should not read or write window globals');
  assert.equal(notesRuntimeSource.includes('document.'), false, 'reader-notes-runtime should not read document globals');

  [
    'setChunkNoteVisible(_ns.chunkNoteVisible, false);',
    'applyCurrentAudioMeta(audioMeta);',
    'await loadChunkNotesForCurrentAudio();',
    'await loadSentenceNotesForCurrentAudio();',
    'await switchSentenceNotesDoc(transcriptData);'
  ].forEach((pattern) => {
    assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
  });

  const testableSource = notesRuntimeSource.replace(
    "import { initPiniaBridge } from './pinia-bridge-module.js'\n",
    "function initPiniaBridge(deps = {}) { return function bridgeToPinia() { return deps; } }\n"
  );
  const encodedSource = Buffer.from(testableSource, 'utf8').toString('base64');
  const { initReaderNotesRuntime } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const notesState = { chunkNoteVisible: true };
  const transcriptState = { getSnapshot: () => ({ segments: [] }) };
  const chunkState = { isChunkMode: false, hasAiChunkData: true, getSnapshot: () => ({ chunks: [] }) };
  const clozeState = { getSnapshot: () => ({ cards: [] }) };
  const audioIdentityApi = {
    currentAudioKey: 'audio-key',
    getChunkNotesStorageKey: () => 'chunk-notes-key',
    getChunkNoteDraftStorageKey: () => 'draft-key',
    getSentenceNotesStorageKey: () => 'sentence-key',
    getLegacySentenceNotesStorageKey: () => 'legacy-sentence-key',
    buildCurrentSentenceDocId: () => 'sentence-doc-id'
  };
  const chunkNoteLayout = {
    sanitizeChunkNoteFontSize: () => 16,
    getChunkNoteMeasureFont: () => '16px sans-serif',
    measureChunkNoteTextBox: () => ({ width: 1, height: 1 }),
    applyChunkNoteAutoSize: () => undefined,
    buildChunkNoteLayout: () => ({}),
    canChunkNoteTextFitMinReadable: () => true,
    makeSelectionNoteBaseId: () => 'base-id',
    makeSelectionNoteId: () => 'note-id',
    findNearestChunkWord: () => null
  };

  let chunkDeps = null;
  let sentenceDeps = null;
  const chunkApi = {
    modalOpen: false,
    saved: 0,
    getChunkNoteModalEl() {
      return this.modalOpen ? {} : null;
    },
    saveChunkNoteFromModal() {
      this.saved += 1;
    }
  };
  const sentenceApi = { sentence: true };
  const notesModule = {
    getNotesState() {
      return notesState;
    },
    initChunkNotes(deps) {
      chunkDeps = deps;
      return chunkApi;
    },
    initSentenceNotes(deps) {
      sentenceDeps = deps;
      return sentenceApi;
    }
  };

  const api = initReaderNotesRuntime({
    notesModule,
    chunkNoteLayout,
    transcriptState,
    chunkState,
    clozeState,
    loadFromDB: () => 'loaded',
    saveToDB: () => 'saved',
    audioIdentityApi,
    isPlainObjectRecord: (value) => value && typeof value === 'object',
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
  });

  assert.equal(api.notesState, notesState);
  assert.equal(api.chunkNotesApi, chunkApi);
  assert.equal(api.sentenceNotesApi, sentenceApi);
  assert.equal(typeof api.bridgeToPinia, 'function', 'notes runtime should return the Pinia bridge');

  assert.equal(chunkDeps.state, notesState);
  assert.equal(chunkDeps.getChunkNotesStorageKey(), 'chunk-notes-key');
  assert.equal(chunkDeps.getChunkNoteDraftStorageKey(), 'draft-key');
  assert.equal(chunkDeps.getIsChunkMode(), false);
  assert.equal(chunkDeps.currentAudioKeyGetter(), 'audio-key');
  assert.equal(chunkDeps.getHasAiChunkData(), true);
  assert.equal(chunkDeps.sanitizeChunkNoteFontSize(), 16);
  assert.equal(chunkDeps.chunkNoteCtxMenuEl.id, 'menu');

  chunkDeps.saveOpenChunkNotePopover();
  assert.equal(chunkApi.saved, 0, 'popover saver should no-op when modal is closed');
  chunkApi.modalOpen = true;
  chunkDeps.saveOpenChunkNotePopover();
  assert.equal(chunkApi.saved, 1, 'popover saver should call module API when modal is open');

  assert.equal(sentenceDeps.state, notesState);
  assert.equal(sentenceDeps.getSentenceNotesStorageKey(), 'sentence-key');
  assert.equal(sentenceDeps.getLegacySentenceNotesStorageKey(), 'legacy-sentence-key');
  assert.equal(sentenceDeps.buildCurrentSentenceDocId(), 'sentence-doc-id');
  assert.equal(sentenceDeps.getIsChunkMode(), false);
  assert.equal(sentenceDeps.getHasAiChunkData(), true);
  assert.equal(sentenceDeps.initialNotePreviewVisible, true);
  assert.equal(sentenceDeps.initialNotePreviewWidth, 340);
  assert.equal(sentenceDeps.initialNotePreviewHeight, 640);

  console.log('reader notes runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
