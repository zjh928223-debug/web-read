import {
  rankSentenceCandidates,
  SENTENCE_RANKING_USE_CASES,
} from '../../services/vocabulary/personalization/sentence-candidate-ranking.js'
import { REAL_SENTENCE_STATUS } from '../../services/vocabulary/personalization/sentence-source-registry.js'

export { REAL_SENTENCE_STATUS }

export async function findRealPreviewSentence(item, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return unavailable('真实短句服务不可用')
  const word = normalizeText(item?.word || item?.form || item?.lemma).toLowerCase()
  const meaningZh = normalizeText(item?.primaryMeaningZh || item?.targetMeaningZh)
  if (!word || !meaningZh) return unavailable('缺少目标词或主要义')

  const targetSenseKey = normalizeText(item?.targetSenseKey) || `preview:${word}:${meaningZh}`
  try {
    const response = await fetchImpl(`/api/vocabulary/real-sentences?word=${encodeURIComponent(word)}&limit=16`, {
      signal: options.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    const candidates = (Array.isArray(payload?.items) ? payload.items : [])
      .map((entry) => toRankingCandidate(entry, targetSenseKey, meaningZh))
      .filter((entry) => entry.target_sense_match)
    const ranking = rankSentenceCandidates({
      target_sense_key: targetSenseKey,
      use_case: SENTENCE_RANKING_USE_CASES.FIRST_PREVIEW,
      candidates,
    }, {
      limits: { max_word_count: 14, max_clause_depth: 1, max_structure_difficulty: 2 },
      require_independent_comprehensibility: true,
      reject_unknown_comprehensibility: true,
    })
    const selected = ranking.selected_candidate
    if (!selected) return unavailable('暂未找到与主要义匹配的合格真实短句')
    const original = selected.original_candidate
    return {
      status: REAL_SENTENCE_STATUS.READY,
      sentence: selected.metrics.sentence,
      translationZh: original.translation_zh,
      targetSenseKey,
      source: {
        kind: 'open_corpus',
        name: 'Tatoeba',
        recordId: original.source_locator.record_id,
        owner: original.owner || null,
        translationOwner: original.translation_owner || null,
        license: 'CC BY 2.0 FR',
        url: original.attribution_url,
      },
      policyVersion: ranking.policy_version,
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    return {
      status: REAL_SENTENCE_STATUS.ERROR,
      message: '真实短句加载失败；未使用 AI 句或剑雅长句代替',
    }
  }
}

export function hasMeaningOverlap(meaningZh, translationZh) {
  const terms = extractMeaningTerms(meaningZh)
  const translation = normalizeText(translationZh)
  return terms.some((term) => translation.includes(term))
}

function toRankingCandidate(entry, targetSenseKey, meaningZh) {
  const translationZh = normalizeText(entry?.translationZh)
  const targetSenseMatch = hasMeaningOverlap(meaningZh, translationZh)
  return {
    candidate_id: `tatoeba:${entry?.id || ''}`,
    sentence: normalizeText(entry?.sentence),
    translation_zh: translationZh,
    target_sense_key: targetSenseKey,
    target_sense_match: targetSenseMatch,
    source_kind: 'open_corpus',
    source_id: `tatoeba:${entry?.id || ''}`,
    source_title: 'Tatoeba',
    source_locator: {
      locator_version: 'source-locator.v1',
      record_id: String(entry?.id || ''),
    },
    license_kind: 'licensed_open',
    ownership: 'public',
    quality_status: 'validated',
    content_status: 'authentic',
    independent_comprehensibility: true,
    naturalness: 0.8,
    owner: entry?.owner || null,
    translation_owner: entry?.translationOwner || null,
    attribution_url: entry?.url || '',
  }
}

function extractMeaningTerms(value) {
  const cleaned = normalizeText(value)
    .replace(/^(?:n|v|adj|adv|noun|verb|adjective|adverb)\.?\s*/iu, '')
    .replace(/[（）()\[\]【】]/gu, ' ')
  return [...new Set(
    cleaned
      .split(/[，,；;、/|\s]+/u)
      .map((term) => term.replace(/[的是地得了着于为把被会能可很较更最一这个种]/gu, '').trim())
      .filter((term) => /[\p{Script=Han}]/u.test(term) && term.length >= 2),
  )]
}

function unavailable(message) {
  return { status: REAL_SENTENCE_STATUS.UNAVAILABLE, message }
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}
