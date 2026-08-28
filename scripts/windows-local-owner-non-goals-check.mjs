import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  FROZEN_IDB_SCHEMA,
  REPOSITORY_ROOT,
  aggregateIndexedDbSchemaSemantics,
  assert,
  indexedDbSchemaSemanticDiff,
  indexedDbSchemaSemanticFingerprint,
  normalizeRepositoryPath,
  readArtifact,
  readJson,
  protectedPathViolations,
} from './lib/windows-local-owner-artifacts.mjs'

const nonGoals = await readArtifact('non-goals.json')
const environment = await readArtifact('environment-baseline.json')

assert(nonGoals.implementationStatus === 'milestone-contract-and-baseline-only', 'non-goal guard must remain contract/baseline-only')
assert(JSON.stringify(nonGoals.frozenIndexedDbSchema.databaseName) === JSON.stringify(FROZEN_IDB_SCHEMA.databaseName), 'IndexedDB database name changed')
assert(nonGoals.frozenIndexedDbSchema.version === FROZEN_IDB_SCHEMA.version, 'IndexedDB version changed')
assert(nonGoals.frozenIndexedDbSchema.objectStore === FROZEN_IDB_SCHEMA.objectStore, 'IndexedDB object store changed')
assert(nonGoals.frozenIndexedDbSchema.keyPath === FROZEN_IDB_SCHEMA.keyPath, 'IndexedDB key path changed')
assert(nonGoals.frozenSchemaSourcePolicy?.comparison === 'semantic-fingerprint-only', 'schema source guard must remain semantic-only')

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

const milestoneBaseCommit = environment.workspace?.head
assert(milestoneBaseCommit === '491bd8a718a82faf9659a460b9b817c69c18eeb0', 'milestone base commit changed')
assertGitAncestor(milestoneBaseCommit)

const protectedPaths = nonGoals.protectedWorkingTreeFiles.map((file) => {
  assert(/^sha256:[0-9a-f]{64}$/u.test(file.sha256AtCapture), `invalid historical capture checksum: ${file.path}`)
  return normalizeRepositoryPath(file.path)
})
const pathViolations = protectedPathViolations({
  milestonePaths: gitNameOnly(['diff', '--name-only', `${milestoneBaseCommit}...HEAD`]),
  stagedPaths: gitNameOnly(['diff', '--cached', '--name-only']),
  protectedPaths,
})
assert(pathViolations.length === 0, `protected user paths entered milestone commits or index: ${pathViolations.join(', ')}`)

const capturedSchemaFingerprints = []
const currentSchemaFingerprints = []
for (const file of nonGoals.frozenSourceFiles) {
  const currentSource = await readCurrentSource(file.path)
  const capturedSource = gitShow(milestoneBaseCommit, file.path)
  capturedSchemaFingerprints.push(indexedDbSchemaSemanticFingerprint(capturedSource))
  currentSchemaFingerprints.push(indexedDbSchemaSemanticFingerprint(currentSource))
}
const capturedSchemaSemantics = aggregateIndexedDbSchemaSemantics(capturedSchemaFingerprints)
const schemaSemantics = aggregateIndexedDbSchemaSemantics(currentSchemaFingerprints)
const schemaDifferences = indexedDbSchemaSemanticDiff(capturedSchemaSemantics, schemaSemantics)
assert(schemaDifferences.length === 0, `frozen IndexedDB schema semantics changed: ${schemaDifferences.join('; ')}`)
assert(schemaSemantics.databaseNames.includes(FROZEN_IDB_SCHEMA.databaseName), 'SeekPlayerDB semantic identity missing')
assert(schemaSemantics.versions.includes(String(FROZEN_IDB_SCHEMA.version)), 'SeekPlayerDB version 1 semantic identity missing')
assert(schemaSemantics.storeNames.includes(FROZEN_IDB_SCHEMA.objectStore), 'files object store semantic identity missing')
assert(schemaSemantics.keyPaths.includes(FROZEN_IDB_SCHEMA.keyPath), 'files keyPath id semantic identity missing')

const forbiddenText = JSON.stringify(nonGoals.forbiddenCapabilities)
assert(forbiddenText.includes('Mac owner implementation'), 'Mac non-goal missing')
assert(forbiddenText.includes('Tailscale transport'), 'Tailscale non-goal missing')
assert(forbiddenText.includes('non-loopback bind or transport'), 'non-loopback non-goal missing')
assert(nonGoals.dataPolicy.dailyDataRoot === 'E:\\ReadWebData\\SubtitleWorkflow', 'daily data root guard missing')
assert(nonGoals.dataPolicy.protectedTrees.includes('E:\\read-web-next'), 'protected daily reader guard missing')
assert(nonGoals.dataPolicy.protectedTrees.includes('E:\\read-web'), 'protected historical tree guard missing')

console.log('windows local owner non-goal/schema guard passed (path exclusion + semantic IndexedDB freeze)')

function gitNameOnly(args) {
  return execFileSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  })
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean)
}

function gitShow(commit, relativePath) {
  return execFileSync('git', ['show', `${commit}:${normalizeRepositoryPath(relativePath)}`], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  })
}

function assertGitAncestor(commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
      cwd: REPOSITORY_ROOT,
      stdio: 'ignore',
    })
  } catch {
    assert(false, `milestone base commit is not an ancestor of HEAD: ${commit}`)
  }
}

async function readCurrentSource(relativePath) {
  try {
    return await readFile(path.join(REPOSITORY_ROOT, relativePath), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}
