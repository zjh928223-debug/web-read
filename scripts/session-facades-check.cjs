const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const readerAssemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const importRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-import-runtime.js'), 'utf8');
  const facadeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-facades.js'), 'utf8');
  const sessionRuntimeDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-deps.js'), 'utf8');

[
  'clearGeneratedAnnotationIndex',
  'clearPersistedChunkSession',
  'getAnnotationGenerationScope',
  'emitAnnotationDiagnostics',
  'scheduleGeneratedAnnotationIndexRefresh',
  'syncAnnotationGenerationEntryStatus'
].forEach((name) => {
  assert.equal(appSource.includes(`function ${name}(`), false, `app.js should not own ${name}`);
  assert.equal(appSource.includes(`window.${name} =`), false, `app.js should not own window.${name}`);
  assert.ok(facadeSource.includes(`export function ${name}(`), `session-facades should export ${name}`);
  assert.ok(facadeSource.includes(`windowObject.${name} = ${name};`), `session-facades should own window.${name}`);
});

[
  '__session_clearGeneratedAnnotationIndex',
  '__session_clearPersistedChunkSession',
  '__session_getAnnotationGenerationScope',
  '__session_emitAnnotationDiagnostics',
  '__session_scheduleGeneratedAnnotationIndexRefresh',
  '__session_syncAnnotationGenerationEntryStatus'
].forEach((name) => {
  assert.equal(sessionRuntimeDepsSource.includes(name), false, `session-runtime-deps should not expose retired ${name}`);
  assert.equal(facadeSource.includes(name), false, `session-facades should not delegate through retired ${name}`);
});

assert.ok(
  readerAssemblySource.includes("import { syncAnnotationGenerationEntryStatus } from './session-facades.js';"),
  'reader-runtime-assembly should import directly consumed session facades'
);
assert.equal(
  facadeSource.includes('__session_initAnnotationApiSettingsUi'),
  false,
  'session-facades should not keep retired annotation API settings facade'
);
assert.equal(
  sessionRuntimeDepsSource.includes('__session_initAnnotationApiSettingsUi'),
  false,
  'session-runtime-deps should not expose retired annotation API settings facade'
);
assert.ok(
  importRuntimeSource.includes("} from './session-facades.js'"),
  'reader-import-runtime should import session facades'
);
assert.equal(
  appSource.includes('configureSessionFacades({'),
  false,
  'app.js should not configure session facade runtime deps directly'
);
assert.ok(
  importRuntimeSource.includes('configureSessionFacades({'),
  'reader-import-runtime should configure session facade runtime deps'
);

const encodedSource = Buffer.from(facadeSource, 'utf8').toString('base64');
const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
const fakeWindow = {
  localStorage: { getItem() { return null; } },
  AnnotationGeneratedResultStore: { id: 'store' },
  AnnotationClickResolver: { id: 'resolver' }
};
const calls = [];
const runtimeState = { annotationGeneratedIndexScopeKey: 'audio::doc' };

api.configureSessionFacades({
  getWindow: () => fakeWindow,
  getRuntimeState: () => runtimeState,
  clearGeneratedAnnotationIndex() { calls.push(['clear']); },
  clearPersistedChunkSession() { calls.push(['clearPersisted']); return Promise.resolve('cleared'); },
  getAnnotationGenerationScope() { calls.push(['scope']); return { audioKey: 'audio', documentId: 'doc' }; },
  emitAnnotationDiagnostics(event, payload) { calls.push(['diagnostics', event, payload]); },
  scheduleGeneratedAnnotationIndexRefresh() { calls.push(['schedule']); return Promise.resolve('scheduled'); },
  syncAnnotationGenerationEntryStatus() { calls.push(['sync']); return 'synced'; }
});

api.clearGeneratedAnnotationIndex();
assert.equal(await api.clearPersistedChunkSession(), 'cleared');
assert.deepEqual(api.getAnnotationGenerationScope(), { audioKey: 'audio', documentId: 'doc' });
assert.equal(api.getAnnotationGenerationScopeKey(), 'audio::doc');
assert.equal(api.getAnnotationGeneratedIndexScopeKey(), 'audio::doc');
api.emitAnnotationDiagnostics('event.a', { ok: true });
assert.equal(await api.scheduleGeneratedAnnotationIndexRefresh(), 'scheduled');
assert.equal(api.syncAnnotationGenerationEntryStatus(), 'synced');
assert.equal(api.getAnnotationGeneratedResultStore(), fakeWindow.AnnotationGeneratedResultStore);
assert.equal(api.getAnnotationClickResolver(), fakeWindow.AnnotationClickResolver);
assert.equal(fakeWindow.clearGeneratedAnnotationIndex, api.clearGeneratedAnnotationIndex);
assert.deepEqual(calls.map((entry) => entry[0]), ['clear', 'clearPersisted', 'scope', 'scope', 'diagnostics', 'schedule', 'sync']);

console.log('session facades check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
