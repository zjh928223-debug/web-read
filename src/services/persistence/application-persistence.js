const DATABASE_NAME = 'SeekPlayerDB'
const DATABASE_VERSION = 1
const STORE_NAME = 'files'

function persistenceError(code, operation, cause) {
  const error = new Error(`Application persistence ${operation} failed`)
  error.name = 'ApplicationPersistenceError'
  error.code = code
  error.operation = operation
  if (cause !== undefined) error.cause = cause
  return error
}

function requestPromise(request, operation) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(persistenceError('REQUEST_FAILED', operation, request.error))
  })
}

function transactionPromise(transaction, operation) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(persistenceError('TRANSACTION_ABORTED', operation, transaction.error))
    transaction.onerror = () => reject(persistenceError('TRANSACTION_FAILED', operation, transaction.error))
  })
}

function validateTypes(types) {
  if (!types || typeof types !== 'object' || Array.isArray(types)) {
    throw persistenceError('INVALID_CONFIGURATION', 'configure_types')
  }
  return new Map(Object.entries(types))
}

export function createApplicationPersistence(options = {}) {
  const indexedDBApi = options.indexedDBApi
    ?? (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null)
  const types = validateTypes(options.types)
  let databasePromise = null

  function typeFor(typeName) {
    const type = types.get(typeName)
    if (!type) throw persistenceError('UNKNOWN_TYPE', `resolve_type:${typeName}`)
    return type
  }

  function validateId(typeName, id) {
    const type = typeFor(typeName)
    if (typeof id !== 'string' || id.length === 0 || !id.startsWith(type.keyPrefix)) {
      throw persistenceError('INVALID_KEY', `validate_key:${typeName}`)
    }
    return type
  }

  function validateRow(typeName, row) {
    const type = validateId(typeName, row?.id)
    if (typeof type.validate !== 'function' || !type.validate(row)) {
      throw persistenceError('INVALID_VALUE', `validate_value:${typeName}`)
    }
  }

  function openDatabase() {
    if (databasePromise) return databasePromise
    if (!indexedDBApi || typeof indexedDBApi.open !== 'function') {
      return Promise.reject(persistenceError('INDEXEDDB_UNAVAILABLE', 'open_database'))
    }

    databasePromise = new Promise((resolve, reject) => {
      let request
      try {
        request = indexedDBApi.open(DATABASE_NAME, DATABASE_VERSION)
      } catch (error) {
        reject(persistenceError('OPEN_FAILED', 'open_database', error))
        return
      }

      request.onupgradeneeded = () => {
        try { request.transaction?.abort() } catch { /* Existing schema is mandatory. */ }
        reject(persistenceError('SCHEMA_UPGRADE_REJECTED', 'open_database'))
      }
      request.onblocked = () => reject(persistenceError('OPEN_BLOCKED', 'open_database'))
      request.onerror = () => reject(persistenceError('OPEN_FAILED', 'open_database', request.error))
      request.onsuccess = () => {
        const database = request.result
        try {
          if (database.version !== DATABASE_VERSION
            || !database.objectStoreNames?.contains(STORE_NAME)) {
            throw persistenceError('INCOMPATIBLE_SCHEMA', 'validate_database')
          }
          const probe = database.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME)
          if (probe.keyPath !== 'id') {
            throw persistenceError('INCOMPATIBLE_SCHEMA', 'validate_database')
          }
        } catch (error) {
          database.close?.()
          reject(error?.name === 'ApplicationPersistenceError'
            ? error
            : persistenceError('INCOMPATIBLE_SCHEMA', 'validate_database', error))
          return
        }
        database.onversionchange = () => {
          database.close?.()
          databasePromise = null
        }
        resolve(database)
      }
    })
    databasePromise.catch(() => {
      databasePromise = null
    })
    return databasePromise
  }

  async function runTransaction(mode, operation, execute) {
    const database = await openDatabase()
    let transaction
    let completion
    try {
      transaction = database.transaction([STORE_NAME], mode)
      const store = transaction.objectStore(STORE_NAME)
      completion = transactionPromise(transaction, operation)
      const result = await execute(store)
      await completion
      return result
    } catch (error) {
      try { transaction?.abort() } catch { /* Preserve the original failure. */ }
      if (completion) await completion.catch(() => {})
      if (error?.name === 'ApplicationPersistenceError') throw error
      throw persistenceError('TRANSACTION_FAILED', operation, error)
    }
  }

  return Object.freeze({
    async get(typeName, id) {
      validateId(typeName, id)
      const row = await runTransaction('readonly', `get:${typeName}`, (store) => (
        requestPromise(store.get(id), `get:${typeName}`)
      ))
      if (row !== undefined) validateRow(typeName, row)
      return row
    },

    async getMany(typeName, ids) {
      typeFor(typeName)
      if (!Array.isArray(ids) || ids.length === 0) {
        throw persistenceError('INVALID_KEY_LIST', `get_many:${typeName}`)
      }
      const uniqueIds = [...new Set(ids)]
      for (const id of uniqueIds) validateId(typeName, id)
      const rows = await runTransaction('readonly', `get_many:${typeName}`, (store) => (
        Promise.all(uniqueIds.map((id) => requestPromise(store.get(id), `get_many:${typeName}`)))
      ))
      for (const row of rows) {
        if (row !== undefined) validateRow(typeName, row)
      }
      return rows
    },

    async put(typeName, row) {
      validateRow(typeName, row)
      await runTransaction('readwrite', `put:${typeName}`, (store) => (
        requestPromise(store.put(row), `put:${typeName}`)
      ))
      return row
    },

    async putMany(typeName, rows) {
      typeFor(typeName)
      if (!Array.isArray(rows) || rows.length === 0) {
        throw persistenceError('INVALID_VALUE_LIST', `put_many:${typeName}`)
      }
      for (const row of rows) validateRow(typeName, row)
      await runTransaction('readwrite', `put_many:${typeName}`, (store) => (
        Promise.all(rows.map((row) => requestPromise(store.put(row), `put_many:${typeName}`)))
      ))
      return rows
    },

    async deleteMany(typeName, ids) {
      typeFor(typeName)
      if (!Array.isArray(ids)) {
        throw persistenceError('INVALID_KEY_LIST', `delete_many:${typeName}`)
      }
      const uniqueIds = [...new Set(ids)]
      for (const id of uniqueIds) validateId(typeName, id)
      if (uniqueIds.length === 0) return 0
      await runTransaction('readwrite', `delete_many:${typeName}`, (store) => {
        const deletions = uniqueIds.map((id) => (
          requestPromise(store.delete(id), `delete_many:${typeName}`)
        ))
        return Promise.all(deletions)
      })
      return uniqueIds.length
    },
  })
}
