import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
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
  const legacyWriterControl = options.legacyWriterControl && typeof options.legacyWriterControl === 'object'
    ? options.legacyWriterControl
    : null
  return Object.fromEntries(DOMAINS.map((domain) => [domain, {
    async freeze({ domain: requestedDomain, reason }) {
      if (requestedDomain !== domain) return { ok: false, reasonCode: 'OWNER_CUTOVER_DOMAIN_MISMATCH' }
      let legacyResult = null
      let legacyFrozen = false
      if (domain === 'workflow' && typeof legacyWriterControl?.freeze === 'function') {
        legacyResult = await legacyWriterControl.freeze({ domain, reason })
        if (legacyResult === false || legacyResult?.ok === false) {
          return { ok: false, reasonCode: legacyResult?.reasonCode || 'OWNER_CUTOVER_LEGACY_WRITER_FREEZE_FAILED' }
        }
        legacyFrozen = true
      }
      try {
        const result = await writeOwnerModeFreeze({ ...common, domain, reason })
        return {
          ok: true,
          status: result.status,
          frozen: true,
          legacyWriter: legacyResult,
        }
      } catch (error) {
        if (legacyFrozen && typeof legacyWriterControl?.unfreeze === 'function') {
          await legacyWriterControl.unfreeze({ domain, reason: 'migration-freeze-failed' }).catch(() => {})
        }
        throw error
      }
    },
    async unfreeze({ domain: requestedDomain, reason }) {
      if (requestedDomain !== domain) return { ok: false, reasonCode: 'OWNER_CUTOVER_DOMAIN_MISMATCH' }
      const result = await clearOwnerModeFreeze({ ...common, domain })
      if (domain === 'workflow'
        && reason !== 'migration-authoritative'
        && typeof legacyWriterControl?.unfreeze === 'function') {
        await legacyWriterControl.unfreeze({ domain, reason: reason || 'migration-unfreeze' })
      }
      return {
        ok: true,
        status: result.status,
        frozen: false,
        legacyWriter: domain === 'workflow' && reason === 'migration-authoritative'
          ? { ok: true, status: 'retired', writerBlocked: true }
          : null,
      }
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

function equivalentDomain(left, right, domain = null) {
  const comparable = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.records)) return value
    const normalized = {
      ...value,
      records: value.records
        .filter((record) => {
          if (domain !== 'reader-session') return true
          const id = String(record?.id || '')
          // Quarantine evidence and retry outbox rows remain in the retained
          // migration artifact, but they are not part of the Host reader
          // session candidate contract.  The Host owns the five canonical
          // session rows; compatibility-only rows are intentionally not
          // replayed as canonical state.
          return !id.startsWith('readerSessionQuarantine:')
            && !id.startsWith('read-web.reader-save-outbox.')
        })
        .filter((record) => {
          if (domain !== 'marks-activity') return true
          // The legacy commit journal is receipt evidence.  The Host keeps
          // its own journal internally and exposes only its revision through
          // the marks-activity query contract, so it is not a canonical
          // migration record to compare or replay.
          return !String(record?.id || '').startsWith('reader-marks-commit-journal.json:')
        })
        .map((record) => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) return record
        const { checksum: _checksum, ...recordContent } = record
        const content = { ...recordContent }
        if (domain === 'workflow' || domain === 'passage-preview' || domain === 'annotation') {
          // The source backup revision is the legacy document/file revision;
          // the Host owns a separate outer CAS revision for its snapshot.
          delete content.revision
        }
        if (domain === 'reader-session') {
          // The browser backup adapter retains the source row revision, while
          // the Host assigns a new numeric owner revision.  The owner reader
          // candidate also wraps the browser marks array and keeps only the
          // manifest identity fields in readerSession.
          delete content.revision
          const sessionContentId = value.records.find((item) => (
            item?.id === 'audioMeta' || item?.id === 'readerSession'
          ))?.contentId || null
          if (content.id === 'marks') {
            const marks = Array.isArray(content.payload) ? content.payload : content.payload?.marks
            content.contentId = content.contentId || sessionContentId
            content.payload = {
              schemaVersion: 1,
              contentId: content.contentId,
              marks: Array.isArray(marks) ? marks : [],
            }
          } else if (content.id === 'readerSession' && content.payload && typeof content.payload === 'object'
            && !Array.isArray(content.payload)) {
            content.payload = {
              schemaVersion: content.payload.schemaVersion,
              contentId: content.payload.contentId || content.contentId || sessionContentId,
            }
          }
        }
        if (/^(?:reader-marks|reader-activity|reader-marks-commit-journal)\.json:/u.test(String(content.id || ''))
          && content.payload && typeof content.payload === 'object' && !Array.isArray(content.payload)
          && typeof content.payload.schemaVersion === 'string'
          && (content.schemaVersion === 1 || content.schemaVersion === content.payload.schemaVersion)) {
          // The Python owner creates a fresh updatedAt/checksum when a legacy
          // marks envelope is imported.  Compare the durable marks payload,
          // not those derived write-time fields.
          const legacyEnvelope = clone(content.payload)
          const durablePayload = legacyEnvelope.payload && typeof legacyEnvelope.payload === 'object'
            && !Array.isArray(legacyEnvelope.payload)
            ? clone(legacyEnvelope.payload)
            : (String(content.id || '').startsWith('reader-marks.json:')
              ? { jobId: legacyEnvelope.jobId, marks: Array.isArray(legacyEnvelope.marks) ? legacyEnvelope.marks : [] }
              : { ...legacyEnvelope })
          delete durablePayload.updatedAt
          delete durablePayload.checksum
          delete durablePayload.revision
          if (String(content.id || '').startsWith('reader-activity.json:')) {
            // Legacy activity keeps operation-id receipts in the JSON row;
            // the Host keeps those receipts in its private commit journal.
            delete durablePayload._activityOperationIds
          }
          content.payload = {
            schemaVersion: legacyEnvelope.schemaVersion,
            domain: legacyEnvelope.domain,
            jobId: legacyEnvelope.jobId || durablePayload.jobId,
            payload: durablePayload,
          }
          delete content.revision
          delete content.schemaVersion
        }
        if (domain === 'workflow') {
          for (const field of ['references', 'mediaReferences']) {
            if (Array.isArray(content[field])) {
              content[field] = content[field].slice().sort((left, right) => (
                canonical(left).localeCompare(canonical(right))
              ))
            }
          }
        }
        return content
      })
        .sort((left, right) => String(left?.id || '').localeCompare(String(right?.id || ''))),
    }
    if (domain === 'marks-activity') {
      // Source files carry per-file and aggregate revisions, while the Host
      // exposes owner-local CAS revisions after the import.  References are
      // collected once per legacy record and therefore may contain duplicates.
      delete normalized.revision
      const references = Array.isArray(normalized.references) ? normalized.references : []
      normalized.references = references.filter((reference, index) => (
        references.findIndex((candidate) => canonical(candidate) === canonical(reference)) === index
      ))
    }
    if (domain === 'workflow') {
      // Workflow references are derived from the records and may be repeated
      // once per output file.  Media references are also derived metadata:
      // the staged source deliberately excludes media bytes, while the Host
      // may rebind an identity reference from the real output root.  Media
      // integrity is checked separately through the authorized media range
      // smoke check, so it must not turn equivalent durable JSON into a
      // false migration mismatch.
      const references = Array.isArray(normalized.references) ? normalized.references : []
      normalized.references = references
        .filter((reference, index) => (
          references.findIndex((candidate) => canonical(candidate) === canonical(reference)) === index
        ))
        .sort((left, right) => canonical(left).localeCompare(canonical(right)))
      normalized.mediaReferences = []
    }
    if (domain === 'passage-preview' || domain === 'annotation' || domain === 'vocabulary-srs') delete normalized.revision
    return normalized
  }
  const leftComparable = comparable(left)
  const rightComparable = comparable(right)
  const leftRevision = leftComparable?.revision
  const rightRevision = rightComparable?.revision
  if ((Number.isInteger(leftRevision) && typeof rightRevision === 'string')
    || (typeof leftRevision === 'string' && Number.isInteger(rightRevision))) {
    // Workflow backup revisions are numeric source-file versions, while the
    // Host owner exposes the composite revision used for CAS.  The records,
    // references, and payloads remain the equality evidence across domains.
    delete leftComparable.revision
    delete rightComparable.revision
  }
  return canonical(leftComparable) === canonical(rightComparable)
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
        createMemoryMigrationStateStore: migration.createMemoryMigrationStateStore,
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

const MEDIA_CONTENT_TYPES = Object.freeze({
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
})

function safeRelativeMediaPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const normalized = value.trim().replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return null
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '..')) return null
  return parts.join('/')
}

