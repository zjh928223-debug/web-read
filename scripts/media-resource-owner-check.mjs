import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const moduleSource = readFileSync(
  new URL('../src/services/media/media-resource-owner.js', import.meta.url),
  'utf8',
)
const { createMediaResourceOwner } = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
)

const events = []
const mediaElement = createMediaElement(events)
const owner = createMediaResourceOwner({
  mediaElement,
  revokeObjectURL(url) { events.push(`revoke:${url}`) },
})

owner.replace('blob:fixture-a')
owner.replace('blob:fixture-b')
assert.deepEqual(events, [
  'set:blob:fixture-a',
  'pause',
  'remove:src',
  'load',
  'revoke:blob:fixture-a',
  'set:blob:fixture-b',
])

const afterFirstReplace = events.length
assert.equal(owner.replace('blob:fixture-b'), false)
assert.equal(events.length, afterFirstReplace, 'replacing with the owned URL must be idempotent')

owner.replace('http://127.0.0.1:8766/media/fixture.mp4')
owner.dispose()
owner.dispose()
assert.deepEqual(events.slice(afterFirstReplace), [
  'pause',
  'remove:src',
  'load',
  'revoke:blob:fixture-b',
  'set:http://127.0.0.1:8766/media/fixture.mp4',
  'pause',
  'remove:src',
  'load',
])
assert.equal(events.includes('revoke:http://127.0.0.1:8766/media/fixture.mp4'), false)

const failureEvents = []
const failingOwner = createMediaResourceOwner({
  mediaElement: createMediaElement(failureEvents, {
    pause: true,
    removeAttribute: true,
    load: true,
  }),
  revokeObjectURL(url) {
    failureEvents.push(`revoke:${url}`)
    throw new Error('revoke failed')
  },
})
failingOwner.replace('blob:failing')
assert.doesNotThrow(() => failingOwner.dispose())
assert.doesNotThrow(() => failingOwner.dispose())
assert.deepEqual(failureEvents, [
  'set:blob:failing',
  'pause',
  'remove:src',
  'load',
  'revoke:blob:failing',
])

const failedBindEvents = []
const failedBindElement = createMediaElement(failedBindEvents)
Object.defineProperty(failedBindElement, 'src', {
  set(value) {
    failedBindEvents.push(`set:${value}`)
    throw new Error('bind failed')
  },
})
const failedBindOwner = createMediaResourceOwner({
  mediaElement: failedBindElement,
  revokeObjectURL(url) { failedBindEvents.push(`revoke:${url}`) },
})
assert.throws(() => failedBindOwner.replace('blob:unbound'), /bind failed/)
failedBindOwner.dispose()
assert.deepEqual(failedBindEvents, ['set:blob:unbound'])

assert.throws(() => owner.replace(''), TypeError)

const heapUrls = new Set()
let peakHeapUrls = 0
let heapSequence = 0
const heapMediaElement = createMediaElement([])
const heapOwner = createMediaResourceOwner({
  mediaElement: heapMediaElement,
  revokeObjectURL(url) { heapUrls.delete(url) },
})
for (let index = 0; index < 500; index += 1) {
  const url = `blob:material-${++heapSequence}`
  heapUrls.add(url)
  peakHeapUrls = Math.max(peakHeapUrls, heapUrls.size)
  heapOwner.replace(url)
}
assert.equal(heapUrls.size, 1, 'only the active material URL may remain live')
heapOwner.dispose()
assert.equal(heapUrls.size, 0, 'disposing after repeated material opens must release the final URL')
assert.equal(peakHeapUrls, 2, 'replace must keep consecutive material Object URLs bounded')

console.log('MediaResourceOwner checks passed.')

function createMediaElement(events, failures = {}) {
  return {
    set src(value) { events.push(`set:${value}`) },
    pause() {
      events.push('pause')
      if (failures.pause) throw new Error('pause failed')
    },
    removeAttribute(name) {
      events.push(`remove:${name}`)
      if (failures.removeAttribute) throw new Error('remove failed')
    },
    load() {
      events.push('load')
      if (failures.load) throw new Error('load failed')
    },
  }
}
