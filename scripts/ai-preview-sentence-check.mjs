import assert from 'node:assert/strict'
import {
  AI_PREVIEW_SENTENCE_ENDPOINT,
  handleAiPreviewSentenceRequest,
} from '../src/services/vocabulary/ai-preview-sentence-vite-plugin.mjs'
import {
  createAiPreviewSentenceService,
  DEFAULT_AI_PREVIEW_SENTENCE_MODELS,
  DEFAULT_AI_PREVIEW_SENTENCE_TIMEOUT_MS,
  requestGeminiPreviewSentences,
} from '../src/services/vocabulary/ai-preview-sentence-service.mjs'

const input = [{
  id: 'ielts-reading:2026-08-09:resilient',
  word: 'resilient',
  lemma: 'resilient',
  form: 'resilient',
  pos: 'adjective',
  primaryMeaningZh: '有韧性的',
  targetSenseKey: 'resilient:adjective:有韧性的',
}]

let upstreamRequest = null
const generated = await requestGeminiPreviewSentences(input, {
  apiKey: 'fixture-secret',
  model: 'gemini-fixture',
  fetchImpl: async (url, options) => {
    upstreamRequest = { url: String(url), options }
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify([{ id: input[0].id, sentence: 'The resilient child kept trying.' }]) }],
        },
      }],
    }), { status: 200 })
  },
})
assert.equal(generated.length, 1)
assert.equal(generated[0].sentence, 'The resilient child kept trying.')
assert.match(upstreamRequest.url, /gemini-fixture:generateContent/)
assert.equal(upstreamRequest.options.headers['x-goog-api-key'], 'fixture-secret')
const prompt = JSON.parse(upstreamRequest.options.body).contents[0].parts[0].text
assert.match(prompt, /AI-generated learning aids/)
assert.match(prompt, /4 to 14 English words/)
assert.match(prompt, /resilient/)

const attemptedModels = []
const fallbackService = createAiPreviewSentenceService({
  apiKey: 'fixture-secret',
  models: ['gemma-4-31b-it', 'gemini-3.5-flash-lite'],
  fetchImpl: async (url) => {
    attemptedModels.push(String(url))
    if (String(url).includes('/gemma-4-31b-it:generateContent')) {
      return new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 })
    }
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify([{ id: input[0].id, sentence: 'The resilient child kept trying.' }]) }],
        },
      }],
    }), { status: 200 })
  },
})
const fallbackResult = await fallbackService.generate(input)
assert.equal(fallbackResult.available, true)
assert.equal(fallbackResult.model, 'gemini-3.5-flash-lite')
assert.equal(fallbackResult.items[0].sentence, 'The resilient child kept trying.')
assert.deepEqual(attemptedModels.map((url) => url.match(/models\/([^:]+):/u)?.[1]), [
  'gemma-4-31b-it',
  'gemini-3.5-flash-lite',
])
assert.deepEqual(DEFAULT_AI_PREVIEW_SENTENCE_MODELS, [
  'gemma-4-31b-it',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
])
assert.equal(DEFAULT_AI_PREVIEW_SENTENCE_TIMEOUT_MS, 15_000)

const timeoutAttempts = []
const timeoutFallbackService = createAiPreviewSentenceService({
  apiKey: 'fixture-secret',
  models: ['gemma-timeout-fixture', 'gemini-fallback-fixture'],
  timeoutMs: 10,
  fetchImpl: (url, options) => new Promise((resolve, reject) => {
    timeoutAttempts.push(String(url))
    if (String(url).includes('gemma-timeout-fixture')) {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      return
    }
    resolve(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify([{ id: input[0].id, sentence: 'The resilient child kept trying.' }]) }],
        },
      }],
    }), { status: 200 }))
  }),
})
const timeoutFallbackResult = await timeoutFallbackService.generate(input)
assert.equal(timeoutFallbackResult.available, true)
assert.equal(timeoutFallbackResult.model, 'gemini-fallback-fixture')
assert.deepEqual(timeoutAttempts.map((url) => url.match(/models\/([^:]+):/u)?.[1]), [
  'gemma-timeout-fixture',
  'gemini-fallback-fixture',
])

const response = createJsonResponse()
await handleAiPreviewSentenceRequest(
  createJsonRequest({ items: input }),
  response,
  () => assert.fail('AI preview endpoint should handle its own route'),
  {
    serviceFactory: () => ({
      async generate(items) {
        return { available: true, items: items.map((item) => ({ id: item.id, sentence: 'The resilient child kept trying.' })) }
      },
    }),
  },
)
assert.equal(response.statusCode, 200)
assert.equal(response.json.items[0].sentence, 'The resilient child kept trying.')

console.log('AI preview sentence service and endpoint checks passed.')

function createJsonRequest(body) {
  return {
    method: 'POST',
    url: AI_PREVIEW_SENTENCE_ENDPOINT,
    setEncoding() {},
    on(event, callback) {
      if (event === 'data') callback(JSON.stringify(body))
      if (event === 'end') callback()
      return this
    },
  }
}

function createJsonResponse() {
  return {
    statusCode: 0,
    headers: {},
    json: null,
    setHeader(name, value) { this.headers[name] = value },
    end(body) { this.json = JSON.parse(body) },
  }
}
