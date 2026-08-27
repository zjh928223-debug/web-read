import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const appSource = read('src/App.vue')
const uiServiceSource = read('src/features/srs-review/srs-review-ui-service.js')
const viteConfigSource = read('vite.config.mjs')
const cleanRoomSource = read('scripts/verify-clean-room.mjs')

assert.doesNotMatch(appSource, /personalization-shadow\.html|learning-model-entry|createPersonalizationShadowSettings|personalizationShadowEnabled/u)

assert.match(uiServiceSource, /options\.personalizationShadowRunner\s*\|\|\s*null/u)
assert.doesNotMatch(uiServiceSource, /createPersonalizationShadowService|createIndexedDbPersonalizationShadowReportRepository/u)

assert.doesNotMatch(viteConfigSource, /personalizationShadow:\s*resolve\(__dirname, 'personalization-shadow\.html'\)/u)
assert.doesNotMatch(cleanRoomSource, /'dist\/personalization-shadow\.html'/u)

for (const relativePath of [
  'personalization-shadow.html',
  'src/personalization-shadow-main.js',
  'src/features/personalization-shadow/PersonalizationShadowPage.vue',
  'src/services/vocabulary/personalization/personalization-shadow-service.js',
]) {
  assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, `experimental shadow source must remain: ${relativePath}`)
}

console.log('personalization shadow product boundary check passed')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}
