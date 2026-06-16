const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const viteConfigSource = fs.readFileSync(path.join(repoRoot, 'vite.config.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

[
  'copy-legacy-root-scripts',
  'copyLegacyScripts',
  'legacyScripts',
  'copyFileSync',
  'chunk-note-layout-helpers.js',
  'chunk-note-layout-core.js',
  'annotation-bubble.js',
  'annotation-api-settings-ui.js'
].forEach((pattern) => {
  assert.equal(viteConfigSource.includes(pattern), false, `vite.config.js should not include ${pattern}`);
});

[
  'chunk-note-layout-helpers.js',
  'chunk-note-layout-core.js',
  'annotation-bubble.js',
  'annotation-api-settings-ui.js'
].forEach((scriptName) => {
  assert.equal(
    indexSource.includes(`<script src="${scriptName}"></script>`),
    false,
    `${scriptName} should not be loaded as a root regular script`
  );
});

console.log('legacy root copy check passed');
