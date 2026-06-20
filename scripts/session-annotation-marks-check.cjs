const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-marks.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const sessionAssemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');
  const sessionAssemblySource = fs.readFileSync(sessionAssemblyPath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && sessionAssemblySource.includes("from './session-annotation-marks.js';"),
    'session-init should reach annotation marks runtime through session-runtime-assembly'
  );
  [
    'function normalizeAnnotationMark(mark',
    'function parseEncodedAnnotationTargetId(targetId)',
    'function buildSyntheticAnnotationTargetFromEncodedId(targetId',
    'function getAnnotationItemOccurrenceRange(item, targetLookup)',
    'function rebuildMarksFromAnnotationItems(items'
  ].forEach((pattern) => {
    assert.equal(sessionInitSource.includes(pattern), false, `session-init should not keep local marks helper: ${pattern}`);
  });
  [
    'export function normalizeAnnotationMark',
    'export function parseEncodedAnnotationTargetId',
    'export function createSessionAnnotationMarksRuntime'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `session-annotation-marks should export ${pattern}`);
  });
  ['window.', 'document.', 'localStorage'].forEach((pattern) => {
    assert.equal(moduleSource.includes(pattern), false, `marks module should not depend on browser globals: ${pattern}`);
  });

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const normalizeAnnotationTextValue = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  assert.deepEqual(api.normalizeAnnotationMark({ globalIndex: '2', source: 'legacy' }), {
    globalIndex: 2,
    source: 'legacy',
    sourceType: 'legacy'
  });
  assert.equal(api.normalizeAnnotationMark({ globalIndex: 'x' }), null);
  assert.deepEqual(api.parseEncodedAnnotationTargetId('manual-s1-1-2', { normalizeAnnotationTextValue }), {
    sourceType: 'manual',
    sentenceId: 's1',
    occurrenceGlobalStart: 1,
    occurrenceGlobalEnd: 2
  });

  const saves = [];
  let rendered = '';
  let updatedAt = null;
  let synced = 0;
  const state = {
    words: [
      { word: 'First', start: 0 },
      { word: 'Alpha', start: 1 },
      { word: 'Beta', start: 2 },
      { word: 'Last', start: 3 }
    ],
    markedMap: new Map([[3, { globalIndex: 3, word: 'Last' }]]),
    isChunkMode: false
  };
  const runtime = api.createSessionAnnotationMarksRuntime({
    state,
    normalizeAnnotationTextValue,
    buildAnnotationGenerationDocumentContext() {
      return {
        blocks: [
          { id: 's1', index: 0, text: 'First Alpha Beta Last' }
        ]
      };
    },
    buildAnnotationTargetCollection() {
      return {
        byId: new Map([
          ['target-a', { occurrenceGlobalStart: 1, occurrenceGlobalEnd: 2 }]
        ])
      };
    },
    saveToDB(key, value) {
      saves.push({ key, value });
    },
    renderTranscript() {
      rendered = 'transcript';
    },
    renderChunkMode() {
      rendered = 'chunk';
    },
    forceUpdateUI(time) {
      updatedAt = time;
    },
    getAudioCurrentTime() {
      return 12.5;
    },
    syncAnnotationGenerationEntryStatus() {
      synced += 1;
    }
  });

  assert.deepEqual(runtime.parseEncodedAnnotationTargetId('manual-s1-1-2'), {
    sourceType: 'manual',
    sentenceId: 's1',
    occurrenceGlobalStart: 1,
    occurrenceGlobalEnd: 2
  });
  assert.deepEqual(runtime.buildSyntheticAnnotationTargetFromEncodedId('manual-s1-1-2'), {
    id: 'manual-s1-1-2',
    sourceType: 'manual',
    sentenceId: 's1',
    blockId: 's1',
    markedText: 'Alpha Beta',
    boundary: 'First Alpha Beta Last',
    sentenceText: 'First Alpha Beta Last',
    sentencePlainText: 'First Alpha Beta Last',
    occurrenceGlobalStart: 1,
    occurrenceGlobalEnd: 2,
    occurrenceKey: 'manual::s1::g:1-2'
  });

  assert.deepEqual(runtime.getAnnotationItemOccurrenceRange({ targetId: 'target-a' }, new Map([
    ['target-a', { occurrenceGlobalStart: 1, occurrenceGlobalEnd: 2 }]
  ])), { start: 1, end: 2 });

  const rebuilt = runtime.rebuildMarksFromAnnotationItems([
    { targetId: 'target-a', occurrenceKey: 'occ-a' }
  ], { sourceType: 'annotation-lightweight-import', replaceExisting: true });
  assert.deepEqual(rebuilt, { addedCount: 2, totalCount: 2 });
  assert.equal(state.markedMap.size, 2);
  assert.equal(state.markedMap.get(1).word, 'Alpha');
  assert.equal(state.markedMap.get(2).sourceType, 'annotation-lightweight-import');
  assert.equal(saves.at(-1).key, 'marks');
  assert.equal(saves.at(-1).value.length, 2);
  assert.equal(rendered, 'transcript');
  assert.equal(updatedAt, 12.5);
  assert.equal(synced, 1);

  const cleared = runtime.rebuildMarksFromAnnotationItems([], { replaceExisting: true });
  assert.deepEqual(cleared, { addedCount: 0, totalCount: 0 });
  assert.equal(state.markedMap.size, 0);
  assert.deepEqual(saves.at(-1), { key: 'marks', value: [] });

  console.log('session annotation marks check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
