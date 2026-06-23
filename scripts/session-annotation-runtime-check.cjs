const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-annotation-runtime.js'), 'utf8');

assert.ok(
  assemblySource.includes("from './session-annotation-runtime.js';"),
  'session-runtime-assembly should delegate annotation runtime setup through session-annotation-runtime'
);
assert.ok(
  assemblySource.includes('const annotationRuntime = createSessionAnnotationRuntime({'),
  'session-runtime-assembly should initialize annotation runtime through the focused module'
);

[
  "import { renderTranscript, renderChunkMode } from './render-runtime.js';",
  "from './session-annotation-services.js';",
  "from './session-annotation-generated-index.js';",
  "from './session-annotation-text.js';",
  "from './session-annotation-marks.js';",
  "from './session-annotation-context.js';",
  "from './session-annotation-lightweight-io.js';",
  "from './session-annotation-api-settings-runtime.js';",
  'export function createSessionAnnotationRuntime',
  'createSessionAnnotationGeneratedIndexRuntime({',
  'createSessionAnnotationContextRuntime({',
  'createSessionAnnotationMarksRuntime({',
  'createSessionAnnotationLightweightIoRuntime({',
  'createSessionAnnotationApiSettingsRuntime({',
  'globals.annotationLightweightModule.configureManualLightweightAnnotationRuntime({',
  'installAnnotationContextExport();',
  'initAnnotationApiSettingsUi: annotationApiSettingsRuntime.initAnnotationApiSettingsUi',
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
  "from './session-annotation-api-settings-runtime.js';",
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
