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
    "import { initReaderFeatureRuntime } from './reader-feature-runtime.js';",
    "import { createReaderFeatureAdapters } from './reader-feature-runtime-deps.js';",
    'var runtimeContext = initReaderRuntimeContext({',
    'var bootstrapRuntime = runtimeContext.bootstrapRuntime;',
    'var featureRuntime = initReaderFeatureRuntime({',
    'var assembly = {'
  ].forEach((pattern) => {
    assert.ok(assemblySource.includes(pattern), `reader-runtime-assembly should own ${pattern}`);
  });
  assert.equal(assemblySource.includes('notesSessionRuntime'), false, 'retired notes/session runtime should stay removed');
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
      "import { initReaderFeatureRuntime } from './reader-feature-runtime.js';\n",
      'function initReaderFeatureRuntime(deps) { const feature = { feature: true, deps, dispose() { globalThis.__assemblyCalls.push(["dispose-feature", feature]); } }; globalThis.__assemblyCalls.push(["feature", deps]); return feature; }\n'
    )
    .replace(
      "import { createReaderFeatureAdapters } from './reader-feature-runtime-deps.js';\n",
      'function createReaderFeatureAdapters(deps) { globalThis.__assemblyCalls.push(["feature-adapters", deps]); return { featureAdapters: true, input: deps }; }\n'
    )
    .replace(
      "import { showToast, showError } from './ui-facades.js';\n",
      'function showToast() { return "toast"; }\nfunction showError() { return "error"; }\n'
    )
    .replace(
      "import { syncAnnotationGenerationEntryStatus } from './session-facades.js';\n",
      'function syncAnnotationGenerationEntryStatus() { return "sync"; }\n'
    )
    .replace(
      "import { createLifecycleScope } from '../services/runtime/lifecycle-scope.js';\n",
      'function createLifecycleScope() { const disposers = []; let disposed = false; return { add(disposer) { disposers.push(disposer); }, dispose() { if (disposed) return; disposed = true; for (let index = disposers.length - 1; index >= 0; index -= 1) disposers[index](); } }; }\n'
    );

  globalThis.__assemblyCalls = [];
  globalThis.__runtimeContext = {
    bootstrapRuntime: { id: 'bootstrap' }
  };

  const encodedSource = Buffer.from(testableSource, 'utf8').toString('base64');
  const { initReaderRuntimeAssembly } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const fakeWindow = { id: 'window', document: { id: 'document' } };
  const api = initReaderRuntimeAssembly({
    getWindow: () => fakeWindow
  });

  assert.deepEqual(globalThis.__assemblyCalls.map((entry) => entry[0]), [
    'context',
    'feature-adapters',
    'feature'
  ]);
  assert.equal(globalThis.__assemblyCalls[0][1].getWindow(), fakeWindow);
  assert.equal(globalThis.__assemblyCalls[0][1].getDocument(), fakeWindow.document);
  assert.equal(globalThis.__assemblyCalls[1][1].runtimeState.id, 'runtime-state');
  assert.equal(globalThis.__assemblyCalls[1][1].renderTranscript(), 'transcript');
  assert.equal(globalThis.__assemblyCalls[1][1].renderChunkMode(), 'chunk');
  assert.equal(
    Object.prototype.hasOwnProperty.call(globalThis.__assemblyCalls[1][1], 'initAnnotationApiSettingsUi'),
    false,
    'reader-runtime-assembly should not pass retired annotation API settings facade'
  );
  assert.equal(globalThis.__assemblyCalls[2][1].adapters.featureAdapters, true);
  assert.equal(api.runtimeContext, globalThis.__runtimeContext);
  assert.equal(api.bootstrapRuntime, globalThis.__runtimeContext.bootstrapRuntime);
  assert.equal(api.featureRuntime.feature, true);
  assert.equal(typeof api.dispose, 'function');
  const secondApi = initReaderRuntimeAssembly({ getWindow: () => fakeWindow });
  assert.equal(globalThis.__assemblyCalls.filter((entry) => entry[0] === 'dispose-feature').length, 1);
  api.dispose();
  assert.equal(globalThis.__assemblyCalls.filter((entry) => entry[0] === 'dispose-feature').length, 1);
  secondApi.dispose();
  secondApi.dispose();
  assert.equal(globalThis.__assemblyCalls.filter((entry) => entry[0] === 'dispose-feature').length, 2);

  console.log('reader runtime assembly check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
