const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
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
assert.match(indexSource, /id="btn-load-chunk"[^>]*type="button"/);
assert.match(indexSource, /id="btn-load-cloze"[^>]*type="button"/);

assert.ok(mainSource.includes("import './composables/file-input-bindings.js'"));
assert.ok(bindingsSource.includes("'btn-load-chunk'"));
assert.ok(bindingsSource.includes("'chunk-file'"));
assert.ok(bindingsSource.includes("'btn-load-cloze'"));
assert.ok(bindingsSource.includes("'cloze-file'"));
assert.ok(bindingsSource.includes("addEventListener('click'"));
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
assert.ok(importSource.includes("document.getElementById('btn-load-cloze')"));

console.log('file input bindings check passed');
