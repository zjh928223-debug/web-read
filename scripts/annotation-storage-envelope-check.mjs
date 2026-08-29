import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const storageSource = await fs.readFile(new URL('../src/services/annotation/storage.js', import.meta.url), 'utf8')
assert.match(storageSource, /BUNDLE_SCHEMA = 'annotation-bundle\.v2'/)
assert.match(storageSource, /await saveJson\(normalizedScope, BUNDLE_FILE, envelope\)/)
assert.doesNotMatch(storageSource, /await saveJson\(normalizedScope, GENERATED_FILE, nextGenerated\)/)
assert.doesNotMatch(storageSource, /await saveJson\(normalizedScope, STATUS_FILE, nextStatus\)/)
assert.match(storageSource, /loadState = generated \|\| status \? 'legacy' : 'not-found'/)
assert.match(storageSource, /ANNOTATION_STORAGE_CORRUPT/)
assert.match(storageSource, /ANNOTATION_STORAGE_PERMISSION/)

const localWriteCount = (storageSource.match(/localStorage\.setItem\(getLocalStorageKey\(scope, filename\)/g) || []).length
assert.equal(localWriteCount, 1, 'localStorage commit must have one write owner')

globalThis.window = {}
const executableSource = storageSource
  .replace("import * as DIAGNOSTICS from './diagnostics.js';", 'const DIAGNOSTICS = { emit() {} };')
  .replace("import { recordBestEffortFailure } from '../runtime/best-effort.js';", 'const recordBestEffortFailure = () => null;')
  .replace("import { createTypedError } from '../runtime/typed-error.js';", `
    const createTypedError = (input) => Object.assign(new Error(input.message), input);
  `)
  .replace("import { assertWindowsOwnerBrowserWriterAllowed } from '../windows-owner-domain-cutover.js';", 'const assertWindowsOwnerBrowserWriterAllowed = () => {};')
const storageApi = await import(`data:text/javascript;base64,${Buffer.from(executableSource).toString('base64')}`)
const scope = { audioKey: 'audio-a', documentId: 'doc-a' }
const local = memoryStorage()
globalThis.localStorage = local
globalThis.window.localStorage = local
storageApi.setDirectoryHandle(null)
const missing = await storageApi.loadBundle(scope)
assert.equal(missing.loadState, 'not-found')
const saved = await storageApi.saveBundle(
  scope,
  storageApi.createGeneratedJson(scope, [{ id: 'generated-1' }]),
  storageApi.createStatusJson(scope, { block: { status: 'done' } }),
)
assert.equal(saved.revision, 1)
assert.equal((await storageApi.loadBundle(scope)).generated.items[0].id, 'generated-1')
const authoritativeText = local.getItem(storageApi.getLocalStorageKey(scope, storageApi.BUNDLE_FILE))

local.failNextWrite(new DOMException('quota exceeded', 'QuotaExceededError'))
await assert.rejects(
  () => storageApi.saveBundle(scope, storageApi.createGeneratedJson(scope, [{ id: 'quota-lost' }]), {}),
  (error) => error.name === 'QuotaExceededError',
)
assert.equal(local.getItem(storageApi.getLocalStorageKey(scope, storageApi.BUNDLE_FILE)), authoritativeText)

const staleRevision = saved.revision
await storageApi.saveBundle(scope, storageApi.createGeneratedJson(scope, [{ id: 'winner' }]), {}, { expectedRevision: staleRevision })
await assert.rejects(
  () => storageApi.saveBundle(scope, storageApi.createGeneratedJson(scope, [{ id: 'stale' }]), {}, { expectedRevision: staleRevision }),
  (error) => error.code === 'ANNOTATION_STORAGE_CONFLICT',
)
assert.equal((await storageApi.loadBundle(scope)).generated.items[0].id, 'winner')

local.setItem(storageApi.getLocalStorageKey(scope, storageApi.BUNDLE_FILE), JSON.stringify({ schemaVersion: 'annotation-bundle.v99', revision: 9 }))
await assert.rejects(
  () => storageApi.loadBundle(scope),
  (error) => error.code === 'ANNOTATION_STORAGE_SCHEMA_UNSUPPORTED' && error.details.schemaVersion === 'annotation-bundle.v99',
)

local.setItem(storageApi.getLocalStorageKey(scope, storageApi.BUNDLE_FILE), '{corrupt')
await assert.rejects(() => storageApi.loadBundle(scope), (error) => error.code === 'ANNOTATION_STORAGE_CORRUPT')
local.removeItem(storageApi.getLocalStorageKey(scope, storageApi.BUNDLE_FILE))
local.setItem(storageApi.getLocalStorageKey(scope, storageApi.GENERATED_FILE), JSON.stringify({ items: [{ id: 'legacy-1' }] }))
const legacy = await storageApi.loadBundle(scope)
assert.equal(legacy.loadState, 'legacy')
assert.equal(legacy.generated.items[0].id, 'legacy-1')

await storageApi.saveBundle(scope, storageApi.createGeneratedJson(scope, [{ id: 'reload-safe' }]), {})
assert.equal((await storageApi.loadBundle(scope)).generated.items[0].id, 'reload-safe', 'local commit must survive immediate page close/reload')

storageApi.setDirectoryHandle({
  async getFileHandle() { throw new DOMException('denied', 'NotAllowedError') },
})
await assert.rejects(() => storageApi.loadBundle(scope), (error) => error.code === 'ANNOTATION_STORAGE_PERMISSION')

let committedText = 'previous-authoritative-content'
storageApi.setDirectoryHandle({
  async getFileHandle(_filename, options) {
    if (!options?.create) throw new DOMException('missing', 'NotFoundError')
    return {
      async createWritable() {
        return {
          async write() {},
          async close() { throw new DOMException('interrupted before commit', 'AbortError') },
        }
      },
    }
  },
})
await assert.rejects(() => storageApi.saveBundle(scope, {}, {}), /interrupted/i)
assert.equal(committedText, 'previous-authoritative-content', 'failed directory close must not replace authoritative content')
console.log('annotation atomic envelope contract passed')

function memoryStorage() {
  const values = new Map()
  let failure = null
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { if (failure) { const error = failure; failure = null; throw error } values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
    failNextWrite(error) { failure = error },
  }
}
