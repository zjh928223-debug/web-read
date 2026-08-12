import { resolve } from 'node:path'
import { createSentenceTranslationService, MAX_SENTENCE_TRANSLATION_BATCH } from './sentence-translation-service.mjs'
import { readWindowsGenericCredential } from './windows-generic-credential.mjs'

export const SENTENCE_TRANSLATION_ENDPOINT = '/api/vocabulary/sentence-translations'

export function createSentenceTranslationVitePlugin(options = {}) {
  let service = null
  const apiKey = options.apiKey || readWindowsGenericCredential(
    options.credentialTarget || 'SubtitleWorkflow/GeminiApiKey',
  )
  const configure = (server) => {
    server.middlewares.use((request, response, next) => {
      void handleSentenceTranslationRequest(request, response, next, {
        serviceFactory: () => {
          service ||= createSentenceTranslationService({
            apiKey,
            models: options.models ?? options.model,
            proxyUrl: options.proxyUrl,
            cachePath: options.cachePath || process.env.SENTENCE_TRANSLATION_CACHE_PATH || resolve(process.cwd(), 'data/dictionaries/local-sentence-translations.sqlite'),
          })
          return service
        },
      })
    })
    server.httpServer?.once('close', () => service?.close())
  }
  return {
    name: 'read-web-sentence-translations',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}

export async function handleSentenceTranslationRequest(request, response, next, options = {}) {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (request.method !== 'POST' || url.pathname !== SENTENCE_TRANSLATION_ENDPOINT) {
    next()
    return
  }
  try {
    const body = await readJsonBody(request)
    if (!Array.isArray(body?.items) || body.items.length > MAX_SENTENCE_TRANSLATION_BATCH) {
      sendJson(response, 400, { errorCode: 'SENTENCE_TRANSLATION_BATCH_INVALID', items: [] })
      return
    }
    const service = options.serviceFactory?.() || createSentenceTranslationService(options)
    sendJson(response, 200, await service.translate(body.items))
  } catch (error) {
    const errorCode = String(error?.message || '').startsWith('SENTENCE_TRANSLATION_PROVIDER_')
      ? String(error.message)
      : 'SENTENCE_TRANSLATION_FAILED'
    sendJson(response, 200, { available: false, errorCode, items: [] })
  }
}

function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 64 * 1024) reject(new Error('SENTENCE_TRANSLATION_BODY_TOO_LARGE'))
    })
    request.on('end', () => {
      try { resolveBody(JSON.parse(body || '{}')) } catch (error) { reject(error) }
    })
    request.on('error', reject)
  })
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}
