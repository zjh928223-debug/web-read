async function main() {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');

  const repoRoot = path.resolve(__dirname, '..');
  const sourcePath = path.join(repoRoot, 'src', 'composables', 'chunk-state.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    window: {},
    Set,
    Number,
    Object,
    Array,
    console,
  };

  const previousWindow = globalThis.window;
  try {
    globalThis.window = sandbox.window;
    // Load the actual ES module graph in this CommonJS test without changing package type.
    const registrySource = fs.readFileSync(path.join(repoRoot, 'src/pinia-stores/runtime-registry.js'), 'utf8');
    const registryUrl = `data:text/javascript;base64,${Buffer.from(registrySource).toString('base64')}`;
    const moduleSource = source.replace('../pinia-stores/runtime-registry.js', registryUrl);
    await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  const api = sandbox.window.__chunkState;
  assert.ok(api, 'chunk state adapter should attach to window');
  assert.equal(typeof api.bindPiniaStore, 'function');
  assert.equal(typeof api.getSnapshot, 'function');
  assert.equal(Object.hasOwn(api, 'manualChunkStates'), false);
  assert.equal(Object.hasOwn(api.getSnapshot(), 'manualChunkStates'), false);
  assert.doesNotMatch(fs.readFileSync(path.join(repoRoot, 'src/pinia-stores/chunk.js'), 'utf8'), /manualChunkStates/);

  assert.equal(api.isChunkMode, false);
  assert.equal(Array.isArray(api.chunkItems), true);
  assert.equal(api.chunkItems.length, 0);
  assert.equal(api.hasAiChunkData, false);
  assert.equal(api.chunkCnVisible, false);
  assert.equal(api.chunkCnHoldMode, true);
  assert.equal(api.chunkCnMode, 'focus');
  assert.equal(api.isChunkShadowOn, true);
  assert.equal(api.lastActiveChunkIndex, -1);
  assert.equal(api.lastAiPrevTapChunkIndex, -1);
  assert.equal(api.lastAiPrevTapAt, 0);

  api.isChunkMode = true;
  api.chunkItems = [{ start: 1, end: 2, ch: 'one' }];
  api.hasAiChunkData = true;
  api.chunkCnVisible = true;
  api.chunkCnHoldMode = false;
  api.chunkCnMode = 'global';
  api.isChunkShadowOn = false;
  api.lastActiveChunkIndex = 2;
  api.lastAiPrevTapChunkIndex = 1;
  api.lastAiPrevTapAt = 123;

  const store = {
    isChunkMode: false,
    chunkItems: [],
    hasAiChunkData: false,
    activeChunkIdx: -1,
    chunkCNVisible: false,
    chunkCNHoldMode: true,
    chunkFocusMode: true,
    chunkShadowVisible: true,
    isHoldingChunkCn: false,
    holdPrevChunkCnVisible: null,
    lastAiPrevTapChunkIndex: -1,
    lastAiPrevTapAt: 0,
  };

  api.bindPiniaStore(store);
  assert.equal(store.isChunkMode, true);
  assert.equal(store.chunkItems.length, 1);
  assert.equal(store.hasAiChunkData, true);
  assert.equal(store.chunkCNVisible, true);
  assert.equal(store.chunkCNHoldMode, false);
  assert.equal(store.chunkFocusMode, false);
  assert.equal(store.chunkShadowVisible, false);
  assert.equal(store.activeChunkIdx, 2);
  assert.equal(store.lastAiPrevTapChunkIndex, 1);
  assert.equal(store.lastAiPrevTapAt, 123);

  api.chunkCnMode = 'focus';
  api.isChunkShadowOn = true;
  api.lastActiveChunkIndex = 4;
  assert.equal(store.chunkFocusMode, true);
  assert.equal(store.chunkShadowVisible, true);
  assert.equal(store.activeChunkIdx, 4);

  store.isChunkMode = false;
  store.chunkItems = [{ start: 5, end: 6, ch: 'two' }];
  store.hasAiChunkData = true;
  store.chunkCNVisible = false;
  store.chunkCNHoldMode = true;
  store.chunkFocusMode = false;
  store.chunkShadowVisible = false;
  store.activeChunkIdx = 6;
  api.bindPiniaStore(store, { preferStore: true });
  assert.equal(api.isChunkMode, false);
  assert.equal(api.chunkItems[0].start, 5);
  assert.equal(api.hasAiChunkData, true);
  assert.equal(api.chunkCnVisible, false);
  assert.equal(api.chunkCnHoldMode, true);
  assert.equal(api.chunkCnMode, 'global');
  assert.equal(api.isChunkShadowOn, false);
  assert.equal(api.lastActiveChunkIndex, 6);

  api.chunkItems = 'invalid';
  api.chunkCnMode = 'invalid';
  api.holdPrevChunkCnVisible = null;
  api.lastActiveChunkIndex = 'bad';
  api.lastAiPrevTapChunkIndex = 'bad';
  api.lastAiPrevTapAt = 'bad';
  assert.equal(Array.isArray(api.chunkItems), true);
  assert.equal(api.chunkItems.length, 0);
  assert.equal(api.chunkCnMode, 'focus');
  assert.equal(api.holdPrevChunkCnVisible, null);
  assert.equal(api.lastActiveChunkIndex, -1);
  assert.equal(api.lastAiPrevTapChunkIndex, -1);
  assert.equal(api.lastAiPrevTapAt, 0);

  console.log('chunk state check passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
