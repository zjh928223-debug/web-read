import { youtubeWorkflowClient } from '../../composables/youtube-workflow-client.js'

const transcriptCacheByClient = new WeakMap()
const chunkDataCacheByClient = new WeakMap()

export function selectReviewContext(contexts) {
  const valid = (Array.isArray(contexts) ? contexts : []).filter((context) => (
    context && (normalizeText(context.sentence) || normalizeText(context.surrounding_text || context.surroundingText))
  ))
  return valid.sort((left, right) => getTimestamp(right) - getTimestamp(left))[0] || null
}

export function buildReviewContext(entry) {
  const context = selectReviewContext(entry && entry.contexts)
  if (!context) return null
  const sentence = normalizeText(context.sentence)
  const word = normalizeText(entry && entry.word && entry.word.word)
  const surrounding = normalizeTextBlock(context.surrounding_text || context.surroundingText || sentence)
  return {
    raw: context,
    sentence,
    translationZh: resolveReviewSentenceTranslation(context),
    sourceId: normalizeText(context.source_id || context.sourceId),
    sourceTitle: normalizeText(context.source_title || context.sourceTitle),
    paragraphs: splitContextParagraphs(surrounding, sentence).map((paragraph) => (
      highlightContextParagraph(paragraph, sentence, word)
    )),
  }
}

export function resolveReviewSentenceTranslation(context) {
  return normalizeText(
    context?.translationZh
    || context?.translation_zh
    || context?.sentenceTranslation
    || context?.sentence_translation
    || context?.translation
    || context?.extensions?.translationZh
    || context?.extensions?.translation_zh
    || context?.extensions?.sentenceTranslation
    || context?.extensions?.sentence_translation,
  )
}

export function resolveReviewMeaning(word, context) {
  return normalizeText(
    context?.simple_meaning
    || context?.simpleMeaning
    || word?.simple_meaning
    || word?.simpleMeaning
    || word?.meaning
    || context?.meaning,
  )
}

export function resolveReviewGeneralMeaning(word) {
  const dictionarySource = String(word?.dictionary_source || word?.dictionarySource || '').trim()
  if (
    dictionarySource.startsWith('merriam-webster-collegiate+gemini')
    && dictionarySource !== 'merriam-webster-collegiate+gemini:v2'
  ) {
    return ''
  }
  return normalizeText(
    word?.general_meaning
    || word?.generalMeaning
    || word?.dictionary_meaning
    || word?.dictionaryMeaning,
  )
}

export function splitContextParagraphs(value, targetSentence = '') {
  const text = normalizeTextBlock(value)
  if (!text) return []
  const explicit = text.split(/\n\s*\n|\r?\n/).map(normalizeText).filter(Boolean)
  if (explicit.length > 1) return chooseNearestThree(explicit, targetSentence)

  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/g)?.map(normalizeText).filter(Boolean) || [normalizeText(text)]
  return chooseNearestThree(sentences, targetSentence)
}

export function highlightContextParagraph(paragraph, targetSentence, word) {
  const text = String(paragraph || '')
  const sentenceRange = findNormalizedRange(text, targetSentence)
  if (!sentenceRange) {
    return {
      text,
      before: text,
      sentenceParts: [],
      sentenceWordParts: [],
      wordParts: buildClickableTextParts(text),
      after: '',
      target: false,
    }
  }
  const sentenceText = text.slice(sentenceRange.start, sentenceRange.end)
  return {
    text,
    before: text.slice(0, sentenceRange.start),
    sentenceParts: splitWordParts(sentenceText, word),
    sentenceWordParts: buildClickableTextParts(sentenceText, null, word),
    wordParts: buildClickableTextParts(text),
    after: text.slice(sentenceRange.end),
    target: true,
  }
}

export async function resolveReviewAudio(context, options = {}) {
  const source = await resolveReviewSource(context, options)
  return source && source.url ? source : null
}

