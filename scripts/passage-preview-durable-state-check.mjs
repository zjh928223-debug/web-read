import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const source = await fs.readFile(new URL('../src/features/passage-preview/passage-preview-durable-state.js', import.meta.url), 'utf8')
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const {
  PASSAGE_PREVIEW_DURABLE_KEY,
  inspectPassagePreviewDurableState,
  loadPassagePreviewDurableState,
  updatePassagePreviewDurableState,
} = api

const storage = memoryStorage()
const first = updatePassagePreviewDurableState((state) => ({ ...state, data: [{ id: 'batch:a' }] }), storage)
assert.equal(first.revision, 1)
assert.equal(loadPassagePreviewDurableState(storage).data[0].id, 'batch:a')
storage.failNextWrite(new DOMException('quota', 'QuotaExceededError'))
assert.throws(() => updatePassagePreviewDurableState((state) => ({ ...state, progress: { currentIndex: 2 } }), storage), /quota/)
assert.equal(loadPassagePreviewDurableState(storage).revision, 1)
storage.setItem(PASSAGE_PREVIEW_DURABLE_KEY, '{corrupt')
assert.equal(inspectPassagePreviewDurableState(storage).status, 'corrupt')
assert.throws(
  () => loadPassagePreviewDurableState(storage),
  (error) => error.code === 'PASSAGE_PREVIEW_STATE_CORRUPT',
)
const recovered = loadPassagePreviewDurableState(storage, { data: [{ id: 'legacy:item' }] })
assert.equal(recovered.revision, 0)
assert.equal(recovered.data[0].id, 'legacy:item')
assert.equal(inspectPassagePreviewDurableState(storage, { data: [{ id: 'legacy:item' }] }).status, 'recovered-legacy')

storage.setItem(PASSAGE_PREVIEW_DURABLE_KEY, JSON.stringify({ schemaVersion: 'passage-preview.durable-state.v99', revision: 4 }))
assert.throws(
  () => loadPassagePreviewDurableState(storage),
  (error) => error.code === 'PASSAGE_PREVIEW_SCHEMA_UNSUPPORTED' && error.schemaVersion === 'passage-preview.durable-state.v99',
)

storage.removeItem(PASSAGE_PREVIEW_DURABLE_KEY)
const shared = memoryStorage()
const base = updatePassagePreviewDurableState((state) => ({ ...state, data: [{ id: 'base' }] }), shared)
const winner = updatePassagePreviewDurableState((state) => ({ ...state, data: [{ id: 'winner' }] }), shared, {}, { expectedRevision: base.revision })
assert.equal(winner.revision, 2)
assert.throws(
  () => updatePassagePreviewDurableState((state) => ({ ...state, data: [{ id: 'stale' }] }), shared, {}, { expectedRevision: base.revision }),
  (error) => error.code === 'PASSAGE_PREVIEW_REVISION_CONFLICT',
)
assert.equal(loadPassagePreviewDurableState(shared).data[0].id, 'winner')

const closedPageStorage = memoryStorage()
updatePassagePreviewDurableState((state) => ({ ...state, progress: { currentIndex: 7 } }), closedPageStorage)
assert.equal(loadPassagePreviewDurableState(closedPageStorage).progress.currentIndex, 7, 'a synchronous commit must survive page close/reload')
console.log('passage preview durable state checks passed')

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
