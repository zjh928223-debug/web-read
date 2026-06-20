const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
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
  "deps.markFileLoaded(deps.lblNotes, 'Notes restored');",
  "deps.markFileLoaded(deps.lblVisual, 'Visual restored');",
  'deps.processVisual(visualData);'
].forEach((pattern) => {
  assert.ok(
    sessionInitSource.includes(pattern),
    `session-init restore contract should remain intact: ${pattern}`
  );
});

console.log('legacy DOM drain check passed');
