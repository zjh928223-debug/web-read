const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'src', 'composables', 'transcript-state.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const sandbox = {
  window: {},
  Set,
  Number,
  Object,
  Array,
  console,
};

vm.runInNewContext(source, sandbox, { filename: sourcePath });

const api = sandbox.window.__transcriptState;
assert.ok(api, 'transcript state adapter should attach to window');
assert.equal(typeof api.bindPiniaStore, 'function');
assert.equal(typeof api.getSnapshot, 'function');

assert.equal(Array.isArray(api.segments), true);
assert.equal(api.segments.length, 0);
assert.equal(Array.isArray(api.words), true);
assert.equal(api.words.length, 0);
assert.equal(Array.isArray(api.wordStarts), true);
assert.equal(api.wordStarts.length, 0);
assert.equal(api.currentWordIndex, -1);
assert.equal(api.highlightMode, 2);

api.segments = [{ start: 0, words: [] }];
api.words = [{ word: 'One', start: 0, globalIndex: 0 }];
api.wordStarts = [0];
api.currentWordIndex = 0;
api.highlightMode = 1;

assert.equal(api.segments.length, 1);
assert.equal(api.words[0].word, 'One');
assert.equal(api.wordStarts[0], 0);
assert.equal(api.currentWordIndex, 0);
assert.equal(api.highlightMode, 1);

const store = {
  segments: [],
  words: [],
  wordStarts: [],
  currentWordIndex: -1,
  highlightMode: 2,
  activeWordIdx: -1,
  activeSegIdx: -1,
  useVueRendering: false,
};
api.bindPiniaStore(store);
assert.equal(store.segments.length, 1);
assert.equal(store.words[0].word, 'One');
assert.equal(store.currentWordIndex, 0);
assert.equal(store.highlightMode, 1);

api.words = [{ word: 'Two', start: 1, globalIndex: 1 }];
api.currentWordIndex = 1;
api.highlightMode = 2;
assert.equal(store.words[0].word, 'Two');
assert.equal(store.currentWordIndex, 1);
assert.equal(store.highlightMode, 2);

store.segments = [{ start: 5, words: [] }];
store.words = [{ word: 'Store', start: 5, globalIndex: 2 }];
store.wordStarts = [5];
store.currentWordIndex = 2;
store.highlightMode = 0;
api.bindPiniaStore(store, { preferStore: true });
assert.equal(api.segments[0].start, 5);
assert.equal(api.words[0].word, 'Store');
assert.equal(api.wordStarts[0], 5);
assert.equal(api.currentWordIndex, 2);
assert.equal(api.highlightMode, 0);

api.segments = 'invalid';
api.words = null;
api.wordStarts = {};
api.currentWordIndex = 'not-number';
api.highlightMode = 'not-number';
assert.equal(Array.isArray(api.segments), true);
assert.equal(api.segments.length, 0);
assert.equal(Array.isArray(api.words), true);
assert.equal(api.words.length, 0);
assert.equal(Array.isArray(api.wordStarts), true);
assert.equal(api.wordStarts.length, 0);
assert.equal(api.currentWordIndex, -1);
assert.equal(api.highlightMode, 2);

console.log('transcript state check passed');
