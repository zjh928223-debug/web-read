const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
const notesSessionRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-notes-session-runtime.js'), 'utf8');
const notesRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-notes-runtime.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'pinia-bridge-module.js'), 'utf8');
const interactionSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'read-web-interactions-check.cjs'), 'utf8');

assert.ok(
  appSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
  'reader-runtime should delegate Pinia bridge assembly through reader-runtime-assembly'
);
assert.ok(
  assemblySource.includes("import { initReaderNotesSessionRuntime } from './reader-notes-session-runtime.js';"),
  'reader-runtime-assembly should initialize the Pinia bridge through reader notes/session runtime'
);
assert.ok(
  assemblySource.includes('notesSessionRuntime: notesSessionRuntime'),
  'reader-runtime-assembly should pass notes/session runtime to focused feature deps'
);
assert.ok(
  featureDepsSource.includes('bridgeToPinia: notesSessionRuntime.bridgeToPinia'),
  'reader-feature-runtime-deps should receive the Pinia bridge from notes/session runtime'
);
assert.ok(
  notesSessionRuntimeSource.includes("import { initReaderNotesRuntime } from './reader-notes-runtime.js';"),
  'reader-notes-session-runtime should import the notes runtime module that initializes the Pinia bridge'
);
assert.ok(
  notesSessionRuntimeSource.includes('bridgeToPinia: notesRuntime.bridgeToPinia'),
  'reader-notes-session-runtime should forward the Pinia bridge from notes runtime'
);
assert.equal(appSource.includes('initPiniaBridge({'), false, 'reader-runtime should not initialize Pinia bridge directly');
assert.equal(appSource.includes('function bridgeToPinia()'), false, 'reader-runtime should not own bridgeToPinia implementation');
assert.equal(appSource.includes('window.bridgeToPinia ='), false, 'reader-runtime should not own window.bridgeToPinia');
assert.ok(
  notesRuntimeSource.includes("import { initPiniaBridge } from './pinia-bridge-module.js'"),
  'reader-notes-runtime should import the Pinia bridge module'
);
assert.ok(
  notesRuntimeSource.includes('var bridgeToPinia = initPiniaBridge({'),
  'reader-notes-runtime should initialize Pinia bridge once'
);
assert.ok(bridgeSource.includes('export function initPiniaBridge'), 'bridge module should expose an init API');
assert.ok(bridgeSource.includes('window.bridgeToPinia = bridgeToPinia;'), 'bridge module should own window.bridgeToPinia');
assert.ok(bridgeSource.includes('chunkState.getSnapshot()'), 'bridge module should read chunk state owner snapshots');
assert.ok(bridgeSource.includes('clozeState.getSnapshot()'), 'bridge module should read cloze state owner snapshots');
assert.ok(interactionSource.includes('window.bridgeToPinia'), 'compatibility tests should still cover window.bridgeToPinia');

console.log('pinia bridge module check passed');