export async function resolveReviewSource(context, options = {}) {
  const sourceId = normalizeText(context && (context.source_id || context.sourceId))
  const sentence = normalizeText(context && context.sentence)
  if (!sourceId || !sentence) return null
  const client = options.client || youtubeWorkflowClient
  const createObjectURL = options.createObjectURL || (typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL.bind(URL) : null)
  if (!client || typeof client.getFile !== 'function') return null

  const timeoutMs = Math.max(250, Number(options.timeoutMs) || 6000)
  try {
    const transcriptController = typeof AbortController === 'function' ? new AbortController() : null
    const chunkController = typeof AbortController === 'function' ? new AbortController() : null
    const [transcript, chunkData] = await Promise.all([
      loadReviewTranscript(client, sourceId, {
        controller: transcriptController,
        timeoutMs,
      }),
      loadReviewChunkData(client, sourceId, {
        controller: chunkController,
        timeoutMs,
      }).catch(() => null),
    ])
    const contextWindow = buildTranscriptContextWindow(transcript, sentence)
    const target = contextWindow.find((item) => item.target)
    if (!target) {
      const error = new Error('Review transcript does not contain the target sentence')
      error.code = 'TARGET_SENTENCE_NOT_FOUND'
      notifyReviewSourceError(options, error)
      return null
    }
    const wordRange = findTranscriptWordRange(target.segment, options.word)
    const result = {
      paragraphs: contextWindow.map((item) => {
        const highlighted = highlightContextParagraph(item.text, item.target ? item.text : '', options.word)
        return {
          ...highlighted,
          sentenceWordParts: item.target
            ? buildClickableTextParts(item.text, item.segment, options.word)
            : highlighted.sentenceWordParts,
          wordParts: buildClickableTextParts(item.text, item.segment),
          start: getSegmentTime(item.segment, ['start', 'start_time', 'begin', 'b'], null),
          end: getSegmentTime(item.segment, ['end', 'end_time', 'finish', 'e'], null),
        }
      }),
      targetSentence: target.text,
      translationZh: findReviewSentenceTranslation(chunkData, target.text),
      url: '',
      revokeUrl: false,
      start: getSegmentTime(target.segment, ['start', 'start_time', 'begin', 'b'], 0),
      end: getSegmentTime(target.segment, ['end', 'end_time', 'finish', 'e'], null),
      wordStart: wordRange?.start ?? null,
      wordEnd: wordRange?.end ?? null,
    }
    if (typeof client.fileUrl === 'function') {
      result.url = client.fileUrl(sourceId, 'audio')
      return result
    }
    if (!createObjectURL) return result
    try {
      const audioBlob = await client.getFile(sourceId, 'audio')
      if (audioBlob && Number(audioBlob.size)) {
        result.url = createObjectURL(audioBlob)
        result.revokeUrl = true
      }
    } catch (_error) {}
    return result
  } catch (error) {
    notifyReviewSourceError(options, error)
    return null
  }
}

export function describeReviewSourceError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || error || '')
  if (code === 'TARGET_SENTENCE_NOT_FOUND') {
    return '原字幕中没有找到这条目标句，暂时无法定位原文音频。'
  }
  if (/timed out|abort/iu.test(message)) {
    return '原文音频服务响应超时，请稍后重试。'
  }
  if (/failed to fetch|fetch failed|networkerror|err_connection_refused/iu.test(message)) {
    return '原文音频服务未连接。请重新打开桌面的“英语学习”快捷方式，或点击重试。'
  }
  if (/\b404\b/u.test(message)) {
    return '没有找到这条原文对应的字幕或音频文件。'
  }
  return '原文音频暂时不可用，请重试。'
}

function notifyReviewSourceError(options, error) {
  if (typeof options.onError !== 'function') return
  try {
    options.onError(error)
  } catch (_error) {}
}

async function loadReviewTranscript(client, sourceId, options) {
  let cache = transcriptCacheByClient.get(client)
  if (!cache) {
    cache = new Map()
    transcriptCacheByClient.set(client, cache)
  }
  let request = cache.get(sourceId)
  if (!request) {
    request = withTimeout(
      client.getFile(sourceId, 'transcript', { signal: options.controller?.signal }),
      options.timeoutMs,
      () => options.controller?.abort(),
    ).then(async (transcriptBlob) => JSON.parse(await transcriptBlob.text()))
    cache.set(sourceId, request)
    if (cache.size > 8) cache.delete(cache.keys().next().value)
  }
  try {
    return await request
  } catch (error) {
    if (cache.get(sourceId) === request) cache.delete(sourceId)
    throw error
  }
}

