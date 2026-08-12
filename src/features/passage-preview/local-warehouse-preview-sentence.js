import { REAL_SENTENCE_STATUS } from '../../services/vocabulary/personalization/sentence-source-registry.js'
import {
  findEnglishInflectionInSentence,
  isEnglishInflectionOf,
} from '../../services/vocabulary/english-inflection-match.mjs'

export async function findLocalWarehousePreviewSentence(item, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return unavailable('本地例句服务不可用')
  const word = normalizeWord(item?.word || item?.lemma)
  const lemma = normalizeWord(item?.lemma)
  if (!word && !lemma) return unavailable('缺少目标词')

  try {
    const params = new URLSearchParams({ word: word || lemma, lemma: lemma || word, limit: '32', maxWords: '14' })
    const response = await fetchImpl(`/api/vocabulary/local-sentences?${params}`, { signal: options.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    if (!payload?.available) return unavailable('本地例句仓库尚未构建')
    const primarySense = normalizePrimarySense(payload.primarySense)
    const selected = selectCandidate(payload.items, {
      word,
      lemma,
      primarySense,
      partOfSpeech: item?.pos || item?.partOfSpeech,
    })
    if (!selected) return unavailable('暂未找到合格的本地短句')
    const matchedForm = findEnglishInflectionInSentence(selected.sentence, selected.lemma, {
      preferredForm: word,
    })
    return {
      status: REAL_SENTENCE_STATUS.READY,
      sentence: selected.sentence,
      translationZh: '',
      matchedLemma: selected.lemma,
      matchedForm,
      targetLemma: selected.lemma,
      primaryMeaningZh: primarySense?.meaningZh || normalizeText(item?.primaryMeaningZh),
      primaryPartOfSpeech: primarySense?.partOfSpeech || normalizePartOfSpeech(item?.pos || item?.partOfSpeech),
      primaryDefinitionEn: primarySense?.definitionEn || '',
      primarySenseStatus: primarySense ? 'resolved' : item?.primarySenseStatus,
      primarySenseReason: primarySense ? '本地双语学习词典的首要义项，并已按词性与英文释义匹配例句' : item?.primarySenseReason,
      targetSenseKey: primarySense
        ? `local-primary:${primarySense.lemma || lemma || word}:${primarySense.partOfSpeech}:${primarySense.meaningZh}`
        : normalizeText(item?.targetSenseKey) || `preview:${lemma || word}:${normalizeText(item?.primaryMeaningZh)}`,
      source: {
        kind: selected.source?.type || 'dictionary_example',
        name: selected.source?.name || '本地例句仓库',
        recordId: selected.source?.recordId || selected.lemma,
        owner: null,
        license: selected.source?.license || '本地个人资料；不随应用分发',
        url: selected.source?.url || '',
        ref: selected.source?.ref || '',
      },
      policyVersion: 'local-first-preview-sentence.v2',
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    return { status: REAL_SENTENCE_STATUS.ERROR, message: '本地例句查询失败' }
  }
}

export function selectCandidate(items, { word, lemma, primarySense, partOfSpeech } = {}) {
  const targetPartOfSpeech = normalizePartOfSpeech(primarySense?.partOfSpeech || partOfSpeech)
  const lockedLemma = normalizeWord(primarySense?.lemma)
  let eligible = (Array.isArray(items) ? items : [])
    .filter((item) => isEligible(item, lemma || word))
  if (lockedLemma) eligible = eligible.filter((item) => normalizeWord(item?.lemma) === lockedLemma)
  if (targetPartOfSpeech) {
    const samePartOfSpeech = eligible.filter((item) => normalizePartOfSpeech(item?.partOfSpeech) === targetPartOfSpeech)
    if (samePartOfSpeech.length) eligible = samePartOfSpeech
    else if (primarySense) return null
  }
  const candidates = eligible
    .map((item) => ({ item, score: score(item, word, lemma, primarySense) }))
    .sort((left, right) => left.score - right.score || left.item.sentence.localeCompare(right.item.sentence))
  return candidates[0]?.item || null
}

function isEligible(item, target) {
  const sentence = normalizeText(item?.sentence)
  const count = Number(item?.wordCount) || sentence.split(/\s+/u).length
  if (!sentence || count < 3 || count > 14) return false
  const targetSurface = normalizeWord(target)
  const candidateLemma = normalizeWord(item?.lemma || target)
  return Boolean(targetSurface)
    && Boolean(candidateLemma)
    && isEnglishInflectionOf(targetSurface, candidateLemma)
    && Boolean(findEnglishInflectionInSentence(sentence, candidateLemma, { preferredForm: targetSurface }))
}

function score(item, word, lemma, primarySense) {
  const sentence = normalizeText(item.sentence)
  const exactSurface = containsWord(sentence, word)
  const exactLemma = containsWord(sentence, lemma)
  const sourcePenalty = {
    dictionary_example: 0,
    open_dictionary_example: 2,
    authentic_excerpt: 4,
  }[item.source?.type] ?? 6
  const count = Number(item.wordCount) || sentence.split(/\s+/u).length
  const fragmentPenalty = /[.!?]$/u.test(sentence) ? 0 : 5
  const semanticReward = semanticOverlap(primarySense?.definitionEn, item?.senseGloss) * 20
  const senseOrderPenalty = Math.min(Number(item?.senseOrder) || 999, 20) / 10
  return (exactSurface ? 0 : exactLemma ? 3 : 8)
    + sourcePenalty + fragmentPenalty + Math.abs(count - 9) / 10 + senseOrderPenalty - semanticReward
}

function semanticOverlap(left, right) {
  const leftTokens = semanticTokens(left)
  const rightTokens = semanticTokens(right)
  if (!leftTokens.size || !rightTokens.size) return 0
  let overlap = 0
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1
  return overlap
}

function semanticTokens(value) {
  const stopWords = new Set(['the', 'a', 'an', 'of', 'or', 'and', 'to', 'with', 'by', 'for', 'that', 'is', 'are', 'be', 'been', 'little', 'no'])
  return new Set((normalizeText(value).toLowerCase().match(/[a-z]+/gu) || [])
    .map((token) => token.endsWith('ing') && token.length > 5 ? token.slice(0, -3) : token)
    .map((token) => token.endsWith('s') && token.length > 4 ? token.slice(0, -1) : token)
    .filter((token) => token.length > 2 && !stopWords.has(token)))
}

function normalizePrimarySense(value) {
  if (!value || typeof value !== 'object') return null
  const meaningZh = normalizeText(value.meaningZh)
  const definitionEn = normalizeText(value.definitionEn)
  const partOfSpeech = normalizePartOfSpeech(value.partOfSpeech)
  if (!meaningZh || !definitionEn || !partOfSpeech) return null
  return { ...value, meaningZh, definitionEn, partOfSpeech, lemma: normalizeWord(value.lemma) }
}

function normalizePartOfSpeech(value) {
  const normalized = normalizeText(value).toLowerCase().replace(/\.$/u, '')
  if (['a', 'adj', 'adjective', 's'].includes(normalized)) return 'adjective'
  if (['n', 'noun'].includes(normalized) || /\bnoun\b/u.test(normalized)) return 'noun'
  if (['v', 'verb'].includes(normalized) || /\bverb\b/u.test(normalized)) return 'verb'
  if (['adv', 'adverb', 'r'].includes(normalized) || /\badverb\b/u.test(normalized)) return 'adverb'
  return normalized
}

function containsWord(sentence, word) {
  const normalized = normalizeWord(word)
  return normalized ? new RegExp(`(?<![A-Za-z])${escapeRegExp(normalized)}(?![A-Za-z])`, 'iu').test(sentence) : false
}

function unavailable(message) {
  return { status: REAL_SENTENCE_STATUS.UNAVAILABLE, message }
}

function normalizeWord(value) {
  const word = normalizeText(value).toLowerCase()
  return /^[a-z]+(?:[-'][a-z]+)*$/u.test(word) ? word : ''
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
