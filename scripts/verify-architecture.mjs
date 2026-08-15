import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inventory = JSON.parse(await readFile(path.join(repositoryRoot, 'docs', 'architecture', 'test-inventory.json'), 'utf8'))
const temporaryExclusions = new Map([
  // 10.5 owns the remaining window.__state compatibility read; keep its
  // legacy alias callable until that production migration lands.
  ['scripts/runtime-state-source-check.cjs', {
    task: '10.5',
    expectedFailure: 'should not read window.__state',
  }],
  // 10.5 owns media-source registration in the workflow loader; keep this
  // focused guard visible in inventory until that production seam lands.
  ['scripts/video-player-module-check.cjs', {
    task: '10.5',
    expectedFailure: 'workflow loader should register video availability at load time',
  }],
])
const excludedPaths = new Set([
  'scripts/test-inventory.mjs',
  'scripts/verify-architecture.mjs',
  ...temporaryExclusions.keys(),
])
const included = inventory.tests
  .filter((test) => test.aggregates?.includes('architecture:source-shape'))
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

function probeTemporaryExclusion(relativePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repositoryRoot, relativePath)], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal, output }))
  })
}

printPlan()
if (process.argv.includes('--list')) process.exit(0)

for (const [relativePath, exclusion] of temporaryExclusions) {
  const result = await probeTemporaryExclusion(relativePath)
  if (result.code === 0) {
    console.error(`verify:architecture:source-shape exclusion expired: ${relativePath} now passes; remove its task ${exclusion.task} exclusion`)
    process.exit(1)
  }
  if (!result.output.includes(exclusion.expectedFailure)) {
    console.error(`verify:architecture:source-shape exclusion drifted: ${relativePath} no longer fails for task ${exclusion.task}'s documented reason`)
    process.exit(1)
  }
}

for (const [index, test] of included.entries()) {
  console.log(`\n[architecture ${index + 1}/${included.length}] ${test.path}`)
  const result = await run(test)
  if (result.code !== 0) {
    console.error(`verify:architecture:source-shape failed: ${test.path} exited ${result.code}${result.signal ? ` (${result.signal})` : ''}`)
    process.exit(result.code)
  }
}
console.log(`verify:architecture:source-shape passed (${included.length} checks)`)
