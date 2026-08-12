import { REAL_SENTENCE_STATUS } from './sentence-source-registry.js'

export const MERRIAM_WEBSTER_SENTENCE_SOURCE_ID = 'merriam-webster'

export function createMerriamWebsterSentenceSourceProvider({
  enabled = false,
  resolver = null,
  priority = 75,
} = {}) {
  return Object.freeze({
    id: MERRIAM_WEBSTER_SENTENCE_SOURCE_ID,
    label: 'Merriam-Webster',
    enabled: enabled === true,
    priority,
    transport: 'same-origin-api',
    persistence: 'none',
    async findPreviewSentence(item, options = {}) {
      if (enabled !== true) return unavailable('Merriam-Webster sentence source is disabled.')
      if (typeof resolver !== 'function') return unavailable('Merriam-Webster resolver has not been configured.')
      return resolver(item, options)
    },
  })
}

function unavailable(message) {
  return { status: REAL_SENTENCE_STATUS.UNAVAILABLE, message }
}
