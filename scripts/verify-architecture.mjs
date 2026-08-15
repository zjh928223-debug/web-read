import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inventory = JSON.parse(await readFile(path.join(repositoryRoot, 'docs', 'architecture', 'test-inventory.json'), 'utf8'))
const excludedPaths = new Set([
  'scripts/test-inventory.mjs',
  'scripts/verify-architecture.mjs',
  // 10.5 owns the remaining window.__state compatibility read; keep its
  // legacy alias callable until that production migration lands.
  'scripts/runtime-state-source-check.cjs',
  // 10.5 owns media-source registration in the workflow loader; keep this
  // focused guard visible in inventory until that production seam lands.
  'scripts/video-player-module-check.cjs',
])
const included = inventory.tests
  .filter((test) => test.category === 'architecture')
  .filter((test) => test.evidence.sourceShape.length > 0)
  .filter((test) => isArchitectureGuard(test.path))
  .filter((test) => !excludedPaths.has(test.path))
  .filter((test) => test.invocation !== 'inventory-only')
  .sort((left, right) => left.path.localeCompare(right.path))
const excluded = inventory.tests
  .filter((test) => test.evidence.sourceShape.length > 0)
  .filter((test) => !included.some((candidate) => candidate.path === test.path))
  .map((test) => `${test.path}: ${test.category}/${test.invocation}`)
  .sort()

function printPlan() {
  console.log('verify:architecture:source-shape included:')
  included.forEach((test, index) => console.log(`  ${index + 1}. ${test.path}`))
  console.log('verify:architecture:source-shape excluded:')
  excluded.forEach((entry) => console.log(`  - ${entry}`))
  console.log(`architecture source-shape total: ${included.length} executed, ${excluded.length} excluded`)
}

function isArchitectureGuard(relativePath) {
  const basename = path.basename(relativePath)
  return /(?:-check\.|-gate\.|-guard\.|-drain\.|-boundary\.|-facades\.|-module\.|-state\.|-owner\.|-deps\.|-refs\.|-order\.|-runtime\.|-audit\.|-migration\.|-ledger\.|^verify-)/.test(basename)
}

function run(test) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repositoryRoot, test.path)], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }))
  })
}

printPlan()
if (process.argv.includes('--list')) process.exit(0)

for (const [index, test] of included.entries()) {
  console.log(`\n[architecture ${index + 1}/${included.length}] ${test.path}`)
  const result = await run(test)
  if (result.code !== 0) {
    console.error(`verify:architecture:source-shape failed: ${test.path} exited ${result.code}${result.signal ? ` (${result.signal})` : ''}`)
    process.exit(result.code)
  }
}
console.log(`verify:architecture:source-shape passed (${included.length} checks)`)
