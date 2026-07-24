<template>
  <main class="srs-review-page" :class="{ 'is-overlay': !standalone }">
    <header class="srs-review-header">
      <button class="srs-review-back" type="button" aria-label="返回阅读器" @click="close">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
        返回
      </button>
      <div class="srs-review-heading">
        <h1>今日复习</h1>
        <p v-if="viewContext?.sourceTitle">来源：{{ viewContext.sourceTitle }}</p>
      </div>
      <div class="srs-review-summary">
        <p class="srs-review-progress" aria-live="polite">{{ review.progress.value }}</p>
        <div class="srs-review-navigation" aria-label="复习卡片切换">
          <button
            type="button"
            :disabled="!review.canPrevious.value"
            aria-label="上一张（左方向键或上方向键）"
            @click="review.goPrevious"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button
            type="button"
            :disabled="!review.canNext.value"
            aria-label="下一张（右方向键或下方向键）"
            @click="review.goNext"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </div>
        <button
          class="srs-review-history-toggle"
          type="button"
          :aria-expanded="historyOpen"
          :aria-controls="historyId"
          @click="historyOpen = !historyOpen"
        >
          复习记录
        </button>
        <section
          v-if="historyOpen"
          :id="historyId"
          class="srs-review-history"
          aria-label="复习记录"
        >
          <h2>复习记录</h2>
          <ul v-if="review.reviewHistory.value.length">
            <li v-for="item in review.reviewHistory.value" :key="item.date">
              <time :datetime="item.date">{{ item.label }}</time>
              <span>{{ item.wordCount }} 个单词</span>
            </li>
          </ul>
          <p v-else>还没有复习记录</p>
        </section>
      </div>
    </header>

    <section v-if="review.loading.value" class="srs-review-state" aria-live="polite">
      <span class="srs-review-spinner" aria-hidden="true"></span>
      <p>正在准备今日复习…</p>
    </section>

    <section v-else-if="review.error.value && !review.current.value" class="srs-review-state" role="alert">
      <h2>加载失败</h2>
      <p>{{ review.error.value }}</p>
      <button type="button" class="srs-review-retry" @click="review.load">重试</button>
    </section>

    <section v-else-if="review.empty.value" class="srs-review-state" aria-live="polite">
      <h2>今天没有待复习单词</h2>
    </section>

    <section v-else-if="review.completed.value" class="srs-review-state" aria-live="polite">
      <h2>今日复习完成</h2>
    </section>

    <template v-else-if="review.current.value">
      <div class="srs-review-content">
        <article class="srs-review-context" aria-label="原文语境">
          <div v-if="displayParagraphs.length" class="srs-review-passages">
            <p
              v-for="(paragraph, paragraphIndex) in displayParagraphs"
              :key="paragraphIndex"
              :class="{ 'is-seekable': canSeekParagraph(paragraph) }"
              :tabindex="canSeekParagraph(paragraph) ? 0 : undefined"
              @click="playParagraph(paragraph)"
              @keydown.enter.prevent="playParagraph(paragraph)"
            >
              <template v-if="paragraph.target">
                {{ paragraph.before }}<mark class="srs-review-sentence"><template
                  v-for="(part, partIndex) in paragraph.sentenceWordParts"
                  :key="partIndex"
                ><span
                  v-if="part.word"
                  role="button"
                  tabindex="0"
                  class="srs-review-passage-word"
                  :class="{ 'is-review-word': part.highlighted }"
                  :aria-label="`从 ${part.text} 开始朗读`"
                  @click.stop="playParagraphWord(paragraph, part)"
                  @keydown.enter.stop.prevent="playParagraphWord(paragraph, part)"
                >{{ part.text }}</span><template v-else>{{ part.text }}</template></template></mark>{{ paragraph.after }}
              </template>
              <template v-else><template
                v-for="(part, partIndex) in paragraph.wordParts"
                :key="partIndex"
              ><span
                v-if="part.word"
                role="button"
                tabindex="0"
                class="srs-review-passage-word"
                :aria-label="`从 ${part.text} 开始朗读`"
                @click.stop="playParagraphWord(paragraph, part)"
                @keydown.enter.stop.prevent="playParagraphWord(paragraph, part)"
              >{{ part.text }}</span><template v-else>{{ part.text }}</template></template></template>
            </p>
          </div>

          <div v-if="sourceLoading || audioState?.url" class="srs-review-audio">
            <label :for="audioId">原文音频</label>
            <div v-if="sourceLoading" class="srs-review-audio-loading" role="status">
              <span class="srs-review-spinner" aria-hidden="true"></span>
              <span>正在加载原文音频…</span>
            </div>
            <audio
              v-else
              :id="audioId"
              ref="audioElement"
              controls
              preload="metadata"
              :src="audioState.url"
              @loadedmetadata="seekAudioStart"
              @timeupdate="stopAtAudioEnd"
              @error="handleSourceAudioError"
            ></audio>
          </div>
        </article>

        <article class="srs-review-word-panel" aria-label="单词信息">
          <div class="srs-review-word-content">
            <div ref="wordLine" class="srs-review-word-line">
              <button
                class="srs-review-speaker"
                type="button"
                :disabled="!canSpeak"
                :aria-label="`朗读 ${word.word}`"
                @click="speakWord"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                  <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" />
                </svg>
              </button>
              <audio
                ref="pronunciationAudio"
                class="srs-review-pronunciation-audio"
                :src="pronunciationUrl"
                preload="auto"
                @error="handlePronunciationError"
              ></audio>
              <h2 ref="wordHeading" :style="wordFontSize ? { fontSize: `${wordFontSize}px` } : undefined">{{ word.word }}</h2>
            </div>
            <p v-if="word.phonetic" class="srs-review-phonetic">{{ word.phonetic }}</p>
            <div class="srs-review-meanings">
              <section v-if="generalMeaning" class="srs-review-meaning-group is-general">
                <h3>常用释义</h3>
                <p>{{ generalMeaning }}</p>
              </section>
              <section v-if="meaning" class="srs-review-meaning-group is-contextual">
                <h3>句中释义</h3>
                <p>{{ meaning }}</p>
              </section>
            </div>
          </div>
          <div class="srs-review-play-sequence-group">
            <button
              class="srs-review-play-sequence"
              type="button"
              :aria-keyshortcuts="replayShortcutDisplay"
              :disabled="!canPlaySequence"
              @click="handleSequenceButton"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path class="is-play" d="m8 5 11 7-11 7V5Z" />
              </svg>
              <span>重读单词和原句</span>
            </button>
            <button
              class="srs-review-replay-shortcut"
              :class="{ 'is-editing': replayShortcutEditing }"
              type="button"
              :aria-label="replayShortcutEditing ? '请按新的重读快捷键，按 Escape 取消' : `修改重读快捷键，当前为 ${replayShortcutDisplay}`"
              :title="replayShortcutEditing ? '请按新按键；1-5 和空格不可使用' : '点击修改快捷键'"
              @click="beginReplayShortcutEditing"
            >
              <kbd>{{ replayShortcutEditing ? '…' : replayShortcutDisplay }}</kbd>
            </button>
          </div>
          <button
            class="srs-review-remove-word"
            type="button"
            :disabled="review.pending.value"
            :aria-label="`从 SRS 中移除 ${word.word}`"
            title="移除误加入的单词"
            @click="removeCurrentWord"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
            </svg>
            <span>移除误收录</span>
          </button>
        </article>
      </div>

      <p v-if="review.error.value" class="srs-review-inline-error" role="alert">{{ review.error.value }}</p>

      <footer class="srs-review-actions" aria-label="复习评价">
        <button
          v-for="action in review.actions"
          :key="action.shortcut"
          type="button"
          :class="`is-${action.tone}`"
          :aria-keyshortcuts="action.shortcut"
          :disabled="review.pending.value || review.reviewingPast.value"
          @click="review.submitAction(action)"
        >
          <kbd>{{ action.shortcut }}</kbd>
          <span>{{ action.label }}</span>
        </button>
      </footer>
    </template>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  buildReviewContext,
  releaseReviewAudio,
  resolveReviewGeneralMeaning,
  resolveReviewMeaning,
  resolveReviewSource,
} from './srs-review-context.js'
import { calculateSingleLineFontSize } from './srs-review-layout.js'
import { hydrateReviewGeneralMeanings } from './srs-review-meanings.js'
import {
  getReviewNavigationDelta,
  isPlaybackPauseKey,
  isReviewReplayKey,
  normalizeReviewReplayShortcut,
  runReviewPlaybackSequence,
} from './srs-review-playback.js'
import {
  prefetchAmericanPronunciations,
  resolveAmericanPronunciationSequence,
} from './srs-review-pronunciation.js'
import { getReviewActionForShortcut, useSrsReview } from './useSrsReview.js'