async function loadReviewChunkData(client, sourceId, options) {
  let cache = chunkDataCacheByClient.get(client)
  if (!cache) {
    cache = new Map()
    chunkDataCacheByClient.set(client, cache)
  }
  let request = cache.get(sourceId)
  if (!request) {
    request = withTimeout(
      client.getFile(sourceId, 'chunkData', { signal: options.controller?.signal }),
      options.timeoutMs,
      () => options.controller?.abort(),
    ).then(async (chunkBlob) => JSON.parse(await chunkBlob.text()))
    cache.set(sourceId, request)
    if (cache.size > 8) cache.delete(cache.keys().next().value)
  }
  try {
    return await request
  } catch (error) {
    if (cache.get(sourceId) === request) cache.delete(sourceId)
    throw error
  }
}

export function findReviewSentenceTranslation(chunkData, sentence, maximumChunks = 20) {
  const target = normalizeMatchText(sentence)
  if (!target) return ''
  const chunks = collectReviewChunks(chunkData)
  const limit = Math.max(1, Number(maximumChunks) || 20)
  for (let start = 0; start < chunks.length; start += 1) {
    let english = ''
    const translations = []
    for (let index = start; index < chunks.length && index < start + limit; index += 1) {
      const chunk = chunks[index]
      const chunkEnglish = normalizeText(chunk?.en || chunk?.text || chunk?.sentence)
      if (!chunkEnglish) break
      english = normalizeText(`${english} ${chunkEnglish}`)
      const candidate = normalizeMatchText(english)
      if (!candidate || !target.startsWith(candidate)) break
      const translation = normalizeText(chunk?.zh || chunk?.translationZh || chunk?.translation_zh)
      if (translation) translations.push(translation)
      if (candidate === target) return translations.length ? translations.join('') : ''
    }
  }
  return ''
}

function collectReviewChunks(chunkData) {
  if (Array.isArray(chunkData)) return chunkData.flatMap((item) => Array.isArray(item?.chunks) ? item.chunks : [item])
  if (Array.isArray(chunkData?.s)) return chunkData.s.flatMap((item) => Array.isArray(item?.chunks) ? item.chunks : [])
  if (Array.isArray(chunkData?.items)) return chunkData.items.flatMap((item) => Array.isArray(item?.chunks) ? item.chunks : [item])
  if (Array.isArray(chunkData?.chunks)) return chunkData.chunks
  return []
}

export function releaseReviewAudio(audio, options = {}) {
  if (!audio || !audio.url || (!audio.revokeUrl && !String(audio.url).startsWith('blob:'))) return
  const revokeObjectURL = options.revokeObjectURL || (typeof URL !== 'undefined' && URL.revokeObjectURL ? URL.revokeObjectURL.bind(URL) : null)
  if (revokeObjectURL) revokeObjectURL(audio.url)
}

export function withTimeout(promise, timeoutMs, onTimeout) {
  let timeout
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        if (typeof onTimeout === 'function') onTimeout()
        reject(new Error('Review source request timed out'))
      }, timeoutMs)
    }),
  ]).finally(() => clearTimeout(timeout))
}

export function findTranscriptSegment(transcript, sentence) {
  const index = findTranscriptSegmentIndex(transcript, sentence)
  return index >= 0 ? transcript.segments[index] : null
}

export function findTranscriptSegmentIndex(transcript, sentence) {
  const target = normalizeMatchText(sentence)
  if (!target) return -1
  const segments = transcript && Array.isArray(transcript.segments) ? transcript.segments : []
  return segments.findIndex((segment) => {
    const candidate = normalizeMatchText(getSegmentText(segment))
    return candidate && (candidate === target || candidate.includes(target) || target.includes(candidate))
  })
}

export function buildTranscriptContextWindow(transcript, sentence, maximum = 3) {
  const segments = transcript && Array.isArray(transcript.segments) ? transcript.segments : []
  const targetIndex = findTranscriptSegmentIndex(transcript, sentence)
  if (targetIndex < 0) return []
  const limit = Math.max(1, Math.min(Number(maximum) || 3, segments.length))
  const start = Math.max(0, Math.min(targetIndex - 1, segments.length - limit))
  return segments.slice(start, start + limit)
    .map((segment, offset) => ({
      segment,
      text: normalizeText(getSegmentText(segment)),
      target: start + offset === targetIndex,
    }))
    .filter((item) => item.text)
}

