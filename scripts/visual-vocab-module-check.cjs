const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
  const importRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-import-runtime.js'), 'utf8');
  const visualSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'visual-vocab-module.js'), 'utf8');
  const bindingsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'runtime-state-bindings.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeShell } from './reader-runtime-shell.js';"),
    'reader-runtime should delegate reader import runtime through reader-runtime-shell'
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
    runtimeSource.includes("import { initVisualVocab } from './visual-vocab-module.js';"),
    false,
    'reader-runtime should not import the visual vocab module directly'
  );
  assert.ok(
    importRuntimeSource.includes("import { initVisualVocab } from './visual-vocab-module.js'"),
    'reader-import-runtime should import the visual vocab module'
  );
  assert.ok(
    importRuntimeSource.includes('var visualVocabApi = initVisualVocab({'),
    'reader-import-runtime should initialize visual vocab through the module'
  );
  assert.ok(
    bindingsSource.includes("defineRuntimeStateBinding(runtimeState, 'globalVocab', () => visualVocabApi.globalVocab"),
    'reader-runtime should expose globalVocab through the module facade'
  );
  assert.ok(
    bindingsSource.includes("defineRuntimeStateBinding(runtimeState, 'vocabMatchMap', () => visualVocabApi.vocabMatchMap"),
    'reader-runtime should expose vocabMatchMap through the module facade'
  );
  assert.ok(
    importRuntimeSource.includes('rebuildVocabMatching: visualVocabApi.rebuildVocabMatching'),
    'reader-import-runtime should inject module-owned rebuildVocabMatching'
  );

  [
    'let globalVocab',
    'let vocabMatchMap',
    'function rebuildVocabMatching',
    'function updateVisualHelper',
    'function activateSearch'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own visual vocab logic: ${pattern}`
    );
  });

  [
    'export function initVisualVocab',
    'function processVisual(data)',
    'function rebuildVocabMatching()',
    'window.processVisual = processVisual;'
  ].forEach((pattern) => {
    assert.ok(
      visualSource.includes(pattern),
      `visual-vocab-module should own ${pattern}`
    );
  });

  assert.ok(
    sessionInitSource.includes('processVisual(visualData);'),
    'session-init should keep the existing processVisual restore contract'
  );

  const previousWindow = global.window;
  const previousMap = global.Map;
  global.window = {};

  try {
    const encodedSource = Buffer.from(visualSource, 'utf8').toString('base64');
    const { initVisualVocab } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

    let hasTranscriptData = false;
    let words = [{ text: 'Hello' }, { text: 'world' }];
    let validateCalls = 0;
    let buildCalls = 0;
    let bridgeCalls = 0;
    let savedRecord = null;
    let loadedLabel = null;
    let restoredFocus = 0;
    const toasts = [];

    const visualFileInput = {
      listeners: {},
      addEventListener(type, handler) {
        this.listeners[type] = handler;
      }
    };
    const lblVisual = { id: 'lbl-visual' };

    const api = initVisualVocab({
      visualFileInput,
      validateVisualData(data) {
        validateCalls += 1;
        return data;
      },
      buildVocabMatchMap(receivedWords, receivedVocab) {
        buildCalls += 1;
        assert.equal(receivedWords, words, 'module should use injected words source');
        assert.equal(receivedVocab, api.globalVocab, 'module should pass its stable vocab array');
        return new Map([[1, { word: receivedVocab[0].word, match_context: receivedVocab[0].match_context }]]);
      },
      hasTranscriptData: () => hasTranscriptData,
      getWords: () => words,
      saveToDB: (id, data) => { savedRecord = { id, data }; },
      getFirstFileFromEvent: () => ({ name: 'visual.json' }),
      readFileAsText: (file, callback) => callback(JSON.stringify({ vocab_list: [{ word: 'Loaded', match_context: 'Loaded word' }] })),
      markFileLoaded: (label) => { loadedLabel = label; },
      lblVisual,
      showToast: (message, type) => { toasts.push({ message, type }); },
      showError: (code, message) => { throw new Error(`${code}: ${message}`); },
      restoreReaderFocus: () => { restoredFocus += 1; },
      bridgeToPinia: () => { bridgeCalls += 1; }
    });

    assert.equal(typeof global.window.processVisual, 'function', 'module should keep window.processVisual compatibility');
    assert.equal(typeof visualFileInput.listeners.change, 'function', 'module should bind visual file input when present');

    const stableVocab = api.globalVocab;
    const stableMap = api.vocabMatchMap;

    api.processVisual({ vocab_list: [{ word: 'Blocked', match_context: 'Blocked word' }] });
    assert.equal(api.globalVocab, stableVocab, 'globalVocab should keep a stable array reference');
    assert.equal(api.vocabMatchMap, stableMap, 'vocabMatchMap should keep a stable Map reference');
    assert.equal(api.globalVocab[0].word, 'Blocked');
    assert.equal(api.vocabMatchMap.size, 0, 'matching should stay empty before transcript data exists');
    assert.equal(buildCalls, 0, 'matching builder should not run before transcript data exists');

    hasTranscriptData = true;
    global.window.processVisual({ vocab_list: [{ word: 'Hello', match_context: 'Hello world' }] });
    assert.equal(api.globalVocab, stableVocab);
    assert.equal(api.vocabMatchMap, stableMap);
    assert.equal(api.globalVocab.length, 1);
    assert.equal(api.globalVocab[0].word, 'Hello');
    assert.deepEqual(api.vocabMatchMap.get(1), { word: 'Hello', match_context: 'Hello world' });
    assert.equal(buildCalls, 1);
    assert.equal(bridgeCalls, 1);

    api.setGlobalVocab([{ word: 'Manual', match_context: 'Manual word' }]);
    assert.equal(api.globalVocab, stableVocab);
    assert.equal(api.globalVocab[0].word, 'Manual');

    api.setVocabMatchMap(new Map([[2, { word: 'Manual' }]]));
    assert.equal(api.vocabMatchMap, stableMap);
    assert.deepEqual(api.vocabMatchMap.get(2), { word: 'Manual' });

    const changeEvent = { target: { value: 'visual.json' } };
    visualFileInput.listeners.change(changeEvent);
    assert.deepEqual(savedRecord, { id: 'visual', data: { vocab_list: [{ word: 'Loaded', match_context: 'Loaded word' }] } });
    assert.equal(api.globalVocab[0].word, 'Loaded');
    assert.deepEqual(api.vocabMatchMap.get(1), { word: 'Loaded', match_context: 'Loaded word' });
    assert.equal(loadedLabel, lblVisual);
    assert.ok(toasts.some((toast) => toast.message === 'Visual data loaded' && toast.type === 'success'));
    assert.equal(changeEvent.target.value, '');
    assert.equal(restoredFocus, 1);
    assert.equal(validateCalls, 3, 'processVisual calls twice and file import validates once');
  } finally {
    global.window = previousWindow;
    global.Map = previousMap;
  }

  console.log('visual vocab module check passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
