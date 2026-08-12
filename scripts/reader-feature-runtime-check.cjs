const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'composables', 'reader-feature-runtime.js'), 'utf8')
  const executable = source
    .replace(/^import .*\r?\n/gm, '')
    .replace('export function initReaderFeatureRuntime', 'function initReaderFeatureRuntime')
    .concat('\nexport { initReaderFeatureRuntime };')
  globalThis.__featureBindings = { createLifecycleScope }
  const declarations = 'const createLifecycleScope = globalThis.__featureBindings.createLifecycleScope;\n'
  const { initReaderFeatureRuntime } = await import(`data:text/javascript;base64,${Buffer.from(declarations + executable).toString('base64')}#${Date.now()}`)

  const calls = []
  const disposed = []
  const runtime = (name, product = {}) => ({ ...product, dispose: () => disposed.push(name) })
  const adapters = {
    startImport(input) { calls.push(['import', input]); return runtime('import', { visualVocabApi: { id: 'visual' } }) },
    startControls(input) { calls.push(['controls', input]); return runtime('controls', { chunkControlsApi: { id: 'chunk' } }) },
    startInteraction(input) { calls.push(['interaction', input]); return runtime('interaction', { forceUpdateUI() {}, playbackRuntimeHelpersApi: { id: 'playback' } }) },
    startKeyboard(input) { calls.push(['keyboard', input]); return runtime('keyboard') },
    startApp(input) { calls.push(['app', input]); return runtime('app') },
  }
  const api = initReaderFeatureRuntime({ adapters })
  assert.deepEqual(calls.map(([name]) => name), ['import', 'controls', 'interaction', 'keyboard', 'app'])
  assert.deepEqual(calls[0][1].getChunkControlsApi(), { id: 'chunk' })
  assert.equal(calls[1][1].getForceUpdateUI(), api.forceUpdateUI)
  assert.deepEqual(calls[2][1].visualVocabApi, { id: 'visual' })
  assert.deepEqual(calls[3][1].chunkControlsApi, { id: 'chunk' })
  assert.equal(calls[3][1].interactionRuntime, api.interactionRuntime)
  assert.deepEqual(calls[4][1].chunkControlsApi, { id: 'chunk' })
  assert.equal(calls[4][1].interactionRuntime, api.interactionRuntime)
  api.dispose()
  api.dispose()
  assert.deepEqual(disposed, ['app', 'keyboard', 'interaction', 'controls', 'import'])
  assert.throws(() => initReaderFeatureRuntime({}), /adapters are required/)
  console.log('reader feature runtime check passed')
}

function createLifecycleScope() {
  const disposers = []
  let disposed = false
  return { add(fn) { disposers.push(fn) }, dispose() { if (disposed) return; disposed = true; for (let i = disposers.length - 1; i >= 0; i -= 1) disposers[i]() } }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
