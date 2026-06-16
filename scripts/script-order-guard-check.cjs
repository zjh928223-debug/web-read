const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

const scriptSrcs = Array.from(indexSource.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)).map((match) => match[1]);
const expectedScriptSrcs = [
  'https://cse.google.com/cse.js?cx=048d09e2e2f764b7b',
  'src/stores/theme.js',
  'src/stores/ui.js',
  'src/stores/audio.js',
  'src/stores/marks.js',
  'src/stores/cloze.js',
  'src/stores/transcript.js',
  'src/stores/chunk.js',
  'src/stores/notes.js',
  'src/stores/annotation.js',
  'src/composables/glass-effects.js',
  'src/composables/chunk-note-layout.js',
  'src/composables/app-handlers.js',
  'src/composables/style-editor.js',
  'src/composables/notes-module.js',
  'src/composables/import-module.js',
  'src/composables/keyboard-module.js',
  'src/composables/playback-module.js',
  'src/composables/controls-module.js',
  'src/composables/legacy-control-bindings.js',
  'app.js',
  'src/composables/session-init.js',
  '/src/main.js'
];

assert.deepEqual(scriptSrcs, expectedScriptSrcs, 'index.html script order should match the current Phase 5 guardrail');

[
  'chunk-note-layout-helpers.js',
  'chunk-note-layout-core.js',
  'annotation-bubble.js',
  'annotation-api-settings-ui.js'
].forEach((scriptName) => {
  const pattern = new RegExp(`<script src="${scriptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"></script>`);
  assert.equal(pattern.test(indexSource), false, `${scriptName} should not be loaded as a root regular script`);
});

console.log('script order guard check passed');
