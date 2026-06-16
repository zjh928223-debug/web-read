const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'src', 'composables', 'notes-module.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const sandbox = {
  window: {
    innerWidth: 1024,
    innerHeight: 768,
    getSelection() {
      return null;
    },
  },
  localStorage: {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(sandbox.__localStorage, key)
        ? sandbox.__localStorage[key]
        : null;
    },
    setItem(key, value) {
      sandbox.__localStorage[key] = String(value);
    },
    removeItem(key) {
      delete sandbox.__localStorage[key];
    },
  },
  document: {
    querySelectorAll(selector) {
      if (selector === '.chunk-block') return sandbox.__chunkBlocks;
      if (selector !== '.chunk-note-tag.selected') return [];
      return sandbox.__selectedEls;
    },
    getElementById(id) {
      return sandbox.__elementsById[id] || null;
    },
  },
  __selectedEls: [],
  __chunkBlocks: [],
  __elementsById: {},
  __localStorage: {},
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
let isChunkMode = false;
let hasAiChunkData = true;

const api = notesModule.initChunkNotes({
  state,
  loadFromDB: async () => null,
  saveToDB: () => {},
  getChunkNotesStorageKey: () => 'chunkNotes::audio',
  getChunkNoteDraftStorageKey: () => 'chunkNoteDraft::audio',
  sanitizeChunkNoteFontSize: (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 16;
  },
  getIsChunkMode: () => isChunkMode,
  getHasAiChunkData: () => hasAiChunkData,
  currentAudioKeyGetter: () => 'audio-key',
  makeSelectionNoteBaseId: (chunkRef, startGlobal, endGlobal) => `${chunkRef}::${startGlobal}-${endGlobal}`,
  makeSelectionNoteId: (chunkRef, startGlobal, endGlobal) => `${chunkRef}::${startGlobal}-${endGlobal}::new`,
  findNearestChunkWord: () => ({
    id: 'word-12',
    textContent: 'Nearest',
    getBoundingClientRect: () => ({ left: 20, top: 30, right: 62, bottom: 46, width: 42, height: 16 }),
  }),
  now: () => 123456,
  getChunkNotesFileState: () => fileState,
  setChunkNotesFileState: (next) => {
    fileState = { ...fileState, ...next };
  },
  chunkNoteCtxMenuEl: {
    style: {},
    getBoundingClientRect: () => ({ width: 120, height: 48 }),
  },
});

[
  'getChunkNotesMap',
  'replaceChunkNotesMap',
  'getChunkNote',
  'getChunkNotesForRef',
  'getChunkNotesForBlockRefs',
  'setSelectedChunkNote',
  'getSelectedChunkNoteId',
  'getChunkNoteTagById',
  'getActiveChunkNoteId',
  'closeChunkNoteDeleteDialog',
  'getChunkNoteDeleteDialogEl',
  'openChunkNoteDeleteDialog',
  'getPendingChunkSelectionCtx',
  'consumePendingChunkSelectionCtx',
  'handleChunkSelectionContextMenu',
  'openChunkNoteStyleModal',
  'closeChunkNoteStyleModal',
  'updateChunkNoteStyle',
  'adjustChunkNoteArrowSizeByGap',
  'upsertChunkNote',
  'deleteChunkNote',
  'applyImportedChunkNotes',
  'getChunkNotesFileState',
  'setChunkNotesFileState',
  'clearChunkNotesFileState',
  'clearChunkNoteDraft',
  'persistChunkNoteDraft',
  'readChunkNoteDraft',
  'cancelChunkNoteDraftSaveTimer',
  'clearChunkNoteConnectors',
  'getChunkWordSpan',
  'ensureChunkNoteOverlayLayers',
  'rectToMainAreaSpace',
  'pointToMainAreaSpace',
  'syncChunkNoteOverlaySize',
  'persistCurrentChunkNoteDraft',
  'getRangeAnchorRectByGlobals',
  'setChunkNoteDraftRestoreDone',
  'tryRestoreChunkNoteDraft',
  'getChunkNoteLayoutBase',
  'getChunkNoteContentBoxSize',
  'ensureChunkNoteLayout',
  'syncChunkNoteTagToAnchor',
  'refreshChunkNoteTagPositions',
  'scheduleChunkNoteLayoutRefresh',
  'applyChunkNoteTextStyle',
  'renderChunkNoteImage',
  'updateChunkNoteTagCompactState',
  'makeChunkNoteTagDraggable',
  'makeChunkNoteTagResizable',
  'enableChunkNoteInlineEdit',
  'spawnChunkNoteTag',
  'renderAllChunkNoteTags',
  'drawChunkNoteConnector',
  'redrawAllChunkNoteConnectors',
  'scheduleChunkNoteConnectorRedraw',
  'closeChunkNotePopover',
  'getChunkNoteModalEl',
  'saveChunkNoteFromModal',
  'cancelChunkNoteModal',
  'openChunkNotePopover',
  'upsertChunkNoteFromModal',
  'getChunkBlocksMatchingRef',
  'getChunkNotesForBlock',
  'refreshChunkNoteForChunkRef',
  'refreshAllChunkNoteVisuals',
].forEach((name) => {
  assert.equal(typeof api[name], 'function', `${name} should be exposed`);
});

