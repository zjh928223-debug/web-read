const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const featureAdaptersSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
const playbackRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-playback-runtime.js'), 'utf8');
const resolverSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'annotation-bubble-resolver.js'), 'utf8');

async function importResolverWithStubs(source, bubble) {
  const stubbedSource = (
      'const getAnnotationBubbleApi = () => globalThis.__testBubble;\n' +
      'const emitAnnotationDebug = () => {};\n' +
      'const emitAnnotationDiagnostics = () => {};\n' +
      'const getAnnotationClickResolver = () => globalThis.__testClickResolver || ({ resolveClick: () => null });\n' +
      'const getAnnotationGeneratedIndexScopeKey = () => globalThis.__testGeneratedIndexScopeKey || "";\n' +
      'const getAnnotationGeneratedResultStore = () => globalThis.__testGeneratedStore || ({ getItems: () => [] });\n' +
      'const getAnnotationGenerationScope = () => ({ audioKey: "audio", documentId: "doc" });\n' +
      'const getAnnotationGenerationScopeKey = () => "audio::doc";\n' +
      'const waitForGeneratedAnnotationIndex = () => globalThis.__testWaitForGeneratedAnnotationIndex ? globalThis.__testWaitForGeneratedAnnotationIndex() : Promise.resolve();\n'
    ) + source
    .replace(/import \{ getAnnotationBubbleApi \} from '\.\/annotation-bubble\.js';\r?\n/, '')
    .replace(/import \{[\s\S]*?\} from '\.\/session-facades\.js';\r?\n/, '');
  globalThis.__testBubble = bubble;
  globalThis.window = globalThis;
  const encoded = Buffer.from(stubbedSource, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}`);
}

async function importSourceModule(source) {
  globalThis.window = globalThis;
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

[
  'pickAnnotationValue',
  'normalizeAnnotationBubbleHit',
  'resolveGeneratedAnnotationBubbleForSpan',
  'resolveAnnotationBubbleForSpan',
  'getAnnotationBubble'
].forEach((name) => {
  assert.equal(appSource.includes(`function ${name}(`), false, `app.js should not own ${name}`);
  assert.ok(resolverSource.includes(`function ${name}(`), `annotation-bubble-resolver should own ${name}`);
});

assert.equal(
  appSource.includes('window.notifyAnnotationBubbleWordClick ='),
  false,
  'app.js should not own window.notifyAnnotationBubbleWordClick'
);
assert.ok(
  resolverSource.includes('window.notifyAnnotationBubbleWordClick = notifyAnnotationBubbleWordClick;'),
  'annotation-bubble-resolver should own window.notifyAnnotationBubbleWordClick'
);
assert.ok(
  appSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
  'reader-runtime should delegate annotation bubble resolver through reader-runtime-assembly'
);
assert.ok(
  assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime-assembly should initialize annotation bubble resolver through reader-feature-runtime'
);
assert.ok(
  featureSource.includes('adapters.startInteraction({'),
  'reader-feature-runtime should initialize annotation bubble resolver through its interaction adapter'
);
assert.ok(featureAdaptersSource.includes("import { initReaderInteractionRuntime } from './reader-interaction-runtime.js'"));
assert.equal(appSource.includes("import { initAnnotationBubbleResolver } from './annotation-bubble-resolver.js';"), false);
assert.ok(
  playbackRuntimeSource.includes("import { initAnnotationBubbleResolver } from './annotation-bubble-resolver.js'"),
  'reader-playback-runtime should import annotation bubble resolver'
);
assert.ok(
  playbackRuntimeSource.includes('var annotationBubbleResolverApi = initAnnotationBubbleResolver({'),
  'reader-playback-runtime should initialize annotation bubble resolver'
);

async function runBehaviorChecks() {
  const calls = [];
  const bubble = {
    init() { calls.push('init'); },
    isVisible() { return true; },
    setAnnotation(annotation) { calls.push(['set', annotation]); },
    show() { calls.push('show'); },
    clearAnnotation() { calls.push('clear'); },
    hide() { calls.push('hide'); }
  };
  const api = await importResolverWithStubs(resolverSource, bubble);
  const resolver = api.initAnnotationBubbleResolver({
    getWords: () => [{ word: 'ordinary', start: 0 }],
    markedMap: new Map(),
    vocabMatchMap: new Map()
  });
  const span = { dataset: { wordIndex: '0' }, textContent: 'ordinary' };
  const handled = resolver.notifyAnnotationBubbleWordClick(span);

  assert.equal(handled, false, 'non-annotation word click should still fall through to normal audio seeking');
  assert.equal(calls.includes('clear'), false, 'non-annotation word click should keep the current annotation content');
  assert.equal(calls.includes('hide'), false, 'non-annotation word click should not hide an already visible annotation bubble');

  const clickResolverSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'services', 'annotation', 'click-resolver.js'),
    'utf8'
  );
  const resultStoreSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'services', 'annotation', 'result-store.js'),
    'utf8'
  );
  const clickResolver = await importSourceModule(clickResolverSource);
  const generatedStore = await importSourceModule(resultStoreSource);
  generatedStore.indexBundle({
    items: [
      {
        id: 'preview-temporarily',
        targetId: 'preview-target',
        markedText: 'temporarily',
        boundary: 'temporarily',
        meaning: 'preview meaning',
        source: 'preview-scan',
        occurrenceKey: 'preview::temporarily',
        occurrenceGlobalStart: 0,
        occurrenceGlobalEnd: 0
      },
      {
        id: 'manual-temporarily',
        targetId: 'manual-target',
        markedText: 'temporarily',
        boundary: 'temporarily',
        meaning: 'manual meaning',
        source: 'manual-lightweight-import',
        occurrenceKey: 'manual::temporarily',
        occurrenceGlobalStart: 0,
        occurrenceGlobalEnd: 0
      }
    ]
  });
  const ambiguousOptions = {
    span: { textContent: 'temporarily' },
    wordIndex: 0,
    words: [{ word: 'temporarily' }],
    generatedStore
  };
  assert.equal(
    clickResolver.resolveClick(ambiguousOptions),
    null,
    'same wordIndex preview and manual candidates should remain ambiguous without stable identity'
  );
  assert.equal(
    clickResolver.resolveClick({
      ...ambiguousOptions,
      occurrenceKey: 'manual::temporarily'
    })?.targetId,
    'manual-target',
    'manual occurrenceKey should resolve the manual annotation exactly'
  );
  assert.equal(
    clickResolver.resolveClick({
      ...ambiguousOptions,
      occurrenceKey: 'missing::temporarily',
      targetId: 'manual-target'
    })?.targetId,
    'manual-target',
    'targetId should resolve the manual annotation when occurrenceKey is unavailable'
  );

  globalThis.__testClickResolver = clickResolver;
  globalThis.__testGeneratedStore = generatedStore;
  const identityApi = await importResolverWithStubs(resolverSource, bubble);
  const identityResolver = identityApi.initAnnotationBubbleResolver({
    getWords: () => [{ word: 'temporarily' }],
    markedMap: new Map([[
      0,
      {
        occurrenceKey: 'manual::temporarily',
        targetId: 'manual-target'
      }
    ]]),
    vocabMatchMap: new Map()
  });
  assert.equal(
    identityResolver.resolveGeneratedAnnotationBubbleForSpan(
      { dataset: { wordIndex: '0' }, textContent: 'temporarily' },
      0
    )?.targetId,
    'manual-target',
    'annotation bubble resolver should forward the marked occurrenceKey and targetId'
  );

  let resolveGeneratedIndex;
  globalThis.__testGeneratedIndexScopeKey = '';
  globalThis.__testWaitForGeneratedAnnotationIndex = () => new Promise((resolve) => {
    resolveGeneratedIndex = resolve;
  });
  generatedStore.clear();
  const deferredCallStart = calls.length;
  assert.equal(
    identityResolver.notifyAnnotationBubbleWordClick(
      { dataset: { wordIndex: '0' }, textContent: 'temporarily' }
    ),
    false,
    'a marked word click should remain synchronous while its generated index is loading'
  );
  assert.equal(
    calls.slice(deferredCallStart).some((entry) => Array.isArray(entry) && entry[0] === 'set'),
    false,
    'a deferred click must not use an index from the wrong scope'
  );
  globalThis.__testGeneratedIndexScopeKey = 'audio::doc';
  generatedStore.indexBundle({
    items: [{
      id: 'deferred-annotation',
      targetId: 'manual-target',
      markedText: 'temporarily',
      boundary: 'temporarily',
      meaning: 'deferred meaning',
      occurrenceKey: 'manual::temporarily'
    }]
  });
  resolveGeneratedIndex();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    calls.slice(deferredCallStart).some((entry) => Array.isArray(entry) && entry[0] === 'set' && entry[1].meaning === 'deferred meaning'),
    true,
    'the deferred click should show the annotation after the generated index becomes ready'
  );
  delete globalThis.__testWaitForGeneratedAnnotationIndex;
  delete globalThis.__testGeneratedIndexScopeKey;

  generatedStore.indexBundle({
    items: [{
      id: 'preview-ordinary',
      targetId: 'preview-only-target',
      markedText: 'ordinary',
      boundary: 'ordinary',
      meaning: 'preview-only meaning',
      source: 'preview-scan',
      occurrenceKey: 'preview::ordinary',
      occurrenceGlobalStart: 0,
      occurrenceGlobalEnd: 0
    }]
  });
  assert.equal(
    clickResolver.resolveClick({
      span: { textContent: 'ordinary' },
      wordIndex: 0,
      words: [{ word: 'ordinary' }],
      generatedStore
    })?.targetId,
    'preview-only-target',
    'preview-only ordinary word should continue to resolve'
  );

  generatedStore.indexBundle({
    items: [{
      id: 'manual-multi-word',
      targetId: 'manual-multi-target',
      markedText: 'a misleading indication',
      boundary: 'a misleading indication',
      meaning: 'multi-word meaning',
      source: 'manual-lightweight-import',
      occurrenceKey: 'manual::multi-word',
      occurrenceGlobalStart: 0,
      occurrenceGlobalEnd: 2
    }]
  });
  const multiWords = [
    { word: 'a' },
    { word: 'misleading' },
    { word: 'indication' }
  ];
  multiWords.forEach((word, wordIndex) => {
    assert.equal(
      clickResolver.resolveClick({
        span: { textContent: word.word },
        wordIndex,
        words: multiWords,
        generatedStore,
        occurrenceKey: 'manual::multi-word'
      })?.targetId,
      'manual-multi-target',
      `multi-word annotation token ${word.word} should resolve to the same annotation`
    );
  });

  generatedStore.indexBundle({
    items: [
      {
        id: 'preview-word-identity',
        targetId: 'preview-word-target',
        markedText: 'indication',
        boundary: 'indication',
        occurrenceKey: 'preview::word-identity',
        occurrenceGlobalStart: 0,
        occurrenceGlobalEnd: 0
      },
      {
        id: 'manual-word-identity',
        targetId: 'manual-word-target',
        markedText: 'indication',
        boundary: 'indication',
        occurrenceKey: 'manual::word-identity',
        occurrenceGlobalStart: 0,
        occurrenceGlobalEnd: 0
      }
    ]
  });
  assert.equal(
    clickResolver.resolveClick({
      span: { textContent: 'indication' },
      wordIndex: 0,
      words: [{
        word: 'indication',
        occurrenceKey: 'manual::word-identity'
      }],
      generatedStore
    })?.targetId,
    'manual-word-target',
    'word occurrenceKey should be used when options occurrenceKey is absent'
  );
}

runBehaviorChecks().then(() => {
  console.log('annotation bubble resolver check passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
