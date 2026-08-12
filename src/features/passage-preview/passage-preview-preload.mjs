import {
  findPreviewSentence,
  REAL_SENTENCE_STATUS,
  resolvePreviewContextSentence,
} from './preview-sentence-source.js'
import { generateAiPreviewSentenceBatches } from './passage-preview-ai-sentence.js'
import { sentenceTranslationKey, translateSentenceBatches } from './sentence-translation.js'
import { validatePreviewSentenceResult } from './preview-sentence-target-validation.mjs'

export const PASSAGE_PREVIEW_PRELOAD_CONCURRENCY = 6

export async function preloadPassagePreviewBatch(rawItems, options = {}) {
  const items = Array.isArray(rawItems) ? rawItems.filter((item) => item && typeof item === 'object') : []
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const concurrency = Math.max(
    1,
    Math.min(items.length || 1, Math.floor(Number(options.concurrency) || PASSAGE_PREVIEW_PRELOAD_CONCURRENCY)),
  )
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}
  const entries = []
  let completed = 0

  await mapWithConcurrency(items, concurrency, async (item) => {
    throwIfAborted(options.signal)
    const stored = validatedStoredSentence(item)
    let result = stored
    let sourceType = stored ? 'stored' : ''

    if (!result) {
      try {
        const candidate = await findPreviewSentence(item, {
          fetchImpl,
          signal: options.signal,
        })
        const validation = validatePreviewSentenceResult(item, candidate)
        if (candidate?.status === REAL_SENTENCE_STATUS.READY && validation.accepted) {
          result = validation.result
          sourceType = 'provider'
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error
      }
    }

    const fallback = result ? null : resolvePreviewContextSentence(item)
    entries.push({ item, result, fallback, sourceType })
    completed += 1
    onProgress({
      phase: 'sentences',
      completed,
      total: items.length,
      ready: entries.filter((entry) => entry.result).length,
    })
  })

  const aiInputs = entries
    .filter((entry) => !entry.result && !entry.fallback)
    .map((entry) => entry.item)
  if (aiInputs.length) {
    onProgress({ phase: 'ai', completed: 0, total: aiInputs.length })
    try {
      const generated = await generateAiPreviewSentenceBatches(aiInputs, {
        fetchImpl,
        signal: options.signal,
      })
      onProgress({ phase: 'ai', completed: generated.length, total: aiInputs.length })
      const entriesById = new Map(entries.map((entry) => [entry.item.id, entry]))
      for (const candidate of generated) {
        const entry = entriesById.get(candidate.id)
        if (!entry) continue
        const validation = validatePreviewSentenceResult(entry.item, candidate)
        if (!validation.accepted) continue
        entry.result = validation.result
        entry.sourceType = 'ai'
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error
    }
  }

  const translationBySentence = new Map()
  const translationInputs = []
  const translationSeen = new Set()
  for (const entry of entries) {
    const sentenceResult = entry.result || entry.fallback
    const sentence = normalizeText(sentenceResult?.sentence)
    if (!sentence) continue
    const translationZh = normalizeTranslation(sentenceResult?.translationZh)
    const key = sentenceTranslationKey(sentence)
    if (translationZh) {
      translationBySentence.set(key, translationZh)
      continue
    }
    if (translationSeen.has(key)) continue
    translationSeen.add(key)
    translationInputs.push({ id: entry.item.id, sentence })
  }

  let translated = []
  if (translationInputs.length) {
    try {
      translated = await translateSentenceBatches(translationInputs, {
        fetchImpl,
        signal: options.signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
    }
    for (const item of translated) {
      const translationZh = normalizeTranslation(item?.translationZh)
      if (translationZh) translationBySentence.set(sentenceTranslationKey(item.sentence), translationZh)
    }
  }
  onProgress({
    phase: 'translations',
    completed: translated.length,
    total: translationInputs.length,
  })

  const preloadedSentences = {}
  const persistedItems = items.map((item) => {
    const entry = entries.find((candidate) => candidate.item.id === item.id)
    const sentenceResult = entry?.result || entry?.fallback
    if (!sentenceResult) return item
    const translationZh = translationBySentence.get(sentenceTranslationKey(sentenceResult.sentence)) || ''
    const result = translationZh && !sentenceResult.translationZh
      ? { ...sentenceResult, translationZh }
      : sentenceResult
    preloadedSentences[item.id] = result
    if (!entry?.result || entry.sourceType !== 'provider' || result.persistence === 'none') return item
    return enrichItem(item, result)
  })

  return {
    items: persistedItems,
    preloadedSentences,
    translations: Object.fromEntries(translationBySentence),
    stats: {
      total: items.length,
      sourceReady: entries.filter((entry) => entry.sourceType === 'provider').length,
      aiGenerated: entries.filter((entry) => entry.sourceType === 'ai').length,
      stored: entries.filter((entry) => entry.sourceType === 'stored').length,
      fallback: entries.filter((entry) => !entry.result && entry.fallback).length,
      translated: translationBySentence.size,
    },
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const result = new Array(items.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      result[index] = await mapper(items[index], index)
    }
  }))
  return result
}

function validatedStoredSentence(item) {
  const validation = validatePreviewSentenceResult(item, item?.realSentence)
  return validation.accepted ? validation.result : null
}

function enrichItem(item, result) {
  return {
    ...item,
    realSentence: result,
    ...(result.primaryMeaningZh ? { primaryMeaningZh: result.primaryMeaningZh } : {}),
    ...(result.primaryPartOfSpeech ? { pos: result.primaryPartOfSpeech } : {}),
    ...(result.primarySenseStatus ? { primarySenseStatus: result.primarySenseStatus } : {}),
    ...(result.primarySenseReason ? { primarySenseReason: result.primarySenseReason } : {}),
    ...(result.targetSenseKey ? { targetSenseKey: result.targetSenseKey } : {}),
  }
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function normalizeTranslation(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim()
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Passage preview preload aborted')
    error.name = 'AbortError'
    throw error
  }
}
