const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-startup-runtime.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const assemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const adaptersPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-adapters.js');
  const lifecyclePath = path.join(repoRoot, 'src', 'composables', 'session-lifecycle-runtime.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8').replace(
    /^import \{ recordBestEffortFailure \} from '\.\.\/services\/runtime\/best-effort\.js';?$/m,
    'const recordBestEffortFailure = () => null;',
  );
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');
  const assemblySource = fs.readFileSync(assemblyPath, 'utf8');
  const adaptersSource = fs.readFileSync(adaptersPath, 'utf8');
  const lifecycleSource = fs.readFileSync(lifecyclePath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && assemblySource.includes("from './session-runtime-adapters.js';")
      && adaptersSource.includes("from './session-lifecycle-runtime.js';")
      && lifecycleSource.includes("from './session-startup-runtime.js';"),
    'session-init should reach startup runtime through session-runtime-assembly'
  );
  assert.equal(sessionInitSource.includes('initDB().then'), false, 'session-init should not keep startup flow');
  assert.ok(moduleSource.includes('export function startSessionRuntime'));

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const store = new Map([
    ['st.manualChunkStates', JSON.stringify({ a: true })],
    ['st.chunkCnMode', 'focus'],
    ['st.isChunkShadowOn', 'false'],
    ['chunkGap', '12px'],
    ['st.isChunkMode', 'true'],
    ['st.chunkCnVisible', 'true'],
    ['st.chunkCnHoldMode', 'true']
  ]);
  const state = {
    chunkItems: [{ id: 1 }],
    hasAiChunkData: true,
    isChunkMode: true
  };
  const namespace = {};
  const classes = [];
  const styleWrites = [];
  const focusBtn = {
    innerText: '',
    classes: [],
    classList: {
      add(value) {
        focusBtn.classes.push(value);
      }
    }
  };
  const transcriptContainer = {
    classes: [],
    classList: {
      add(value) {
        transcriptContainer.classes.push(value);
      }
    }
  };
  const calls = [];
  let toggled = false;
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (handler) => {
    handler();
    return 1;
  };
  try {
    const runtime = api.startSessionRuntime({
      state,
      namespace,
      localStorageApi: {
        getItem(key) {
          return store.has(key) ? store.get(key) : null;
        }
      },
      documentObject: {
        body: {
          classList: {
            add(value) {
              classes.push(value);
            }
          }
        },
        documentElement: {
          style: {
            setProperty(name, value) {
              styleWrites.push({ name, value });
            }
          }
        },
        getElementById(id) {
          return id === 'btn-chunk-focus' ? focusBtn : null;
        }
      },
      windowObject: {
        toggleChunkMode(value) {
          toggled = value;
        }
      },
      transcriptContainer,
      async initDB() {
        calls.push('initDB');
      },
      async clearPersistedReaderContentOnStartup() {
        calls.push('clear');
      },
      updateChunkCnHoldBtn() {
        calls.push('hold');
      },
      async restoreSession() {
        calls.push('restore');
      },
      emitAnnotationDiagnostics(event, detail) {
        assert.equal(event, 'app.startup_complete');
        assert.equal(detail.contentRestored, false);
        calls.push('startup-complete');
      }
    });
    await runtime.ready;
    runtime.dispose();
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  assert.deepEqual(calls.slice(0, 3), ['initDB', 'clear', 'hold']);
  assert.equal(Object.hasOwn(state, 'manualChunkStates'), false, 'stale manual preference must not create current session state');
  assert.equal(store.get('st.manualChunkStates'), JSON.stringify({ a: true }), 'startup restoration must not rewrite legacy user preferences');
  assert.equal(state.chunkCnMode, 'focus');
  assert.equal(state.isChunkShadowOn, false);
  assert.ok(classes.includes('hide-chunk-shadow'));
  assert.ok(styleWrites.some((entry) => entry.name === '--chunk-gap' && entry.value === '12px'));
  assert.equal(focusBtn.innerText, '聚焦');
  assert.ok(focusBtn.classes.includes('active'));
  assert.ok(transcriptContainer.classes.includes('cn-mode-focus'));
  assert.equal(state.chunkCnVisible, true);
  assert.equal(state.chunkCnHoldMode, true);
  assert.equal(calls.includes('restore'), false, 'normal startup must not read owner, committed, or legacy article candidates');
  assert.ok(calls.indexOf('startup-complete') > calls.indexOf('hold'), 'startup completion must follow personal preference restoration');
  assert.equal(toggled, false, 'startup must not enter the old article AI mode');

  // Exercise the actual cleanup before restoration; a cleanup stub hides lost preferences.
  const cleanupSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-startup-cleanup.js'), 'utf8').replace(
    /^import \{ recordBestEffortFailure \} from '\.\.\/services\/runtime\/best-effort\.js';?$/m,
    'const recordBestEffortFailure = () => null;',
  );
  const cleanupApi = await import(`data:text/javascript;base64,${Buffer.from(cleanupSource, 'utf8').toString('base64')}#preference`);
  for (const savedHoldMode of ['false', 'true', null]) {
    const preferenceStore = new Map([
      ['st.manualChunkStates', 'legacy'],
      ['st.isChunkMode', 'true'],
      ['st.chunkCnVisible', 'true'],
      ...(savedHoldMode === null ? [] : [['st.chunkCnHoldMode', savedHoldMode]])
    ]);
    const preferenceState = {
      chunkCnHoldMode: true,
      chunkCnVisible: false,
      isChunkMode: false,
      chunkItems: [],
      hasAiChunkData: false
    };
    const preferenceStorage = {
      getItem(key) { return preferenceStore.get(key) ?? null; },
      removeItem(key) { preferenceStore.delete(key); }
    };
    const preferenceDocument = {
      body: { classList: { add() {} } },
      documentElement: { style: { setProperty() {} } },
      getElementById() { return null; }
    };
    const cleanupRuntime = cleanupApi.createSessionStartupCleanupRuntime({
      state: preferenceState,
      localStorageApi: preferenceStorage,
      documentObject: preferenceDocument,
      emitAnnotationDiagnostics() {},
      getAnnotationGenerationScope() { return {}; },
      async deleteFromDB() { assert.fail('normal startup must retain stored reader data'); }
    });
    const expectedHoldMode = savedHoldMode !== 'false';
    const preferenceRuntime = api.startSessionRuntime({
      state: preferenceState,
      localStorageApi: preferenceStorage,
      documentObject: preferenceDocument,
      windowObject: { toggleChunkMode() { assert.fail('cleared mode must not enable AI mode'); } },
      async initDB() {},
      clearPersistedReaderContentOnStartup: cleanupRuntime.clearPersistedReaderContentOnStartup,
      updateChunkCnHoldBtn() { assert.equal(preferenceState.chunkCnHoldMode, expectedHoldMode); },
      async restoreSession() { assert.fail('saved articles must require active opening'); }
    });
    try {
      await preferenceRuntime.ready;
      assert.equal(preferenceState.chunkCnHoldMode, expectedHoldMode, `restore the saved interaction mode: ${savedHoldMode}`);
      assert.equal(preferenceStorage.getItem('st.chunkCnHoldMode'), savedHoldMode, 'startup must neither delete nor rewrite the preference');
      for (const clearedKey of ['st.manualChunkStates', 'st.isChunkMode', 'st.chunkCnVisible']) {
        assert.equal(preferenceStorage.getItem(clearedKey), null);
      }
      assert.equal(preferenceState.chunkCnVisible, false);
    } finally {
      preferenceRuntime.dispose();
    }
  }

  let releaseDB;
  const disposedRuntime = api.startSessionRuntime({
    initDB() { return new Promise(resolve => { releaseDB = resolve; }); },
    clearPersistedReaderContentOnStartup() { assert.fail('disposed startup must not restore settings or content'); },
  });
  disposedRuntime.dispose();
  releaseDB();
  await disposedRuntime.ready;

  console.log('session startup runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
