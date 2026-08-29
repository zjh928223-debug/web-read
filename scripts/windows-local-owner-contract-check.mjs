import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  REPOSITORY_ROOT,
  WINDOWS_OWNER_DOMAINS,
  assert,
  loadOwnerArtifacts,
  missingConsumerEvidenceTokens,
  missingMatrixConsumerRefs,
  missingRequiredConsumerIds,
  readJson,
} from './lib/windows-local-owner-artifacts.mjs'

const artifacts = await loadOwnerArtifacts()
const inventory = artifacts['domain-inventory.json']
const matrix = artifacts['ownership-matrix.json']
const consumers = artifacts['browser-direct-writer-consumer-map.json']
const api = artifacts['api-contract.json']
const nonGoals = artifacts['non-goals.json']
const ownerRegistry = artifacts['owner-registry.json']

const sortedDomains = (values) => [...values].sort()
const inventoryDomains = inventory.domains.map((item) => item.domain)
const matrixDomains = matrix.domains.map((item) => item.domain)
const registryDomains = api.domainRegistry.map((item) => item.domain)
const ownerRegistryDomains = ownerRegistry.registrations.map((item) => item.domain)
assert(JSON.stringify(sortedDomains(inventoryDomains)) === JSON.stringify(sortedDomains(WINDOWS_OWNER_DOMAINS)), 'inventory does not cover exactly six required domains')
assert(JSON.stringify(sortedDomains(matrixDomains)) === JSON.stringify(sortedDomains(WINDOWS_OWNER_DOMAINS)), 'ownership matrix does not cover exactly six required domains')
assert(JSON.stringify(sortedDomains(registryDomains)) === JSON.stringify(sortedDomains(WINDOWS_OWNER_DOMAINS)), 'API registry does not cover exactly six required domains')
assert(ownerRegistry.schemaVersion === 1, 'Windows owner registry schema version changed')
assert(ownerRegistry.registryVersion === 'windows-owner-registry.v1', 'Windows owner registry version changed')
assert(ownerRegistry.implementationStatus === 'contract-ready-pre-cutover', 'Windows owner registry must remain contract-ready')
assert(ownerRegistry.ownerApiReady === false, 'Windows owner registry cannot claim readiness')
assert(ownerRegistry.acceptingApiAuthoritativeOperations === false, 'Windows owner registry cannot accept API-authoritative operations')
assert(JSON.stringify(sortedDomains(ownerRegistryDomains)) === JSON.stringify(sortedDomains(WINDOWS_OWNER_DOMAINS)), 'owner registry does not cover exactly six required domains')
const ownerIdentities = new Set()
const repositoryIdentities = new Set()
for (const registration of ownerRegistry.registrations) {
  assert(registration.owner?.identity && registration.owner?.facade, `${registration.domain} owner identity/facade is missing`)
  assert(!ownerIdentities.has(registration.owner.identity), `duplicate owner identity: ${registration.owner.identity}`)
  ownerIdentities.add(registration.owner.identity)
  assert(registration.canonicalRecords?.length > 0, `${registration.domain} owner registry has no canonical claims`)
  assert(registration.queryOperations?.length > 0, `${registration.domain} owner registry has no query surface`)
  assert(registration.commandOperations?.length > 0, `${registration.domain} owner registry has no command surface`)
  for (const claimGroup of ['canonicalRecords', 'compatibilityRecords', 'nonCanonicalRecords']) {
    for (const claim of registration[claimGroup] || []) {
      assert((claim.key || claim.keyPattern) && claim.schemaVersions?.length > 0, `${registration.domain} owner registry has an incomplete ${claimGroup} claim`)
    }
  }
  assert(registration.revisionSource?.identity && registration.revisionSource?.source, `${registration.domain} owner registry has no revision source`)
  assert(registration.backupAdapter?.registry === 'createReadWebApplicationBackupAdapters' && registration.backupAdapter?.domain === registration.domain && registration.backupAdapter?.source, `${registration.domain} owner registry has no application backup adapter binding`)
  assert(registration.recoveryHandler?.identity && registration.recoveryHandler?.source, `${registration.domain} owner registry has no recovery handler`)
  assert(registration.repository?.identity && registration.repository?.type === 'host-managed', `${registration.domain} owner repository is not Host-managed`)
  assert(registration.repository?.implementation === 'contract-only', `${registration.domain} owner repository must remain contract-only`)
  assert(registration.repository?.availableForCanonicalCommit === false, `${registration.domain} owner repository cannot accept commits in this milestone`)
  assert(!repositoryIdentities.has(registration.repository.identity), `duplicate repository identity: ${registration.repository.identity}`)
  repositoryIdentities.add(registration.repository.identity)
  for (const evidenceName of ['transaction', 'revision', 'recovery']) {
    const evidence = registration.evidence?.[evidenceName]
    assert(evidence?.required === true && evidence?.source, `${registration.domain} owner registry lacks ${evidenceName} evidence`)
  }
  assert(registration.authority?.mode === 'pre-cutover' && registration.authority?.currentOwner && typeof registration.authority?.currentOwnerWritable === 'boolean', `${registration.domain} owner authority is not pre-cutover`)
  assert(registration.authority?.hostApiAuthoritative === false && registration.authority?.hostApiWritable === false, `${registration.domain} owner authority claims API readiness`)
  assert(registration.browserBridge?.mode && registration.browserBridge?.canonical === false && registration.browserBridge?.commitExecutor === false && registration.browserBridge?.writable === false, `${registration.domain} browser bridge cannot be canonical`)
}

