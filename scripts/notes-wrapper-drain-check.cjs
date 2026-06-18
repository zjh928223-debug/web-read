const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const notesSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'notes-module.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

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
  'cancelChunkNoteModal: _cnApi.cancelChunkNoteModal',
  'closeChunkNoteDeleteDialog: _cnApi.closeChunkNoteDeleteDialog',
  'setSelectedChunkNote: _cnApi.setSelectedChunkNote',
  'openChunkNoteDeleteDialog: _cnApi.openChunkNoteDeleteDialog',
  'openChunkNotePopover: _cnApi.openChunkNotePopover',
  'saveChunkNoteFromModal: _cnApi.saveChunkNoteFromModal',
  'clearChunkNoteConnectors: _cnApi.clearChunkNoteConnectors',
  'closeChunkNotePopover: _cnApi.closeChunkNotePopover',
  'renderAllChunkNoteTags: _cnApi.renderAllChunkNoteTags',
  'scheduleChunkNoteConnectorRedraw: _cnApi.scheduleChunkNoteConnectorRedraw',
  'refreshAllChunkNoteVisuals: _cnApi.refreshAllChunkNoteVisuals',
  'handleChunkSelectionContextMenu: _cnApi.handleChunkSelectionContextMenu',
  'getChunkNoteTagById: _cnApi.getChunkNoteTagById',
  'getChunkNoteContentBoxSize: _cnApi.getChunkNoteContentBoxSize',
  'saveChunkNotesNow: _cnApi.saveChunkNotesNow',
  'buildChunkNotesSnapshot: _cnApi.buildChunkNotesSnapshot',
  'closeChunkNoteContextMenu: _cnApi.closeChunkNoteContextMenu',
  '_cnApi.ensureChunkNoteOverlayLayers();',
  'tryRestoreChunkNoteDraft: _cnApi.tryRestoreChunkNoteDraft'
].forEach((pattern) => {
  assert.ok(
    runtimeSource.includes(pattern),
    `reader-runtime should inject chunk note API directly: ${pattern}`
  );
});

assert.equal(
  /function\s+openChunkNoteContextFromEvent\s*\(/.test(runtimeSource),
  false,
  'reader-runtime should not keep thin openChunkNoteContextFromEvent wrapper'
);
assert.ok(
  runtimeSource.includes('openChunkNoteContextFromEvent: function (event) { return _cnApi.handleChunkSelectionContextMenu(event); }'),
  'reader-runtime should configure openChunkNoteContextFromEvent facade directly from chunk note API'
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

console.log('notes wrapper drain check passed');
