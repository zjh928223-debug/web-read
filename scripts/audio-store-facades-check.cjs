const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const audioStoreSource = fs.readFileSync(path.join(repoRoot, 'src', 'stores', 'audio.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');

[
  'initDB',
  'saveToDB',
  'loadFromDB',
  'deleteFromDB',
  'clearDBStore'
].forEach((name) => {
  assert.equal(appSource.includes(`window.${name} =`), false, `app.js should not own window.${name}`);
  assert.ok(audioStoreSource.includes(`window.${name} = function`), `audio store should own window.${name}`);
});

assert.ok(
  audioStoreSource.includes("callAudioStore('initDB', arguments)"),
  'audio store facades should delegate through current window.__audioStore methods'
);
assert.ok(
  mainSource.includes('origAudio.initDB = function () { return audioStore.initDB() }'),
  'main.js should still replace audio store methods with Pinia-backed methods'
);
assert.equal(appSource.includes('var initDB = function'), false, 'app.js should not keep unused initDB wrapper');
assert.equal(appSource.includes('var deleteFromDB = function'), false, 'app.js should not keep unused deleteFromDB wrapper');
assert.equal(appSource.includes('var clearDBStore = function'), false, 'app.js should not keep unused clearDBStore wrapper');

console.log('audio store facades check passed');
