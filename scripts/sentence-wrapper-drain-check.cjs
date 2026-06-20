const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const sessionRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-session-runtime.js'), 'utf8');
const readerSentenceRuntimeSource = [
  'reader-feature-runtime.js',
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
  'await deps.loadSentenceNotesForCurrentAudio();',
  'await deps.switchSentenceNotesDoc(transcriptData);',
  'await deps.switchSentenceNotesDoc();'
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
  assert.equal(
    runtimeSource.includes(pattern),
    false,
    `reader-runtime should not own externally consumed sentence note boundary body: ${pattern}`
  );
  assert.ok(
    sessionRuntimeSource.includes(pattern),
    `reader-session-runtime should keep externally consumed sentence note boundary: ${pattern}`
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
  'hasActiveTextSelectionWithinChunk: deps.sentenceNotesApi.hasActiveTextSelectionWithinChunk',
  'selectSentenceFromChunkTarget: deps.sentenceNotesApi.selectSentenceFromChunkTarget'
].forEach((pattern) => {
  assert.ok(
    readerSentenceRuntimeSource.includes(pattern),
    `focused reader runtime should inject sentence note API directly: ${pattern}`
  );
});

console.log('sentence wrapper drain check passed');
