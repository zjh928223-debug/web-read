const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-bootstrap-runtime.js'), 'utf8');
const audioStoreSource = fs.readFileSync(path.join(repoRoot, 'src', 'stores', 'audio.js'), 'utf8');
const piniaAudioStoreSource = fs.readFileSync(path.join(repoRoot, 'src', 'pinia-stores', 'audio.js'), 'utf8');
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
assert.equal(appSource.includes('var saveToDB = function'), false, 'app.js should not keep direct saveToDB wrapper');
assert.equal(appSource.includes('var loadFromDB = function'), false, 'app.js should not keep direct loadFromDB wrapper');
assert.ok(
  bootstrapSource.includes('return getWindow().__audioStore.saveToDB(id, data);'),
  'reader-bootstrap-runtime should own the saveToDB compatibility wrapper'
);
assert.ok(
  bootstrapSource.includes('return getWindow().__audioStore.loadFromDB(id);'),
  'reader-bootstrap-runtime should own the loadFromDB compatibility wrapper'
);

async function verifyPublicClearOnlyDeletesAudioRecords() {
  const vm = require('node:vm');
  const deleted = [];
  let clearCalled = false;
  const transaction = {
    objectStore() {
      return {
        delete(key) {
          deleted.push(key);
          return {};
        },
        clear() {
          clearCalled = true;
          throw new Error('shared files store must never be cleared');
        }
      };
    },
    oncomplete: null,
    onerror: null,
    onabort: null,
    error: null
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction(storeNames, mode) {
      assert.equal(Array.from(storeNames).join(','), 'files');
      assert.equal(mode, 'readwrite');
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    }
  };
  const window = {};
  const indexedDB = {
    open(name, version) {
      assert.equal(name, 'SeekPlayerDB');
      assert.equal(version, 1);
      const request = {};
      queueMicrotask(() => request.onsuccess?.({ target: { result: db } }));
      return request;
    }
  };
  vm.runInNewContext(audioStoreSource, { window, indexedDB, Promise, Date, queueMicrotask });
  await window.initDB();
  await window.clearDBStore();
  assert.deepEqual(deleted, ['audio', 'audioMeta']);
  assert.equal(clearCalled, false);
}

assert.equal(/\.clear\s*\(/u.test(audioStoreSource), false, 'legacy audio clear must not clear the shared files store');
assert.equal(/\.clear\s*\(/u.test(piniaAudioStoreSource), false, 'Pinia audio clear must not clear the shared files store');
assert.match(piniaAudioStoreSource, /store\.delete\(['"]audio['"]\)/u);
assert.match(piniaAudioStoreSource, /store\.delete\(['"]audioMeta['"]\)/u);
assert.ok(
  mainSource.includes('origAudio.clearDBStore = function () { return audioStore.clearDBStore() }'),
  'the public compatibility facade should delegate to the safe Pinia operation'
);

verifyPublicClearOnlyDeletesAudioRecords().then(() => {
  console.log('audio store facades check passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
