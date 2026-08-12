const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8')
const assembly = fs.readFileSync(path.join(root, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8')

assert.match(source, /export function createReaderFeatureAdapters/)
for (const domain of ['startImport', 'startControls', 'startInteraction', 'startKeyboard', 'startApp']) {
  assert.match(source, new RegExp(`function ${domain}\\(`), `${domain} adapter must exist`)
}
assert.match(assembly, /adapters: createReaderFeatureAdapters\(/)
assert.equal(assembly.includes('...createReaderFeatureRuntimeDeps'), false)
assert.equal((assembly.match(/domRefs\./g) || []).length, 0, 'top-level assembly must not know feature DOM leaves')
assert.equal((assembly.match(/runtimeDeps\./g) || []).length, 0, 'top-level assembly must not know feature helper leaves')
assert.equal(source.includes('forceUpdateUI: forceUpdateUI'), false, 'retired early undefined import dependency must stay removed')
assert.equal(source.includes('window.'), false)
assert.equal(source.includes('document.'), false)
console.log('reader feature runtime deps check passed')
