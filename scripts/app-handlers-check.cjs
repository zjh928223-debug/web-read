const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const appRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-app-runtime.js'), 'utf8');
const appHandlersSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'app-handlers.js'), 'utf8');
const sessionInitSource = [
  'session-runtime-assembly.js',
  'session-restore-runtime.js',
  'session-startup-runtime.js',
  'session-startup-cleanup.js',
  'session-ui-settings-restore.js',
  'session-annotation-api-settings-runtime.js',
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
  featureSource.includes('appHandlers: globalObject.__appHandlers'),
  'reader-feature-runtime should inject app-handlers into reader-app-runtime'
);

assert.equal(
  runtimeSource.includes('window.__appHandlers.initMarksImport({'),
  false,
  'reader-runtime should not initialize marks import directly'
);

assert.ok(
  appRuntimeSource.includes('deps.appHandlers.initMarksImport({'),
  'reader-app-runtime should initialize marks import through app-handlers'
);

[
  "importMarksBtn.addEventListener('click'",
  "importMarksInput.addEventListener('change'"
].forEach((pattern) => {
  assert.equal(
    runtimeSource.includes(pattern),
    false,
    `reader-runtime should not keep inline marks import binding: ${pattern}`
  );
});

assert.ok(
  appHandlersSource.includes('function initMarksImport(config)'),
  'app-handlers should own initMarksImport'
);

assert.ok(
  appHandlersSource.includes('...mark'),
  'app-handlers marks import should preserve imported mark fields'
);

const context = {
  window: {},
  console,
  Blob: function Blob() {},
  URL: { createObjectURL: () => 'blob:mock' },
  document: {
    body: {
      appendChild() {},
      removeChild() {}
    },
    createElement() {
      return { click() {} };
    }
  }
};
vm.createContext(context);
vm.runInContext(appHandlersSource, context, { filename: 'app-handlers.js' });

assert.equal(typeof context.window.__appHandlers.initMarksImport, 'function');

const listeners = {};
let inputClicked = false;
const importMarksBtn = {
  addEventListener(type, handler) {
    listeners[`btn:${type}`] = handler;
  }
};
const importMarksInput = {
  click() {
    inputClicked = true;
  },
  addEventListener(type, handler) {
    listeners[`input:${type}`] = handler;
  }
};
const markedMap = new Map();
let savedDb = null;
let rendered = '';
let forcedTime = null;
let synced = false;
let toast = '';

context.window.__appHandlers.initMarksImport({
  importMarksBtn,
  importMarksInput,
  getFirstFileFromEvent: () => ({ name: 'marks.json' }),
  readFileAsText: (file, callback) => callback(JSON.stringify([
    { globalIndex: 0, word: 'Hello', start: 1.25, end: 1.75, source: 'legacy-file', custom: 'kept' }
  ])),
  validateMarksArray: (items) => items,
  getWords: () => [{ word: 'Hello' }],
  markedMap,
  saveToDB: (id, value) => { savedDb = { id, value }; },
  isChunkModeFn: () => false,
  renderTranscript: () => { rendered = 'transcript'; },
  renderChunkMode: () => { rendered = 'chunk'; },
  forceUpdateUI: (time) => { forcedTime = time; },
  audioPlayer: { currentTime: 12.5 },
  syncAnnotationGenerationEntryStatus: () => { synced = true; },
  showToast: (message) => { toast = message; },
  showError: (code, message) => { throw new Error(`${code}: ${message}`); }
});

assert.equal(typeof listeners['btn:click'], 'function');
assert.equal(typeof listeners['input:change'], 'function');

listeners['btn:click']();
assert.equal(inputClicked, true, 'marks import button should trigger the file input');

listeners['input:change']({});

assert.equal(markedMap.size, 1);
assert.deepEqual(JSON.parse(JSON.stringify(markedMap.get(0))), {
  globalIndex: 0,
  word: 'Hello',
  start: 1.25,
  end: 1.75,
  source: 'legacy-file',
  custom: 'kept',
  sourceType: 'legacy-file'
});
assert.equal(savedDb.id, 'marks');
assert.deepEqual(JSON.parse(JSON.stringify(savedDb.value)), [JSON.parse(JSON.stringify(markedMap.get(0)))]);
assert.equal(rendered, 'transcript');
assert.equal(forcedTime, 12.5);
assert.equal(synced, true);
assert.equal(toast, 'Marks imported');

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

console.log('app handlers check passed');
