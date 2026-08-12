import { resolvePrimarySense } from '../../services/vocabulary/personalization/primary-sense-policy.js'

export const PASSAGE_ONE_SOURCE_MARKER = 'C19-T1-RP1-'
export const PASSAGE_ONE_PREVIEW_SIZE = 5
export const PASSAGE_PREVIEW_MICRO_READING_SCHEMA = 'passage-preview.micro-reading.v1'
export const FIRST_CONTACT_PREVIEW_SCHEMA = 'vocabulary-preview.first-contact.v1'
export const PASSAGE_ONE_TARGET_WORDS = Object.freeze([
  'thorough',
  'readily',
  'subtle',
  'attribute',
  'enhance',
])

export function importVocabularyPreview(payload = {}) {
  const rawItems = Array.isArray(payload?.items) && payload.schemaVersion === FIRST_CONTACT_PREVIEW_SCHEMA
    ? payload.items
    : collectAnswerItems(payload)
  if (!rawItems.length) throw new Error('预习文件中没有可用单词。')
  const batchTitle = normalizeText(payload.batchTitle || payload.title) || `${rawItems.length}词首次接触`
  const seen = new Set()
  const items = []
  rawItems.forEach((input, index) => {
    const lemma = normalizeText(input?.lemma || input?.word).toLowerCase()
    if (!lemma || seen.has(lemma)) return
    seen.add(lemma)
    const primary = resolveImportedPrimarySense(input, lemma)
    if (!primary.meaningZh) return
    items.push({
      schemaVersion: FIRST_CONTACT_PREVIEW_SCHEMA,
      id: normalizeText(input?.id) || `${normalizeText(input?.source) || 'preview'}:${lemma}:${index}`,
      lemma,
      word: normalizeText(input?.word || input?.lemma) || lemma,
      form: normalizeImportedForm(input?.form, lemma),
      pos: normalizeText(input?.pos || input?.partOfSpeech),
      phonetic: normalizeText(input?.phonetic || input?.usPhonetic),
      source: normalizeText(input?.source),
      batchTitle,
      primaryMeaningZh: primary.meaningZh,
      primarySenseStatus: primary.status,
      primarySenseReason: primary.reason,
      targetSenseKey: primary.targetSenseKey,
      realSentence: normalizeRealSentence(input?.realSentence, lemma),
      previewContext: normalizePreviewContext(input?.previewContext, lemma),
    })
  })
  if (!items.length) throw new Error('预习文件缺少可用的单一中文主要义。')
  return items
}

// Compatibility name retained for the previous five-word caller.
export function importPassageOnePreview(payload) {
  return importVocabularyPreview(payload)
}

export function validatePassagePreviewItems(items) {
  return Array.isArray(items)
    && items.length > 0
    && items.every((item) => (
      item?.schemaVersion === FIRST_CONTACT_PREVIEW_SCHEMA
      && Boolean(normalizeText(item.id))
      && Boolean(normalizeText(item.lemma || item.word))
      && Boolean(normalizeText(item.primaryMeaningZh))
    ))
}

function collectAnswerItems(payload) {
  const answers = Array.isArray(payload?.answers) ? payload.answers : []
  if (payload?.microReadingSchema !== PASSAGE_PREVIEW_MICRO_READING_SCHEMA) return answers
  const readings = new Map((Array.isArray(payload?.microReadings) ? payload.microReadings : []).map((item) => [
    normalizeText(item?.lemma).toLowerCase(),
    item,
  ]))
  return answers.map((answer) => {
    const lemma = normalizeText(answer?.lemma || answer?.word).toLowerCase()
    const reading = readings.get(lemma)
    return {
      ...answer,
      primaryMeaningZh: reading?.targetMeaningZh || answer?.primaryMeaningZh || answer?.zh,
    }
  })
}

function resolveImportedPrimarySense(input, lemma) {
  const evidenceInput = input?.primarySenseEvidence || input?.senseEvidence
  if (evidenceInput && typeof evidenceInput === 'object') {
    const result = resolvePrimarySense({
      lemma,
      pos: input?.pos || input?.partOfSpeech,
      ...evidenceInput,
    })
    if (result.status === 'resolved' && result.primary_sense_key) {
      const selected = (Array.isArray(evidenceInput.candidates) ? evidenceInput.candidates : [])
        .find((candidate) => normalizeText(candidate?.sense_key || candidate?.id) === result.primary_sense_key)
      const meaningZh = selectOneMeaning(
        selected?.meaningZh || selected?.meaning_zh || selected?.meaning || selected?.gloss,
        selected?.pos || selected?.partOfSpeech || input?.pos || input?.partOfSpeech,
      )
      if (meaningZh) {
        return {
          meaningZh,
          status: 'resolved',
          reason: '两个以上独立义项证据达成一致',
          targetSenseKey: result.primary_sense_key,
        }
      }
    }
  }

  const explicit = input?.primaryMeaningZh
    || input?.targetMeaningZh
    || input?.simpleMeaningZh
    || input?.simple_meaning
    || input?.zh
    || input?.translation
    || input?.meaning
  const meaningZh = selectOneMeaning(explicit, input?.pos || input?.partOfSpeech)
  return {
    meaningZh,
    status: input?.primarySenseStatus === 'resolved' ? 'resolved' : 'suggested',
    reason: input?.primarySenseStatus === 'resolved'
      ? '导入数据已确认主要义'
      : '证据不足，暂取精简释义的第一项；不是词频比例结论',
    targetSenseKey: normalizeText(input?.targetSenseKey) || `preview:${lemma}:${meaningZh}`,
  }
}

