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
        const { checksum: _checksum, ...recordContent } = record
        const content = { ...recordContent }
        if (/^(?:reader-marks|reader-activity|reader-marks-commit-journal)\.json:/u.test(String(content.id || ''))
          && content.payload && typeof content.payload === 'object' && !Array.isArray(content.payload)
          && typeof content.payload.schemaVersion === 'string'
          && (content.schemaVersion === 1 || content.schemaVersion === content.payload.schemaVersion)) {
          // The Python owner creates a fresh updatedAt/checksum when a legacy
          // marks envelope is imported.  Compare the durable marks payload,
          // not those derived write-time fields.
          content.payload = clone(content.payload)
          delete content.payload.checksum
          delete content.payload.updatedAt
          if (content.payload.payload && typeof content.payload.payload === 'object'
            && !Array.isArray(content.payload.payload)) {
            delete content.payload.payload.updatedAt
            delete content.payload.payload.checksum
          }
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
      const apiClientSource = await readFile(
        path.join(repositoryRoot, 'src', 'services', 'windows-owner-api-client.js'),
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
      const apiClient = await import(dataUrl(
        apiClientSource.replace(
          "import apiContract from '../../docs/architecture/windows-local-owner-thin-reader/api-contract.json'",
          `const apiContract = ${JSON.stringify(apiContract)}`,
        ),
      ))
      return Object.freeze({
        createWindowsDurableStateMigration: migration.createWindowsDurableStateMigration,
        createWindowsOwnerLegacyCompatibilityBridge: bridge.createWindowsOwnerLegacyCompatibilityBridge,
        createWindowsOwnerApiClient: apiClient.createWindowsOwnerApiClient,
      })
    })()
  }
  return productionModulesPromise
}

function productionHostError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function createProductionHostFetch({ baseUrl, accessToken, fetchImpl = globalThis.fetch, migrationOnly = false } = {}) {
  if (typeof fetchImpl !== 'function') throw productionHostError('OWNER_CUTOVER_HOST_FETCH_UNAVAILABLE', 'Production Host fetch is unavailable')
  let root
  try { root = new URL(String(baseUrl || '')) } catch {
    throw productionHostError('OWNER_CUTOVER_HOST_URL_INVALID', 'Production Host URL is invalid')
  }
  if (!['http:', 'https:'].includes(root.protocol)
    || !['127.0.0.1', 'localhost', '::1'].includes(root.hostname.toLowerCase())) {
    throw productionHostError('OWNER_CUTOVER_HOST_URL_INVALID', 'Production Host URL must be loopback')
  }
  const token = String(accessToken || '').trim()
  if (!token) throw productionHostError('OWNER_CUTOVER_HOST_TOKEN_REQUIRED', 'Production Host access token is required')
  return (requestUrl, init = {}) => {
    const target = new URL(String(requestUrl), root)
    if (target.origin !== root.origin) {
      throw productionHostError('OWNER_CUTOVER_HOST_URL_INVALID', 'Production Host request must remain on the configured loopback origin')
    }
    const headers = { ...(init.headers || {}), 'X-Read-Web-Token': token }
    if (migrationOnly === true) headers['X-Read-Web-Owner-Migration'] = 'optimization'
    return fetchImpl(target, { ...init, headers })
  }
}

function hostResponsePayload(response, operation) {
  if (!response || response.outcome !== 'read') {
    throw productionHostError(
      'OWNER_CUTOVER_HOST_QUERY_FAILED',
      `Production Host ${operation} query did not return a readable result (${response?.outcome || 'missing'}:${response?.error?.code || 'unknown'})`,
    )
  }
  return response.payload && typeof response.payload === 'object' ? response.payload : {}
}

function hostRecord(id, schemaVersion, revision, contentId, payload, extra = {}) {
  return {
    id,
    schemaVersion,
    revision,
    contentId,
    payload: clone(payload),
    references: [],
    mediaReferences: [],
    ...extra,
  }
}

function emptyHostDomain() {
  return {
    schemaVersion: 1,
    adapterVersion: 1,
    revision: 0,
    records: [],
    references: [],
    mediaReferences: [],
  }
}

