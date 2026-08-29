import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  clearOwnerModeFreeze,
  createReadWebProductionBackupComposition,
  revokeOwnerModeCheckpoint,
  writeOwnerModeCheckpoint,
  writeOwnerModeFreeze,
  writeJsonAtomic,
} from './read-web-production-backup.mjs'

const DOMAINS = Object.freeze([
  'reader-session',
  'marks-activity',
  'passage-preview',
  'annotation',
  'vocabulary-srs',
  'workflow',
])

function safeChecksum(value, field) {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    const error = new Error(`${field} must be a checksum`)
    error.code = 'OWNER_CUTOVER_EVIDENCE_INVALID'
    throw error
  }
  return value
}

function safeRevision(value) {
  if ((Number.isInteger(value) && value >= 0)
    || (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))) return value
  const error = new Error('owner cutover revision is invalid')
  error.code = 'OWNER_CUTOVER_EVIDENCE_INVALID'
  throw error
}

function domainIdentity(domain) {
  if (!DOMAINS.includes(domain)) {
    const error = new Error(`owner cutover domain is not registered: ${domain}`)
    error.code = 'OWNER_CUTOVER_DOMAIN_INVALID'
    throw error
  }
  return `windows-host.repository.${domain}.v1`
}

/**
 * Connect the already-verified migration controller to the existing durable
 * owner-mode checkpoint.  The caller supplies the small domain smoke check;
 * this helper only records one per-domain authority decision and never
 * coordinates multiple domains.
 */
export function createWindowsOwnerCutoverControls(options = {}) {
  const common = {
    isolationRoot: options.isolationRoot,
    profileDir: options.profileDir,
    profileAuthorityIsolationRoot: options.profileAuthorityIsolationRoot,
    profileAuthorityRoot: options.profileAuthorityRoot,
    profileId: options.profileId,
  }
  const smokeCheck = typeof options.smokeCheck === 'function' ? options.smokeCheck : null
  return Object.fromEntries(DOMAINS.map((domain) => [domain, {
    async freeze({ domain: requestedDomain, reason }) {
      if (requestedDomain !== domain) return { ok: false, reasonCode: 'OWNER_CUTOVER_DOMAIN_MISMATCH' }
      const result = await writeOwnerModeFreeze({ ...common, domain, reason })
      return { ok: true, status: result.status, frozen: true }
    },
    async unfreeze({ domain: requestedDomain }) {
      if (requestedDomain !== domain) return { ok: false, reasonCode: 'OWNER_CUTOVER_DOMAIN_MISMATCH' }
      const result = await clearOwnerModeFreeze({ ...common, domain })
      return { ok: true, status: result.status, frozen: false }
    },
    async switch({ domain: requestedDomain, revision, checksum, frozen, finalBackup }) {
      if (requestedDomain !== domain || frozen !== true || !finalBackup?.final) {
        return { ok: false, reasonCode: 'OWNER_CUTOVER_PRECONDITION_FAILED' }
      }
      const revisionEvidence = safeChecksum(checksum, 'revision evidence')
      const baseEvidence = safeChecksum(finalBackup.artifactChecksum, 'base evidence')
      const ownerRevision = safeRevision(revision)
      const result = await writeOwnerModeCheckpoint({
        ...common,
        domain,
        oldWriterBlocked: true,
        compatibilityMode: 'read-only',
        inFlight: 0,
        repository: {
          identity: domainIdentity(domain),
          type: 'host-managed',
          baseRevision: ownerRevision,
          revision: ownerRevision,
          baseEvidence,
          revisionEvidence,
        },
      })
      return {
        ok: true,
        authorityChanged: true,
        status: 'authoritative',
        checkpointStatus: result.status,
      }
    },
    async rollback({ domain: requestedDomain, revision, checksum }) {
      if (requestedDomain !== domain) return { ok: false, reasonCode: 'OWNER_CUTOVER_DOMAIN_MISMATCH' }
      const result = await revokeOwnerModeCheckpoint({
        ...common,
        domain,
        expectedRevision: revision,
        expectedRevisionEvidence: checksum,
      })
      return { ok: true, status: result.status, authorityChanged: false }
    },
    async smoke(context) {
      if (!smokeCheck) return { ok: false, reasonCode: 'OWNER_CUTOVER_SMOKE_UNAVAILABLE' }
      const result = await smokeCheck({ ...context, domain })
      return result === true ? { ok: true } : result
    },
  }]))
}

