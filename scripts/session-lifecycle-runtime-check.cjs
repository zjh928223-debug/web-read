const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-lifecycle-runtime.js'), 'utf8');

assert.ok(
  assemblySource.includes("from './session-lifecycle-runtime.js';"),
  'session-runtime-assembly should delegate lifecycle setup through session-lifecycle-runtime'
);
assert.ok(
  assemblySource.includes('const lifecycleRuntime = startSessionLifecycleRuntime({'),
  'session-runtime-assembly should initialize lifecycle runtime through the focused module'
);

[
  "import { renderTranscript } from './render-runtime.js';",
  "from './session-startup-cleanup.js';",
  "from './session-restore-runtime.js';",
  "from './session-ui-settings-restore.js';",
  "from './session-startup-runtime.js';",
  'export function startSessionLifecycleRuntime',
  'createSessionStartupCleanupRuntime({',
  'createSessionRestoreRuntime({',
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
