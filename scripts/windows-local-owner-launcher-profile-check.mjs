import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  createReadWebProductionBackupComposition,
  initializeIsolatedBrowserProfileIfMissing,
} from './lib/read-web-production-backup.mjs'

const execFile = promisify(execFileCallback)
const repositoryRoot = path.resolve(import.meta.dirname, '..')
const initializerScript = path.join(repositoryRoot, 'scripts', 'initialize-optimization-application-profile.mjs')

const optimizationLauncherSource = await readFile(
  path.join(repositoryRoot, 'scripts', 'optimization-launch-runtime.psm1'),
  'utf8',
)
const previewLauncherSource = await readFile(
  path.join(repositoryRoot, 'scripts', 'launch-optimization-preview.ps1'),
  'utf8',
)
const startPairOffset = optimizationLauncherSource.indexOf('function Start-OptimizationOwnedPair')
const profileInitializationOffset = optimizationLauncherSource.indexOf(
  'Initialize-OptimizationApplicationProfile',
  startPairOffset,
)
const firstChildStartOffset = optimizationLauncherSource.indexOf(
  'Start-ManagedRuntimeInstance',
  startPairOffset,
)
const authorityRootParameterOffset = optimizationLauncherSource.indexOf(
  '[Parameter(Mandatory)][string]$ApplicationProfileAuthorityRoot',
  startPairOffset,
)
const authorityRootArgumentOffset = optimizationLauncherSource.indexOf(
  "'--application-profile-authority-root', $ApplicationProfileAuthorityRoot",
  startPairOffset,
)
assert.ok(startPairOffset >= 0, 'owned-pair launcher function is missing')
assert.ok(profileInitializationOffset > startPairOffset, 'owned-pair launcher does not initialize the application profile')
assert.ok(profileInitializationOffset < firstChildStartOffset, 'profile initialization must precede owned child startup')
assert.ok(authorityRootParameterOffset > startPairOffset, 'owned-pair launcher must accept a stable profile authority root')
assert.ok(authorityRootArgumentOffset > firstChildStartOffset, 'production Host must receive the stable profile authority root')
assert.match(optimizationLauncherSource, /\[string\]\$ApplicationProfileLeaseMode = 'authoritative'/)
assert.match(optimizationLauncherSource, /\[ValidateSet\('authoritative', 'standby-if-busy'\)\]/)
assert.match(optimizationLauncherSource, /standbyPreflight/)
assert.match(optimizationLauncherSource, /profileLeaseMode.*authoritative/)
assert.match(previewLauncherSource, /Start-OptimizationOwnedPair/)
assert.match(previewLauncherSource, /-ApplicationProfileDir \$newApplicationProfileDir/)
assert.match(previewLauncherSource, /\$applicationProfileAuthorityRoot = Join-Path \$applicationProfileAuthorityIsolationRoot "profiles\\\$profileId"/)
assert.match(previewLauncherSource, /-ApplicationProfileAuthorityRoot \$applicationProfileAuthorityRoot/)
assert.match(previewLauncherSource, /-ApplicationProfileAuthorityIsolationRoot \$applicationProfileAuthorityIsolationRoot/)
assert.match(previewLauncherSource, /candidate-standby-ready/)
assert.match(previewLauncherSource, /old-host-released/)
assert.match(previewLauncherSource, /promotion-starting/)
assert.match(previewLauncherSource, /oldHostReleasedForPromotion/)
assert.match(previewLauncherSource, /Start-OptimizationHostFromSnapshot/)
assert.match(previewLauncherSource, /-ApplicationProfileLeaseMode 'standby-if-busy'/)
assert.match(previewLauncherSource, /-ApplicationProfileLeaseMode 'authoritative'/)
assert.match(previewLauncherSource, /-AllowStandbyReadiness/)
assert.match(previewLauncherSource, /profileLeaseMode.*authoritative/)
const standbyPhaseOffset = previewLauncherSource.indexOf("Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'candidate-standby-ready'")
const targetPendingOffset = previewLauncherSource.indexOf("Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'target-pending'")
const promotionReadyOffset = previewLauncherSource.indexOf("Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'promotion-ready'")
assert.ok(standbyPhaseOffset >= 0, 'launcher must record standby preflight before handoff')
assert.ok(promotionReadyOffset > standbyPhaseOffset, 'launcher must record promotion readiness after standby preflight')
assert.ok(targetPendingOffset > promotionReadyOffset, 'front-door target cannot be pending before authoritative promotion')

function fixtureOptions(root) {
  const instanceRoot = path.join(root, 'instances', 'fixture-instance')
  return {
    isolationRoot: instanceRoot,
    profileDir: path.join(instanceRoot, 'profile'),
    pythonStateDir: path.join(instanceRoot, 'python-state'),
    pythonOutputDir: path.join(instanceRoot, 'python-output'),
  }
}

async function writeRawProfile(profileDir, value) {
  await mkdir(profileDir, { recursive: true })
  await writeFile(path.join(profileDir, 'browser-profile.json'), `${value}\n`, 'utf8')
}

async function readRawProfile(profileDir) {
  return readFile(path.join(profileDir, 'browser-profile.json'), 'utf8')
}

