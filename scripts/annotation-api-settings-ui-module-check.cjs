const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const sessionAssemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js'), 'utf8');
const sessionAnnotationRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-annotation-runtime.js'), 'utf8');
const sessionApiSettingsRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-annotation-api-settings-runtime.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'annotation-api-settings-ui.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

assert.ok(
  sessionAssemblySource.includes("from './session-annotation-runtime.js';")
    && sessionAnnotationRuntimeSource.includes("import { getAnnotationApiSettingsUiApi } from './annotation-api-settings-ui.js';"),
  'session-runtime-assembly should reach the annotation API settings UI through session-annotation-runtime'
);
assert.equal(
  sessionApiSettingsRuntimeSource.includes('window.AnnotationApiSettingsUI'),
  false,
  'session annotation API settings runtime should not read the root annotation API settings global'
);

assert.ok(
  mainSource.includes("import './composables/annotation-api-settings-ui.js'"),
  'src/main.js should load the annotation API settings UI module for future app.js removal'
);

[
  'global.AnnotationApiSettingsUI = api',
  'export function getAnnotationApiSettingsUiApi',
  'export default window.AnnotationApiSettingsUI'
].forEach((pattern) => {
  assert.ok(moduleSource.includes(pattern), `annotation API settings UI module should include ${pattern}`);
});

assert.ok(
  !indexSource.includes('<script src="annotation-api-settings-ui.js"></script>'),
  'root annotation API settings script tag should stay removed after Phase 5 tag cleanup'
);

console.log('annotation API settings UI module check passed');
