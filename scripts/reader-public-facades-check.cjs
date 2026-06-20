const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const appRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-app-runtime.js'), 'utf8');
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
  appSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
  'app.js should delegate reader-app-runtime through reader-runtime-assembly'
);
assert.ok(
  assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime-assembly should delegate reader-app-runtime through reader-feature-runtime'
);
assert.ok(
  featureSource.includes("import { initReaderAppRuntime } from './reader-app-runtime.js';"),
  'reader-feature-runtime should import reader-app-runtime'
);
assert.equal(
  appSource.includes("import { configureReaderPublicFacades } from './reader-public-facades.js';"),
  false,
  'app.js should not import reader-public-facades directly'
);
assert.ok(
  appRuntimeSource.includes("import { configureReaderPublicFacades } from './reader-public-facades.js'"),
  'reader-app-runtime should import reader-public-facades'
);
assert.ok(
  appRuntimeSource.includes('configureReaderPublicFacades({'),
  'reader-app-runtime should configure reader-public-facades'
);

console.log('reader public facades check passed');
