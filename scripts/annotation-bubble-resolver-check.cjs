const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const playbackRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-playback-runtime.js'), 'utf8');
const resolverSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'annotation-bubble-resolver.js'), 'utf8');

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
  appSource.includes("import { initReaderRuntimeShell } from './reader-runtime-shell.js';"),
  'reader-runtime should delegate annotation bubble resolver through reader-runtime-shell'
);
assert.ok(
  assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime-shell should initialize annotation bubble resolver through reader-feature-runtime'
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

console.log('annotation bubble resolver check passed');
