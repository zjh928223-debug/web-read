const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

[
  "document.getElementById('toggle-sidebar-btn')",
  "document.getElementById('notes-file')",
  "document.getElementById('lbl-notes')",
  "document.getElementById('hotkey-sidebar-input')",
  'let sidebarKey',
  'function toggleSidebar'
].forEach((pattern) => {
  assert.equal(
    runtimeSource.includes(pattern),
    false,
    `reader-runtime should not keep absent legacy DOM lookup or dead sidebar code: ${pattern}`
  );
});

[
  'toggle-sidebar-btn',
  'notes-file',
  'lbl-notes',
  'hotkey-sidebar-input'
].forEach((id) => {
  assert.equal(
    indexSource.includes(`id="${id}"`),
    false,
    `index.html should not expose removed legacy DOM id: ${id}`
  );
});

[
  "markFileLoaded(lblNotes, 'Notes restored');",
  "markFileLoaded(lblVisual, 'Visual restored');",
  'processVisual(visualData);'
].forEach((pattern) => {
  assert.ok(
    sessionInitSource.includes(pattern),
    `session-init restore contract should remain intact: ${pattern}`
  );
});

console.log('legacy DOM drain check passed');
