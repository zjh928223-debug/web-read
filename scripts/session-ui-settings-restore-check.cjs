const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-ui-settings-restore.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const assemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const lifecyclePath = path.join(repoRoot, 'src', 'composables', 'session-lifecycle-runtime.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8').replace(
    /^import \{ recordBestEffortFailure \} from '\.\.\/services\/runtime\/best-effort\.js';?$/m,
    'const recordBestEffortFailure = () => null;',
  );
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');
  const assemblySource = fs.readFileSync(assemblyPath, 'utf8');
  const lifecycleSource = fs.readFileSync(lifecyclePath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && assemblySource.includes("from './session-lifecycle-runtime.js';")
      && lifecycleSource.includes("from './session-ui-settings-restore.js';"),
    'session-init should reach UI settings restore through session-runtime-assembly'
  );
  assert.equal(sessionInitSource.includes('readStoredHotkey'), false, 'session-init should not keep UI settings restore logic');
  assert.ok(moduleSource.includes('export function restoreSessionUiSettings'));

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const storage = new Map([
    ['markKey', 'M'],
    ['st.annotationBubbleKey', 'A'],
    ['st.chunkCnKey', 'C'],
    ['st.chunkShadowKey', 'S'],
    ['st.backwardKey', 'ArrowLeft'],
    ['st.forwardKey', 'ArrowRight'],
    ['highlightColor', '#ff0'],
    ['sentenceColor', '#0ff'],
  ]);
  const written = [];
  const styles = [];
  const input = () => ({ value: '' });
  const inputs = {
    hotkeyInput: input(),
    hotkeyAnnotationBubbleInput: input(),
    hotkeyChunkCnInput: input(),
    hotkeyChunkShadowInput: input(),
    hotkeyBackwardInput: input(),
    hotkeyForwardInput: input(),
    highlightColorInput: input(),
    sentenceColorInput: input()
  };
  const state = {};
  api.restoreSessionUiSettings({
    state,
    localStorageApi: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        written.push({ key, value });
      }
    },
    documentObject: {
      documentElement: {
        style: {
          setProperty(name, value) {
            styles.push({ name, value });
          }
        }
      }
    },
    windowObject: { innerHeight: 700 },
    ...inputs
  });

  assert.equal(state.markKey, 'm');
  assert.equal(state.annotationBubbleKey, 'a');
  assert.equal(state.chunkCnKey, 'c');
  assert.equal(state.chunkShadowKey, 's');
  assert.equal(state.backwardKey, 'ArrowLeft');
  assert.equal(state.forwardKey, 'ArrowRight');
  assert.equal(inputs.hotkeyInput.value, 'm');
  assert.equal(inputs.highlightColorInput.value, '#ff0');
  assert.ok(styles.some((entry) => entry.name === '--word-highlight-bg' && entry.value === '#ff0'));
  assert.deepEqual(written, []);

  console.log('session UI settings restore check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
