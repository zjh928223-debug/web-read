import poolConfig from '../../../config/ielts-learning-pools.json'

export const IELTS_LEARNING_POOL_SCHEMA = 'ielts-learning-pools.v1'
export const IELTS_LEARNING_POOL_IDS = Object.freeze({
  FULL_LEARNING: 'fullLearning',
  READING_VOCABULARY: 'readingVocabulary',
})

function normalizeBookNumber(value) {
  const book = Number(value)
  return Number.isInteger(book) && book >= 4 && book <= 21 ? book : null
}

function getPool(poolId) {
  if (poolConfig?.schemaVersion !== IELTS_LEARNING_POOL_SCHEMA) {
    throw new Error(`Unsupported IELTS learning-pool schema: ${poolConfig?.schemaVersion || 'missing'}`)
  }
  const pool = poolConfig?.pools?.[poolId]
  if (!pool || !Array.isArray(pool.books)) {
    throw new Error(`Unknown IELTS learning pool: ${poolId}`)
  }
  return pool
}

export function getIeltsLearningPoolConfig() {
  return poolConfig
}

export function getIeltsLearningPoolBooks(poolId) {
  return [...getPool(poolId).books]
}

export function isBookInIeltsLearningPool(bookNumber, poolId) {
  const book = normalizeBookNumber(bookNumber)
  return book !== null && getPool(poolId).books.includes(book)
}

export function getIeltsBookPoolEligibility(bookNumber) {
  const book = normalizeBookNumber(bookNumber)
  if (book === null) {
    return {
      book: null,
      fullLearning: false,
      readingVocabulary: false,
      exclusions: [],
    }
  }
  const exclusions = Object.entries(poolConfig.excluded || {})
    .filter(([excludedBook]) => Number(excludedBook) === book)
    .flatMap(([, value]) => Array.isArray(value?.pools)
      ? value.pools.map((poolId) => ({ poolId, reason: value.reason || 'excluded' }))
      : [])
  return {
    book,
    fullLearning: isBookInIeltsLearningPool(book, IELTS_LEARNING_POOL_IDS.FULL_LEARNING),
    readingVocabulary: isBookInIeltsLearningPool(book, IELTS_LEARNING_POOL_IDS.READING_VOCABULARY),
    exclusions,
  }
}
