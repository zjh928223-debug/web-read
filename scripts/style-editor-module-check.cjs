const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const controlsRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-controls-runtime.js'), 'utf8');
const styleEditorSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'style-editor.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');
const workflowCssSource = fs.readFileSync(path.join(repoRoot, 'src', 'styles', 'workflow-ui.css'), 'utf8');
const sessionInitSource = [
  'session-runtime-assembly.js',
  'session-restore-runtime.js',
  'session-startup-runtime.js',
  'session-startup-cleanup.js',
  'session-ui-settings-restore.js',
  'session-annotation-context.js',
  'session-annotation-generated-index.js',
  'session-annotation-marks.js',
  'session-annotation-lightweight-io.js',
  'session-annotation-export-payload.js',
  'session-annotation-import-normalization.js',
  'session-annotation-bundle-merge.js',
  'session-annotation-text.js'
].map((file) => fs.readFileSync(path.join(repoRoot, 'src', 'composables', file), 'utf8')).join('\n');

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

assert.equal(
  styleEditorSource.includes('function safeParseLocalJSON'),
  false,
  'retired visual style editor parser should stay removed'
);
['styleSettings', 'defaultStyles', 'createStyleControlSection', 'initStyleEditor', 'function applyStyle('].forEach((pattern) => {
  assert.equal(
    styleEditorSource.includes(pattern),
    false,
    `retired generated style editor chain should stay removed: ${pattern}`
  );
});
assert.equal(styleEditorSource.includes('open-style-editor'), false, 'retired style editor entry binding should stay removed');
assert.ok(indexSource.includes('id="chunk-style-modal"'), 'chunk style modal should remain in the DOM');
assert.match(cssSource, /#chunk-style-modal\s*\{[\s\S]*?display:\s*none;/);
assert.match(cssSource, /#chunk-style-modal\s*\{[\s\S]*?position:\s*fixed;/);
assert.doesNotMatch(cssSource, /#style-editor-modal|#helper-panel|body\.sidebar-open/);
assert.match(cssSource, /\.modal-backdrop\s*\{[\s\S]*?display:\s*none;/);

[
  'btn-close-chunk-style-modal',
  'chunk-en-size-input',
  'chunk-cn-size-input',
  'chunk-gap-input',
  'chunk-cn-color-input',
  'chunk-bg-color-input',
  'btn-toggle-shadow-manual'
].forEach((id) => {
  assert.match(
    indexSource,
    new RegExp(`id="${id}"[^>]*data-ui-owner="style-controls"`),
    `${id} should be owned by the style-controls boundary`
  );
});

assert.doesNotMatch(
  indexSource,
  /id="btn-toggle-shadow-manual"[^>]*style=/,
  'shadow toggle should not keep inline visual styling'
);
assert.ok(
  styleEditorSource.includes("import { applyNativeControlStyles } from '../lib/native-control-styles.js';")
    && styleEditorSource.includes("import { applyNativeInputStyles } from '../lib/native-input-styles.js';"),
  'style editor should reuse the native shared control recipes'
);
assert.ok(
  styleEditorSource.includes("interaction: 'text'")
    && styleEditorSource.includes('applyStyleColorInput'),
  'style editor should keep number inputs text-like and color inputs native'
);
assert.ok(
  workflowCssSource.includes('@source "../composables/style-editor.js";'),
  'Tailwind should scan style-editor adapter utility classes'
);
assert.ok(styleEditorSource.includes('function applyChunkStyleControlStyles'), 'chunk control styling should remain owned by style-editor');
assert.ok(styleEditorSource.includes('function openChunkStyleModal'), 'chunk modal opener should remain available');
assert.ok(styleEditorSource.includes('localStorage.setItem(\'chunkEnSize\''), 'chunk settings persistence should remain available');
assert.ok(styleEditorSource.includes('window.openChunkStyleModal = openChunkStyleModal'), 'chunk global facade should remain wired');

[
  "deps.processTranscript(transcriptData);",
  "deps.processChunkData(chunkData);",
  "windowObject.toggleChunkMode(true);",
  "deps.bridgeToPinia();"
].forEach((pattern) => {
  assert.ok(
    sessionInitSource.includes(pattern),
    `session-init contract should remain intact: ${pattern}`
  );
});

console.log('style editor module check passed');
