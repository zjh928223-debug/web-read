import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-python-gates-'))

const listEnvironment = { ...process.env }
for (const name of ['READ_WEB_PREVIOUS_RELEASE_ROOT', 'READ_WEB_PREVIOUS_RELEASE_MANIFEST', 'READ_WEB_PREVIOUS_RELEASE_SOURCE']) {
  delete listEnvironment[name]
}
const listed = spawnSync(process.execPath, ['scripts/verify-release.mjs', '--list'], {
  cwd: repoRoot,
  env: listEnvironment,
  encoding: 'utf8',
  windowsHide: true,
})
assert.notEqual(listed.status, 0, 'verify-release --list must block when no previous release source is configured')
assert.match(`${listed.stdout}\n${listed.stderr}`, /BLOCKED|PREVIOUS_SOURCE|preflight/i)
assert.doesNotMatch(`${listed.stdout}\n${listed.stderr}`, /status:\s*READY/i)

const { resolvePreviousReleaseSource } = await import('./lib/release-manifest.mjs')
const legacyRoot = path.join(tempRoot, 'legacy')
const legacyManifestPath = path.join(tempRoot, 'legacy-manifest.json')
await mkdir(legacyRoot, { recursive: true })
await writeFile(path.join(legacyRoot, 'index.html'), 'legacy')
await assert.rejects(
  resolvePreviousReleaseSource({ previousRoot: legacyRoot }),
  (error) => error?.code === 'RELEASE_PREVIOUS_SOURCE_INCOMPLETE' && /Python lock/i.test(error.message),
  'a legacy root without the production Python lock must be rejected rather than synthesized',
)

const previousRoot = path.join(tempRoot, 'previous')
await mkdir(previousRoot, { recursive: true })
await writeFile(path.join(previousRoot, 'index.html'), 'previous')
await writeFile(path.join(previousRoot, 'package-lock.json'), '{"lockfileVersion":3}')
await writeFile(path.join(previousRoot, 'requirements-service.lock'), 'fastapi==0.1.0 --hash=sha256:' + '0'.repeat(64))
const previousManifest = fixtureManifest(previousRoot, 'previous-release')
await writeFile(legacyManifestPath, `${JSON.stringify(previousManifest, null, 2)}\n`)
const before = await readFile(legacyManifestPath)
const protectedFiles = ['index.html', 'package-lock.json', 'requirements-service.lock']
const protectedBefore = new Map(await Promise.all(protectedFiles.map(async (name) => [name, await readFile(path.join(previousRoot, name))])))
const source = await resolvePreviousReleaseSource({ previousManifest: legacyManifestPath })
assert.equal(source.kind, 'manifest')
assert.equal(source.readOnly, true)
assert.equal(source.manifest.release.releaseId, 'previous-release')
assert.equal(source.manifestSha256, sha256(before))
assert.deepEqual(source.manifestBytes, before, 'previous manifest bytes must be preserved for downstream health/rollback identity')
assert.deepEqual(await readFile(legacyManifestPath), before, 'previous manifest input must remain read-only')
for (const [name, bytes] of protectedBefore) assert.deepEqual(await readFile(path.join(previousRoot, name)), bytes, `previous source file was changed: ${name}`)

const mismatchedIdentity = structuredClone(previousManifest)
mismatchedIdentity.source.manifestSha256 = 'f'.repeat(64)
const mismatchedIdentityPath = path.join(tempRoot, 'mismatched-identity.json')
await writeFile(mismatchedIdentityPath, `${JSON.stringify(mismatchedIdentity)}\n`)
await assert.rejects(
  resolvePreviousReleaseSource({ previousManifest: mismatchedIdentityPath }),
  (error) => error?.code === 'RELEASE_PREVIOUS_MANIFEST_IDENTITY_MISMATCH',
  'a previous manifest with a forged self-reported manifest hash must fail closed',
)

const incomplete = structuredClone(previousManifest)
delete incomplete.source
await writeFile(path.join(tempRoot, 'incomplete.json'), `${JSON.stringify(incomplete)}\n`)
await assert.rejects(
  resolvePreviousReleaseSource({ previousManifest: path.join(tempRoot, 'incomplete.json') }),
  /schema validation|source/i,
  'an incomplete previous manifest must fail closed',
)

const incompleteIdentity = structuredClone(previousManifest)
delete incompleteIdentity.runtime.pythonIdentity
await writeFile(path.join(tempRoot, 'incomplete-identity.json'), `${JSON.stringify(incompleteIdentity)}\n`)
await assert.rejects(
  resolvePreviousReleaseSource({ previousManifest: path.join(tempRoot, 'incomplete-identity.json') }),
  /immutable previous releases require a verified Python environment|schema validation/i,
  'a previous manifest without verified Python identity must fail closed',
)

