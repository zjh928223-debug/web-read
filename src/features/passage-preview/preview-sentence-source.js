import {
  createSentenceSourceRegistry,
  REAL_SENTENCE_STATUS,
} from '../../services/vocabulary/personalization/sentence-source-registry.js'
import { createWordnikSentenceSourceProvider } from '../../services/vocabulary/personalization/wordnik-sentence-source.js'
import { createMerriamWebsterSentenceSourceProvider } from '../../services/vocabulary/personalization/merriam-webster-sentence-source.js'
import { findRealPreviewSentence } from './tatoeba-preview-sentence.js'
import { findWordnikPreviewSentence } from './wordnik-preview-sentence.js'
import { findMerriamWebsterPreviewSentence } from './merriam-webster-preview-sentence.js'
import { findLocalWarehousePreviewSentence } from './local-warehouse-preview-sentence.js'
import {
  findEnglishInflectionInSentence,
  findExactEnglishWordInSentence,
} from '../../services/vocabulary/english-inflection-match.mjs'
import {
  PREVIEW_SENTENCE_MAX_WORD_COUNT,
  validatePreviewSentenceResult,
} from './preview-sentence-target-validation.mjs'

export { REAL_SENTENCE_STATUS }

export function resolvePreviewContextSentence(item) {
  const context = item?.previewContext
  if (!context?.sentence) return null
  const sentence = createPreviewContextExcerpt(context.sentence, item)
  if (!sentence) return null
  const validation = validatePreviewSentenceResult(item, {
    status: REAL_SENTENCE_STATUS.READY,
    sentence,
    targetLemma: item.lemma,
    matchedLemma: item.lemma,
    matchedForm: item.form || item.word || item.lemma,
    primaryMeaningZh: item.primaryMeaningZh,
    primaryPartOfSpeech: item.pos,
    source: {
      kind: context.source_kind,
      name: context.source_title,
      recordId: context.source_id,
      license: context.license_kind,
      url: '',
    },
  })
  return validation.accepted ? validation.result : null
}

function createPreviewContextExcerpt(value, item) {
  const sentence = String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()
  if (!sentence) return ''
  if (countWords(sentence) <= PREVIEW_SENTENCE_MAX_WORD_COUNT) return sentence

  const target = String(item?.word || item?.form || item?.lemma || '').normalize('NFKC').trim()
  const targetIndex = findTargetTokenIndex(sentence, target, item?.lemma)
  const sentences = sentence.split(/(?<=[.!?])\s+/u).filter(Boolean)
  const containingSentence = sentences.find((candidate) => findTargetTokenIndex(candidate, target, item?.lemma) >= 0)
  const source = containingSentence || sentence
  if (countWords(source) <= PREVIEW_SENTENCE_MAX_WORD_COUNT) return source

  const clauses = splitIntoClauses(source)
  const clauseIndex = clauses.findIndex((candidate) => findTargetTokenIndex(candidate, target, item?.lemma) >= 0)
  if (clauseIndex >= 0) {
    const windowedClauses = expandClauseWindow(clauses, clauseIndex)
    if (windowedClauses) return windowedClauses
    const clause = clauses[clauseIndex]
    if (countWords(clause) <= PREVIEW_SENTENCE_MAX_WORD_COUNT) return clause
  }

  const tokens = source.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/gu) || []
  const safeTargetIndex = targetIndex >= 0 ? targetIndex : Math.floor(tokens.length / 2)
  const start = Math.max(0, Math.min(safeTargetIndex - 6, tokens.length - PREVIEW_SENTENCE_MAX_WORD_COUNT))
  return tokens.slice(start, start + PREVIEW_SENTENCE_MAX_WORD_COUNT).join(' ')
}

function findTargetTokenIndex(sentence, target, lemma) {
  const targetToken = findExactEnglishWordInSentence(sentence, target)
  if (targetToken) {
    const tokens = sentence.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/gu) || []
    return tokens.findIndex((token) => token === targetToken)
  }
  const matchedToken = findEnglishInflectionInSentence(sentence, lemma || target)
  if (!matchedToken) return -1
  const tokens = sentence.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/gu) || []
  return tokens.findIndex((token) => token === matchedToken)
}

function splitIntoClauses(sentence) {
  return sentence
    .split(/\s*(?:[,;:]|—|–)\s*/u)
    .map((clause) => clause.trim())
    .filter(Boolean)
}

function expandClauseWindow(clauses, targetIndex) {
  let start = targetIndex
  let end = targetIndex
  while (start > 0 || end < clauses.length - 1) {
    const previous = start > 0 ? clauses[start - 1] : ''
    const next = end < clauses.length - 1 ? clauses[end + 1] : ''
    const nextStart = start > 0 && (!next || previous.length <= next.length)
    const candidateStart = nextStart ? start - 1 : start
    const candidateEnd = nextStart ? end : end + 1
    const candidate = clauses.slice(candidateStart, candidateEnd + 1).join(', ')
    if (countWords(candidate) > PREVIEW_SENTENCE_MAX_WORD_COUNT) break
    start = candidateStart
    end = candidateEnd
  }
  const result = clauses.slice(start, end + 1).join(', ')
  return countWords(result) >= 3 && countWords(result) <= PREVIEW_SENTENCE_MAX_WORD_COUNT ? result : ''
}

function countWords(value) {
  return (String(value || '').match(/[A-Za-z]+(?:['’][A-Za-z]+)*/gu) || []).length
}

export function createPreviewSentenceSourceRegistry(options = {}) {
  return createSentenceSourceRegistry({
    providers: [
      {
        id: 'local-warehouse',
        label: '本地例句仓库',
        enabled: options.localWarehouseEnabled !== false,
        priority: 50,
        transport: 'same-origin-local-sqlite',
        persistence: 'local-preview',
        findPreviewSentence: withTargetValidation(options.localWarehouseResolver || findLocalWarehousePreviewSentence),
      },
      {
        id: 'tatoeba',
        label: 'Tatoeba',
        enabled: options.tatoebaEnabled !== false,
        priority: 100,
        transport: 'same-origin-api',
        persistence: 'local-preview',
        findPreviewSentence: withTargetValidation(options.tatoebaResolver || findRealPreviewSentence),
      },
      createMerriamWebsterSentenceSourceProvider({
        enabled: options.merriamWebster?.enabled !== false,
        resolver: withTargetValidation(options.merriamWebster?.resolver || findMerriamWebsterPreviewSentence),
        priority: options.merriamWebster?.priority ?? 40,
      }),
      createWordnikSentenceSourceProvider({
        enabled: options.wordnik?.enabled !== false,
        resolver: withTargetValidation(options.wordnik?.resolver || findWordnikPreviewSentence),
        priority: options.wordnik?.priority,
      }),
    ],
  })
}

const defaultRegistry = createPreviewSentenceSourceRegistry()

export function listPreviewSentenceSources() {
  return defaultRegistry.list()
}

export function findPreviewSentence(item, options = {}) {
  const registry = options.registry || defaultRegistry
  return registry.findPreviewSentence(item, options)
}

function withTargetValidation(resolver) {
  return async (item, options) => {
    const result = await resolver(item, options)
    if (result?.status !== REAL_SENTENCE_STATUS.READY) return result
    return validatePreviewSentenceResult(item, result).result
  }
}
