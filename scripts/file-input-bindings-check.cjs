const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const importSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'import-module.js'), 'utf8');
const bindingsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'file-input-bindings.js'), 'utf8');

assert.equal(
  /id="btn-load-chunk"[^>]*onclick=/.test(indexSource),
  false,
  'btn-load-chunk should not use an inline onclick handler'
);
assert.equal(
  /id="btn-load-cloze"[^>]*onclick=/.test(indexSource),
  false,
  'btn-load-cloze should not use an inline onclick handler'
);
assert.equal(indexSource.includes('id="btn-load-chunk"'), false, 'manual chunk import button should stay removed');
assert.equal(indexSource.includes('id="btn-load-cloze"'), false, 'cloze import button should stay removed');
assert.equal(indexSource.includes('id="chunk-file"'), false, 'manual chunk import input should stay removed');
assert.equal(indexSource.includes('id="cloze-file"'), false, 'cloze import input should stay removed');

assert.ok(mainSource.includes("import './composables/file-input-bindings.js'"));
assert.ok(bindingsSource.includes('export function bindReaderFileInputLaunchers'));
assert.equal(bindingsSource.includes("'btn-load-chunk'"), false);
assert.equal(bindingsSource.includes("'chunk-file'"), false);
assert.equal(bindingsSource.includes("'btn-load-cloze'"), false);
assert.equal(bindingsSource.includes("'cloze-file'"), false);
assert.equal(bindingsSource.includes('window.'), false, 'file input bindings should not add window compatibility globals');

assert.equal(
  appSource.includes("document.getElementById('btn-load-cloze')"),
  false,
  'app.js should not own btn-load-cloze DOM lookup'
);
assert.equal(
  appSource.includes('loadClozeBtn: loadClozeBtn'),
  false,
  'app.js should not inject btn-load-cloze wiring into import handlers'
);
assert.equal(
  importSource.includes("document.getElementById('btn-load-cloze')"),
  false,
  'import module should not own removed cloze import lookup'
);
assert.equal(
  importSource.includes("document.getElementById('btn-load-chunk')"),
  false,
  'import module should not own removed manual chunk import lookup'
);

console.log('file input bindings check passed');
