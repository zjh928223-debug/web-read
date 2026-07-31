const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-startup-cleanup.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const sessionAssemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const sessionLifecyclePath = path.join(repoRoot, 'src', 'composables', 'session-lifecycle-runtime.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');
  const sessionAssemblySource = fs.readFileSync(sessionAssemblyPath, 'utf8');
  const sessionLifecycleSource = fs.readFileSync(sessionLifecyclePath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && sessionAssemblySource.includes("from './session-lifecycle-runtime.js';")
      && sessionLifecycleSource.includes("from './session-startup-cleanup.js';"),
    'session-init should reach startup cleanup runtime through session-runtime-assembly'
  );
  [
    'async function clearPersistedChunkSession()',
    'async function clearPersistedReaderContentOnStartup()'
  ].forEach((pattern) => {
    assert.equal(sessionInitSource.includes(pattern), false, `session-init should not keep cleanup helper: ${pattern}`);
  });
  assert.ok(moduleSource.includes('export function createSessionStartupCleanupRuntime'));

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const removed = [];
  const deleted = [];
  const diagnostics = [];
  const toggleChunkBtn = { innerText: '' };
  const state = {
    currentAudioKey: 'audio-1',
    chunkItems: [{ id: 1 }],
    hasAiChunkData: true,
    manualChunkStates: { a: true },
    lastActiveChunkIndex: 2,
    lastAiPrevTapChunkIndex: 3,
    lastAiPrevTapAt: 4,
    isChunkMode: true
  };
  const namespace = {
    currentDocId: 'doc-1',
    selectedSentence: { id: 's' }
  };
  const runtime = api.createSessionStartupCleanupRuntime({
    state,
    namespace,
    localStorageApi: {
      removeItem(key) {
        removed.push(key);
      }
    },
    documentObject: {
      getElementById(id) {
        return id === 'toggle-chunk-btn' ? toggleChunkBtn : null;
      }
    },
    async deleteFromDB(key) {
      deleted.push(key);
    },
    emitAnnotationDiagnostics(event, payload) {
      diagnostics.push({ event, payload });
    },
    getAnnotationGenerationScope() {
      return { audioKey: state.currentAudioKey, documentId: namespace.currentDocId };
    }
  });

  await runtime.clearPersistedChunkSession();
  assert.deepEqual(state.chunkItems, []);
  assert.equal(state.hasAiChunkData, false);
  assert.deepEqual(state.manualChunkStates, {});
  assert.equal(namespace.selectedSentence, null);
  assert.equal(state.lastActiveChunkIndex, -1);
  assert.equal(state.lastAiPrevTapChunkIndex, -1);
  assert.equal(state.lastAiPrevTapAt, 0);
  assert.equal(state.isChunkMode, false);
  assert.deepEqual(deleted, ['chunkData', 'marks']);
  assert.equal(toggleChunkBtn.innerText, 'AI切分');
  assert.ok(removed.includes('st.manualChunkStates'));
  assert.ok(removed.includes('st.isChunkMode'));

  await runtime.clearPersistedReaderContentOnStartup();
  assert.equal(diagnostics[0].event, 'app.startup_clear_reader_skipped');
  assert.deepEqual(diagnostics[0].payload.scope, { audioKey: 'audio-1', documentId: 'doc-1' });
  assert.ok(removed.includes('st.chunkCnVisible'));
  assert.ok(removed.includes('st.chunkCnHoldMode'));
  assert.ok(removed.includes('chunkNoteVisible'));

  console.log('session startup cleanup check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
