const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const layoutSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'chunk-note-layout.js'), 'utf8');
const coreModuleSource = fs.readFileSync(path.join(repoRoot, 'src', 'utils', 'chunk-note-layout-core.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

assert.ok(
  appSource.includes("import '../utils/chunk-note-layout-core.js';"),
  'app.js should load chunk note layout core through the Vite module graph'
);
assert.equal(appSource.includes('window.ChunkNoteLayoutCore'), false, 'app.js should not read the root core global');

assert.ok(
  layoutSource.includes("import { buildEmptyChunkNoteLayoutResult, buildChunkNoteLayoutResult } from '../utils/chunk-note-layout-core.js';"),
  'chunk-note-layout.js should import layout result builders directly'
);
assert.equal(layoutSource.includes('window.ChunkNoteLayoutCore'), false, 'chunk-note-layout.js should not read the root core global');

[
  'export function normalizeChunkNoteLayoutResult',
  'export function buildEmptyChunkNoteLayoutResult',
  'export function buildChunkNoteLayoutResult',
  'window.ChunkNoteLayoutCore ='
].forEach((pattern) => {
  assert.ok(coreModuleSource.includes(pattern), `core module should include ${pattern}`);
});

assert.ok(
  !indexSource.includes('<script src="chunk-note-layout-core.js"></script>'),
  'root core script tag should stay removed after Phase 5 tag cleanup'
);

console.log('chunk note layout core module check passed');
