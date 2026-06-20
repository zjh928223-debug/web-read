const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-ui-settings-restore.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const assemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');
  const assemblySource = fs.readFileSync(assemblyPath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && assemblySource.includes("from './session-ui-settings-restore.js';"),
    'session-init should reach UI settings restore through session-runtime-assembly'
  );
  assert.equal(sessionInitSource.includes('readStoredHotkey'), false, 'session-init should not keep UI settings restore logic');
  assert.ok(moduleSource.includes('export function restoreSessionUiSettings'));

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const storage = new Map([
    ['markKey', 'M'],
    ['st.notesKey', 'N'],
    ['st.annotationBubbleKey', 'A'],
    ['st.chunkCnKey', 'C'],
    ['st.chunkShadowKey', 'S'],
    ['st.chunkNoteKey', 'K'],
    ['st.backwardKey', 'ArrowLeft'],
    ['st.forwardKey', 'ArrowRight'],
    ['highlightColor', '#ff0'],
    ['sentenceColor', '#0ff'],
    ['chunkNoteSize', '18px'],
    ['chunkNoteColor', '#333'],
    ['chunkNoteWidth', '620'],
    ['chunkNoteMinHeight', '56'],
    ['chunkNoteArrowSize', '9px'],
    ['st.notePreviewVisible', 'true'],
    ['st.notePreviewWidth', '480'],
    ['st.notePreviewHeight', '1000']
  ]);
  const written = [];
  const styles = [];
  const input = () => ({ value: '' });
  const inputs = {
    hotkeyInput: input(),
    hotkeyNotesInput: input(),
    hotkeyAnnotationBubbleInput: input(),
    hotkeyChunkCnInput: input(),
    hotkeyChunkShadowInput: input(),
    hotkeyChunkNoteInput: input(),
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
  assert.equal(state.notesKey, 'n');
  assert.equal(state.annotationBubbleKey, 'a');
  assert.equal(state.chunkCnKey, 'c');
  assert.equal(state.chunkShadowKey, 's');
  assert.equal(state.chunkNoteKey, 'k');
  assert.equal(state.backwardKey, 'ArrowLeft');
  assert.equal(state.forwardKey, 'ArrowRight');
  assert.equal(inputs.hotkeyInput.value, 'm');
  assert.equal(inputs.highlightColorInput.value, '#ff0');
  assert.ok(styles.some((entry) => entry.name === '--word-highlight-bg' && entry.value === '#ff0'));
  assert.ok(styles.some((entry) => entry.name === '--chunk-note-width' && entry.value === '260px'));
  assert.ok(styles.some((entry) => entry.name === '--chunk-note-min-height' && entry.value === '18px'));
  assert.ok(written.some((entry) => entry.key === 'chunkNoteWidth' && entry.value === '260px'));
  assert.ok(written.some((entry) => entry.key === 'chunkNoteMinHeight' && entry.value === '18px'));
  assert.equal(state.notePreviewVisible, true);
  assert.equal(state.notePreviewWidth, 480);
  assert.equal(state.notePreviewHeight, 672);

  console.log('session UI settings restore check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
