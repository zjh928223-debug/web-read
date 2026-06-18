const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'playback-runtime-helpers.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initPlaybackRuntimeHelpers } from './playback-runtime-helpers.js';"),
    'reader-runtime should import playback runtime helpers'
  );
  assert.ok(
    runtimeSource.includes('var playbackRuntimeHelpersApi = initPlaybackRuntimeHelpers({'),
    'reader-runtime should initialize playback runtime helpers through the module'
  );
  [
    'function findChunkIndexByTime(t)',
    'function swapActiveClass(nextEl, prevEl, className)',
    'function followPlaybackTarget(el)'
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
    'followPlaybackTarget: playbackRuntimeHelpersApi.followPlaybackTarget'
  ].forEach((pattern) => {
    assert.ok(
      runtimeSource.includes(pattern),
      `reader-runtime should inject playback helper API: ${pattern}`
    );
  });
  [
    'followPlaybackTarget',
    'swapActiveClass'
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
  const playbackState = { autoFollow: true, userScrollSuppress: false };
  const helperCalls = [];
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
    playbackState,
    mainAppArea: container,
    transcriptContainer: null,
    findChunkIndexByTimeHelper(items, time) {
      helperCalls.push({ items, time });
      return time >= 2 ? 1 : 0;
    },
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
