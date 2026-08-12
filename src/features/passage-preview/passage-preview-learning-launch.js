export const PASSAGE_PREVIEW_LEARNING_QUERY = 'learning'
export const PASSAGE_PREVIEW_LEARNING_VALUE = 'preview'

export function isPassagePreviewLearningLaunch(locationLike = globalThis.location) {
  const search = typeof locationLike === 'string'
    ? new URL(locationLike, 'http://127.0.0.1').search
    : locationLike?.search
  if (typeof search !== 'string') return false
  return new URLSearchParams(search).get(PASSAGE_PREVIEW_LEARNING_QUERY) === PASSAGE_PREVIEW_LEARNING_VALUE
}
