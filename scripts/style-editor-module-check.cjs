const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const controlsRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-controls-runtime.js'), 'utf8');
const styleEditorSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'style-editor.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

assert.equal(
  runtimeSource.includes('function safeParseLocalJSON'),
  false,
  'reader-runtime should not own safeParseLocalJSON'
);

assert.equal(
  runtimeSource.includes('safeParseLocalJSON:'),
  false,
  'reader-runtime should not inject safeParseLocalJSON into style-editor'
);

assert.equal(
  runtimeSource.includes('window.__styleEditor.init({'),
  false,
  'reader-runtime should not initialize style-editor directly'
);

assert.ok(
  controlsRuntimeSource.includes('deps.styleEditor.init({'),
  'reader-controls-runtime should initialize style-editor through injected deps'
);

assert.ok(
  styleEditorSource.includes('function safeParseLocalJSON'),
  'style-editor should own safeParseLocalJSON'
);

assert.equal(
  styleEditorSource.includes('deps.safeParseLocalJSON'),
  false,
  'style-editor should not receive safeParseLocalJSON from deps'
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

console.log('style editor module check passed');
