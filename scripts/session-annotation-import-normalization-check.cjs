const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-import-normalization.js');
  const lightweightIoPath = path.join(repoRoot, 'src', 'composables', 'session-annotation-lightweight-io.js');
  const sessionAssemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const sessionAnnotationRuntimePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-runtime.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const lightweightIoSource = fs.readFileSync(lightweightIoPath, 'utf8');
  const sessionAssemblySource = fs.readFileSync(sessionAssemblyPath, 'utf8');
  const sessionAnnotationRuntimeSource = fs.readFileSync(sessionAnnotationRuntimePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && sessionAssemblySource.includes("from './session-annotation-runtime.js';")
      && sessionAnnotationRuntimeSource.includes("from './session-annotation-lightweight-io.js';")
      && lightweightIoSource.includes("from './session-annotation-import-normalization.js';"),
    'session-init should reach manual lightweight import normalization through the lightweight IO runtime'
  );
  [
    'function buildManualLightweightTargetLookup(targets)',
    'function resolveManualLightweightImportTarget(item, lookup)',
    'function normalizeManualLightweightImportedItem(raw, index)'
  ].forEach((pattern) => {
    assert.equal(sessionInitSource.includes(pattern), false, `session-init should not keep local import normalization helper: ${pattern}`);
  });
  [
    'export function buildManualLightweightTargetLookup',
    'export function resolveManualLightweightImportTarget',
    'export function normalizeManualLightweightImportedItem'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `session-annotation-import-normalization should export ${pattern}`);
  });
  ['window.', 'document.', 'localStorage', 'storage.'].forEach((pattern) => {
    assert.equal(moduleSource.includes(pattern), false, `import normalization module should not depend on session/storage globals: ${pattern}`);
  });
  assert.equal(/\bst\s*\./.test(moduleSource), false, 'import normalization module should not read session state directly');

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const deps = {
    normalizeAnnotationTextValue(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    },
    normalizeAnnotationSentenceValue(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    },
    getAnnotationTargetSentenceText(target) {
      return String(target && target.sentenceText || '').trim();
    },
    buildSyntheticAnnotationTargetFromEncodedId(targetId, item) {
      if (targetId === 'encoded-target') {
        return {
          id: targetId,
          markedText: item.markedText,
          sentenceText: item.sentence
        };
      }
      return null;
    }
  };

  const alphaA = { id: 'alpha-a', markedText: 'Alpha', sentenceText: 'Alpha repeats here.' };
  const alphaB = { id: 'alpha-b', markedText: 'Alpha', sentenceText: 'Alpha repeats here.' };
  const beta = { id: 'beta', markedText: 'Beta', sentenceText: 'Beta appears once.' };
  const lookup = api.buildManualLightweightTargetLookup([alphaA, alphaB, beta], deps);
  assert.equal(lookup.byId.get('beta'), beta);
  assert.equal(lookup.occurrenceByTargetId.get('alpha-a'), 0);
  assert.equal(lookup.occurrenceByTargetId.get('alpha-b'), 1);

  assert.deepEqual(
    api.normalizeManualLightweightImportedItem({
      targetId: 'alpha-a',
      marked_text: 'Alpha',
      sentence_text: 'Alpha repeats here.',
      occurrence_index: '1',
      note: 'memory',
      definition: 'meaning'
    }, 3, deps),
    {
      index: 3,
      ok: true,
      targetId: 'alpha-a',
      markedText: 'Alpha',
      sentence: 'Alpha repeats here.',
      sourceSentence: 'Alpha repeats here.',
      occurrenceIndex: 1,
      boundary: '',
      type: '',
      meaning: 'meaning',
      memoryHint: 'memory',
      hasAnyBackfillField: true
    }
  );
  assert.deepEqual(api.normalizeManualLightweightImportedItem({ markedText: 'Missing id' }, 4, deps), {
    index: 4,
    ok: false,
    reason: 'missing-targetId'
  });

  assert.equal(api.resolveManualLightweightImportTarget({ targetId: 'beta' }, lookup, deps).target, beta);
  assert.equal(
    api.resolveManualLightweightImportTarget({
      targetId: 'missing',
      sentence: 'Alpha repeats here.',
      markedText: 'Alpha',
      occurrenceIndex: 1
    }, lookup, deps).target,
    alphaB
  );
  assert.equal(
    api.resolveManualLightweightImportTarget({
      targetId: 'missing',
      sentence: 'Alpha repeats here.',
      markedText: 'Alpha'
    }, lookup, deps).reason,
    'ambiguous-without-occurrenceIndex'
  );
  assert.equal(
    api.resolveManualLightweightImportTarget({
      targetId: 'encoded-target',
      sentence: 'Synthetic sentence',
      markedText: 'Synthetic'
    }, lookup, deps).matchType,
    'targetId-encoded-range'
  );

  assert.throws(
    () => api.buildManualLightweightTargetLookup([], {}),
    /Missing annotation import normalization dependency/
  );

  console.log('session annotation import normalization check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