const inventoryByDomain = new Map(inventory.domains.map((item) => [item.domain, item]))
for (const domain of WINDOWS_OWNER_DOMAINS) {
  const record = inventoryByDomain.get(domain)
  assert(record.canonicalRecords?.length > 0, `${domain} has no canonical record inventory`)
  assert(record.backupAdapter?.name, `${domain} has no backup adapter`)
  assert(record.revisionSource, `${domain} has no revision source`)
  assert(record.rollbackTarget, `${domain} has no rollback target`)
  assert(record.mediaReferences, `${domain} has no media reference boundary`)
  for (const item of [...record.canonicalRecords, ...(record.compatibilityKeys || []), ...(record.ephemeralOrPreferenceKeys || [])]) {
    assert(item.key && item.schemaVersion !== undefined, `${domain} record/key lacks key or schemaVersion`)
    assert(item.checksum || item.classification, `${domain} record/key lacks checksum/classification evidence`)
  }
}

const requiredMatrixFields = [
  'canonicalRecordsRef', 'currentOwner', 'readCallers', 'writeCallers', 'browserDirectWritersRef',
  'backupAdapter', 'revisionSource', 'mediaReferences', 'rollbackTarget', 'futureOwnerFacade',
  'querySurface', 'commandSurface', 'migrationWave', 'zeroGate',
]
const matrixByDomain = new Map(matrix.domains.map((item) => [item.domain, item]))
for (const domain of WINDOWS_OWNER_DOMAINS) {
  const item = matrixByDomain.get(domain)
  for (const field of requiredMatrixFields) assert(item[field] !== undefined, `${domain} ownership matrix missing ${field}`)
  assert(item.readCallers.length > 0, `${domain} has no read callers`)
  assert(item.writeCallers.length > 0, `${domain} has no write callers`)
  for (const caller of [...item.readCallers, ...item.writeCallers]) {
    assert(typeof caller.file === 'string' && caller.file.length > 0, `${domain} caller lacks source file`)
    assert(typeof caller.access === 'string' && caller.access.length > 0, `${domain} caller lacks access type`)
    await assertSourceExists(caller.file)
  }
}

assert(consumers.surfaceCoverage.IndexedDB.length > 0, 'consumer map lacks IndexedDB coverage')
assert(consumers.surfaceCoverage.localStorage.length > 0, 'consumer map lacks localStorage coverage')
assert(consumers.surfaceCoverage.rawJson.length > 0, 'consumer map lacks raw JSON coverage')
assert(consumers.surfaceCoverage.sqliteReadOnly.length > 0, 'consumer map lacks SQLite read-only coverage')
assert(consumers.surfaceCoverage.windowOrDomFacade.length > 0, 'consumer map lacks window/DOM facade coverage')
assert(consumers.surfaceCoverage.workflowClient.length > 0, 'consumer map lacks workflow client coverage')
const consumerIds = new Set()
for (const consumer of consumers.consumers) {
  assert(!consumerIds.has(consumer.id), `duplicate consumer id: ${consumer.id}`)
  consumerIds.add(consumer.id)
  assert(WINDOWS_OWNER_DOMAINS.includes(consumer.domain), `consumer ${consumer.id} has unknown domain`)
  assert(typeof consumer.directWriter === 'boolean', `consumer ${consumer.id} lacks directWriter flag`)
  assert(consumer.migrationWave, `consumer ${consumer.id} lacks migration wave`)
  assert(consumer.zeroGate, `consumer ${consumer.id} lacks zero gate`)
  const source = await readSource(consumer.file)
  const missingTokens = missingConsumerEvidenceTokens(consumer, source)
  assert(missingTokens.length === 0, `${consumer.id} lacks source evidence token(s): ${missingTokens.join(', ')}`)
}
assert(consumers.consumerCount === consumers.consumers.length, 'consumerCount does not match mapped consumers')
const missingRequiredConsumers = missingRequiredConsumerIds(consumerIds)
assert(missingRequiredConsumers.length === 0, `Reader Session consumer inventory is missing: ${missingRequiredConsumers.join(', ')}`)
const readerSessionMatrix = matrixByDomain.get('reader-session')
const missingReaderSessionMatrixRefs = missingMatrixConsumerRefs(
  consumers.consumers.filter((consumer) => consumer.domain === 'reader-session'),
  readerSessionMatrix.browserDirectWritersRef,
)
assert(
  missingReaderSessionMatrixRefs.length === 0,
  `Reader Session matrix is missing required consumer reference(s): ${missingReaderSessionMatrixRefs.join(', ')}`,
)
for (const [surface, ids] of Object.entries(consumers.surfaceCoverage)) {
  for (const id of ids) assert(consumerIds.has(id), `${surface} coverage references unknown consumer: ${id}`)
}
for (const domain of matrix.domains) {
  for (const id of domain.browserDirectWritersRef) assert(consumerIds.has(id), `${domain.domain} matrix references unknown consumer: ${id}`)
}

