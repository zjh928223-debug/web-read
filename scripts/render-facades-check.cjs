const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const sessionSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'render-runtime.js'), 'utf8');
const importModuleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'import-module.js'), 'utf8');
const appHandlersSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'app-handlers.js'), 'utf8');

assert.ok(
  appSource.includes("import { configureRenderRuntime } from './src/composables/render-runtime.js';"),
  'app.js should configure the render runtime module'
);
assert.ok(appSource.includes('configureRenderRuntime({'));
assert.equal(appSource.includes('window.renderTranscript = renderTranscript'), false, 'app.js should not export window.renderTranscript');
assert.equal(appSource.includes('window.renderChunkMode = renderChunkMode'), false, 'app.js should not export window.renderChunkMode');

assert.ok(sessionSource.includes("import { renderTranscript, renderChunkMode } from './render-runtime.js';"));
assert.equal(sessionSource.includes('window.renderTranscript'), false, 'session-init.js should not call window.renderTranscript');
assert.equal(sessionSource.includes('window.renderChunkMode'), false, 'session-init.js should not call window.renderChunkMode');

assert.ok(runtimeSource.includes('export function configureRenderRuntime'));
assert.ok(runtimeSource.includes('export function renderTranscript'));
assert.ok(runtimeSource.includes('export function renderChunkMode'));
assert.equal(runtimeSource.includes('window.'), false, 'render runtime should not read or write window globals');
assert.equal(runtimeSource.includes('document.'), false, 'render runtime should not read DOM globals');

assert.ok(importModuleSource.includes('var renderTranscript = deps.renderTranscript;'));
assert.ok(importModuleSource.includes('var renderChunkMode = deps.renderChunkMode;'));
assert.ok(appHandlersSource.includes('var renderTranscript = config.renderTranscript;'));
assert.ok(appHandlersSource.includes('var renderChunkMode = config.renderChunkMode;'));

console.log('render facades check passed');
