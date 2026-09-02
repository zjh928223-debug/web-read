import assert from 'node:assert/strict'

import {
  WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_DOMAINS as DOMAINS,
  WINDOWS_OWNER_AUTHORITATIVE_PROMOTION_HOST_DOMAINS as HOST_DOMAINS,
  createAuthoritativePromotionCoordinator,
  createAuthoritativeSourceFinalBackup,
} from './lib/windows-owner-authoritative-promotion.mjs'

const clone = (value) => structuredClone(value)

function emptySnapshot(domain) {
  return {
    schemaVersion: 1,
    adapterVersion: 1,
    revision: 0,
    records: [],
    references: [],
    mediaReferences: [],
    domain,
  }
}

function sourceSnapshot(domain) {
  return {
    schemaVersion: 1,
    adapterVersion: 1,
    revision: 1,
    records: [{
      id: `${domain}-record`,
      schemaVersion: 1,
      revision: 1,
      contentId: `${domain}-content`,
      payload: { domain, value: 'source-state' },
      references: [],
      mediaReferences: [],
    }],
    references: [],
    mediaReferences: [],
    domain,
  }
}

function createAdapters({ source = true, failDomain = null } = {}) {
  const current = Object.fromEntries(DOMAINS.map((domain) => [
    domain,
    source ? sourceSnapshot(domain) : emptySnapshot(domain),
  ]))
  return {
    adapters: Object.fromEntries(DOMAINS.map((domain) => [domain, {
      key: domain,
      schemaVersion: 1,
      adapterVersion: 1,
      supportedSchemaVersions: [1],
      async collect() { return clone(current[domain]) },
      async restoreRecords(snapshot, context = {}) {
        if (domain === failDomain) {
          const error = new Error('synthetic target import failure')
          error.code = 'SYNTHETIC_TARGET_IMPORT_FAILED'
          throw error
        }
        current[domain] = {
          ...clone(snapshot),
          revision: context.reason === 'migration-rollback'
            ? snapshot.revision
            : (Number.isInteger(context.expectedRevision) ? context.expectedRevision + 1 : snapshot.revision),
        }
        return {
          status: 'committed',
          commitStatus: 'committed',
          outcome: 'committed',
          revision: current[domain].revision,
        }
      },
    }])),
    current,
  }
}

function promotionState(profileId, instanceId, status = 'unfrozen', challenge = null) {
  return {
    schemaVersion: 1,
    status,
    mode: 'optimization',
    profileId,
    instanceId,
    domains: [...HOST_DOMAINS],
    frozenDomains: status === 'frozen' ? [...HOST_DOMAINS] : [],
    drainedDomains: status === 'frozen' ? [...HOST_DOMAINS] : [],
    invalidDomains: [],
    checkpointedDomains: [],
    challenge,
    drained: status === 'frozen',
    inflightOwnerWrites: 0,
  }
}

function createControls({ targetProfileId = 'daily-production', targetInstanceId = 'target-instance', failTargetCommit = false } = {}) {
  let source = promotionState('optimization', 'source-instance')
  const commits = []
  const revokes = []
  return {
    source: {
      async status() { return clone(source) },
      async freeze(payload) {
        source = promotionState('optimization', 'source-instance', 'frozen', payload.challenge)
        return clone(source)
      },
      async unfreeze() {
        source = promotionState('optimization', 'source-instance')
        return clone(source)
      },
    },
    target: {
      async status() { return promotionState(targetProfileId, targetInstanceId) },
      async commit(payload) {
        if (failTargetCommit) {
          const error = new Error('synthetic target checkpoint failure')
          error.code = 'SYNTHETIC_TARGET_CHECKPOINT_FAILED'
          throw error
        }
        commits.push(clone(payload))
        return { status: 'frozen', domain: payload.domain, idempotent: false }
      },
      async revoke(payload) {
        revokes.push(clone(payload))
        return { status: 'unfrozen', domain: payload.domain, idempotent: false }
      },
    },
    getSource() { return clone(source) },
    commits,
    revokes,
  }
}

function createStateStore() {
  let value = null
  let writes = 0
  return {
    async read() { return value === null ? null : clone(value) },
    async write(next) { writes += 1; value = clone(next) },
    get writes() { return writes },
    get value() { return value === null ? null : clone(value) },
  }
}

async function createCoordinator({ failDomain = null } = {}) {
  const source = createAdapters({ source: true })
  const target = createAdapters({ source: false, failDomain })
  const controls = createControls()
  const stateStore = createStateStore()
  const checkpointStore = createStateStore()
  const coordinator = await createAuthoritativePromotionCoordinator({
    sourceControl: controls.source,
    targetControl: controls.target,
    sourceAdapters: source.adapters,
    targetAdapters: target.adapters,
    sourceProfileId: 'optimization',
    sourceInstanceId: 'source-instance',
    targetProfileId: 'daily-production',
    targetInstanceId: 'target-instance',
    stateStore,
    targetCheckpointStore: checkpointStore,
    runId: failDomain ? 'failure-run' : 'success-run',
    release: { releaseId: 'focused-test-release', gitSha: 'focused-test' },
  })
  return { coordinator, controls, source, target, stateStore, checkpointStore }
}

const unfrozenSourceAdapters = Object.fromEntries(DOMAINS.map((domain) => [domain, {
  async collect() { return emptySnapshot(domain) },
}]))
await assert.rejects(
  createAuthoritativeSourceFinalBackup({
    sourceControl: { async status() { return promotionState('optimization', 'source-instance') } },
    sourceAdapters: unfrozenSourceAdapters,
    profileId: 'optimization',
    instanceId: 'source-instance',
  }),
  (error) => error?.code === 'OWNER_PROMOTION_SOURCE_NOT_FROZEN',
)

const success = await createCoordinator()
const writesBeforeReadOnly = success.stateStore.writes
const checkpointWritesBeforeReadOnly = success.checkpointStore.writes
const plan = await success.coordinator.plan()
const inventory = await success.coordinator.inventory()
const dryRun = await success.coordinator.dryRun()
assert.equal(plan.write, false)
assert.equal(inventory.write, false)
assert.equal(dryRun.write, false)
assert.equal(dryRun.ok, true)
assert.equal(success.stateStore.writes, writesBeforeReadOnly)
assert.equal(success.checkpointStore.writes, checkpointWritesBeforeReadOnly)

const applied = await success.coordinator.apply()
assert.equal(applied.ok, true)
assert.equal(success.controls.commits.length, DOMAINS.length)
assert.equal(success.controls.getSource().status, 'frozen')
assert.equal(applied.source.frozenDomains.length, HOST_DOMAINS.length)
assert.ok(applied.migration.results.every((result) => result.steps.beforeFinalBackup.sourceHostFreezeEvidence.frozen === true))
const repeated = await success.coordinator.apply()
assert.equal(repeated.ok, true)
assert.equal(success.controls.commits.length, DOMAINS.length)

const failed = await createCoordinator({ failDomain: 'passage-preview' })
const failure = await failed.coordinator.apply()
assert.equal(failure.ok, false)
assert.equal(failure.manualRecovery, false)
assert.equal(failed.controls.getSource().status, 'unfrozen')
assert.ok(failed.controls.revokes.length >= 2)
for (const domain of DOMAINS) assert.deepEqual(failed.target.current[domain].records, [])

console.log('windows owner authoritative promotion focused checks: passed')
