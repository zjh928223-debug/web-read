import { createApplicationPersistence } from './application-persistence.js'

const SESSION_ROW_IDS = new Set(['audioMeta', 'transcript', 'chunkData', 'readerSession'])

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

export function createReaderSessionPersistence(options = {}) {
  const persistence = createApplicationPersistence({
    indexedDBApi: options.indexedDBApi,
    types: {
      readerSessionRow: {
        keyPrefix: '',
        validate: isSessionRow,
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

  return Object.freeze({ commit })
}
