const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
  const interactionRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-interaction-runtime.js'), 'utf8');
  const playbackRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-playback-runtime.js'), 'utf8');
  const sessionInitSource = [
  'session-runtime-assembly.js',
  'session-restore-runtime.js',
  'session-startup-runtime.js',
  'session-startup-cleanup.js',
  'session-ui-settings-restore.js',
  'session-annotation-context.js',
  'session-annotation-generated-index.js',
  'session-annotation-marks.js',
  'session-annotation-lightweight-io.js',
  'session-annotation-export-payload.js',
  'session-annotation-import-normalization.js',
  'session-annotation-bundle-merge.js',
  'session-annotation-text.js'
].map((file) => fs.readFileSync(path.join(repoRoot, 'src', 'composables', file), 'utf8')).join('\n');

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
    'reader-runtime should delegate reader playback runtime through reader-runtime-assembly'
  );
  assert.ok(
    assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
    'reader-runtime-assembly should initialize reader playback runtime through reader-feature-runtime'
  );
  assert.ok(
    featureSource.includes('var interactionRuntime = initReaderInteractionRuntime({'),
    'reader-feature-runtime should initialize playback/interactions through reader interaction runtime'
  );
  assert.equal(
    runtimeSource.includes("import { initReaderPlaybackRuntime } from './reader-playback-runtime.js';"),
    false,
    'reader-runtime should not import reader playback runtime directly'
  );
  assert.equal(
    runtimeSource.includes('var playbackRuntime = initReaderPlaybackRuntime({'),
    false,
    'reader-runtime should not initialize reader playback runtime directly'
  );
  assert.ok(
    interactionRuntimeSource.includes("import { initReaderPlaybackRuntime } from './reader-playback-runtime.js';"),
    'reader-interaction-runtime should import reader playback runtime module'
  );
  assert.ok(
    interactionRuntimeSource.includes('var playbackRuntime = initReaderPlaybackRuntime({'),
    'reader-interaction-runtime should initialize playback/interactions through reader playback runtime'
  );
  [
    "import { configureTranscriptInteractions } from './transcript-interactions.js';",
    "import { configureChunkInteractions } from './chunk-interactions.js';",
    "import { initAnnotationBubbleResolver } from './annotation-bubble-resolver.js';",
    "import { initPlaybackRuntimeHelpers } from './playback-runtime-helpers.js';",
    'window.__playbackModule.init({',
    'configureTranscriptInteractions({',
    'configureChunkInteractions({',
    'initAnnotationBubbleResolver({',
    'initPlaybackRuntimeHelpers({',
    'window.forceUpdateUI',
    'window.mainUpdateHighlight',
    'window.toggleAnnotationBubble',
    'window.handleBackwardClick',
    'window.handleForwardClick'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own playback/interactions setup: ${pattern}`
    );
  });

  [
    'export function initReaderPlaybackRuntime',
    "import { configureTranscriptInteractions } from './transcript-interactions.js'",
    "import { configureChunkInteractions } from './chunk-interactions.js'",
    "import { initAnnotationBubbleResolver } from './annotation-bubble-resolver.js'",
    "import { initPlaybackRuntimeHelpers } from './playback-runtime-helpers.js'",
    'var annotationBubbleResolverApi = initAnnotationBubbleResolver({',
    'var playbackRuntimeHelpersApi = initPlaybackRuntimeHelpers({',
    'deps.playbackModule.init({',
    'configureTranscriptInteractions({',
    'configureChunkInteractions({'
  ].forEach((pattern) => {
    assert.ok(playbackRuntimeSource.includes(pattern), `reader-playback-runtime should own ${pattern}`);
  });
  assert.equal(playbackRuntimeSource.includes('window.'), false, 'reader-playback-runtime should receive window through explicit deps');
  assert.equal(playbackRuntimeSource.includes('document.'), false, 'reader-playback-runtime should not read document globals');
  assert.equal(playbackRuntimeSource.includes('mainUpdateHighlight'), false, 'reader-playback-runtime should not keep unused mainUpdateHighlight alias');

  [
    'applyCurrentAudioMeta(audioMeta);',
    'await deps.loadChunkNotesForCurrentAudio();',
    'await deps.loadSentenceNotesForCurrentAudio();',
    'await deps.switchSentenceNotesDoc(transcriptData);'
  ].forEach((pattern) => {
    assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
  });

  const testableSource = playbackRuntimeSource
    .replace(
      "import { configureTranscriptInteractions } from './transcript-interactions.js'\n",
      'function configureTranscriptInteractions(deps) { globalThis.__transcriptDeps = deps }\n'
    )
    .replace(
      "import { configureChunkInteractions } from './chunk-interactions.js'\n",
      'function configureChunkInteractions(deps) { globalThis.__chunkDeps = deps }\n'
    )
    .replace(
      "import { initAnnotationBubbleResolver } from './annotation-bubble-resolver.js'\n",
      'function initAnnotationBubbleResolver(deps) { globalThis.__annotationDeps = deps; return { notifyAnnotationBubbleWordClick: () => "notified", getAnnotationBubble: () => "bubble" } }\n'
    )
    .replace(
      "import { initPlaybackRuntimeHelpers } from './playback-runtime-helpers.js'\n",
      'function initPlaybackRuntimeHelpers(deps) { globalThis.__playbackHelperDeps = deps; return { findChunkIndexByTime: () => 1, swapActiveClass: () => "swap", followPlaybackTarget: () => "follow", jumpPrevSentence: () => "prev", jumpNextSentence: () => "next" } }\n'
    );

  globalThis.__transcriptDeps = null;
  globalThis.__chunkDeps = null;
  globalThis.__annotationDeps = null;
  globalThis.__playbackHelperDeps = null;

  const encodedSource = Buffer.from(testableSource, 'utf8').toString('base64');
  const { initReaderPlaybackRuntime } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  let playbackInitDeps = null;
  const win = {
    forceUpdateUI: () => 'force',
    toggleAnnotationBubble: () => 'toggle',
    handleBackwardClick: () => 'back',
    handleForwardClick: () => 'forward'
  };
  const transcriptState = { words: [{ text: 'hello' }] };
  const chunkState = { isChunkMode: false };
  const playbackState = { autoFollow: true };
  const audioPlayer = { currentTime: 0 };
  const result = initReaderPlaybackRuntime({
    runtimeState: { runtime: true },
    transcriptState,
    chunkState,
    playbackState,
    audioPlayer,
    mainAppArea: { id: 'main' },
    transcriptContainer: { id: 'transcript' },
    findChunkIndexByTimeHelper: () => 'find-chunk',
    getCurrentSegmentIndexHelper: () => 'segment',
    getSegmentCheckpointsHelper: () => 'checkpoints',
    bsFindActiveHelper: () => 'active',
    markedMap: new Map([[1, true]]),
    vocabMatchMap: new Map([[2, true]]),
    hasActiveTextSelectionWithinChunk: () => false,
    getSelection: () => 'selection',
    playbackModule: {
      init(deps) {
        playbackInitDeps = deps;
      }
    },
    getWindow: () => win
  });

  assert.equal(globalThis.__annotationDeps.getWords(), transcriptState.words);
  assert.equal(globalThis.__annotationDeps.markedMap.size, 1);
  assert.equal(globalThis.__annotationDeps.vocabMatchMap.size, 1);
  assert.equal(globalThis.__playbackHelperDeps.chunkState, chunkState);
  assert.equal(globalThis.__playbackHelperDeps.transcriptState, transcriptState);
  assert.equal(globalThis.__playbackHelperDeps.playbackState, playbackState);
  assert.equal(globalThis.__playbackHelperDeps.getForceUpdateUI(), win.forceUpdateUI);
  assert.equal(globalThis.__playbackHelperDeps.getWindow(), win);

  assert.equal(playbackInitDeps.state.runtime, true);
  assert.equal(playbackInitDeps.getAnnotationBubble(), 'bubble');
  assert.equal(playbackInitDeps.findChunkIndexByTime(), 1);
  assert.equal(playbackInitDeps.jumpPrevSentence(), 'prev');
  assert.equal(playbackInitDeps.jumpNextSentence(), 'next');

  assert.equal(globalThis.__transcriptDeps.forceUpdateUI, win.forceUpdateUI);
  assert.equal(globalThis.__transcriptDeps.notifyAnnotationBubbleWordClick(), 'notified');
  assert.equal(globalThis.__transcriptDeps.isChunkMode(), false);
  assert.equal(globalThis.__transcriptDeps.legacyTranscriptContainer.id, 'transcript');
  assert.equal(globalThis.__chunkDeps.getSelection(), 'selection');
  assert.equal(Object.prototype.hasOwnProperty.call(globalThis.__chunkDeps, 'openChunkNoteContextFromEvent'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(globalThis.__chunkDeps, 'selectSentenceFromChunkTarget'), false);

  assert.equal(result.playbackRuntimeHelpersApi.jumpNextSentence(), 'next');
  assert.equal(result.forceUpdateUI, win.forceUpdateUI);
  assert.equal(result.toggleAnnotationBubble, win.toggleAnnotationBubble);
  assert.equal(result.handleBackwardClick, win.handleBackwardClick);
  assert.equal(result.handleForwardClick, win.handleForwardClick);

  console.log('reader playback runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
