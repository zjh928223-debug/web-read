const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appPath = path.join(repoRoot, 'app.js');
const importModulePath = path.join(repoRoot, 'src', 'composables', 'import-module.js');
const runtimeStateFacadePath = path.join(repoRoot, 'src', 'composables', 'runtime-state-facade.js');
const appSource = fs.readFileSync(appPath, 'utf8');
const importModuleSource = fs.readFileSync(importModulePath, 'utf8');
const runtimeStateFacadeSource = fs.readFileSync(runtimeStateFacadePath, 'utf8');
const appLines = appSource.split(/\r?\n/);

function findStatePropertyLine(field) {
  const needle = `Object.defineProperty(runtimeState, '${field}'`;
  return appLines.find((line) => line.includes(needle)) || '';
}

function assertFacade(field, fragments) {
  const line = findStatePropertyLine(field);
  assert.ok(line, `${field} should be exposed on runtimeState`);
  fragments.forEach((fragment) => {
    assert.ok(
      line.includes(fragment),
      `${field} facade should include ${fragment}`
    );
  });
}

function assertNoStateProperty(field) {
  assert.equal(
    findStatePropertyLine(field),
    '',
    `${field} should not remain on window.__state`
  );
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
].forEach(([field, fragments]) => assertFacade(field, fragments));

[
  'chunkNotesFileHandle',
  'chunkNotesFileHandleAudioKey',
  'chunkNotesFileName',
  'isHoldingChunkCn',
  'holdPrevChunkCnVisible',
  'lastSentencePrevTapSegIndex',
  'lastSentencePrevTapAt',
].forEach(assertNoStateProperty);

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
assert.ok(appSource.includes("import { runtimeState } from './src/composables/runtime-state-facade.js';"));
assert.ok(runtimeStateFacadeSource.includes('export const runtimeState = {};'));
assert.ok(runtimeStateFacadeSource.includes('window.__state = runtimeState;'));
assert.ok(appSource.includes('var _ns = window.__notesModule.getNotesState();'));
assert.equal(importModuleSource.includes('state.chunkNotesFileHandle'), false);
assert.equal(importModuleSource.includes('state.chunkNotesFileHandleAudioKey'), false);
assert.equal(importModuleSource.includes('state.chunkNotesFileName'), false);

console.log('state facade owner check passed');