const props = defineProps({
  service: { type: Object, required: true },
  standalone: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const review = useSrsReview(props.service)
const audioElement = ref(null)
const audioState = ref(null)
const audioPlaybackRange = ref(null)
const pronunciationAudio = ref(null)
const pronunciationUrl = ref('')
const pronunciationUrls = ref([])
const sourceLoading = ref(false)
const playbackPaused = ref(false)
const historyOpen = ref(false)
const replayShortcut = ref('r')
const replayShortcutEditing = ref(false)
const wordLine = ref(null)
const wordHeading = ref(null)
const wordFontSize = ref(null)
const audioId = `srs-review-audio-${Math.random().toString(36).slice(2)}`
const historyId = `srs-review-history-${Math.random().toString(36).slice(2)}`
const replayShortcutStorageKey = 'srs.review.replayShortcut.v1'
let audioRequest = 0
let playbackRun = 0
let cancelPronunciationWait = null
let cancelSentenceReady = null
let wordResizeObserver = null
let wordFitFrame = 0
let wordFitKey = ''
let sourceReadyPromise = Promise.resolve(null)
let meaningAbortController = null
const pausedPlaybackTargets = new Set()

const word = computed(() => review.current.value?.word || {})
const viewContext = computed(() => buildReviewContext(review.current.value))
const displayParagraphs = computed(() => (
  audioState.value?.paragraphs?.length
    ? audioState.value.paragraphs
    : (viewContext.value?.paragraphs || [])
))
const meaning = computed(() => resolveReviewMeaning(word.value, viewContext.value?.raw))
const generalMeaning = computed(() => resolveReviewGeneralMeaning(word.value))
const replayShortcutDisplay = computed(() => replayShortcut.value.toLocaleUpperCase('en-US'))
const canSpeak = computed(() => (
  Boolean(word.value.word) && (
    Boolean(pronunciationUrl.value)
    || (
      typeof window !== 'undefined'
      && 'speechSynthesis' in window
      && typeof window.SpeechSynthesisUtterance === 'function'
    )
  )
))
const canPlaySequence = computed(() => Boolean(review.current.value && (canSpeak.value || sourceLoading.value || audioState.value?.url)))

onMounted(async () => {
  replayShortcut.value = loadReplayShortcut()
  window.addEventListener('keydown', handleReviewShortcut, true)
  await review.load()
  meaningAbortController = new AbortController()
  void hydrateReviewGeneralMeanings(review.queue.value, props.service, {
    signal: meaningAbortController.signal,
  })
  await nextTick()
  if (typeof ResizeObserver === 'function' && wordLine.value) {
    wordResizeObserver = new ResizeObserver(fitWordHeading)
    wordResizeObserver.observe(wordLine.value)
  }
  fitWordHeading()
  void prefetchAmericanPronunciations(
    review.queue.value
      .slice(1)
      .map((entry) => entry?.word?.word)
      .filter((value) => value && !/\s/.test(value)),
  )
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleReviewShortcut, true)
  meaningAbortController?.abort()
  wordResizeObserver?.disconnect()
  if (wordFitFrame) cancelAnimationFrame(wordFitFrame)
  stopAndReleaseAudio()
})

watch(() => review.current.value?.word?.id, async (nextId, previousId) => {
  const request = ++audioRequest
  stopAndReleaseAudio()
  if (!nextId) return
  const context = viewContext.value?.raw
  sourceLoading.value = Boolean(context?.source_id || context?.sourceId)
  const sourcePromise = Promise.resolve(
    context ? resolveReviewSource(context, { word: word.value.word }) : null,
  ).then((resolved) => {
    if (request !== audioRequest) {
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
  const resolvedPronunciations = await resolveAmericanPronunciationSequence(word.value.word)
  if (request !== audioRequest) return
  pronunciationUrls.value = resolvedPronunciations
  pronunciationUrl.value = resolvedPronunciations[0] || ''
  await nextTick()
  fitWordHeading()
  if (!previousId) {
    await sourcePromise
    return
  }
  const run = ++playbackRun
  await runReviewPlaybackSequence({
    isCurrent: () => request === audioRequest && run === playbackRun,
    playWord: playWordPronunciation,
    playSentence: async () => {
      await sourcePromise
      if (request !== audioRequest) return
      await nextTick()
      await playTargetSentence()
    },
  })
})

watch(() => word.value.word, async () => {
  wordFontSize.value = null
  await nextTick()
  fitWordHeading()
})

function close() {
  historyOpen.value = false
  stopAndReleaseAudio()
  if (props.standalone) {
    window.location.assign('./index.html')
    return
  }
  emit('close')
}

function handleReviewShortcut(event) {
  if (isPlaybackPauseKey(event)) {
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) togglePlaybackPause()
    return
  }
  if (replayShortcutEditing.value) {
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    if (event.key === 'Escape') {
      replayShortcutEditing.value = false
      return
    }
    const nextShortcut = normalizeReviewReplayShortcut(event.key)
    if (!nextShortcut) return
    replayShortcut.value = nextShortcut
    replayShortcutEditing.value = false
    saveReplayShortcut(nextShortcut)
    return
  }
  if (isReviewReplayKey(event, replayShortcut.value)) {
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat && canPlaySequence.value) void playWordAndSentence()
    return
  }
  if (
    event.defaultPrevented
    || event.repeat
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || isTypingTarget(event.target)
  ) return
  const navigationDelta = getReviewNavigationDelta(event.key)
  if (navigationDelta) {
    const changed = navigationDelta < 0 ? review.goPrevious() : review.goNext()
    if (changed) event.preventDefault()
    return
  }
  if (review.pending.value || !review.current.value || review.reviewingPast.value) return
  const action = getReviewActionForShortcut(event.key)
  if (!action) return
  event.preventDefault()
  void review.submitAction(action)
}

function beginReplayShortcutEditing() {
  replayShortcutEditing.value = true
}

async function removeCurrentWord() {
  if (review.pending.value || !review.current.value) return
  const label = String(word.value.word || '').trim()
  if (!window.confirm(`确定从 SRS 中移除“${label}”吗？`)) return
  stopAndReleaseAudio()
  await review.removeCurrent()
}

function loadReplayShortcut() {
  try {
    return normalizeReviewReplayShortcut(window.localStorage.getItem(replayShortcutStorageKey)) || 'r'
  } catch (_error) {
    return 'r'
  }
}

function saveReplayShortcut(shortcut) {
  try {
    window.localStorage.setItem(replayShortcutStorageKey, shortcut)
  } catch (_error) {}
}

function isTypingTarget(target) {
  const tagName = String(target?.tagName || '').toLowerCase()
  return target?.isContentEditable || ['input', 'textarea', 'select'].includes(tagName)
}

function stopAndReleaseAudio() {
  playbackRun += 1
  pausedPlaybackTargets.clear()
  playbackPaused.value = false
  sourceReadyPromise = Promise.resolve(null)
  if (cancelSentenceReady) cancelSentenceReady()
  if (audioElement.value) {
    audioElement.value.pause()
    audioElement.value.removeAttribute('src')
    audioElement.value.load()
  }
  releaseReviewAudio(audioState.value)
  audioState.value = null
  audioPlaybackRange.value = null
  sourceLoading.value = false
  stopPronunciation()
  pronunciationUrl.value = ''
  pronunciationUrls.value = []
}

function fitWordHeading() {
  const element = wordHeading.value
  if (!element) return
  const fitKey = `${word.value.word}\0${element.clientWidth}`
  if (fitKey === wordFitKey) return
  wordFitKey = fitKey
  if (wordFitFrame) cancelAnimationFrame(wordFitFrame)
  wordFontSize.value = null
  wordFitFrame = requestAnimationFrame(() => {
    wordFitFrame = 0
    if (element !== wordHeading.value) return
    const currentFontSize = Number.parseFloat(getComputedStyle(element).fontSize)
    wordFontSize.value = calculateSingleLineFontSize({
      availableWidth: element.clientWidth,
      naturalWidth: element.scrollWidth,
      currentFontSize,
      minimumFontSize: 22,
    })
  })
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
  }
}

function canSeekParagraph(paragraph) {
  return Boolean(audioState.value?.url && Number.isFinite(paragraph?.start))
}

async function playParagraph(paragraph) {
  if (!audioElement.value || !canSeekParagraph(paragraph)) return
  beginManualPlayback()
  audioPlaybackRange.value = { start: paragraph.start, end: paragraph.end }
  audioElement.value.currentTime = Math.max(0, Number(paragraph.start || 0))
  try {
    await audioElement.value.play()
  } catch (_error) {}
}

async function playParagraphWord(paragraph, part) {
  if (!part?.word) return
  beginManualPlayback()
  if (
    audioElement.value
    && audioState.value?.url
    && Number.isFinite(part.start)
  ) {
    await waitForSentenceMetadata(audioElement.value)
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
  playbackRun += 1
  pausedPlaybackTargets.clear()
  playbackPaused.value = false
  if (audioElement.value) audioElement.value.pause()
  stopPronunciation()
}

async function speakWord() {
  if (!canSpeak.value) return
  await playWordPronunciation()
}

async function handleSequenceButton() {
  await playWordAndSentence()
}

async function playWordAndSentence() {
  const request = audioRequest
  const run = ++playbackRun
  pausedPlaybackTargets.clear()
  playbackPaused.value = false
  if (audioElement.value) audioElement.value.pause()
  await runReviewPlaybackSequence({
    isCurrent: () => request === audioRequest && run === playbackRun,
    playWord: playWordPronunciation,
    playSentence: async () => {
      await sourceReadyPromise
      if (request !== audioRequest) return
      await nextTick()
      await playTargetSentence()
    },
  })
}

function togglePlaybackPause() {
  if (playbackPaused.value) {
    void resumePausedPlayback()
    return true
  }
  let paused = false
  if (pronunciationAudio.value && !pronunciationAudio.value.paused) {
    pronunciationAudio.value.pause()
    pausedPlaybackTargets.add('word')
    paused = true
  }
  if (audioElement.value && !audioElement.value.paused) {
    audioElement.value.pause()
    pausedPlaybackTargets.add('sentence')
    paused = true
  }
  if (
    typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && window.speechSynthesis.speaking
    && !window.speechSynthesis.paused
  ) {
    window.speechSynthesis.pause()
    pausedPlaybackTargets.add('speech')
    paused = true
  }
  playbackPaused.value = paused
  return paused
}

async function resumePausedPlayback() {
  const targets = new Set(pausedPlaybackTargets)
  pausedPlaybackTargets.clear()
  playbackPaused.value = false
  if (targets.has('speech') && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.resume()
  }
  if (targets.has('word') && pronunciationAudio.value) {
    try {
      await pronunciationAudio.value.play()
    } catch (_error) {}
  }
  if (targets.has('sentence') && audioElement.value) {
    try {
      await audioElement.value.play()
    } catch (_error) {}
  }
  return targets.size > 0
}

async function playWordPronunciation() {
  stopPronunciation()
  const urls = pronunciationUrls.value.length
    ? [...pronunciationUrls.value]
    : (pronunciationUrl.value ? [pronunciationUrl.value] : [])
  let played = false
  if (urls.length && pronunciationAudio.value) {
    for (const url of urls) {
      pronunciationUrl.value = url
      await nextTick()
      pronunciationAudio.value.load()
      pronunciationAudio.value.currentTime = 0
      const completion = waitForPronunciationEnd(pronunciationAudio.value)
      try {
        await pronunciationAudio.value.play()
        played = true
        await completion
      } catch (_error) {
        if (cancelPronunciationWait) cancelPronunciationWait()
      }
    }
    pronunciationUrl.value = urls[0] || ''
    if (played) return
  }
  await speakWithSystemVoice()
}

function speakWithSystemVoice() {
  return speakReviewText(word.value.word)
}

function speakReviewText(text) {
  if (
    typeof window === 'undefined'
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

async function playTargetSentence() {
  const element = audioElement.value
  const source = audioState.value
  if (!element || !source?.url) return
  await waitForSentenceMetadata(element)
  if (element !== audioElement.value || source !== audioState.value) return
  audioPlaybackRange.value = { start: source.start, end: source.end }
  element.currentTime = Math.max(0, Number(source.start || 0))
  try {
    await element.play()
  } catch (_error) {}
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
  pausedPlaybackTargets.delete('word')
  pausedPlaybackTargets.delete('speech')
  if (!pausedPlaybackTargets.size) playbackPaused.value = false
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
  pronunciationUrl.value = ''
}

function handleSourceAudioError() {
  if (!audioState.value) return
  audioState.value = { ...audioState.value, url: '' }
}
</script>
