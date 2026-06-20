const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
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

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
    'reader-runtime should import the runtime assembly directly'
  );
  assert.ok(
    runtimeSource.includes('initReaderRuntimeAssembly({'),
    'reader-runtime should initialize the runtime assembly directly'
  );
  assert.equal(runtimeSource.includes('reader-runtime-shell.js'), false, 'reader-runtime should not import the retired shell');
  assert.equal(runtimeSource.includes('initReaderRuntimeShell'), false, 'reader-runtime should not call the retired shell');
  [
    "import { runtimeState } from './runtime-state-facade.js';",
    "import { renderTranscript, renderChunkMode } from './render-runtime.js';",
    "import { initReaderRuntimeContext } from './reader-runtime-context.js';",
    "import { initReaderNotesSessionRuntime } from './reader-notes-session-runtime.js';",
    "import { createReaderNotesSessionRuntimeDeps } from './reader-notes-session-runtime-deps.js';",
    "import { initReaderFeatureRuntime } from './reader-feature-runtime.js';",
    "import { createReaderFeatureRuntimeDeps } from './reader-feature-runtime-deps.js';",
    'var runtimeContext = initReaderRuntimeContext({',
    'var bootstrapRuntime = runtimeContext.bootstrapRuntime;',
    'var notesSessionRuntime = initReaderNotesSessionRuntime(createReaderNotesSessionRuntimeDeps({',
    'var featureRuntime = initReaderFeatureRuntime({',
    'notesSessionRuntime: notesSessionRuntime',
    'return {'
  ].forEach((pattern) => {
    assert.ok(assemblySource.includes(pattern), `reader-runtime-assembly should own ${pattern}`);
  });
  assert.equal(assemblySource.includes('window.'), false, 'reader-runtime-assembly should receive window through explicit deps');
  assert.equal(assemblySource.includes('document.'), false, 'reader-runtime-assembly should receive document through explicit deps');

  [
    'deps.setChunkNoteVisible(namespace.chunkNoteVisible, false);',
    'applyCurrentAudioMeta(audioMeta);',
    'await deps.loadChunkNotesForCurrentAudio();',
    'await deps.loadSentenceNotesForCurrentAudio();',
    'await deps.switchSentenceNotesDoc(transcriptData);',
    'deps.processTranscript(transcriptData);',
    'deps.processChunkData(chunkData);',
    'windowObject.toggleChunkMode(true);',
    'deps.bridgeToPinia();'
  ].forEach((pattern) => {
    assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
  });

  const testableSource = assemblySource
    .replace(
      "import { runtimeState } from './runtime-state-facade.js';\n",
      'const runtimeState = { id: "runtime-state" };\n'
    )
    .replace(
      "import { renderTranscript, renderChunkMode } from './render-runtime.js';\n",
      'function renderTranscript() { return "transcript"; }\nfunction renderChunkMode() { return "chunk"; }\n'
    )
    .replace(
      "import { initReaderRuntimeContext } from './reader-runtime-context.js';\n",
      'function initReaderRuntimeContext(deps) { globalThis.__assemblyCalls.push(["context", deps]); return globalThis.__runtimeContext; }\n'
    )
    .replace(
      "import { initReaderNotesSessionRuntime } from './reader-notes-session-runtime.js';\n",
      'function initReaderNotesSessionRuntime(deps) { globalThis.__assemblyCalls.push(["notes", deps]); return globalThis.__notesSessionRuntime; }\n'
    )
    .replace(
      "import { createReaderNotesSessionRuntimeDeps } from './reader-notes-session-runtime-deps.js';\n",
      'function createReaderNotesSessionRuntimeDeps(deps) { globalThis.__assemblyCalls.push(["notes-deps", deps]); return { notesDeps: true, input: deps }; }\n'
    )
    .replace(
      "import { initReaderFeatureRuntime } from './reader-feature-runtime.js';\n",
      'function initReaderFeatureRuntime(deps) { globalThis.__assemblyCalls.push(["feature", deps]); return { feature: true, deps }; }\n'
    )
    .replace(
      "import { createReaderFeatureRuntimeDeps } from './reader-feature-runtime-deps.js';\n",
      'function createReaderFeatureRuntimeDeps(deps) { globalThis.__assemblyCalls.push(["feature-deps", deps]); return { featureDeps: true, input: deps }; }\n'
    )
    .replace(
      "import { showToast, showError } from './ui-facades.js';\n",
      'function showToast() { return "toast"; }\nfunction showError() { return "error"; }\n'
    )
    .replace(
      "import { syncAnnotationGenerationEntryStatus, initAnnotationApiSettingsUi } from './session-facades.js';\n",
      'function syncAnnotationGenerationEntryStatus() { return "sync"; }\nfunction initAnnotationApiSettingsUi() { return "settings"; }\n'
    );

  globalThis.__assemblyCalls = [];
  globalThis.__runtimeContext = {
    bootstrapRuntime: { id: 'bootstrap' }
  };
  globalThis.__notesSessionRuntime = { id: 'notes-session' };

  const encodedSource = Buffer.from(testableSource, 'utf8').toString('base64');
  const { initReaderRuntimeAssembly } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const fakeWindow = { id: 'window', document: { id: 'document' } };
  const api = initReaderRuntimeAssembly({
    getWindow: () => fakeWindow
  });

  assert.deepEqual(globalThis.__assemblyCalls.map((entry) => entry[0]), [
    'context',
    'notes-deps',
    'notes',
    'feature-deps',
    'feature'
  ]);
  assert.equal(globalThis.__assemblyCalls[0][1].getWindow(), fakeWindow);
  assert.equal(globalThis.__assemblyCalls[0][1].getDocument(), fakeWindow.document);
  assert.equal(globalThis.__assemblyCalls[1][1].globalObject, fakeWindow);
  assert.equal(globalThis.__assemblyCalls[1][1].runtimeContext, globalThis.__runtimeContext);
  assert.equal(globalThis.__assemblyCalls[1][1].bootstrapRuntime, globalThis.__runtimeContext.bootstrapRuntime);
  assert.equal(globalThis.__assemblyCalls[2][1].notesDeps, true);
  assert.equal(globalThis.__assemblyCalls[3][1].notesSessionRuntime, globalThis.__notesSessionRuntime);
  assert.equal(globalThis.__assemblyCalls[3][1].runtimeState.id, 'runtime-state');
  assert.equal(globalThis.__assemblyCalls[3][1].renderTranscript(), 'transcript');
  assert.equal(globalThis.__assemblyCalls[3][1].renderChunkMode(), 'chunk');
  assert.equal(globalThis.__assemblyCalls[4][1].featureDeps, true);
  assert.equal(api.runtimeContext, globalThis.__runtimeContext);
  assert.equal(api.bootstrapRuntime, globalThis.__runtimeContext.bootstrapRuntime);
  assert.equal(api.notesSessionRuntime, globalThis.__notesSessionRuntime);
  assert.equal(api.featureRuntime.feature, true);

  console.log('reader runtime assembly check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
