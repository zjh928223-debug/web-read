const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appPath = path.join(repoRoot, 'app.js');
const appSource = fs.readFileSync(appPath, 'utf8');
const appLines = appSource.split(/\r?\n/);

function findStatePropertyLine(field) {
  const needle = `Object.defineProperty(window.__state, '${field}'`;
  return appLines.find((line) => line.includes(needle)) || '';
}

function assertFacade(field, fragments) {
  const line = findStatePropertyLine(field);
  assert.ok(line, `${field} should be exposed on window.__state`);
  fragments.forEach((fragment) => {
    assert.ok(
      line.includes(fragment),
      `${field} facade should include ${fragment}`
    );
  });
}

[
  ['segments', ['_tr.segments']],
  ['words', ['_tr.words']],
  ['wordStarts', ['_tr.wordStarts']],
  ['currentWordIndex', ['_tr.currentWordIndex']],
  ['highlightMode', ['_tr.highlightMode']],

  ['chunkItems', ['_ch.chunkItems']],
  ['hasAiChunkData', ['_ch.hasAiChunkData']],
  ['manualChunkStates', ['_ch.manualChunkStates']],
  ['isChunkMode', ['_ch.isChunkMode']],
  ['chunkCnVisible', ['_ch.chunkCnVisible']],
  ['chunkCnHoldMode', ['_ch.chunkCnHoldMode']],
  ['isHoldingChunkCn', ['_ch.isHoldingChunkCn']],
  ['holdPrevChunkCnVisible', ['_ch.holdPrevChunkCnVisible']],
  ['isChunkShadowOn', ['_ch.isChunkShadowOn']],
  ['chunkCnMode', ['_ch.chunkCnMode']],
  ['lastActiveChunkIndex', ['_ch.lastActiveChunkIndex']],
  ['lastAiPrevTapChunkIndex', ['_ch.lastAiPrevTapChunkIndex']],
  ['lastAiPrevTapAt', ['_ch.lastAiPrevTapAt']],

  ['hasClozeData', ['_clz.hasClozeData']],
  ['clozeItems', ['_clz.clozeItems']],
  ['clozeAnswerState', ['_clz.clozeAnswerState']],

  ['autoFollow', ['_pb.autoFollow']],
  ['userScrollSuppress', ['_pb.userScrollSuppress']],
  ['suppressTimer', ['_pb.suppressTimer']],
  ['lastActiveSegIndex', ['_pb.lastActiveSegIndex']],
  ['activeWordHighlightEl', ['_pb.activeWordHighlightEl']],
  ['activeSentenceEl', ['_pb.activeSentenceEl']],
  ['activeChunkEl', ['_pb.activeChunkEl']],
  ['playbackUiSignature', ['_pb.playbackUiSignature']],
  ['lastSentencePrevTapSegIndex', ['_pb.lastSentencePrevTapSegIndex']],
  ['lastSentencePrevTapAt', ['_pb.lastSentencePrevTapAt']],

  ['chunkNotesFileHandle', ['_cnApi.getChunkNotesFileState().handle', '_cnApi.setChunkNotesFileState({ handle: v })']],
  ['chunkNotesFileHandleAudioKey', ['_cnApi.getChunkNotesFileState().audioKey', '_cnApi.setChunkNotesFileState({ audioKey: v })']],
  ['chunkNotesFileName', ['_cnApi.getChunkNotesFileState().fileName', '_cnApi.setChunkNotesFileState({ fileName: v })']],
].forEach(([field, fragments]) => assertFacade(field, fragments));

[
  /\blet\s+segments\b/,
  /\blet\s+words\b/,
  /\blet\s+wordStarts\b/,
  /\blet\s+chunkItems\b/,
  /\blet\s+clozeItems\b/,
  /\blet\s+autoFollow\b/,
  /\blet\s+userScrollSuppress\b/,
  /\blet\s+suppressTimer\b/,
  /\blet\s+lastActiveSegIndex\b/,
  /\blet\s+activeWordHighlightEl\b/,
  /\blet\s+activeSentenceEl\b/,
  /\blet\s+activeChunkEl\b/,
  /\blet\s+playbackUiSignature\b/,
  /\blet\s+lastSentencePrevTapSegIndex\b/,
  /\blet\s+lastSentencePrevTapAt\b/,
  /\bvar\s+_ns\s*=\s*\{/,
  /\blet\s+chunkNotesFileHandle\b/,
  /\blet\s+chunkNotesFileHandleAudioKey\b/,
  /\blet\s+chunkNotesFileName\b/,
].forEach((pattern) => {
  assert.equal(pattern.test(appSource), false, `app.js should not contain ${pattern}`);
});

assert.ok(appSource.includes('const _tr = window.__transcriptState;'));
assert.ok(appSource.includes('const _ch = window.__chunkState;'));
assert.ok(appSource.includes('const _clz = window.__clozeState;'));
assert.ok(appSource.includes('const _pb = window.__playbackState;'));
assert.ok(appSource.includes('var _ns = window.__notesModule.getNotesState();'));

console.log('state facade owner check passed');
