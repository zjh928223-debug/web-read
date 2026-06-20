const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const readerChunkNoteRuntimeSource = [
  'reader-feature-runtime.js',
  'reader-keyboard-runtime.js',
  'reader-app-runtime.js'
].map((file) => fs.readFileSync(path.join(repoRoot, 'src', 'composables', file), 'utf8')).join('\n');
const notesSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'notes-module.js'), 'utf8');
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
  'saveChunkNotesDebounced',
  'getChunkBlockByRef',
  'openChunkNoteContextMenu',
  'getChunkNoteAccent',
  'clearChunkWordAnnotations',
  'markChunkWordsByNotes',
  'setChunkNoteHoverTarget',
  'persistChunkNoteDraft',
  'getChunkNoteModalPosition',
  'applyTempAnnotationByCtx',
  'buildChunkNotesSnapshot',
  'saveChunkNotesNow',
  'closeChunkNoteContextMenu',
  'setSelectedChunkNote',
  'closeChunkNoteDeleteDialog',
  'openChunkNoteDeleteDialog',
  'saveChunkNoteFromModal',
  'cancelChunkNoteModal',
  'openChunkNotePopover',
  'clearChunkNoteConnectors',
  'getChunkWordSpan',
  'getChunkNoteTagById',
  'ensureChunkNoteOverlayLayers',
  'rectToMainAreaSpace',
  'pointToMainAreaSpace',
  'syncChunkNoteOverlaySize',
  'clearChunkNoteDraft',
  'getRangeAnchorRectByGlobals',
  'tryRestoreChunkNoteDraft',
  'getChunkNoteLayoutBase',
  'getChunkNoteContentBoxSize',
  'ensureChunkNoteLayout',
  'syncChunkNoteTagToAnchor',
  'refreshChunkNoteTagPositions',
  'scheduleChunkNoteLayoutRefresh',
  'applyChunkNoteTextStyle',
  'renderChunkNoteImage',
  'updateChunkNoteTagCompactState',
  'makeChunkNoteTagDraggable',
  'makeChunkNoteTagResizable',
  'enableChunkNoteInlineEdit',
  'spawnChunkNoteTag',
  'renderAllChunkNoteTags',
  'drawChunkNoteConnector',
  'redrawAllChunkNoteConnectors',
  'scheduleChunkNoteConnectorRedraw',
  'closeChunkNotePopover',
  'upsertChunkNote',
  'refreshChunkNoteForChunkRef',
  'getChunkNotesForRef',
  'getChunkBlocksMatchingRef',
  'getChunkNotesForBlock',
  'refreshAllChunkNoteVisuals',
  'handleChunkSelectionContextMenu'
].forEach((name) => {
  assert.equal(
    new RegExp(`function\\s+${name}\\s*\\(`).test(runtimeSource),
    false,
    `reader-runtime should not keep unused/thin ${name} wrapper`
  );
  assert.ok(
    new RegExp(`function\\s+${name}\\s*\\(`).test(notesSource),
    `notes-module should own ${name}`
  );
});

[
  'cancelChunkNoteModal: deps.chunkNotesApi.cancelChunkNoteModal',
  'closeChunkNoteDeleteDialog: deps.chunkNotesApi.closeChunkNoteDeleteDialog',
  'setSelectedChunkNote: deps.chunkNotesApi.setSelectedChunkNote',
  'openChunkNoteDeleteDialog: deps.chunkNotesApi.openChunkNoteDeleteDialog',
  'openChunkNotePopover: deps.chunkNotesApi.openChunkNotePopover',
  'saveChunkNoteFromModal: deps.chunkNotesApi.saveChunkNoteFromModal',
  'clearChunkNoteConnectors: deps.chunkNotesApi.clearChunkNoteConnectors',
  'closeChunkNotePopover: deps.chunkNotesApi.closeChunkNotePopover',
  'renderAllChunkNoteTags: deps.chunkNotesApi.renderAllChunkNoteTags',
  'scheduleChunkNoteConnectorRedraw: deps.chunkNotesApi.scheduleChunkNoteConnectorRedraw',
  'refreshAllChunkNoteVisuals: deps.chunkNotesApi.refreshAllChunkNoteVisuals',
  'handleChunkSelectionContextMenu: deps.chunkNotesApi.handleChunkSelectionContextMenu',
  'getChunkNoteTagById: deps.chunkNotesApi.getChunkNoteTagById',
  'getChunkNoteContentBoxSize: deps.chunkNotesApi.getChunkNoteContentBoxSize',
  'saveChunkNotesNow: deps.chunkNotesApi.saveChunkNotesNow',
  'buildChunkNotesSnapshot: deps.chunkNotesApi.buildChunkNotesSnapshot',
  'closeChunkNoteContextMenu: deps.chunkNotesApi.closeChunkNoteContextMenu',
  'deps.chunkNotesApi.ensureChunkNoteOverlayLayers();',
  'tryRestoreChunkNoteDraft: deps.chunkNotesApi.tryRestoreChunkNoteDraft'
].forEach((pattern) => {
  assert.ok(
    readerChunkNoteRuntimeSource.includes(pattern),
    `focused reader runtime should inject chunk note API directly: ${pattern}`
  );
});

assert.equal(
  /function\s+openChunkNoteContextFromEvent\s*\(/.test(runtimeSource),
  false,
  'reader-runtime should not keep thin openChunkNoteContextFromEvent wrapper'
);
assert.ok(
  readerChunkNoteRuntimeSource.includes('openChunkNoteContextFromEvent: function (event) { return deps.chunkNotesApi.handleChunkSelectionContextMenu(event); }'),
  'focused reader runtime should configure openChunkNoteContextFromEvent facade directly from chunk note API'
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

console.log('notes wrapper drain check passed');
