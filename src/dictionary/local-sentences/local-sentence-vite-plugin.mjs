import { resolve } from 'node:path'
import { createLocalSentenceService } from './local-sentence-service.mjs'

export const LOCAL_SENTENCE_ENDPOINT = '/api/vocabulary/local-sentences'

export function createLocalSentenceVitePlugin(options = {}) {
  const databasePath = options.databasePath || resolve(process.cwd(), 'data/dictionaries/local-sentences.sqlite')
  let service = null

  function configure(server) {
    server.middlewares.use((request, response, next) => {
      void handleLocalSentenceRequest(request, response, next, {
        serviceFactory: () => {
          service ||= createLocalSentenceService({ databasePath })
          return service
        },
      })
    })
    server.httpServer?.once('close', () => {
      service?.close?.()
      service = null
    })
  }

  return {
    name: 'read-web-local-sentence-warehouse',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}

export async function handleLocalSentenceRequest(request, response, next, options = {}) {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (request.method !== 'GET' || url.pathname !== LOCAL_SENTENCE_ENDPOINT) {
    next()
    return
  }
  const word = normalizeWord(url.searchParams.get('word'))
  const lemma = normalizeWord(url.searchParams.get('lemma'))
  if (!word && !lemma) {
    sendJson(response, 400, { errorCode: 'LOCAL_SENTENCE_WORD_REQUIRED' })
    return
  }
  try {
    const service = options.serviceFactory?.() || createLocalSentenceService(options)
    sendJson(response, 200, service.query(word || lemma, {
      lemma,
      limit: url.searchParams.get('limit'),
      maxWordCount: url.searchParams.get('maxWords'),
    }))
  } catch {
    sendJson(response, 200, { available: false, errorCode: 'LOCAL_SENTENCE_QUERY_FAILED', items: [] })
  }
}

function normalizeWord(value) {
  const word = String(value || '').normalize('NFKC').trim().toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) && word.length <= 64 ? word : ''
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}
