const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const facadeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-public-facades.js'), 'utf8');

[
  'selectSentenceFromChunkTarget',
  'openChunkNoteContextFromEvent',
  'buildCurrentSentenceDocId',
  'loadChunkNotesForCurrentAudio',
  'setChunkNoteVisible',
  'loadSentenceNotesForCurrentAudio',
  'switchSentenceNotesDoc',
  'applyCurrentAudioMeta'
].forEach((name) => {
  assert.equal(appSource.includes(`window.${name} =`), false, `app.js should not own window.${name}`);
  assert.ok(facadeSource.includes(`export function ${name}()`), `reader-public-facades should export ${name}`);
  assert.ok(facadeSource.includes(`window.${name} = ${name};`), `reader-public-facades should own window.${name}`);
});

assert.ok(
  appSource.includes("import { configureReaderPublicFacades } from './src/composables/reader-public-facades.js';"),
  'app.js should import reader-public-facades'
);
assert.ok(
  appSource.includes('configureReaderPublicFacades({'),
  'app.js should configure reader-public-facades'
);

console.log('reader public facades check passed');
