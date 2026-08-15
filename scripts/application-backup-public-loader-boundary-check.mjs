import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import * as productionBackup from './lib/read-web-production-backup.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-public-loader-boundary-'))

try {
  const publicLoaderNames = Object.keys(productionBackup)
    .filter((name) => name === 'loadBackupModules')
    .sort()
  const publicTargetFactoryNames = Object.keys(productionBackup)
    .filter((name) => name === 'createIsolatedProfileRestoreTarget' || name === 'createReadWebProductionBackupComposition')
    .sort()

  assert.deepEqual(publicLoaderNames, ['loadBackupModules'])
  assert.deepEqual(publicTargetFactoryNames, [
    'createIsolatedProfileRestoreTarget',
    'createReadWebProductionBackupComposition',
  ])

  const publicModules = await productionBackup.loadBackupModules()
  assert.deepEqual(
    Object.keys(publicModules).sort(),
    ['applicationBackup', 'readWebBackup'],
    'the public loader must expose only a narrow, non-signing module facade',
  )
  assert.equal(publicModules.isolationIssuerToken, undefined)
  assert.equal(publicModules.createTrustedIsolationCertificate, undefined)

  const applicationBackup = publicModules.applicationBackup
  const publicCertificateInputs = [
    {
      isolationRoot: 'E:\\read-web',
      paths: { target: 'E:\\read-web\\target' },
    },
    {
      isolationRoot: 'E:\\read-web-next',
      paths: { target: 'E:\\read-web-next\\target' },
    },
    {
      isolationRoot: path.join(root, 'certificate-root'),
      paths: { target: path.join(root, 'certificate-outside') },
    },
    {
      isolationRoot: path.join(root, 'certificate-root'),
      paths: { target: path.join(root, 'certificate-root') },
    },
  ]
  const publicIssuerGuesses = [
    undefined,
    null,
    randomUUID(),
    'E:\\read-web',
    publicModules.isolationIssuerToken,
    ...Object.values(publicModules),
  ]
  for (const input of publicCertificateInputs) {
    for (const issuerToken of publicIssuerGuesses) {
      const certificate = applicationBackup.createApplicationBackupIsolationCertificate({
        ...input,
        issuerToken,
      })
      assert.equal(
        applicationBackup.isApplicationBackupIsolationCertificate(certificate),
        false,
        `public loader must not accept a certificate for ${input.isolationRoot}`,
      )
    }
  }

  await assertPublicSelfSignedRestoreFailsBeforeWrite(applicationBackup, root)

  await assertRejectsBeforeWrite('root-self', {
    isolationRoot: path.join(root, 'self'),
    profileDir: path.join(root, 'self'),
    pythonStateDir: path.join(root, 'self', 'state'),
    pythonOutputDir: path.join(root, 'self', 'output'),
  })
  await assertRejectsBeforeWrite('outside-root', {
    isolationRoot: path.join(root, 'inside'),
    profileDir: path.join(root, 'outside', 'profile'),
    pythonStateDir: path.join(root, 'inside', 'state'),
    pythonOutputDir: path.join(root, 'inside', 'output'),
  })
  await assertRejectsBeforeWrite('overlapping-paths', {
    isolationRoot: path.join(root, 'overlap'),
    profileDir: path.join(root, 'overlap', 'profile'),
    pythonStateDir: path.join(root, 'overlap', 'profile', 'state'),
    pythonOutputDir: path.join(root, 'overlap', 'output'),
  }, { includeIsolatedTarget: false })

  const symlinkRoot = path.join(root, 'junction-root')
  const symlinkTarget = path.join(root, 'junction-target')
  await mkdir(symlinkRoot, { recursive: true })
  await mkdir(symlinkTarget, { recursive: true })
  const redirectedProfile = path.join(symlinkRoot, 'profile')
  await symlink(symlinkTarget, redirectedProfile, 'junction')
  await assertRejectsBeforeWrite('junction-escape', {
    isolationRoot: symlinkRoot,
    profileDir: path.join(redirectedProfile, 'nested-profile'),
    pythonStateDir: path.join(symlinkRoot, 'state'),
    pythonOutputDir: path.join(symlinkRoot, 'output'),
  })

  if (process.platform === 'win32') {
    for (const forbiddenRoot of ['E:\\read-web', 'E:\\read-web-next']) {
      await assertRejectsBeforeWrite(`forbidden-${forbiddenRoot}`, {
        isolationRoot: path.join(forbiddenRoot, 'public-loader-boundary'),
        profileDir: path.join(forbiddenRoot, 'public-loader-boundary', 'profile'),
        pythonStateDir: path.join(forbiddenRoot, 'public-loader-boundary', 'state'),
        pythonOutputDir: path.join(forbiddenRoot, 'public-loader-boundary', 'output'),
      }, { inspectWrites: false })
    }
  }

  await productionBackup.createProductionOutboxQuarantineProtector()
  console.log('public loader isolation boundary checks passed')
} finally {
  await rm(root, { recursive: true, force: true })
}

async function assertRejectsBeforeWrite(name, options, { inspectWrites = true, includeIsolatedTarget = true } = {}) {
  const calls = [
    ['createReadWebProductionBackupComposition', () => productionBackup.createReadWebProductionBackupComposition(options)],
  ]
  if (includeIsolatedTarget) {
    calls.push(['createIsolatedProfileRestoreTarget', () => productionBackup.createIsolatedProfileRestoreTarget({
      isolationRoot: options.isolationRoot,
      profileDir: options.profileDir,
    })])
  }
  for (const [factoryName, call] of calls) {
    await assert.rejects(
      call(),
      (error) => error?.code === 'BACKUP_PRODUCTION_COMPOSITION_UNSAFE_PATH',
      `${name} must be rejected by ${factoryName} before any target write`,
    )
    if (inspectWrites) {
      assert.equal(await exists(path.join(options.profileDir, 'application-state.json')), false)
      assert.equal(await exists(path.join(options.profileDir, 'browser-profile.json')), false)
    }
  }
}

async function assertPublicSelfSignedRestoreFailsBeforeWrite(applicationBackup, caseRoot) {
  const requiredDomains = applicationBackup.APPLICATION_BACKUP_REQUIRED_DOMAINS
  const adapters = Object.fromEntries(requiredDomains.map((key) => [key, {
    key,
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      return { schemaVersion: 1, adapterVersion: 1, revision: 0, records: [], references: [], mediaReferences: [] }
    },
  }]))
  const service = applicationBackup.createApplicationBackupService({ adapters })
  const artifact = await service.createBackup()
  let writes = 0
  const certificate = applicationBackup.createApplicationBackupIsolationCertificate({
    isolationRoot: path.join(caseRoot, 'self-signed-root'),
    paths: { target: path.join(caseRoot, 'self-signed-root', 'target') },
    issuerToken: randomUUID(),
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
      throw new Error('untrusted target must not be reached')
    },
  }
  await assert.rejects(
    service.restore(artifact, { target, restoreId: 'public-loader-self-signed' }),
    (error) => error?.code === 'RESTORE_TARGET_UNSAFE',
  )
  assert.equal(writes, 0, 'public self-signed or isolated-only targets must fail before any write')
}

async function exists(filename) {
  try {
    await stat(filename)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}
