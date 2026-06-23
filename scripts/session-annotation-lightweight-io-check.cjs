const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-lightweight-io.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const sessionAssemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const sessionAnnotationRuntimePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-runtime.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');
  const sessionAssemblySource = fs.readFileSync(sessionAssemblyPath, 'utf8');
  const sessionAnnotationRuntimeSource = fs.readFileSync(sessionAnnotationRuntimePath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && sessionAssemblySource.includes("from './session-annotation-runtime.js';")
      && sessionAnnotationRuntimeSource.includes("from './session-annotation-lightweight-io.js';"),
    'session-init should reach lightweight IO runtime through session-runtime-assembly'
  );
  [
    'function getManualLightweightAnnotationImportNormalizationDeps()',
    'function getManualLightweightAnnotationBundleMergeDeps()',
    'function getManualLightweightAnnotationExportPayloadDeps()',
    'function downloadJsonFile(payload, filename)',
    'function sanitizeFilenamePart(value',
    'function exportManualLightweightAnnotations()',
    'async function importManualLightweightAnnotations(file)'
  ].forEach((pattern) => {
    assert.equal(sessionInitSource.includes(pattern), false, `session-init should not keep lightweight IO helper: ${pattern}`);
  });
  [
    "from './session-annotation-export-payload.js';",
    "from './session-annotation-import-normalization.js';",
    "from './session-annotation-bundle-merge.js';",
    'export function createSessionAnnotationLightweightIoRuntime'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `lightweight IO module should contain ${pattern}`);
  });
  ['window.', 'document.', 'localStorage'].forEach((pattern) => {
    assert.equal(moduleSource.includes(pattern), false, `lightweight IO module should use injected browser APIs, not ${pattern}`);
  });

  console.log('session annotation lightweight IO check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
