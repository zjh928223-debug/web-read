const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const notesSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'notes-module.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'style-editor.js'), 'utf8');
const legacyBindingsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'legacy-control-bindings.js'), 'utf8');

[
  'openChunkNoteStyleModal',
  'closeChunkNoteStyleModal',
  'updateChunkNoteStyle',
  'adjustChunkNoteArrowSizeByGap'
].forEach((name) => {
  assert.equal(appSource.includes(`window.${name} =`), false, `app.js should not own window.${name}`);
  assert.equal(
    new RegExp(`function\\s+${name}\\s*\\(`).test(appSource),
    false,
    `app.js should not keep ${name} wrapper`
  );
  assert.ok(notesSource.includes(`window.${name} = ${name};`), `notes-module should own window.${name}`);
});

assert.ok(
  appSource.includes('adjustChunkNoteArrowSizeByGap: _cnApi.adjustChunkNoteArrowSizeByGap'),
  'app.js should inject note style adjustment from the notes API'
);
assert.ok(
  styleSource.includes('var adjustChunkNoteArrowSizeByGap = deps.adjustChunkNoteArrowSizeByGap;'),
  'style editor should still receive note style adjustment as an injected dependency'
);
[
  'openChunkNoteStyleModal',
  'closeChunkNoteStyleModal',
  'updateChunkNoteStyle'
].forEach((name) => {
  assert.ok(legacyBindingsSource.includes(name), `legacy control bindings should still call ${name}`);
});

console.log('chunk note style facades check passed');
