const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const playbackRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-playback-runtime.js'), 'utf8');
const componentSource = fs.readFileSync(path.join(repoRoot, 'src', 'components', 'ChunkModeView.vue'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'chunk-interactions.js'), 'utf8');

assert.ok(
  appSource.includes("import { initReaderPlaybackRuntime } from './reader-playback-runtime.js';"),
  'reader-runtime should configure chunk interactions through reader playback runtime'
);
assert.equal(appSource.includes('configureChunkInteractions({'), false);
assert.ok(playbackRuntimeSource.includes("import { configureChunkInteractions } from './chunk-interactions.js'"));
assert.ok(playbackRuntimeSource.includes('configureChunkInteractions({'));

assert.ok(componentSource.includes("from '../composables/chunk-interactions.js'"));
assert.ok(componentSource.includes('handleChunkWordClick({ word: word, event: event, transcriptStore: ts })'));
assert.ok(componentSource.includes('handleChunkWordContextMenu({ word: word, event: event })'));
assert.ok(componentSource.includes('handleChunkContextMenu({ event: event })'));
assert.ok(componentSource.includes('handleChunkClick({ chunk: chunk, index: idx, event: event, chunkStore: chunkState })'));

[
  'window.forceUpdateUI',
  'window.selectSentenceFromChunkTarget',
  'window.openChunkNoteContextFromEvent',
  'window.notifyAnnotationBubbleWordClick',
  "document.getElementById('audio-player')",
  'window.getSelection'
].forEach((pattern) => {
  assert.equal(componentSource.includes(pattern), false, `ChunkModeView.vue should not use ${pattern}`);
});

assert.ok(componentSource.includes('window.__chunkNoteLayout'), 'chunk note layout fallback is still owned by the root layout migration');

assert.ok(moduleSource.includes('export function configureChunkInteractions'));
assert.ok(moduleSource.includes('export function handleChunkWordClick'));
assert.ok(moduleSource.includes('export function handleChunkWordContextMenu'));
assert.ok(moduleSource.includes('export function handleChunkContextMenu'));
assert.ok(moduleSource.includes('export function handleChunkClick'));
assert.equal(moduleSource.includes('window.'), false, 'chunk interactions should not create or read window globals');
assert.equal(moduleSource.includes('document.'), false, 'chunk interactions should receive DOM dependencies explicitly');

console.log('chunk interactions check passed');
