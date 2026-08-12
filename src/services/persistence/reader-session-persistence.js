import { createApplicationPersistence } from './application-persistence.js'

const SESSION_ROW_IDS = new Set(['audioMeta', 'transcript', 'chunkData', 'readerSession'])
const READER_SESSION_SCHEMA_VERSION = 2

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
  return `{${entries.join(',')}}`
}

async function checksumFor(value) {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.subtle || typeof TextEncoder !== 'function') {
    throw new Error('SHA-256 is unavailable for reader session persistence')
  }
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

async function sessionChecksum(session) {
  return checksumFor({
    contentId: session.contentId,
    revision: session.revision,
    audioMeta: session.audioMeta,
    transcript: session.transcript,
    chunkData: session.chunkData,
  })
}

function isReadableSessionRow(row) {
  return !!(
    row
    && SESSION_ROW_IDS.has(row.id)
  )
}

function isQuarantineRow(row) {
  return !!(
    row
    && typeof row.id === 'string'
    && row.id.startsWith('readerSessionQuarantine:')
    && row.content
    && typeof row.content === 'object'
    && typeof row.content.reason === 'string'
    && Array.isArray(row.content.rows)
  )
}

function isSessionRow(row) {
  return !!(
    row
    && SESSION_ROW_IDS.has(row.id)
    && typeof row.contentId === 'string'
    && row.contentId.length > 0
    && typeof row.revision === 'string'
    && row.revision.length > 0
    && typeof row.checksum === 'string'
    && /^sha256:[a-f0-9]{64}$/.test(row.checksum)
    && Object.prototype.hasOwnProperty.call(row, 'content')
  )
}

function validateSession(session) {
  if (!session || typeof session !== 'object') throw new TypeError('reader session is required')
  if (typeof session.contentId !== 'string' || !session.contentId) throw new TypeError('reader session contentId is required')
  if (typeof session.revision !== 'string' || !session.revision) throw new TypeError('reader session revision is required')
  for (const key of ['audioMeta', 'transcript', 'chunkData']) {
    if (session[key] === undefined) throw new TypeError(`reader session ${key} is required`)
  }
}

function hasValidCommittedPayload(byId) {
  const audioMeta = byId.get('audioMeta')?.content
  const transcript = byId.get('transcript')?.content
  const chunkData = byId.get('chunkData')?.content
  const validAudioMeta = !!audioMeta && typeof audioMeta === 'object' && !Array.isArray(audioMeta)
  const validTranscript = !!transcript
    && typeof transcript === 'object'
    && Array.isArray(transcript.segments)
  const validChunkData = Array.isArray(chunkData)
    || !!(chunkData && typeof chunkData === 'object'
      && (Array.isArray(chunkData.s) || Array.isArray(chunkData.items)))
  return validAudioMeta && validTranscript && validChunkData
}

