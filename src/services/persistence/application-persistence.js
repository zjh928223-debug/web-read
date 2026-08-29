import { assertWindowsOwnerBrowserWriterAllowed } from '../windows-owner-domain-cutover.js'

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

function revisionConflict(operation, expectedRevision, actualRevision) {
  const error = persistenceError('REVISION_CONFLICT', operation)
  error.expectedRevision = expectedRevision
  error.actualRevision = actualRevision
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

  function assertWriterAllowed(typeName, rows, operation) {
    if (typeName === 'readerSessionQuarantine') {
      assertWindowsOwnerBrowserWriterAllowed('reader-session', operation)
      return
    }
    if (typeName !== 'readerSessionRow') return
    const values = Array.isArray(rows) ? rows : [rows]
    const ids = new Set(values.map((row) => row?.id).filter(Boolean))
    if (ids.has('marks')) assertWindowsOwnerBrowserWriterAllowed('marks-activity', operation)
    if ([...ids].some((id) => id !== 'marks')) assertWindowsOwnerBrowserWriterAllowed('reader-session', operation)
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

  async function runTransaction(mode, operation, execute, options = {}) {
    const database = await openDatabase()
    if (options.signal?.aborted) throw persistenceError('TRANSACTION_ABORTED', operation, options.signal.reason)
    let transaction
    let completion
    const abort = () => {
      try { transaction?.abort() } catch { /* Transaction already completed or inactive. */ }
    }
    try {
      transaction = database.transaction([STORE_NAME], mode)
      options.signal?.addEventListener('abort', abort, { once: true })
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
    } finally {
      options.signal?.removeEventListener('abort', abort)
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

    async getAllRows() {
      const rows = await runTransaction('readonly', 'get_all_rows', (store) => (
        requestPromise(store.getAll(), 'get_all_rows')
      ))
      return Array.isArray(rows) ? rows : []
    },

    async put(typeName, row) {
      assertWriterAllowed(typeName, row, `put:${typeName}`)
      validateRow(typeName, row)
      await runTransaction('readwrite', `put:${typeName}`, (store) => (
        requestPromise(store.put(row), `put:${typeName}`)
      ))
      return row
    },

    async putMany(typeName, rows, options = {}) {
      assertWriterAllowed(typeName, rows, `put_many:${typeName}`)
      typeFor(typeName)
      if (!Array.isArray(rows) || rows.length === 0) {
        throw persistenceError('INVALID_VALUE_LIST', `put_many:${typeName}`)
      }
      for (const row of rows) validateRow(typeName, row)
      await runTransaction('readwrite', `put_many:${typeName}`, (store) => (
        Promise.all(rows.map((row) => requestPromise(store.put(row), `put_many:${typeName}`)))
      ), options)
      return rows
    },

    async compareAndSwapMany(typeName, rows, options = {}) {
      assertWriterAllowed(typeName, rows, `compare_and_swap_many:${typeName}`)
      typeFor(typeName)
      if (!Array.isArray(rows) || rows.length === 0) {
        throw persistenceError('INVALID_VALUE_LIST', `compare_and_swap_many:${typeName}`)
      }
      for (const row of rows) validateRow(typeName, row)
      validateId(typeName, options.guardId)
      if (!Object.prototype.hasOwnProperty.call(options, 'expectedRevision')) {
        throw persistenceError('EXPECTED_REVISION_REQUIRED', `compare_and_swap_many:${typeName}`)
      }
      const operation = `compare_and_swap_many:${typeName}`
      await runTransaction('readwrite', operation, async (store) => {
        const current = await requestPromise(store.get(options.guardId), operation)
        const actualRevision = current?.revision ?? null
        if (actualRevision !== options.expectedRevision) {
          throw revisionConflict(operation, options.expectedRevision, actualRevision)
        }
        await Promise.all(rows.map((row) => requestPromise(store.put(row), operation)))
      }, options)
      return rows
    },

    /**
     * Replace a registered set of files rows in one v1 transaction.
     *
     * Restore uses this boundary for rows that belong to a domain but do not
     * have a single repository-level type (for example the reader session's
     * five fixed ids plus vocabulary's prefixed rows).  The caller supplies
     * an explicit allowlist/validator; unknown rows are never implicitly
     * touched and the transaction still resolves only after oncomplete.
     */
    async replaceRows(options = {}) {
      const rows = Array.isArray(options.rows) ? options.rows : []
      const deleteIds = Array.isArray(options.deleteIds) ? [...new Set(options.deleteIds)] : []
      const allowId = typeof options.allowId === 'function' ? options.allowId : () => true
      const validateRow = typeof options.validateRow === 'function' ? options.validateRow : null
      const operation = String(options.operation || 'replace_rows')
      if (rows.length === 0 && deleteIds.length === 0) {
        throw persistenceError('INVALID_VALUE_LIST', operation)
      }
      const ids = new Set()
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)
          || typeof row.id !== 'string' || !row.id || ids.has(row.id)
          || !allowId(row.id, row) || (validateRow && !validateRow(row))) {
          throw persistenceError('INVALID_VALUE', operation)
        }
        ids.add(row.id)
      }
      for (const id of deleteIds) {
        if (typeof id !== 'string' || !id || !allowId(id) || ids.has(id)) {
          throw persistenceError('INVALID_KEY', operation)
        }
        ids.add(id)
      }
      const guardId = options.guardId
      const hasExpectedRevision = Object.prototype.hasOwnProperty.call(options, 'expectedRevision')
      if (guardId !== undefined && guardId !== null
        && (typeof guardId !== 'string' || !guardId || !allowId(guardId))) {
        throw persistenceError('EXPECTED_REVISION_REQUIRED', operation)
      }
      await runTransaction('readwrite', operation, async (store) => {
        if (hasExpectedRevision) {
          let actualRevision
          if (typeof guardId === 'string' && guardId) {
            const current = await requestPromise(store.get(guardId), operation)
            actualRevision = current?.revision ?? null
          } else {
            const currentRows = await requestPromise(store.getAll(), operation)
            actualRevision = currentRows
              .filter((row) => allowId(row?.id, row))
              .reduce((maximum, row) => (
                Number.isInteger(row?.revision) && row.revision >= 0
                  ? Math.max(maximum, row.revision)
                  : maximum
              ), 0)
          }
          if (actualRevision !== options.expectedRevision) {
            throw revisionConflict(operation, options.expectedRevision, actualRevision)
          }
        }
        for (const id of deleteIds) await requestPromise(store.delete(id), operation)
        for (const row of rows) await requestPromise(store.put(row), operation)
      }, options)
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