export function findTranscriptWordRange(segment, value) {
  const targetWords = tokenizeMatchWords(value)
  const timedWords = (Array.isArray(segment?.words) ? segment.words : [])
    .map((word) => ({
      text: tokenizeMatchWords(word?.word || word?.text)[0] || '',
      start: Number(word?.start),
      end: Number(word?.end),
    }))
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end))
  if (!targetWords.length || timedWords.length < targetWords.length) return null
  for (let index = 0; index <= timedWords.length - targetWords.length; index += 1) {
    const matches = targetWords.every((word, offset) => timedWords[index + offset].text === word)
    if (!matches) continue
    return {
      start: timedWords[index].start,
      end: timedWords[index + targetWords.length - 1].end,
    }
  }
  return null
}

export function buildClickableTextParts(value, segment = null, highlightedValue = '') {
  const text = String(value || '')
  const timedWords = (Array.isArray(segment?.words) ? segment.words : [])
    .map((word) => ({
      text: tokenizeMatchWords(word?.word || word?.text)[0] || '',
      start: Number(word?.start),
      end: Number(word?.end),
    }))
  const highlightRange = findNormalizedRange(text, highlightedValue)
  const matcher = /[a-z]+(?:['’][a-z]+)*/gi
  const parts = []
  let textCursor = 0
  let timingCursor = 0
  let match
  while ((match = matcher.exec(text))) {
    if (match.index > textCursor) {
      parts.push({ text: text.slice(textCursor, match.index), word: false })
    }
    const normalizedWord = tokenizeMatchWords(match[0])[0] || ''
    while (timingCursor < timedWords.length && timedWords[timingCursor].text !== normalizedWord) {
      timingCursor += 1
    }
    const timing = timedWords[timingCursor]?.text === normalizedWord
      ? timedWords[timingCursor++]
      : null
    parts.push({
      text: match[0],
      word: true,
      highlighted: Boolean(
        highlightRange
        && match.index >= highlightRange.start
        && matcher.lastIndex <= highlightRange.end
      ),
      start: Number.isFinite(timing?.start) ? timing.start : null,
      end: Number.isFinite(timing?.end) ? timing.end : null,
      remainingText: text.slice(match.index),
    })
    textCursor = matcher.lastIndex
  }
  if (textCursor < text.length) parts.push({ text: text.slice(textCursor), word: false })
  return parts
}

export function normalizeMatchText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[“”"'‘’.,!?;:()[\]{}—–\-，。！？；：、]/g, '')
}

function tokenizeMatchWords(value) {
  return String(value || '')
    .toLowerCase()
    .match(/[a-z]+(?:['’][a-z]+)*/g) || []
}

function chooseNearestThree(paragraphs, targetSentence) {
  if (paragraphs.length <= 3) return paragraphs
  const target = normalizeMatchText(targetSentence)
  const targetIndex = paragraphs.findIndex((paragraph) => {
    const normalized = normalizeMatchText(paragraph)
    return target && normalized && (normalized.includes(target) || target.includes(normalized))
  })
  if (targetIndex < 0) return paragraphs.slice(-3)
  const start = Math.max(0, Math.min(targetIndex - 1, paragraphs.length - 3))
  return paragraphs.slice(start, start + 3)
}

function splitWordParts(sentence, word) {
  if (!word) return [{ text: sentence, word: false }]
  const matcher = new RegExp(`(${escapeRegExp(word)})`, 'ig')
  return sentence.split(matcher).filter(Boolean).map((text) => ({
    text,
    word: text.toLowerCase() === word.toLowerCase(),
  }))
}

function findNormalizedRange(text, target) {
  const exactTarget = normalizeText(target)
  if (!exactTarget) return null
  const start = text.toLowerCase().indexOf(exactTarget.toLowerCase())
  if (start >= 0) return { start, end: start + exactTarget.length }
  const normalizedText = normalizeMatchText(text)
  const normalizedTarget = normalizeMatchText(exactTarget)
  if (normalizedText === normalizedTarget) return { start: 0, end: text.length }
  return null
}

function getSegmentText(segment) {
  if (!segment || typeof segment !== 'object') return ''
  if (segment.text || segment.sentence) return segment.text || segment.sentence
  if (Array.isArray(segment.words)) {
    return segment.words.map((word) => typeof word === 'string' ? word : (word.text || word.word || '')).join(' ')
  }
  return ''
}

function getSegmentTime(segment, keys, fallback) {
  for (const key of keys) {
    const value = Number(segment && segment[key])
    if (Number.isFinite(value)) return value
  }
  return fallback
}

function getTimestamp(context) {
  const value = Date.parse(context.created_at || context.createdAt || '')
  return Number.isFinite(value) ? value : 0
}

function normalizeTextBlock(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim()
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
