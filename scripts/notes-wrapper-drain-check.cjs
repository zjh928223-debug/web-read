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
  'setChunkNoteHoverTarget'
].forEach((name) => {
  assert.equal(
    new RegExp(`function\\s+${name}\\s*\\(`).test(runtimeSource),
    false,
    `reader-runtime should not keep unused ${name} wrapper`
  );
  assert.ok(
    new RegExp(`function\\s+${name}\\s*\\(`).test(notesSource),
    `notes-module should own ${name}`
  );
});

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