function readerHostSnapshot(response) {
  const payload = hostResponsePayload(response, 'reader-session')
  if (payload.found !== true || !payload.snapshot || typeof payload.snapshot !== 'object') return emptyHostDomain()
  const snapshot = payload.snapshot
  const revision = snapshot.revision
  const contentId = snapshot.contentId
  return {
    schemaVersion: 1,
    adapterVersion: 1,
    revision,
    records: [
      hostRecord('audioMeta', 1, revision, contentId, snapshot.audioMeta),
      hostRecord('chunkData', 1, revision, contentId, snapshot.chunkData),
      hostRecord('marks', 1, revision, contentId, {
        schemaVersion: 1,
        contentId,
        marks: snapshot.marks,
      }),
      hostRecord('readerSession', 3, revision, contentId, {
        schemaVersion: 3,
        contentId,
        revision,
      }),
      hostRecord('transcript', 1, revision, contentId, snapshot.transcript),
    ],
    references: [],
    mediaReferences: [],
  }
}

function recordById(snapshot, id) {
  return Array.isArray(snapshot?.records)
    ? snapshot.records.find((record) => String(record?.id || '') === id)
    : null
}

function readerCandidate(snapshot, profileId, expectedRevision) {
  const audioRecord = recordById(snapshot, 'audioMeta')
  const transcriptRecord = recordById(snapshot, 'transcript')
  const chunkRecord = recordById(snapshot, 'chunkData')
  const marksRecord = recordById(snapshot, 'marks')
  const audioMeta = audioRecord?.payload
  const mediaSource = audioMeta?.mediaIdentity || audioMeta?.media || snapshot?.media
  const marksPayload = marksRecord?.payload
  const marks = Array.isArray(marksPayload) ? marksPayload : marksPayload?.marks
  if (!audioMeta || !transcriptRecord?.payload || !chunkRecord?.payload || !marksRecord
    || !Array.isArray(marks) || !mediaSource || typeof mediaSource !== 'object') {
    throw productionHostError('OWNER_CUTOVER_HOST_IMPORT_INVALID', 'Reader Session backup has no complete Host candidate')
  }
  const media = { ...mediaSource }
  if (!media.authorizedUrl && typeof media.authorizedReference === 'string') media.authorizedUrl = media.authorizedReference
  delete media.authorizedReference
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw productionHostError('OWNER_CUTOVER_HOST_REVISION_INVALID', 'Reader Session Host revision must be numeric')
  }
  return {
    schemaVersion: 'reader-session-owner.v1',
    domain: 'reader-session',
    profileId,
    contentId: String(audioRecord.contentId || audioMeta.contentId || ''),
    revision: expectedRevision + 1,
    audioMeta,
    transcript: transcriptRecord.payload,
    chunkData: chunkRecord.payload,
    marks,
    media,
  }
}

function createReaderHostAdapter({ client, profileId }) {
  return {
    key: 'reader-session',
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      const response = await client.query({ domain: 'reader-session', operation: 'snapshot', payload: {} })
      return readerHostSnapshot(response)
    },
    async restoreRecords(snapshot, context = {}) {
      const candidate = readerCandidate(snapshot, profileId, context.expectedRevision)
      const prepared = await client.command({
        domain: 'reader-session',
        operation: 'prepare',
        payload: { candidate },
      })
      if (prepared?.outcome !== 'read' || typeof prepared.payload?.prepare?.prepareId !== 'string') {
        throw productionHostError('OWNER_CUTOVER_HOST_PREPARE_FAILED', 'Reader Session Host prepare was not accepted')
      }
      return client.command({
        domain: 'reader-session',
        operation: 'commit',
        payload: { prepareId: prepared.payload.prepare.prepareId },
        expectedRevision: context.expectedRevision,
        idempotencyKey: context.idempotencyKey,
      })
    },
  }
}

function safeMarksScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw productionHostError('OWNER_CUTOVER_HOST_SCOPE_REQUIRED', 'Marks/activity Host scope is required')
  }
  const jobId = String(scope.jobId || '')
  const contentId = String(scope.contentId || jobId)
  if (!jobId || !contentId || jobId.length > 128 || contentId.length > 128
    || /[\\/\u0000-\u001f\u007f]/u.test(jobId) || /[\\/\u0000-\u001f\u007f]/u.test(contentId)) {
    throw productionHostError('OWNER_CUTOVER_HOST_SCOPE_INVALID', 'Marks/activity Host scope is invalid')
  }
  return { jobId, contentId }
}