function selectOneMeaning(value, partOfSpeech = '') {
  const normalized = normalizeText(selectPartOfSpeechSection(value, partOfSpeech) || value)
    .replace(/^\[[^\]]+\]\s*/u, '')
    .replace(/^(?:n|v|a|adj|adv|noun|verb|adjective|adverb)\.?\s*/iu, '')
  if (!normalized) return ''
  return normalizeText(normalized.split(/[;；\n]|[,，](?=\s*[^（(]{1,12}(?:[,，;；]|$))/u)[0])
    .replace(/[；;，,。]+$/u, '')
}

function selectPartOfSpeechSection(value, partOfSpeech) {
  const target = normalizePartOfSpeech(partOfSpeech)
  if (!target) return ''
  const text = String(value ?? '').normalize('NFKC').replace(/\r?\n/gu, ' ')
  const pattern = /(?:^|\s)(n|noun|v|verb|a|adj|adjective|adv|adverb)\.?\s+([\s\S]*?)(?=\s+(?:n|noun|v|verb|a|adj|adjective|adv|adverb)\.?\s+|$)/giu
  for (const match of text.matchAll(pattern)) {
    if (normalizePartOfSpeech(match[1]) === target) return match[2]
  }
  return ''
}

function normalizePartOfSpeech(value) {
  const normalized = normalizeText(value).toLowerCase().replace(/\.$/u, '')
  if (['a', 'adj', 'adjective', 's'].includes(normalized)) return 'adjective'
  if (['n', 'noun'].includes(normalized)) return 'noun'
  if (['v', 'verb'].includes(normalized)) return 'verb'
  if (['adv', 'adverb', 'r'].includes(normalized)) return 'adverb'
  return normalized
}

function normalizeRealSentence(value, lemma) {
  if (!value || typeof value !== 'object') return null
  const sentence = normalizeText(value.sentence)
  const translationZh = normalizeText(value.translationZh)
  const source = value.source && typeof value.source === 'object' ? value.source : null
  if (!sentence || !translationZh || !source?.name || !source?.url || !source?.license) return null
  if (!['article', 'subtitle', 'open_corpus', 'dictionary_example'].includes(source.kind)) return null
  if (/\b(?:ai|generated)\b/iu.test(`${source.kind} ${source.name} ${source.license}`)) return null
  if ((sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || []).length > 16) return null
  const escaped = String(lemma || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  if (!escaped || !new RegExp(`(?<![A-Za-z])${escaped}(?:s|es|ed|ing)?(?![A-Za-z])`, 'iu').test(sentence)) return null
  return { sentence, translationZh, source: { ...source } }
}

function normalizePreviewContext(value, lemma) {
  if (!value || typeof value !== 'object') return null
  const sentence = normalizeText(value.sentence)
  if (!sentence || !containsTargetForm(sentence, lemma)) return null
  return {
    sentence,
    surrounding_text: normalizeText(value.surrounding_text || value.surroundingText) || null,
    source_kind: normalizeText(value.source_kind || value.sourceKind) || 'user_local_exam_material',
    source_id: normalizeText(value.source_id || value.sourceId),
    source_title: normalizeText(value.source_title || value.sourceTitle),
    source_locator: value.source_locator || value.sourceLocator || null,
    license_kind: normalizeText(value.license_kind || value.licenseKind) || 'user_owned',
    ownership: normalizeText(value.ownership) || 'private',
    quality_status: normalizeText(value.quality_status || value.qualityStatus) || 'validated',
    quality_reason: normalizeText(value.quality_reason || value.qualityReason),
    validated_at: normalizeText(value.validated_at || value.validatedAt),
    extensions: value.extensions && typeof value.extensions === 'object' ? value.extensions : {},
  }
}

function containsTargetForm(sentence, lemma) {
  const escaped = String(lemma || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return Boolean(escaped && new RegExp(`(?<![A-Za-z])${escaped}(?:s|es|ed|ing)?(?![A-Za-z])`, 'iu').test(sentence))
}

export function extractPreviewPhrase({ sentence, word, form } = {}) {
  const text = normalizeText(sentence)
  const target = normalizeImportedForm(form, word)
  if (!text || !target) return target
  const words = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || []
  const index = words.findIndex((token) => token.toLowerCase().startsWith(target.toLowerCase()))
  return index < 0 ? target : words.slice(Math.max(0, index - 1), index + 3).join(' ')
}

function normalizeImportedForm(value, fallback) {
  const withoutCount = normalizeText(value).replace(/[×x]\s*\d+\s*$/i, '').trim()
  return withoutCount || normalizeText(fallback)
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}
