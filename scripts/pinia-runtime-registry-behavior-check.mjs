import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/pinia-stores/runtime-registry.js', import.meta.url), 'utf8')
const registry = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Date.now()}`)

assert.equal(registry.getPiniaRuntimeStores(), null)
assert.throws(
  () => registry.requirePiniaRuntimeStores(),
  /Pinia runtime stores are not configured/,
  'runtime consumers must fail clearly before Pinia is configured',
)

const sourceStores = {
  audio: { id: 'audio-store' },
  transcript: { id: 'transcript-store' },
}
const configuredStores = registry.configurePiniaRuntimeStores(sourceStores)

assert.notEqual(configuredStores, sourceStores, 'the registry must snapshot the injected store map')
assert.equal(Object.isFrozen(configuredStores), true)
assert.equal(registry.getPiniaRuntimeStores(), configuredStores)
assert.equal(registry.requirePiniaRuntimeStores(), configuredStores)

sourceStores.audio = { id: 'replacement-store' }
sourceStores.ui = { id: 'late-store' }
assert.equal(registry.requirePiniaRuntimeStores().audio.id, 'audio-store')
assert.equal(Object.prototype.hasOwnProperty.call(registry.requirePiniaRuntimeStores(), 'ui'), false)
assert.throws(() => { configuredStores.audio = null }, TypeError)

console.log('pinia runtime registry behavior check passed')