function marksHostSnapshot(response, scope) {
  const payload = hostResponsePayload(response, 'marks-activity')
  if (payload.found !== true || payload.empty === true) return emptyHostDomain()
  const revision = payload.revision
  const marks = Array.isArray(payload.marks) ? payload.marks : []
  const envelope = {
    schemaVersion: 'reader-marks.v1',
    domain: 'reader-marks',
    jobId: scope.jobId,
    revision,
    updatedAt: '',
    payload: { jobId: scope.jobId, marks, updatedAt: '' },
  }
  const reference = { type: 'workflow-job', id: scope.jobId }
  return {
    schemaVersion: 1,
    adapterVersion: 1,
    revision,
    records: [hostRecord(
      'reader-marks.json:_workflow/reader-marks.json',
      1,
      revision,
      scope.jobId,
      envelope,
      { references: [reference], mediaReferences: [] },
    )],
    references: [reference],
    mediaReferences: [],
  }
}

function ownerRecordToBackupRecord(id, record) {
  const content = record && typeof record === 'object' && !Array.isArray(record) && 'content' in record
    ? record.content
    : record
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw productionHostError('OWNER_CUTOVER_HOST_QUERY_INVALID', 'Host owner record content is invalid')
  }
  const schemaVersion = record?.schemaVersion
    ?? content.schemaVersion
    ?? content.schema_version
    ?? 1
  const revision = record && Object.prototype.hasOwnProperty.call(record, 'revision')
    ? record.revision
    : (Number.isInteger(content.revision) ? content.revision : null)
  return hostRecord(id, schemaVersion, revision, record?.contentId ?? null, content, {
    references: Array.isArray(record?.references) ? clone(record.references) : [],
    mediaReferences: Array.isArray(record?.mediaReferences) ? clone(record.mediaReferences) : [],
  })
}

function ownerRecordsHostSnapshot(records, revision, references = [], mediaReferences = []) {
  return {
    schemaVersion: 1,
    adapterVersion: 1,
    revision,
    records: Object.entries(records)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, record]) => ownerRecordToBackupRecord(id, record)),
    references: clone(references),
    mediaReferences: clone(mediaReferences),
  }
}

function responseRecords(response, operation) {
  const payload = hostResponsePayload(response, operation)
  return {
    revision: payload.revision ?? response.revision ?? 0,
    records: payload.records && typeof payload.records === 'object' && !Array.isArray(payload.records)
      ? payload.records
      : {},
  }
}

async function queryOwnerRecords(client, domain, operations, payload = {}) {
  const responses = await Promise.all(operations.map((operation) => client.query({
    domain,
    operation,
    payload,
  })))
  const records = {}
  let revision = 0
  for (const [index, response] of responses.entries()) {
    const selected = responseRecords(response, operations[index])
    revision = selected.revision
    Object.assign(records, selected.records)
  }
  return { records, revision }
}

function recordsPayload(snapshot) {
  return Object.fromEntries((snapshot?.records || []).map((record) => [record.id, record.payload]))
}

function ownerRecordsPayload(snapshot) {
  return Object.fromEntries((snapshot?.records || []).map((record) => {
    const ownerRecord = {
      id: record.id,
      content: clone(record.payload ?? record.content),
    }
    for (const field of ['timestamp', 'revision', 'contentId']) {
      if (record[field] !== undefined && record[field] !== null) ownerRecord[field] = record[field]
    }
    return [record.id, ownerRecord]
  }))
}

function createPassagePreviewHostAdapter({ client }) {
  const queryOperations = ['durable-state', 'preview-batch', 'progress', 'continuation', 'archive', 'legacy-keys']
  return {
    key: 'passage-preview',
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      const selected = await queryOwnerRecords(client, 'passage-preview', queryOperations)
      return ownerRecordsHostSnapshot(selected.records, selected.revision)
    },
    async restoreRecords(snapshot, context = {}) {
      return client.command({
        domain: 'passage-preview',
        operation: 'legacy-import',
        payload: { records: recordsPayload(snapshot) },
        expectedRevision: context.expectedRevision,
        idempotencyKey: context.idempotencyKey,
      })
    },
  }
}

function safeAnnotationScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)
    || typeof scope.audioKey !== 'string' || !scope.audioKey
    || typeof scope.documentId !== 'string' || !scope.documentId) {
    throw productionHostError('OWNER_CUTOVER_HOST_SCOPE_REQUIRED', 'Annotation Host scope is required')
  }
  return { audioKey: scope.audioKey, documentId: scope.documentId }
}

function createAnnotationHostAdapter({ client, scope }) {
  const fixedScope = safeAnnotationScope(scope)
  return {
    key: 'annotation',
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      const selected = await queryOwnerRecords(client, 'annotation', ['scope'], { scope: fixedScope })
      return ownerRecordsHostSnapshot(selected.records, selected.revision)
    },
    async restoreRecords(snapshot, context = {}) {
      return client.command({
        domain: 'annotation',
        operation: 'lightweight-import',
        payload: { scope: fixedScope, records: recordsPayload(snapshot) },
        expectedRevision: context.expectedRevision,
        idempotencyKey: context.idempotencyKey,
      })
    },
  }
}

function createVocabularySrsHostAdapter({ client }) {
  return {
    key: 'vocabulary-srs',
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      const selected = await queryOwnerRecords(client, 'vocabulary-srs', ['snapshot'])
      return ownerRecordsHostSnapshot(selected.records, selected.revision)
    },
    async restoreRecords(snapshot, context = {}) {
      const records = ownerRecordsPayload(snapshot)
      const keys = Object.keys(records)
      if (keys.length === 0) return { ok: true, status: 'committed', revision: context.expectedRevision }
      const supported = new Set(['vocabulary.srs.store.v1'])
      if (keys.some((key) => !supported.has(key))) {
        throw productionHostError('OWNER_CUTOVER_HOST_IMPORT_INVALID', 'Vocabulary migration fixture contains records outside the entry command')
      }
      return client.command({
        domain: 'vocabulary-srs',
        operation: 'entry-upsert',
        payload: { records },
        expectedRevision: context.expectedRevision,
        idempotencyKey: context.idempotencyKey,
      })
    },
  }
}

function workflowRecord(id, content, revision, contentId = null) {
  return hostRecord(id, 1, revision, contentId, content)
}

function createWorkflowHostAdapter({ client }) {
  return {
    key: 'workflow',
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      const operations = ['job', 'history', 'reader-index', 'config']
      const responses = await Promise.all(operations.map((operation) => client.query({
        domain: 'workflow',
        operation,
        payload: {},
      })))
      const records = []
      let revision = 0
      const jobs = responses[0]?.payload?.records || []
      const history = responses[1]?.payload?.records || []
      const readerIndex = responses[2]?.payload?.records || []
      for (const response of responses) revision = response.revision ?? revision
      for (const item of jobs) {
        const jobId = String(item?.jobId || '')
        if (jobId) records.push(workflowRecord(`jobs:${jobId}`, item, responses[0].payload.sourceRevision ?? revision, jobId))
      }
      for (const item of history) {
        const jobId = String(item?.jobId || '')
        if (jobId) records.push(workflowRecord(`items:${jobId}`, item, responses[1].payload.sourceRevision ?? revision, jobId))
      }
      for (const item of readerIndex) {
        const jobId = String(item?.jobId || `reader-index-${records.length}`)
        records.push(workflowRecord(`reader-index:${jobId}`, item, 0, jobId))
      }
      const config = responses[3]?.payload?.config
      if (config?.configured) {
        records.push(workflowRecord('config', {
          model: config.model || '',
          baseUrl: config.baseUrl || '',
          proxyUrl: config.proxyUrl || '',
        }, 0))
      }
      if (records.length === 0 && !config?.configured) revision = 0
      records.sort((left, right) => left.id.localeCompare(right.id))
      return {
        schemaVersion: 1,
        adapterVersion: 1,
        revision,
        records,
        references: [],
        mediaReferences: [],
      }
    },
    async restoreRecords(snapshot, context = {}) {
      const records = Array.isArray(snapshot?.records) ? snapshot.records : []
      if (records.length === 0) return { ok: true, status: 'committed', revision: context.expectedRevision }
      const nonConfig = records.filter((record) => record.id !== 'config' && !String(record.id).startsWith('reader-index:'))
      if (nonConfig.length > 0) {
        throw productionHostError('OWNER_CUTOVER_HOST_IMPORT_INVALID', 'Workflow migration fixture contains job/history records without a single-command import seam')
      }
      let result = { ok: true, status: 'committed', revision: context.expectedRevision }
      const indexRecord = records.find((record) => String(record.id).startsWith('reader-index:'))
      if (indexRecord) {
        result = await client.command({
          domain: 'workflow',
          operation: 'reader-index-commit',
          payload: { readerIndex: { items: [indexRecord.payload] } },
          expectedRevision: context.expectedRevision,
          idempotencyKey: context.idempotencyKey,
        })
      }
      const configRecord = records.find((record) => record.id === 'config')
      if (configRecord) {
        result = await client.command({
          domain: 'workflow',
          operation: 'config-commit',
          payload: { config: configRecord.payload },
          expectedRevision: result.revision ?? context.expectedRevision,
          idempotencyKey: `${context.idempotencyKey}-config`,
        })
      }
      return result
    },
  }
}

