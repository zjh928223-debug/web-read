import {
  rankSentenceCandidates,
  SENTENCE_RANKING_USE_CASES,
} from '../../services/vocabulary/personalization/sentence-candidate-ranking.js'
import { REAL_SENTENCE_STATUS } from '../../services/vocabulary/personalization/sentence-source-registry.js'

export const MERRIAM_WEBSTER_PREVIEW_ENDPOINT = '/api/vocabulary/merriam-webster-examples'
export const MERRIAM_WEBSTER_LOGO_URL = 'https://dictionaryapi.com/images/info/branding-guidelines/MWLogo_LightBG_120x120_2x.png'
const sessionResults = new Map()

export async function findMerriamWebsterPreviewSentence(item, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return unavailable('Merriam-Webster 例句服务不可用。')
  const word = normalizeWord(item?.word || item?.form || item?.lemma)
  if (!word) return unavailable('缺少目标词。')
  const targetSenseKey = normalizeText(item?.targetSenseKey) || `preview:${word}:${normalizeText(item?.primaryMeaningZh)}`
  const cacheKey = `${word}\u0000${targetSenseKey}`
  if (sessionResults.has(cacheKey)) return clone(sessionResults.get(cacheKey))

  const attempts = []
  for (const reference of ['learners', 'dictionary']) {
    const response = await requestReference(reference, word, fetchImpl, options.signal)
    attempts.push(response.status)
    if (response.status === 'not-configured') continue
    if (response.status === 'budget') continue
    if (response.status === 'error') continue
    const selected = selectMerriamCandidate(response.items, item, targetSenseKey)
    if (!selected) continue
    const result = {
      status: REAL_SENTENCE_STATUS.READY,
      sentence: selected.original_candidate.sentence,
      translationZh: '',
      targetLemma: selected.original_candidate.target_lemma || word,
      matchedLemma: selected.original_candidate.target_lemma || word,
      matchedForm: selected.original_candidate.matched_form || selected.original_candidate.matched_term || word,
      matchedPartOfSpeech: selected.original_candidate.matched_part_of_speech || '',
      matchedDefinitionEn: selected.original_candidate.matched_definition_en || '',
      targetSenseKey,
      senseMatchMethod: selected.original_candidate.sense_match_method,
      source: {
        kind: selected.original_candidate.attribution ? 'authentic_excerpt' : 'dictionary_example',
        name: selected.original_candidate.dictionary_title,
        recordId: selected.original_candidate.source_locator.entry_id,
        owner: selected.original_candidate.attribution?.author || null,
        license: 'Merriam-Webster Dictionary API Terms',
        url: selected.original_candidate.attribution_url,
        poweredByLogoUrl: MERRIAM_WEBSTER_LOGO_URL,
        brandingRequired: true,
        brandingLabel: 'Merriam-Webster',
      },
      policyVersion: 'merriam-webster-sense-example.v1',
    }
    sessionResults.set(cacheKey, clone(result))
    return result
  }
  if (attempts.every((status) => status === 'not-configured')) {
    return unavailable('Merriam-Webster API Key 尚未配置。')
  }
  if (attempts.includes('budget')) return unavailable('Merriam-Webster 今日安全额度已用完。')
  return unavailable('Merriam-Webster 暂未返回与主要词性和义项匹配的短句。')
}

export function clearMerriamWebsterPreviewSessionCache() {
  sessionResults.clear()
}

