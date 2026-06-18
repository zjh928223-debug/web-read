const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const facadeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-facades.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

[
  'clearGeneratedAnnotationIndex',
  'clearPersistedChunkSession',
  'getAnnotationGenerationScope',
  'emitAnnotationDiagnostics',
  'scheduleGeneratedAnnotationIndexRefresh',
  'syncAnnotationGenerationEntryStatus',
  'initAnnotationApiSettingsUi'
].forEach((name) => {
  assert.equal(appSource.includes(`function ${name}(`), false, `app.js should not own ${name}`);
  assert.equal(appSource.includes(`window.${name} =`), false, `app.js should not own window.${name}`);
  assert.ok(facadeSource.includes(`export function ${name}(`), `session-facades should export ${name}`);
  assert.ok(facadeSource.includes(`window.${name} = ${name};`), `session-facades should own window.${name}`);
});

[
  '__session_clearGeneratedAnnotationIndex',
  '__session_clearPersistedChunkSession',
  '__session_getAnnotationGenerationScope',
  '__session_emitAnnotationDiagnostics',
  '__session_scheduleGeneratedAnnotationIndexRefresh',
  '__session_syncAnnotationGenerationEntryStatus',
  '__session_initAnnotationApiSettingsUi'
].forEach((name) => {
  assert.ok(sessionInitSource.includes(`window.${name} =`), `session-init should expose ${name}`);
  assert.ok(facadeSource.includes(`window.${name}`), `session-facades should delegate to ${name}`);
});

assert.ok(
  appSource.includes("} from './src/composables/session-facades.js';"),
  'app.js should import session facades'
);
assert.ok(
  appSource.includes('configureSessionFacades({'),
  'app.js should configure session facade runtime deps'
);

console.log('session facades check passed');
