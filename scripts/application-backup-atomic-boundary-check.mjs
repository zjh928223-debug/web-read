import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createReadWebProductionBackupComposition,
  writeIsolatedBrowserProfile,
} from './lib/read-web-production-backup.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-atomic-boundary-check-'))

try {
  const source = await createFixture(root, 'source')
  const target = await createFixture(root, 'target')
  await writeIsolatedBrowserProfile(source.profileDir, {
    indexedDbRows: [{
      id: 'audioMeta',
      schemaVersion: 1,
      revision: 1,
      contentId: 'atomic-boundary-source',
      content: { title: 'synthetic fixture' },
    }],
  })

  const sourceComposition = await createReadWebProductionBackupComposition(source)
  const targetComposition = await createReadWebProductionBackupComposition(target)
  const artifact = await sourceComposition.createBackup({ now: () => 1760000000000 })
  const beforeBrowser = structuredClone(targetComposition.browserProfile.state)

  assert.equal(
    targetComposition.restoreTarget.restoreCapabilities.atomicRevisionCommit,
    false,
    'the six-domain application target must not claim cross-owner atomic visibility',
  )
  await assert.rejects(
    sourceComposition.service.restore(artifact, {
      target: targetComposition.restoreTarget,
      restoreId: 'six-domain-atomic-boundary',
    }),
    (error) => error?.code === 'RESTORE_TARGET_UNSAFE',
    'a sequential six-domain target must be rejected before restore writes',
  )
  assert.deepEqual(
    targetComposition.browserProfile.state,
    beforeBrowser,
    'a rejected non-atomic target must not write the browser-owned domain',
  )

  console.log('application backup atomic boundary checks passed')
} finally {
  await rm(root, { recursive: true, force: true })
}

async function createFixture(parent, name) {
  const rootDir = path.join(parent, name)
  const fixture = {
    rootDir,
    profileDir: path.join(rootDir, 'profile'),
    pythonStateDir: path.join(rootDir, 'python-state'),
    pythonOutputDir: path.join(rootDir, 'python-output'),
  }
  await Promise.all([
    mkdir(fixture.rootDir, { recursive: true }),
    mkdir(fixture.profileDir, { recursive: true }),
    mkdir(fixture.pythonStateDir, { recursive: true }),
    mkdir(fixture.pythonOutputDir, { recursive: true }),
  ])
  return {
    isolationRoot: fixture.rootDir,
    profileDir: fixture.profileDir,
    pythonStateDir: fixture.pythonStateDir,
    pythonOutputDir: fixture.pythonOutputDir,
  }
}