const compatibilityMap = await readJson('docs/architecture/compatibility-consumer-map.json')
assert(compatibilityMap.capture?.mode === 'isolated-vite-runtime', 'compatibility map capture mode changed')
assert(compatibilityMap.capture?.port === 0, 'compatibility map must remain canonicalized with port 0')
for (const key of ['compatibilitySurfaces', 'staticReaders', 'staticWriters', 'runtimeDefined', 'runtimeCalled', 'inlineHandlers', 'loadedScripts']) {
  assert(Number.isInteger(compatibilityMap.summary?.[key]), `compatibility map summary missing ${key}`)
}
assert(consumers.compatibilityMapSnapshot.summaryAtCapture.compatibilitySurfaces === compatibilityMap.summary.compatibilitySurfaces, 'compatibility surface count drifted')
assert(consumers.compatibilityMapSnapshot.summaryAtCapture.staticReaders === compatibilityMap.summary.staticReaders, 'compatibility reader count drifted')
assert(consumers.compatibilityMapSnapshot.summaryAtCapture.staticWriters === compatibilityMap.summary.staticWriters, 'compatibility writer count drifted')

assert(api.contractVersion === 'windows-thin-reader-api.v1', 'API contract version changed')
assert(api.implementationStatus === 'contract-only', 'API artifact must not claim implementation')
assert(api.requestEnvelopeSchema.required.includes('requestId'), 'request envelope must require requestId')
assert(api.requestEnvelopeSchema.required.includes('correlationId'), 'request envelope must require correlationId')
assert(api.requestEnvelopeSchema.required.includes('domain'), 'request envelope must require domain')
assert(api.requestEnvelopeSchema.required.includes('operation'), 'request envelope must require operation')
assert(api.responseEnvelopeSchema.required.includes('commitStatus'), 'response envelope must require commitStatus')
assert(api.responseEnvelopeSchema.required.includes('receipt'), 'response envelope must require receipt')
assert(api.responseEnvelopeSchema.required.includes('payload'), 'response envelope must require payload')
assert(api.responseEnvelopeSchema.properties.payload?.type === 'object', 'response envelope payload must be a typed object')
assert(api.receiptSchema.$ref === '#/$defs/receipt', 'receipt schema must be typed')
assert(api.typedErrorSchema.$ref === '#/$defs/typedError', 'typed error schema must be typed')
for (const field of ['requestId', 'correlationId', 'expectedRevision', 'idempotencyKey', 'commitStatus', 'receipt']) {
  assert(api.identityAndMutationRules[field], `API contract lacks ${field} semantics`)
}
assert(api.outcomeRules.some((item) => item.outcome === 'commit-unknown'), 'commit-unknown outcome is not registered')
assert(api.typedErrorCodes.some((item) => item.code === 'manual-recovery'), 'manual-recovery error is not registered')
assert(api.typedErrorCodes.some((item) => item.code === 'unsupported-schema'), 'unsupported-schema error is not registered')
for (const field of ['profileId', 'instanceId', 'expectedRevision', 'requestFingerprint', 'evidenceChecksum', 'evidenceSource']) {
  assert(api.$defs.receipt.required.includes(field), `receipt schema lacks ${field}`)
  assert(api.$defs.receipt.properties[field], `receipt schema does not define ${field}`)
}
assert(api.futureImplementationBoundary.implementedHere.includes('Host-owned profile-scoped receipt persistence/query'), 'receipt persistence implementation boundary is missing')
assert(!api.futureImplementationBoundary.notDefinedHere.includes('receipt persistence'), 'receipt persistence is still marked as unimplemented')
assert(api.futureImplementationBoundary.nextAllowedTask === '3.1 thin Reader API client', 'API contract next task must remain 3.1')
assert(api.healthCapabilityContract?.healthSchema === 'read-web-local-app-health.v1', 'health snapshot schema is missing')
assert(api.healthCapabilityContract?.capabilitySchema === 'read-web-local-capabilities.v1', 'capability snapshot schema is missing')
for (const field of ['liveness', 'applicationReadiness', 'durableOwnerReadiness', 'domains', 'profileLease', 'profileLeaseState', 'pendingRecovery', 'receiptSummary', 'schemaCompatibility', 'rangeMedia', 'dependencies']) {
  assert(api.healthCapabilityContract.requiredHealthFields.includes(field), `health snapshot contract lacks ${field}`)
  assert(api.healthCapabilityContract.requiredCapabilityFields.includes(field), `capability snapshot contract lacks ${field}`)
}
assert(api.healthCapabilityContract.domainCount === 6, 'health snapshot contract must cover six domains')
assert(api.healthCapabilityContract.capabilityEndpointCount === 9, 'capability snapshot contract must retain nine endpoints')
for (const field of ['mode', 'held', 'alive', 'profileBound', 'profileId', 'authoritativeLeaseHeld', 'authoritativeOperationsAllowed', 'status']) {
  assert(api.healthCapabilityContract.profileLeaseFields.includes(field), `profile lease snapshot contract lacks ${field}`)
}
assert(api.securityAndMediaBoundary.mediaPolicy.includes('complete Blob/ArrayBuffer'), 'media no-copy policy missing')
assert(api.securityAndMediaBoundary.queryTokenCompatibility.includes('/api/jobs/{jobId}/events'), 'event-stream query-token compatibility boundary is missing')
assert(api.securityAndMediaBoundary.queryTokenCompatibility.includes('owner durable API routes reject URL tokens'), 'owner URL-token prohibition is missing')
assert(api.futureImplementationBoundary.authorityReady === false, 'API contract cannot claim owner authority')
for (const registration of api.domainRegistry) {
  assert(registration.authorityReadyInThisMilestone === false, `${registration.domain} API registry claims readiness`)
  assert(registration.queryOperations.length > 0, `${registration.domain} API registry lacks query operations`)
  assert(registration.commandOperations.length > 0, `${registration.domain} API registry lacks command operations`)
  assert(registration.mutationRequirements.expectedRevision, `${registration.domain} API registry lacks expectedRevision rule`)
  assert(registration.mutationRequirements.idempotencyKey, `${registration.domain} API registry lacks idempotencyKey rule`)
}

