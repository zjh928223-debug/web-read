const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const audioStoreSource = fs.readFileSync(path.join(repoRoot, 'src', 'stores', 'audio.js'), 'utf8');
const playbackSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'playback-module.js'), 'utf8');
const controlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'controls-module.js'), 'utf8');
const chunkControlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'chunk-controls-module.js'), 'utf8');
const highlightControlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'highlight-controls-module.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'style-editor.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

const allowedAppWindowAssignments = new Set([
  '__USE_VUE_RENDERING',
  '__state',
  'openChunkNoteStyleModal',
  'closeChunkNoteStyleModal',
  'updateChunkNoteStyle',
  'showToast',
  'showError',
  'bridgeToPinia',
  'processTranscript',
  'selectSentenceFromChunkTarget',
  'openChunkNoteContextFromEvent',
  'notifyAnnotationBubbleWordClick',
  'isInputLikeTarget',
  'adjustChunkNoteArrowSizeByGap',
  'getAnnotationGenerationScope',
  'buildCurrentSentenceDocId',
  'clearGeneratedAnnotationIndex',
  'loadChunkNotesForCurrentAudio',
  'setChunkNoteVisible',
  'loadSentenceNotesForCurrentAudio',
  'switchSentenceNotesDoc',
  'applyCurrentAudioMeta',
  'clearPersistedChunkSession',
  'emitAnnotationDiagnostics',
  'scheduleGeneratedAnnotationIndexRefresh',
  'syncAnnotationGenerationEntryStatus',
  'initAnnotationApiSettingsUi',
  'processChunkData'
]);

const appWindowAssignments = Array.from(appSource.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g), (match) => match[1]);
appWindowAssignments.forEach((name) => {
  assert.ok(allowedAppWindowAssignments.has(name), `app.js should not assign unexpected window.${name}`);
});

[
  'handleBackwardClick',
  'handleForwardClick',
  'forceUpdateUI',
  'mainUpdateHighlight',
  'changeSpeed',
  'toggleChunkBtn',
  'toggleChunkMode',
  'toggleChunkFocusMode',
  'toggleChunkShadowManual',
  'updateChunkCnHoldBtn',
  'cycleHighlightMode',
  'initDB',
  'saveToDB',
  'loadFromDB',
  'deleteFromDB',
  'clearDBStore',
  'openChunkStyleModal',
  'closeChunkStyleModal',
  'updateChunkStyle'
].forEach((name) => {
  assert.equal(
    appSource.includes(`window.${name} =`),
    false,
    `app.js should not duplicate window.${name} facade ownership`
  );
});

[
  'handleBackwardClick',
  'handleForwardClick',
  'forceUpdateUI',
  'mainUpdateHighlight'
].forEach((name) => {
  assert.ok(playbackSource.includes(`window.${name} = ${name};`), `playback-module should own window.${name}`);
});

assert.ok(controlsSource.includes('window.changeSpeed = changeSpeed;'), 'controls-module should own window.changeSpeed');
assert.equal(sessionInitSource.includes('window.toggleChunkBtn'), false, 'session-init should not read window.toggleChunkBtn');
[
  'initDB',
  'saveToDB',
  'loadFromDB',
  'deleteFromDB',
  'clearDBStore'
].forEach((name) => {
  assert.ok(audioStoreSource.includes(`window.${name} = function`), `audio store should own window.${name}`);
});
assert.ok(
  highlightControlsSource.includes('window.cycleHighlightMode = cycleHighlightMode;'),
  'highlight-controls-module should own window.cycleHighlightMode'
);

[
  'toggleChunkMode',
  'toggleChunkFocusMode',
  'toggleChunkShadowManual',
  'updateChunkCnHoldBtn'
].forEach((name) => {
  assert.ok(chunkControlsSource.includes(`window.${name} = ${name};`), `chunk-controls-module should own window.${name}`);
});

[
  'openChunkStyleModal',
  'closeChunkStyleModal',
  'updateChunkStyle'
].forEach((name) => {
  assert.ok(styleSource.includes(`window.${name} = ${name};`), `style-editor should own window.${name}`);
});

console.log('app window facades check passed');
