const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const featureAdaptersSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
const playbackRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-playback-runtime.js'), 'utf8');
const playbackModuleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'playback-module.js'), 'utf8');
const componentSource = fs.readFileSync(path.join(repoRoot, 'src', 'components', 'ChunkModeView.vue'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'chunk-interactions.js'), 'utf8');

assert.ok(
  appSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
  'reader-runtime should delegate chunk interactions through reader-runtime-assembly'
);
assert.ok(
  assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime-assembly should delegate chunk interactions through reader-feature-runtime'
);
assert.ok(
  featureSource.includes('adapters.startInteraction({'),
  'reader-feature-runtime should configure chunk interactions through its interaction adapter'
);
assert.ok(featureAdaptersSource.includes("import { initReaderInteractionRuntime } from './reader-interaction-runtime.js'"));
assert.equal(appSource.includes('configureChunkInteractions({'), false);
assert.ok(playbackRuntimeSource.includes("import { configureChunkInteractions } from './chunk-interactions.js'"));
assert.ok(playbackRuntimeSource.includes('configureChunkInteractions({'));

assert.ok(componentSource.includes("from '../composables/chunk-interactions.js'"));
assert.ok(componentSource.includes('handleChunkWordClick({ word: word, event: event, transcriptStore: ts })'));
assert.ok(componentSource.includes('handleChunkWordContextMenu({ word: word, event: event })'));
assert.ok(componentSource.includes('handleChunkContextMenu({ event: event })'));
assert.ok(componentSource.includes('handleChunkClick({ chunk: chunk, index: idx, event: event, chunkStore: chunkState })'));
assert.ok(componentSource.includes('markedMap.has(idx)'), 'ChunkModeView should restore marked word styling after chunk mode rerenders');
assert.ok(componentSource.includes('classes.marked = true'), 'ChunkModeView should render persisted marks as marked');

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
assert.ok(moduleSource.includes('wordIndex'), 'word clicks should pass the clicked word index into the forced UI update');
assert.ok(playbackModuleSource.includes('function forceUpdateUI(time, options)'), 'forced playback updates should accept an explicit word index option');
assert.ok(playbackModuleSource.includes('options.wordIndex'), 'forced playback updates should prefer the clicked word index over time-only lookup');
assert.equal(moduleSource.includes('window.'), false, 'chunk interactions should not create or read window globals');
assert.equal(moduleSource.includes('document.'), false, 'chunk interactions should receive DOM dependencies explicitly');

async function runBehaviorCheck() {
  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const mod = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const transcriptStore = { currentWordIndex: -1 };
  const media = { currentTime: 0 };
  const calls = [];

  mod.configureChunkInteractions({
    getAudioPlayer() { return media; },
    getSelection() { return { isCollapsed: true }; },
    forceUpdateUI(time, options) {
      calls.push({ time, options });
      transcriptStore.currentWordIndex = 99;
    },
    notifyAnnotationBubbleWordClick() { return true; }
  });

  mod.handleChunkWordClick({
    word: { globalIndex: 2, start: 1.25 },
    transcriptStore,
    element: { id: 'word-2' }
  });

  assert.equal(media.currentTime, 1.25);
  assert.deepEqual(calls[0], { time: 1.25, options: { wordIndex: 2 } });
  assert.equal(transcriptStore.currentWordIndex, 2, 'clicked word index should remain authoritative after forceUpdateUI');
}

runBehaviorCheck()
  .then(() => {
    console.log('chunk interactions check passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
