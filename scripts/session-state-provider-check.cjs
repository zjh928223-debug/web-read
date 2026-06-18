const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
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
  appSource.includes("import { configureSessionStateProvider } from './src/composables/session-state-provider.js';"),
  'app.js should import configureSessionStateProvider'
);

assert.ok(
  appSource.includes("import { runtimeState } from './src/composables/runtime-state-facade.js';"),
  'app.js should import runtimeState from the runtime-state facade'
);

assert.ok(
  runtimeStateFacadeSource.includes('window.__state = runtimeState;'),
  'runtime-state-facade should expose runtimeState through the temporary window.__state compatibility facade'
);

assert.ok(
  appSource.includes('configureSessionStateProvider(runtimeState);'),
  'app.js should configure the session state provider with runtimeState'
);

console.log('session state provider check passed');
