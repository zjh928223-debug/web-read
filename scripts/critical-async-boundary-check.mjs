import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inventory = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/architecture/critical-async-inventory.json'), 'utf8'))
assert.equal(inventory.schemaVersion, 1)
assert.deepEqual(inventory.criticalPaths, [...inventory.criticalPaths].sort(), 'critical paths must stay sorted')
assert.deepEqual(inventory.requiredBestEffortOperations, [...inventory.requiredBestEffortOperations].sort(), 'operations must stay sorted')

const sources = inventory.criticalPaths.map((relativePath) => {
  const absolutePath = path.join(repoRoot, relativePath)
  assert.ok(fs.existsSync(absolutePath), `${relativePath} must exist`)
  return { relativePath, source: fs.readFileSync(absolutePath, 'utf8') }
})
const combined = sources.map(({ source }) => source).join('\n')

for (const { relativePath, source } of sources) {
  assert.doesNotMatch(source, /catch\s*(?:\([^)]*\))?\s*\{\s*\}/u, `${relativePath} must not contain an empty catch`)
  assert.doesNotMatch(source, /\.catch\(\s*\(?(?:[^)]*)\)?\s*=>\s*\{?\s*\}?\s*\)/u, `${relativePath} must not contain an empty promise catch`)
  assert.doesNotMatch(source, /\bvoid\s+[A-Za-z_$][\w$]*(?:\.|\()/u, `${relativePath} must not mark promises handled with void`)
}

for (const operationId of inventory.requiredBestEffortOperations) {
  assert.ok(combined.includes(`operationId: '${operationId}'`), `${operationId} must have an explicit observed best-effort policy`)
}

console.log(`critical async boundary passed (${sources.length} critical paths, ${inventory.requiredBestEffortOperations.length} recorded best-effort policies)`)
