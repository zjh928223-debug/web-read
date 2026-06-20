const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimePath = path.join(repoRoot, 'src', 'composables', 'reader-runtime.js');
const shellPath = path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js');
const assemblyPath = path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js');
const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');

const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const assemblySource = fs.readFileSync(assemblyPath, 'utf8');
const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');

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
  "import { initReaderNotesSessionRuntime } from './reader-notes-session-runtime.js';",
  "import { createReaderNotesSessionRuntimeDeps } from './reader-notes-session-runtime-deps.js';",
  "import { initReaderFeatureRuntime } from './reader-feature-runtime.js';",
  "import { createReaderFeatureRuntimeDeps } from './reader-feature-runtime-deps.js';",
  'var runtimeContext = initReaderRuntimeContext({',
  'var notesSessionRuntime = initReaderNotesSessionRuntime(createReaderNotesSessionRuntimeDeps({',
  'var featureRuntime = initReaderFeatureRuntime({',
  'notesSessionRuntime: notesSessionRuntime'
].forEach((pattern) => {
  assert.ok(assemblySource.includes(pattern), `reader-runtime-assembly should own ${pattern}`);
});
assert.equal(assemblySource.includes('window.'), false, 'reader-runtime-assembly should receive window through explicit deps');
assert.equal(assemblySource.includes('document.'), false, 'reader-runtime-assembly should receive document through explicit deps');

[
  'setChunkNoteVisible(_ns.chunkNoteVisible, false);',
  'applyCurrentAudioMeta(audioMeta);',
  'await loadChunkNotesForCurrentAudio();',
  'await loadSentenceNotesForCurrentAudio();',
  'await switchSentenceNotesDoc(transcriptData);',
  'processTranscript(transcriptData);',
  'processChunkData(chunkData);',
  'window.toggleChunkMode(true);',
  'bridgeToPinia();'
].forEach((pattern) => {
  assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
});

console.log('reader runtime shell retired check passed');
