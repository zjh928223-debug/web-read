const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js'), 'utf8');
const adapterSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-adapters.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-annotation-runtime.js'), 'utf8');

assert.ok(
  adapterSource.includes("from './session-annotation-runtime.js';"),
  'session adapter should own annotation runtime setup'
);
assert.ok(
  adapterSource.includes('return createSessionAnnotationRuntime({'),
  'session adapter should initialize the focused annotation runtime'
);

[
  "import { renderTranscript, renderChunkMode } from './render-runtime.js';",
  "from './session-annotation-services.js';",
  "from './session-annotation-generated-index.js';",
  "from './session-annotation-text.js';",
  "from './session-annotation-marks.js';",
  "from './session-annotation-context.js';",
  "from './session-annotation-lightweight-io.js';",
  'export function createSessionAnnotationRuntime',
  'createSessionAnnotationGeneratedIndexRuntime({',
  'createSessionAnnotationContextRuntime({',
  'createSessionAnnotationMarksRuntime({',
  'createSessionAnnotationLightweightIoRuntime({',
  'globals.annotationLightweightModule.configureManualLightweightAnnotationRuntime({',
  'installAnnotationContextExport();',
  'disposeAnnotationLightweightIo',
  'emitAnnotationDiagnostics,',
  'getAnnotationGeneratedResultStore'
].forEach((pattern) => {
  assert.ok(moduleSource.includes(pattern), `session-annotation-runtime should contain ${pattern}`);
});

[
  "from './session-annotation-generated-index.js';",
  "from './session-annotation-text.js';",
  "from './session-annotation-marks.js';",
  "from './session-annotation-context.js';",
  "from './session-annotation-lightweight-io.js';",
  'createSessionAnnotationGeneratedIndexRuntime({',
  'createSessionAnnotationLightweightIoRuntime({',
  'globals.annotationLightweightModule.configureManualLightweightAnnotationRuntime({'
].forEach((pattern) => {
  assert.equal(assemblySource.includes(pattern), false, `session-runtime-assembly should not keep annotation setup: ${pattern}`);
});

assert.equal(moduleSource.includes('window.'), false, 'session-annotation-runtime should use injected windowObject');
assert.equal(moduleSource.includes('document.'), false, 'session-annotation-runtime should use injected documentObject');
assert.equal(moduleSource.includes('__session_'), false, 'session-annotation-runtime should not recreate retired session bridge facades');

console.log('session annotation runtime check passed');