const operationCapabilityRegistry = api.operationCapabilityRegistry
assert(operationCapabilityRegistry && typeof operationCapabilityRegistry === 'object', 'API operation capability registry is missing')
assert(Array.isArray(operationCapabilityRegistry.profileCapabilities), 'profile capability registry is missing')
assert(
  new Set(operationCapabilityRegistry.profileCapabilities).size === operationCapabilityRegistry.profileCapabilities.length,
  'profile capability registry contains duplicates',
)
assert(
  JSON.stringify(sortedDomains(Object.keys(operationCapabilityRegistry.domains || {}))) === JSON.stringify(sortedDomains(WINDOWS_OWNER_DOMAINS)),
  'operation capability registry does not cover exactly six domains',
)

function assertExplicitOperationMap(map, operations, allowedCapabilities, label) {
  assert(map && typeof map === 'object' && !Array.isArray(map), `${label} operation capability map is missing`)
  assert(
    JSON.stringify(sortedDomains(Object.keys(map))) === JSON.stringify(sortedDomains(operations)),
    `${label} operation capability map does not match registered operations`,
  )
  for (const operation of operations) {
    const capability = map[operation]
    assert(typeof capability === 'string' && capability.length > 0, `${label}.${operation} must have one capability`)
    assert(allowedCapabilities.has(capability), `${label}.${operation} references a capability outside its domain`)
  }
}

