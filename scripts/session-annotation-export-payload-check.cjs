const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-export-payload.js');
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
      && lightweightIoSource.includes("from './session-annotation-export-payload.js';"),
    'session-init should reach annotation export payload builders through the lightweight IO runtime'
  );
  [
    'function buildManualLightweightAnnotationExportPayload()',
    'function buildAnnotationContextPayloadFromArticle(articleText'
  ].forEach((pattern) => {
    assert.equal(sessionInitSource.includes(pattern), false, `session-init should not keep local payload builder: ${pattern}`);
  });
  [
    'export function buildManualLightweightAnnotationExportPayload',
    'export function buildAnnotationContextPayloadFromArticle'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `session-annotation-export-payload should export ${pattern}`);
  });
  ['window.', 'document.', 'localStorage', 'st.'].forEach((pattern) => {
    assert.equal(moduleSource.includes(pattern), false, `payload module should not depend on session globals: ${pattern}`);
  });

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const targets = [
    {
      id: 'target-a',
      markedText: 'Alpha',
      sentenceText: 'First sentence has Alpha.',
      occurrenceIndex: 7
    },
    {
      id: 'target-b',
      markedText: 'Beta',
      sentenceText: 'Second sentence has Beta.'
    },
    {
      id: '',
      markedText: 'Skip',
      sentenceText: 'This item is skipped.'
    }
  ];
  const deps = {
    buildAnnotationTargetCollection() {
      return {
        context: {
          documentId: 'doc-1',
          totalBlocks: 1,
          blocks: [{ text: 'First sentence has Alpha. Second sentence has Beta.' }]
        },
        targets
      };
    },
    buildManualLightweightTargetLookup(sourceTargets) {
      const occurrenceByTargetId = new Map();
      sourceTargets.forEach((target, index) => {
        if (target.id) occurrenceByTargetId.set(target.id, index);
      });
      return { occurrenceByTargetId };
    },
    buildAnnotationContextArticleText(context) {
      return context.blocks.map((block) => block.text).join(' ');
    },
    splitAnnotationContextSentenceSpans() {
      return [
        { text: 'First sentence has Alpha.', start: 0, end: 25 },
        { text: 'Second sentence has Beta.', start: 26, end: 51 }
      ];
    },
    getAnnotationTargetSentenceText(target) {
      return String(target && target.sentenceText || '').trim();
    },
    normalizeAnnotationTextValue(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    },
    resolveAnnotationContextSentence(sourceSentence, sentenceSpans) {
      const index = sentenceSpans.findIndex((span) => span.text === sourceSentence);
      return {
        anchorSentence: index >= 0 ? sentenceSpans[index].text : sourceSentence,
        sentenceBefore: index > 0 ? sentenceSpans[index - 1].text : '',
        sentenceAfter: index >= 0 && index < sentenceSpans.length - 1 ? sentenceSpans[index + 1].text : '',
        sentenceIndex: index,
        matchType: index >= 0 ? 'exact' : 'fallback'
      };
    },
    cleanMarkedTextForAnnotationContext(value) {
      return String(value || '').trim();
    }
  };

  const manualPayload = api.buildManualLightweightAnnotationExportPayload(deps);
  assert.equal(manualPayload.schemaVersion, 2);
  assert.equal(manualPayload.articleId, 'doc-1');
  assert.equal(manualPayload.items.length, 2);
  assert.equal(manualPayload.items[0].targetId, 'target-a');
  assert.equal(manualPayload.items[0].occurrenceIndex, 0);
  assert.equal(manualPayload.items[1].sentenceBefore, 'First sentence has Alpha.');

  const directPayload = api.buildAnnotationContextPayloadFromArticle(
    'First sentence has Alpha. Second sentence has Beta.',
    [targets[0]],
    'article-2',
    deps
  );
  assert.equal(directPayload.articleId, 'article-2');
  assert.equal(directPayload.items.length, 1);
  assert.equal(directPayload.items[0].occurrenceIndex, 7);

  assert.throws(
    () => api.buildAnnotationContextPayloadFromArticle('Text', targets, 'doc', {}),
    /Missing annotation export payload dependency/
  );

  console.log('session annotation export payload check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
