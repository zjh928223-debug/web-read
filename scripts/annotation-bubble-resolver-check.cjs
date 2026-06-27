const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const playbackRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-playback-runtime.js'), 'utf8');
const resolverSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'annotation-bubble-resolver.js'), 'utf8');

async function importResolverWithStubs(source, bubble) {
  const stubbedSource = (
      'const getAnnotationBubbleApi = () => globalThis.__testBubble;\n' +
      'const emitAnnotationDebug = () => {};\n' +
      'const emitAnnotationDiagnostics = () => {};\n' +
      'const getAnnotationClickResolver = () => ({ resolveClick: () => null });\n' +
      'const getAnnotationGeneratedIndexScopeKey = () => "";\n' +
      'const getAnnotationGeneratedResultStore = () => ({ getItems: () => [] });\n' +
      'const getAnnotationGenerationScope = () => ({ audioKey: "audio", documentId: "doc" });\n' +
      'const getAnnotationGenerationScopeKey = () => "audio::doc";\n'
    ) + source
    .replace(/import \{ getAnnotationBubbleApi \} from '\.\/annotation-bubble\.js';\r?\n/, '')
    .replace(/import \{[\s\S]*?\} from '\.\/session-facades\.js';\r?\n/, '');
  globalThis.__testBubble = bubble;
  globalThis.window = globalThis;
  const encoded = Buffer.from(stubbedSource, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}`);
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
  featureSource.includes("import { initReaderInteractionRuntime } from './reader-interaction-runtime.js';"),
  'reader-feature-runtime should initialize annotation bubble resolver through reader interaction runtime'
);
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
}

runBehaviorChecks().then(() => {
  console.log('annotation bubble resolver check passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
