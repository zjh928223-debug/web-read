import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/composables/session-runtime-adapters.js', import.meta.url), 'utf8')
const executable = source
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export function createSessionRuntimeAdapters', 'function createSessionRuntimeAdapters')
  .concat('\nexport { createSessionRuntimeAdapters };')

const calls = []
globalThis.__sessionAdapterBehaviorBindings = {
  createSessionAnnotationRuntime(deps) {
    calls.push({ kind: 'annotation', deps })
    return { kind: 'annotation-runtime' }
  },
  startSessionLifecycleRuntime(deps) {
    calls.push({ kind: 'lifecycle', deps })
    return { kind: 'lifecycle-runtime' }
  },
  requirePiniaRuntimeStores() { return { audio: globalThis.__sessionBehaviorAudioStore } },
  initPiniaBridge() { return function bridgeToPinia() {} },
}
const declarations = Object.keys(globalThis.__sessionAdapterBehaviorBindings)
  .map((name) => `const ${name} = globalThis.__sessionAdapterBehaviorBindings.${name};`)
  .join('\n')
const module = await import(`data:text/javascript;base64,${Buffer.from(`${declarations}\n${executable}`).toString('base64')}#${Date.now()}`)

const elements = new Map([
  ['audio-player', { id: 'audio-player' }],
  ['annotation-mark-count', { id: 'annotation-mark-count' }],
  ['hotkey-input', { id: 'hotkey-input' }],
])
const windowObject = {
  _ns: { session: 'namespace' },
  localStorage: { getItem() { return null } },
  URL: { createObjectURL() { return 'blob:test' } },
  Blob: function Blob() {},
  saveToDB() {},
  loadFromDB() {},
  deleteFromDB() {},
  initDB() {},
  showToast() {},
  __annotationLightweightModule: { kind: 'annotation-module' },
}
globalThis.__sessionBehaviorAudioStore = {
  saveToDB() {}, loadFromDB() {}, deleteFromDB() {}, initDB() {}
}
const documentObject = {
  getElementById(id) { return elements.get(id) || null },
}
const state = { id: 'session-state' }
const adapters = module.createSessionRuntimeAdapters({
  getWindow: () => windowObject,
  getDocument: () => documentObject,
})

assert.equal(adapters.getWindow(), windowObject)
const annotationRuntime = adapters.annotation.start(state)
const lifecycleRuntime = adapters.lifecycle.start(state, annotationRuntime)
assert.deepEqual(calls.map(({ kind }) => kind), ['annotation', 'lifecycle'])
assert.equal(annotationRuntime.kind, 'annotation-runtime')
assert.equal(lifecycleRuntime.kind, 'lifecycle-runtime')

const annotationDeps = calls[0].deps
assert.equal(annotationDeps.state, state)
assert.equal(annotationDeps.namespace, windowObject._ns)
assert.equal(annotationDeps.windowObject, windowObject)
assert.equal(annotationDeps.documentObject, documentObject)
assert.equal(annotationDeps.domRefs.audioPlayer, elements.get('audio-player'))
assert.equal(annotationDeps.domRefs.annotationMarkCountEl, elements.get('annotation-mark-count'))
assert.equal(annotationDeps.globals.saveToDB.name, 'bound saveToDB')
assert.equal(annotationDeps.globals.annotationLightweightModule, windowObject.__annotationLightweightModule)

const lifecycleDeps = calls[1].deps
assert.equal(lifecycleDeps.state, state)
assert.equal(lifecycleDeps.namespace, windowObject._ns)
assert.equal(lifecycleDeps.annotationRuntime, annotationRuntime)
assert.equal(lifecycleDeps.domRefs.hotkeyInput, elements.get('hotkey-input'))
assert.equal(lifecycleDeps.runtimeDeps.localStorageApi, windowObject.localStorage)
assert.equal(lifecycleDeps.globals.loadFromDB.name, 'bound loadFromDB')
console.log('session runtime adapters behavior check passed')
