const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function countNonBlankLines(source) {
  return source.split(/\r?\n/).filter((line) => line.trim()).length;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const entryPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const assemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const depsPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-deps.js');
  const annotationRuntimePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-runtime.js');
  const lifecycleRuntimePath = path.join(repoRoot, 'src', 'composables', 'session-lifecycle-runtime.js');
  const entrySource = fs.readFileSync(entryPath, 'utf8');
  const assemblySource = fs.readFileSync(assemblyPath, 'utf8');
  const depsSource = fs.readFileSync(depsPath, 'utf8');
  const annotationRuntimeSource = fs.readFileSync(annotationRuntimePath, 'utf8');
  const lifecycleRuntimeSource = fs.readFileSync(lifecycleRuntimePath, 'utf8');

  assert.ok(
    entrySource.includes("import { initSessionRuntimeAssembly } from './session-runtime-assembly.js';"),
    'session-init should import the session runtime assembly'
  );
  assert.ok(
    entrySource.includes('initSessionRuntimeAssembly({'),
    'session-init should call the session runtime assembly'
  );
  assert.ok(countNonBlankLines(entrySource) <= 6, 'session-init should remain a thin entry');
  [
    'restoreSession',
    'createSessionAnnotationLightweightIoRuntime',
    'initDB().then'
  ].forEach((pattern) => {
    assert.equal(entrySource.includes(pattern), false, `session-init should not keep runtime assembly logic: ${pattern}`);
  });

  assert.ok(
    assemblySource.includes('export function initSessionRuntimeAssembly'),
    'session-runtime-assembly should export initSessionRuntimeAssembly'
  );
  [
    "from './session-runtime-deps.js';",
    "from './session-facades.js';",
    "from './session-annotation-runtime.js';",
    "from './session-lifecycle-runtime.js';",
    'const runtimeDeps = createSessionRuntimeDeps(env);',
    'const annotationRuntime = createSessionAnnotationRuntime({',
    'const lifecycleRuntime = startSessionLifecycleRuntime({',
    'configureSessionFacades({',
    'getWindow: function () { return windowObject; }'
  ].forEach((pattern) => {
    assert.ok(assemblySource.includes(pattern), `session-runtime-assembly should contain ${pattern}`);
  });
  assert.equal(assemblySource.includes('window.'), false, 'session-runtime-assembly should receive window through session-runtime-deps');
  assert.equal(
    assemblySource.includes('document.getElementById'),
    false,
    'session-runtime-assembly should receive DOM refs through session-runtime-deps'
  );
  [
    'export function createSessionRuntimeDeps',
    'windowObject.saveToDB'
  ].forEach((pattern) => {
    assert.ok(depsSource.includes(pattern), `session-runtime-deps should contain ${pattern}`);
  });
  [
    'export function createSessionAnnotationRuntime',
    'globals.annotationLightweightModule.configureManualLightweightAnnotationRuntime({',
    'createSessionAnnotationGeneratedIndexRuntime({',
    'createSessionAnnotationLightweightIoRuntime({',
    'markCountEl: domRefs.annotationMarkCountEl'
  ].forEach((pattern) => {
    assert.ok(annotationRuntimeSource.includes(pattern), `session-annotation-runtime should contain ${pattern}`);
  });
  [
    'export function startSessionLifecycleRuntime',
    'createSessionStartupCleanupRuntime({',
    'createSessionRestoreRuntime({',
    'startSessionRuntime({',
    'restoreSessionUiSettings({'
  ].forEach((pattern) => {
    assert.ok(lifecycleRuntimeSource.includes(pattern), `session-lifecycle-runtime should contain ${pattern}`);
  });
  [
    "from './session-restore-runtime.js';",
    "from './session-startup-runtime.js';",
    "from './session-ui-settings-restore.js';",
    'createSessionStartupCleanupRuntime({',
    'createSessionRestoreRuntime({',
    'startSessionRuntime({',
    'restoreSessionUiSettings({'
  ].forEach((pattern) => {
    assert.equal(assemblySource.includes(pattern), false, `session-runtime-assembly should not keep lifecycle setup: ${pattern}`);
  });
  [
    'installSessionRuntimeFacades',
    'windowObject.__session_clearGeneratedAnnotationIndex',
    'windowObject.__session_clearPersistedChunkSession',
    'windowObject.__session_getAnnotationGenerationScope',
    'windowObject.__session_emitAnnotationDiagnostics',
    'windowObject.__session_scheduleGeneratedAnnotationIndexRefresh',
    'windowObject.__session_syncAnnotationGenerationEntryStatus',
    'windowObject.__session_exportManualLightweightAnnotations',
    'windowObject.__session_importManualLightweightAnnotations',
    'windowObject.__session_initAnnotationApiSettingsUi'
  ].forEach((pattern) => {
    assert.equal(depsSource.includes(pattern), false, `session-runtime-deps should not keep retired facade: ${pattern}`);
  });

  console.log('session runtime assembly check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
