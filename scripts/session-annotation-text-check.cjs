const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-annotation-text.js');
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
      && sessionAnnotationRuntimeSource.includes("from './session-annotation-text.js';"),
    'session-init should reach annotation text helpers through session-runtime-assembly'
  );
  [
    'function normalizeAnnotationTextValue(value)',
    'function splitAnnotationContextSentenceSpans(text, preferredSentences)',
    'function resolveAnnotationContextSentence(sourceSentence, sentenceSpans, markedText)'
  ].forEach((pattern) => {
    assert.equal(sessionInitSource.includes(pattern), false, `session-init should not keep local text helper: ${pattern}`);
  });
  [
    'export function normalizeAnnotationTextValue',
    'export function buildAnnotationContextArticleText',
    'export function splitAnnotationContextSentenceSpans',
    'export function resolveAnnotationContextSentence'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `session-annotation-text should export ${pattern}`);
  });
  ['window.', 'document.', 'localStorage', 'storage.'].forEach((pattern) => {
    assert.equal(moduleSource.includes(pattern), false, `annotation text module should not depend on globals: ${pattern}`);
  });
  assert.equal(/\bst\s*\./.test(moduleSource), false, 'annotation text module should not read session state directly');

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  assert.equal(api.normalizeAnnotationTextValue('  alpha\n beta  '), 'alpha beta');
  assert.equal(api.getAnnotationTargetSentenceText({ sentencePlainText: ' Plain sentence ' }), 'Plain sentence');
  assert.equal(api.buildAnnotationContextArticleText({
    blocks: [
      { text: 'First **bold** sentence.' },
      { text: 'Second sentence.' }
    ]
  }), 'First bold sentence. Second sentence.');

  const spans = api.splitAnnotationContextSentenceSpans(
    'First sentence has Alpha. Second sentence has Beta. Third sentence has Gamma.',
    ['Second sentence has Beta.']
  );
  assert.ok(spans.length >= 3, 'sentence splitter should produce sentence-like spans');
  assert.ok(spans.some((span) => span.text === 'Second sentence has Beta.'));

  assert.deepEqual(
    api.resolveAnnotationContextSentence('Second sentence has Beta.', spans, 'Beta'),
    {
      anchorSentence: 'Second sentence has Beta.',
      sentenceBefore: 'First sentence has Alpha.',
      sentenceAfter: 'Third sentence has Gamma.',
      sentenceIndex: 1,
      matchType: 'exact'
    }
  );

  const fuzzy = api.resolveAnnotationContextSentence('Second sentence has beta', spans, 'Beta');
  assert.equal(fuzzy.anchorSentence, 'Second sentence has Beta.');
  assert.ok(['normalized', 'fuzzy'].includes(fuzzy.matchType));
  assert.equal(api.cleanMarkedTextForAnnotationContext(' "Alpha," '), 'Alpha');

  console.log('session annotation text check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
