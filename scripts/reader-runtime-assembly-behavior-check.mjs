import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/composables/reader-runtime-assembly.js', import.meta.url), 'utf8')
const executable = source
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export function initReaderRuntimeAssembly', 'function initReaderRuntimeAssembly')
  .concat('\nexport { initReaderRuntimeAssembly };')

const calls = []
globalThis.__readerAssemblyBehaviorBindings = {
  runtimeState: { kind: 'runtime-state' },
  renderTranscript() { calls.push('renderTranscript') },
  renderChunkMode() { calls.push('renderChunkMode') },
  showToast() { calls.push('showToast') },
  showError() { calls.push('showError') },
  syncAnnotationGenerationEntryStatus() { calls.push('syncAnnotationGenerationEntryStatus') },
  initReaderRuntimeContext() {
    calls.push('context:init')
    return {
      bootstrapRuntime: { kind: 'bootstrap-runtime' },
      dispose() { calls.push('context:dispose') },
    }
  },
  createReaderFeatureAdapters(options) {
    calls.push(['feature:adapters', options.bootstrapRuntime.kind])
    return { kind: 'feature-adapters' }
  },
  initReaderFeatureRuntime({ adapters }) {
    calls.push(['feature:init', adapters.kind])
    return { dispose() { calls.push('feature:dispose') } }
  },
  createLifecycleScope() {
    const disposers = []
    let disposed = false
    return {
      add(disposer) { disposers.push(disposer) },
      dispose() {
        if (disposed) return
        disposed = true
        for (let index = disposers.length - 1; index >= 0; index -= 1) disposers[index]()
      },
    }
  },
}

const declarations = Object.keys(globalThis.__readerAssemblyBehaviorBindings)
  .map((name) => `const ${name} = globalThis.__readerAssemblyBehaviorBindings.${name};`)
  .join('\n')
const module = await import(`data:text/javascript;base64,${Buffer.from(`${declarations}\n${executable}`).toString('base64')}#${Date.now()}`)

const windowObject = { document: { body: {} } }
const first = module.initReaderRuntimeAssembly({ getWindow: () => windowObject })
assert.equal(first.runtimeContext.bootstrapRuntime.kind, 'bootstrap-runtime')
assert.equal(first.featureRuntime.dispose instanceof Function, true)

const second = module.initReaderRuntimeAssembly({ getWindow: () => windowObject })
assert.deepEqual(calls, [
  'context:init',
  ['feature:adapters', 'bootstrap-runtime'],
  ['feature:init', 'feature-adapters'],
  'feature:dispose',
  'context:dispose',
  'context:init',
  ['feature:adapters', 'bootstrap-runtime'],
  ['feature:init', 'feature-adapters'],
])

second.dispose()
second.dispose()
assert.deepEqual(calls.slice(-2), ['feature:dispose', 'context:dispose'])
console.log('reader runtime assembly behavior check passed')
