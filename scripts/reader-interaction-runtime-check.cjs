const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-interaction-runtime.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderInteractionRuntime } from './reader-interaction-runtime.js';"),
    'reader-runtime should initialize render/playback through reader interaction runtime'
  );
  assert.ok(
    runtimeSource.includes('var interactionRuntime = initReaderInteractionRuntime({'),
    'reader-runtime should call the interaction runtime module'
  );
  assert.equal(
    runtimeSource.includes("import { configureRenderRuntime"),
    false,
    'reader-runtime should not import render runtime configuration directly'
  );
  assert.equal(
    runtimeSource.includes("import { initReaderPlaybackRuntime } from './reader-playback-runtime.js';"),
    false,
    'reader-runtime should not import reader playback runtime directly'
  );
  assert.equal(runtimeSource.includes('configureRenderRuntime({'), false);
  assert.equal(runtimeSource.includes('var playbackRuntime = initReaderPlaybackRuntime({'), false);
  assert.ok(runtimeSource.includes('var playbackRuntimeHelpersApi = interactionRuntime.playbackRuntimeHelpersApi;'));
  assert.ok(runtimeSource.includes('var forceUpdateUI = interactionRuntime.forceUpdateUI;'));

  [
    "import { configureRenderRuntime } from './render-runtime.js';",
    "import { initReaderPlaybackRuntime } from './reader-playback-runtime.js';",
    'export function initReaderInteractionRuntime',
    'configureRenderRuntime({',
    'var playbackRuntime = initReaderPlaybackRuntime({',
    'playbackRuntimeHelpersApi: playbackRuntime.playbackRuntimeHelpersApi',
    'forceUpdateUI: playbackRuntime.forceUpdateUI',
    'toggleAnnotationBubble: playbackRuntime.toggleAnnotationBubble',
    'handleBackwardClick: playbackRuntime.handleBackwardClick',
    'handleForwardClick: playbackRuntime.handleForwardClick'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `reader-interaction-runtime should own ${pattern}`);
  });
  assert.equal(moduleSource.includes('window.'), false, 'reader-interaction-runtime should receive window access through deps');
  assert.equal(moduleSource.includes('document.'), false, 'reader-interaction-runtime should not read document globals');

  [
    "import { renderTranscript, renderChunkMode } from './render-runtime.js';",
    'processTranscript(transcriptData);',
    'processChunkData(chunkData);',
    'window.toggleChunkMode(true);',
    'bridgeToPinia();'
  ].forEach((pattern) => {
    assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
  });

  const testableSource = moduleSource
    .replace(
      "import { configureRenderRuntime } from './render-runtime.js';\n",
      'function configureRenderRuntime(deps) { globalThis.__renderRuntimeDeps = deps }\n'
    )
    .replace(
      "import { initReaderPlaybackRuntime } from './reader-playback-runtime.js';\n",
      'function initReaderPlaybackRuntime(deps) { globalThis.__playbackRuntimeDeps = deps; return { playbackRuntimeHelpersApi: { jumpNextSentence: () => "next" }, forceUpdateUI: () => "force", toggleAnnotationBubble: () => "toggle", handleBackwardClick: () => "back", handleForwardClick: () => "forward" } }\n'
    );

  globalThis.__renderRuntimeDeps = null;
  globalThis.__playbackRuntimeDeps = null;

  const encodedSource = Buffer.from(testableSource, 'utf8').toString('base64');
  const { initReaderInteractionRuntime } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const deps = {
    bridgeToPinia: () => 'bridge',
    getTranscriptContainer: () => ({ id: 'transcript' }),
    getClozeMarkup: () => '<button>answer</button>',
    checkCloze: () => true,
    tryRestoreChunkNoteDraft: () => 'draft',
    runtimeState: { runtime: true },
    transcriptState: { segments: [] },
    chunkState: { chunkItems: [] },
    playbackState: { autoFollow: true },
    audioPlayer: { currentTime: 0 },
    mainAppArea: { id: 'main' },
    transcriptContainer: { id: 'legacy-transcript' },
    findChunkIndexByTimeHelper: () => 1,
    getCurrentSegmentIndexHelper: () => 2,
    getSegmentCheckpointsHelper: () => [0, 1],
    bsFindActiveHelper: () => 3,
    markedMap: new Map([[1, true]]),
    vocabMatchMap: new Map([[2, true]]),
    hasActiveTextSelectionWithinChunk: () => false,
    selectSentenceFromChunkTarget: () => 'select',
    openChunkNoteContextFromEvent: () => 'open',
    getSelection: () => 'selection',
    playbackModule: { init() {} },
    getWindow: () => ({})
  };

  const result = initReaderInteractionRuntime(deps);

  assert.equal(globalThis.__renderRuntimeDeps.bridgeToPinia, deps.bridgeToPinia);
  assert.equal(globalThis.__renderRuntimeDeps.getTranscriptContainer, deps.getTranscriptContainer);
  assert.equal(globalThis.__renderRuntimeDeps.getClozeMarkup(), '<button>answer</button>');
  assert.equal(globalThis.__renderRuntimeDeps.checkCloze(), true);
  assert.equal(globalThis.__renderRuntimeDeps.tryRestoreChunkNoteDraft, deps.tryRestoreChunkNoteDraft);
  assert.equal(globalThis.__playbackRuntimeDeps.runtimeState, deps.runtimeState);
  assert.equal(globalThis.__playbackRuntimeDeps.transcriptState, deps.transcriptState);
  assert.equal(globalThis.__playbackRuntimeDeps.chunkState, deps.chunkState);
  assert.equal(globalThis.__playbackRuntimeDeps.playbackState, deps.playbackState);
  assert.equal(globalThis.__playbackRuntimeDeps.audioPlayer, deps.audioPlayer);
  assert.equal(globalThis.__playbackRuntimeDeps.markedMap, deps.markedMap);
  assert.equal(globalThis.__playbackRuntimeDeps.vocabMatchMap, deps.vocabMatchMap);
  assert.equal(globalThis.__playbackRuntimeDeps.getSelection(), 'selection');
  assert.equal(result.playbackRuntimeHelpersApi.jumpNextSentence(), 'next');
  assert.equal(result.forceUpdateUI(), 'force');
  assert.equal(result.toggleAnnotationBubble(), 'toggle');
  assert.equal(result.handleBackwardClick(), 'back');
  assert.equal(result.handleForwardClick(), 'forward');

  console.log('reader interaction runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
