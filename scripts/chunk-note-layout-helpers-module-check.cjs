const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const notesRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-notes-runtime.js'), 'utf8');
const layoutSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'chunk-note-layout.js'), 'utf8');
const helperModuleSource = fs.readFileSync(path.join(repoRoot, 'src', 'utils', 'chunk-note-layout-helpers.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

assert.ok(
  appSource.includes("import '../utils/chunk-note-layout-helpers.js';"),
  'app.js should load chunk note layout helpers through the Vite module graph'
);
assert.equal(appSource.includes('window.ChunkNoteLayoutHelpers'), false, 'app.js should not read the root helper global');

[
  'const findNearestChunkWord =',
  'const getChunkNoteMeasureFont =',
  'const measureChunkNoteTextBox =',
  'const applyChunkNoteAutoSize =',
  'const buildChunkNoteLayout =',
  'const canChunkNoteTextFitMinReadable =',
  'const makeSelectionNoteBaseId =',
  'const makeSelectionNoteId ='
].forEach((pattern) => {
  assert.equal(
    appSource.includes(pattern),
    false,
    `reader-runtime should not keep chunk note layout alias: ${pattern}`
  );
});

assert.ok(
  appSource.includes('chunkNoteLayout: window.__chunkNoteLayout'),
  'reader-runtime should inject the chunk note layout module into notes runtime'
);

[
  'getChunkNoteMeasureFont: chunkNoteLayout.getChunkNoteMeasureFont',
  'measureChunkNoteTextBox: chunkNoteLayout.measureChunkNoteTextBox',
  'applyChunkNoteAutoSize: chunkNoteLayout.applyChunkNoteAutoSize',
  'buildChunkNoteLayout: chunkNoteLayout.buildChunkNoteLayout',
  'canChunkNoteTextFitMinReadable: chunkNoteLayout.canChunkNoteTextFitMinReadable',
  'makeSelectionNoteBaseId: chunkNoteLayout.makeSelectionNoteBaseId',
  'makeSelectionNoteId: chunkNoteLayout.makeSelectionNoteId',
  'findNearestChunkWord: chunkNoteLayout.findNearestChunkWord'
].forEach((pattern) => {
  assert.ok(
    notesRuntimeSource.includes(pattern),
    `reader-notes-runtime should inject chunk note layout API directly: ${pattern}`
  );
});

assert.ok(
  layoutSource.includes("import { wrapChunkNoteTextForCanvas } from '../utils/chunk-note-layout-helpers.js';"),
  'chunk-note-layout.js should import the wrapping helper directly'
);
assert.equal(layoutSource.includes('window.ChunkNoteLayoutHelpers'), false, 'chunk-note-layout.js should not read the root helper global');

[
  'export function getChunkNoteWrapTokens',
  'export function splitTokenToFitWidth',
  'export function wrapChunkNoteTextForCanvas',
  'export function truncateCanvasLine',
  'window.ChunkNoteLayoutHelpers ='
].forEach((pattern) => {
  assert.ok(helperModuleSource.includes(pattern), `helper module should include ${pattern}`);
});

assert.ok(
  !indexSource.includes('<script src="chunk-note-layout-helpers.js"></script>'),
  'root helper script tag should stay removed after Phase 5 tag cleanup'
);

console.log('chunk note layout helpers module check passed');