export const WINDOWS_OWNER_CUTOVER_DOMAINS = DOMAINS

const PRODUCTION_C2A_DOMAINS = Object.freeze(['reader-session', 'marks-activity'])
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let productionModulesPromise = null

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))
}

function canonical(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function equivalentDomain(left, right) {
  const comparable = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.records)) return value
    return {
      ...value,
      records: value.records.map((record) => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) return record
        const { checksum: _checksum, ...content } = record
        if (/^(?:reader-marks|reader-activity|reader-marks-commit-journal)\.json:/u.test(String(content.id || ''))
          && content.payload && typeof content.payload === 'object' && !Array.isArray(content.payload)
          && typeof content.payload.schemaVersion === 'string'
          && (content.schemaVersion === 1 || content.schemaVersion === content.payload.schemaVersion)) {
          delete content.schemaVersion
        }
        return content
      }),
    }
  }
  return canonical(comparable(left)) === canonical(comparable(right))
}

function containedPath(root, value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${field} is required`)
    error.code = 'OWNER_CUTOVER_PRODUCTION_CONFIGURATION'
    throw error
  }
  const rootPath = path.resolve(root)
  const candidate = path.resolve(value)
  const relative = path.relative(rootPath, candidate)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    const error = new Error(`${field} must remain in the target authority root`)
    error.code = 'OWNER_CUTOVER_PRODUCTION_PATH_INVALID'
    throw error
  }
  return candidate
}

async function loadProductionModules() {
  if (!productionModulesPromise) {
    productionModulesPromise = (async () => {
      const appBackupSource = await readFile(
        path.join(repositoryRoot, 'src', 'services', 'persistence', 'application-backup.js'),
        'utf8',
      )
      const migrationSource = await readFile(
        path.join(repositoryRoot, 'src', 'services', 'persistence', 'windows-durable-state-migration.js'),
        'utf8',
      )
      const bridgeSource = await readFile(
        path.join(repositoryRoot, 'src', 'services', 'windows-owner-legacy-compatibility-bridge.js'),
        'utf8',
      )
      const apiContract = JSON.parse(await readFile(
        path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader', 'api-contract.json'),
        'utf8',
      ))
      const domainInventory = JSON.parse(await readFile(
        path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader', 'domain-inventory.json'),
        'utf8',
      ))
      const ownerRegistry = JSON.parse(await readFile(
        path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader', 'owner-registry.json'),
        'utf8',
      ))
      const migration = await import(dataUrl(migrationSource.replace(
        "from './application-backup.js'",
        `from '${dataUrl(appBackupSource)}'`,
      )))
      const bridge = await import(dataUrl(
        bridgeSource
          .replace(
            "import apiContract from '../../docs/architecture/windows-local-owner-thin-reader/api-contract.json'",
            `const apiContract = ${JSON.stringify(apiContract)}`,
          )
          .replace(
            "import domainInventory from '../../docs/architecture/windows-local-owner-thin-reader/domain-inventory.json'",
            `const domainInventory = ${JSON.stringify(domainInventory)}`,
          )
          .replace(
            "import ownerRegistry from '../../docs/architecture/windows-local-owner-thin-reader/owner-registry.json'",
            `const ownerRegistry = ${JSON.stringify(ownerRegistry)}`,
          ),
      ))
      return Object.freeze({
        createWindowsDurableStateMigration: migration.createWindowsDurableStateMigration,
        createWindowsOwnerLegacyCompatibilityBridge: bridge.createWindowsOwnerLegacyCompatibilityBridge,
      })
    })()
  }
  return productionModulesPromise
}

function productionLayout(composition) {
  const layout = composition?.restoreTarget?.isolationLayout
  if (!layout?.isolationRoot || !layout.paths?.profileDir) {
    const error = new Error('Production cutover composition does not expose an isolated layout')
    error.code = 'OWNER_CUTOVER_PRODUCTION_COMPOSITION_INVALID'
    throw error
  }
  return layout
}

function validateProductionDomains(value) {
  const domains = value === undefined ? [...PRODUCTION_C2A_DOMAINS] : value
  if (!Array.isArray(domains) || domains.length === 0 || domains.some((domain) => !PRODUCTION_C2A_DOMAINS.includes(domain))) {
    const error = new Error('Production C2a cutover only supports reader-session and marks-activity')
    error.code = 'OWNER_CUTOVER_PRODUCTION_DOMAIN_INVALID'
    throw error
  }
  const indexes = domains.map((domain) => PRODUCTION_C2A_DOMAINS.indexOf(domain))
  if (new Set(indexes).size !== indexes.length || indexes.some((index, position) => index !== position)) {
    const error = new Error('Production C2a domains must follow the fixed Reader Session then marks order')
    error.code = 'OWNER_CUTOVER_PRODUCTION_ORDER_INVALID'
    throw error
  }
  return domains
}

function stateFileStore(filePath, containmentRoot) {
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
      return writeJsonAtomic(filePath, clone(value), { containmentRoot })
    },
  }
}

function createProductionLegacyJsonSources(sourceComposition) {
  const marksAdapter = sourceComposition?.pythonAdapters?.['marks-activity']
  if (!marksAdapter || typeof marksAdapter.collect !== 'function') return []
  return [{
    kind: 'json',
    sourceId: 'backup.marks-activity',
    defaultSchemaVersion: 1,
    read: async () => {
      const snapshot = await marksAdapter.collect({ domain: 'marks-activity' })
      return {
        records: (Array.isArray(snapshot?.records) ? snapshot.records : []).map((record) => ({
          ...record,
          key: record?.id,
          schemaVersion: record?.payload?.schemaVersion ?? record?.schemaVersion,
        })),
      }
    },
  }]
}

/**
 * Explicit local/optimization entry for the first two C2 domains.  The
 * caller must opt in and provide the already-open browser guard refresh so a
 * freeze marker is observed before the final source read.  The normal app
 * startup never invokes this function and no daily profile is migrated by
 * default.
 */
export async function runWindowsOwnerProductionCutover(options = {}) {
  if (options.mode !== 'optimization' || options.explicitOptIn !== true) {
    const error = new Error('Production owner cutover requires explicit optimization opt-in')
    error.code = 'OWNER_CUTOVER_PRODUCTION_OPT_IN_REQUIRED'
    throw error
  }
  if (!options.source || typeof options.source !== 'object' || !options.target || typeof options.target !== 'object') {
    const error = new Error('Production owner cutover requires isolated source and target profiles')
    error.code = 'OWNER_CUTOVER_PRODUCTION_CONFIGURATION'
    throw error
  }
  const domains = validateProductionDomains(options.domains)
  const profileId = String(options.profileId || 'optimization-owner-profile')
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(profileId)) {
    const error = new Error('Production owner cutover profile id is invalid')
    error.code = 'OWNER_CUTOVER_PRODUCTION_CONFIGURATION'
    throw error
  }

  const sourceComposition = await createReadWebProductionBackupComposition({
    ...options.source,
    profileId,
    pythonCommand: options.pythonCommand || options.source.pythonCommand,
  })
  const targetComposition = await createReadWebProductionBackupComposition({
    ...options.target,
    profileId,
    pythonCommand: options.pythonCommand || options.target.pythonCommand,
    migrationAdapterAccess: true,
  })
  const targetLayout = productionLayout(targetComposition)
  const hostAdapters = targetComposition.migrationAdapters
  if (!hostAdapters || domains.some((domain) => !hostAdapters[domain])) {
    const error = new Error('Production cutover composition did not expose host migration adapters')
    error.code = 'OWNER_CUTOVER_PRODUCTION_COMPOSITION_INVALID'
    throw error
  }

  const { createWindowsDurableStateMigration, createWindowsOwnerLegacyCompatibilityBridge } = await loadProductionModules()
  const legacyBridge = createWindowsOwnerLegacyCompatibilityBridge({
    profileId,
    applicationPersistence: sourceComposition.browserProfile.persistence,
    storage: sourceComposition.browserProfile.storage,
    jsonSources: createProductionLegacyJsonSources(sourceComposition),
  })
  const authorityRoot = targetComposition.profileAuthorityRoot
  const authorityIsolationRoot = targetComposition.profileAuthorityIsolationRoot
  const statePath = containedPath(
    authorityRoot,
    options.statePath || path.join(authorityRoot, 'owner-mode', 'c2a-migration-state.json'),
    'statePath',
  )
  const stateStore = stateFileStore(statePath, authorityRoot)
  const browserGuard = options.browserGuard || null
  const refreshBrowserGuard = typeof options.refreshBrowserGuard === 'function'
    ? options.refreshBrowserGuard
    : (browserGuard && typeof browserGuard.refresh === 'function'
      ? (context) => browserGuard.refresh(context)
      : null)
  const targetProfileDir = targetLayout.paths.profileDir
  const controls = createWindowsOwnerCutoverControls({
    isolationRoot: targetLayout.isolationRoot,
    profileDir: targetProfileDir,
    profileAuthorityIsolationRoot: authorityIsolationRoot,
    profileAuthorityRoot: authorityRoot,
    profileId,
    smokeCheck: async ({ domain, revision }) => {
      const current = await hostAdapters[domain].collect({ domain })
      const state = await stateStore.read()
      const expected = state?.domains?.[domain]?.finalBackup?.artifact?.domains?.[domain]
      return {
        ok: Number(current?.revision) === Number(revision)
          && expected !== undefined
          && equivalentDomain(current, expected),
      }
    },
  })
  const migration = createWindowsDurableStateMigration({
    profileId,
    legacyBridge,
    hostAdapters,
    stateStore,
    cutoverControls: controls,
    capacityBytes: options.capacityBytes,
  })
  if (!refreshBrowserGuard) {
    const error = new Error('Production cutover requires a browser guard refresh before final backup')
    error.code = 'OWNER_CUTOVER_BROWSER_REFRESH_REQUIRED'
    throw error
  }
  const results = []
  for (const domain of domains) {
    const current = await hostAdapters[domain].collect({ domain })
    const expectedRevision = options.expectedRevisionByDomain?.[domain] ?? current.revision
    const result = await migration.migrateDomain(domain, {
      sourceIds: options.sourceIdsByDomain?.[domain],
      expectedRevision,
      idempotencyKey: options.idempotencyKeyByDomain?.[domain] || `optimization-c2a-${domain}`,
      beforeFinalBackup: async (context) => {
        if (!refreshBrowserGuard) {
          return { ok: false, reasonCode: 'migration-browser-refresh-required' }
        }
        const refreshed = await refreshBrowserGuard({ domain, stage: 'before-final-backup', freeze: context.freeze })
        if (refreshed === false || refreshed?.ok === false) return refreshed || { ok: false, reasonCode: 'migration-browser-refresh-failed' }
        return { ok: true, status: 'browser-frozen-observed', ...(refreshed && typeof refreshed === 'object' ? refreshed : {}) }
      },
    })
    results.push(result)
    if (!result.ok) break
  }
  return {
    ok: results.length === domains.length && results.every((result) => result.ok),
    mode: 'optimization',
    productionComposition: true,
    domains: results,
    status: await migration.status(),
    sourceProfileId: sourceComposition.profileId,
    targetProfileId: targetComposition.profileId,
  }
}
