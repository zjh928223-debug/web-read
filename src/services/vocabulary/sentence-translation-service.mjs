import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ProxyAgent } from 'undici'

export const MAX_SENTENCE_TRANSLATION_BATCH = 25
export const DEFAULT_SENTENCE_TRANSLATION_MODELS = Object.freeze([
  'gemma-4-31b-it',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
])
export const DEFAULT_SENTENCE_TRANSLATION_MODEL = DEFAULT_SENTENCE_TRANSLATION_MODELS[0]
export const DEFAULT_SENTENCE_TRANSLATION_TIMEOUT_MS = 15_000

export function createSentenceTranslationService(options = {}) {
  const apiKey = normalizeText(options.apiKey)
  const models = normalizeModels(options.models ?? options.model)
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const cachePath = options.cachePath
  const database = cachePath ? openCache(cachePath) : null
  const dispatcher = normalizeText(options.proxyUrl) ? new ProxyAgent(options.proxyUrl) : null

  return Object.freeze({
    async translate(rawItems) {
      const items = normalizeItems(rawItems)
      const cached = readCached(database, items)
      const missing = items.filter((item) => !cached.has(item.id))
      if (missing.length === 0) return response([...cached.values()], true, models[0])
      if (!apiKey || typeof fetchImpl !== 'function') {
        return response([...cached.values()], false, models.join(','), 'SENTENCE_TRANSLATION_NOT_CONFIGURED')
      }
      let generated = null
      let usedModel = models[0]
      let lastError = null
      for (const model of models) {
        try {
          generated = await requestGeminiTranslations(missing, {
            apiKey,
            model,
            fetchImpl,
            dispatcher,
            timeoutMs,
          })
          usedModel = model
          break
        } catch (error) {
          if (error?.name === 'AbortError') throw error
          lastError = error
        }
      }
      if (!generated) return response([...cached.values()], false, models.join(','), toErrorCode(lastError))
      writeCached(database, generated, usedModel)
      return response([...cached.values(), ...generated], true, usedModel)
    },
    close() {
      database?.close()
      void dispatcher?.close()
    },
  })
}

export async function requestGeminiTranslations(
  items,
  {
    apiKey,
    model,
    fetchImpl = globalThis.fetch,
    dispatcher = null,
    timeoutMs = DEFAULT_SENTENCE_TRANSLATION_TIMEOUT_MS,
  } = {},
) {
  const normalized = normalizeItems(items)
  if (!normalizeText(apiKey)) throw new Error('SENTENCE_TRANSLATION_NOT_CONFIGURED')
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || DEFAULT_SENTENCE_TRANSLATION_MODEL)}:generateContent`
  const requestController = new AbortController()
  const normalizedTimeoutMs = normalizeTimeout(timeoutMs)
  const timeoutId = setTimeout(() => requestController.abort(), normalizedTimeoutMs)
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: [
              'Translate each English sentence into natural, concise Simplified Chinese.',
              'Preserve meaning, tense, negation, names, and the relationship expressed by the target sentence.',
              'Do not explain, rewrite the English, add examples, or omit an item.',
              `Input JSON: ${JSON.stringify(normalized.map(({ id, sentence }) => ({ id, sentence })))}`,
            ].join('\n'),
          }],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' },
                translationZh: { type: 'STRING' },
              },
              required: ['id', 'translationZh'],
            },
          },
        },
      }),
      signal: requestController.signal,
      ...(dispatcher ? { dispatcher } : {}),
    })
    if (!response.ok) throw new Error(`SENTENCE_TRANSLATION_PROVIDER_${response.status}`)
    const payload = await response.json()
    const text = payload?.candidates?.[0]?.content?.parts
      ?.map((part) => typeof part?.text === 'string' ? part.text : '')
      .join('')
    const parsed = JSON.parse(stripCodeFence(text))
    const known = new Map(normalized.map((item) => [item.id, item]))
    return (Array.isArray(parsed) ? parsed : [])
      .map((item) => ({
        id: normalizeId(item?.id),
        translationZh: normalizeTranslation(item?.translationZh),
      }))
      .filter((item) => known.has(item.id) && item.translationZh)
      .map((item) => ({ ...known.get(item.id), translationZh: item.translationZh }))
  } catch (error) {
    if (requestController.signal.aborted) throw new Error('SENTENCE_TRANSLATION_TIMEOUT')
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function openCache(cachePath) {
  mkdirSync(dirname(cachePath), { recursive: true })
  const database = new DatabaseSync(cachePath)
  database.exec(`
    CREATE TABLE IF NOT EXISTS sentence_translations (
      sentence_hash TEXT PRIMARY KEY,
      sentence TEXT NOT NULL,
      translation_zh TEXT NOT NULL,
      model TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  return database
}

function readCached(database, items) {
  const result = new Map()
  if (!database || items.length === 0) return result
  const statement = database.prepare('SELECT translation_zh FROM sentence_translations WHERE sentence_hash = ?')
  for (const item of items) {
    const row = statement.get(item.hash)
    const translationZh = normalizeTranslation(row?.translation_zh)
    if (translationZh) result.set(item.id, { ...item, translationZh })
  }
  return result
}

function writeCached(database, items, model) {
  if (!database || items.length === 0) return
  const statement = database.prepare(`
    INSERT INTO sentence_translations(sentence_hash, sentence, translation_zh, model, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(sentence_hash) DO UPDATE SET
      translation_zh = excluded.translation_zh,
      model = excluded.model,
      updated_at = excluded.updated_at
  `)
  database.exec('BEGIN')
  try {
    const updatedAt = new Date().toISOString()
    for (const item of items) statement.run(item.hash, item.sentence, item.translationZh, model, updatedAt)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function normalizeItems(rawItems) {
  const result = []
  const seen = new Set()
  for (const rawItem of Array.isArray(rawItems) ? rawItems : []) {
    const sentence = normalizeSentence(rawItem?.sentence)
    const id = normalizeId(rawItem?.id) || sentenceHash(sentence)
    if (!sentence || !id || seen.has(id)) continue
    seen.add(id)
    result.push({ id, sentence, hash: sentenceHash(sentence) })
    if (result.length === MAX_SENTENCE_TRANSLATION_BATCH) break
  }
  return result
}

function response(items, available, model, errorCode = '') {
  return {
    schemaVersion: 'sentence-translations.v1',
    available,
    model,
    errorCode,
    items: items.map(({ id, sentence, translationZh }) => ({ id, sentence, translationZh })),
  }
}

function normalizeModels(value) {
  const configured = (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map(normalizeText)
    .filter(Boolean)
  return [...new Set([...configured, ...DEFAULT_SENTENCE_TRANSLATION_MODELS])]
}

function toErrorCode(error) {
  const message = String(error?.message || '')
  return message.startsWith('SENTENCE_TRANSLATION_PROVIDER_') || message === 'SENTENCE_TRANSLATION_TIMEOUT'
    ? message
    : 'SENTENCE_TRANSLATION_FAILED'
}

function normalizeTimeout(value) {
  const timeout = Number(value)
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_SENTENCE_TRANSLATION_TIMEOUT_MS
}

function sentenceHash(sentence) {
  return createHash('sha256').update(sentence).digest('hex')
}

function normalizeSentence(value) {
  const sentence = normalizeText(value).slice(0, 600)
  return sentence.split(/\s+/u).length >= 2 ? sentence : ''
}

function normalizeId(value) {
  return normalizeText(value).replace(/[^a-zA-Z0-9._:-]/gu, '').slice(0, 128)
}

function normalizeTranslation(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().slice(0, 600)
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function stripCodeFence(value) {
  return String(value || '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
}
