const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'src', 'composables', 'cloze-state.js');
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

const api = sandbox.window.__clozeState;
assert.ok(api, 'cloze state adapter should attach to window');
assert.equal(typeof api.bindPiniaStore, 'function');
assert.equal(typeof api.getSnapshot, 'function');

assert.equal(Array.isArray(api.clozeItems), true);
assert.equal(api.clozeItems.length, 0);
assert.equal(api.hasClozeData, false);
assert.equal(Array.isArray(api.clozeAnswerState), true);
assert.equal(api.clozeAnswerState.length, 0);

api.clozeItems = [{ targetWord: 'answer', clozeSentence: 'One ___' }];
api.hasClozeData = true;
api.clozeAnswerState = [{ checked: false, correct: false, userAnswer: '' }];
assert.equal(api.clozeItems.length, 1);
assert.equal(api.clozeItems[0].targetWord, 'answer');
assert.equal(api.hasClozeData, true);
assert.equal(api.clozeAnswerState.length, 1);

const store = {
  items: [],
  hasData: false,
  answerState: [],
};
api.bindPiniaStore(store);
assert.equal(store.items.length, 1);
assert.equal(store.items[0].targetWord, 'answer');
assert.equal(store.hasData, true);
assert.equal(store.answerState.length, 1);

api.clozeItems = [{ targetWord: 'store', clozeSentence: 'Two ___' }];
api.hasClozeData = true;
api.clozeAnswerState = [{ checked: true, correct: true, userAnswer: 'store' }];
assert.equal(store.items[0].targetWord, 'store');
assert.equal(store.hasData, true);
assert.equal(store.answerState[0].checked, true);

store.items = [{ targetWord: 'preferred', clozeSentence: 'Three ___' }];
store.hasData = true;
store.answerState = [{ checked: false, correct: false, userAnswer: 'pref' }];
api.bindPiniaStore(store, { preferStore: true });
assert.equal(api.clozeItems[0].targetWord, 'preferred');
assert.equal(api.hasClozeData, true);
assert.equal(api.clozeAnswerState[0].userAnswer, 'pref');

api.clozeItems = 'invalid';
api.hasClozeData = 0;
api.clozeAnswerState = null;
assert.equal(Array.isArray(api.clozeItems), true);
assert.equal(api.clozeItems.length, 0);
assert.equal(api.hasClozeData, false);
assert.equal(Array.isArray(api.clozeAnswerState), true);
assert.equal(api.clozeAnswerState.length, 0);

console.log('cloze state check passed');
