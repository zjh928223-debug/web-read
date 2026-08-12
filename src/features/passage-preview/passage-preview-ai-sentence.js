import { REAL_SENTENCE_STATUS } from './preview-sentence-source.js'
import { validatePreviewSentenceResult } from './preview-sentence-target-validation.mjs'

export const AI_PREVIEW_SENTENCE_ENDPOINT = '/api/vocabulary/ai-preview-sentences'
export const AI_PREVIEW_SENTENCE_BATCH_SIZE = 25

export async function generateAiPreviewSentenceBatches(rawItems, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return []
  const items = uniqueItems(rawItems)
  const generated = []
  for (let index = 0; index < items.length; index += AI_PREVIEW_SENTENCE_BATCH_SIZE) {
    const batch = items.slice(index, index + AI_PREVIEW_SENTENCE_BATCH_SIZE)
    const response = await fetchImpl(AI_PREVIEW_SENTENCE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: batch }),
      signal: options.signal,
    })
    if (!response.ok) continue
    const payload = await response.json().catch(() => null)
    const known = new Map(batch.map((item) => [item.id, item]))
    for (const candidate of Array.isArray(payload?.items) ? payload.items : []) {
      const source = known.get(normalizeId(candidate?.id))
      const sentence = normalizeText(candidate?.sentence)
      if (!source || !sentence) continue
      const validation = validatePreviewSentenceResult(source, createAiSentenceResult(source, sentence))
      if (validation.accepted && isSimpleAiPreviewSentence(validation.result.sentence)) {
        generated.push(validation.result)
      }
    }
  }
  return generated
}

export function isSimpleAiPreviewSentence(value) {
  const sentence = normalizeText(value)
  const wordCount = (sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/gu) || []).length
  if (wordCount < 4 || wordCount > 14) return false
  if (/[,;:()[\]{}"“”‘’]/u.test(sentence)) return false
  if (/[.!?].+[.!?]/u.test(sentence)) return false
  if (/[\u3400-\u9fff]/u.test(sentence)) return false
  if (/\b(?:because|although|though|while|whereas|which|who|whose|whom)\b/iu.test(sentence)) return false
  return true
}

export async function findAiPreviewSentence(item, options = {}) {
  const generated = await generateAiPreviewSentenceBatches([toInputItem(item)], options)
  return generated[0] || null
}

function createAiSentenceResult(item, sentence) {
  const lemma = normalizeWord(item.lemma || item.word)
  return {
    id: item.id,
    status: REAL_SENTENCE_STATUS.READY,
    sentence,
    translationZh: '',
    targetLemma: lemma,
    matchedLemma: lemma,
    matchedForm: item.form || item.word || lemma,
    matchedPartOfSpeech: item.pos || item.partOfSpeech || '',
    primaryMeaningZh: item.primaryMeaningZh || item.meaningZh || '',
    primaryPartOfSpeech: item.pos || item.partOfSpeech || '',
    primaryDefinitionEn: item.primaryDefinitionEn || item.definitionEn || '',
    primarySenseStatus: item.primarySenseStatus || 'suggested',
    primarySenseReason: item.primarySenseReason || '沿用批次义项，仅用于生成辅助例句',
    targetSenseKey: item.targetSenseKey || `ai-preview:${lemma}:${item.primaryMeaningZh || item.meaningZh || ''}`,
    generated: true,
    authentic: false,
    usableForGraduation: false,
    persistence: 'session-only',
    source: {
      kind: 'ai_generated',
      name: 'Gemini AI 辅助例句',
      recordId: `ai-preview:${item.id}`,
      license: 'AI-generated learning aid; not authentic source evidence',
      url: '',
      brandingRequired: false,
    },
    policyVersion: 'ai-generated-preview-sentence.v1',
  }
}

function toInputItem(item = {}) {
  return {
    id: normalizeId(item.id) || `preview-${normalizeWord(item.lemma || item.word)}`,
    lemma: normalizeWord(item.lemma || item.word),
    word: normalizeText(item.word) || normalizeWord(item.lemma || item.word),
    form: normalizeText(item.form) || normalizeText(item.word) || normalizeWord(item.lemma || item.word),
    pos: normalizeText(item.pos || item.partOfSpeech),
    partOfSpeech: normalizeText(item.pos || item.partOfSpeech),
    primaryMeaningZh: normalizeText(item.primaryMeaningZh || item.meaningZh),
    meaningZh: normalizeText(item.primaryMeaningZh || item.meaningZh),
    primaryDefinitionEn: normalizeText(item.primaryDefinitionEn || item.definitionEn),
    definitionEn: normalizeText(item.primaryDefinitionEn || item.definitionEn),
    primarySenseStatus: normalizeText(item.primarySenseStatus),
    primarySenseReason: normalizeText(item.primarySenseReason),
    targetSenseKey: normalizeText(item.targetSenseKey),
  }
}

function uniqueItems(rawItems) {
  const seen = new Set()
  const result = []
  for (const rawItem of Array.isArray(rawItems) ? rawItems : []) {
    const item = toInputItem(rawItem)
    if (!item.id || !item.lemma || seen.has(item.id)) continue
    seen.add(item.id)
    result.push(item)
  }
  return result
}

function normalizeId(value) {
  return normalizeText(value).replace(/[^a-zA-Z0-9._:-]/gu, '').slice(0, 128)
}

function normalizeWord(value) {
  const word = normalizeText(value).toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) ? word : ''
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}
