const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const importSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'import-module.js'), 'utf8');
const sessionSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-restore-runtime.js'), 'utf8');

[
  'processTranscript',
  'processChunkData'
].forEach((name) => {
  assert.equal(appSource.includes(`window.${name} =`), false, `app.js should not own window.${name}`);
  assert.equal(
    new RegExp(`function\\s+${name}\\s*\\(`).test(appSource),
    false,
    `app.js should not keep ${name} wrapper`
  );
  assert.ok(importSource.includes(`window.${name} = ${name};`), `import-module should own window.${name}`);
});

assert.equal(appSource.includes('var _importApi = {'), false, 'app.js should not keep the temporary import API wrapper');
assert.ok(sessionSource.includes('deps.processTranscript(transcriptData);'), 'session restore runtime should still use the compatibility transcript entry');
assert.ok(sessionSource.includes('deps.processChunkData(chunkData);'), 'session restore runtime should still use the compatibility chunk entry');

console.log('import facades check passed');
