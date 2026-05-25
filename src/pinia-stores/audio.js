import { defineStore } from 'pinia'

const DB_NAME = 'SeekPlayerDB'
const DB_VERSION = 1
const STORE_NAME = 'files'
let _db = null

export const useAudioStore = defineStore('audio', () => {
  function getDb() { return _db }

  function initDB() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onerror = function () { reject('DB Error') }
      request.onupgradeneeded = function (event) {
        var db = event.target.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      request.onsuccess = function (event) {
        _db = event.target.result
        resolve(_db)
      }
    })
  }

  function saveToDB(id, data) {
    if (!_db) return
    var tx = _db.transaction([STORE_NAME], 'readwrite')
    var store = tx.objectStore(STORE_NAME)
    store.put({ id: id, content: data, timestamp: new Date().getTime() })
  }

  function loadFromDB(id) {
    return new Promise(function (resolve) {
      if (!_db) { resolve(null); return }
      var tx = _db.transaction([STORE_NAME], 'readonly')
      var store = tx.objectStore(STORE_NAME)
      var req = store.get(id)
      req.onsuccess = function (e) { resolve(e.target.result ? e.target.result.content : null) }
      req.onerror = function () { resolve(null) }
    })
  }

  function deleteFromDB(id) {
    return new Promise(function (resolve) {
      if (!_db) { resolve(); return }
      var tx = _db.transaction([STORE_NAME], 'readwrite')
      var store = tx.objectStore(STORE_NAME)
      var req = store.delete(id)
      req.onsuccess = function () { resolve() }
      req.onerror = function () { resolve() }
    })
  }

  function clearDBStore() {
    return new Promise(function (resolve) {
      if (!_db) { resolve(); return }
      var tx = _db.transaction([STORE_NAME], 'readwrite')
      var store = tx.objectStore(STORE_NAME)
      var req = store.clear()
      req.onsuccess = function () { resolve() }
      req.onerror = function () { resolve() }
    })
  }

  return { getDb, initDB, saveToDB, loadFromDB, deleteFromDB, clearDBStore }
})
