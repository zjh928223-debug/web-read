const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-runtime-deps.js');
  const assemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const assemblySource = fs.readFileSync(assemblyPath, 'utf8');

  [
    'export function createSessionRuntimeDeps',
    "getElement('audio-player')",
    "getElement('annotation-mark-count')",
    'windowObject.saveToDB',
    'annotationLightweightModule: windowObject.__annotationLightweightModule'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `session-runtime-deps should contain ${pattern}`);
  });

  assert.ok(
    assemblySource.includes("import {\n    createSessionRuntimeDeps\n} from './session-runtime-deps.js';"),
    'session-runtime-assembly should import session runtime deps'
  );
  assert.equal(moduleSource.includes('__session_'), false, 'session-runtime-deps should not expose retired session runtime facades');
  assert.equal(moduleSource.includes('installSessionRuntimeFacades'), false, 'session-runtime-deps should not install session runtime facades');
  assert.equal(assemblySource.includes('window.'), false, 'session-runtime-assembly should not directly read/write window globals');
  assert.equal(assemblySource.includes('document.getElementById'), false, 'session-runtime-assembly should not directly query DOM refs');

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const { createSessionRuntimeDeps } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const elements = new Map([
    ['audio-player', { id: 'audio-player', currentTime: 12 }],
    ['annotation-mark-count', { id: 'annotation-mark-count' }],
    ['hotkey-input', { id: 'hotkey-input' }]
  ]);
  const windowObject = {
    _ns: { chunkNoteVisible: true },
    localStorage: { getItem() { return null; } },
    URL: { createObjectURL() { return 'blob:test'; } },
    Blob: function Blob() {},
    saveToDB() {},
    loadFromDB() {},
    deleteFromDB() {},
    initDB() {},
    showToast() {},
    __annotationLightweightModule: { id: 'annotation-lightweight' }
  };
  const documentObject = {
    getElementById(id) {
      return elements.get(id) || null;
    }
  };

  const deps = createSessionRuntimeDeps({
    getWindow: () => windowObject,
    getDocument: () => documentObject
  });

  assert.equal(deps.windowObject, windowObject);
  assert.equal(deps.documentObject, documentObject);
  assert.equal(deps.namespace, windowObject._ns);
  assert.equal(deps.domRefs.audioPlayer.id, 'audio-player');
  assert.equal(deps.domRefs.annotationMarkCountEl.id, 'annotation-mark-count');
  assert.equal(deps.domRefs.hotkeyInput.id, 'hotkey-input');
  assert.equal(deps.globals.saveToDB, windowObject.saveToDB);
  assert.equal(deps.globals.showToast, windowObject.showToast);
  assert.equal(deps.globals.annotationLightweightModule, windowObject.__annotationLightweightModule);

  assert.equal(windowObject.__session_clearGeneratedAnnotationIndex, undefined);
  assert.equal(windowObject.__session_clearPersistedChunkSession, undefined);
  assert.equal(windowObject.__session_getAnnotationGenerationScope, undefined);
  assert.equal(windowObject.__session_emitAnnotationDiagnostics, undefined);
  assert.equal(windowObject.__session_scheduleGeneratedAnnotationIndexRefresh, undefined);
  assert.equal(windowObject.__session_syncAnnotationGenerationEntryStatus, undefined);
  assert.equal(windowObject.__session_exportManualLightweightAnnotations, undefined);
  assert.equal(windowObject.__session_importManualLightweightAnnotations, undefined);
  assert.equal(windowObject.__session_initAnnotationApiSettingsUi, undefined);

  console.log('session runtime deps check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
