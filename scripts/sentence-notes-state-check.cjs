const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(name) {
    this.values.add(name);
  }

  remove(name) {
    this.values.delete(name);
  }

  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : !!force;
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {
      values: {},
      setProperty(name, value) {
        this.values[name] = String(value);
      },
    };
    this.classList = new FakeClassList();
    this.eventListeners = {};
    this.hidden = false;
    this.scrollTop = 0;
    this.textContent = '';
    this.value = '';
    this.placeholder = '';
    this._innerHTML = '';
  }

  set className(value) {
    this._className = String(value || '');
    this.classList = new FakeClassList();
    this._className.split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name));
  }

  get className() {
    return this._className || '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    if (this._innerHTML === '') this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    child.parentElement = null;
    return child;
  }

  addEventListener(type, handler) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(handler);
  }

  dispatch(type, event = {}) {
    (this.eventListeners[type] || []).forEach((handler) => {
      handler(Object.assign({ target: this }, event));
    });
  }

  scrollIntoView() {
    this.didScrollIntoView = true;
  }

  contains(target) {
    if (target === this) return true;
    return this.children.some((child) => child.contains && child.contains(target));
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (selector === '.chunk-block' && node.classList && node.classList.contains('chunk-block')) return node;
      if (selector === '.chunk-en' && node.classList && node.classList.contains('chunk-en')) return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    if (selector === '.chunk-en') {
      return this.children.find((child) => child.classList && child.classList.contains('chunk-en')) || null;
    }
    const itemIdMatch = selector.match(/\.sentence-note-item\[data-item-id="([^"]+)"\]/);
    if (itemIdMatch) {
      return this.findDescendant((node) => (
        node.classList
        && node.classList.contains('sentence-note-item')
        && String(node.dataset.itemId || '') === itemIdMatch[1]
      ));
    }
    return null;
  }

  findDescendant(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      if (child.findDescendant) {
        const found = child.findDescendant(predicate);
        if (found) return found;
      }
    }
    return null;
  }
}

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'src', 'composables', 'notes-module.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const body = new FakeElement('body');
const documentElement = new FakeElement('html');
const sandbox = {
  window: {
    innerWidth: 1024,
    innerHeight: 768,
    CSS: {
      escape(value) {
        return String(value);
      },
    },
    SentenceNotesPersistenceUtils: {
      async ensureLegacySentenceNotesForDoc() {},
      getCurrentSentenceDocIdForExport(currentDocId, buildCurrentSentenceDocId) {
        return currentDocId || buildCurrentSentenceDocId();
      },
    },
    getSelection() {
      return sandbox.__selection;
    },
    dispatchEvent(event) {
      sandbox.__events.push(event.type);
    },
  },
  localStorage: {
    setItem(key, value) {
      sandbox.__localStorage[key] = String(value);
    },
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(sandbox.__localStorage, key)
        ? sandbox.__localStorage[key]
        : null;
    },
    removeItem(key) {
      delete sandbox.__localStorage[key];
    },
  },
  document: {
    body,
    documentElement,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createDocumentFragment() {
      return new FakeElement('fragment');
    },
    addEventListener() {},
    removeEventListener() {},
  },
  Node: { ELEMENT_NODE: 1 },
  Event: class FakeEvent {
    constructor(type) {
      this.type = type;
    }
  },
  requestAnimationFrame(callback) {
    sandbox.__rafCallbacks.push(callback);
    return sandbox.__rafCallbacks.length;
  },
  cancelAnimationFrame() {},
  setTimeout(callback, delay) {
    const id = sandbox.__timers.length + 1;
    sandbox.__timers.push({ id, callback, delay });
    return id;
  },
  clearTimeout(id) {
    sandbox.__timers = sandbox.__timers.filter((timer) => timer.id !== id);
  },
  __selection: null,
  __events: [],
  __localStorage: {},
  __rafCallbacks: [],
  __timers: [],
  console,
  Date,
  Math,
  Number,
  String,
  Object,
  Array,
  Set,
};

vm.runInNewContext(source, sandbox, { filename: sourcePath });