function createMarksHostAdapter({ client, scope }) {
  const fixedScope = safeMarksScope(scope)
  return {
    key: 'marks-activity',
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      const response = await client.query({
        domain: 'marks-activity',
        operation: 'marks',
        payload: fixedScope,
      })
      return marksHostSnapshot(response, fixedScope)
    },
    async restoreRecords(snapshot, context = {}) {
      const record = Array.isArray(snapshot?.records)
        ? snapshot.records.find((candidate) => String(candidate?.id || '').startsWith('reader-marks.json:'))
        : null
      if (!record?.payload || typeof record.payload !== 'object') return { status: 'committed', revision: context.expectedRevision }
      const envelope = record.payload
      const marks = Array.isArray(envelope.payload?.marks)
        ? envelope.payload.marks
        : (Array.isArray(envelope.marks) ? envelope.marks : null)
      if (!marks) throw productionHostError('OWNER_CUTOVER_HOST_IMPORT_INVALID', 'Marks/activity backup has no marks array')
      const jobId = String(envelope.jobId || fixedScope.jobId)
      const contentId = String(envelope.payload?.jobId || record.contentId || fixedScope.contentId)
      return client.command({
        domain: 'marks-activity',
        operation: 'marks-commit',
        payload: { jobId, contentId, marks },
        expectedRevision: context.expectedRevision,
        idempotencyKey: context.idempotencyKey,
      })
    },
  }
}

function createProductionHostAdapters({ client, profileId, hostScopeByDomain = {} } = {}) {
  if (!client || typeof client.query !== 'function' || typeof client.command !== 'function') {
    throw productionHostError('OWNER_CUTOVER_HOST_CLIENT_INVALID', 'Production Host typed client is required')
  }
  const adapters = {
    'reader-session': createReaderHostAdapter({ client, profileId }),
    'marks-activity': createMarksHostAdapter({ client, scope: hostScopeByDomain['marks-activity'] }),
    'passage-preview': createPassagePreviewHostAdapter({ client }),
    'vocabulary-srs': createVocabularySrsHostAdapter({ client }),
    workflow: createWorkflowHostAdapter({ client }),
  }
  adapters.annotation = hostScopeByDomain.annotation
    ? createAnnotationHostAdapter({ client, scope: hostScopeByDomain.annotation })
    : {
      key: 'annotation',
      schemaVersion: 1,
      adapterVersion: 1,
      supportedSchemaVersions: [1],
      async collect() {
        throw productionHostError('OWNER_CUTOVER_HOST_SCOPE_REQUIRED', 'Annotation Host scope is required')
      },
    }
  return adapters
}

