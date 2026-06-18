const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const notesSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'notes-module.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

const removedRuntimeWrappers = [
  'saveSentenceNotesDebounced',
  'normalizeSentenceNoteRecord',
  'normalizeSentenceNotesScope',
  'getSentenceNoteRecord',
  'getSortedSentenceNoteItems',
  'ensureLegacySentenceNotesForDoc',
  'persistSentenceNotebookNow',
  'persistSentenceNotesForCurrentDoc',
  'getCurrentSentenceDocIdForExport',
  'buildSentenceNotesExportSnapshot',
  'triggerSentenceNotesDownload',
  'persistSentenceNotebookBeforeContentSwitch',
  'scheduleSentenceFocusCapture',
  'applyNotePreviewWidth',
  'formatSentenceNoteItemMeta',
  'triggerSentenceNoteSavedFeedback',
  'findSentenceNoteItem',
  'discardSentenceNoteDraft',
  'commitSentenceNoteDraft',
  'persistSentenceNoteItem',
  'persistSelectedSentenceNote',
  'buildSentenceNoteItemElement',
  'renderNotePreviewSidebar',
  'showNotePreviewEmptyState',
  'toggleNotePreviewSidebar',
  'setSelectedSentence',
  'updateSentenceFocusPhrase',
  'getSelectionChunkSentence',
  'maybeCaptureSentenceFocusPhrase',
  'applyImportedSentenceNotesSnapshot',
  'initNotePreviewResize'
];

removedRuntimeWrappers.forEach((name) => {
  assert.equal(
    new RegExp(`function\\s+${name}\\s*\\(`).test(runtimeSource),
    false,
    `reader-runtime should not keep unused sentence note wrapper: ${name}`
  );
});

[
  'saveSentenceNotesDebounced',
  'normalizeSentenceNoteRecord',
  'normalizeSentenceNotesScope',
  'getSentenceNoteRecord',
  'getSortedSentenceNoteItems',
  'persistSentenceNotebookNow',
  'persistSentenceNotesForCurrentDoc',
  'buildSentenceNotesExportSnapshot',
  'triggerSentenceNotesDownload',
  'formatSentenceNoteItemMeta',
  'triggerSentenceNoteSavedFeedback',
  'findSentenceNoteItem',
  'discardSentenceNoteDraft',
  'commitSentenceNoteDraft',
  'persistSentenceNoteItem',
  'persistSelectedSentenceNote',
  'buildSentenceNoteItemElement',
  'renderNotePreviewSidebar',
  'showNotePreviewEmptyState',
  'toggleNotePreviewSidebar',
  'setSelectedSentence',
  'updateSentenceFocusPhrase',
  'getSelectionChunkSentence',
  'maybeCaptureSentenceFocusPhrase',
  'applyImportedSentenceNotesSnapshot',
  'initNotePreviewResize'
].forEach((name) => {
  assert.ok(
    new RegExp(`function\\s+${name}\\s*\\(`).test(notesSource),
    `notes-module should own sentence note behavior: ${name}`
  );
});

[
  'var ensureLegacySentenceNotesForDoc = function',
  'var getCurrentSentenceDocIdForExport = function',
  'function applyNotePreviewSize()'
].forEach((pattern) => {
  assert.ok(
    notesSource.includes(pattern),
    `notes-module should own sentence note helper: ${pattern}`
  );
});

[
  'await loadSentenceNotesForCurrentAudio();',
  'await switchSentenceNotesDoc(transcriptData);',
  'await switchSentenceNotesDoc();'
].forEach((pattern) => {
  assert.ok(
    sessionInitSource.includes(pattern),
    `session-init sentence note restore contract should remain intact: ${pattern}`
  );
});

[
  'async function loadSentenceNotesForCurrentAudio()',
  'async function switchSentenceNotesDoc(transcriptSource)'
].forEach((pattern) => {
  assert.ok(
    runtimeSource.includes(pattern),
    `reader-runtime should keep externally consumed sentence note boundary: ${pattern}`
  );
});

[
  'function selectSentenceFromChunkTarget(target)',
  'function hasActiveTextSelectionWithinChunk()'
].forEach((pattern) => {
  assert.equal(
    runtimeSource.includes(pattern),
    false,
    `reader-runtime should not keep thin sentence interaction wrapper: ${pattern}`
  );
});

[
  'hasActiveTextSelectionWithinChunk: _snApi.hasActiveTextSelectionWithinChunk',
  'selectSentenceFromChunkTarget: _snApi.selectSentenceFromChunkTarget'
].forEach((pattern) => {
  assert.ok(
    runtimeSource.includes(pattern),
    `reader-runtime should inject sentence note API directly: ${pattern}`
  );
});

console.log('sentence wrapper drain check passed');
