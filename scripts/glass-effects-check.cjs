const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const appRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-app-runtime.js'), 'utf8');
const glassEffectsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'glass-effects.js'), 'utf8');
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
  'reader-runtime should delegate reader-app-runtime through reader-runtime-assembly'
);
assert.ok(
  assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime-assembly should delegate reader-app-runtime through reader-feature-runtime'
);
assert.ok(
  featureSource.includes("import { initReaderAppRuntime } from './reader-app-runtime.js';"),
  'reader-feature-runtime should import reader-app-runtime'
);

assert.equal(
  runtimeSource.includes("import { initGlassEffects } from './glass-effects.js';"),
  false,
  'reader-runtime should not import initGlassEffects directly'
);

assert.ok(
  appRuntimeSource.includes("import { initGlassEffects } from './glass-effects.js'"),
  'reader-app-runtime should import initGlassEffects'
);

assert.ok(
  appRuntimeSource.includes('initGlassEffects()'),
  'reader-app-runtime should initialize glass effects through the module'
);

assert.equal(glassEffectsSource.includes('lockChunkNoteDimensions'), false, 'retired notes sizing hook should stay removed');
assert.equal(glassEffectsSource.includes('__lockChunkNoteDimensionsForTheme'), false, 'retired notes global should stay removed');

assert.equal(
  runtimeSource.includes('window.__glassEffects.init('),
  false,
  'reader-runtime should not initialize glass effects through the window facade'
);

assert.ok(
  glassEffectsSource.includes('return init();'),
  'glass-effects module should initialize the glass runtime directly'
);

assert.ok(
  glassEffectsSource.includes('export function initGlassEffects'),
  'glass-effects should export initGlassEffects'
);

function verifyGlassLifecycle() {
  class FakeElement {
    constructor(matches = []) {
      this.matchesSet = new Set(matches);
      this.dataset = {};
      this.listeners = new Map();
      this.children = [];
      this.classList = { add() {}, remove() {} };
      this.style = { setProperty() {} };
    }
    matches(selector) { return selector.split(', ').some((item) => this.matchesSet.has(item)); }
    querySelectorAll(selector) { return this.children.filter((child) => child.matches(selector)); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type, listener) {
      if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  }

  const panel = new FakeElement(['.controls']);
  const button = new FakeElement(['button']);
  const root = new FakeElement();
  root.children.push(panel, button);
  let observerTarget = null;
  let observerDisconnected = 0;
  const observers = [];
  class FakeObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { observerTarget = target; }
    disconnect() { observerDisconnected += 1; }
  }
  let nextRaf = 1;
  const rafCallbacks = new Map();
  const context = {
    window: {},
    document: {
      body: new FakeElement(),
      getElementById(id) { return id === 'main-app-area' ? root : null; },
      querySelectorAll(selector) { return root.querySelectorAll(selector); }
    },
    Element: FakeElement,
    MutationObserver: FakeObserver,
    requestAnimationFrame(callback) { const id = nextRaf++; rafCallbacks.set(id, callback); return id; },
    cancelAnimationFrame(id) { rafCallbacks.delete(id); },
    Number,
    Math,
    console
  };
  const executable = glassEffectsSource
    .replace('export function initGlassEffects', 'function initGlassEffects')
    + '\nthis.__initGlassEffects = initGlassEffects;';
  vm.runInNewContext(executable, context);
  const deps = { listChunkNotes: () => [], getChunkNoteTagById: () => null, getChunkNoteContentBoxSize: () => null };

  const disposeFirst = context.__initGlassEffects(deps);
  assert.equal(typeof disposeFirst, 'function');
  assert.equal(observerTarget, root, 'observer should use the bounded reader root');
  assert.equal(panel.listeners.size, 3);
  const disposeSecond = context.__initGlassEffects(deps);
  assert.equal(observerDisconnected, 1, 'reinitialization should dispose the previous observer');
  assert.equal(panel.listeners.size, 3, 'reinitialization should not duplicate pointer listeners');
  disposeSecond();
  assert.equal(observerDisconnected, 2);
  assert.equal(panel.listeners.size, 0, 'dispose should remove pointer listeners');
}

verifyGlassLifecycle();

[
  "deps.processTranscript(transcriptData);",
  "deps.processChunkData(chunkData);",
  "windowObject.toggleChunkMode(true);",
  "deps.bridgeToPinia();"
].forEach((pattern) => {
  assert.ok(
    sessionInitSource.includes(pattern),
    `session-init contract should remain intact: ${pattern}`
  );
});

console.log('glass effects check passed');
