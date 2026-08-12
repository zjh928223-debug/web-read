import { createAiPreviewSentenceService, MAX_AI_PREVIEW_SENTENCE_BATCH } from './ai-preview-sentence-service.mjs'
import { readWindowsGenericCredential } from './windows-generic-credential.mjs'

export const AI_PREVIEW_SENTENCE_ENDPOINT = '/api/vocabulary/ai-preview-sentences'

export function createAiPreviewSentenceVitePlugin(options = {}) {
  let service = null
  const apiKey = options.apiKey || readWindowsGenericCredential(
    options.credentialTarget || 'SubtitleWorkflow/GeminiApiKey',
  )
  const configure = (server) => {
    server.middlewares.use((request, response, next) => {
      void handleAiPreviewSentenceRequest(request, response, next, {
        serviceFactory: () => {
          service ||= createAiPreviewSentenceService({
            apiKey,
            models: options.models ?? options.model,
            proxyUrl: options.proxyUrl,
          })
          return service
        },
      })
    })
    server.httpServer?.once('close', () => service?.close())
  }
  return {
    name: 'read-web-ai-preview-sentences',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}

export async function handleAiPreviewSentenceRequest(request, response, next, options = {}) {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (request.method !== 'POST' || url.pathname !== AI_PREVIEW_SENTENCE_ENDPOINT) {
    next()
    return
  }
  try {
    const body = await readJsonBody(request)
    if (!Array.isArray(body?.items) || body.items.length > MAX_AI_PREVIEW_SENTENCE_BATCH) {
      sendJson(response, 400, { errorCode: 'AI_PREVIEW_SENTENCE_BATCH_INVALID', items: [] })
      return
    }
    const service = options.serviceFactory?.() || createAiPreviewSentenceService(options)
    sendJson(response, 200, await service.generate(body.items))
  } catch (error) {
    const errorCode = String(error?.message || '').startsWith('AI_PREVIEW_SENTENCE_PROVIDER_')
      ? String(error.message)
      : 'AI_PREVIEW_SENTENCE_FAILED'
    sendJson(response, 200, { available: false, errorCode, items: [] })
  }
}

function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 64 * 1024) reject(new Error('AI_PREVIEW_SENTENCE_BODY_TOO_LARGE'))
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
