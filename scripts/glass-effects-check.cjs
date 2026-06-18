const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const glassEffectsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'glass-effects.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

assert.ok(
  runtimeSource.includes("import { initGlassEffects } from './glass-effects.js';"),
  'reader-runtime should import initGlassEffects'
);

assert.ok(
  runtimeSource.includes('initGlassEffects({'),
  'reader-runtime should initialize glass effects through the module'
);

[
  'function lockChunkNoteDimensions()',
].forEach((pattern) => {
  assert.equal(
    runtimeSource.includes(pattern),
    false,
    `reader-runtime should not own glass effect sizing logic: ${pattern}`
  );
  assert.ok(
    glassEffectsSource.includes(pattern),
    `glass-effects module should own glass effect sizing logic: ${pattern}`
  );
});

assert.equal(
  runtimeSource.includes('window.__glassEffects.init('),
  false,
  'reader-runtime should not initialize glass effects through the window facade'
);

assert.ok(
  glassEffectsSource.includes('init(lockChunkNoteDimensions);'),
  'glass-effects module should initialize the existing glass runtime with the sizing callback'
);

assert.ok(
  glassEffectsSource.includes('export function initGlassEffects'),
  'glass-effects should export initGlassEffects'
);

[
  "processTranscript(transcriptData);",
  "processChunkData(chunkData);",
  "window.toggleChunkMode(true);",
  "bridgeToPinia();"
].forEach((pattern) => {
  assert.ok(
    sessionInitSource.includes(pattern),
    `session-init contract should remain intact: ${pattern}`
  );
});

console.log('glass effects check passed');