for (const registration of api.domainRegistry) {
  const domain = registration.domain
  const maps = operationCapabilityRegistry.domains[domain]
  const allowedCapabilities = new Set(registration.capabilities)
  assert(
    JSON.stringify(sortedDomains(Object.keys(maps || {}))) === JSON.stringify(sortedDomains(['query', 'command', 'receipt-query', 'capability-query', 'media-query'])),
    `${domain} operation capability map has an unknown request kind`,
  )
  assertExplicitOperationMap(maps.query, registration.queryOperations, allowedCapabilities, `${domain}.query`)
  assertExplicitOperationMap(maps.command, registration.commandOperations, allowedCapabilities, `${domain}.command`)
  assertExplicitOperationMap(maps['receipt-query'], ['receipt-query'], allowedCapabilities, `${domain}.receipt-query`)
  assert(maps['receipt-query']['receipt-query'] === `${domain}.receipt`, `${domain} receipt operation capability is not explicit`)
  assertExplicitOperationMap(maps['capability-query'], ['capabilities'], allowedCapabilities, `${domain}.capability-query`)
  assert(maps['capability-query'].capabilities === `${domain}.query`, `${domain} capability query mapping is not explicit`)
  const mediaOperations = domain === 'reader-session' ? ['media-identity'] : domain === 'workflow' ? ['media-capability'] : []
  assertExplicitOperationMap(maps['media-query'], mediaOperations, allowedCapabilities, `${domain}.media-query`)
  if (domain === 'workflow') assert(maps['media-query']['media-capability'] === 'workflow.media-range', 'workflow media capability mapping is not explicit')
}

const profileCapabilityRegistry = operationCapabilityRegistry.profile
const profileCapabilities = new Set(operationCapabilityRegistry.profileCapabilities)
assert(
  JSON.stringify(sortedDomains(Object.keys(profileCapabilityRegistry || {}))) === JSON.stringify(sortedDomains(['query', 'capability-query', 'backup-query', 'backup-command'])),
  'profile operation capability map has an unknown request kind',
)
assertExplicitOperationMap(profileCapabilityRegistry.query, ['capabilities', 'readiness', 'health'], profileCapabilities, 'profile.query')
assertExplicitOperationMap(profileCapabilityRegistry['capability-query'], ['capabilities'], profileCapabilities, 'profile.capability-query')
assertExplicitOperationMap(profileCapabilityRegistry['backup-query'], ['backup', 'manifest', 'backup-status', 'restore-status', 'inventory', 'dry-run'], profileCapabilities, 'profile.backup-query')
assertExplicitOperationMap(profileCapabilityRegistry['backup-command'], ['backup', 'restore', 'import', 'dry-run'], profileCapabilities, 'profile.backup-command')
assert(profileCapabilityRegistry.query.capabilities === 'profile.query', 'profile query capability mapping is not explicit')
assert(profileCapabilityRegistry['capability-query'].capabilities === 'profile.capability-query', 'profile capability-query mapping is not explicit')
for (const capability of profileCapabilityRegistry['backup-query'] ? Object.values(profileCapabilityRegistry['backup-query']) : []) {
  assert(capability === 'profile.backup-query', 'profile backup query capability mapping is not explicit')
}
for (const capability of profileCapabilityRegistry['backup-command'] ? Object.values(profileCapabilityRegistry['backup-command']) : []) {
  assert(capability === 'profile.backup-command', 'profile backup command capability mapping is not explicit')
}

assert(nonGoals.forbiddenCapabilities.includes('Windows owner repository implementation'), 'owner implementation non-goal missing')
assert(nonGoals.forbiddenCapabilities.includes('domain writer migration'), 'writer migration non-goal missing')
assert(nonGoals.forbiddenCapabilities.includes('profile lease/journal cutover'), 'cutover non-goal missing')

const tasks = await readFile(path.join(REPOSITORY_ROOT, 'openspec', 'changes', 'windows-local-owner-thin-reader', 'tasks.md'), 'utf8')
const allowedChecked = new Set(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7'])
for (const match of tasks.matchAll(/- \[([ xX])\] (\d+\.\d+)/gu)) {
  const checked = match[1].trim().toLowerCase() === 'x'
  if (checked !== allowedChecked.has(match[2])) throw new Error(`unexpected OpenSpec task checkbox state: ${match[2]}`)
}

console.log(`windows local owner contract passed (${WINDOWS_OWNER_DOMAINS.length} domains, ${consumers.consumers.length} mapped consumers)`)

async function assertSourceExists(relativePath) {
  await readSource(relativePath)
}

async function readSource(relativePath) {
  const cleanPath = relativePath.split(':')[0].replaceAll('\\', '/')
  try {
    return await readFile(path.join(REPOSITORY_ROOT, cleanPath), 'utf8')
  } catch (error) {
    throw new Error(`consumer source is missing: ${relativePath} (${error.code || error.message})`)
  }
}
