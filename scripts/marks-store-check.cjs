const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const marksStoreSource = fs.readFileSync(path.join(repoRoot, 'src', 'stores', 'marks.js'), 'utf8');
const keyboardSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'keyboard-module.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

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
  runtimeSource.includes('window.__marksStore.toggleMark(marksStateApi.markedMap, _tr.currentWordIndex, _tr.words, saveToDB, syncAnnotationGenerationEntryStatus);'),
  'reader-runtime should inject keyboard mark toggle through the marks store'
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
  "processTranscript(transcriptData);",
  "processChunkData(chunkData);",
  "window.toggleChunkMode(true);",
  "bridgeToPinia();"
].forEach((pattern) => {
  assert.ok(
    sessionInitSource.includes(pattern),
    `session-init contract should remain intact: ${pattern}`
  );
});

console.log('marks store check passed');
