const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appPath = path.join(repoRoot, 'src', 'composables', 'reader-runtime.js');
const importModulePath = path.join(repoRoot, 'src', 'composables', 'import-module.js');
const runtimeStateFacadePath = path.join(repoRoot, 'src', 'composables', 'runtime-state-facade.js');
const runtimeStateBindingsPath = path.join(repoRoot, 'src', 'composables', 'runtime-state-bindings.js');
const notesRuntimePath = path.join(repoRoot, 'src', 'composables', 'reader-notes-runtime.js');
const importRuntimePath = path.join(repoRoot, 'src', 'composables', 'reader-import-runtime.js');
const contextPath = path.join(repoRoot, 'src', 'composables', 'reader-runtime-context.js');
const appSource = fs.readFileSync(appPath, 'utf8');
const importModuleSource = fs.readFileSync(importModulePath, 'utf8');
const runtimeStateFacadeSource = fs.readFileSync(runtimeStateFacadePath, 'utf8');
const runtimeStateBindingsSource = fs.readFileSync(runtimeStateBindingsPath, 'utf8');
const notesRuntimeSource = fs.readFileSync(notesRuntimePath, 'utf8');
const importRuntimeSource = fs.readFileSync(importRuntimePath, 'utf8');
const contextSource = fs.readFileSync(contextPath, 'utf8');
const runtimeStateBindingsLines = runtimeStateBindingsSource.split(/\r?\n/);

function findStatePropertyLine(field) {
  const needle = `defineRuntimeStateBinding(runtimeState, '${field}'`;
  return runtimeStateBindingsLines.find((line) => line.includes(needle)) || '';
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
  ['segments', ['transcriptState.segments']],
  ['words', ['transcriptState.words']],
  ['wordStarts', ['transcriptState.wordStarts']],
  ['currentWordIndex', ['transcriptState.currentWordIndex']],
  ['highlightMode', ['transcriptState.highlightMode']],

  ['chunkItems', ['chunkState.chunkItems']],
  ['hasAiChunkData', ['chunkState.hasAiChunkData']],
  ['manualChunkStates', ['chunkState.manualChunkStates']],
  ['isChunkMode', ['chunkState.isChunkMode']],
  ['chunkCnVisible', ['chunkState.chunkCnVisible']],
  ['chunkCnHoldMode', ['chunkState.chunkCnHoldMode']],
  ['isChunkShadowOn', ['chunkState.isChunkShadowOn']],
  ['chunkCnMode', ['chunkState.chunkCnMode']],
  ['lastActiveChunkIndex', ['chunkState.lastActiveChunkIndex']],
  ['lastAiPrevTapChunkIndex', ['chunkState.lastAiPrevTapChunkIndex']],
  ['lastAiPrevTapAt', ['chunkState.lastAiPrevTapAt']],

  ['hasClozeData', ['clozeState.hasClozeData']],
  ['clozeItems', ['clozeState.clozeItems']],
  ['clozeAnswerState', ['clozeState.clozeAnswerState']],

  ['autoFollow', ['playbackState.autoFollow']],
  ['userScrollSuppress', ['playbackState.userScrollSuppress']],
  ['suppressTimer', ['playbackState.suppressTimer']],
  ['lastActiveSegIndex', ['playbackState.lastActiveSegIndex']],
  ['activeWordHighlightEl', ['playbackState.activeWordHighlightEl']],
  ['activeSentenceEl', ['playbackState.activeSentenceEl']],
  ['activeChunkEl', ['playbackState.activeChunkEl']],
  ['playbackUiSignature', ['playbackState.playbackUiSignature']],
].forEach(([field, fragments]) => assertFacade(field, fragments));

[
  'chunkNotesFileHandle',
  'chunkNotesFileHandleAudioKey',
  'chunkNotesFileName',
  'isHoldingChunkCn',
  'holdPrevChunkCnVisible',
  'lastSentencePrevTapSegIndex',
  'lastSentencePrevTapAt',
  'chunkNoteModalEl',
  'chunkPointerDown',
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
  /\blet\s+chunkPointerDown\b/,
  /\bvar\s+__chunkNoteModalEl\b/,
].forEach((pattern) => {
  assert.equal(pattern.test(appSource), false, `app.js should not contain ${pattern}`);
});

assert.ok(appSource.includes("import { initReaderRuntimeContext } from './reader-runtime-context.js';"));
assert.ok(appSource.includes('var bootstrapRuntime = runtimeContext.bootstrapRuntime;'));
assert.ok(contextSource.includes("import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';"));
assert.ok(appSource.includes('const _tr = bootstrapRuntime.transcriptState;'));
assert.ok(appSource.includes('const _ch = bootstrapRuntime.chunkState;'));
assert.ok(appSource.includes('const _clz = bootstrapRuntime.clozeState;'));
assert.ok(appSource.includes('const _pb = bootstrapRuntime.playbackState;'));
assert.ok(appSource.includes("import { runtimeState } from './runtime-state-facade.js';"));
assert.ok(appSource.includes("import { initReaderImportRuntime } from './reader-import-runtime.js';"));
assert.equal(appSource.includes("import { configureRuntimeStateBindings } from './runtime-state-bindings.js';"), false);
assert.ok(importRuntimeSource.includes("import { configureRuntimeStateBindings } from './runtime-state-bindings.js'"));
assert.ok(importRuntimeSource.includes('configureRuntimeStateBindings({'));
assert.equal(appSource.includes('Object.defineProperty(runtimeState,'), false);
assert.ok(runtimeStateFacadeSource.includes('export const runtimeState = {};'));
assert.ok(runtimeStateFacadeSource.includes('window.__state = runtimeState;'));
assert.ok(runtimeStateBindingsSource.includes('export function configureRuntimeStateBindings'));
assert.ok(runtimeStateBindingsSource.includes('Object.defineProperty(runtimeState, field, {'));
assert.ok(appSource.includes('var _ns = notesSessionRuntime.notesState;'));
assert.equal(appSource.includes('var _ns = window.__notesModule.getNotesState();'), false);
assert.ok(notesRuntimeSource.includes('var notesState = notesModule.getNotesState()'));
assert.equal(importModuleSource.includes('state.chunkNotesFileHandle'), false);
assert.equal(importModuleSource.includes('state.chunkNotesFileHandleAudioKey'), false);
assert.equal(importModuleSource.includes('state.chunkNotesFileName'), false);

console.log('state facade owner check passed');
