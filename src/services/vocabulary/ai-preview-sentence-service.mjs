import { ProxyAgent } from 'undici'

export const MAX_AI_PREVIEW_SENTENCE_BATCH = 25
export const DEFAULT_AI_PREVIEW_SENTENCE_MODELS = Object.freeze([
  'gemma-4-31b-it',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
])
export const DEFAULT_AI_PREVIEW_SENTENCE_MODEL = DEFAULT_AI_PREVIEW_SENTENCE_MODELS[0]
export const DEFAULT_AI_PREVIEW_SENTENCE_TIMEOUT_MS = 15_000

export function createAiPreviewSentenceService(options = {}) {
  const apiKey = normalizeText(options.apiKey)
  const models = normalizeModels(options.models ?? options.model)
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const dispatcher = normalizeText(options.proxyUrl) ? new ProxyAgent(options.proxyUrl) : null

  return Object.freeze({
    async generate(rawItems) {
      const items = normalizeItems(rawItems)
      if (!items.length) return response([], true, models[0])
      if (!apiKey || typeof fetchImpl !== 'function') {
        return response([], false, models.join(','), 'AI_PREVIEW_SENTENCE_NOT_CONFIGURED')
      }
      let lastError = null
      for (const model of models) {
        try {
          const generated = await requestGeminiPreviewSentences(items, {
            apiKey,
            model,
            fetchImpl,
            dispatcher,
            timeoutMs,
          })
          return response(generated, true, model)
        } catch (error) {
          if (error?.name === 'AbortError') throw error
          lastError = error
        }
      }
      return response([], false, models.join(','), toErrorCode(lastError))
    },
    close() {
      void dispatcher?.close()
    },
  })
}

export async function requestGeminiPreviewSentences(
  rawItems,
  {
    apiKey,
    model,
    fetchImpl = globalThis.fetch,
    dispatcher = null,
    timeoutMs = DEFAULT_AI_PREVIEW_SENTENCE_TIMEOUT_MS,
  } = {},
) {
  const items = normalizeItems(rawItems)
  const normalizedApiKey = normalizeText(apiKey)
  if (!normalizedApiKey) throw new Error('AI_PREVIEW_SENTENCE_NOT_CONFIGURED')
  if (!items.length) return []

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model || DEFAULT_AI_PREVIEW_SENTENCE_MODEL,
  )}:generateContent`
  const requestController = new AbortController()
  const normalizedTimeoutMs = normalizeTimeout(timeoutMs)
  const timeoutId = setTimeout(() => requestController.abort(), normalizedTimeoutMs)
  try {
    const responseValue = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': normalizedApiKey,
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: buildPrompt(items) }],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' },
                sentence: { type: 'STRING' },
              },
              required: ['id', 'sentence'],
            },
          },
        },
      }),
      signal: requestController.signal,
      ...(dispatcher ? { dispatcher } : {}),
    })
    if (!responseValue.ok) throw new Error(`AI_PREVIEW_SENTENCE_PROVIDER_${responseValue.status}`)

    const payload = await responseValue.json()
    const text = payload?.candidates?.[0]?.content?.parts
      ?.map((part) => typeof part?.text === 'string' ? part.text : '')
      .join('')
    const parsed = JSON.parse(stripCodeFence(text))
    const known = new Map(items.map((item) => [item.id, item]))
    const seen = new Set()
    return (Array.isArray(parsed) ? parsed : parsed?.items || [])
      .map((item) => ({
        id: normalizeId(item?.id),
        sentence: normalizeSentence(item?.sentence),
      }))
      .filter((item) => {
        if (!known.has(item.id) || !item.sentence || seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
      .map((item) => ({
        ...known.get(item.id),
        sentence: item.sentence,
      }))
  } catch (error) {
    if (requestController.signal.aborted) throw new Error('AI_PREVIEW_SENTENCE_TIMEOUT')
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function buildPrompt(items) {
  return [
    'Create one original English example sentence for each vocabulary item below.',
    'These are AI-generated learning aids, not quotations and not authentic source evidence.',
    'Return exactly one JSON object per input item, keeping every id unchanged.',
    'Rules for every sentence:',
    '- Use 4 to 14 English words and one simple independent main clause.',
    '- Use common A2-B1 vocabulary except for the target word.',
    '- Use the target word or a natural English inflection of its lemma.',
    '- Match the requested part of speech and Chinese sense.',
    '- Prefer a concrete everyday situation and a direct subject-verb relationship.',
    '- Do not use commas, semicolons, colons, parentheses, quotation marks, proper names, idioms, slogans, or explanations.',
    '- Do not add a Chinese translation, source attribution, or a second example.',
    `Input JSON: ${JSON.stringify(items.map((item) => ({
      id: item.id,
      word: item.word,
      lemma: item.lemma,
      form: item.form,
      partOfSpeech: item.partOfSpeech,
      meaningZh: item.meaningZh,
      definitionEn: item.definitionEn,
      targetSenseKey: item.targetSenseKey,
    })))}`,
  ].join('\n')
}

function normalizeItems(rawItems) {
  const result = []
  const seen = new Set()
  for (const rawItem of Array.isArray(rawItems) ? rawItems : []) {
    const id = normalizeId(rawItem?.id)
    const lemma = normalizeWord(rawItem?.lemma || rawItem?.word)
    if (!id || !lemma || seen.has(id)) continue
    seen.add(id)
    result.push({
      id,
      lemma,
      word: normalizeText(rawItem?.word) || lemma,
      form: normalizeText(rawItem?.form) || normalizeText(rawItem?.word) || lemma,
      partOfSpeech: normalizeText(rawItem?.partOfSpeech || rawItem?.pos),
      meaningZh: normalizeText(rawItem?.meaningZh || rawItem?.primaryMeaningZh),
      definitionEn: normalizeText(rawItem?.definitionEn || rawItem?.primaryDefinitionEn),
      targetSenseKey: normalizeText(rawItem?.targetSenseKey),
    })
    if (result.length >= MAX_AI_PREVIEW_SENTENCE_BATCH) break
  }
  return result
}

function response(items, available, model, errorCode = '') {
  return {
    schemaVersion: 'ai-preview-sentences.v1',
    available,
    model,
    errorCode,
    items: items.map(({ id, sentence }) => ({ id, sentence })),
  }
}

function normalizeModels(value) {
  const configured = (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map(normalizeText)
    .filter(Boolean)
  return [...new Set([...configured, ...DEFAULT_AI_PREVIEW_SENTENCE_MODELS])]
}

function toErrorCode(error) {
  const message = String(error?.message || '')
  return message.startsWith('AI_PREVIEW_SENTENCE_PROVIDER_') || message === 'AI_PREVIEW_SENTENCE_TIMEOUT'
    ? message
    : 'AI_PREVIEW_SENTENCE_FAILED'
}

function normalizeTimeout(value) {
  const timeout = Number(value)
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_AI_PREVIEW_SENTENCE_TIMEOUT_MS
}

function normalizeSentence(value) {
  return normalizeText(value).slice(0, 300)
}

function normalizeWord(value) {
  const word = normalizeText(value).toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) ? word : ''
}

function normalizeId(value) {
  return normalizeText(value).replace(/[^a-zA-Z0-9._:-]/gu, '').slice(0, 128)
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function stripCodeFence(value) {
  return String(value || '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
}
