const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'annotation-bubble.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

assert.ok(
  appSource.includes("import { getAnnotationBubbleApi } from './src/composables/annotation-bubble.js';"),
  'app.js should import the annotation bubble API from the module graph'
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
  indexSource.includes('<script src="annotation-bubble.js"></script>'),
  'root annotation bubble script tag stays until Phase 5 removes all root script tags together'
);

console.log('annotation bubble module check passed');
