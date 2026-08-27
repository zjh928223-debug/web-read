import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { classifyExternalToolProbe } from './lib/release-manifest.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-control-'))
const currentRoot = path.join(root, 'current')
const previousRoot = path.join(root, 'previous')
await Promise.all([mkdir(currentRoot), mkdir(previousRoot)])
await Promise.all([writeFile(path.join(currentRoot, 'index.html'), 'current'), writeFile(path.join(previousRoot, 'index.html'), 'previous')])
const currentManifest = await manifest(currentRoot, 'current')
const previousManifest = await manifest(previousRoot, 'previous')
await Promise.all([
  writeFile(path.join(root, 'current.json'), JSON.stringify(currentManifest)),
  writeFile(path.join(root, 'previous.json'), JSON.stringify(previousManifest)),
  writeFile(path.join(root, 'state.json'), JSON.stringify({
    schema: 'read-web.release-state', schemaVersion: 1, status: 'active',
    active: { manifest: 'current.json', root: currentRoot, releaseId: 'current' },
    previous: { manifest: 'previous.json', root: previousRoot, releaseId: 'previous' },
  })),
])

run('scripts/release-health-check.mjs', ['--manifest', path.join(root, 'current.json')])
const arbitraryOutput = classifyExternalToolProbe('ffmpeg', { exitCode: 0, stdout: 'command completed successfully', stderr: '' })
assert.equal(arbitraryOutput.status, 'degraded')
assert.equal(arbitraryOutput.compatibility.status, 'invalid-output')
const unsupportedOutput = classifyExternalToolProbe('ffmpeg', { exitCode: 0, stdout: 'ffmpeg version 3.0.0', stderr: '' })
assert.equal(unsupportedOutput.status, 'degraded')
assert.equal(unsupportedOutput.compatibility.status, 'unsupported-version')
const supportedOutput = classifyExternalToolProbe('ffmpeg', { exitCode: 0, stdout: 'ffmpeg version 7.1.1', stderr: '' })
assert.equal(supportedOutput.status, 'verified')
assert.equal(supportedOutput.compatibility.status, 'supported')
const failedOutput = classifyExternalToolProbe('ffmpeg', { exitCode: 2, stdout: 'ffmpeg version 7.1.1', stderr: 'probe failed' })
assert.equal(failedOutput.status, 'degraded')
assert.equal(failedOutput.compatibility.status, 'probe-failed')
const schemaManifest = JSON.parse(await readFile(path.join(root, 'current.json'), 'utf8'))
const semanticInvalidManifest = structuredClone(schemaManifest)
semanticInvalidManifest.externalTools.ffmpeg.status = 'verified'
await writeFile(path.join(root, 'current-invalid-tool-status.json'), JSON.stringify(semanticInvalidManifest))
const semanticRejected = spawnSync(process.execPath, ['scripts/release-health-check.mjs', '--manifest', path.join(root, 'current-invalid-tool-status.json')], { cwd: process.cwd(), encoding: 'utf8' })
assert.notEqual(semanticRejected.status, 0, 'release verifier must reject verified external tools whose support state is not supported')
schemaManifest.dataCompatibility.indexedDb.keyPath = 'wrong-key-path'
await writeFile(path.join(root, 'current-invalid-schema.json'), JSON.stringify(schemaManifest))
const schemaRejected = spawnSync(process.execPath, ['scripts/release-health-check.mjs', '--manifest', path.join(root, 'current-invalid-schema.json')], { cwd: process.cwd(), encoding: 'utf8' })
assert.notEqual(schemaRejected.status, 0, 'release verifier must execute the manifest schema, not only checksum checks')
run('scripts/release-rollback.mjs', ['--state', path.join(root, 'state.json')])
run('scripts/release-rollback.mjs', ['--state', path.join(root, 'state.json'), '--apply'])
const rolledBack = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'))
assert.equal(rolledBack.status, 'rolled-back')
assert.equal(rolledBack.active.releaseId, 'previous')

await writeFile(path.join(previousRoot, 'index.html'), 'corrupt')
const rejected = spawnSync(process.execPath, ['scripts/release-health-check.mjs', '--manifest', path.join(root, 'previous.json')], { cwd: process.cwd(), encoding: 'utf8' })
assert.notEqual(rejected.status, 0, 'checksum mismatch must fail health check')
console.log('release manifest health and rollback checks passed')

async function manifest(releaseRoot, gitSha) {
  const bytes = await readFile(path.join(releaseRoot, 'index.html'))
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    role: 'fixture',
    release: {
      releaseId: gitSha,
      formatVersion: 2,
      application: 'fixture',
      frontendVersion: '1.0.0',
      productionHostVersion: '0.2.3',
      backendVersion: '0.2.3',
      gitSha,
      gitBranch: 'fixture',
      dirty: false,
      root: releaseRoot,
    },
    runtime: {
      node: process.version,
      npm: 'fixture',
      python: 'Python fixture',
      dataRoot: null,
      sourceSha256: 'a'.repeat(64),
      distSha256: 'b'.repeat(64),
    },
    dependencyLocks: {
      node: { path: 'package-lock.json', sha256: 'c'.repeat(64), kind: 'npm', lockfileVersion: 3 },
      python: { path: 'requirements-service.lock', sha256: 'd'.repeat(64), kind: 'pip-require-hashes', requireHashLines: 1 },
    },
    externalTools: Object.fromEntries(['ffmpeg', 'ytDlp', 'whisperx'].map((name) => [name, {
      executable: name,
      version: null,
      versionLine: null,
      sha256: null,
      source: 'fixture',
      verification: '--version',
      required: false,
      status: 'missing',
      supportMatrix: `${name}-fixture-matrix`,
      compatibility: {
        matrix: `${name}-fixture-matrix`,
        status: 'missing',
        supported: false,
        reason: 'fixture-executable-not-present',
      },
    }])),
    configuration: { schemaVersion: 1, minimumCompatible: 1, maximumCompatible: 1 },
    dataCompatibility: {
      indexedDb: { name: 'SeekPlayerDB', version: 1, objectStore: 'files', keyPath: 'id' },
      workflowServiceVersion: '0.2.3',
      migration: { minimumSchemaVersion: 1, maximumSchemaVersion: 1, dryRunRequired: true, reversible: true },
      rollback: { minimumSchemaVersion: 1, maximumSchemaVersion: 1, reversible: true },
    },
    compatibility: {
      migration: { fromSchemaVersion: 1, toSchemaVersion: 1, dryRun: true, reversible: true },
      rollback: { minimumReleaseFormatVersion: 2, maximumReleaseFormatVersion: 2, compatible: true, dataPreserving: true, reversible: true },
    },
    artifacts: [{ path: 'index.html', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }],
  }
}

function run(script, args) {
  execFileSync(process.execPath, [script, ...args], { cwd: process.cwd(), stdio: 'pipe' })
}
