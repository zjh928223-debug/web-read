import { computed, nextTick, ref } from 'vue'
import { describeReviewSourceError, releaseReviewAudio, resolveReviewSource } from './srs-review-context.js'
import { runReviewPlaybackSequence } from './srs-review-playback.js'
import { prefetchAmericanPronunciations, resolveAmericanPronunciationSequence, shouldUseSystemPronunciationFallback } from './srs-review-pronunciation.js'

export function useSrsReviewMedia({
  currentCard, word, viewContext, meaning, queue, viewIndex, contextCueLevel,
  getActive, audioElement, pronunciationAudio, fitWordHeading,
}) {
  const audioState = ref(null)
  const audioPlaybackRange = ref(null)
  const pronunciationUrl = ref('')
  const pronunciationUrls = ref([])
  const pronunciationLoading = ref(false)
  const sourceLoading = ref(false)
  const sourceAudioNotice = ref('')
  const playbackPhase = ref('')
  let audioRequest = 0
  let mediaActive = false
  let cancelPronunciationWait = null
  let cancelSentenceReady = null
  let cancelTargetSentenceWait = null
  let sourceReadyPromise = Promise.resolve(null)
  let pronunciationReadyPromise = Promise.resolve([])
  let sequencePlaybackRequest = -1
  let playbackStatusRequest = 0
  const canSpeak = computed(() => (
    Boolean(word.value.word) && (
      pronunciationLoading.value
      ||
      Boolean(pronunciationUrl.value)
      || (
        typeof window !== 'undefined'
        && 'speechSynthesis' in window
        && typeof window.SpeechSynthesisUtterance === 'function'
      )
    )
  ))

  const canPlaySentence = computed(() => Boolean(
    contextCueLevel.value !== 'none'
    && currentCard.value
    && (sourceLoading.value || audioState.value?.url),
  ))

  function isCurrentMediaRequest(request) {
    return mediaActive && getActive() && request === audioRequest
  }

  function isCurrentPlayback(request, statusRequest) {
    return isCurrentMediaRequest(request) && statusRequest === playbackStatusRequest
  }

  async function prepareCurrentCardMedia(request, { autoplay = true } = {}) {
    if (!isCurrentMediaRequest(request)) return
    void prefetchUpcomingPronunciations()
    void loadReviewSourceForCurrentCard(request)
    pronunciationLoading.value = true
    const readyPromise = resolveAmericanPronunciationSequence(word.value.word)
    pronunciationReadyPromise = readyPromise
    const resolvedPronunciations = await readyPromise
    if (!isCurrentMediaRequest(request)) return
    pronunciationLoading.value = false
    pronunciationUrls.value = resolvedPronunciations
    pronunciationUrl.value = resolvedPronunciations[0] || ''
    await nextTick()
    if (!isCurrentMediaRequest(request)) return
    fitWordHeading()
    if (autoplay && sequencePlaybackRequest !== request) void playWordWithStatus(request)
  }

  function loadReviewSourceForCurrentCard(request = audioRequest) {
    if (!isCurrentMediaRequest(request)) return Promise.resolve(null)
    const context = viewContext.value?.raw
    const hasSource = Boolean(context?.source_id || context?.sourceId)
    sourceAudioNotice.value = ''
    sourceLoading.value = hasSource
    if (!context || !hasSource) {
      sourceReadyPromise = Promise.resolve(null)
      return sourceReadyPromise
    }
    const sourcePromise = Promise.resolve(resolveReviewSource(context, {
      word: word.value.word,
      meaning: meaning.value,
      onError(error) {
        handleReviewSourceError(error, request)
      },
    })).then((resolved) => {
      if (!isCurrentMediaRequest(request)) {
        releaseReviewAudio(resolved)
        return null
      }
      audioState.value = resolved
      audioPlaybackRange.value = resolved
        ? { start: resolved.start, end: resolved.end }
        : null
      sourceLoading.value = false
      return resolved
    })
    sourceReadyPromise = sourcePromise
    return sourcePromise
  }

  function handleReviewSourceError(error, request = audioRequest) {
    if (!isCurrentMediaRequest(request)) return
    sourceAudioNotice.value = describeReviewSourceError(error)
  }

  async function retrySourceAudio() {
    if (!isCurrentMediaRequest(audioRequest) || sourceLoading.value) return
    if (audioElement.value) {
      audioElement.value.pause()
      audioElement.value.removeAttribute('src')
      audioElement.value.load()
    }
    releaseReviewAudio(audioState.value)
    audioState.value = null
    audioPlaybackRange.value = null
    await loadReviewSourceForCurrentCard(audioRequest)
  }

  function stopAndReleaseAudio({ resetMedia = true } = {}) {
    sourceReadyPromise = Promise.resolve(null)
    if (cancelSentenceReady) cancelSentenceReady()
    if (cancelTargetSentenceWait) cancelTargetSentenceWait(false)
    if (audioElement.value) {
      audioElement.value.pause()
      audioElement.value.removeAttribute('src')
      if (resetMedia) audioElement.value.load()
    }
    releaseReviewAudio(audioState.value)
    audioState.value = null
    audioPlaybackRange.value = null
    sourceLoading.value = false
    sourceAudioNotice.value = ''
    stopPronunciation()
    pronunciationLoading.value = false
    pronunciationUrl.value = ''
    pronunciationUrls.value = []
  }

  function stopCurrentPlayback() {
    if (cancelTargetSentenceWait) cancelTargetSentenceWait(false)
    if (audioElement.value) audioElement.value.pause()
    stopPronunciation()
  }

  function seekAudioStart() {
    if (!audioElement.value || !audioPlaybackRange.value) return
    audioElement.value.currentTime = Math.max(0, Number(audioPlaybackRange.value.start || 0))
  }

  function stopAtAudioEnd() {
    const range = audioPlaybackRange.value
    if (!audioElement.value || !range || !Number.isFinite(range.end)) return
    if (audioElement.value.currentTime >= range.end) {
      audioElement.value.pause()
      audioElement.value.currentTime = Math.max(0, Number(range.start || 0))
      if (cancelTargetSentenceWait) cancelTargetSentenceWait(true)
    }
  }

  function canSeekParagraph(paragraph) {
    return Boolean(audioState.value?.url && Number.isFinite(paragraph?.start))
  }

  async function playParagraph(paragraph) {
    if (!isCurrentMediaRequest(audioRequest) || !audioElement.value || !canSeekParagraph(paragraph)) return
    beginManualPlayback()
    audioPlaybackRange.value = { start: paragraph.start, end: paragraph.end }
    audioElement.value.currentTime = Math.max(0, Number(paragraph.start || 0))
    try {
      await audioElement.value.play()
    } catch (_error) {}
  }

  async function playParagraphWord(paragraph, part) {
    if (!isCurrentMediaRequest(audioRequest) || !part?.word) return
    beginManualPlayback()
    const request = audioRequest
    const statusRequest = playbackStatusRequest
    const element = audioElement.value
    const source = audioState.value
    if (
      audioElement.value
      && audioState.value?.url
      && Number.isFinite(part.start)
    ) {
      await waitForSentenceMetadata(element)
      if (!isCurrentPlayback(request, statusRequest) || element !== audioElement.value || source !== audioState.value) return
      audioPlaybackRange.value = { start: part.start, end: paragraph.end }
      audioElement.value.currentTime = Math.max(0, part.start)
      try {
        await audioElement.value.play()
      } catch (_error) {}
      return
    }
    await speakReviewText(part.remainingText)
  }

  function beginManualPlayback() {
    playbackStatusRequest += 1
    playbackPhase.value = ''
    stopCurrentPlayback()
  }

  async function speakWord() {
    if (!isCurrentMediaRequest(audioRequest) || !canSpeak.value) return
    const request = audioRequest
    sequencePlaybackRequest = request
    beginManualPlayback()
    const statusRequest = playbackStatusRequest
    await pronunciationReadyPromise
    if (!isCurrentPlayback(request, statusRequest)) return
    await playWordWithStatus(request)
  }

  async function playSentenceOnly({ maxDurationMs = 12000 } = {}) {
    if (!isCurrentMediaRequest(audioRequest)) return false
    const request = audioRequest
    sequencePlaybackRequest = request
    beginManualPlayback()
    const statusRequest = playbackStatusRequest
    playbackPhase.value = 'sentence'
    try {
      return await playTargetSentence({ maxDurationMs })
    } finally {
      if (isCurrentPlayback(request, statusRequest)) {
        playbackPhase.value = ''
      }
    }
  }

  async function playWordAndTargetSentence({ maxDurationMs = 12000 } = {}) {
    if (!isCurrentMediaRequest(audioRequest)) return false
    const request = audioRequest
    sequencePlaybackRequest = request
    beginManualPlayback()
    const statusRequest = playbackStatusRequest
    try {
      playbackPhase.value = 'word'
      await pronunciationReadyPromise
      if (!isCurrentPlayback(request, statusRequest)) return false
      return await runReviewPlaybackSequence({
        isCurrent: () => isCurrentPlayback(request, statusRequest),
        playWord: () => playWordPronunciation(request, statusRequest),
        playSentence: async () => {
          playbackPhase.value = 'sentence'
          await playTargetSentence({ maxDurationMs })
        },
      })
    } finally {
      if (isCurrentPlayback(request, statusRequest)) playbackPhase.value = ''
    }
  }

  async function playWordWithStatus(request = audioRequest) {
    if (!isCurrentMediaRequest(request)) return
    const statusRequest = ++playbackStatusRequest
    playbackPhase.value = 'word'
    try {
      await playWordPronunciation(request, statusRequest)
    } finally {
      if (isCurrentPlayback(request, statusRequest)) {
        playbackPhase.value = ''
      }
    }
  }

  function prefetchUpcomingPronunciations() {
    const start = Math.max(0, Number(viewIndex.value || 0) + 1)
    return prefetchAmericanPronunciations(
      queue.value
        .slice(start, start + 20)
        .map((entry) => entry?.word?.word)
        .filter(Boolean),
    )
  }

  async function playWordPronunciation(request = audioRequest, statusRequest = playbackStatusRequest) {
    if (!isCurrentPlayback(request, statusRequest)) return
    stopPronunciation()
    const urls = pronunciationUrls.value.length
      ? [...pronunciationUrls.value]
      : (pronunciationUrl.value ? [pronunciationUrl.value] : [])
    let played = false
    if (urls.length && pronunciationAudio.value) {
      for (const url of urls) {
        if (!isCurrentPlayback(request, statusRequest)) return
        pronunciationUrl.value = url
        await nextTick()
        if (!isCurrentPlayback(request, statusRequest) || !pronunciationAudio.value) return
        pronunciationAudio.value.currentTime = 0
        const completion = waitForPronunciationEnd(pronunciationAudio.value)
        try {
          await pronunciationAudio.value.play()
          if (!isCurrentPlayback(request, statusRequest)) return
          played = true
          await completion
        } catch (_error) {
          if (!isCurrentPlayback(request, statusRequest)) return
          if (cancelPronunciationWait) cancelPronunciationWait()
        }
      }
      if (!isCurrentPlayback(request, statusRequest)) return
      pronunciationUrl.value = urls[0] || ''
      if (played) return
    }
    if (!isCurrentPlayback(request, statusRequest)) return
    if (shouldUseSystemPronunciationFallback(word.value.word)) {
      await speakWithSystemVoice()
    }
  }

  function speakWithSystemVoice() {
    return speakReviewText(word.value.word)
  }

  function speakReviewText(text) {
    if (
      !isCurrentMediaRequest(audioRequest)
      || typeof window === 'undefined'
      || !('speechSynthesis' in window)
      || typeof window.SpeechSynthesisUtterance !== 'function'
    ) return Promise.resolve()
    window.speechSynthesis.cancel()
    const utterance = new window.SpeechSynthesisUtterance(String(text || '').trim())
    utterance.lang = 'en-US'
    utterance.rate = 0.95
    const selectedVoice = selectAmericanVoice(window.speechSynthesis.getVoices())
    if (selectedVoice) utterance.voice = selectedVoice
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        cancelPronunciationWait = null
        resolve()
      }
      utterance.onend = finish
      utterance.onerror = finish
      cancelPronunciationWait = finish
      window.speechSynthesis.speak(utterance)
    })
  }

  function waitForPronunciationEnd(element) {
    return new Promise((resolve) => {
      let settled = false
      const timeout = window.setTimeout(finish, 12000)
      function finish() {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        element.removeEventListener('ended', finish)
        element.removeEventListener('error', finish)
        cancelPronunciationWait = null
        resolve()
      }
      element.addEventListener('ended', finish)
      element.addEventListener('error', finish)
      cancelPronunciationWait = finish
    })
  }

  async function playTargetSentence({ maxDurationMs = 12000 } = {}) {
    const request = audioRequest
    const statusRequest = playbackStatusRequest
    if (!isCurrentPlayback(request, statusRequest)) return false
    await sourceReadyPromise
    await nextTick()
    const element = audioElement.value
    const source = audioState.value
    if (!isCurrentPlayback(request, statusRequest) || !element || !source?.url) return false
    await waitForSentenceMetadata(element)
    if (!isCurrentPlayback(request, statusRequest) || element !== audioElement.value || source !== audioState.value) return false
    stopCurrentPlayback()
    const start = Math.max(0, Number(source.start || 0))
    const durationLimit = Math.max(1, Number(maxDurationMs || 12000)) / 1000
    const sourceEnd = Number(source.end)
    const end = Number.isFinite(sourceEnd)
      ? Math.min(sourceEnd, start + durationLimit)
      : start + durationLimit
    if (end <= start) return false
    audioPlaybackRange.value = { start, end }
    element.currentTime = start
    return new Promise((resolve) => {
      let settled = false
      const timeout = window.setTimeout(() => finish(true), Math.max(1, Number(maxDurationMs || 12000)))
      function finish(played) {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        element.removeEventListener('ended', handleEnded)
        element.removeEventListener('error', handleError)
        if (cancelTargetSentenceWait === finish) cancelTargetSentenceWait = null
        element.pause()
        if (element === audioElement.value) element.currentTime = start
        resolve(Boolean(played))
      }
      const handleEnded = () => finish(true)
      const handleError = () => finish(false)
      element.addEventListener('ended', handleEnded)
      element.addEventListener('error', handleError)
      cancelTargetSentenceWait = finish
      element.play().catch(() => finish(false))
    })
  }

  function waitForSentenceMetadata(element) {
    if (element.readyState >= 1) return Promise.resolve()
    return new Promise((resolve) => {
      let settled = false
      const timeout = window.setTimeout(finish, 5000)
      function finish() {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        element.removeEventListener('loadedmetadata', finish)
        element.removeEventListener('error', finish)
        cancelSentenceReady = null
        resolve()
      }
      element.addEventListener('loadedmetadata', finish)
      element.addEventListener('error', finish)
      cancelSentenceReady = finish
    })
  }

  function selectAmericanVoice(voices) {
    return [...(voices || [])]
      .filter((voice) => /^en-US\b/i.test(voice.lang))
      .sort((left, right) => voiceScore(right) - voiceScore(left))[0] || null
  }

  function voiceScore(voice) {
    const name = String(voice?.name || '')
    return (/natural|online/i.test(name) ? 20 : 0)
      + (/aria|jenny|guy|google us english/i.test(name) ? 10 : 0)
      + (voice?.localService ? 0 : 2)
  }

  function stopPronunciation() {
    if (cancelPronunciationWait) cancelPronunciationWait()
    if (pronunciationAudio.value) {
      pronunciationAudio.value.pause()
      pronunciationAudio.value.currentTime = 0
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }

  function handlePronunciationError() {
    if (!isCurrentMediaRequest(audioRequest)) return
    pronunciationUrl.value = ''
  }

  function handleSourceAudioError() {
    if (!isCurrentMediaRequest(audioRequest) || !audioState.value) return
    audioState.value = { ...audioState.value, url: '' }
    sourceAudioNotice.value = '原文音频文件加载失败，请重试。'
  }

  // The page owns watcher/event ordering; this scope alone owns media generations.
  function activate() {
    mediaActive = true
  }

  function deactivate() {
    mediaActive = false
    audioRequest += 1
    playbackStatusRequest += 1
    sequencePlaybackRequest = -1
    playbackPhase.value = ''
  }

  function resetCard() {
    const request = ++audioRequest
    sequencePlaybackRequest = -1
    playbackStatusRequest += 1
    playbackPhase.value = ''
    stopAndReleaseAudio({ resetMedia: false })
    return request
  }

  function resumeCurrentCardMedia() {
    return prepareCurrentCardMedia(++audioRequest, { autoplay: false })
  }

  // Capture after prepare synchronously installs this generation's source promise.
  function captureMediaRequest() {
    return { request: audioRequest, sourceReadyPromise }
  }

  return {
    audioState,
    pronunciationUrl,
    sourceLoading,
    sourceAudioNotice,
    playbackPhase,
    canSpeak,
    canPlaySentence,
    prepareCurrentCardMedia,
    isCurrentMediaRequest,
    retrySourceAudio,
    stopAndReleaseAudio,
    stopCurrentPlayback,
    seekAudioStart,
    stopAtAudioEnd,
    canSeekParagraph,
    playParagraph,
    playParagraphWord,
    speakWord,
    playSentenceOnly,
    playWordAndTargetSentence,
    playTargetSentence,
    handlePronunciationError,
    handleSourceAudioError,
    activate, deactivate, resetCard, resumeCurrentCardMedia, captureMediaRequest,
  }
}