api.openChunkNoteContextMenu(100, 120, { chunkRef: 'chunk-a', startGlobal: 10, endGlobal: 11 });
assert.equal(api.getPendingChunkSelectionCtx().chunkRef, 'chunk-a');
assert.equal(api.consumePendingChunkSelectionCtx().chunkRef, 'chunk-a');
assert.equal(api.getPendingChunkSelectionCtx(), null);

const fakeEnDiv = {
  querySelectorAll: () => [],
  contains: () => true,
};
const fakeBlock = {
  dataset: { chunkRef: 'chunk-a', chunkIdx: '2' },
  querySelector(selector) {
    return selector === '.chunk-en' ? fakeEnDiv : null;
  },
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 100, width: 300, height: 100 }),
};
const fakeTarget = {
  closest(selector) {
    return selector === '.chunk-block' ? fakeBlock : null;
  },
};
let preventedContextMenu = false;
isChunkMode = true;
hasAiChunkData = true;
assert.equal(api.handleChunkSelectionContextMenu({
  target: fakeTarget,
  clientX: 48,
  clientY: 36,
  preventDefault() {
    preventedContextMenu = true;
  },
}), true);
const handledContext = api.consumePendingChunkSelectionCtx();
assert.equal(preventedContextMenu, true);
assert.equal(handledContext.noteId, 'chunk-a::12-12::new');
assert.equal(handledContext.chunkIdx, 2);
assert.equal(handledContext.selectedText, 'Nearest');

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
assert.equal(api.getChunkNotesForBlockRefs(['missing', 'chunk-a']).length, 1);

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
assert.equal(api.getChunkNotesForBlockRefs(['chunk-a', 'chunk-b']).length, 2);

const staleSelectedEl = {
  removed: [],
  classList: {
    remove(name) {
      staleSelectedEl.removed.push(name);
    },
  },
};
const targetSelectedEl = {
  added: [],
  classList: {
    add(name) {
      targetSelectedEl.added.push(name);
    },
  },
};
sandbox.__selectedEls = [staleSelectedEl];
sandbox.__elementsById['chunk-note-tag-note-b'] = targetSelectedEl;
api.setSelectedChunkNote('note-b');
assert.equal(api.getSelectedChunkNoteId(), 'note-b');
assert.deepEqual(staleSelectedEl.removed, ['selected']);
assert.deepEqual(targetSelectedEl.added, ['selected']);
assert.equal(api.getChunkNoteTagById('note-b'), targetSelectedEl);

state.activeChunkNoteId = 'note-b';
assert.equal(api.getActiveChunkNoteId(), 'note-b');

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

sandbox.__localStorage['chunkNoteDraft::audio'] = 'not json';
assert.equal(api.readChunkNoteDraft(), null);
assert.equal(sandbox.__localStorage['chunkNoteDraft::audio'], undefined);

api.persistChunkNoteDraft({
  noteId: 'note-draft',
  chunkRef: 'chunk-a',
  chunkIdx: 2,
  startGlobal: 10,
  endGlobal: 11,
  selectedText: 'selected',
}, 'draft text', { left: 1, top: 2, width: 140, height: 44 }, true);

const draftPayload = api.readChunkNoteDraft();
assert.equal(draftPayload.version, 1);
assert.equal(draftPayload.audioKey, 'audio-key');
assert.equal(draftPayload.ctx.noteId, 'note-draft');
assert.equal(draftPayload.text, 'draft text');
assert.equal(draftPayload.modal.width, 140);

api.persistChunkNoteDraft({ chunkRef: 'chunk-a' }, '   ', null, true);
assert.equal(sandbox.__localStorage['chunkNoteDraft::audio'], undefined);

console.log('chunk notes state check passed');
