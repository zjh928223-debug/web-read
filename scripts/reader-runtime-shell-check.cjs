const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimePath = path.join(repoRoot, 'src', 'composables', 'reader-runtime.js');
const shellPath = path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js');
const assemblyPath = path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js');

const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const assemblySource = fs.readFileSync(assemblyPath, 'utf8');
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

assert.equal(fs.existsSync(shellPath), false, 'reader-runtime-shell.js should be retired');
assert.ok(
  runtimeSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
  'reader-runtime should import the runtime assembly directly'
);
assert.ok(
  runtimeSource.includes('initReaderRuntimeAssembly({'),
  'reader-runtime should initialize the runtime assembly directly'
);
assert.equal(
  runtimeSource.includes('reader-runtime-shell.js'),
  false,
  'reader-runtime should not import the retired shell'
);
assert.equal(
  runtimeSource.includes('initReaderRuntimeShell'),
  false,
  'reader-runtime should not call the retired shell initializer'
);

[
  "import { runtimeState } from './runtime-state-facade.js';",
  "import { renderTranscript, renderChunkMode } from './render-runtime.js';",
  "import { initReaderRuntimeContext } from './reader-runtime-context.js';",
  "import { initReaderFeatureRuntime } from './reader-feature-runtime.js';",
  "import { createReaderFeatureRuntimeDeps } from './reader-feature-runtime-deps.js';",
  'var runtimeContext = initReaderRuntimeContext({',
  'var featureRuntime = initReaderFeatureRuntime({',
].forEach((pattern) => {
  assert.ok(assemblySource.includes(pattern), `reader-runtime-assembly should own ${pattern}`);
});
assert.equal(assemblySource.includes('notesSessionRuntime'), false, 'retired notes/session assembly should stay removed');
assert.equal(assemblySource.includes('window.'), false, 'reader-runtime-assembly should receive window through explicit deps');
assert.equal(assemblySource.includes('document.'), false, 'reader-runtime-assembly should receive document through explicit deps');

[
  'applyCurrentAudioMeta(audioMeta);',
  'deps.processTranscript(transcriptData);',
  'deps.processChunkData(chunkData);',
  'windowObject.toggleChunkMode(true);',
  'deps.bridgeToPinia();'
].forEach((pattern) => {
  assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
});

console.log('reader runtime shell retired check passed');
