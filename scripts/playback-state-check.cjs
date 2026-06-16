const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'src', 'composables', 'playback-state.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const sandbox = {
  window: {},
  Set,
  Number,
  Object,
  String,
  console,
};

vm.runInNewContext(source, sandbox, { filename: sourcePath });

const api = sandbox.window.__playbackState;
assert.ok(api, 'playback state adapter should attach to window');
assert.equal(typeof api.getSnapshot, 'function');
assert.equal(typeof api.resetFallback, 'function');

assert.equal(api.autoFollow, true);
assert.equal(api.userScrollSuppress, false);
assert.equal(api.suppressTimer, null);
assert.equal(api.lastActiveSegIndex, -1);
assert.equal(api.activeWordHighlightEl, null);
assert.equal(api.activeSentenceEl, null);
assert.equal(api.activeChunkEl, null);
assert.equal(api.playbackUiSignature, '');
assert.equal(api.lastSentencePrevTapSegIndex, -1);
assert.equal(api.lastSentencePrevTapAt, 0);

const timerRef = { id: 1 };
const wordEl = { id: 'word-1' };
const sentenceEl = { id: 'segment-1' };
const chunkEl = { id: 'chunk-1' };

api.autoFollow = false;
api.userScrollSuppress = true;
api.suppressTimer = timerRef;
api.lastActiveSegIndex = 3;
api.activeWordHighlightEl = wordEl;
api.activeSentenceEl = sentenceEl;
api.activeChunkEl = chunkEl;
api.playbackUiSignature = 'line|2|4|-1|3';
api.lastSentencePrevTapSegIndex = 3;
api.lastSentencePrevTapAt = 1234;

assert.equal(api.autoFollow, false);
assert.equal(api.userScrollSuppress, true);
assert.equal(api.suppressTimer, timerRef);
assert.equal(api.lastActiveSegIndex, 3);
assert.equal(api.activeWordHighlightEl, wordEl);
assert.equal(api.activeSentenceEl, sentenceEl);
assert.equal(api.activeChunkEl, chunkEl);
assert.equal(api.playbackUiSignature, 'line|2|4|-1|3');
assert.equal(api.lastSentencePrevTapSegIndex, 3);
assert.equal(api.lastSentencePrevTapAt, 1234);

const snapshot = api.getSnapshot();
assert.equal(snapshot.suppressTimer, timerRef);
assert.equal(snapshot.activeWordHighlightEl, wordEl);
assert.equal(snapshot.lastSentencePrevTapAt, 1234);

api.autoFollow = 0;
api.userScrollSuppress = '';
api.suppressTimer = null;
api.activeWordHighlightEl = undefined;
api.activeSentenceEl = null;
api.activeChunkEl = undefined;
api.playbackUiSignature = null;
api.lastActiveSegIndex = 'bad';
api.lastSentencePrevTapSegIndex = 'bad';
api.lastSentencePrevTapAt = 'bad';

assert.equal(api.autoFollow, false);
assert.equal(api.userScrollSuppress, false);
assert.equal(api.suppressTimer, null);
assert.equal(api.activeWordHighlightEl, null);
assert.equal(api.activeSentenceEl, null);
assert.equal(api.activeChunkEl, null);
assert.equal(api.playbackUiSignature, '');
assert.equal(api.lastActiveSegIndex, -1);
assert.equal(api.lastSentencePrevTapSegIndex, -1);
assert.equal(api.lastSentencePrevTapAt, 0);

api.resetFallback();
assert.equal(api.autoFollow, true);
assert.equal(api.userScrollSuppress, false);
assert.equal(api.lastActiveSegIndex, -1);

console.log('playback state check passed');
