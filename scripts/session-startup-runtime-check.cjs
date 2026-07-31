const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-startup-runtime.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const assemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const lifecyclePath = path.join(repoRoot, 'src', 'composables', 'session-lifecycle-runtime.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');
  const assemblySource = fs.readFileSync(assemblyPath, 'utf8');
  const lifecycleSource = fs.readFileSync(lifecyclePath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && assemblySource.includes("from './session-lifecycle-runtime.js';")
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
    ['st.chunkCnHoldMode', 'true'],
    ['chunkNoteVisible', 'true']
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
    await api.startSessionRuntime({
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
      adjustChunkNoteArrowSizeByGap() {
        calls.push('adjust');
      },
      setChunkNoteVisible(value, persist) {
        calls.push(['noteVisible', value, persist]);
      },
      updateChunkCnHoldBtn() {
        calls.push('hold');
      },
      async restoreSession() {
        calls.push('restore');
      }
    });
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  assert.deepEqual(calls.slice(0, 3), ['initDB', 'clear', 'adjust']);
  assert.deepEqual(state.manualChunkStates, { a: true });
  assert.equal(state.chunkCnMode, 'focus');
  assert.equal(state.isChunkShadowOn, false);
  assert.ok(classes.includes('hide-chunk-shadow'));
  assert.ok(styleWrites.some((entry) => entry.name === '--chunk-gap' && entry.value === '12px'));
  assert.equal(focusBtn.innerText, '聚焦');
  assert.ok(focusBtn.classes.includes('active'));
  assert.ok(transcriptContainer.classes.includes('cn-mode-focus'));
  assert.equal(state.chunkCnVisible, true);
  assert.equal(state.chunkCnHoldMode, true);
  assert.equal(namespace.chunkNoteVisible, true);
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'noteVisible' && call[1] === true && call[2] === false));
  assert.ok(calls.includes('restore'));
  assert.equal(toggled, true);

  console.log('session startup runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
