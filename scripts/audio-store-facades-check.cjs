const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const legacyPath = path.join(repoRoot, 'src', 'stores', 'audio.js')
const piniaSource = fs.readFileSync(path.join(repoRoot, 'src', 'pinia-stores', 'audio.js'), 'utf8')
const bootstrapSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-bootstrap-runtime.js'), 'utf8')
const sessionSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-adapters.js'), 'utf8')
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8')

assert.equal(fs.existsSync(legacyPath), false, 'legacy audio compatibility store must be deleted')
for (const name of ['initDB', 'saveToDB', 'loadFromDB', 'deleteFromDB', 'clearDBStore']) {
  assert.match(piniaSource, new RegExp(`function ${name}\\(`), `Pinia audio store should own ${name}`)
}
assert.match(piniaSource, /store\.delete\(['"]audio['"]\)/u)
assert.match(piniaSource, /store\.delete\(['"]audioMeta['"]\)/u)
assert.equal(/\.clear\s*\(/u.test(piniaSource), false, 'audio cleanup must not clear the shared files store')
assert.ok(bootstrapSource.includes('requirePiniaRuntimeStores().audio'))
assert.ok(sessionSource.includes('requirePiniaRuntimeStores().audio'))
assert.equal(mainSource.includes('__audioStore'), false)

console.log('audio store owner check passed')
