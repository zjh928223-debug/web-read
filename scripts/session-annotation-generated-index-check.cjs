const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-generated-index.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const sessionAssemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const sessionAnnotationRuntimePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-runtime.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');
  const sessionAssemblySource = fs.readFileSync(sessionAssemblyPath, 'utf8');
  const sessionAnnotationRuntimeSource = fs.readFileSync(sessionAnnotationRuntimePath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && sessionAssemblySource.includes("from './session-annotation-runtime.js';")
      && sessionAnnotationRuntimeSource.includes("from './session-annotation-generated-index.js';"),
    'session-init should reach generated index runtime through session-runtime-assembly'
  );
  [
    'function getAnnotationGenerationScope()',
    'function clearGeneratedAnnotationIndex()',
    'async function refreshGeneratedAnnotationIndexForCurrentDocument()',
    'function scheduleGeneratedAnnotationIndexRefresh()',
    'function isAnnotationDebugEnabled()'
  ].forEach((pattern) => {
    assert.equal(sessionInitSource.includes(pattern), false, `session-init should not keep local generated-index helper: ${pattern}`);
  });
  [
    'export function normalizeAnnotationGenerationScope',
    'export function createSessionAnnotationGeneratedIndexRuntime'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `session-annotation-generated-index should export ${pattern}`);
  });
  ['document.'].forEach((pattern) => {
    assert.equal(moduleSource.includes(pattern), false, `generated index module should not depend on DOM globals: ${pattern}`);
  });

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  assert.deepEqual(api.normalizeAnnotationGenerationScope({ audioKey: ' a ', documentId: ' d ' }), {
    audioKey: 'a',
    documentId: 'd'
  });
  assert.deepEqual(api.normalizeAnnotationGenerationScope({}), {
    audioKey: 'default-audio',
    documentId: 'default-document'
  });

  const state = {
    currentAudioKey: 'audio-1',
    markedMap: new Map([[1, { word: 'one' }], [3, { word: 'two' }]]),
    annotationGeneratedIndexRefreshSeq: 0,
    annotationGeneratedIndexScopeKey: 'old'
  };
  const namespace = { currentDocId: 'doc-1' };
  const diagnostics = [];
  const warnings = [];
  const debug = [];
  const markCountAttrs = {};
  const markCountEl = {
    textContent: '',
    setAttribute(name, value) {
      markCountAttrs[name] = value;
    }
  };
  let cleared = 0;
  let loadedScope = null;
  let indexed = null;
  const storage = {
    normalizeScope(scope) {
      return {
        audioKey: String(scope.audioKey || '').trim(),
        documentId: String(scope.documentId || '').trim()
      };
    },
    async loadBundle(scope) {
      loadedScope = scope;
      return {
        generated: { items: [{ targetId: 'a' }, { targetId: 'b' }] },
        runtimeArtifacts: { ok: true }
      };
    }
  };
  const store = {
    clear() {
      cleared += 1;
    },
    indexBundle(generated, scope) {
      indexed = { generated, scope };
      return { itemCount: generated.items.length };
    }
  };
  const runtime = api.createSessionAnnotationGeneratedIndexRuntime({
    state,
    namespace,
    getWindow() {
      return {
        ANNOTATION_DEBUG: false,
        localStorage: {
          getItem(key) {
            return key === 'annotation.debug' ? 'true' : '';
          }
        }
      };
    },
    consoleApi: {
      warn(message, payload) {
        warnings.push({ message, payload });
      },
      debug(message, payload) {
        debug.push({ message, payload });
      }
    },
    getAnnotationGenerationStorage() {
      return storage;
    },
    getAnnotationGeneratedResultStore() {
      return store;
    },
    markCountEl,
    emitAnnotationDiagnostics(event, payload) {
      diagnostics.push({ event, payload });
    }
  });

  assert.deepEqual(runtime.getAnnotationGenerationScope(), { audioKey: 'audio-1', documentId: 'doc-1' });
  assert.equal(runtime.getAnnotationGenerationScopeKey(), 'audio-1::doc-1');
  const result = await runtime.refreshGeneratedAnnotationIndexForCurrentDocument();
  assert.deepEqual(result, { itemCount: 2 });
  assert.deepEqual(loadedScope, { audioKey: 'audio-1', documentId: 'doc-1' });
  assert.equal(indexed.generated.items.length, 2);
  assert.equal(state.annotationGeneratedIndexScopeKey, 'audio-1::doc-1');
  assert.equal(diagnostics[0].event, 'app.generated_index_refresh_start');
  assert.equal(diagnostics.at(-1).event, 'app.generated_index_refresh_complete');
  assert.equal(debug[0].message, '[annotation-debug] app.generated_index_refresh');

  runtime.clearGeneratedAnnotationIndex();
  assert.equal(cleared, 1);
  assert.equal(state.annotationGeneratedIndexScopeKey, '');
  assert.deepEqual(await runtime.syncAnnotationGenerationEntryStatus(), { markedCount: 2 });
  assert.equal(markCountEl.textContent, '已标记 2');
  assert.equal(markCountAttrs['data-count'], '2');
  assert.equal(markCountAttrs.title, '当前文章已标记 2 个重点词');

  const missingRuntime = api.createSessionAnnotationGeneratedIndexRuntime({
    state: { currentAudioKey: 'a', annotationGeneratedIndexRefreshSeq: 0, annotationGeneratedIndexScopeKey: '' },
    namespace: { currentDocId: 'd' },
    getWindow() {
      return {};
    },
    consoleApi: {
      warn(message, payload) {
        warnings.push({ message, payload });
      },
      debug() {}
    },
    getAnnotationGenerationStorage() {
      return null;
    },
    getAnnotationGeneratedResultStore() {
      return null;
    },
    emitAnnotationDiagnostics(event, payload) {
      diagnostics.push({ event, payload });
    }
  });
  assert.deepEqual(await missingRuntime.refreshGeneratedAnnotationIndexForCurrentDocument(), {
    itemCount: 0,
    skipped: true
  });
  assert.equal(diagnostics.at(-1).event, 'app.generated_index_refresh_skipped');
  assert.ok(warnings.some((entry) => entry.message === '[app] generated index refresh skipped'));

  console.log('session annotation generated index check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
