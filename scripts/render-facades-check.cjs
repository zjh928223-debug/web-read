const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const sessionSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js'), 'utf8');
const sessionLifecycleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-lifecycle-runtime.js'), 'utf8');
const sessionAnnotationSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-annotation-runtime.js'), 'utf8');
const interactionRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-interaction-runtime.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'render-runtime.js'), 'utf8');
const importModuleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'import-module.js'), 'utf8');
const appHandlersSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'app-handlers.js'), 'utf8');

assert.ok(
  assemblySource.includes("import { renderTranscript, renderChunkMode } from './render-runtime.js';"),
  'reader-runtime-assembly should keep direct render function imports for existing runtime injections'
);
assert.ok(
  appSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
  'reader-runtime.js should delegate render runtime assembly through reader-runtime-assembly'
);
assert.ok(
  assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime-assembly should configure render runtime through reader-feature-runtime'
);
assert.ok(
  featureSource.includes("import { initReaderInteractionRuntime } from './reader-interaction-runtime.js';"),
  'reader-feature-runtime should configure render runtime through reader-interaction-runtime'
);
assert.equal(appSource.includes('configureRenderRuntime({'), false);
assert.equal(appSource.includes('function renderTranscript()'), false, 'reader-runtime.js should not own renderTranscript implementation');
assert.equal(appSource.includes('function renderChunkMode()'), false, 'reader-runtime.js should not own renderChunkMode implementation');
assert.equal(appSource.includes('window.renderTranscript = renderTranscript'), false, 'reader-runtime.js should not export window.renderTranscript');
assert.equal(appSource.includes('window.renderChunkMode = renderChunkMode'), false, 'reader-runtime.js should not export window.renderChunkMode');

assert.ok(sessionLifecycleSource.includes("import { renderTranscript } from './render-runtime.js';"));
assert.ok(sessionAnnotationSource.includes("import { renderTranscript, renderChunkMode } from './render-runtime.js';"));
assert.equal(sessionSource.includes('window.renderTranscript'), false, 'session runtime assembly should not call window.renderTranscript');
assert.equal(sessionSource.includes('window.renderChunkMode'), false, 'session runtime assembly should not call window.renderChunkMode');

assert.ok(interactionRuntimeSource.includes("import { configureRenderRuntime } from './render-runtime.js';"));
assert.ok(interactionRuntimeSource.includes('configureRenderRuntime({'));
assert.equal(interactionRuntimeSource.includes('window.'), false, 'reader-interaction-runtime should not read or write window globals');
assert.equal(interactionRuntimeSource.includes('document.'), false, 'reader-interaction-runtime should not read DOM globals');

assert.ok(runtimeSource.includes('export function configureRenderRuntime'));
assert.ok(runtimeSource.includes('export function renderTranscript'));
assert.ok(runtimeSource.includes('export function renderChunkMode'));
assert.ok(runtimeSource.includes('runtime.bridgeToPinia'), 'render runtime should own the bridge render call');
assert.equal(runtimeSource.includes('bindClozeQuiz'), false, 'render runtime should not keep retired cloze quiz binding');
assert.equal(runtimeSource.includes('getClozeMarkup'), false, 'render runtime should not keep retired cloze markup hook');
assert.equal(runtimeSource.includes('checkCloze'), false, 'render runtime should not keep retired cloze check hook');
assert.ok(runtimeSource.includes('runtime.tryRestoreChunkNoteDraft'), 'render runtime should own chunk note draft restore hook');
assert.equal(runtimeSource.includes('window.'), false, 'render runtime should not read or write window globals');
assert.equal(runtimeSource.includes('document.'), false, 'render runtime should not read DOM globals');

assert.ok(importModuleSource.includes('var renderTranscript = deps.renderTranscript;'));
assert.ok(importModuleSource.includes('var renderChunkMode = deps.renderChunkMode;'));
assert.ok(appHandlersSource.includes('var renderTranscript = config.renderTranscript;'));
assert.ok(appHandlersSource.includes('var renderChunkMode = config.renderChunkMode;'));

console.log('render facades check passed');
