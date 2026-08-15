import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createReadWebProductionBackupComposition, createIsolatedProfileRestoreTarget } from './lib/read-web-production-backup.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-isolation-check-'))

try {
  await rejectsBeforeWrite('root-self', {
    isolationRoot: path.join(root, 'self'),
    profileDir: path.join(root, 'self'),
    pythonStateDir: path.join(root, 'self', 'state'),
    pythonOutputDir: path.join(root, 'self', 'output'),
  })

  await rejectsBeforeWrite('outside-root', {
    isolationRoot: path.join(root, 'inside'),
    profileDir: path.join(root, 'outside', 'profile'),
    pythonStateDir: path.join(root, 'inside', 'state'),
    pythonOutputDir: path.join(root, 'inside', 'output'),
  })

  await rejectsBeforeWrite('overlapping-paths', {
    isolationRoot: path.join(root, 'overlap'),
    profileDir: path.join(root, 'overlap', 'profile'),
    pythonStateDir: path.join(root, 'overlap', 'profile', 'state'),
    pythonOutputDir: path.join(root, 'overlap', 'output'),
  })

  await rejectsBeforeWrite('custom-forbidden-root', {
    isolationRoot: path.join(root, 'custom-forbidden'),
    profileDir: path.join(root, 'custom-forbidden', 'profile'),
    pythonStateDir: path.join(root, 'custom-forbidden', 'state'),
    pythonOutputDir: path.join(root, 'custom-forbidden', 'output'),
    forbiddenRoots: [path.join(root, 'custom-forbidden')],
  })

  if (process.platform === 'win32') {
    for (const forbiddenRoot of ['E:\\read-web', 'E:\\read-web-next']) {
      await rejectsBeforeWrite(`forbidden-${forbiddenRoot}`, {
        isolationRoot: path.join(forbiddenRoot, 'batch2-isolation-check'),
        profileDir: path.join(forbiddenRoot, 'batch2-isolation-check', 'profile'),
        pythonStateDir: path.join(forbiddenRoot, 'batch2-isolation-check', 'state'),
        pythonOutputDir: path.join(forbiddenRoot, 'batch2-isolation-check', 'output'),
      })
    }
  }

  const symlinkRoot = path.join(root, 'junction-root')
  const symlinkTarget = path.join(root, 'junction-target')
  await mkdir(symlinkRoot, { recursive: true })
  await mkdir(symlinkTarget, { recursive: true })
  const redirectedProfile = path.join(symlinkRoot, 'profile')
  await symlink(symlinkTarget, redirectedProfile, 'junction')
  await rejectsBeforeWrite('junction-escape', {
    isolationRoot: symlinkRoot,
    profileDir: path.join(redirectedProfile, 'nested-profile'),
    pythonStateDir: path.join(symlinkRoot, 'state'),
    pythonOutputDir: path.join(symlinkRoot, 'output'),
  })

  const publicApiCase = await createPublicApiSelfSignedCase(root)
  assert.equal(publicApiCase.writes, 0, 'a public self-signed certificate must fail before target writes')
  assert.equal(publicApiCase.stateAfter, publicApiCase.stateBefore)

  const isolatedOnlyCase = await createPublicApiSelfSignedCase(root, { certificate: null })
  assert.equal(isolatedOnlyCase.writes, 0, 'isolated:true without a certificate must fail before target writes')

  await rejectsIsolatedProfileTargetBeforeWrite('isolated-target-root-self', {
    isolationRoot: path.join(root, 'isolated-target-self'),
    profileDir: path.join(root, 'isolated-target-self'),
  })
  await rejectsIsolatedProfileTargetBeforeWrite('isolated-target-outside-root', {
    isolationRoot: path.join(root, 'isolated-target-root'),
    profileDir: path.join(root, 'isolated-target-outside', 'profile'),
  })

  const validRoot = path.join(root, 'valid')
  const validProfile = path.join(validRoot, 'profile')
  const validComposition = await createReadWebProductionBackupComposition({
    isolationRoot: validRoot,
    profileDir: validProfile,
    pythonStateDir: path.join(validRoot, 'state'),
    pythonOutputDir: path.join(validRoot, 'output'),
  })
  const validArtifact = await validComposition.createBackup({ now: () => 1760000000000 })
  assert.equal(
    (await validComposition.service.restore(validArtifact, {
      target: validComposition.restoreTarget,
      restoreId: 'valid-isolation-check',
    })).status,
    'completed',
    'a temporary, canonically validated isolated target should succeed',
  )

  console.log('application backup isolation checks passed')
} finally {
  await rm(root, { recursive: true, force: true })
}

async function rejectsBeforeWrite(name, options) {
  const statePath = path.join(options.profileDir, 'browser-profile.json')
  await assert.rejects(
    createReadWebProductionBackupComposition(options),
    (error) => error?.code === 'BACKUP_PRODUCTION_COMPOSITION_UNSAFE_PATH',
    `${name} must fail closed before creating a profile`,
  )
  assert.equal(await exists(statePath), false, `${name} must not write ${statePath}`)
}

async function rejectsIsolatedProfileTargetBeforeWrite(name, options) {
  const statePath = path.join(options.profileDir, 'application-state.json')
  await assert.rejects(
    createIsolatedProfileRestoreTarget(options),
    (error) => error?.code === 'BACKUP_PRODUCTION_COMPOSITION_UNSAFE_PATH',
    `${name} must fail closed before creating an isolated target`,
  )
  assert.equal(await exists(statePath), false, `${name} must not write ${statePath}`)
}

async function createPublicApiSelfSignedCase(caseRoot, options = {}) {
  const source = await readFile(new URL('../src/services/persistence/application-backup.js', import.meta.url), 'utf8')
  const applicationBackup = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  const requiredDomains = applicationBackup.APPLICATION_BACKUP_REQUIRED_DOMAINS
  const adapters = Object.fromEntries(requiredDomains.map((key) => [key, {
    key,
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      return { schemaVersion: 1, adapterVersion: 1, revision: 0, records: [], references: [], mediaReferences: [] }
    },
    async restoreRecords() { throw new Error('must not be reached') },
  }]))
  const service = applicationBackup.createApplicationBackupService({ adapters })
  const artifact = await service.createBackup()
  let writes = 0
  const certificate = options.certificate === null
    ? undefined
    : applicationBackup.createApplicationBackupIsolationCertificate({
      isolationRoot: path.join(caseRoot, 'public-api'),
      paths: { target: path.join(caseRoot, 'public-api', 'target') },
    })
  const target = {
    isolated: true,
    isolationCertificate: certificate,
    restoreCapabilities: {
      atomicRevisionCommit: true,
      commitRevisionEvidence: true,
      verifyAppliedRevision: true,
    },
    async beginTransaction() {
      writes += 1
      throw new Error('must not be reached')
    },
  }
  const stateBefore = JSON.stringify({ writes })
  await assert.rejects(
    service.restore(artifact, { target, restoreId: `public-api-${options.certificate === null ? 'isolated-only' : 'self-signed'}` }),
    (error) => error?.code === 'RESTORE_TARGET_UNSAFE',
  )
  return { writes, stateBefore, stateAfter: JSON.stringify({ writes }) }
}

async function exists(filename) {
  try {
    await readFile(filename)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}
