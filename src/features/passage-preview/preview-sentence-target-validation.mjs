import {
  findEnglishInflectionInSentence,
  isEnglishInflectionOf,
  normalizeEnglishWord,
} from '../../services/vocabulary/english-inflection-match.mjs'

export const PREVIEW_TARGET_VALIDATION_VERSION = 'preview-target-validation.v2'
export const PREVIEW_SENTENCE_MAX_WORD_COUNT = 14

export function validatePreviewSentenceResult(item, result) {
  const isReady = result?.status === 'ready' || (!result?.status && Boolean(result?.sentence))
  if (!isReady) return { accepted: false, result }
  const targetSurface = normalizeEnglishWord(item?.word || item?.lemma)
  const fallbackLemma = normalizeEnglishWord(item?.lemma || item?.word)
  const candidateLemma = normalizeEnglishWord(result.targetLemma || result.matchedLemma || fallbackLemma)
  if (!targetSurface || !candidateLemma || !isEnglishInflectionOf(targetSurface, candidateLemma)) {
    return rejected('候选 lemma 与目标词形不一致')
  }

  const matchedForm = findEnglishInflectionInSentence(result.sentence, candidateLemma, {
    preferredForm: result.matchedForm || targetSurface,
  })
  if (!matchedForm) return rejected('句中没有目标 lemma 的合法词形')

  const wordCount = countSentenceWords(result.sentence)
  if (wordCount > PREVIEW_SENTENCE_MAX_WORD_COUNT) {
    return rejected(`首次预习短句不能超过 ${PREVIEW_SENTENCE_MAX_WORD_COUNT} 个单词`)
  }

  const targetPartOfSpeech = normalizePartOfSpeech(item?.pos || item?.partOfSpeech)
  const candidatePartOfSpeech = normalizePartOfSpeech(
    result.primaryPartOfSpeech || result.matchedPartOfSpeech || result.partOfSpeech,
  )
  if (targetPartOfSpeech && candidatePartOfSpeech && targetPartOfSpeech !== candidatePartOfSpeech) {
    return rejected('候选词性与目标词性不一致')
  }

  return {
    accepted: true,
    result: {
      ...result,
      status: 'ready',
      targetLemma: candidateLemma,
      matchedLemma: candidateLemma,
      matchedForm,
      targetValidationVersion: PREVIEW_TARGET_VALIDATION_VERSION,
    },
  }
}

function normalizePartOfSpeech(value) {
  const normalized = String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\.$/u, '')
  if (['a', 'adj', 'adjective', 's'].includes(normalized)) return 'adjective'
  if (['n', 'noun'].includes(normalized) || /\bnoun\b/u.test(normalized)) return 'noun'
  if (['v', 'verb'].includes(normalized) || /\bverb\b/u.test(normalized)) return 'verb'
  if (['adv', 'adverb', 'r'].includes(normalized) || /\badverb\b/u.test(normalized)) return 'adverb'
  return normalized
}

function countSentenceWords(value) {
  return (String(value || '').match(/[A-Za-z]+(?:['’][A-Za-z]+)*/gu) || []).length
}

function rejected(message) {
  return {
    accepted: false,
    result: { status: 'unavailable', message: `目标词最终验收未通过：${message}` },
  }
}
