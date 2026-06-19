const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const importRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-import-runtime.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');
const providerSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-state-provider.js'), 'utf8');
const runtimeStateFacadeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'runtime-state-facade.js'), 'utf8');

assert.equal(
  sessionInitSource.includes('window.__state'),
  false,
  'session-init.js should use the session state provider instead of reading window.__state'
);

assert.equal(
  providerSource.includes('window.__state'),
  false,
  'session-state-provider.js should receive configured state instead of reading window.__state'
);

assert.ok(
  sessionInitSource.includes("import { getSessionState } from './session-state-provider.js';"),
  'session-init.js should import getSessionState'
);

assert.ok(
  appSource.includes("import { initReaderRuntimeShell } from './reader-runtime-shell.js';"),
  'app.js should delegate reader import runtime through reader-runtime-shell'
);
assert.ok(
  assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime-shell should delegate reader import runtime through reader-feature-runtime'
);
assert.ok(
  featureSource.includes("import { initReaderImportRuntime } from './reader-import-runtime.js';"),
  'reader-feature-runtime should import reader import runtime'
);

assert.equal(
  appSource.includes("import { configureSessionStateProvider } from './session-state-provider.js';"),
  false,
  'app.js should not import configureSessionStateProvider directly'
);

assert.ok(
  importRuntimeSource.includes("import { configureSessionStateProvider } from './session-state-provider.js'"),
  'reader-import-runtime should import configureSessionStateProvider'
);

assert.ok(
  assemblySource.includes("import { runtimeState } from './runtime-state-facade.js';"),
  'reader-runtime-shell should import runtimeState from the runtime-state facade'
);

assert.ok(
  runtimeStateFacadeSource.includes('window.__state = runtimeState;'),
  'runtime-state-facade should expose runtimeState through the temporary window.__state compatibility facade'
);

assert.ok(
  importRuntimeSource.includes('configureSessionStateProvider(deps.runtimeState)'),
  'reader-import-runtime should configure the session state provider with runtimeState'
);

console.log('session state provider check passed');