function sourceWorkflowRecord(snapshot, jobId) {
  return recordById(snapshot, `jobs:${jobId}`) || recordById(snapshot, `items:${jobId}`)
}

function sourceWorkflowMediaPath(snapshot, jobId) {
  const record = sourceWorkflowRecord(snapshot, jobId)
  const payload = record?.payload
  const manifest = payload?.manifest
  const files = manifest?.files || payload?.files || manifest?.checkpoint?.files || payload?.checkpoint?.files
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null
  const mediaKind = typeof files.audio === 'string' && files.audio ? 'audio'
    : (typeof files.video === 'string' && files.video ? 'video' : null)
  if (!mediaKind) return null
  const relativePath = safeRelativeMediaPath(files[mediaKind])
  if (!relativePath) return null
  const references = Array.isArray(snapshot?.mediaReferences) ? snapshot.mediaReferences : []
  const reference = references.find((item) => (
    safeRelativeMediaPath(item?.relativePath) === relativePath
      || safeRelativeMediaPath(item?.identity) === relativePath
  ))
  if (!reference) return null
  return { mediaKind, relativePath, reference }
}

async function deriveReaderMediaDescriptor(snapshot, sourceWorkflowSnapshot, sourceWorkflowOutputDir) {
  if (!sourceWorkflowSnapshot || typeof sourceWorkflowSnapshot !== 'object'
    || !sourceWorkflowOutputDir || typeof sourceWorkflowOutputDir !== 'string') return null
  const audioRecord = recordById(snapshot, 'audioMeta')
  const contentId = String(audioRecord?.contentId || audioRecord?.payload?.contentId || '')
  const audioMeta = audioRecord?.payload
  const jobId = String(audioMeta?.jobId || contentId.replace(/^youtube-workflow:/u, ''))
  if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(jobId)) return null
  const sourceMedia = sourceWorkflowMediaPath(sourceWorkflowSnapshot, jobId)
  if (!sourceMedia) return null
  const outputRoot = path.resolve(sourceWorkflowOutputDir)
  const mediaPath = path.resolve(outputRoot, ...sourceMedia.relativePath.split('/'))
  const relative = path.relative(outputRoot, mediaPath)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null
  let mediaStat
  try {
    mediaStat = await stat(mediaPath, { bigint: true })
  } catch {
    return null
  }
  if (!mediaStat.isFile() || mediaStat.size < 0n || mediaStat.size > BigInt(Number.MAX_SAFE_INTEGER)) return null
  const mediaSize = Number(mediaStat.size)
  if (Number.isSafeInteger(sourceMedia.reference?.sizeBytes)
    && sourceMedia.reference.sizeBytes !== mediaSize) return null
  const extension = path.extname(mediaPath).toLowerCase()
  const contentType = MEDIA_CONTENT_TYPES[extension]
  if (!contentType) return null
  const mediaId = `workflow:${jobId}:${sourceMedia.mediaKind}`
  const modifiedNs = mediaStat.mtimeNs.toString()
  const etag = `sha256:${createHash('sha256').update(`${mediaId}:${mediaSize}:${modifiedNs}`, 'utf8').digest('hex')}`
  const revision = sourceWorkflowSnapshot.revision
  if (!Number.isInteger(revision) || revision < 0) return null
  return {
    mediaId,
    kind: sourceMedia.mediaKind,
    size: mediaSize,
    contentType,
    etag,
    revision,
    authorizedUrl: `/api/jobs/${jobId}/media/${sourceMedia.mediaKind}`,
  }
}

