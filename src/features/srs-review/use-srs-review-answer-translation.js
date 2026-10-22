import { ref } from 'vue'
import { markReviewTranslationText } from './srs-review-context.js'
import { sentenceTranslationKey, translateSentenceBatches } from '../passage-preview/sentence-translation.js'

// Translation request/cache state is local; media validity comes from one media owner.
export function useSrsReviewAnswerTranslation({
  currentCard, getAnswerRevealed, audioState, viewContext, meaning, media,
}) {
  const sentenceTranslationZh = ref('')
  const sentenceTranslationParts = ref([])
  const sentenceTranslationVisible = ref(false)
  const sentenceTranslationLoading = ref(false)
  const sentenceTranslationUnavailable = ref(false)
  let translationRequest = 0
  const sentenceTranslationCache = new Map()

  async function hydrateCurrentSentenceTranslation() {
    const { request: mediaRequest, sourceReadyPromise } = media.captureMediaRequest()
    if (!media.isCurrentMediaRequest(mediaRequest) || !currentCard.value || !getAnswerRevealed()) return
    sentenceTranslationVisible.value = true
    const request = ++translationRequest
    const cardId = currentCard.value?.word?.id
    const isCurrent = () => (
      media.isCurrentMediaRequest(mediaRequest)
      && request === translationRequest
      && getAnswerRevealed()
      && currentCard.value?.word?.id === cardId
    )
    sentenceTranslationLoading.value = true
    sentenceTranslationUnavailable.value = false
    await sourceReadyPromise.catch(() => null)
    if (!isCurrent()) return
    const sentence = currentTranslationSentence()
    if (!sentence) {
      sentenceTranslationLoading.value = false
      return
    }
    const embedded = String(
      audioState.value?.translationZh
      || viewContext.value?.translationZh
      || '',
    ).trim()
    const key = sentenceTranslationKey(sentence)
    const isCurrentSentence = () => isCurrent() && sentenceTranslationKey(currentTranslationSentence()) === key
    const cached = embedded || sentenceTranslationCache.get(key)
    if (cached) {
      sentenceTranslationZh.value = cached
      sentenceTranslationParts.value = embedded && Array.isArray(audioState.value?.translationParts)
        && audioState.value.translationParts.length
        ? audioState.value.translationParts
        : markReviewTranslationText(cached, meaning.value)
      sentenceTranslationLoading.value = false
      sentenceTranslationUnavailable.value = false
      if (embedded) sentenceTranslationCache.set(key, embedded)
      return
    }
    try {
      const translated = await translateSentenceBatches([{
        id: `srs-review-${currentCard.value?.word?.id || 'sentence'}`,
        sentence,
      }])
      const translation = String(translated[0]?.translationZh || '').trim()
      if (!isCurrentSentence()) return
      if (translation) {
        sentenceTranslationCache.set(key, translation)
        sentenceTranslationZh.value = translation
        sentenceTranslationParts.value = markReviewTranslationText(translation, meaning.value)
        sentenceTranslationUnavailable.value = false
      } else {
        sentenceTranslationUnavailable.value = true
      }
    } catch (_error) {
      if (isCurrentSentence()) sentenceTranslationUnavailable.value = true
    } finally {
      if (isCurrentSentence()) sentenceTranslationLoading.value = false
    }
  }

  function currentTranslationSentence() {
    return String(audioState.value?.targetSentence || viewContext.value?.sentence || '').trim()
  }

  function deactivate() {
    translationRequest += 1
    sentenceTranslationLoading.value = false
  }

  function resetCard() {
    deactivate()
    sentenceTranslationZh.value = ''
    sentenceTranslationParts.value = []
    sentenceTranslationVisible.value = false
    sentenceTranslationUnavailable.value = false
  }

  return {
    sentenceTranslationZh,
    sentenceTranslationParts,
    sentenceTranslationVisible,
    sentenceTranslationLoading,
    sentenceTranslationUnavailable,
    hydrateCurrentSentenceTranslation,
    deactivate, resetCard,
  }
}
