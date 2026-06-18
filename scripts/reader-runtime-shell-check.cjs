const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

assert.ok(
  runtimeSource.includes("import { initReaderRuntimeShell } from './reader-runtime-shell.js';"),
  'reader-runtime should import the shell module'
);
assert.ok(
  runtimeSource.includes('initReaderRuntimeShell({'),
  'reader-runtime should delegate assembly to the shell module'
);
[
  "import { runtimeState } from './runtime-state-facade.js';",
  "import { renderTranscript, renderChunkMode } from './render-runtime.js';",
  "import { initReaderRuntimeContext } from './reader-runtime-context.js';",
  "import { initReaderNotesSessionRuntime } from './reader-notes-session-runtime.js';",
  "import { initReaderFeatureRuntime } from './reader-feature-runtime.js';",
  'var runtimeContext = initReaderRuntimeContext({',
  'var notesSessionRuntime = initReaderNotesSessionRuntime({',
  'var featureRuntime = initReaderFeatureRuntime({',
  'runtimeState: runtimeState',
  'renderTranscript: renderTranscript',
  'renderChunkMode: renderChunkMode',
  'setChunkNoteTransferApi: runtimeContext.setChunkNoteTransferApi'
].forEach((pattern) => {
  assert.ok(shellSource.includes(pattern), `reader-runtime-shell should own ${pattern}`);
});
[
  "import { runtimeState } from './runtime-state-facade.js';",
  "import { renderTranscript, renderChunkMode } from './render-runtime.js';",
  "import { initReaderRuntimeContext } from './reader-runtime-context.js';",
  "import { initReaderNotesSessionRuntime } from './reader-notes-session-runtime.js';",
  "import { initReaderFeatureRuntime } from './reader-feature-runtime.js';",
  'var runtimeContext = initReaderRuntimeContext({',
  'var notesSessionRuntime = initReaderNotesSessionRuntime({',
  'initReaderFeatureRuntime({'
].forEach((pattern) => {
  assert.equal(runtimeSource.includes(pattern), false, `reader-runtime should not own shell assembly: ${pattern}`);
});
assert.equal(shellSource.includes('window.'), false, 'reader-runtime-shell should receive window through explicit deps');
assert.equal(shellSource.includes('document.'), false, 'reader-runtime-shell should receive document through explicit deps');

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

console.log('reader runtime shell check passed');