const notesModule = sandbox.window.__notesModule;
assert.ok(notesModule, 'notes module should attach to window');
assert.equal(typeof notesModule.createNotesState, 'function');
assert.equal(typeof notesModule.getNotesState, 'function');
assert.equal(notesModule.getNotesState(), sandbox.window.__notesState);
assert.equal(sandbox.window._ns, sandbox.window.__notesState);
assert.equal(typeof notesModule.initSentenceNotes, 'function');

const clone = (value) => JSON.parse(JSON.stringify(value));
const previewSidebar = new FakeElement('aside');
const previewEmpty = new FakeElement('div');
const previewList = new FakeElement('div');
const togglePreviewBtn = new FakeElement('button');
let docId = 'doc-1';
const saved = {};
const saveCalls = [];
let isChunkMode = true;
let hasAiChunkData = true;

const state = notesModule.createNotesState({ currentDocId: docId });
assert.equal(state.currentDocId, docId);
assert.equal(state.chunkNoteVisible, false);

const api = notesModule.initSentenceNotes({
  state,
  loadFromDB: async (key) => saved[key] || null,
  saveToDB: (key, value) => {
    saved[key] = clone(value);
    saveCalls.push({ key, value: clone(value) });
  },
  getSentenceNotesStorageKey: () => 'sentenceNotes::all',
  getLegacySentenceNotesStorageKey: () => 'legacySentenceNotes',
  buildCurrentSentenceDocId: () => docId,
  isPlainObjectRecord: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
  getIsChunkMode: () => isChunkMode,
  getHasAiChunkData: () => hasAiChunkData,
  notePreviewSidebar: previewSidebar,
  notePreviewEmpty: previewEmpty,
  notePreviewList: previewList,
  toggleNotePreviewBtn: togglePreviewBtn,
  initialNotePreviewVisible: true,
  initialNotePreviewWidth: 340,
  initialNotePreviewHeight: 640,
});

[
  'loadSentenceNotesForCurrentAudio',
  'saveSentenceNotesDebounced',
  'persistSentenceNotebookNow',
  'persistSentenceNotesForCurrentDoc',
  'switchSentenceNotesDoc',
  'getSentenceNoteRecord',
  'getSortedSentenceNoteItems',
  'applyNotePreviewSize',
  'formatSentenceNoteItemMeta',
  'triggerSentenceNoteSavedFeedback',
  'findSentenceNoteItem',
  'discardSentenceNoteDraft',
  'commitSentenceNoteDraft',
  'persistSentenceNoteItem',
  'persistSelectedSentenceNote',
  'buildSentenceNoteItemElement',
  'renderNotePreviewSidebar',
  'showNotePreviewEmptyState',
  'toggleNotePreviewSidebar',
  'setSelectedSentence',
  'getSelectedSentence',
  'updateSentenceFocusPhrase',
  'selectSentenceFromChunkTarget',
  'hasActiveTextSelectionWithinChunk',
  'getSelectionChunkSentence',
  'maybeCaptureSentenceFocusPhrase',
  'applyImportedSentenceNotesSnapshot',
  'initNotePreviewResize',
  'normalizeSentenceNotesScope',
  'normalizeSentenceNoteRecord',
  'buildSentenceNotesExportSnapshot',
  'triggerSentenceNotesDownload',
  'ensureLegacySentenceNotesForDoc',
  'getCurrentSentenceDocIdForExport',
].forEach((name) => {
  assert.equal(typeof api[name], 'function', `${name} should be exposed`);
});

const legacyRecord = api.normalizeSentenceNoteRecord('s-legacy', {
  focusPhrase: ' selected phrase ',
  noteBody: ' legacy note ',
  updatedAt: 42,
});
assert.equal(legacyRecord.items.length, 1);
assert.equal(legacyRecord.items[0].selectedText, ' selected phrase ');
assert.equal(legacyRecord.items[0].noteBody, ' legacy note ');
assert.equal(legacyRecord.items[0].updatedAt, 42);

