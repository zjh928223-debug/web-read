const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const keyboardRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-keyboard-runtime.js'), 'utf8');
const marksStoreSource = fs.readFileSync(path.join(repoRoot, 'src', 'stores', 'marks.js'), 'utf8');
const keyboardSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'keyboard-module.js'), 'utf8');
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

[
  'syncMarkedWordVisual',
  'toggleMarkCurrent'
].forEach((name) => {
  assert.equal(
    new RegExp(`function\\s+${name}\\s*\\(`).test(runtimeSource),
    false,
    `reader-runtime should not keep ${name} wrapper`
  );
});

assert.equal(
  runtimeSource.includes('window.__marksStore.syncMarkedWordVisual'),
  false,
  'reader-runtime should not call the marks visual helper directly'
);

assert.ok(
  featureSource.includes('marksStore: globalObject.__marksStore'),
  'reader-feature-runtime should inject the marks store into keyboard runtime'
);

assert.ok(
  keyboardRuntimeSource.includes('deps.marksStore.toggleMark('),
  'reader-keyboard-runtime should inject keyboard mark toggle through the marks store'
);

assert.ok(
  marksStoreSource.includes('function syncMarkedWordVisual(globalIndex, isMarked)'),
  'marks store should own mark visual sync'
);

assert.ok(
  marksStoreSource.includes('function toggleMark(markedMap, currentWordIndex, words, saveToDB, syncAnnotationGenerationEntryStatus)'),
  'marks store should own mark toggle behavior'
);

assert.ok(
  keyboardSource.includes('var toggleMarkCurrent = deps.toggleMarkCurrent;'),
  'keyboard module should still receive mark toggle as an injected dependency'
);

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

console.log('marks store check passed');
