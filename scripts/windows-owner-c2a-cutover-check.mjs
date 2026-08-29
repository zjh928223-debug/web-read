import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readOwnerModeCheckpoint, readOwnerModeFreeze, writeJsonAtomic } from './lib/read-web-production-backup.mjs'
import { createWindowsOwnerCutoverControls } from './lib/windows-owner-cutover.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appBackupSource = await readFile(path.join(repositoryRoot, 'src/services/persistence/application-backup.js'), 'utf8')
const migrationSource = await readFile(path.join(repositoryRoot, 'src/services/persistence/windows-durable-state-migration.js'), 'utf8')

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

const migration = await import(dataUrl(migrationSource.replace(
  "from './application-backup.js'",
  `from '${dataUrl(appBackupSource)}'`,
)))

const {
  createWindowsDurableStateMigration,
} = migration

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))
}

function canonical(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function emptySnapshot() {
  return { schemaVersion: 1, adapterVersion: 1, revision: 0, records: [], references: [], mediaReferences: [] }
}

class FileOwnerAdapter {
  constructor(root, domain) {
    this.root = root
    this.domain = domain
    this.filePath = path.join(root, `${domain}.json`)
    this.frozen = false
    this.writeCount = 0
  }

  async collect() {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return emptySnapshot()
      throw error
    }
  }

  async freeze() {
    this.frozen = true
    return { ok: true }
  }

  async unfreeze() {
    this.frozen = false
    return { ok: true }
  }

  async importRecords({ snapshot, expectedRevision }) {
    const current = await this.collect()
    if (current.revision !== expectedRevision) {
      return { status: 'conflict', currentRevision: current.revision }
    }
    if (!this.frozen) return { status: 'rejected' }
    await writeJsonAtomic(this.filePath, clone(snapshot), { containmentRoot: this.root })
    this.writeCount += 1
    return {
      status: 'committed',
      commitStatus: 'committed',
      revision: snapshot.revision,
      receiptId: `c2a-${this.domain}-${snapshot.revision}`,
    }
  }
}

function createLegacyBridge(records) {
  return {
    async inventory() {
      return { status: 'ready', records: clone(records) }
    },
    async prepareImport({ sourceIds } = {}) {
      const selected = Array.isArray(sourceIds)
        ? records.filter((record) => sourceIds.includes(record.sourceId))
        : records
      return {
        status: 'ready',
        importIdentity: `c2a-${selected.map((record) => record.sourceId).join(',') || 'empty'}`,
        importInput: {
          schemaVersion: 1,
          mode: 'legacy-import-input',
          profileId: 'c2a-profile',
          records: clone(selected),
        },
      }
    },
  }
}

function createStateStore(filePath) {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(filePath, 'utf8'))
      } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
      }
    },
    async write(value) {
      await writeJsonAtomic(filePath, value)
    },
  }
}

const workRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-owner-c2a-'))
try {
  const instanceRoot = path.join(workRoot, 'instance')
  const profileDir = path.join(instanceRoot, 'profile')
  const authorityIsolationRoot = path.join(workRoot, 'authority-isolation')
  const authorityRoot = path.join(authorityIsolationRoot, 'profile-authority')
  const hostRoot = path.join(authorityRoot, 'owners')
  await Promise.all([
    mkdir(profileDir, { recursive: true }),
    mkdir(hostRoot, { recursive: true }),
  ])

  const records = [
    {
      domain: 'reader-session',
      sourceId: 'reader-session-source',
      recordKey: 'audioMeta',
      schemaVersion: 1,
      revision: 2,
      payload: {
        schemaVersion: 1,
        contentId: 'c2-reader-content',
      },
      references: [{ kind: 'media', id: 'c2-reader-audio', revision: 1 }],
      mediaReferences: [{
        mediaId: 'c2-reader-audio',
        kind: 'audio',
        size: 12,
        contentType: 'audio/mp4',
        etag: '"c2-reader-v1"',
        revision: 1,
        authorizedReference: '/api/jobs/c2-reader/media/audio',
      }],
    },
    {
      domain: 'reader-session',
      sourceId: 'reader-session-source',
      recordKey: 'readerSession',
      schemaVersion: 1,
      revision: 2,
      payload: { schemaVersion: 1, contentId: 'c2-reader-content', revision: 2 },
    },
    {
      domain: 'marks-activity',
      sourceId: 'marks-activity-source',
      recordKey: 'reader-marks.json',
      schemaVersion: 1,
      revision: 3,
      payload: {
        schemaVersion: 1,
        jobId: 'c2-reader',
        contentId: 'c2-reader-content',
        marks: [{ word: 'range', index: 0 }],
      },
      references: [{ kind: 'content', id: 'c2-reader-content' }],
      mediaReferences: [],
    },
  ]
  const hostAdapters = Object.fromEntries([
    'reader-session',
    'marks-activity',
    'passage-preview',
    'annotation',
    'vocabulary-srs',
    'workflow',
  ].map((domain) => [domain, new FileOwnerAdapter(hostRoot, domain)]))
  const expectedSnapshots = {}
  const cutoverControls = createWindowsOwnerCutoverControls({
    isolationRoot: instanceRoot,
    profileDir,
    profileAuthorityIsolationRoot: authorityIsolationRoot,
    profileAuthorityRoot: authorityRoot,
    profileId: 'c2a-profile',
    smokeCheck: async ({ domain, revision }) => {
      const current = await hostAdapters[domain].collect()
      const expected = expectedSnapshots[domain]
      return {
        ok: current.revision === revision && expected && canonical(current) === canonical(expected),
      }
    },
  })
  const service = createWindowsDurableStateMigration({
    profileId: 'c2a-profile',
    legacyBridge: createLegacyBridge(records),
    hostAdapters,
    stateStore: createStateStore(path.join(workRoot, 'migration-state.json')),
    cutoverControls,
    capacityBytes: 8 * 1024 * 1024,
  })

  assert.equal((await service.createFinalBackup('reader-session')).reasonCode, 'migration-freeze-required')
  for (const [domain, sourceId] of [
    ['reader-session', 'reader-session-source'],
    ['marks-activity', 'marks-activity-source'],
  ]) {
    const dryRun = await service.dryRun(domain, { sourceIds: [sourceId], expectedRevision: 0 })
    assert.equal(dryRun.ok, true, JSON.stringify(dryRun))
    assert.deepEqual(dryRun.sourceIds, [sourceId])
    const frozen = await service.freeze(domain)
    assert.equal(frozen.status, 'frozen')
    const freezeEvidence = await readOwnerModeFreeze({
      isolationRoot: instanceRoot,
      profileDir,
      profileAuthorityIsolationRoot: authorityIsolationRoot,
      profileAuthorityRoot: authorityRoot,
      profileId: 'c2a-profile',
      domain,
    })
    assert.equal(freezeEvidence.status, 'frozen', 'browser-visible freeze must exist before final backup')
    const finalBackup = await service.createFinalBackup(domain)
    assert.equal(finalBackup.ok, true, JSON.stringify(finalBackup))
    assert.deepEqual(finalBackup.finalBackup.sourceIds, [sourceId])
    const imported = await service.importDomain(domain, { expectedRevision: 0, idempotencyKey: `c2a-import-${domain}` })
    assert.equal(imported.outcome, 'committed', JSON.stringify(imported))
    const verified = await service.verify(domain)
    assert.equal(verified.ok, true, JSON.stringify(verified))
    expectedSnapshots[domain] = await hostAdapters[domain].collect()
    const switched = await service.switchHostAuthoritative(domain)
    assert.equal(switched.authorityChanged, true, JSON.stringify(switched))
    const smoke = await service.smokeCheck(domain)
    assert.equal(smoke.status, 'passed', JSON.stringify(smoke))
    const reopenedAdapter = new FileOwnerAdapter(hostRoot, domain)
    assert.deepEqual(await reopenedAdapter.collect(), expectedSnapshots[domain])
    assert.equal(hostAdapters[domain].frozen, true)
  }

  const failedWorkRoot = path.join(workRoot, 'smoke-failure')
  const failedInstanceRoot = path.join(failedWorkRoot, 'instance')
  const failedProfileDir = path.join(failedInstanceRoot, 'profile')
  const failedAuthorityIsolationRoot = path.join(failedWorkRoot, 'authority-isolation')
  const failedAuthorityRoot = path.join(failedAuthorityIsolationRoot, 'profile-authority')
  const failedHostRoot = path.join(failedAuthorityRoot, 'owners')
  await mkdir(failedProfileDir, { recursive: true })
  await mkdir(failedHostRoot, { recursive: true })
  const failedAdapters = Object.fromEntries(
    ['reader-session', 'marks-activity', 'passage-preview', 'annotation', 'vocabulary-srs', 'workflow']
      .map((domain) => [domain, new FileOwnerAdapter(failedHostRoot, domain)]),
  )
  const failedControls = createWindowsOwnerCutoverControls({
    isolationRoot: failedInstanceRoot,
    profileDir: failedProfileDir,
    profileAuthorityIsolationRoot: failedAuthorityIsolationRoot,
    profileAuthorityRoot: failedAuthorityRoot,
    profileId: 'c2a-profile',
    smokeCheck: async () => ({ ok: false, reasonCode: 'c2a-smoke-failed' }),
  })
  const failedService = createWindowsDurableStateMigration({
    profileId: 'c2a-profile',
    legacyBridge: createLegacyBridge([]),
    hostAdapters: failedAdapters,
    stateStore: createStateStore(path.join(failedWorkRoot, 'migration-state.json')),
    cutoverControls: failedControls,
    capacityBytes: 8 * 1024 * 1024,
  })
  const failedMigration = await failedService.migrateDomain('reader-session', { expectedRevision: 0 })
  assert.equal(failedMigration.ok, false)
  assert.equal(failedMigration.steps.rollback.ok, true, JSON.stringify(failedMigration))
  assert.equal(await readOwnerModeCheckpoint({
    isolationRoot: failedInstanceRoot,
    profileDir: failedProfileDir,
    profileAuthorityIsolationRoot: failedAuthorityIsolationRoot,
    profileAuthorityRoot: failedAuthorityRoot,
    profileId: 'c2a-profile',
    domain: 'reader-session',
  }), null, 'smoke failure must revoke the authoritative checkpoint')
  assert.equal(await readOwnerModeFreeze({
    isolationRoot: failedInstanceRoot,
    profileDir: failedProfileDir,
    profileAuthorityIsolationRoot: failedAuthorityIsolationRoot,
    profileAuthorityRoot: failedAuthorityRoot,
    profileId: 'c2a-profile',
    domain: 'reader-session',
  }), null, 'successful rollback compensation may release the old-writer freeze')
  assert.deepEqual(await failedAdapters['reader-session'].collect(), emptySnapshot())

  const checkpointReader = await import('./lib/read-web-production-backup.mjs')
  const readerCheckpoint = await checkpointReader.readOwnerModeCheckpoint({
    isolationRoot: instanceRoot,
    profileDir,
    profileAuthorityIsolationRoot: authorityIsolationRoot,
    profileAuthorityRoot: authorityRoot,
    profileId: 'c2a-profile',
    domain: 'reader-session',
  })
  const marksCheckpoint = await checkpointReader.readOwnerModeCheckpoint({
    isolationRoot: instanceRoot,
    profileDir,
    profileAuthorityIsolationRoot: authorityIsolationRoot,
    profileAuthorityRoot: authorityRoot,
    profileId: 'c2a-profile',
    domain: 'marks-activity',
  })
  assert.equal(readerCheckpoint.repository.type, 'host-managed')
  assert.equal(marksCheckpoint.repository.type, 'host-managed')
  assert.equal((await service.status()).domains['reader-session'].authoritative, true)
  assert.equal((await service.status()).domains['marks-activity'].authoritative, true)
  console.log('Windows owner C2a cutover checks passed.')
} finally {
  await rm(workRoot, { recursive: true, force: true })
}
