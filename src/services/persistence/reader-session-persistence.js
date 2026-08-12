import { createApplicationPersistence } from './application-persistence.js'

const SESSION_ROW_IDS = new Set(['audioMeta', 'transcript', 'chunkData', 'readerSession'])

function isReadableSessionRow(row) {
  return !!(
    row
    && SESSION_ROW_IDS.has(row.id)
    && Object.prototype.hasOwnProperty.call(row, 'content')
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
    },
  })

  async function commit(session) {
    validateSession(session)
    const timestamp = Date.now()
    const common = {
      contentId: session.contentId,
      revision: session.revision,
      timestamp,
    }
    const rows = [
      { id: 'audioMeta', content: session.audioMeta, ...common },
      { id: 'transcript', content: session.transcript, ...common },
      { id: 'chunkData', content: session.chunkData, ...common },
      {
        id: 'readerSession',
        content: {
          schemaVersion: 1,
          contentId: session.contentId,
          revision: session.revision,
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
    if (!consistent || manifest?.schemaVersion !== 1) {
      return {
        status: 'inconsistent',
        session: null,
        error: { code: 'READER_SESSION_INCONSISTENT', message: 'Stored reader session is incomplete or inconsistent' },
      }
    }
    return {
      status: 'committed',
      session: {
        contentId,
        revision,
        audioMeta: byId.get('audioMeta').content,
        transcript: byId.get('transcript').content,
        chunkData: byId.get('chunkData').content,
      },
    }
  }

  return Object.freeze({ commit, loadCommitted })
}
