import { REAL_SENTENCE_STATUS } from './sentence-source-registry.js'

export const WORDNIK_SENTENCE_SOURCE_ID = 'wordnik'

// This is an intentionally inert integration port. A future Wordnik adapter can
// inject a resolver without changing preview UI or source-selection code.
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
