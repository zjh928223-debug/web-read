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
import { validatePreviewSentenceResult } from './preview-sentence-target-validation.mjs'

export { REAL_SENTENCE_STATUS }

export function resolvePreviewContextSentence(item) {
  const context = item?.previewContext
  if (!context?.sentence) return null
  const validation = validatePreviewSentenceResult(item, {
    status: REAL_SENTENCE_STATUS.READY,
    sentence: context.sentence,
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
