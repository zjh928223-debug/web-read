import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/features/passage-preview/translation-generation-queue.js', import.meta.url), 'utf8')
const { createTranslationGenerationQueue } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const pending = []
const applied = []
const queue = createTranslationGenerationQueue({
  translate(items, { signal }) {
    return new Promise((resolve) => pending.push({ items, signal, resolve }))
  },
  apply(items) { applied.push(...items) },
})

const first = queue.enqueue([{ id: 'old' }])
await Promise.resolve()
assert.equal(pending.length, 1)
const second = queue.enqueue([{ id: 'new' }])
assert.equal(pending[0].signal.aborted, true, 'a newer generation must abort the active request')
pending[0].resolve([{ id: 'old', translationZh: 'late old translation' }])
await first
await Promise.resolve()
assert.equal(pending.length, 2)
pending[1].resolve([{ id: 'new', translationZh: 'current translation' }])
await second
assert.deepEqual(applied, [{ id: 'new', translationZh: 'current translation' }], 'a late old generation must never write back')

const third = queue.enqueue([{ id: 'disposed' }])
await Promise.resolve()
queue.dispose()
pending[2].resolve([{ id: 'disposed', translationZh: 'translation after unmount' }])
await third
assert.equal(applied.length, 1, 'dispose must invalidate an in-flight generation')

console.log('passage preview translation generation check passed')
