const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const contextSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-context.js'), 'utf8');
const featureDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
const notesSessionDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-notes-session-runtime-deps.js'), 'utf8');
const domRefsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-dom-refs.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

assert.ok(
  contextSource.includes("import { collectReaderDomRefs } from './reader-dom-refs.js';"),
  'reader-runtime-context should import reader DOM refs collector'
);
assert.ok(
  contextSource.includes('var domRefs = collectReaderDomRefs(getDocument());'),
  'reader-runtime-context should collect DOM refs through reader-dom-refs'
);
assert.ok(
  featureDepsSource.includes('var domRefs = runtimeContext.domRefs;') &&
    notesSessionDepsSource.includes('var domRefs = runtimeContext.domRefs;'),
  'focused dependency modules should receive DOM refs from reader-runtime-context'
);
assert.equal(
  runtimeSource.includes("import { collectReaderDomRefs } from './reader-dom-refs.js';"),
  false,
  'reader-runtime should not import reader DOM refs collector directly'
);

[
  'audio-player',
  'transcript-container',
  'toggle-follow',
  'highlight-mode-btn',
  'theme-controls',
  'toggle-chunk-btn',
  'audio-file',
  'transcript-file',
  'visual-file',
  'chunk-file',
  'cloze-file',
  'hotkey-input',
  'btn-import-chunk-notes',
  'chunk-note-svg-layer',
  'main-app-area',
  'toggle-note-preview-btn',
  'import-marks-btn',
  'export-json',
  'btn-export-annotation-lightweight',
  'import-annotation-lightweight-file'
].forEach((id) => {
  assert.equal(
    runtimeSource.includes(`document.getElementById('${id}')`),
    false,
    `reader-runtime should not directly query static DOM id: ${id}`
  );
  assert.ok(
    domRefsSource.includes(`doc.getElementById('${id}')`),
    `reader-dom-refs should own static DOM id: ${id}`
  );
});

[
  'btn-import-sentence-notes',
  'import-sentence-notes-file',
  'btn-export-sentence-notes',
  'modal-backdrop'
].forEach((id) => {
  assert.equal(
    runtimeSource.includes(`document.getElementById('${id}')`),
    false,
    `reader-runtime should not keep no-consumer DOM lookup: ${id}`
  );
});

[
  "document.getElementById('btn-annotation-api-settings')",
  "document.getElementById('annotation-api-settings-panel')",
  'function initAnnotationApiSettingsUi()',
  'window.__session_initAnnotationApiSettingsUi = initAnnotationApiSettingsUi;',
  'initAnnotationApiSettingsUi();'
].forEach((pattern) => {
  assert.ok(
    sessionInitSource.includes(pattern),
    `session-init should keep annotation API settings DOM contract: ${pattern}`
  );
});

console.log('reader DOM refs check passed');
