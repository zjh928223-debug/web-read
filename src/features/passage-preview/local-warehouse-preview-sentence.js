import { REAL_SENTENCE_STATUS } from '../../services/vocabulary/personalization/sentence-source-registry.js'

export async function findLocalWarehousePreviewSentence(item, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return unavailable('本地例句服务不可用')
  const word = normalizeWord(item?.word || item?.lemma)
  const lemma = normalizeWord(item?.lemma)
  if (!word && !lemma) return unavailable('缺少目标词')

  try {
    const params = new URLSearchParams({ word: word || lemma, lemma: lemma || word, limit: '32', maxWords: '20' })
    const response = await fetchImpl(`/api/vocabulary/local-sentences?${params}`, { signal: options.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    if (!payload?.available) return unavailable('本地例句仓库尚未构建')
    const selected = selectCandidate(payload.items, { word, lemma })
    if (!selected) return unavailable('暂未找到合格的本地短句')
    return {
      status: REAL_SENTENCE_STATUS.READY,
      sentence: selected.sentence,
      translationZh: '',
      matchedLemma: selected.lemma,
      targetSenseKey: normalizeText(item?.targetSenseKey) || `preview:${lemma || word}:${normalizeText(item?.primaryMeaningZh)}`,
      source: {
        kind: selected.source?.type || 'dictionary_example',
        name: selected.source?.name || '本地例句仓库',
        recordId: selected.source?.recordId || selected.lemma,
        owner: null,
        license: selected.source?.license || '本地个人资料；不随应用分发',
        url: selected.source?.url || '',
        ref: selected.source?.ref || '',
      },
      policyVersion: 'local-first-preview-sentence.v1',
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    return { status: REAL_SENTENCE_STATUS.ERROR, message: '本地例句查询失败' }
  }
}

export function selectCandidate(items, { word, lemma } = {}) {
  const candidates = (Array.isArray(items) ? items : [])
    .filter((item) => isEligible(item, lemma || word))
    .map((item) => ({ item, score: score(item, word, lemma) }))
    .sort((left, right) => left.score - right.score || left.item.sentence.localeCompare(right.item.sentence))
  return candidates[0]?.item || null
}

function isEligible(item, target) {
  const sentence = normalizeText(item?.sentence)
  const count = Number(item?.wordCount) || sentence.split(/\s+/u).length
  if (!sentence || count < 3 || count > 20) return false
  const escaped = escapeRegExp(normalizeWord(item?.lemma || target))
  return Boolean(escaped) && new RegExp(`(?<![A-Za-z])${escaped}(?:s|es|ed|ing)?(?![A-Za-z])`, 'iu').test(sentence)
}

function score(item, word, lemma) {
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
  return (exactSurface ? 0 : exactLemma ? 3 : 8) + sourcePenalty + fragmentPenalty + Math.abs(count - 9) / 10
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
