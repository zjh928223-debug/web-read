import { REAL_SENTENCE_STATUS } from './sentence-source-registry.js'

export const WORDNIK_SENTENCE_SOURCE_ID = 'wordnik'

// The browser side only receives a resolver for the same-origin backend route;
// the Wordnik key and upstream transport remain owned by the Windows backend.
export function createWordnikSentenceSourceProvider({
  enabled = false,
  resolver = null,
  priority = 200,
} = {}) {
  return Object.freeze({
    id: WORDNIK_SENTENCE_SOURCE_ID,
    label: 'Wordnik',
    enabled: enabled === true,
    priority,
    transport: 'injected',
    persistence: 'none',
    async findPreviewSentence(item, options = {}) {
      if (enabled !== true) return unavailable('Wordnik sentence source is disabled.')
      if (typeof resolver !== 'function') return unavailable('Wordnik resolver has not been configured.')
      return resolver(item, options)
    },
  })
}

function unavailable(message) {
  return { status: REAL_SENTENCE_STATUS.UNAVAILABLE, message }
}
