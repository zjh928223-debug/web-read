const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'src', 'composables', 'notes-module.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const sandbox = {
  window: {},
  console,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  Number,
  String,
  Object,
  Array,
};

vm.runInNewContext(source, sandbox, { filename: sourcePath });

const notesModule = sandbox.window.__notesModule;
assert.ok(notesModule, 'notes module should attach to window');

const state = {
  chunkNotesMap: {},
  chunkNoteVisible: false,
  chunkNoteSaveTimer: null,
  activeChunkNoteId: '',
  selectedChunkNoteId: '',
  pendingChunkSelectionCtx: null,
};

let fileState = {
  handle: null,
  audioKey: '',
  fileName: '',
};

const api = notesModule.initChunkNotes({
  state,
  loadFromDB: async () => null,
  saveToDB: () => {},
  getChunkNotesStorageKey: () => 'chunkNotes::audio',
  sanitizeChunkNoteFontSize: (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 16;
  },
  getIsChunkMode: () => false,
  currentAudioKeyGetter: () => 'audio-key',
  makeSelectionNoteBaseId: (chunkRef, startGlobal, endGlobal) => `${chunkRef}::${startGlobal}-${endGlobal}`,
  makeSelectionNoteId: (chunkRef, startGlobal, endGlobal) => `${chunkRef}::${startGlobal}-${endGlobal}::new`,
  now: () => 123456,
  getChunkNotesFileState: () => fileState,
  setChunkNotesFileState: (next) => {
    fileState = { ...fileState, ...next };
  },
});

[
  'getChunkNotesMap',
  'replaceChunkNotesMap',
  'getChunkNote',
  'getChunkNotesForRef',
  'upsertChunkNote',
  'deleteChunkNote',
  'applyImportedChunkNotes',
  'getChunkNotesFileState',
  'setChunkNotesFileState',
  'clearChunkNotesFileState',
].forEach((name) => {
  assert.equal(typeof api[name], 'function', `${name} should be exposed`);
});

api.applyImportedChunkNotes({
  notes: [
    {
      id: 'note-a',
      chunkRef: 'chunk-a',
      chunkIdx: '2',
      startGlobal: '10',
      endGlobal: '11',
      selectedText: ' selected ',
      note: ' imported note ',
      coordSpace: 'main',
      x: '101',
      y: '33',
      offsetX: '5',
      offsetY: '6',
      w: '88',
      h: '44',
      autoSize: false,
      fontSize: '13',
      color: ' #123456 ',
      updatedAt: '999',
    },
    { chunkRef: '', startGlobal: 1, endGlobal: 1, note: 'invalid' },
  ],
});

assert.deepEqual(Object.keys(state.chunkNotesMap), ['note-a']);
assert.equal(state.chunkNotesMap['note-a'].note, 'imported note');
assert.equal(state.chunkNotesMap['note-a'].startGlobal, 10);
assert.equal(state.chunkNotesMap['note-a'].endGlobal, 11);
assert.equal(state.chunkNotesMap['note-a'].autoSize, false);
assert.equal(state.chunkNotesMap['note-a'].fontSize, 13);
assert.equal(state.chunkNotesMap['note-a'].color, '#123456');

const insertedId = api.upsertChunkNote({
  noteId: 'note-b',
  chunkRef: 'chunk-b',
  chunkIdx: 3,
  startGlobal: 20,
  endGlobal: 20,
  selectedText: 'word',
}, 'new note', {
  minW: 40,
  minH: 18,
  margin: 12,
  areaW: 500,
  areaH: 300,
  anchorRect: { left: 100, top: 50, right: 125 },
  autoSize: (note) => {
    note.w = note.w || 77;
    note.h = note.h || 22;
    note.fontSize = note.fontSize || 14;
  },
});

assert.equal(insertedId, 'note-b');
assert.equal(state.chunkNotesMap['note-b'].note, 'new note');
assert.equal(state.chunkNotesMap['note-b'].updatedAt, 123456);
assert.equal(state.chunkNotesMap['note-b'].coordSpace, 'main');
assert.equal(state.chunkNotesMap['note-b'].offsetX, state.chunkNotesMap['note-b'].x - 100);
assert.equal(state.chunkNotesMap['note-b'].fontSize, 14);

state.chunkNotesMap['note-b'].x = 200;
state.chunkNotesMap['note-b'].y = 90;
state.chunkNotesMap['note-b'].offsetX = 8;
state.chunkNotesMap['note-b'].offsetY = 9;
state.chunkNotesMap['note-b'].w = 66;
state.chunkNotesMap['note-b'].h = 30;
state.chunkNotesMap['note-b'].fontSize = 12;

api.upsertChunkNote({
  noteId: 'note-b',
  chunkRef: 'chunk-b',
  chunkIdx: 3,
  startGlobal: 20,
  endGlobal: 20,
}, 'updated note');

assert.equal(state.chunkNotesMap['note-b'].note, 'updated note');
assert.equal(state.chunkNotesMap['note-b'].x, 200);
assert.equal(state.chunkNotesMap['note-b'].offsetX, 8);
assert.equal(state.chunkNotesMap['note-b'].w, 66);
assert.equal(state.chunkNotesMap['note-b'].fontSize, 12);

assert.equal(api.getChunkNotesForRef('chunk-b').length, 1);
assert.equal(api.deleteChunkNote('note-b').id, 'note-b');
assert.equal(api.getChunkNote('note-b'), null);

api.setChunkNotesFileState({ handle: 'handle-1', audioKey: 'audio-key', fileName: 'notes.json' });
let currentFileState = api.getChunkNotesFileState();
assert.equal(currentFileState.handle, 'handle-1');
assert.equal(currentFileState.audioKey, 'audio-key');
assert.equal(currentFileState.fileName, 'notes.json');
api.clearChunkNotesFileState();
currentFileState = api.getChunkNotesFileState();
assert.equal(currentFileState.handle, null);
assert.equal(currentFileState.audioKey, '');
assert.equal(currentFileState.fileName, '');

console.log('chunk notes state check passed');
