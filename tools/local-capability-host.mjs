#!/usr/bin/env node

import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createEcdictVitePlugin } from '../src/dictionary/ecdict/api/ecdict-vite-plugin.mjs'
import { createLocalSentenceVitePlugin } from '../src/dictionary/local-sentences/local-sentence-vite-plugin.mjs'
import { createAriaEdgeTtsVitePlugin } from '../src/services/pronunciation/aria-edge-tts-vite-plugin.mjs'
import { createAiPreviewSentenceVitePlugin } from '../src/services/vocabulary/ai-preview-sentence-vite-plugin.mjs'
import { createIeltsLearningPoolVitePlugin } from '../src/services/vocabulary/ielts-learning-pool-vite-plugin.mjs'
import { createMerriamWebsterSentenceVitePlugin } from '../src/services/vocabulary/merriam-webster-sentence-vite-plugin.mjs'
import { createSentenceTranslationVitePlugin } from '../src/services/vocabulary/sentence-translation-vite-plugin.mjs'
import { createTatoebaSentenceVitePlugin } from '../src/services/vocabulary/tatoeba-sentence-vite-plugin.mjs'
import { createWordnikSentenceVitePlugin } from '../src/services/vocabulary/wordnik-sentence-vite-plugin.mjs'

export const CAPABILITY_ENDPOINTS = Object.freeze([
  '/api/tts/edge',
  '/api/vocabulary/local-sentences',
  '/api/vocabulary/sentence-translations',
  '/api/vocabulary/ai-preview-sentences',
  '/api/vocabulary/real-sentences',
  '/api/vocabulary/merriam-webster-examples',
  '/api/vocabulary/wordnik-examples',
  '/api/vocabulary/ielts-learning-pool',
  '/api/dev/dictionary/ecdict',
])

export function loadCapabilityRuntimeConfig(env = process.env, cwd = process.cwd()) {
  return {
    host: env.READ_WEB_CAPABILITY_HOST || '127.0.0.1',
    port: Number.parseInt(env.READ_WEB_CAPABILITY_PORT || '8770', 10),
    localSentenceDatabasePath: env.LOCAL_SENTENCE_DATABASE_PATH,
    translationApiKey: env.VOCABULARY_TRANSLATION_API_KEY || env.GEMINI_API_KEY,
    translationModels: compactModels(env.VOCABULARY_TRANSLATION_MODEL, env.VOCABULARY_TRANSLATION_FALLBACK_MODELS),
    translationProxyUrl: env.VOCABULARY_TRANSLATION_PROXY_URL || 'http://127.0.0.1:7897',
    aiPreviewApiKey: env.VOCABULARY_AI_PREVIEW_API_KEY || env.VOCABULARY_TRANSLATION_API_KEY || env.GEMINI_API_KEY,
    aiPreviewModels: compactModels(env.VOCABULARY_AI_PREVIEW_MODEL, env.VOCABULARY_AI_PREVIEW_FALLBACK_MODELS),
    aiPreviewProxyUrl: env.VOCABULARY_AI_PREVIEW_PROXY_URL || env.VOCABULARY_TRANSLATION_PROXY_URL || 'http://127.0.0.1:7897',
    merriamDictionaryApiKey: env.MERRIAM_WEBSTER_DICTIONARY_API_KEY,
    merriamLearnersApiKey: env.MERRIAM_WEBSTER_LEARNERS_API_KEY,
    wordnikApiKey: env.WORDNIK_API_KEY,
    ieltsCandidatesPath: env.IELTS_READING_VOCABULARY_CANDIDATES_PATH,
    ecdictEnabled: env.ECDICT_ENABLED === 'true',
    ecdictDatabasePath: env.ECDICT_DATABASE_PATH,
    cwd,
  }
}

export function createLocalCapabilityServer(options = {}) {
  const config = { ...loadCapabilityRuntimeConfig(options.env, options.cwd), ...options }
  const lifecycle = new EventEmitter()
  const middleware = []
  const adapter = {
    middlewares: { use(handler) { middleware.push(handler) } },
    httpServer: lifecycle,
  }
  const ecdictServiceUrl = pathToFileURL(resolve(config.cwd, 'src/dictionary/ecdict/application/ecdict-service.mjs')).href
  const plugins = [
    createAriaEdgeTtsVitePlugin(config.ttsOptions),
    createLocalSentenceVitePlugin({ databasePath: config.localSentenceDatabasePath }),
    createSentenceTranslationVitePlugin({
      apiKey: config.translationApiKey,
      models: config.translationModels,
      proxyUrl: config.translationProxyUrl,
    }),
    createAiPreviewSentenceVitePlugin({
      apiKey: config.aiPreviewApiKey,
      models: config.aiPreviewModels,
      proxyUrl: config.aiPreviewProxyUrl,
    }),
    createMerriamWebsterSentenceVitePlugin({
      dictionaryApiKey: config.merriamDictionaryApiKey,
      learnersApiKey: config.merriamLearnersApiKey,
    }),
    createTatoebaSentenceVitePlugin(),
    createWordnikSentenceVitePlugin({ apiKey: config.wordnikApiKey }),
    createIeltsLearningPoolVitePlugin({ candidatesPath: config.ieltsCandidatesPath }),
    createEcdictVitePlugin({
      enabled: config.ecdictEnabled,
      databasePath: config.ecdictDatabasePath,
      serviceLoader: () => import(ecdictServiceUrl),
    }),
  ]
  for (const plugin of plugins) plugin.configureServer?.(adapter)

  const server = createServer((request, response) => {
    if (request.method === 'GET' && new URL(request.url || '/', 'http://127.0.0.1').pathname === '/api/app/capabilities') {
      sendJson(response, 200, { status: 'ok', service: 'read-web-local-capabilities', endpoints: CAPABILITY_ENDPOINTS })
      return
    }
    dispatch(middleware, request, response, () => sendJson(response, 404, { detail: 'capability route not found' }))
  })
  server.once('close', () => lifecycle.emit('close'))
  return server
}

function dispatch(middleware, request, response, onMissing) {
  let index = 0
  const next = () => {
    const handler = middleware[index++]
    if (!handler) return onMissing()
    try {
      const result = handler(request, response, next)
      Promise.resolve(result).catch(() => {
        if (!response.headersSent) sendJson(response, 503, { detail: 'capability request failed' })
        else response.destroy()
      })
    } catch {
      if (!response.headersSent) sendJson(response, 503, { detail: 'capability request failed' })
      else response.destroy()
    }
  }
  next()
}

function compactModels(primary, fallbacks = '') {
  return [primary, ...String(fallbacks || '').split(',')].map((value) => String(value || '').trim()).filter(Boolean)
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length })
  response.end(body)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const config = loadCapabilityRuntimeConfig()
  const portArgument = process.argv.indexOf('--port')
  if (portArgument >= 0) config.port = Number.parseInt(process.argv[portArgument + 1] || '', 10)
  const server = createLocalCapabilityServer(config)
  server.listen(config.port, config.host, () => {
    const address = server.address()
    process.stdout.write(`${JSON.stringify({ status: 'ready', host: config.host, port: address.port })}\n`)
  })
  const close = () => server.close(() => { process.exitCode = 0 })
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}