async function readerCandidate(snapshot, profileId, expectedRevision, options = {}) {
  const audioRecord = recordById(snapshot, 'audioMeta')
  const transcriptRecord = recordById(snapshot, 'transcript')
  const chunkRecord = recordById(snapshot, 'chunkData')
  const marksRecord = recordById(snapshot, 'marks')
  const audioMeta = audioRecord?.payload
  const sourceWorkflowSnapshot = typeof options.sourceWorkflowSnapshot === 'function'
    ? options.sourceWorkflowSnapshot()
    : options.sourceWorkflowSnapshot
  const mediaSource = audioMeta?.mediaIdentity || audioMeta?.media || snapshot?.media
    || await deriveReaderMediaDescriptor(snapshot, sourceWorkflowSnapshot, options.sourceWorkflowOutputDir)
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

function createReaderHostAdapter({ client, profileId, sourceWorkflowSnapshot, sourceWorkflowOutputDir }) {
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
      const candidate = await readerCandidate(snapshot, profileId, context.expectedRevision, {
        sourceWorkflowSnapshot,
        sourceWorkflowOutputDir,
      })
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
  if (!content || typeof content !== 'object') {
    throw productionHostError('OWNER_CUTOVER_HOST_QUERY_INVALID', 'Host owner record content is invalid')
  }
  const knownSchemaVersions = {
    'vocabulary.passage-preview.data.v1': 'passage-preview.legacy-data.v1',
    'vocabulary.passage-preview.progress.v1': 'passage-preview.legacy-progress.v1',
  }
  const schemaVersion = record?.schemaVersion
    ?? content.schemaVersion
    ?? content.schema_version
    ?? knownSchemaVersions[id]
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

function annotationScopeFromRecord(record) {
  const content = record?.payload ?? record?.content ?? record
  const scope = content?.scope || content
  if (!scope || typeof scope !== 'object') return null
  if (typeof scope.audioKey !== 'string' || typeof scope.documentId !== 'string') return null
  return { audioKey: scope.audioKey, documentId: scope.documentId }
}

function uniqueAnnotationScopes(scopes) {
  const values = Array.isArray(scopes) ? scopes : (scopes ? [scopes] : [])
  const seen = new Set()
  return values.map((scope) => safeAnnotationScope(scope)).filter((scope) => {
    const key = `${scope.audioKey}\u0000${scope.documentId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function createAnnotationHostAdapter({ client, scope, scopes }) {
  const fixedScopes = uniqueAnnotationScopes(scopes || scope)
  return {
    key: 'annotation',
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      const responses = fixedScopes.length
        ? await Promise.all(fixedScopes.map((fixedScope) => client.query({
          domain: 'annotation',
          operation: 'scope',
          payload: { scope: fixedScope },
        })))
        : [await client.query({ domain: 'annotation', operation: 'scope', payload: {} })]
      const records = {}
      let revision = 0
      for (const response of responses) {
        const selected = responseRecords(response, 'annotation')
        revision = selected.revision > revision ? selected.revision : revision
        Object.assign(records, selected.records)
      }
      return ownerRecordsHostSnapshot(records, revision)
    },
    async restoreRecords(snapshot, context = {}) {
      return client.command({
        domain: 'annotation',
        operation: 'lightweight-import',
        payload: { records: recordsPayload(snapshot) },
        expectedRevision: context.expectedRevision,
        idempotencyKey: context.idempotencyKey,
      })
    },
  }
}

function createVocabularySrsHostAdapter({ client }) {
  const canonicalKeys = new Set([
    'vocabulary.srs.store.v1',
    'vocabulary.acquisition.store.v1',
    'vocabulary.review.store.v2',
    'vocabulary.review-session-ledgers.v1',
    'vocabulary.learning-events.manifest.v1',
    'vocabulary.context-evidence.store.v1',
    'vocabulary.personalization.shadow-reports.v1',
    'vocabulary-srs-pending-candidates',
    'vocabulary.revision-watermark.v1',
  ])
  const dynamicKey = (key) => (
    /^vocabulary\.learning-events\.v1\.\d{4}-(?:0[1-9]|1[0-2])(?:\.\d{4})?$/u.test(key)
    || /^vocabulary-article-srs-settlement-progress:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(key)
    || /^vocabulary\.learning-command-receipt\.v1:[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(key)
  )
  const recoveryKey = (key) => (
    /^vocabulary\.[A-Za-z0-9][A-Za-z0-9._-]*\.backup:\d+$/u.test(key)
    || /^vocabulary\.corrupt\.quarantine\.v1:[a-f0-9]{64}$/u.test(key)
  )
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
      const unsupported = keys.filter((key) => !canonicalKeys.has(key) && !dynamicKey(key) && !recoveryKey(key))
      if (unsupported.length) {
        throw productionHostError(
          'OWNER_CUTOVER_HOST_IMPORT_INVALID',
          `Vocabulary migration contains unregistered records: ${unsupported.join(', ')}`,
        )
      }

      const result = await client.command({
        domain: 'vocabulary-srs',
        operation: 'learning-unit-of-work',
        payload: { records },
        expectedRevision: context.expectedRevision,
        idempotencyKey: context.idempotencyKey || 'vocabulary-srs-import',
      })
      if (result?.outcome !== 'committed' || result?.commitStatus !== 'committed') {
        throw productionHostError(
          'OWNER_CUTOVER_HOST_IMPORT_FAILED',
          `Vocabulary learning-unit-of-work did not commit (${result?.outcome || 'missing'}:${result?.error?.code || result?.commitStatus || 'unknown'})`,
        )
      }
      return result
    },
  }
}

function workflowSnapshotFromRecords(records, mediaReferences = []) {
  if (!Array.isArray(records)) {
    throw productionHostError('OWNER_CUTOVER_HOST_IMPORT_INVALID', 'Workflow migration snapshot records are invalid')
  }
  const jobs = []
  const history = []
  const readerIndex = []
  const outputs = []
  let config = {}
  let configSeen = false
  const ids = new Set()
  for (const record of records) {
    const id = String(record?.id || '')
    const isOutput = id.startsWith('output:')
    const outputRelative = isOutput ? id.slice('output:'.length) : ''
    if (!id || ids.has(id) || !record || typeof record.payload !== 'object' || (!isOutput && Array.isArray(record.payload))) {
      throw productionHostError('OWNER_CUTOVER_HOST_IMPORT_INVALID', 'Workflow migration record identity or payload is invalid')
    }
    if (isOutput && (!outputRelative || /^[\\/]/u.test(outputRelative) || /^[A-Za-z]:[\\/]/u.test(outputRelative)
      || outputRelative.split(/[\\/]+/u).some((part) => part === '..'))) {
      throw productionHostError('OWNER_CUTOVER_HOST_IMPORT_INVALID', `Workflow output record path is invalid: ${id}`)
    }
    ids.add(id)
    if (id.startsWith('jobs:')) jobs.push(record.payload)
    else if (id.startsWith('items:')) history.push(record.payload)
    else if (id.startsWith('reader-index:')) readerIndex.push(record.payload)
    else if (isOutput) outputs.push(clone(record))
    else if (id === 'config') {
      if (configSeen) throw productionHostError('OWNER_CUTOVER_HOST_IMPORT_INVALID', 'Workflow migration contains duplicate config records')
      configSeen = true
      config = record.payload
    } else {
      throw productionHostError('OWNER_CUTOVER_HOST_IMPORT_INVALID', `Workflow migration record is outside jobs/history/config/index: ${id}`)
    }
  }
  return {
    jobs,
    history,
    readerIndex: { items: readerIndex },
    config,
    outputs,
    mediaReferences: Array.isArray(mediaReferences) ? clone(mediaReferences) : [],
  }
}

const WORKFLOW_PATH_KEY = /(?:path|dir|directory|folder|filename|executable|binary)$/iu
const WORKFLOW_ABSOLUTE_PATH = /^(?:[A-Za-z]:|[\\/])/u
const WORKFLOW_EMBEDDED_ABSOLUTE_PATH = /(?:^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/][^\s"'<>|]+|\\\\[^\\\s]+\\[^\s"'<>|]+|\/(?:Users|home|private|var|tmp|opt|mnt|Volumes|root)(?:\/[^\s"'<>]+)+)/iu
const WORKFLOW_FORBIDDEN_KEY = /(?:apikey|accesstoken|authorization|cookie|password|passwd|secret|credential|privatekey|proxyauth|sessiontoken|token|auth|jwt|bearer|signature|sig|blob|arraybuffer|typedarray|bytes|base64|binary|datauri|inlinedata|inlinemedia|mediad(?:ata|bytes|blob)|audiod(?:ata|blob)|videod(?:ata|blob))/iu

function normalizedWorkflowKey(key) {
  return String(key || '').replace(/[_-]/gu, '').toLowerCase()
}

function assertSafeWorkflowString(value, keyPath) {
  const trimmed = value.trim()
  if (/^data:/iu.test(trimmed) || /^file:/iu.test(trimmed)
    || WORKFLOW_ABSOLUTE_PATH.test(trimmed) || WORKFLOW_EMBEDDED_ABSOLUTE_PATH.test(trimmed)) {
    throw productionHostError('OWNER_CUTOVER_HOST_BACKUP_INVALID', `Workflow backup contains a machine path or binary value: ${keyPath}`)
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      if (parsed.username || parsed.password) {
        throw new Error('url-credentials')
      }
      for (const key of parsed.searchParams.keys()) {
        if (WORKFLOW_FORBIDDEN_KEY.test(normalizedWorkflowKey(key))) throw new Error('url-sensitive-query')
      }
    } catch (error) {
      throw productionHostError('OWNER_CUTOVER_HOST_BACKUP_INVALID', `Workflow backup contains an unsafe URL: ${keyPath}`)
    }
  }
}

function assertSafeWorkflowBackupValue(value, keyPath = '$') {
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw productionHostError('OWNER_CUTOVER_HOST_BACKUP_INVALID', `Workflow backup value is not finite: ${keyPath}`)
    return
  }
  if (typeof value === 'string') {
    assertSafeWorkflowString(value, keyPath)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeWorkflowBackupValue(item, `${keyPath}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') {
    throw productionHostError('OWNER_CUTOVER_HOST_BACKUP_INVALID', `Workflow backup value is not JSON-safe: ${keyPath}`)
  }
  for (const [key, child] of Object.entries(value)) {
    const isPathKey = WORKFLOW_PATH_KEY.test(key)
    const isRedactedPath = isPathKey && child === '[REDACTED_PATH]'
    if (isRedactedPath) continue
    const normalizedKey = normalizedWorkflowKey(key)
    const isSafeByteCount = (normalizedKey === 'bytes' || normalizedKey === 'sizebytes')
      && Number.isSafeInteger(child)
      && child >= 0
    if (WORKFLOW_FORBIDDEN_KEY.test(normalizedKey) && !isSafeByteCount) {
      throw productionHostError('OWNER_CUTOVER_HOST_BACKUP_INVALID', `Workflow backup contains a forbidden field: ${key}`)
    }
    if (/^(?:cookiesPath|ytDlpPath|whisperxPath)$/iu.test(key)
      && typeof child === 'string'
      && child !== ''
      && child !== '[REDACTED_PATH]') {
      throw productionHostError('OWNER_CUTOVER_HOST_BACKUP_INVALID', `Workflow backup contains an unredacted tool path: ${key}`)
    }
    if (isPathKey && typeof child === 'string'
      && child !== '[REDACTED_PATH]'
      && (WORKFLOW_ABSOLUTE_PATH.test(child.trim()) || child.split(/[\\/]+/u).some((part) => part === '..'))) {
      throw productionHostError('OWNER_CUTOVER_HOST_BACKUP_INVALID', `Workflow backup path is not portable: ${key}`)
    }
    assertSafeWorkflowBackupValue(child, `${keyPath}.${key}`)
  }
}

function validateWorkflowBackupRecords(records, mediaReferences) {
  if (!Array.isArray(records)) {
    throw productionHostError(
      'OWNER_CUTOVER_HOST_BACKUP_UNAVAILABLE',
      'Workflow Host did not expose sanitized backupRecords',
    )
  }
  for (const record of records) {
    const recordId = typeof record?.id === 'string' ? record.id : ''
    const outputRelative = recordId.startsWith('output:') ? recordId.slice('output:'.length) : ''
    const validId = recordId === 'config'
      || /^(?:jobs|items|reader-index):[^\\/\u0000-\u001f]+$/u.test(recordId)
      || (Boolean(outputRelative)
        && !/^[\\/]/u.test(outputRelative)
        && !/^[A-Za-z]:[\\/]/u.test(outputRelative)
        && !outputRelative.split(/[\\/]+/u).some((part) => part === '..'))
    const payloadIsObject = record?.payload && typeof record.payload === 'object'
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || !validId
      || !payloadIsObject
      || (!recordId.startsWith('output:') && Array.isArray(record.payload))) {
      throw productionHostError('OWNER_CUTOVER_HOST_BACKUP_INVALID', 'Workflow Host backup record identity or payload is invalid')
    }
    assertSafeWorkflowBackupValue(record)
  }
  assertSafeWorkflowBackupValue(mediaReferences || [])
  return { records: clone(records), mediaReferences: clone(mediaReferences || []) }
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
      let revision = 0
      for (const response of responses) revision = response.revision ?? revision
      const selected = validateWorkflowBackupRecords(
        responses[0]?.payload?.backupRecords,
        responses[0]?.payload?.backupMediaReferences,
      )
      const records = selected.records
      return {
        schemaVersion: 1,
        adapterVersion: 1,
        revision,
        records,
        references: records.flatMap((record) => Array.isArray(record.references) ? clone(record.references) : []),
        mediaReferences: selected.mediaReferences,
      }
    },
    async restoreRecords(snapshot, context = {}) {
      const records = Array.isArray(snapshot?.records) ? snapshot.records : []
      if (records.length === 0) return { ok: true, status: 'committed', revision: context.expectedRevision }
      return client.command({
        domain: 'workflow',
        operation: 'snapshot-commit',
        payload: { snapshot: workflowSnapshotFromRecords(records, snapshot?.mediaReferences) },
        expectedRevision: context.expectedRevision,
        idempotencyKey: context.idempotencyKey,
      })
    },
  }
}

