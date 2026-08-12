const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const appRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-app-runtime.js'), 'utf8');
const readerPlaybackSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-playback-runtime.js'), 'utf8');
const controlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'controls-module.js'), 'utf8');
const playbackSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'playback-module.js'), 'utf8');

[
  ['controls-module.js', controlsSource],
  ['playback-module.js', playbackSource]
].forEach(([fileName, source]) => {
  assert.equal(
    source.includes('window.__state'),
    false,
    `${fileName} should receive state through deps instead of reading window.__state`
  );
  assert.ok(
    source.includes('var state = deps.state;'),
    `${fileName} should bind deps.state explicitly`
  );
});

assert.ok(
  /deps\.playbackModule\.init\(\{\s*state:\s*deps\.runtimeState,/m.test(readerPlaybackSource),
  'reader-playback-runtime should pass explicit runtimeState into playback-module'
);

assert.ok(
  /deps\.controlsModule\.init\(\{\s*state:\s*deps\.runtimeState,/m.test(appRuntimeSource),
  'reader-app-runtime should pass explicit runtimeState into controls-module'
);

runControlsLoopBehaviorCheck();

console.log('control/playback state dependency check passed');

function runControlsLoopBehaviorCheck() {
  const raf = createRafHarness();
  const documentTarget = createEventTarget();
  documentTarget.hidden = false;
  documentTarget.querySelectorAll = () => [];
  const firstAudio = createMediaTarget();
  const mainAppArea = createEventTarget();
  const windowObject = {
    document: documentTarget,
    requestAnimationFrame: raf.request,
    cancelAnimationFrame: raf.cancel,
    mainUpdateHighlight() {},
  };
  const context = {
    window: windowObject,
    document: documentTarget,
    requestAnimationFrame: raf.request,
    cancelAnimationFrame: raf.cancel,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(controlsSource, context, { filename: 'controls-module.js' });

  const controller = windowObject.__controlsModule.init(createDeps(firstAudio, mainAppArea));
  assert.equal(typeof controller.dispose, 'function');
  assert.equal(raf.pending(), 0, 'paused media must not keep a permanent rAF loop');

  firstAudio.paused = false;
  firstAudio.dispatch('playing');
  assert.equal(raf.pending(), 1);
  firstAudio.dispatch('playing');
  assert.equal(raf.pending(), 1, 'duplicate playing events must not stack rAF');
  raf.runNext();
  assert.equal(raf.pending(), 1, 'playing media schedules the next frame recursively');

  firstAudio.paused = true;
  firstAudio.dispatch('pause');
  assert.equal(raf.pending(), 0);
  firstAudio.paused = false;
  firstAudio.dispatch('playing');
  assert.equal(raf.pending(), 1);
  documentTarget.hidden = true;
  documentTarget.dispatch('visibilitychange');
  assert.equal(raf.pending(), 0, 'hidden document must stop playback rAF');
  documentTarget.hidden = false;
  documentTarget.dispatch('visibilitychange');
  assert.equal(raf.pending(), 1, 'visible playing media may resume playback rAF');

  firstAudio.dispatch('ended');
  assert.equal(raf.pending(), 0);
  const secondAudio = createMediaTarget();
  const secondDeps = createDeps(secondAudio, mainAppArea);
  const second = windowObject.__controlsModule.init(secondDeps);
  firstAudio.paused = false;
  firstAudio.dispatch('playing');
  assert.equal(raf.pending(), 0, 'repeated init must dispose the previous controller');
  secondAudio.paused = false;
  secondAudio.dispatch('playing');
  assert.equal(raf.pending(), 1);
  mainAppArea.dispatch('wheel');
  assert.equal(secondDeps.state.userScrollSuppress, true);
  second.dispose();
  assert.equal(raf.pending(), 0);
  assert.equal(secondDeps.state.userScrollSuppress, false, 'dispose must restore follow-playback after canceling the wheel timer');
  secondAudio.dispatch('playing');
  assert.equal(raf.pending(), 0, 'disposed controller must not schedule again');

  const physicalAudio = createMediaTarget();
  const physicalVideo = createMediaTarget();
  let activeMedia = physicalAudio;
  const mediaSourceListeners = new Set();
  windowObject.__mediaSource = {
    createActiveMediaProxy() {
      return {
        __isActiveMediaProxy: true,
        get paused() { return activeMedia.paused; },
        get currentTime() { return activeMedia.currentTime; },
      };
    },
    getActiveMediaElement() { return activeMedia; },
    subscribe(listener) {
      mediaSourceListeners.add(listener);
      listener();
      return () => mediaSourceListeners.delete(listener);
    },
  };
  const switchedController = windowObject.__controlsModule.init(createDeps(physicalAudio, mainAppArea));
  assert.equal(raf.pending(), 0);
  physicalVideo.paused = false;
  activeMedia = physicalVideo;
  for (const listener of [...mediaSourceListeners]) listener();
  assert.equal(raf.pending(), 1, 'switching to an already-playing video must start the playback loop');
  physicalAudio.dispatch('pause');
  assert.equal(raf.pending(), 1, 'inactive audio events must be detached after switching to video');
  physicalVideo.paused = true;
  physicalVideo.dispatch('pause');
  assert.equal(raf.pending(), 0, 'active video pause must stop the playback loop');
  switchedController.dispose();
  assert.equal(mediaSourceListeners.size, 0, 'dispose must remove the media-source subscription');
}

function createDeps(audioPlayer, mainAppArea) {
  return {
    state: {
      wordStarts: [],
      words: [],
      segments: [],
      isChunkMode: false,
      highlightMode: 1,
      playbackUiSignature: '',
    },
    audioPlayer,
    bsFindActiveHelper: () => -1,
    findChunkIndexByTime: () => -1,
    getCurrentSegmentIndexHelper: () => -1,
    toggleFollowBtn: null,
    mainAppArea,
  };
}

function createRafHarness() {
  let sequence = 0;
  const callbacks = new Map();
  return {
    request(callback) {
      const id = ++sequence;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) { callbacks.delete(id); },
    pending() { return callbacks.size; },
    runNext() {
      const [id, callback] = callbacks.entries().next().value;
      callbacks.delete(id);
      callback(16);
    },
  };
}

function createMediaTarget() {
  return Object.assign(createEventTarget(), {
    paused: true,
    currentTime: 0,
    playbackRate: 1,
  });
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type) { for (const listener of [...(listeners.get(type) || [])]) listener(); },
  };
}
