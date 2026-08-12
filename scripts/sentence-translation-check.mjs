import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSentenceTranslationService,
  DEFAULT_SENTENCE_TRANSLATION_MODELS,
  DEFAULT_SENTENCE_TRANSLATION_TIMEOUT_MS,
  MAX_SENTENCE_TRANSLATION_BATCH,
} from '../src/services/vocabulary/sentence-translation-service.mjs'

const browserClientSource = await readFile(new URL('../src/features/passage-preview/sentence-translation.js', import.meta.url), 'utf8')
const { translateSentenceBatches } = await import(`data:text/javascript;base64,${Buffer.from(browserClientSource).toString('base64')}`)

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'read-web-translations-'))
try {
  let providerCalls = 0
  const service = createSentenceTranslationService({
    apiKey: 'fixture-key',
    model: 'fixture-model',
    cachePath: ':memory:',
    fetchImpl: async (_url, options) => {
      providerCalls += 1
      const request = JSON.parse(options.body)
      const input = request.contents[0].parts[0].text.match(/Input JSON: (\[[\s\S]*\])$/u)[1]
      const items = JSON.parse(input)
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify(items.map((item) => ({ id: item.id, translationZh: `译文：${item.sentence}` }))) }],
          },
        }],
      }))
    },
  })

  const first = await service.translate([{ id: 'one', sentence: 'This is a sentence.' }])
  assert.equal(first.items[0].translationZh, '译文：This is a sentence.')
  assert.equal(providerCalls, 1)
  const cached = await service.translate([{ id: 'one-again', sentence: 'This is a sentence.' }])
  assert.equal(cached.items[0].translationZh, first.items[0].translationZh)
  assert.equal(providerCalls, 1, 'cached sentence must not call Gemini again')
  service.close()

  const fallbackAttempts = []
  const fallbackService = createSentenceTranslationService({
    apiKey: 'fixture-key',
    models: ['gemma-translation-fixture', 'gemini-translation-fallback-fixture'],
    cachePath: ':memory:',
    fetchImpl: async (url, options) => {
      fallbackAttempts.push(String(url))
      if (String(url).includes('gemma-translation-fixture')) {
        return new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 })
      }
      const request = JSON.parse(options.body)
      const input = request.contents[0].parts[0].text.match(/Input JSON: (\[[\s\S]*\])$/u)[1]
      const items = JSON.parse(input)
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify(items.map((item) => ({ id: item.id, translationZh: `涓枃 ${item.id}` }))) }],
          },
        }],
      }))
    },
  })
  const fallback = await fallbackService.translate([{ id: 'fallback', sentence: 'This is another sentence.' }])
  assert.equal(fallback.available, true)
  assert.equal(fallback.model, 'gemini-translation-fallback-fixture')
  assert.equal(fallback.items[0].translationZh, '涓枃 fallback')
  assert.deepEqual(fallbackAttempts.map((url) => url.match(/models\/([^:]+):/u)?.[1]), [
    'gemma-translation-fixture',
    'gemini-translation-fallback-fixture',
  ])
  fallbackService.close()

  assert.deepEqual(DEFAULT_SENTENCE_TRANSLATION_MODELS, [
    'gemma-4-31b-it',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
  ])
  assert.equal(DEFAULT_SENTENCE_TRANSLATION_TIMEOUT_MS, 15_000)

  const batchSizes = []
  const translated = await translateSentenceBatches(
    Array.from({ length: 50 }, (_, index) => ({ id: `sentence-${index}`, sentence: `Sentence number ${index}.` })),
    {
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body)
        batchSizes.push(body.items.length)
        return new Response(JSON.stringify({
          available: true,
          items: body.items.map((item) => ({ ...item, translationZh: `中文 ${item.id}` })),
        }))
      },
    },
  )
  assert.deepEqual(batchSizes, [MAX_SENTENCE_TRANSLATION_BATCH, MAX_SENTENCE_TRANSLATION_BATCH])
  assert.equal(translated.length, 50)
  console.log('Sentence translation batching and cache verification passed.')
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