async function assertWindowsPowerShellPathIdentity(root) {
  const value = path.join(root, 'identity-fixture')
  const normalized = path.resolve(value).replace(/[\\/]+$/, '').toLowerCase()
  const expected = `sha256:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`
  const powershellValue = value.replaceAll("'", "''")
  const modulePath = path.join(repositoryRoot, 'scripts', 'optimization-launch-runtime.psm1').replaceAll("'", "''")
  const result = await execFile('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    [
      '$ErrorActionPreference = "Stop"',
      `Import-Module '${modulePath}' -Force -DisableNameChecking`,
      `$actual = Get-OptimizationPathIdentity -Value '${powershellValue}'`,
      `if ($actual -ne '${expected}') { throw "path identity mismatch" }`,
      'Write-Output $actual',
    ].join('; '),
  ], { cwd: repositoryRoot })
  assert.equal(result.stdout.trim(), expected)
}

async function assertExistingProfileIsNotReinitialized(profile, expectedCode, expectedEvidenceCode = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-windows-owner-launcher-profile-'))
  try {
    const options = fixtureOptions(root)
    await mkdir(options.pythonStateDir, { recursive: true })
    await mkdir(options.pythonOutputDir, { recursive: true })
    await writeRawProfile(
      options.profileDir,
      typeof profile === 'string' ? profile : JSON.stringify(profile),
    )
    const before = await readRawProfile(options.profileDir)

    const result = await initializeIsolatedBrowserProfileIfMissing(options)
    assert.equal(result.created, false)
    assert.equal(result.status, 'existing')
    assert.equal(await readRawProfile(options.profileDir), before)

    if (expectedCode) {
      await assert.rejects(
        createReadWebProductionBackupComposition(options),
        (error) => error?.code === expectedCode,
        `existing profile must remain rejected as ${expectedCode}`,
      )
    } else {
      const composition = await createReadWebProductionBackupComposition(options)
      assert.equal(composition.ownerProfileEvidence.ready, false)
      assert.equal(composition.ownerProfileEvidence.collection.errorCode, expectedEvidenceCode)
      assert.equal(await readRawProfile(options.profileDir), before)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-windows-owner-launcher-profile-'))
try {
  await assertWindowsPowerShellPathIdentity(root)
  const fresh = fixtureOptions(root)
  const cli = await execFile(process.execPath, [
    initializerScript,
    '--isolation-root', fresh.isolationRoot,
    '--profile-dir', fresh.profileDir,
  ], { cwd: repositoryRoot })
  const cliResult = JSON.parse(cli.stdout)
  assert.equal(cliResult.created, true)
  assert.equal(cliResult.status, 'initialized-empty-candidate')
  assert.deepEqual(JSON.parse(await readRawProfile(fresh.profileDir)), {
    schemaVersion: 1,
    localStorage: {},
    indexedDbRows: [],
  })

  const second = await initializeIsolatedBrowserProfileIfMissing(fresh)
  assert.equal(second.created, false)
  assert.equal(second.status, 'existing')
  assert.deepEqual(JSON.parse(await readRawProfile(fresh.profileDir)), {
    schemaVersion: 1,
    localStorage: {},
    indexedDbRows: [],
  })

  const nonEmpty = fixtureOptions(path.join(root, 'non-empty'))
  await mkdir(nonEmpty.profileDir, { recursive: true })
  await writeFile(path.join(nonEmpty.profileDir, 'candidate-state.json'), 'must-remain', 'utf8')
  await assert.rejects(
    initializeIsolatedBrowserProfileIfMissing(nonEmpty),
    (error) => error?.code === 'BACKUP_PROFILE_INITIALIZATION_NOT_EMPTY',
  )
  assert.equal(await readFile(path.join(nonEmpty.profileDir, 'candidate-state.json'), 'utf8'), 'must-remain')
  assert.equal(await readFile(path.join(nonEmpty.profileDir, 'browser-profile.json'), 'utf8').catch(() => null), null)

  const forbiddenRoot = path.join(root, 'forbidden')
  const forbidden = fixtureOptions(path.join(forbiddenRoot, 'instance'))
  await mkdir(forbiddenRoot, { recursive: true })
  await assert.rejects(
    initializeIsolatedBrowserProfileIfMissing({ ...forbidden, forbiddenRoots: [forbiddenRoot] }),
    (error) => error?.code === 'BACKUP_PRODUCTION_COMPOSITION_UNSAFE_PATH',
  )
  assert.equal(await readFile(path.join(forbidden.profileDir, 'browser-profile.json'), 'utf8').catch(() => null), null)

  await assertExistingProfileIsNotReinitialized(
    { schemaVersion: 99, localStorage: {}, indexedDbRows: [] },
    'PROFILE_UNKNOWN_SCHEMA',
  )
  await assertExistingProfileIsNotReinitialized(
    { schemaVersion: 1, localStorage: {}, indexedDbRows: [{ id: 'not-claimed', schemaVersion: 1 }] },
    null,
    'BACKUP_UNCLAIMED_PERSISTENCE_ROW',
  )
  await assertExistingProfileIsNotReinitialized('{', 'PROFILE_CORRUPT')

  console.log('windows local owner launcher profile bootstrap passed (real CLI, empty candidate, no overwrite, isolation, fail-closed existing profiles)')
} finally {
  await rm(root, { recursive: true, force: true })
}
