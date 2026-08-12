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
        var database = event.target.result
        database.onversionchange = function () {
          database.close()
          if (_db === database) _db = null
        }
        _db = database
        resolve(database)
      }
    })
  }

  function saveToDB(id, data) {
    if (!_db) return initDB().then(function () { return saveToDB(id, data) })
    return new Promise(function (resolve, reject) {
      var tx = _db.transaction([STORE_NAME], 'readwrite')
      var store = tx.objectStore(STORE_NAME)
      var request = store.put({ id: id, content: data, timestamp: new Date().getTime() })
      var settled = false
      var fail = function (error) {
        if (settled) return
        settled = true
        reject(error || tx.error || request.error || new Error('Audio database write failed'))
      }
      request.onerror = function () { fail(request.error) }
      tx.onerror = function () { fail(tx.error) }
      tx.onabort = function () { fail(tx.error || new Error('Audio database write aborted')) }
      tx.oncomplete = function () {
        if (settled) return
        settled = true
        resolve()
      }
    })
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
    if (!_db) return initDB().then(function () { return deleteFromDB(id) })
    return new Promise(function (resolve, reject) {
      var tx = _db.transaction([STORE_NAME], 'readwrite')
      var store = tx.objectStore(STORE_NAME)
      var req = store.delete(id)
      var settled = false
      var fail = function (error) {
        if (settled) return
        settled = true
        reject(error || tx.error || req.error || new Error('Audio database delete failed'))
      }
      req.onerror = function () { fail(req.error) }
      tx.onerror = function () { fail(tx.error) }
      tx.onabort = function () { fail(tx.error || new Error('Audio database delete aborted')) }
      tx.oncomplete = function () {
        if (settled) return
        settled = true
        resolve()
      }
    })
  }

  function clearDBStore() {
    return new Promise(function (resolve, reject) {
      if (!_db) { resolve(); return }
      var tx = _db.transaction([STORE_NAME], 'readwrite')
      var store = tx.objectStore(STORE_NAME)
      store.delete('audio')
      store.delete('audioMeta')
      tx.oncomplete = function () { resolve() }
      tx.onerror = function () { reject(tx.error || new Error('Audio records clear failed')) }
      tx.onabort = function () { reject(tx.error || new Error('Audio records clear aborted')) }
    })
  }

  return { getDb, initDB, saveToDB, loadFromDB, deleteFromDB, clearDBStore }
})