const legacyMarked = structuredClone(previousManifest)
legacyMarked.source.kind = 'legacy-root'
await writeFile(path.join(tempRoot, 'legacy-marked-manifest.json'), `${JSON.stringify(legacyMarked)}\n`)
await assert.rejects(
  resolvePreviousReleaseSource({ previousManifest: path.join(tempRoot, 'legacy-marked-manifest.json') }),
  (error) => error?.code === 'RELEASE_PREVIOUS_SOURCE_NOT_IMMUTABLE',
  'a manifest carrying a legacy-root source marker must not be accepted as a formal previous release',
)

const statePath = path.join(tempRoot, 'state.json')
const currentRoot = path.join(tempRoot, 'current')
await mkdir(currentRoot, { recursive: true })
await writeFile(path.join(currentRoot, 'index.html'), 'current')
await writeFile(path.join(currentRoot, 'package-lock.json'), '{"lockfileVersion":3}')
await writeFile(path.join(currentRoot, 'requirements-service.lock'), 'fastapi==0.1.0 --hash=sha256:' + '0'.repeat(64))
const currentManifest = fixtureManifest(currentRoot, 'current-release')
await writeFile(path.join(tempRoot, 'current.json'), `${JSON.stringify(currentManifest, null, 2)}\n`)
await writeFile(statePath, JSON.stringify({
  schema: 'read-web.release-state',
  schemaVersion: 1,
  status: 'staged',
  active: {
    manifest: 'current.json',
    root: currentRoot,
    releaseId: 'wrong-current-id',
    manifestSha256: '0'.repeat(64),
  },
  previous: {
    manifest: 'legacy-manifest.json',
    root: previousRoot,
    releaseId: 'previous-release',
    manifestSha256: source.manifestSha256,
  },
}, null, 2))
const rollback = spawnSync(process.execPath, ['scripts/release-rollback.mjs', '--state', statePath], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
})
assert.notEqual(rollback.status, 0, 'rollback must reject state descriptors whose identity does not match the manifest')
assert.match(`${rollback.stdout}\n${rollback.stderr}`, /identity|releaseId|manifestSha256/i)

console.log('release/python gate regression checks passed')

function fixtureManifest(root, releaseId) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    role: 'previous-release',
    source: {
      kind: 'manifest',
      readOnly: true,
      provenance: 'fixture release capture',
    },
    release: {
      releaseId,
      formatVersion: 2,
      application: 'fixture',
      frontendVersion: '1.0.0',
      productionHostVersion: '0.2.3',
      backendVersion: '0.2.3',
      gitSha: releaseId,
      gitBranch: 'fixture',
      dirty: false,
      root,
    },
    runtime: {
      node: process.version,
      npm: '11.8.0',
      python: 'Python 3.10.10',
      dataRoot: null,
      sourceSha256: 'a'.repeat(64),
      distSha256: 'b'.repeat(64),
      toolchainSha256: 'c'.repeat(64),
      pythonIdentity: {
        status: 'verified',
        executable: 'C:/fixture/python.exe',
        version: '3.10.10',
        packageSetSha256: 'd'.repeat(64),
        environmentSha256: 'e'.repeat(64),
      },
    },
    dependencyLocks: {
      node: { path: 'package-lock.json', sha256: sha256(Buffer.from('{"lockfileVersion":3}')), kind: 'npm', lockfileVersion: 3, status: 'verified' },
      python: { path: 'requirements-service.lock', sha256: sha256(Buffer.from('fastapi==0.1.0 --hash=sha256:' + '0'.repeat(64))), kind: 'pip-require-hashes', requireHashLines: 1, pythonPolicy: '3.10', status: 'verified' },
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
      rollback: { minimumSchemaVersion: 1, maximumSchemaVersion: 1, reversible: true, dataPreserving: true },
    },
    compatibility: {
      migration: { fromSchemaVersion: 1, toSchemaVersion: 1, dryRun: true, reversible: true },
      rollback: { minimumReleaseFormatVersion: 2, maximumReleaseFormatVersion: 2, compatible: true, dataPreserving: true, reversible: true },
    },
    artifacts: [
      { path: 'index.html', bytes: root.endsWith('previous') ? 8 : 7, sha256: sha256(Buffer.from(root.endsWith('previous') ? 'previous' : 'current')) },
      { path: 'package-lock.json', bytes: 22, sha256: sha256(Buffer.from('{"lockfileVersion":3}')) },
      { path: 'requirements-service.lock', bytes: 84, sha256: sha256(Buffer.from('fastapi==0.1.0 --hash=sha256:' + '0'.repeat(64))) },
    ],
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
