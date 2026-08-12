import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const readerSource = await fs.readFile(new URL('../src/composables/reader-runtime-assembly.js', import.meta.url), 'utf8')
const sessionSource = await fs.readFile(new URL('../src/composables/session-runtime-assembly.js', import.meta.url), 'utf8')

await verifyReaderAssemblyLifecycle(readerSource)
await verifySessionAssemblyLifecycle(sessionSource)
console.log('runtime assembly lifecycle checks passed')

async function verifyReaderAssemblyLifecycle(source) {
  const disposals = []
  const executable = source
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export function initReaderRuntimeAssembly', 'function initReaderRuntimeAssembly')
    .concat('\nexport { initReaderRuntimeAssembly };')
  const names = {
    runtimeState: {},
    renderTranscript() {},
    renderChunkMode() {},
    initReaderRuntimeContext: () => ({ bootstrapRuntime: {} }),
    initReaderFeatureRuntime: () => ({ dispose: () => disposals.push('feature') }),
    createReaderFeatureAdapters: (value) => value,
    showToast() {},
    showError() {},
    syncAnnotationGenerationEntryStatus() {},
    createLifecycleScope,
  }
  const module = await importWithBindings(executable, names)
  const windowObject = { document: {} }
  const first = module.initReaderRuntimeAssembly({ getWindow: () => windowObject })
  const second = module.initReaderRuntimeAssembly({ getWindow: () => windowObject })
  assert.deepEqual(disposals, ['feature'])
  first.dispose()
  assert.deepEqual(disposals, ['feature'])
  second.dispose()
  second.dispose()
  assert.deepEqual(disposals, ['feature', 'feature'])
}

async function verifySessionAssemblyLifecycle(source) {
  const disposals = []
  const executable = source
    .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '')
    .replace('export function initSessionRuntimeAssembly', 'function initSessionRuntimeAssembly')
    .concat('\nexport { initSessionRuntimeAssembly };')
  const annotationRuntime = {
    clearGeneratedAnnotationIndex() {},
    getAnnotationGenerationScope() {},
    scheduleGeneratedAnnotationIndexRefresh() {},
    syncAnnotationGenerationEntryStatus() {},
    emitAnnotationDiagnostics() {},
    dispose: () => disposals.push('annotation'),
  }
  const lifecycleRuntime = {
    clearPersistedChunkSession() {},
    ready: Promise.resolve(),
    dispose: () => disposals.push('lifecycle'),
  }
  const names = {
    getSessionState: () => ({}),
    createSessionRuntimeAdapters: () => ({
      getWindow: () => ({}),
      annotation: { start: () => annotationRuntime },
      lifecycle: { start: () => lifecycleRuntime },
    }),
    configureSessionFacades() {},
    createLifecycleScope,
  }
  const module = await importWithBindings(executable, names)
  const first = module.initSessionRuntimeAssembly()
  const second = module.initSessionRuntimeAssembly()
  assert.deepEqual(disposals, ['lifecycle', 'annotation'])
  first.dispose()
  assert.deepEqual(disposals, ['lifecycle', 'annotation'])
  second.dispose()
  second.dispose()
  assert.deepEqual(disposals, ['lifecycle', 'annotation', 'lifecycle', 'annotation'])
}

function createLifecycleScope() {
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
}

async function importWithBindings(source, bindings) {
  const declarations = Object.keys(bindings)
    .map((name) => `const ${name} = globalThis.__runtimeAssemblyLifecycleBindings.${name};`)
    .join('\n')
  globalThis.__runtimeAssemblyLifecycleBindings = bindings
  return import(`data:text/javascript;base64,${Buffer.from(`${declarations}\n${source}`).toString('base64')}#${Math.random()}`)
}
