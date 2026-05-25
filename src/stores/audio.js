(function () {
  'use strict';

  var DB_NAME = 'SeekPlayerDB';
  var DB_VERSION = 1;
  var STORE_NAME = 'files';
  var _db = null;

  function getDb() { return _db; }

  function initDB() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = function () { reject('DB Error'); };
      request.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = function (event) {
        _db = event.target.result;
        resolve(_db);
      };
    });
  }

  function saveToDB(id, data) {
    if (!_db) return;
    var transaction = _db.transaction([STORE_NAME], 'readwrite');
    var store = transaction.objectStore(STORE_NAME);
    store.put({ id: id, content: data, timestamp: new Date().getTime() });
  }

  function loadFromDB(id) {
    return new Promise(function (resolve) {
      if (!_db) { resolve(null); return; }
      var transaction = _db.transaction([STORE_NAME], 'readonly');
      var store = transaction.objectStore(STORE_NAME);
      var request = store.get(id);
      request.onsuccess = function (event) {
        resolve(event.target.result ? event.target.result.content : null);
      };
      request.onerror = function () { resolve(null); };
    });
  }

  function deleteFromDB(id) {
    return new Promise(function (resolve) {
      if (!_db) { resolve(); return; }
      var transaction = _db.transaction([STORE_NAME], 'readwrite');
      var store = transaction.objectStore(STORE_NAME);
      var request = store.delete(id);
      request.onsuccess = function () { resolve(); };
      request.onerror = function () { resolve(); };
    });
  }

  function clearDBStore() {
    return new Promise(function (resolve) {
      if (!_db) { resolve(); return; }
      var transaction = _db.transaction([STORE_NAME], 'readwrite');
      var store = transaction.objectStore(STORE_NAME);
      var request = store.clear();
      request.onsuccess = function () { resolve(); };
      request.onerror = function () { resolve(); };
    });
  }

  window.__audioStore = {
    initDB: initDB,
    getDb: getDb,
    saveToDB: saveToDB,
    loadFromDB: loadFromDB,
    deleteFromDB: deleteFromDB,
    clearDBStore: clearDBStore
  };
})();
