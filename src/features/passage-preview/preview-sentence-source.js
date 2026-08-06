import {
  createSentenceSourceRegistry,
  REAL_SENTENCE_STATUS,
} from '../../services/vocabulary/personalization/sentence-source-registry.js'
import { createWordnikSentenceSourceProvider } from '../../services/vocabulary/personalization/wordnik-sentence-source.js'
import { findRealPreviewSentence } from './tatoeba-preview-sentence.js'
import { findWordnikPreviewSentence } from './wordnik-preview-sentence.js'

export { REAL_SENTENCE_STATUS }

export function createPreviewSentenceSourceRegistry(options = {}) {
  return createSentenceSourceRegistry({
    providers: [
      {
        id: 'tatoeba',
        label: 'Tatoeba',
        enabled: options.tatoebaEnabled !== false,
        priority: 100,
        transport: 'same-origin-api',
        persistence: 'local-preview',
        findPreviewSentence: options.tatoebaResolver || findRealPreviewSentence,
      },
      createWordnikSentenceSourceProvider({
        enabled: options.wordnik?.enabled !== false,
        resolver: options.wordnik?.resolver || findWordnikPreviewSentence,
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