function uniqueMarksScopes(scopes) {
  const values = Array.isArray(scopes) ? scopes : (scopes ? [scopes] : [])
  const seen = new Set()
  return values.map((scope) => {
    const normalized = safeMarksScope(scope)
    return {
      ...normalized,
      recordIds: scope && typeof scope === 'object' && scope.recordIds && typeof scope.recordIds === 'object'
        ? { ...scope.recordIds }
        : {},
    }
  }).filter((scope) => {
    const key = `${scope.jobId}\u0000${scope.contentId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function marksRecordId(scope, kind) {
  const filename = kind === 'marks'
    ? 'reader-marks.json'
    : kind === 'activity'
      ? 'reader-activity.json'
      : 'reader-marks-commit-journal.json'
  return scope.recordIds?.[kind] || `${filename}:${scope.jobId}/_workflow/${filename}`
}

function marksEnvelope(scope, kind, payload, revision) {
  if (payload?.found === false || payload?.empty === true) return null
  const isMarks = kind === 'marks'
  const value = isMarks ? payload?.marks : kind === 'activity' ? payload?.activity : payload?.journal
  if (!value || typeof value !== 'object') return null
  if (kind === 'journal') return value
  const schemaVersion = isMarks ? 'reader-marks.v1' : 'reader-activity.v1'
  const domain = isMarks ? 'reader-marks' : 'reader-activity'
  const updatedAt = value.updatedAt || payload?.updatedAt || ''
  const envelopePayload = isMarks
    ? { jobId: scope.jobId, marks: Array.isArray(value) ? value : [], updatedAt }
    : { ...(value && typeof value === 'object' ? value : {}), jobId: scope.jobId }
  return {
    schemaVersion,
    domain,
    jobId: scope.jobId,
    revision: revision ?? 0,
    updatedAt,
    payload: envelopePayload,
  }
}

function marksSnapshotForScope(scope, responses) {
  const marksPayload = hostResponsePayload(responses.marks, 'marks-activity')
  const activityPayload = hostResponsePayload(responses.activity, 'marks-activity')
  const revisionPayload = hostResponsePayload(responses.revision, 'marks-activity')
  const marksRevision = marksPayload.revision ?? responses.marks.revision ?? 0
  const activityRevision = activityPayload.revision ?? responses.activity.revision ?? 0
  const records = []
  const marks = marksEnvelope(scope, 'marks', marksPayload, marksRevision)
  const activity = marksEnvelope(scope, 'activity', activityPayload, activityRevision)
  const journal = marksEnvelope(scope, 'journal', revisionPayload, revisionPayload.journalRevision ?? 0)
  if (marks) records.push(hostRecord(marksRecordId(scope, 'marks'), 1, marksRevision, scope.jobId, marks, {
    references: [{ type: 'workflow-job', id: scope.jobId }],
  }))
  if (activity) records.push(hostRecord(marksRecordId(scope, 'activity'), 1, activityRevision, scope.jobId, activity, {
    references: [{ type: 'workflow-job', id: scope.jobId }],
  }))
  if (journal) records.push(hostRecord(marksRecordId(scope, 'journal'), 1, revisionPayload.journalRevision ?? 0, scope.jobId, journal, {
    references: [{ type: 'workflow-job', id: scope.jobId }],
  }))
  return {
    records,
    // The marks/activity owner uses marks/activity revisions for its CAS
    // authority.  The journal revision is receipt evidence only and must not
    // make an otherwise unchanged data snapshot appear newer.
    revision: Math.max(marksRevision, activityRevision),
  }
}

function createMarksHostAdapter({ client, scope, scopes }) {
  const fixedScopes = uniqueMarksScopes(scopes || scope)
  return {
    key: 'marks-activity',
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      const scopesToRead = fixedScopes.length ? fixedScopes : []
      const all = []
      let revision = 0
      for (const fixedScope of scopesToRead) {
        const [marks, activity, revisionResponse] = await Promise.all([
          client.query({ domain: 'marks-activity', operation: 'marks', payload: fixedScope }),
          client.query({ domain: 'marks-activity', operation: 'activity', payload: fixedScope }),
          client.query({ domain: 'marks-activity', operation: 'revision', payload: fixedScope }),
        ])
        const selected = marksSnapshotForScope(fixedScope, { marks, activity, revision: revisionResponse })
        all.push(...selected.records)
        revision = Math.max(revision, selected.revision)
      }
      return {
        schemaVersion: 1,
        adapterVersion: 1,
        revision,
        records: all.sort((left, right) => left.id.localeCompare(right.id)),
        references: fixedScopes.map((fixedScope) => ({ type: 'workflow-job', id: fixedScope.jobId })),
        mediaReferences: [],
      }
    },
    async restoreRecords(snapshot, context = {}) {
      const groups = new Map()
      for (const record of snapshot?.records || []) {
        const envelope = record?.payload
        const jobId = String(envelope?.jobId || record?.contentId || '')
        if (!jobId) continue
        const group = groups.get(jobId) || {
          jobId,
          contentId: String(record.contentId || envelope?.payload?.jobId || jobId),
          marks: null,
          activity: null,
        }
        const id = String(record.id || '')
        if (id.startsWith('reader-marks.json:')) group.marks = envelope
        if (id.startsWith('reader-activity.json:')) group.activity = envelope
        groups.set(jobId, group)
      }
      let last = { status: 'committed', commitStatus: 'committed', outcome: 'committed', revision: context.expectedRevision }
      for (const group of groups.values()) {
        if (group.marks) {
          const current = await client.query({
            domain: 'marks-activity',
            operation: 'revision',
            payload: { jobId: group.jobId, contentId: group.contentId },
          })
          const currentRevision = current.payload?.marksRevision ?? 0
          const marks = Array.isArray(group.marks.payload?.marks) ? group.marks.payload.marks : group.marks.marks
          if (!Array.isArray(marks)) throw productionHostError('OWNER_CUTOVER_HOST_IMPORT_INVALID', 'Marks migration record has no marks array')
          last = await client.command({
            domain: 'marks-activity',
            operation: 'marks-commit',
            payload: { jobId: group.jobId, contentId: group.contentId, marks },
            expectedRevision: currentRevision,
            idempotencyKey: `${context.idempotencyKey}-marks-${group.jobId}`.slice(0, 255),
          })
          if (last.outcome !== 'committed') return last
        }
        if (group.activity) {
          const current = await client.query({
            domain: 'marks-activity',
            operation: 'revision',
            payload: { jobId: group.jobId, contentId: group.contentId },
          })
          const activity = group.activity.payload && typeof group.activity.payload === 'object'
            ? { ...group.activity.payload }
            : {}
          delete activity.jobId
          last = await client.command({
            domain: 'marks-activity',
            operation: 'activity-append',
            payload: { jobId: group.jobId, contentId: group.contentId, update: activity },
            expectedRevision: current.payload?.activityRevision ?? 0,
            idempotencyKey: `${context.idempotencyKey}-activity-${group.jobId}`.slice(0, 255),
          })
          if (last.outcome !== 'committed') return last
        }
      }
      return last
    },
  }
}

export function createProductionHostAdapters({
  client,
  profileId,
  hostScopeByDomain = {},
  sourceScopesByDomain = {},
  sourceWorkflowSnapshot,
  sourceWorkflowOutputDir,
} = {}) {
  if (!client || typeof client.query !== 'function' || typeof client.command !== 'function') {
    throw productionHostError('OWNER_CUTOVER_HOST_CLIENT_INVALID', 'Production Host typed client is required')
  }
  const adapters = {
    'reader-session': createReaderHostAdapter({
      client,
      profileId,
      sourceWorkflowSnapshot,
      sourceWorkflowOutputDir,
    }),
    'marks-activity': createMarksHostAdapter({
      client,
      scope: hostScopeByDomain['marks-activity'],
      scopes: sourceScopesByDomain['marks-activity'] || hostScopeByDomain['marks-activity'],
    }),
    'passage-preview': createPassagePreviewHostAdapter({ client }),
    'vocabulary-srs': createVocabularySrsHostAdapter({ client }),
    workflow: createWorkflowHostAdapter({ client }),
  }
  const annotationScopes = sourceScopesByDomain.annotation || hostScopeByDomain.annotation
  adapters.annotation = annotationScopes
    ? createAnnotationHostAdapter({ client, scope: hostScopeByDomain.annotation, scopes: annotationScopes })
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
  if (new Set(indexes).size !== indexes.length
    || indexes.some((index, position) => position > 0 && index !== indexes[position - 1] + 1)) {
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

function createProductionLegacyJsonSources(sourceReference) {
  return ['marks-activity', 'workflow'].flatMap((domain) => {
    const snapshot = sourceReference.workflowDomains?.[domain]
    const adapter = snapshot && typeof snapshot === 'object'
      ? { async collect() { return clone(snapshot) } }
      : sourceReference.composition?.pythonAdapters?.[domain]
    if (!adapter || typeof adapter.collect !== 'function') return []
    return [{
      kind: 'json',
      sourceId: `backup.${domain}`,
      defaultSchemaVersion: 1,
      read: async () => {
        const snapshot = await adapter.collect({ domain })
        return {
          records: (Array.isArray(snapshot?.records) ? snapshot.records : []).map((record) => {
            const key = record?.id
            const schemaVersion = domain === 'marks-activity'
              ? record?.payload?.schemaVersion ?? record?.schemaVersion
              : record?.schemaVersion
            return {
              ...record,
              key,
              schemaVersion,
            }
          }),
        }
      },
    }]
  })
}

async function discoverProductionScopes(legacyBridge, domains, sourceIdsByDomain = {}) {
  const discovered = {}
  for (const domain of ['marks-activity', 'annotation']) {
    if (!domains.includes(domain)) continue
    const sourceIds = sourceIdsByDomain[domain]
    const plan = await legacyBridge.prepareImport(
      sourceIds === undefined ? {} : { sourceIds },
    )
    if (plan?.status !== 'ready' || !Array.isArray(plan.importInput?.records)) continue
    const records = plan.importInput.records.filter((record) => record?.domain === domain)
    if (domain === 'annotation') {
      const byScope = new Map()
      for (const record of records) {
        const scope = annotationScopeFromRecord(record)
        if (!scope) continue
        const key = `${scope.audioKey}\u0000${scope.documentId}`
        const item = byScope.get(key) || { ...scope, recordIds: {} }
        const suffix = String(record.recordKey || '').endsWith('annotation.bundle.v2.json')
          ? 'bundle'
          : String(record.recordKey || '').endsWith('annotation.generated.json')
            ? 'generated'
            : 'status'
        item.recordIds[suffix] = record.recordKey
        byScope.set(key, item)
      }
      discovered.annotation = [...byScope.values()]
    } else {
      const byJob = new Map()
      for (const record of records) {
        const content = record.payload || {}
        const jobId = String(content.jobId || content.payload?.jobId || record.contentId || '')
        if (!jobId) continue
        const contentId = String(content.payload?.jobId || record.contentId || jobId)
        const item = byJob.get(jobId) || { jobId, contentId, recordIds: {} }
        const key = String(record.recordKey || '')
        const kind = key.startsWith('reader-marks.json:')
          ? 'marks'
          : key.startsWith('reader-activity.json:')
            ? 'activity'
            : key.startsWith('reader-marks-commit-journal.json:')
              ? 'journal'
              : null
        if (kind) item.recordIds[kind] = record.recordKey
        byJob.set(jobId, item)
      }
      discovered['marks-activity'] = [...byJob.values()]
    }
  }
  return discovered
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
  const configuredMaxBackupBytes = options.maxBackupBytes
    ?? options.source.maxBackupBytes
    ?? options.target.maxBackupBytes
  const backupLimits = configuredMaxBackupBytes === undefined
    ? {}
    : { maxBackupBytes: configuredMaxBackupBytes }

  const preflightOnly = options.operation === 'dry-run' || options.readOnly === true
  const sourceComposition = await createReadWebProductionBackupComposition({
    ...options.source,
    profileId,
    pythonCommand: options.pythonCommand || options.source.pythonCommand,
    ...backupLimits,
    ...(preflightOnly ? { profileLeaseMode: 'standby' } : {}),
  })
  const sourceReference = {
    composition: sourceComposition,
    workflowDomains: options.sourceDomainSnapshots || null,
  }
  const targetComposition = await createReadWebProductionBackupComposition({
    ...options.target,
    profileId,
    pythonCommand: options.pythonCommand || options.target.pythonCommand,
    ...backupLimits,
    ...(preflightOnly ? { profileLeaseMode: 'standby' } : {}),
  })
  const targetLayout = productionLayout(targetComposition)

  const {
    createWindowsDurableStateMigration,
    createMemoryMigrationStateStore,
    createWindowsOwnerLegacyCompatibilityBridge,
  } = await loadProductionModules()
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
  const legacyBridge = createWindowsOwnerLegacyCompatibilityBridge({
    profileId,
    applicationPersistence: {
      async getAllRows() {
        return sourceReference.composition.browserProfile.persistence.getAllRows()
      },
    },
    storage: {
      get length() { return sourceReference.composition.browserProfile.storage.length },
      key(index) { return sourceReference.composition.browserProfile.storage.key(index) },
      getItem(key) { return sourceReference.composition.browserProfile.storage.getItem(key) },
    },
    jsonSources: createProductionLegacyJsonSources(sourceReference),
  })
  const sourceScopesByDomain = await discoverProductionScopes(
    legacyBridge,
    domains,
    options.sourceIdsByDomain || {},
  )
  const hostAdapters = createProductionHostAdapters({
    client: hostClient,
    profileId,
    hostScopeByDomain: options.hostScopeByDomain,
    sourceScopesByDomain,
    sourceWorkflowSnapshot: () => sourceReference.workflowDomains?.workflow,
    sourceWorkflowOutputDir: options.sourceWorkflowOutputDir,
  })
  if (domains.some((domain) => !hostAdapters[domain])) {
    throw productionHostError('OWNER_CUTOVER_PRODUCTION_COMPOSITION_INVALID', 'Production Host owner adapter is missing')
  }
  const authorityRoot = targetComposition.profileAuthorityRoot
  const authorityIsolationRoot = targetComposition.profileAuthorityIsolationRoot
  const statePath = containedPath(
    authorityRoot,
    options.statePath || path.join(authorityRoot, 'owner-mode', 'c2a-migration-state.json'),
    'statePath',
  )
  const stateStore = preflightOnly
    ? createMemoryMigrationStateStore()
    : stateFileStore(statePath, authorityRoot)
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
    legacyWriterControl: options.legacyWriterControl,
    smokeCheck: async ({ domain, revision }) => {
      const current = await hostAdapters[domain].collect({ domain })
      const state = await stateStore.read()
      const expected = state?.domains?.[domain]?.finalBackup?.artifact?.domains?.[domain]
      if (current?.revision !== revision || expected === undefined || !equivalentDomain(current, expected, domain)) {
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
    backupLimits,
  })
  if (options.operation === 'dry-run' || options.readOnly === true) {
    const results = []
    for (const domain of domains) {
      const result = await migration.dryRun(domain, {
        sourceIds: options.sourceIdsByDomain?.[domain],
        expectedRevision: options.expectedRevisionByDomain?.[domain],
        allowExistingTarget: options.allowExistingTarget === true,
      })
      results.push(result)
      if (!result.ok) break
    }
    return {
      ok: results.length === domains.length && results.every((result) => result.ok),
      mode: 'optimization',
      operation: 'dry-run',
      readOnly: true,
      productionComposition: true,
      domains: results,
      status: await migration.status(),
      sourceProfileId: sourceComposition.profileId,
      targetProfileId: targetComposition.profileId,
    }
  }
  if (options.operation === 'rollback') {
    const domain = options.rollbackDomain
    if (!domains.includes(domain)) {
      const error = new Error('Production rollback domain must be in the fixed owner order')
      error.code = 'OWNER_CUTOVER_PRODUCTION_DOMAIN_INVALID'
      throw error
    }
    const result = await migration.rollback(domain, {
      idempotencyKey: options.idempotencyKeyByDomain?.[domain],
    })
    return {
      ok: result.ok === true,
      mode: 'optimization',
      operation: 'rollback',
      productionComposition: true,
      domains: [result],
      status: await migration.status(),
      sourceProfileId: sourceComposition.profileId,
      targetProfileId: targetComposition.profileId,
    }
  }
  if (!refreshBrowserGuard) {
    const error = new Error('Production cutover requires a browser guard refresh before final backup')
    error.code = 'OWNER_CUTOVER_BROWSER_REFRESH_REQUIRED'
    throw error
  }
  const results = []
  const beforeResume = options.resume === true ? await migration.status() : null
  for (const domain of domains) {
    if (beforeResume?.domains?.[domain]?.authoritative === true) {
      results.push({
        ok: true,
        domain,
        status: 'completed',
        resumed: true,
        stopped: false,
        steps: { resume: { ok: true, status: 'already-authoritative' } },
      })
      continue
    }
    const current = await hostAdapters[domain].collect({ domain })
    const expectedRevision = options.expectedRevisionByDomain?.[domain] ?? current.revision
    const pendingImportRecovery = options.resume === true
      && beforeResume?.domains?.[domain]?.importAttemptStatus === 'pending'
    const result = await migration.migrateDomain(domain, {
      sourceIds: options.sourceIdsByDomain?.[domain],
      expectedRevision,
      allowExistingTarget: pendingImportRecovery,
      idempotencyKey: options.idempotencyKeyByDomain?.[domain] || `optimization-c2a-${domain}`,
      reconcilePhysicalFreeze: options.resume === true,
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
        let sourceCapture = null
        if (typeof options.refreshSourceAfterFreeze === 'function') {
          const source = await options.refreshSourceAfterFreeze({
            domain,
            stage: 'before-final-backup',
            freeze: context.freeze,
            sourceReference,
          })
          if (!source || typeof source !== 'object' || !source.sourceComposition) {
            throw productionHostError(
              'OWNER_CUTOVER_PRODUCTION_SOURCE_REFRESH_INVALID',
              'Production source refresh did not return a fresh source composition',
            )
          }
          if (!source.sourceCapture || source.sourceCapture.kind !== 'post-freeze-live-source-capture') {
            throw productionHostError(
              'OWNER_CUTOVER_PRODUCTION_SOURCE_REFRESH_INVALID',
              'Production source refresh did not return post-freeze capture evidence',
            )
          }
          sourceReference.composition = source.sourceComposition
          if (source.sourceDomainSnapshots !== undefined) {
            sourceReference.workflowDomains = source.sourceDomainSnapshots
          }
          sourceCapture = source.sourceCapture || null
        }
        return {
          ok: true,
          status: 'browser-frozen-observed',
          ...(refreshed && typeof refreshed === 'object' ? refreshed : {}),
          ...(sourceCapture ? { sourceCapture } : {}),
        }
      },
    })
    results.push(result)
    if (!result.ok) break
  }
  return {
    ok: results.length === domains.length && results.every((result) => result.ok),
    mode: 'optimization',
    operation: options.resume === true ? 'resume' : 'apply',
    productionComposition: true,
    domains: results,
    status: await migration.status(),
    sourceProfileId: sourceComposition.profileId,
    targetProfileId: targetComposition.profileId,
  }
}

export async function runWindowsOwnerProductionDryRun(options = {}) {
  return runWindowsOwnerProductionCutover({
    ...options,
    operation: 'dry-run',
    readOnly: true,
  })
}

export async function runWindowsOwnerProductionRollback(options = {}) {
  return runWindowsOwnerProductionCutover({
    ...options,
    operation: 'rollback',
  })
}
