const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-bundle-merge.js');
  const normalizationPath = path.join(repoRoot, 'src', 'composables', 'session-annotation-import-normalization.js');
  const lightweightIoPath = path.join(repoRoot, 'src', 'composables', 'session-annotation-lightweight-io.js');
  const sessionAssemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const sessionAnnotationRuntimePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-runtime.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const normalizationSource = fs.readFileSync(normalizationPath, 'utf8');
  const lightweightIoSource = fs.readFileSync(lightweightIoPath, 'utf8');
  const sessionAssemblySource = fs.readFileSync(sessionAssemblyPath, 'utf8');
  const sessionAnnotationRuntimeSource = fs.readFileSync(sessionAnnotationRuntimePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && sessionAssemblySource.includes("from './session-annotation-runtime.js';")
      && sessionAnnotationRuntimeSource.includes("from './session-annotation-lightweight-io.js';")
      && lightweightIoSource.includes("from './session-annotation-bundle-merge.js';"),
    'session-init should reach manual lightweight bundle merge through the lightweight IO runtime'
  );
  [
    'function buildImportedAnnotationStatusBlocks(items, existingBlocks)',
    'function buildManualLightweightImportedBundle(parsed, scope, storage)'
  ].forEach((pattern) => {
    assert.equal(sessionInitSource.includes(pattern), false, `session-init should not keep local bundle merge helper: ${pattern}`);
  });
  [
    'export function buildImportedAnnotationStatusBlocks',
    'export function buildManualLightweightImportedBundle'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `session-annotation-bundle-merge should export ${pattern}`);
  });
  ['window.', 'document.', 'localStorage'].forEach((pattern) => {
    assert.equal(moduleSource.includes(pattern), false, `bundle merge module should not depend on browser globals: ${pattern}`);
  });
  assert.equal(/\bst\s*\./.test(moduleSource), false, 'bundle merge module should not read session state directly');

  const testableSource = [
    normalizationSource.replace(/\bexport\s+/g, ''),
    moduleSource
      .replace(/import\s+\{[\s\S]*?\}\s+from\s+'\.\/session-annotation-import-normalization\.js';\s*/, '')
  ].join('\n');
  const encodedSource = Buffer.from(testableSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const scope = { audioKey: 'audio-1', documentId: 'doc-1' };
  const targets = [
    {
      id: 'target-a',
      markedText: 'Alpha',
      sentenceText: 'Alpha sentence.',
      sentenceId: 'block-a',
      occurrenceKey: 'occ-a',
      occurrenceGlobalStart: 10,
      occurrenceGlobalEnd: 15
    },
    {
      id: 'target-b',
      markedText: 'Beta',
      sentenceText: 'Beta sentence.',
      sentenceId: 'block-b'
    }
  ];
  const deps = {
    buildAnnotationTargetCollection() {
      return {
        context: { totalBlocks: 2 },
        targets
      };
    },
    normalizeAnnotationTextValue(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    },
    normalizeAnnotationSentenceValue(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    },
    getAnnotationTargetSentenceText(target) {
      return String(target && target.sentenceText || '').trim();
    },
    buildSyntheticAnnotationTargetFromEncodedId() {
      return null;
    }
  };
  const storage = {
    createGeneratedJson(sourceScope, items) {
      return { schemaVersion: 1, audioKey: sourceScope.audioKey, documentId: sourceScope.documentId, items };
    },
    createStatusJson(sourceScope, blocks) {
      return { schemaVersion: 1, audioKey: sourceScope.audioKey, documentId: sourceScope.documentId, blocks };
    },
    async loadBundle() {
      return {
        generated: {
          schemaVersion: 1,
          audioKey: scope.audioKey,
          documentId: scope.documentId,
          items: [
            {
              id: 'existing-target-a',
              targetId: 'target-a',
              type: 'old-type',
              boundary: 'Old boundary'
            }
          ]
        },
        status: { blocks: {} }
      };
    }
  };

  const merged = await api.buildManualLightweightImportedBundle({
    items: [
      {
        targetId: 'target-a',
        markedText: 'Alpha',
        sentence: 'Alpha sentence.',
        meaning: 'new meaning',
        memoryHint: 'remember alpha'
      },
      {
        targetId: 'missing-target',
        markedText: 'Missing',
        sentence: 'Missing sentence.',
        meaning: 'skip'
      },
      {
        targetId: 'target-b',
        markedText: 'Different',
        sentence: 'Beta sentence.',
        boundary: 'Beta boundary'
      },
      {
        targetId: '',
        markedText: 'No id',
        sentence: 'No id sentence.',
        meaning: 'skip'
      }
    ]
  }, scope, storage, deps);

  assert.equal(merged.importedCount, 2);
  assert.equal(merged.skippedCount, 2);
  assert.deepEqual(merged.missingTargetIds, ['missing-target']);
  assert.deepEqual(merged.markedTextMismatchTargetIds, ['target-b']);
  assert.equal(merged.generated.audioKey, scope.audioKey);
  assert.equal(merged.generated.documentId, scope.documentId);
  assert.equal(merged.generated.source, 'manual-lightweight-import');
  assert.equal(merged.generated.items.length, 2);
  assert.equal(merged.generated.items.find((item) => item.targetId === 'target-a').id, 'existing-target-a');
  assert.equal(merged.generated.items.find((item) => item.targetId === 'target-a').meaning, 'new meaning');
  assert.equal(merged.generated.items.find((item) => item.targetId === 'target-b').boundary, 'Beta boundary');
  assert.ok(merged.status.blocks['block-a']);
  assert.ok(merged.status.blocks['block-b']);

  assert.throws(
    () => api.buildManualLightweightImportedBundle({ items: [] }, scope, storage, {}),
    /Missing annotation bundle merge dependency/
  );
  assert.throws(
    () => api.buildManualLightweightImportedBundle({ items: [] }, scope, storage, deps),
    /导入文件里没有可用的 items/
  );

  console.log('session annotation bundle merge check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
