const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const uiFacadesSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'ui-facades.js'), 'utf8');
const renderModeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'render-mode.js'), 'utf8');
const runtimeStateFacadeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'runtime-state-facade.js'), 'utf8');
const audioStoreSource = fs.readFileSync(path.join(repoRoot, 'src', 'stores', 'audio.js'), 'utf8');
const notesModuleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'notes-module.js'), 'utf8');
const keyboardModuleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'keyboard-module.js'), 'utf8');
const importModuleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'import-module.js'), 'utf8');
const piniaBridgeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'pinia-bridge-module.js'), 'utf8');
const annotationBubbleResolverSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'annotation-bubble-resolver.js'), 'utf8');
const readerPublicFacadesSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-public-facades.js'), 'utf8');
const playbackSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'playback-module.js'), 'utf8');
const controlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'controls-module.js'), 'utf8');
const chunkControlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'chunk-controls-module.js'), 'utf8');
const highlightControlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'highlight-controls-module.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'style-editor.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');
const sessionFacadesSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-facades.js'), 'utf8');

const allowedAppWindowAssignments = new Set([]);

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
  'showToast',
  'showError',
  '__USE_VUE_RENDERING',
  '__state',
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
  'openChunkNoteStyleModal',
  'closeChunkNoteStyleModal',
  'updateChunkNoteStyle',
  'adjustChunkNoteArrowSizeByGap',
  'isInputLikeTarget',
  'processTranscript',
  'processChunkData',
  'bridgeToPinia',
  'getAnnotationGenerationScope',
  'clearGeneratedAnnotationIndex',
  'clearPersistedChunkSession',
  'emitAnnotationDiagnostics',
  'scheduleGeneratedAnnotationIndexRefresh',
  'syncAnnotationGenerationEntryStatus',
  'initAnnotationApiSettingsUi',
  'notifyAnnotationBubbleWordClick',
  'selectSentenceFromChunkTarget',
  'openChunkNoteContextFromEvent',
  'buildCurrentSentenceDocId',
  'loadChunkNotesForCurrentAudio',
  'setChunkNoteVisible',
  'loadSentenceNotesForCurrentAudio',
  'switchSentenceNotesDoc',
  'applyCurrentAudioMeta',
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
assert.ok(uiFacadesSource.includes('window.showToast = showToast;'), 'ui-facades should own window.showToast');
assert.ok(uiFacadesSource.includes('window.showError = showError;'), 'ui-facades should own window.showError');
assert.ok(renderModeSource.includes('window.__USE_VUE_RENDERING = true;'), 'render-mode should own the default window.__USE_VUE_RENDERING value');
assert.ok(runtimeStateFacadeSource.includes('window.__state = runtimeState;'), 'runtime-state-facade should own window.__state');
assert.equal(sessionInitSource.includes('window.toggleChunkBtn'), false, 'session-init should not read window.toggleChunkBtn');
assert.ok(
  keyboardModuleSource.includes('window.isInputLikeTarget = isInputLikeTarget;'),
  'keyboard-module should own window.isInputLikeTarget'
);
[
  'processTranscript',
  'processChunkData'
].forEach((name) => {
  assert.ok(importModuleSource.includes(`window.${name} = ${name};`), `import-module should own window.${name}`);
});
assert.ok(
  piniaBridgeSource.includes('window.bridgeToPinia = bridgeToPinia;'),
  'pinia-bridge-module should own window.bridgeToPinia'
);
assert.ok(
  annotationBubbleResolverSource.includes('window.notifyAnnotationBubbleWordClick = notifyAnnotationBubbleWordClick;'),
  'annotation-bubble-resolver should own window.notifyAnnotationBubbleWordClick'
);
[
  'selectSentenceFromChunkTarget',
  'openChunkNoteContextFromEvent',
  'buildCurrentSentenceDocId',
  'loadChunkNotesForCurrentAudio',
  'setChunkNoteVisible',
  'loadSentenceNotesForCurrentAudio',
  'switchSentenceNotesDoc',
  'applyCurrentAudioMeta'
].forEach((name) => {
  assert.ok(readerPublicFacadesSource.includes(`window.${name} = ${name};`), `reader-public-facades should own window.${name}`);
});
[
  'getAnnotationGenerationScope',
  'clearGeneratedAnnotationIndex',
  'clearPersistedChunkSession',
  'emitAnnotationDiagnostics',
  'scheduleGeneratedAnnotationIndexRefresh',
  'syncAnnotationGenerationEntryStatus',
  'initAnnotationApiSettingsUi'
].forEach((name) => {
  assert.ok(sessionFacadesSource.includes(`window.${name} = ${name};`), `session-facades should own window.${name}`);
});
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
  'openChunkNoteStyleModal',
  'closeChunkNoteStyleModal',
  'updateChunkNoteStyle',
  'adjustChunkNoteArrowSizeByGap'
].forEach((name) => {
  assert.ok(notesModuleSource.includes(`window.${name} = ${name};`), `notes-module should own window.${name}`);
});

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
