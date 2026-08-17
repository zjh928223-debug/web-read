import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const current = read('CURRENT_PROJECT_STATUS.md')
const map = read('PROJECT_MAP.md')
const operations = read('docs/OPERATIONS.md')
const readme = read('README.md')
const changelog = read('CHANGELOG.md')
const index = read('index.html')

for (const [name, source] of Object.entries({ current, map, operations, readme })) {
  assert.match(source, /E:\\read-web-next/, `${name} must identify the isolated workspace`)
  assert.equal(source.includes('intentionally dirty'), false, `${name} must not preserve stale dirty-worktree instructions`)
  assert.equal(source.includes('reader-notes-runtime.js'), false, `${name} must not describe retired notes runtime as current`)
}

const storeScripts = [...index.matchAll(/<script type="module" src="src\/stores\/[^"?]+\.js"><\/script>/g)]
const compatibilityScripts = [...index.matchAll(/<script type="module" src="src\/composables\/[^"?]+\.js"><\/script>/g)]
assert.equal(storeScripts.length, 0, 'retired compatibility stores must not return to index.html')
assert.equal(compatibilityScripts.length, 9, 'nine compatibility/runtime modules are loaded before main')
assert.match(readme, /9 个 src\/composables/)
assert.match(current, /旧 `src\/stores\/` 启动兼容层已删除/)
assert.match(changelog, /migrated locally on 2026-08-17/)
assert.match(changelog, /no upstream and no push was performed/)
assert.match(operations, /4193.*4194/)
assert.match(operations, /随机 browser-safe 端口/)
assert.match(operations, /排除 `5173\/8765`/)
assert.match(operations, /后续验证不得自动改写/)
assert.match(operations, /旧目标必须保留用于回滚/)

for (const historical of ['ES_MODULE_PLAN.md', 'REFACTORING_README.md', 'SRS_REVIEW_PERSONAL_MVP_IMPLEMENTATION.md']) {
  assert.match(read(historical), /历史|Archived/, `${historical} must carry an archived banner`)
}

console.log('current documentation check passed')
