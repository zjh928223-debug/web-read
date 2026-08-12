import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const current = read('CURRENT_PROJECT_STATUS.md')
const map = read('PROJECT_MAP.md')
const operations = read('docs/OPERATIONS.md')
const readme = read('README.md')
const index = read('index.html')

for (const [name, source] of Object.entries({ current, map, operations, readme })) {
  assert.match(source, /E:\\read-web-next/, `${name} must identify the isolated workspace`)
  assert.equal(source.includes('intentionally dirty'), false, `${name} must not preserve stale dirty-worktree instructions`)
  assert.equal(source.includes('reader-notes-runtime.js'), false, `${name} must not describe retired notes runtime as current`)
}

const storeScripts = [...index.matchAll(/<script type="module" src="src\/stores\/[^"?]+\.js"><\/script>/g)]
const compatibilityScripts = [...index.matchAll(/<script type="module" src="src\/composables\/[^"?]+\.js"><\/script>/g)]
assert.equal(storeScripts.length, 7)
assert.equal(compatibilityScripts.length, 11, 'nine compatibility modules plus reader/session entries are loaded')
assert.match(readme, /7 个 src\/stores/)
assert.match(readme, /9 个 src\/composables/)
assert.match(operations, /4193\/4194\/4195/)
assert.match(operations, /不修改桌面快捷方式/)

for (const historical of ['ES_MODULE_PLAN.md', 'REFACTORING_README.md', 'SRS_REVIEW_PERSONAL_MVP_IMPLEMENTATION.md']) {
  assert.match(read(historical), /历史|Archived/, `${historical} must carry an archived banner`)
}

console.log('current documentation check passed')
