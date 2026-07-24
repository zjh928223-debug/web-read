const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const playbackRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-playback-runtime.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'annotation-bubble.js'), 'utf8');
const resolverSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'annotation-bubble-resolver.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const stylesSource = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');

assert.ok(
  appSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
  'reader-runtime should delegate annotation bubble resolver through reader-runtime-assembly'
);
assert.ok(
  assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime-assembly should initialize the annotation bubble resolver through reader-feature-runtime'
);
assert.ok(
  featureSource.includes("import { initReaderInteractionRuntime } from './reader-interaction-runtime.js';"),
  'reader-feature-runtime should initialize the annotation bubble resolver through reader interaction runtime'
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
  'export default window.AnnotationBubble',
  'const MAX_WIDTH = 760',
  'const MAX_HEIGHT = 580',
  'const SIDE_PANEL_WIDTH_RATIO = 0.72',
  'function isLegacySideFrame'
].forEach((pattern) => {
  assert.ok(moduleSource.includes(pattern), `annotation bubble module should include ${pattern}`);
});

assert.ok(
  !indexSource.includes('<script src="annotation-bubble.js"></script>'),
  'root annotation bubble script tag should stay removed after Phase 5 tag cleanup'
);

[
  '--annotation-bubble-glass-bg',
  'max-width: min(760px, calc(100vw - 24px))',
  'max-height: min(580px, calc(100vh - 24px))',
  'background: var(--annotation-bubble-glass-bg)',
  'line-height: 1.52',
  'backdrop-filter: blur(28px) saturate(1.75) brightness(1.04)',
  '@keyframes annotationBubblePopIn'
].forEach((pattern) => {
  assert.ok(stylesSource.includes(pattern), `annotation bubble should keep glass capsule styling: ${pattern}`);
});

[
  'radial-gradient(120% 90% at 16% -10%',
  'linear-gradient(180deg, rgba(242,248,255,0.70) 0%'
].forEach((pattern) => {
  assert.equal(stylesSource.includes(pattern), false, `annotation bubble should avoid visible highlight/banding gradient: ${pattern}`);
});

assert.ok(
  /@media \(max-width: 1180px\) \{[\s\S]*?\.reading-shell[\s\S]*?\n\s*\}\s*\n\s*\/\* === Standalone annotation bubble === \*\//.test(stylesSource),
  'annotation bubble styles should be global, not trapped inside the 1180px media query'
);

console.log('annotation bubble module check passed');