api.setSelectedSentence({
  sentenceId: 's-1',
  chunkRef: 's-1',
  index: 0,
  text: 'Sentence one.',
});
assert.equal(api.getSelectedSentence().sentenceId, 's-1');
assert.equal(previewEmpty.hidden, false);
assert.equal(previewList.hidden, true);
assert.match(previewEmpty.textContent, /No note items yet/);

api.updateSentenceFocusPhrase(api.getSelectedSentence(), ' phrase one ');
assert.ok(state.sentenceNoteDraft, 'focus phrase should create a draft');
assert.equal(state.sentenceNoteDraft.selectedText, 'phrase one');
assert.equal(previewList.hidden, false);
assert.equal(previewList.children.length, 1);

state.sentenceNoteDraft.noteBody = 'draft note';
const committed = api.commitSentenceNoteDraft(false);
assert.equal(committed, true);
assert.equal(state.sentenceNoteDraft, null);
assert.equal(state.sentenceNotesMap['s-1'].items.length, 1);
assert.equal(state.sentenceNotesMap['s-1'].items[0].noteBody, 'draft note');
assert.equal(saveCalls.at(-1).key, 'sentenceNotes::all');

const itemId = state.sentenceNotesMap['s-1'].items[0].itemId;
state.sentenceNotesMap['s-1'].items[0].noteBody = '   ';
assert.equal(api.persistSentenceNoteItem('s-1', itemId, false), false);
assert.equal(state.sentenceNotesMap['s-1'], undefined);

assert.throws(() => {
  api.applyImportedSentenceNotesSnapshot({ docId: 'other-doc', notes: {} });
}, /docId mismatch/);

api.applyImportedSentenceNotesSnapshot({
  docId,
  notes: {
    's-2': {
      sentenceId: 's-2',
      items: [
        {
          itemId: 'imported-1',
          selectedText: 'imported phrase',
          noteBody: 'imported note',
          createdAt: 10,
          updatedAt: 11,
        },
      ],
    },
  },
});
assert.ok(state.sentenceNotesMap['s-2']);
assert.equal(state.sentenceNotesMap['s-2'].items[0].itemId, 'imported-1');
assert.equal(saved['sentenceNotes::all'][docId]['s-2'].items[0].noteBody, 'imported note');
api.persistSentenceNotesForCurrentDoc();
assert.equal(saved['sentenceNotes::all'][docId]['s-1'], undefined);

const chunkBlock = new FakeElement('div');
chunkBlock.classList.add('chunk-block');
chunkBlock.dataset.chunkRef = 'chunk-a';
chunkBlock.dataset.chunkIdx = '3';
const chunkEn = new FakeElement('div');
chunkEn.classList.add('chunk-en');
chunkEn.textContent = 'Chunk sentence text.';
chunkBlock.appendChild(chunkEn);
assert.equal(api.selectSentenceFromChunkTarget(chunkEn), true);
assert.equal(state.selectedSentence.sentenceId, 'chunk-a');
assert.equal(state.selectedSentence.text, 'Chunk sentence text.');

isChunkMode = false;
assert.equal(api.selectSentenceFromChunkTarget(chunkEn), false);
isChunkMode = true;
hasAiChunkData = false;
assert.equal(api.selectSentenceFromChunkTarget(chunkEn), false);
hasAiChunkData = true;

sandbox.__selection = {
  rangeCount: 1,
  isCollapsed: false,
  toString: () => ' selected words ',
  getRangeAt: () => ({
    startContainer: chunkEn,
    endContainer: chunkEn,
    commonAncestorContainer: chunkEn,
  }),
};
assert.equal(api.hasActiveTextSelectionWithinChunk(), true);
assert.equal(api.maybeCaptureSentenceFocusPhrase(), true);
assert.equal(state.sentenceNoteDraft.selectedText, 'selected words');

const snapshot = api.buildSentenceNotesExportSnapshot();
assert.equal(snapshot.docId, docId);
assert.ok(snapshot.exportedAt > 0);
assert.ok(snapshot.notes['s-2']);

api.toggleNotePreviewSidebar(false);
assert.equal(sandbox.__localStorage.notePreviewVisible, 'false');
assert.equal(sandbox.__events.length, 0, 'resize dispatch is deferred through fake timeout');

console.log('sentence notes state check passed');
