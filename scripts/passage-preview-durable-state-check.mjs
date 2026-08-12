import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const source = await fs.readFile(new URL('../src/features/passage-preview/passage-preview-durable-state.js', import.meta.url), 'utf8')
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const { PASSAGE_PREVIEW_DURABLE_KEY, loadPassagePreviewDurableState, updatePassagePreviewDurableState } = api

const storage = memoryStorage()
const first = updatePassagePreviewDurableState((state) => ({ ...state, data: [{ id: 'batch:a' }] }), storage)
assert.equal(first.revision, 1)
assert.equal(loadPassagePreviewDurableState(storage).data[0].id, 'batch:a')
storage.failNextWrite(new DOMException('quota', 'QuotaExceededError'))
assert.throws(() => updatePassagePreviewDurableState((state) => ({ ...state, progress: { currentIndex: 2 } }), storage), /quota/)
assert.equal(loadPassagePreviewDurableState(storage).revision, 1)
storage.setItem(PASSAGE_PREVIEW_DURABLE_KEY, '{corrupt')
const recovered = loadPassagePreviewDurableState(storage, { data: [{ id: 'legacy:item' }] })
assert.equal(recovered.revision, 0)
assert.equal(recovered.data[0].id, 'legacy:item')
console.log('passage preview durable state checks passed')

function memoryStorage() {
  const values = new Map()
  let failure = null
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { if (failure) { const error = failure; failure = null; throw error } values.set(key, String(value)) },
    failNextWrite(error) { failure = error },
  }
}