function selectMerriamCandidate(items, item, targetSenseKey) {
  const targetPartOfSpeech = normalizePartOfSpeech(item?.pos || item?.partOfSpeech)
  const targetDefinition = normalizeText(item?.primaryDefinitionEn)
  let candidates = (Array.isArray(items) ? items : [])
    .filter((entry) => !targetPartOfSpeech || normalizePartOfSpeech(entry.partOfSpeech) === targetPartOfSpeech)
  if (targetDefinition) {
    candidates = candidates.filter((entry) => semanticOverlap(targetDefinition, entry.definition) > 0)
  } else {
    const firstSense = Math.min(...candidates.map((entry) => Number(entry.senseOrder) || 999))
    candidates = candidates.filter((entry) => (Number(entry.senseOrder) || 999) === firstSense)
  }
  const ranking = rankSentenceCandidates({
    target_sense_key: targetSenseKey,
    use_case: SENTENCE_RANKING_USE_CASES.FIRST_PREVIEW,
    candidates: candidates.map((entry) => ({
      candidate_id: `merriam-webster:${entry.id}`,
      sentence: entry.sentence,
      target_sense_key: targetSenseKey,
      target_sense_match: true,
      source_kind: entry.attribution ? 'authentic_excerpt' : 'dictionary_example',
      source_id: `merriam-webster:${entry.id}`,
      source_title: entry.dictionaryTitle,
      source_locator: { locator_version: 'source-locator.v1', entry_id: entry.id },
      license_kind: 'dictionary_terms',
      ownership: 'third_party',
      quality_status: 'validated',
      content_status: 'authentic',
      independent_comprehensibility: true,
      naturalness: entry.reference === 'learners' ? 0.95 : 0.85,
      attribution: entry.attribution,
      attribution_url: entry.sourceUrl,
      dictionary_title: entry.dictionaryTitle,
      matched_term: entry.matchedTerm,
      matched_form: entry.matchedForm,
      target_lemma: entry.targetLemma,
      matched_part_of_speech: entry.partOfSpeech,
      matched_definition_en: entry.definition,
      sense_match_method: targetDefinition ? 'definition-overlap' : 'same-pos-first-sense',
    })),
  }, {
    limits: { max_word_count: 14, max_clause_depth: 1, max_structure_difficulty: 2 },
    require_independent_comprehensibility: true,
    reject_unknown_comprehensibility: true,
  })
  return ranking.selected_candidate
}

async function requestReference(reference, word, fetchImpl, signal) {
  try {
    const url = `${MERRIAM_WEBSTER_PREVIEW_ENDPOINT}?word=${encodeURIComponent(word)}&reference=${reference}&limit=24`
    const response = await fetchImpl(url, { signal })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      if (/NOT_CONFIGURED$/u.test(payload?.code || '')) return { status: 'not-configured', items: [] }
      if (/BUDGET_EXHAUSTED|RATE_LIMITED/u.test(payload?.code || '')) return { status: 'budget', items: [] }
      return { status: 'error', items: [] }
    }
    return { status: 'ready', items: Array.isArray(payload?.items) ? payload.items : [] }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    return { status: 'error', items: [] }
  }
}

function semanticOverlap(left, right) {
  const leftTokens = semanticTokens(left)
  const rightTokens = semanticTokens(right)
  let overlap = 0
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1
  return overlap
}

function semanticTokens(value) {
  const stopWords = new Set(['the', 'a', 'an', 'of', 'or', 'and', 'to', 'with', 'by', 'for', 'that', 'is', 'are', 'be', 'been'])
  return new Set((normalizeText(value).toLowerCase().match(/[a-z]+/gu) || [])
    .map((token) => token.endsWith('ing') && token.length > 5 ? token.slice(0, -3) : token)
    .map((token) => token.endsWith('s') && token.length > 4 ? token.slice(0, -1) : token)
    .filter((token) => token.length > 2 && !stopWords.has(token)))
}

function normalizePartOfSpeech(value) {
  const normalized = normalizeText(value).toLowerCase().replace(/\.$/u, '')
  if (['a', 'adj', 'adjective', 's'].includes(normalized)) return 'adjective'
  if (['n', 'noun'].includes(normalized) || /\bnoun\b/u.test(normalized)) return 'noun'
  if (['v', 'verb'].includes(normalized) || /\bverb\b/u.test(normalized)) return 'verb'
  if (['adv', 'adverb', 'r'].includes(normalized) || /\badverb\b/u.test(normalized)) return 'adverb'
  return normalized
}

function normalizeWord(value) {
  const word = normalizeText(value).toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) ? word : ''
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function unavailable(message) {
  return { status: REAL_SENTENCE_STATUS.UNAVAILABLE, message }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}
