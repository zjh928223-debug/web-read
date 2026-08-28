import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { classifyExternalToolProbe, isReusablePublishedRelease, verifyReleaseManifest } from './lib/release-manifest.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-control-'))
const currentRoot = path.join(root, 'current')
const previousRoot = path.join(root, 'previous')
await Promise.all([
  mkdir(path.join(currentRoot, 'dist'), { recursive: true }),
  mkdir(path.join(currentRoot, 'tools', 'subtitle-workflow'), { recursive: true }),
  mkdir(path.join(previousRoot, 'dist'), { recursive: true }),
  mkdir(path.join(previousRoot, 'tools', 'subtitle-workflow'), { recursive: true }),
])
await Promise.all([
  writeFile(path.join(currentRoot, 'dist', 'index.html'), 'current'),
  writeFile(path.join(previousRoot, 'dist', 'index.html'), 'previous'),
  writeFile(path.join(currentRoot, 'package-lock.json'), '{"lockfileVersion":3}'),
  writeFile(path.join(previousRoot, 'package-lock.json'), '{"lockfileVersion":3}'),
  writeFile(path.join(currentRoot, 'tools', 'subtitle-workflow', 'requirements-service.lock'), 'fastapi==0.1.0 --hash=sha256:' + '0'.repeat(64)),
  writeFile(path.join(previousRoot, 'tools', 'subtitle-workflow', 'requirements-service.lock'), 'fastapi==0.1.0 --hash=sha256:' + '0'.repeat(64)),
])
const currentManifest = await manifest(currentRoot, 'current')
const previousManifest = await manifest(previousRoot, 'previous')
const currentManifestBytes = Buffer.from(JSON.stringify(currentManifest))
const previousManifestBytes = Buffer.from(JSON.stringify(previousManifest))
await Promise.all([
  writeFile(path.join(root, 'current.json'), currentManifestBytes),
  writeFile(path.join(root, 'previous.json'), previousManifestBytes),
  writeFile(path.join(root, 'state.json'), JSON.stringify({
    schema: 'read-web.release-state', schemaVersion: 1, status: 'active',
    active: { manifest: 'current.json', root: currentRoot, releaseId: 'current', manifestSha256: createHash('sha256').update(currentManifestBytes).digest('hex') },
    previous: { manifest: 'previous.json', root: previousRoot, releaseId: 'previous', manifestSha256: createHash('sha256').update(previousManifestBytes).digest('hex') },
  })),
])

const stagedCandidate = structuredClone(currentManifest)
stagedCandidate.role = 'candidate'
stagedCandidate.source = { kind: 'working-tree', readOnly: false, provenance: 'current Git worktree' }
stagedCandidate.release.root = path.join(root, 'staged-candidate')
const publishedRoot = currentRoot
const publishedCandidate = structuredClone(stagedCandidate)
publishedCandidate.generatedAt = '2030-01-01T00:00:00.000Z'
publishedCandidate.role = 'published-release'
publishedCandidate.source = { kind: 'immutable-release', readOnly: true, provenance: 'published release snapshot' }
publishedCandidate.release.root = publishedRoot
const publishedManifestPath = path.join(root, 'published.json')
await writeFile(publishedManifestPath, JSON.stringify(publishedCandidate))
const verifiedPublished = await verifyReleaseManifest(publishedManifestPath)
assert.equal(verifiedPublished.passed, true, 'published release fixture must pass integrity verification')
assert.equal(isReusablePublishedRelease(verifiedPublished, stagedCandidate, publishedRoot), true, 'an identical candidate must reuse its verified published release')

const artifactChangedCandidate = structuredClone(stagedCandidate)
artifactChangedCandidate.artifacts[0].sha256 = 'c'.repeat(64)
assert.equal(isReusablePublishedRelease(verifiedPublished, artifactChangedCandidate, publishedRoot), false, 'an artifact identity change must reject published release reuse')
const toolchainChangedCandidate = structuredClone(stagedCandidate)
toolchainChangedCandidate.runtime.toolchainSha256 = 'd'.repeat(64)
assert.equal(isReusablePublishedRelease(verifiedPublished, toolchainChangedCandidate, publishedRoot), false, 'a toolchain identity change must reject published release reuse')
const lockChangedCandidate = structuredClone(stagedCandidate)
lockChangedCandidate.dependencyLocks.python.sha256 = 'e'.repeat(64)
assert.equal(isReusablePublishedRelease(verifiedPublished, lockChangedCandidate, publishedRoot), false, 'a dependency lock identity change must reject published release reuse')

const initialHealth = JSON.parse(execFileSync(process.execPath, ['scripts/release-health-check.mjs', '--manifest', path.join(root, 'current.json')], { cwd: process.cwd(), encoding: 'utf8' }))
const initialState = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'))
assert.equal(initialHealth.status, 'passed')
assert.equal(initialHealth.manifestSha256, initialState.active.manifestSha256, 'health and active rollback identity must use the same manifest SHA')
assert.equal(currentManifest.release.releaseId, initialState.active.releaseId, 'health and active rollback identity must use the same releaseId')
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
const rollbackHealth = JSON.parse(execFileSync(process.execPath, ['scripts/release-health-check.mjs', '--manifest', path.join(root, 'previous.json')], { cwd: process.cwd(), encoding: 'utf8' }))
assert.equal(rollbackHealth.status, 'passed')
assert.equal(rollbackHealth.manifestSha256, rolledBack.active.manifestSha256, 'rollback target health and active identity must use the same manifest SHA')

await writeFile(path.join(previousRoot, 'dist', 'index.html'), 'corrupt')
const rejected = spawnSync(process.execPath, ['scripts/release-health-check.mjs', '--manifest', path.join(root, 'previous.json')], { cwd: process.cwd(), encoding: 'utf8' })
assert.notEqual(rejected.status, 0, 'checksum mismatch must fail health check')
console.log('release manifest health and rollback checks passed')

async function manifest(releaseRoot, gitSha) {
  const bytes = await readFile(path.join(releaseRoot, 'dist', 'index.html'))
  const packageLock = await readFile(path.join(releaseRoot, 'package-lock.json'))
  const pythonLock = await readFile(path.join(releaseRoot, 'tools', 'subtitle-workflow', 'requirements-service.lock'))
  const hash = (value) => createHash('sha256').update(value).digest('hex')
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    role: 'fixture',
    source: { kind: 'manifest', readOnly: true, provenance: 'release-control fixture capture' },
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
      toolchainSha256: 'e'.repeat(64),
      pythonIdentity: {
        status: 'verified',
        executable: 'C:/fixture/python.exe',
        version: '3.10.10',
        packageSetSha256: 'f'.repeat(64),
        environmentSha256: '1'.repeat(64),
      },
    },
    dependencyLocks: {
      node: { path: 'package-lock.json', sha256: hash(packageLock), kind: 'npm', lockfileVersion: 3, status: 'verified' },
      python: { path: 'tools/subtitle-workflow/requirements-service.lock', sha256: hash(pythonLock), kind: 'pip-require-hashes', requireHashLines: 1, pythonPolicy: '3.10', status: 'verified' },
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
    artifacts: [
      { path: 'dist/index.html', bytes: bytes.length, sha256: hash(bytes) },
      { path: 'package-lock.json', bytes: packageLock.length, sha256: hash(packageLock) },
      { path: 'tools/subtitle-workflow/requirements-service.lock', bytes: pythonLock.length, sha256: hash(pythonLock) },
    ],
  }
}

function run(script, args) {
  execFileSync(process.execPath, [script, ...args], { cwd: process.cwd(), stdio: 'pipe' })
}