export function createReaderSessionPersistence(options = {}) {
  const persistence = createApplicationPersistence({
    indexedDBApi: options.indexedDBApi,
    types: {
      readerSessionRow: {
        keyPrefix: '',
        validate: isSessionRow,
      },
      readableSessionRow: {
        keyPrefix: '',
        validate: isReadableSessionRow,
      },
      readerSessionQuarantine: {
        keyPrefix: 'readerSessionQuarantine:',
        validate: isQuarantineRow,
      },
    },
  })
  async function quarantine(rows, reason, details = {}) {
    const sourceRows = rows.filter(Boolean).map((value) => structuredClone(value))
    const fingerprint = await checksumFor({ reason, rows: sourceRows })
    const id = `readerSessionQuarantine:${fingerprint.slice('sha256:'.length)}`
    const existing = await persistence.get('readerSessionQuarantine', id)
    if (existing) {
      return { id, reason, detectedAt: existing.content.detectedAt, fingerprint }
    }
    const detectedAt = Date.now()
    const row = {
      id,
      content: {
        schemaVersion: 1,
        reason,
        detectedAt,
        fingerprint,
        ...details,
        rows: sourceRows,
      },
    }
    await persistence.put('readerSessionQuarantine', row)
    return { id, reason, detectedAt, fingerprint }
  }

  async function commit(session) {
    validateSession(session)
    const timestamp = Date.now()
    const checksum = await sessionChecksum(session)
    const common = {
      contentId: session.contentId,
      revision: session.revision,
      checksum,
      timestamp,
    }
    const rows = [
      { id: 'audioMeta', content: session.audioMeta, ...common },
      { id: 'transcript', content: session.transcript, ...common },
      { id: 'chunkData', content: session.chunkData, ...common },
      {
        id: 'readerSession',
        content: {
          schemaVersion: READER_SESSION_SCHEMA_VERSION,
          contentId: session.contentId,
          revision: session.revision,
          checksum,
          committedAt: timestamp,
        },
        ...common,
      },
    ]
    await persistence.putMany('readerSessionRow', rows)
    return rows[3].content
  }

  async function loadCommitted() {
    const ids = ['audioMeta', 'transcript', 'chunkData', 'readerSession']
    const rows = await persistence.getMany('readableSessionRow', ids)
    const byId = new Map(rows.filter(Boolean).map((row) => [row.id, row]))
    const manifestRow = byId.get('readerSession')
    if (!manifestRow) return { status: 'legacy', session: null }
    const manifest = manifestRow.content
    if (!manifest || typeof manifest !== 'object') {
      const quarantineRecord = await quarantine(rows, 'invalid-manifest')
      return {
        status: 'corrupt',
        session: null,
        quarantine: quarantineRecord,
        error: { code: 'READER_SESSION_CORRUPT', message: 'Stored reader session manifest is invalid' },
      }
    }
    if (manifest?.schemaVersion !== 1 && manifest?.schemaVersion !== READER_SESSION_SCHEMA_VERSION) {
      const quarantineRecord = await quarantine(rows, 'unsupported-schema', {
        schemaVersion: manifest?.schemaVersion ?? null,
      })
      return {
        status: 'unknown-schema',
        session: null,
        quarantine: quarantineRecord,
        error: {
          code: 'READER_SESSION_SCHEMA_UNSUPPORTED',
          message: 'Stored reader session schema is unsupported',
          schemaVersion: manifest?.schemaVersion ?? null,
        },
      }
    }
    const contentId = String(manifestRow.contentId || manifest?.contentId || '')
    const revision = String(manifestRow.revision || manifest?.revision || '')
    const complete = ids.every((id) => byId.has(id))
    const manifestMatchesRow = manifest
      && manifest.contentId === contentId
      && manifest.revision === revision
    const consistent = complete
      && contentId
      && revision
      && manifestMatchesRow
      && hasValidCommittedPayload(byId)
      && ids.every((id) => {
      const row = byId.get(id)
      return row.contentId === contentId && row.revision === revision
    })
    if (!consistent) {
      const quarantineRecord = await quarantine(rows, 'inconsistent-session')
      return {
        status: 'corrupt',
        session: null,
        quarantine: quarantineRecord,
        error: { code: 'READER_SESSION_CORRUPT', message: 'Stored reader session is incomplete or inconsistent' },
      }
    }
    const session = {
      contentId,
      revision,
      audioMeta: byId.get('audioMeta').content,
      transcript: byId.get('transcript').content,
      chunkData: byId.get('chunkData').content,
    }
    if (manifest.schemaVersion === READER_SESSION_SCHEMA_VERSION) {
      const expectedChecksum = manifest.checksum
      const rowChecksumsMatch = typeof expectedChecksum === 'string'
        && manifestRow.checksum === expectedChecksum
        && ids.every((id) => byId.get(id).checksum === expectedChecksum)
      const actualChecksum = await sessionChecksum(session)
      if (!rowChecksumsMatch || actualChecksum !== expectedChecksum) {
        const quarantineRecord = await quarantine(rows, 'checksum-mismatch', {
          contentId,
          revision,
          expectedChecksum: expectedChecksum || null,
          actualChecksum,
        })
        return {
          status: 'corrupt',
          session: null,
          quarantine: quarantineRecord,
          error: {
            code: 'READER_SESSION_CHECKSUM_MISMATCH',
            message: 'Stored reader session checksum does not match its content',
            expectedChecksum: expectedChecksum || null,
            actualChecksum,
          },
        }
      }
    }
    return {
      status: 'committed',
      session,
    }
  }

  return Object.freeze({ commit, loadCommitted })
}
