const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
  const interactionRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-interaction-runtime.js'), 'utf8');
  const readerPlaybackSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-playback-runtime.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'playback-runtime-helpers.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeShell } from './reader-runtime-shell.js';"),
    'reader-runtime should delegate playback helpers through reader-runtime-shell'
  );
  assert.ok(
    shellSource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
    'reader-runtime-shell should initialize playback helpers through reader-feature-runtime'
  );
  assert.ok(
    featureSource.includes('var playbackRuntimeHelpersApi = interactionRuntime.playbackRuntimeHelpersApi;'),
    'reader-feature-runtime should receive playback runtime helpers through the interaction module'
  );
  [
    'function findChunkIndexByTime(t)',
    'function swapActiveClass(nextEl, prevEl, className)',
    'function followPlaybackTarget(el)',
    'function jumpPrevSentence()',
    'function jumpNextSentence()'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own playback helper: ${pattern}`
    );
  });
  [
    'findChunkIndexByTime: playbackRuntimeHelpersApi.findChunkIndexByTime',
    'swapActiveClass: playbackRuntimeHelpersApi.swapActiveClass',
    'followPlaybackTarget: playbackRuntimeHelpersApi.followPlaybackTarget',
    'jumpPrevSentence: playbackRuntimeHelpersApi.jumpPrevSentence',
    'jumpNextSentence: playbackRuntimeHelpersApi.jumpNextSentence'
  ].forEach((pattern) => {
    assert.ok(
      readerPlaybackSource.includes(pattern),
      `reader-playback-runtime should inject playback helper API: ${pattern}`
    );
  });
  assert.equal(runtimeSource.includes('initPlaybackRuntimeHelpers({'), false);
  assert.ok(interactionRuntimeSource.includes("import { initReaderPlaybackRuntime } from './reader-playback-runtime.js';"));
  assert.ok(interactionRuntimeSource.includes('var playbackRuntime = initReaderPlaybackRuntime({'));
  assert.ok(interactionRuntimeSource.includes('playbackRuntimeHelpersApi: playbackRuntime.playbackRuntimeHelpersApi'));
  assert.ok(readerPlaybackSource.includes("import { initPlaybackRuntimeHelpers } from './playback-runtime-helpers.js'"));
  assert.ok(readerPlaybackSource.includes('var playbackRuntimeHelpersApi = initPlaybackRuntimeHelpers({'));
  [
    'followPlaybackTarget',
    'swapActiveClass',
    'jumpPrevSentence',
    'jumpNextSentence'
  ].forEach((pattern) => {
    assert.equal(
      sessionInitSource.includes(pattern),
      false,
      `session-init should not depend on playback runtime helper: ${pattern}`
    );
  });

  assert.ok(
    moduleSource.includes('export function initPlaybackRuntimeHelpers'),
    'playback runtime helpers module should export initPlaybackRuntimeHelpers'
  );

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const { initPlaybackRuntimeHelpers } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const chunkState = { chunkItems: [{ start: 0 }, { start: 2 }] };
  const transcriptState = {
    segments: [{ start: 0 }, { start: 5 }, { start: 10 }],
    words: [],
    wordStarts: []
  };
  const playbackState = {
    autoFollow: true,
    userScrollSuppress: false,
    lastSentencePrevTapSegIndex: -1,
    lastSentencePrevTapAt: 0
  };
  const audioPlayer = { currentTime: 6 };
  const helperCalls = [];
  const forceUpdateCalls = [];
  let currentSegmentIndex = 1;
  let now = 1000;
  const scrollCalls = [];
  const container = {
    clientHeight: 600,
    scrollTop: 120,
    getBoundingClientRect() {
      return { top: 10, bottom: 610, height: 600 };
    },
    scrollTo(options) {
      scrollCalls.push(options);
    }
  };
  const api = initPlaybackRuntimeHelpers({
    chunkState,
    transcriptState,
    playbackState,
    audioPlayer,
    mainAppArea: container,
    transcriptContainer: null,
    findChunkIndexByTimeHelper(items, time) {
      helperCalls.push({ items, time });
      return time >= 2 ? 1 : 0;
    },
    getCurrentSegmentIndexHelper(segments, words, wordStarts, time) {
      helperCalls.push({ segments, words, wordStarts, time });
      return currentSegmentIndex;
    },
    getForceUpdateUI: () => (time) => forceUpdateCalls.push(time),
    getNow: () => now,
    getWindow: () => ({ innerHeight: 900 })
  });

  assert.equal(api.findChunkIndexByTime(3), 1);
  assert.equal(helperCalls[0].items, chunkState.chunkItems);
  assert.equal(helperCalls[0].time, 3);

  const events = [];
  const prevEl = {
    classList: {
      remove(className) { events.push(`prev.remove:${className}`); }
    }
  };
  const nextEl = {
    classList: {
      add(className) { events.push(`next.add:${className}`); },
      remove(className) { events.push(`next.remove:${className}`); }
    }
  };
  assert.equal(api.swapActiveClass(nextEl, prevEl, 'active'), nextEl);
  assert.deepEqual(events, ['prev.remove:active', 'next.add:active']);
  assert.equal(api.swapActiveClass(null, nextEl, 'active'), null);

  const target = {
    getBoundingClientRect() {
      return { top: 560, bottom: 650 };
    },
    scrollIntoView() {
      throw new Error('scrollIntoView should not be called when container is available');
    }
  };
  api.followPlaybackTarget(target);
  assert.equal(scrollCalls.length, 1);
  assert.deepEqual(scrollCalls[0], { top: 622, behavior: 'auto' });

  playbackState.userScrollSuppress = true;
  api.followPlaybackTarget(target);
  assert.equal(scrollCalls.length, 1);

  playbackState.userScrollSuppress = false;
  audioPlayer.currentTime = 6;
  currentSegmentIndex = 1;
  now = 1000;
  api.jumpPrevSentence();
  assert.equal(audioPlayer.currentTime, 5);
  assert.equal(playbackState.lastSentencePrevTapSegIndex, 1);
  assert.equal(playbackState.lastSentencePrevTapAt, 1000);
  assert.deepEqual(forceUpdateCalls, [5]);

  audioPlayer.currentTime = 5.2;
  now = 1200;
  api.jumpPrevSentence();
  assert.equal(audioPlayer.currentTime, 0);
  assert.equal(playbackState.lastSentencePrevTapSegIndex, -1);
  assert.equal(playbackState.lastSentencePrevTapAt, 0);
  assert.deepEqual(forceUpdateCalls, [5, 0]);

  audioPlayer.currentTime = 5.2;
  currentSegmentIndex = 1;
  api.jumpNextSentence();
  assert.equal(audioPlayer.currentTime, 10);
  assert.equal(playbackState.lastSentencePrevTapSegIndex, -1);
  assert.equal(playbackState.lastSentencePrevTapAt, 0);
  assert.deepEqual(forceUpdateCalls, [5, 0, 10]);

  const fallbackCalls = [];
  const fallbackApi = initPlaybackRuntimeHelpers({
    chunkState,
    playbackState: { autoFollow: true, userScrollSuppress: false },
    mainAppArea: null,
    transcriptContainer: null,
    findChunkIndexByTimeHelper: () => -1
  });
  fallbackApi.followPlaybackTarget({
    scrollIntoView(options) {
      fallbackCalls.push(options);
    }
  });
  assert.deepEqual(fallbackCalls, [{ behavior: 'auto', block: 'nearest' }]);
}

main().then(() => {
  console.log('playback runtime helpers check passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
