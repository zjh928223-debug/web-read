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
const sessionAssemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js'), 'utf8');
const sessionRuntimeDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-deps.js'), 'utf8');
const sessionAnnotationRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-annotation-runtime.js'), 'utf8');
const sessionApiSettingsRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-annotation-api-settings-runtime.js'), 'utf8');

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
  'hotkey-input',
  'main-app-area',
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
  'chunk-file',
  'cloze-file',
  'btn-import-chunk-notes',
  'chunk-note-svg-layer',
  'chunk-note-layer',
  'chunk-note-probe',
  'chunk-note-ctx-menu',
  'toggle-note-preview-btn',
  'note-preview-sidebar',
  'note-preview-resize-handle',
  'note-preview-resize-handle-y',
  'note-preview-empty',
  'note-preview-list',
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
  assert.equal(
    domRefsSource.includes(`doc.getElementById('${id}')`),
    false,
    `reader-dom-refs should not collect removed DOM id: ${id}`
  );
});

[
  "annotationApiSettingsBtn: getElement('btn-annotation-api-settings')",
  "annotationApiSettingsPanel: getElement('annotation-api-settings-panel')"
].forEach((pattern) => {
  assert.ok(
    sessionRuntimeDepsSource.includes(pattern),
    `session-runtime-deps should keep annotation API settings DOM contract: ${pattern}`
  );
});

assert.ok(
  sessionAssemblySource.includes("from './session-annotation-runtime.js';") &&
    sessionAnnotationRuntimeSource.includes('buttonEl: domRefs.annotationApiSettingsBtn') &&
    sessionAnnotationRuntimeSource.includes('panelEl: domRefs.annotationApiSettingsPanel') &&
    sessionAssemblySource.includes('initAnnotationApiSettingsUi();'),
  'session-runtime-assembly should reach annotation API settings refs through session-annotation-runtime'
);

assert.equal(
  sessionRuntimeDepsSource.includes('__session_initAnnotationApiSettingsUi'),
  false,
  'session-runtime-deps should not keep retired annotation API settings facade'
);

[
  'function initAnnotationApiSettingsUi()',
].forEach((pattern) => {
  assert.ok(
    sessionApiSettingsRuntimeSource.includes(pattern),
    `session annotation API settings runtime should keep contract: ${pattern}`
  );
});

console.log('reader DOM refs check passed');
