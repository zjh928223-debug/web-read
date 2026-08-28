import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  REPOSITORY_ROOT,
  WINDOWS_OWNER_DOMAINS,
  assert,
  loadOwnerArtifacts,
  missingConsumerEvidenceTokens,
  missingRequiredConsumerIds,
  readJson,
} from './lib/windows-local-owner-artifacts.mjs'

const artifacts = await loadOwnerArtifacts()
const inventory = artifacts['domain-inventory.json']
const matrix = artifacts['ownership-matrix.json']
const consumers = artifacts['browser-direct-writer-consumer-map.json']
const api = artifacts['api-contract.json']
const nonGoals = artifacts['non-goals.json']

const sortedDomains = (values) => [...values].sort()
const inventoryDomains = inventory.domains.map((item) => item.domain)
const matrixDomains = matrix.domains.map((item) => item.domain)
const registryDomains = api.domainRegistry.map((item) => item.domain)
assert(JSON.stringify(sortedDomains(inventoryDomains)) === JSON.stringify(sortedDomains(WINDOWS_OWNER_DOMAINS)), 'inventory does not cover exactly six required domains')
assert(JSON.stringify(sortedDomains(matrixDomains)) === JSON.stringify(sortedDomains(WINDOWS_OWNER_DOMAINS)), 'ownership matrix does not cover exactly six required domains')
assert(JSON.stringify(sortedDomains(registryDomains)) === JSON.stringify(sortedDomains(WINDOWS_OWNER_DOMAINS)), 'API registry does not cover exactly six required domains')

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
assert(api.receiptSchema.$ref === '#/$defs/receipt', 'receipt schema must be typed')
assert(api.typedErrorSchema.$ref === '#/$defs/typedError', 'typed error schema must be typed')
for (const field of ['requestId', 'correlationId', 'expectedRevision', 'idempotencyKey', 'commitStatus', 'receipt']) {
  assert(api.identityAndMutationRules[field], `API contract lacks ${field} semantics`)
}
assert(api.outcomeRules.some((item) => item.outcome === 'commit-unknown'), 'commit-unknown outcome is not registered')
assert(api.typedErrorCodes.some((item) => item.code === 'manual-recovery'), 'manual-recovery error is not registered')
assert(api.typedErrorCodes.some((item) => item.code === 'unsupported-schema'), 'unsupported-schema error is not registered')
assert(api.securityAndMediaBoundary.mediaPolicy.includes('complete Blob/ArrayBuffer'), 'media no-copy policy missing')
assert(api.futureImplementationBoundary.authorityReady === false, 'API contract cannot claim owner authority')
for (const registration of api.domainRegistry) {
  assert(registration.authorityReadyInThisMilestone === false, `${registration.domain} API registry claims readiness`)
  assert(registration.queryOperations.length > 0, `${registration.domain} API registry lacks query operations`)
  assert(registration.commandOperations.length > 0, `${registration.domain} API registry lacks command operations`)
  assert(registration.mutationRequirements.expectedRevision, `${registration.domain} API registry lacks expectedRevision rule`)
  assert(registration.mutationRequirements.idempotencyKey, `${registration.domain} API registry lacks idempotencyKey rule`)
}

assert(nonGoals.forbiddenCapabilities.includes('Windows owner repository implementation'), 'owner implementation non-goal missing')
assert(nonGoals.forbiddenCapabilities.includes('domain writer migration'), 'writer migration non-goal missing')
assert(nonGoals.forbiddenCapabilities.includes('profile lease/journal cutover'), 'cutover non-goal missing')

const tasks = await readFile(path.join(REPOSITORY_ROOT, 'openspec', 'changes', 'windows-local-owner-thin-reader', 'tasks.md'), 'utf8')
const allowedChecked = new Set(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '2.1'])
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
