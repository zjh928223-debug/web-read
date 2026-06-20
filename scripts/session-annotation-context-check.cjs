const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-context.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const sessionAssemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');
  const sessionAssemblySource = fs.readFileSync(sessionAssemblyPath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && sessionAssemblySource.includes("from './session-annotation-context.js';"),
    'session-init should reach annotation context runtime through session-runtime-assembly'
  );
  [
    'function getAnnotationGenerationBlockText(seg)',
    'function buildAnnotationGenerationDocumentContext()',
    'function buildAnnotationTargetCollection()'
  ].forEach((pattern) => {
    assert.equal(sessionInitSource.includes(pattern), false, `session-init should not keep local context helper: ${pattern}`);
  });
  [
    'export function getAnnotationGenerationBlockText',
    'export function createSessionAnnotationContextRuntime'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `session-annotation-context should export ${pattern}`);
  });
  ['window.', 'document.', 'localStorage'].forEach((pattern) => {
    assert.equal(moduleSource.includes(pattern), false, `context module should not depend on browser globals: ${pattern}`);
  });

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  assert.equal(api.getAnnotationGenerationBlockText({ text: ' A\n B ' }), 'A B');
  assert.equal(api.getAnnotationGenerationBlockText({ words: [{ word: 'Alpha' }, { text: 'Beta' }] }), 'Alpha Beta');

  const state = {
    currentAudioKey: 'audio-1',
    segments: [
      { id: 'seg-1', start: 0, end: 1, text: 'Transcript one.', words: [{ word: 'Transcript' }] }
    ],
    hasAiChunkData: false,
    chunkItems: [
      { chunkRef: 'chunk-1', start: 2, end: 3, rawEn: 'Chunk one.', words: [{ word: 'Chunk' }] }
    ],
    words: [{ word: 'Transcript' }, { word: 'one' }],
    markedMap: new Map([
      [1, { globalIndex: '1', word: 'one' }]
    ])
  };
  const namespace = { currentDocId: 'doc-1' };
  const targetSource = {
    buildTargetSource(context) {
      return {
        targets: context.blocks.map((block) => ({
          id: `target-${block.id}`,
          blockId: block.id
        }))
      };
    }
  };
  const runtime = api.createSessionAnnotationContextRuntime({
    state,
    namespace,
    normalizeAnnotationMark(mark) {
      return mark && Number.isInteger(Number(mark.globalIndex))
        ? { ...mark, globalIndex: Number(mark.globalIndex) }
        : null;
    },
    normalizeAnnotationTextValue(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    },
    getAnnotationTargetSource() {
      return targetSource;
    }
  });

  const transcriptContext = runtime.buildAnnotationGenerationDocumentContext();
  assert.equal(transcriptContext.documentId, 'doc-1');
  assert.equal(transcriptContext.audioKey, 'audio-1');
  assert.equal(transcriptContext.sourceMode, 'transcript');
  assert.equal(transcriptContext.totalBlocks, 1);
  assert.equal(transcriptContext.blocks[0].id, 'seg-1');
  assert.equal(transcriptContext.marks[0].globalIndex, 1);
  assert.deepEqual(transcriptContext.stats, { words: 2, segments: 1, chunks: 1, marks: 1 });

  state.hasAiChunkData = true;
  const chunkContext = runtime.buildAnnotationGenerationDocumentContext();
  assert.equal(chunkContext.sourceMode, 'chunk');
  assert.equal(chunkContext.blocks[0].id, 'chunk-1');

  const collection = runtime.buildAnnotationTargetCollection();
  assert.equal(collection.context.sourceMode, 'chunk');
  assert.equal(collection.targets.length, 1);
  assert.equal(collection.byId.get('target-chunk-1').blockId, 'chunk-1');

  console.log('session annotation context check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
