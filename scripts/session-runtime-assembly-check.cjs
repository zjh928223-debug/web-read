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
  const entrySource = fs.readFileSync(entryPath, 'utf8');
  const assemblySource = fs.readFileSync(assemblyPath, 'utf8');

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
    'window.__session_exportManualLightweightAnnotations',
    'initDB().then'
  ].forEach((pattern) => {
    assert.equal(entrySource.includes(pattern), false, `session-init should not keep runtime assembly logic: ${pattern}`);
  });

  assert.ok(
    assemblySource.includes('export function initSessionRuntimeAssembly'),
    'session-runtime-assembly should export initSessionRuntimeAssembly'
  );
  [
    "from './session-restore-runtime.js';",
    "from './session-startup-runtime.js';",
    "from './session-ui-settings-restore.js';",
    'window.__session_clearGeneratedAnnotationIndex',
    'window.__session_importManualLightweightAnnotations',
    'initAnnotationApiSettingsUi();'
  ].forEach((pattern) => {
    assert.ok(assemblySource.includes(pattern), `session-runtime-assembly should contain ${pattern}`);
  });

  console.log('session runtime assembly check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
