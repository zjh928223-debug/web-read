const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js'), 'utf8');
const adapterSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-adapters.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-lifecycle-runtime.js'), 'utf8');

assert.ok(
  adapterSource.includes("from './session-lifecycle-runtime.js';"),
  'session adapter should own lifecycle runtime setup'
);
assert.ok(
  adapterSource.includes('return startSessionLifecycleRuntime({'),
  'session adapter should initialize the focused lifecycle runtime'
);

[
  "import { renderTranscript } from './render-runtime.js';",
  "from './session-startup-cleanup.js';",
  "from './session-restore-runtime.js';",
  "from './session-ui-settings-restore.js';",
  "from './session-startup-runtime.js';",
  "from '../services/persistence/reader-session-persistence.js';",
  'export function startSessionLifecycleRuntime',
  'createSessionStartupCleanupRuntime({',
  'createSessionRestoreRuntime({',
  'readerSessionPersistence,',
  'startSessionRuntime({',
  'restoreSessionUiSettings({',
  'clearPersistedChunkSession: startupCleanupRuntime.clearPersistedChunkSession',
  'restoreSession: sessionRestoreRuntime.restoreSession'
].forEach((pattern) => {
  assert.ok(moduleSource.includes(pattern), `session-lifecycle-runtime should contain ${pattern}`);
});

[
  "from './session-startup-cleanup.js';",
  "from './session-restore-runtime.js';",
  "from './session-ui-settings-restore.js';",
  "from './session-startup-runtime.js';",
  'createSessionStartupCleanupRuntime({',
  'createSessionRestoreRuntime({',
  'startSessionRuntime({',
  'restoreSessionUiSettings({'
].forEach((pattern) => {
  assert.equal(assemblySource.includes(pattern), false, `session-runtime-assembly should not keep lifecycle setup: ${pattern}`);
});

assert.equal(moduleSource.includes('window.'), false, 'session-lifecycle-runtime should use injected windowObject');
assert.equal(moduleSource.includes('document.'), false, 'session-lifecycle-runtime should use injected documentObject');
assert.equal(moduleSource.includes('__session_'), false, 'session-lifecycle-runtime should not recreate retired session bridge facades');

console.log('session lifecycle runtime check passed');