export async function createWindowsOwnerProductionHostClient(options = {}) {
  if (options.client && typeof options.client.query === 'function') return options.client
  const migrationOnly = options.migrationOnly === true
  if (migrationOnly && (options.mode !== 'optimization' || options.explicitOptIn !== true)) {
    throw productionHostError(
      'OWNER_CUTOVER_MIGRATION_OPT_IN_REQUIRED',
      'Production Host migration access requires explicit optimization opt-in',
    )
  }
  const { createWindowsOwnerApiClient } = await loadProductionModules()
  return createWindowsOwnerApiClient({
    profileId: options.profileId,
    instanceId: options.instanceId,
    fetchImpl: createProductionHostFetch({
      baseUrl: options.baseUrl,
      accessToken: options.accessToken,
      fetchImpl: options.fetchImpl,
      migrationOnly,
    }),
    timeoutMs: options.timeoutMs,
  })
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
  if (!Array.isArray(domains) || domains.length === 0 || domains.some((domain) => !DOMAINS.includes(domain))) {
    const error = new Error('Production owner cutover domain is not registered')
    error.code = 'OWNER_CUTOVER_PRODUCTION_DOMAIN_INVALID'
    throw error
  }
  const indexes = domains.map((domain) => DOMAINS.indexOf(domain))
  if (new Set(indexes).size !== indexes.length || indexes.some((index, position) => index !== position)) {
    const error = new Error('Production owner domains must follow the fixed cutover order')
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
  return ['marks-activity', 'workflow'].flatMap((domain) => {
    const adapter = sourceComposition?.pythonAdapters?.[domain]
    if (!adapter || typeof adapter.collect !== 'function') return []
    return [{
      kind: 'json',
      sourceId: `backup.${domain}`,
      defaultSchemaVersion: 1,
      read: async () => {
        const snapshot = await adapter.collect({ domain })
        return {
          records: (Array.isArray(snapshot?.records) ? snapshot.records : []).map((record) => ({
            ...record,
            key: record?.id,
            schemaVersion: record?.payload?.schemaVersion ?? record?.schemaVersion,
          })),
        }
      },
    }]
  })
}

/**
 * Explicit local/optimization entry for the fixed C2 domain order.  The
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
  })
  const targetLayout = productionLayout(targetComposition)

  const { createWindowsDurableStateMigration, createWindowsOwnerLegacyCompatibilityBridge } = await loadProductionModules()
  const hostClient = await createWindowsOwnerProductionHostClient({
    client: options.hostClient,
    baseUrl: options.hostBaseUrl,
    accessToken: options.hostAccessToken,
    profileId,
    instanceId: options.hostInstanceId || profileId,
    fetchImpl: options.hostFetchImpl,
    timeoutMs: options.hostTimeoutMs,
    migrationOnly: true,
    mode: options.mode,
    explicitOptIn: options.explicitOptIn,
  })
  const hostAdapters = createProductionHostAdapters({
    client: hostClient,
    profileId,
    hostScopeByDomain: options.hostScopeByDomain,
  })
  if (domains.some((domain) => !hostAdapters[domain])) {
    throw productionHostError('OWNER_CUTOVER_PRODUCTION_COMPOSITION_INVALID', 'Production Host owner adapter is missing')
  }
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
      if (current?.revision !== revision || expected === undefined || !equivalentDomain(current, expected)) {
        return { ok: false, reasonCode: 'OWNER_CUTOVER_SMOKE_QUERY_FAILED' }
      }
      const smoke = options.smokeByDomain?.[domain]
      if (typeof smoke !== 'function') return { ok: true, queried: true, mutation: 'not-run' }
      const result = await smoke({ domain, revision, client: hostClient, adapter: hostAdapters[domain] })
      if (result === false || result?.ok === false) return result || { ok: false, reasonCode: 'OWNER_CUTOVER_SMOKE_MUTATION_FAILED' }
      return { ok: true, queried: true, mutation: result || 'passed' }
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
        const observedFrozenDomains = Array.isArray(refreshed?.frozenDomains) ? refreshed.frozenDomains : []
        if (refreshed === false || refreshed?.ok === false || !observedFrozenDomains.includes(domain)) {
          return {
            ...(refreshed && typeof refreshed === 'object' ? refreshed : {}),
            ok: false,
            reasonCode: refreshed?.reasonCode || 'migration-browser-freeze-not-observed',
          }
        }
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
