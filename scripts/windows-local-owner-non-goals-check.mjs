import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  FROZEN_IDB_SCHEMA,
  REPOSITORY_ROOT,
  assert,
  readArtifact,
  readJson,
  sha256File,
} from './lib/windows-local-owner-artifacts.mjs'

const nonGoals = await readArtifact('non-goals.json')
const environment = await readArtifact('environment-baseline.json')

assert(nonGoals.implementationStatus === 'milestone-contract-and-baseline-only', 'non-goal guard must remain contract/baseline-only')
assert(JSON.stringify(nonGoals.frozenIndexedDbSchema.databaseName) === JSON.stringify(FROZEN_IDB_SCHEMA.databaseName), 'IndexedDB database name changed')
assert(nonGoals.frozenIndexedDbSchema.version === FROZEN_IDB_SCHEMA.version, 'IndexedDB version changed')
assert(nonGoals.frozenIndexedDbSchema.objectStore === FROZEN_IDB_SCHEMA.objectStore, 'IndexedDB object store changed')
assert(nonGoals.frozenIndexedDbSchema.keyPath === FROZEN_IDB_SCHEMA.keyPath, 'IndexedDB key path changed')

const runtimeConfig = await readJson('config/runtime.optimization.json')
assert(runtimeConfig.frontend?.host === '127.0.0.1', 'optimization frontend must remain loopback')
assert(runtimeConfig.frontend?.port === 5184, 'optimization frontend port must remain 5184')
assert(runtimeConfig.backend?.host === '127.0.0.1', 'optimization backend must remain loopback')
assert(runtimeConfig.backend?.port === 8776, 'optimization backend port must remain 8776')
assert(runtimeConfig.dataRoot === 'E:\\ReadWebData\\SubtitleWorkflow-Optimization', 'optimization data root changed')
assert(environment.runtimeConfig?.configSha256 !== 'sha256:recorded-by-contract-check', 'environment config checksum was not finalized')

const indexSource = await readFile(path.join(REPOSITORY_ROOT, 'index.html'), 'utf8')
const scriptSequence = [...indexSource.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/giu)]
  .map((match) => match[1])
assert(JSON.stringify(scriptSequence) === JSON.stringify(nonGoals.scriptLoadOrder.sequence), 'index.html script load order changed')

for (const file of nonGoals.protectedWorkingTreeFiles) {
  assert(await sha256File(file.path) === file.sha256AtCapture, `protected user file changed: ${file.path}`)
  assert(!stagedFiles().includes(file.path), `protected user file is staged: ${file.path}`)
}
for (const file of nonGoals.frozenSourceFiles) {
  assert(await sha256File(file.path) === file.sha256AtCapture, `frozen schema source changed: ${file.path}`)
}

const forbiddenText = JSON.stringify(nonGoals.forbiddenCapabilities)
assert(forbiddenText.includes('Mac owner implementation'), 'Mac non-goal missing')
assert(forbiddenText.includes('Tailscale transport'), 'Tailscale non-goal missing')
assert(forbiddenText.includes('non-loopback bind or transport'), 'non-loopback non-goal missing')
assert(nonGoals.dataPolicy.dailyDataRoot === 'E:\\ReadWebData\\SubtitleWorkflow', 'daily data root guard missing')
assert(nonGoals.dataPolicy.protectedTrees.includes('E:\\read-web-next'), 'protected daily reader guard missing')
assert(nonGoals.dataPolicy.protectedTrees.includes('E:\\read-web'), 'protected historical tree guard missing')

console.log('windows local owner non-goal/schema guard passed')

function stagedFiles() {
  return execFileSync('git', ['diff', '--cached', '--name-only'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  })
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean)
}
