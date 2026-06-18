const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const playbackRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-playback-runtime.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'annotation-bubble.js'), 'utf8');
const resolverSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'annotation-bubble-resolver.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

assert.ok(
  appSource.includes("import { initReaderPlaybackRuntime } from './reader-playback-runtime.js';"),
  'reader-runtime should initialize the annotation bubble resolver through reader playback runtime'
);
assert.equal(appSource.includes("import { initAnnotationBubbleResolver } from './annotation-bubble-resolver.js';"), false);
assert.ok(
  playbackRuntimeSource.includes("import { initAnnotationBubbleResolver } from './annotation-bubble-resolver.js'"),
  'reader-playback-runtime should initialize the annotation bubble resolver from the module graph'
);
assert.ok(
  resolverSource.includes("import { getAnnotationBubbleApi } from './annotation-bubble.js';"),
  'annotation bubble resolver should import the annotation bubble API from the module graph'
);
assert.equal(appSource.includes('window.AnnotationBubble'), false, 'app.js should not read the root annotation bubble global');

assert.ok(
  mainSource.includes("import './composables/annotation-bubble.js'"),
  'src/main.js should load the annotation bubble module for future app.js removal'
);

[
  'global.AnnotationBubble = api',
  'export function getAnnotationBubbleApi',
  'export default window.AnnotationBubble'
].forEach((pattern) => {
  assert.ok(moduleSource.includes(pattern), `annotation bubble module should include ${pattern}`);
});

assert.ok(
  !indexSource.includes('<script src="annotation-bubble.js"></script>'),
  'root annotation bubble script tag should stay removed after Phase 5 tag cleanup'
);

console.log('annotation bubble module check passed');
