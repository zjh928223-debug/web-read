export const PASSAGE_ONE_SOURCE_MARKER = 'C19-T1-RP1-'
export const PASSAGE_ONE_PREVIEW_SIZE = 5
export const PASSAGE_PREVIEW_MICRO_READING_SCHEMA = 'passage-preview.micro-reading.v1'
export const PASSAGE_ONE_TARGET_WORDS = Object.freeze([
  'thorough',
  'readily',
  'subtle',
  'attribute',
  'enhance',
])

export function importPassageOnePreview(payload) {
  const answersByLemma = collectFamiliarityAnswers(payload?.answers)
  const readingsByLemma = collectMicroReadings(payload)
  const missing = PASSAGE_ONE_TARGET_WORDS.filter(
    (lemma) => !answersByLemma.has(lemma) || !readingsByLemma.has(lemma),
  )
  if (missing.length) {
    throw new Error(`Passage 1 预习文件缺少指定词或微阅读数据：${missing.join('、')}。请重新导入新版五词包。`)
  }

  return PASSAGE_ONE_TARGET_WORDS.map((lemma) => {
    const answer = answersByLemma.get(lemma)
    const reading = readingsByLemma.get(lemma)
    return {
      schemaVersion: PASSAGE_PREVIEW_MICRO_READING_SCHEMA,
      id: `${answer.source}:${lemma}`,
      lemma,
      word: lemma,
      form: normalizeImportedForm(answer.form, lemma),
      pos: normalizeText(answer.pos),
      meaning: normalizeText(answer.meaning),
      phonetic: normalizeText(answer.phonetic || answer.usPhonetic),
      source: answer.source,
      targetMeaningZh: reading.targetMeaningZh,
      focusPhraseEn: reading.focusPhraseEn,
      focusPhraseZh: reading.focusPhraseZh,
      focusChunks: reading.focusChunks,
      paragraphChunks: reading.paragraphChunks,
    }
  })
}

export function validatePassagePreviewItems(items) {
  if (!Array.isArray(items) || items.length !== PASSAGE_ONE_PREVIEW_SIZE) return false
  return PASSAGE_ONE_TARGET_WORDS.every((lemma, index) => {
    const item = items[index]
    return item?.lemma === lemma
      && item?.schemaVersion === PASSAGE_PREVIEW_MICRO_READING_SCHEMA
      && isValidChunkList(item.focusChunks, true)
      && isValidChunkList(item.paragraphChunks, true)
      && Boolean(normalizeText(item.targetMeaningZh))
      && Boolean(normalizeText(item.focusPhraseEn))
      && Boolean(normalizeText(item.focusPhraseZh))
  })
}

function collectFamiliarityAnswers(answers) {
  const targetWords = new Set(PASSAGE_ONE_TARGET_WORDS)
  const result = new Map()
  for (const answer of Array.isArray(answers) ? answers : []) {
    const source = normalizeText(answer?.source)
    if (!source.includes(PASSAGE_ONE_SOURCE_MARKER)) continue
    const lemma = normalizeText(answer?.lemma || answer?.word).toLowerCase()
    if (!targetWords.has(lemma) || result.has(lemma)) continue
    result.set(lemma, { ...answer, source })
  }
  return result
}

function collectMicroReadings(payload) {
  if (payload?.microReadingSchema !== PASSAGE_PREVIEW_MICRO_READING_SCHEMA) {
    throw new Error(`微阅读 schema 必须为 ${PASSAGE_PREVIEW_MICRO_READING_SCHEMA}。`)
  }
  const targetWords = new Set(PASSAGE_ONE_TARGET_WORDS)
  const result = new Map()
  for (const input of Array.isArray(payload?.microReadings) ? payload.microReadings : []) {
    const lemma = normalizeText(input?.lemma).toLowerCase()
    if (!targetWords.has(lemma) || result.has(lemma)) continue
    const reading = {
      targetMeaningZh: requiredText(input?.targetMeaningZh, lemma, 'targetMeaningZh'),
      focusPhraseEn: requiredText(input?.focusPhraseEn, lemma, 'focusPhraseEn'),
      focusPhraseZh: requiredText(input?.focusPhraseZh, lemma, 'focusPhraseZh'),
      focusChunks: normalizeChunks(input?.focusChunks, lemma, 'focusChunks'),
      paragraphChunks: normalizeChunks(input?.paragraphChunks, lemma, 'paragraphChunks'),
    }
    if (!reading.focusChunks.some((chunk) => chunk.containsTarget)) {
      throw new Error(`${lemma} 的 focusChunks 必须标记 containsTarget。`)
    }
    if (!reading.paragraphChunks.some((chunk) => chunk.containsTarget)) {
      throw new Error(`${lemma} 的 paragraphChunks 必须标记 containsTarget。`)
    }
    result.set(lemma, reading)
  }
  return result
}

function normalizeChunks(value, lemma, field) {
  if (!Array.isArray(value) || !value.length) {
    throw new Error(`${lemma} 的 ${field} 必须是非空语义块数组。`)
  }
  return value.map((chunk, index) => ({
    en: requiredText(chunk?.en, lemma, `${field}[${index}].en`),
    zh: requiredText(chunk?.zh, lemma, `${field}[${index}].zh`),
    containsTarget: chunk?.containsTarget === true,
  }))
}

function isValidChunkList(value, requireTarget) {
  return Array.isArray(value)
    && value.length > 0
    && (!requireTarget || value.some((chunk) => chunk?.containsTarget === true))
    && value.every((chunk) => normalizeText(chunk?.en) && normalizeText(chunk?.zh))
}

function requiredText(value, lemma, field) {
  const normalized = normalizeText(value)
  if (!normalized) throw new Error(`${lemma} 的 ${field} 不能为空。`)
  return normalized
}

export function extractPreviewPhrase({ sentence, word, form, pos } = {}) {
  const tokens = tokenizeEnglish(sentence)
  const lemma = normalizeText(word).toLowerCase()
  const importedForm = normalizeImportedForm(form, lemma).toLowerCase()
  const targetIndex = tokens.findIndex((token) => {
    const normalized = token.toLowerCase()
    return normalized === importedForm
      || normalized === lemma
      || normalized.startsWith(lemma)
      || lemma.startsWith(normalized)
  })
  if (targetIndex < 0) return importedForm || lemma

  const target = tokens[targetIndex]
  const previous = tokens[targetIndex - 1]?.toLowerCase()
  const next = tokens[targetIndex + 1]?.toLowerCase()
  const afterNext = tokens[targetIndex + 2]?.toLowerCase()
  if (previous === 'so' && next === 'as' && afterNext === 'to') {
    return tokens.slice(targetIndex - 1, targetIndex + 5).join(' ')
  }
  if (isBeAuxiliary(previous) && next === 'to') return `be ${target} ${tokens[targetIndex + 1]}`
  const trailingCount = normalizeText(pos).toLowerCase().startsWith('adv') ? 1 : 2
  return tokens.slice(targetIndex, targetIndex + trailingCount + 1).join(' ')
}

function normalizeImportedForm(value, fallback) {
  const withoutCount = normalizeText(value).replace(/[×x]\s*\d+\s*$/i, '').trim()
  return withoutCount || normalizeText(fallback)
}

function tokenizeEnglish(value) {
  return String(value || '').match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || []
}

function isBeAuxiliary(value) {
  return ['am', 'are', 'is', 'was', 'were', 'be', 'been', 'being'].includes(value)
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}
