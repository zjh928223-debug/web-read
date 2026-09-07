import {
  rankSentenceCandidates,
  SENTENCE_RANKING_USE_CASES,
} from '../../services/vocabulary/personalization/sentence-candidate-ranking.js'
import { REAL_SENTENCE_STATUS } from '../../services/vocabulary/personalization/sentence-source-registry.js'

export const WORDNIK_PREVIEW_ENDPOINT = '/api/vocabulary/wordnik-examples'

export async function findWordnikPreviewSentence(item, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return unavailable('Wordnik 例句服务不可用。')
  const word = normalizeText(item?.word || item?.form || item?.lemma).toLowerCase()
  const meaningZh = normalizeText(item?.primaryMeaningZh || item?.targetMeaningZh)
  if (!word || !meaningZh) return unavailable('缺少目标词或主要义。')

  const targetSenseKey = normalizeText(item?.targetSenseKey) || `preview:${word}:${meaningZh}`

  try {
    const response = await fetchImpl(`${WORDNIK_PREVIEW_ENDPOINT}?word=${encodeURIComponent(word)}&limit=12`, {
      signal: options.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      if (['WORDNIK_NOT_CONFIGURED', 'WORDNIK_LOCAL_BUDGET_EXHAUSTED', 'WORDNIK_OBSERVED_RATE_LIMIT', 'WORDNIK_UPSTREAM_RATE_LIMITED'].includes(payload?.code)) {
        return unavailable(wordnikUnavailableMessage(payload?.code))
      }
      throw new Error(payload?.error || `HTTP ${response.status}`)
    }

    const candidates = (Array.isArray(payload?.items) ? payload.items : [])
      .map((entry) => toRankingCandidate(entry, targetSenseKey))
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
    if (!selected) return unavailable('Wordnik 暂未返回符合首次接触难度的短句。')
    const original = selected.original_candidate
    const result = {
      status: REAL_SENTENCE_STATUS.READY,
      sentence: original.sentence,
      translationZh: '',
      targetSenseKey,
      senseMatchMethod: 'wordnik-ranked-example-for-primary-sense',
      source: {
        kind: 'dictionary_example',
        name: 'Wordnik',
        recordId: original.source_locator.entry_id,
        owner: original.provider_name || original.source_title || null,
        ownerLabel: '内容提供方',
        license: 'Wordnik API Terms',
        url: original.attribution_url,
        attributionText: original.attribution_text || null,
        brandingRequired: true,
        brandingLabel: 'Wordnik',
        poweredByLogoUrl: 'https://www.wordnik.com/img/wordnik_badge_a2.png',
      },
      policyVersion: ranking.policy_version,
    }
    return result
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    return {
      status: REAL_SENTENCE_STATUS.ERROR,
      message: 'Wordnik 真实短句加载失败；未使用 AI 句或剑雅长句替代。',
    }
  }
}

function toRankingCandidate(entry, targetSenseKey) {
  return {
    candidate_id: `wordnik:${entry?.id || ''}`,
    sentence: String(entry?.sentence ?? ''),
    target_sense_key: targetSenseKey,
    target_sense_match: true,
    source_kind: 'dictionary_example',
    source_id: `wordnik:${entry?.id || ''}`,
    source_title: 'Wordnik',
    source_locator: {
      locator_version: 'source-locator.v1',
      entry_id: String(entry?.id || ''),
    },
    license_kind: 'dictionary_terms',
    ownership: 'third_party',
    quality_status: 'validated',
    content_status: 'authentic',
    independent_comprehensibility: true,
    naturalness: 0.8,
    provider_name: entry?.providerName || null,
    original_url: entry?.originalUrl || null,
    attribution_url: entry?.wordUrl || '',
    attribution_text: entry?.attributionText || null,
  }
}

function wordnikUnavailableMessage(code) {
  if (code === 'WORDNIK_NOT_CONFIGURED') return 'Wordnik API Key 尚未配置。'
  if (code === 'WORDNIK_LOCAL_BUDGET_EXHAUSTED') return 'Wordnik 本小时安全额度已用完。'
  if (code === 'WORDNIK_OBSERVED_RATE_LIMIT') return 'Wordnik 已报告当前分钟或小时额度暂时用完。'
  return 'Wordnik 当前请求额度不足。'
}

function unavailable(message) {
  return { status: REAL_SENTENCE_STATUS.UNAVAILABLE, message }
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}
