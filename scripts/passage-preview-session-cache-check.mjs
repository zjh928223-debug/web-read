import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const {
  clearPassagePreviewSessionCache,
  loadPassagePreviewSessionCache,
  savePassagePreviewSessionCache,
} = await import(`data:text/javascript;base64,${Buffer.from(
  await readFile(new URL('../src/features/passage-preview/passage-preview-session-cache.js', import.meta.url), 'utf8'),
).toString('base64')}`)

const values = new Map()
const storage = {
  getItem(key) { return values.get(key) || null },
  setItem(key, value) { values.set(key, value) },
  removeItem(key) { values.delete(key) },
}
const items = [{
  id: 'ielts-reading:2026-08-09:resilient',
  lemma: 'resilient',
  word: 'resilient',
  form: 'resilient',
  pos: 'adjective',
  primaryMeaningZh: '有韧性的',
  targetSenseKey: 'resilient:adjective:有韧性的',
}]

assert.equal(loadPassagePreviewSessionCache(items, storage), null)
savePassagePreviewSessionCache({
  items,
  preloadedSentences: {
    [items[0].id]: { sentence: 'The resilient child kept trying.', generated: true },
  },
  translations: { 'the resilient child kept trying.': '这个坚韧的孩子一直在尝试。' },
  storage,
})
const cached = loadPassagePreviewSessionCache(items, storage)
assert.equal(cached.items[0].lemma, 'resilient')
assert.equal(cached.preloadedSentences[items[0].id].generated, true)
assert.equal(cached.translations['the resilient child kept trying.'], '这个坚韧的孩子一直在尝试。')

assert.equal(loadPassagePreviewSessionCache([{ ...items[0], id: 'new-batch:resilient' }], storage), null)
clearPassagePreviewSessionCache(storage)
assert.equal(loadPassagePreviewSessionCache(items, storage), null)

console.log('Passage preview session cache checks passed.')
