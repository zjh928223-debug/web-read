<template>
  <main class="srs-review-page" :class="{ 'is-overlay': !standalone }">
    <header class="srs-review-header">
      <button class="srs-review-back" type="button" aria-label="返回阅读器" @click="close">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
        返回
      </button>
      <div class="srs-review-heading">
        <p class="srs-review-progress" aria-live="polite">{{ review.progress.value || '今日复习' }}</p>
      </div>
      <div ref="historyContainer" class="srs-review-summary">
        <button
          class="srs-review-history-toggle"
          type="button"
          :aria-expanded="historyOpen"
          :aria-controls="historyId"
          @click="historyOpen = !historyOpen"
        >
          快捷键
        </button>
        <section
          v-if="historyOpen"
          :id="historyId"
          class="srs-review-history"
          aria-label="复习记录与快捷键"
        >
          <h2>复习记录与快捷键</h2>
          <p class="srs-review-autoplay-note">进入新卡自动播放单词</p>
          <div class="srs-review-shortcut-settings">
            <div class="srs-review-playback-shortcut-setting">
              <span>播放单词</span>
              <button
                type="button"
                :class="{ 'is-editing': shortcutEditingTarget === 'word' }"
                :aria-label="shortcutEditingTarget === 'word' ? '请按新的单词播放快捷键，按 Escape 取消' : `修改单词播放快捷键，当前为 ${wordShortcutDisplay}`"
                @click="beginShortcutEditing('word')"
              >
                <kbd>{{ shortcutEditingTarget === 'word' ? '…' : wordShortcutDisplay }}</kbd>
                <small>{{ shortcutEditingTarget === 'word' ? '等待按键' : '点击修改' }}</small>
              </button>
            </div>
            <div class="srs-review-playback-shortcut-setting">
              <span>播放原句</span>
              <button
                type="button"
                :class="{ 'is-editing': shortcutEditingTarget === 'sentence' }"
                :aria-label="shortcutEditingTarget === 'sentence' ? '请按新的原句播放快捷键，按 Escape 取消' : `修改原句播放快捷键，当前为 ${sentenceShortcutDisplay}`"
                @click="beginShortcutEditing('sentence')"
              >
                <kbd>{{ shortcutEditingTarget === 'sentence' ? '…' : sentenceShortcutDisplay }}</kbd>
                <small>{{ shortcutEditingTarget === 'sentence' ? '等待按键' : '点击修改' }}</small>
              </button>
            </div>
          </div>
          <p class="srs-review-fixed-shortcuts">
            固定操作：Space 显示答案 · 1 忘记 · 2 困难 · 3 一般 · 4 容易
          </p>
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

    <section
      v-if="props.legacyMigration && migrationStatus && migrationFailed"
      class="srs-review-migration-banner"
      aria-label="复习数据整理"
    >
      <div class="srs-review-migration-copy">
        <strong>复习数据后台整理暂停</strong>
        <p>原记录未受影响，可以稍后重试。</p>
      </div>
      <button
        type="button"
        class="srs-review-migration-button"
        :disabled="migrationBusy"
        @click="startLegacyMigration"
      >
        重新整理
      </button>
      <p v-if="migrationMessage" class="srs-review-migration-message" role="status">
        {{ migrationMessage }}
      </p>
    </section>

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
      <button type="button" class="srs-review-retry" @click="close">返回阅读器</button>
    </section>

    <section v-else-if="review.completed.value" class="srs-review-state" aria-live="polite">
      <h2>本次复习完成</h2>
      <p>共完成 {{ sessionCompletedCount }} 张</p>
      <ul class="srs-review-completion-counts">
        <li>Again 忘记：{{ review.sessionRatingCounts.value.again }}</li>
        <li>Hard 困难：{{ review.sessionRatingCounts.value.hard }}</li>
        <li>Good 一般：{{ review.sessionRatingCounts.value.good }}</li>
        <li>Easy 容易：{{ review.sessionRatingCounts.value.easy }}</li>
      </ul>
      <button type="button" class="srs-review-retry" @click="close">返回阅读器</button>
    </section>

    <template v-else-if="review.current.value">
      <div :key="review.current.value.word.id" class="srs-review-content">
        <article class="srs-review-context" aria-label="原文语境">
          <div
            v-if="review.contextCueLevel.value === 'none'"
            class="srs-review-context-gate"
            aria-live="polite"
          >
            <p>当前为仅单词模式，原句尚未显示。</p>
            <button
              type="button"
              :disabled="!hasTargetContext"
              @click="revealTargetSentence"
            >
              {{ hasTargetContext ? '显示目标句' : '暂无可显示的目标句' }}
            </button>
          </div>
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
            <p
              v-if="flowState.answerRevealed && sentenceTranslationZh"
              class="srs-review-sentence-translation"
              lang="zh-CN"
            ><span
              v-for="(part, partIndex) in sentenceTranslationParts"
              :key="partIndex"
              :class="{ 'is-review-meaning': part.highlighted }"
            >{{ part.text }}</span></p>
            <p
              v-else-if="flowState.answerRevealed && sentenceTranslationLoading"
              class="srs-review-sentence-translation is-loading"
              role="status"
            >正在生成整句翻译…</p>
            <p
              v-else-if="flowState.answerRevealed && sentenceTranslationUnavailable"
              class="srs-review-sentence-translation is-unavailable"
            >
              <span>整句翻译暂时不可用</span>
              <button type="button" @click="hydrateCurrentSentenceTranslation">重试</button>
            </p>
          </div>
          <div
            v-if="review.contextCueLevel.value === 'target_sentence' && hasSurroundingContext"
            class="srs-review-context-gate is-followup"
          >
            <button type="button" @click="revealSurroundingContext">显示周边语境</button>
          </div>

          <div
            v-if="review.contextCueLevel.value !== 'none' && (sourceLoading || audioState?.url || sourceAudioNotice)"
            class="srs-review-audio"
          >
            <label :for="audioId">原文音频</label>
            <div v-if="sourceLoading" class="srs-review-audio-loading" role="status">
              <span class="srs-review-spinner" aria-hidden="true"></span>
              <span>正在加载原文音频…</span>
            </div>
            <div v-else-if="sourceAudioNotice" class="srs-review-audio-notice" role="alert">
              <p>{{ sourceAudioNotice }}</p>
              <button type="button" @click="retrySourceAudio">重试</button>
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
                :class="{ 'is-playing': playbackPhase === 'word' }"
                type="button"
                :disabled="!canSpeak"
                :aria-keyshortcuts="wordShortcutDisplay"
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
            <div class="srs-review-answer-area">
              <p v-if="flowState.answerRevealed && word.phonetic" class="srs-review-phonetic">{{ word.phonetic }}</p>
              <div v-if="flowState.answerRevealed" class="srs-review-meanings">
                <section v-if="generalMeaning" class="srs-review-meaning-group is-general">
                  <h3>常用释义</h3>
                  <p>{{ generalMeaning }}</p>
                </section>
                <section v-if="meaning" class="srs-review-meaning-group is-contextual">
                  <h3>句中释义</h3>
                  <p>{{ meaning }}</p>
                </section>
                <section
                  v-if="dictionarySuggestionText"
                  class="srs-review-dictionary"
                  aria-label="本地词典 ECDICT"
                >
                  <h3>本地词典 · ECDICT</h3>
                  <p>{{ dictionarySuggestionText }}</p>
                </section>
                <section
                  v-else-if="dictionaryState.unavailableVisible"
                  class="srs-review-dictionary is-unavailable"
                  aria-label="本地词典 ECDICT 暂不可用"
                >
                  <h3>本地词典 · ECDICT</h3>
                  <p>ECDICT 暂不可用</p>
                </section>
              </div>
              <div v-else class="srs-review-answer-placeholder" aria-hidden="true">
                <span v-if="word.phonetic">{{ word.phonetic }}</span>
              </div>
            </div>
          </div>
          <div class="srs-review-word-toolbar">
            <div class="srs-review-play-sequence-group">
            <button
              class="srs-review-play-sequence"
              type="button"
              :aria-keyshortcuts="wordShortcutDisplay"
              :disabled="!canSpeak || Boolean(playbackPhase)"
              @click="speakWord"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path class="is-play" d="m8 5 11 7-11 7V5Z" />
              </svg>
              <span>播放单词</span>
              <kbd>{{ wordShortcutDisplay }}</kbd>
            </button>
            <button
              class="srs-review-play-sequence"
              type="button"
              :aria-keyshortcuts="sentenceShortcutDisplay"
              :disabled="!canPlaySentence || Boolean(playbackPhase)"
              @click="playSentenceOnly"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path class="is-play" d="m8 5 11 7-11 7V5Z" />
              </svg>
              <span>播放原句</span>
              <kbd>{{ sentenceShortcutDisplay }}</kbd>
            </button>
            </div>
          <button
            class="srs-review-remove-word"
            type="button"
            :disabled="review.pending.value || !review.canRemoveCurrent.value"
            :aria-label="`从 SRS 中移除 ${word.word}`"
            :title="review.canRemoveCurrent.value ? '移除误加入的单词' : review.removeUnavailableReason.value"
            @click="removeCurrentWord"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
            </svg>
            <span>移除误收录</span>
          </button>
          </div>
        </article>
      </div>

      <p v-if="review.error.value" class="srs-review-inline-error" role="alert">{{ review.error.value }}</p>
      <p
        v-else-if="review.currentEligibilityLabel.value"
        class="srs-review-inline-notice"
        aria-live="polite"
      >{{ review.currentEligibilityLabel.value }}</p>
      <p v-else-if="flowNotice" class="srs-review-inline-notice" aria-live="polite">{{ flowNotice }}</p>

      <footer class="srs-review-actions" aria-label="复习评价">
        <button
          v-if="!flowState.answerRevealed"
          type="button"
          class="srs-review-reveal"
          aria-label="Space 显示答案"
          aria-keyshortcuts="Space"
          @click="revealAnswer"
        >
          <span>显示答案</span>
        </button>
        <template v-for="action in review.actions" :key="action.shortcut">
          <button
          v-if="action.tone === 'again' || flowState.answerRevealed"
          type="button"
          :class="[`is-${action.tone}`, { 'is-pending': flowState.transitioning && flowState.pendingTone === action.tone }]"
          :aria-keyshortcuts="action.shortcut"
          :disabled="review.pending.value || review.reviewingPast.value || !review.currentEligible.value || flowState.ratingCommitted || flowState.transitioning"
          @click="handleRating(action)"
        >
          <span>{{ action.label }}</span>
        </button>
        </template>
      </footer>
    </template>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  buildReviewContext,
  describeReviewSourceError,
  releaseReviewAudio,
  resolveReviewGeneralMeaning,
  resolveReviewMeaning,
  resolveReviewSource,
} from './srs-review-context.js'
import {
  sentenceTranslationKey,
  translateSentenceBatches,
} from '../passage-preview/sentence-translation.js'
import { calculateSingleLineFontSize } from './srs-review-layout.js'
import { hydrateReviewGeneralMeanings } from './srs-review-meanings.js'
import { createSrsReviewFlow } from './srs-review-flow.js'
import {
  hasSurroundingReviewContext,
  visibleReviewParagraphs,
} from './srs-review-prompt.js'
import {
  createSrsReviewDictionaryAssistance,
} from './srs-review-dictionary-assistance.mjs'
import {
  formatDictionarySuggestion,
} from '../../dictionary/ecdict/browser/dictionary-suggestion-view.mjs'
import {
  isReviewReplayKey,
  normalizeReviewReplayShortcut,
  runReviewPlaybackSequence,
} from './srs-review-playback.js'
import {
  prefetchAmericanPronunciations,
  resolveAmericanPronunciationSequence,
  shouldUseSystemPronunciationFallback,
} from './srs-review-pronunciation.js'
import { getReviewActionForShortcut, useSrsReview } from './useSrsReview.js'

const props = defineProps({
  service: { type: Object, required: true },
  legacyMigration: { type: Object, default: null },
  standalone: { type: Boolean, default: false },
  dictionaryClient: { type: Object, default: null },
  active: { type: Boolean, default: true },
})
const emit = defineEmits(['close'])

const review = useSrsReview(props.service)
const audioElement = ref(null)
const audioState = ref(null)
const audioPlaybackRange = ref(null)
const pronunciationAudio = ref(null)
const pronunciationUrl = ref('')
const pronunciationUrls = ref([])
const pronunciationLoading = ref(false)
const sourceLoading = ref(false)
const sourceAudioNotice = ref('')
const historyOpen = ref(false)
const historyContainer = ref(null)
const flowNotice = ref('')
const sentenceTranslationZh = ref('')
const sentenceTranslationParts = ref([])
const sentenceTranslationLoading = ref(false)
const sentenceTranslationUnavailable = ref(false)
const migrationStatus = ref(null)
const migrationBusy = ref(false)
const migrationFailed = ref(false)
const migrationMessage = ref('')
const wordShortcut = ref('r')
const sentenceShortcut = ref('s')
const shortcutEditingTarget = ref('')
const playbackPhase = ref('')
const wordLine = ref(null)
const wordHeading = ref(null)
const wordFontSize = ref(null)
const audioId = `srs-review-audio-${Math.random().toString(36).slice(2)}`
const historyId = `srs-review-history-${Math.random().toString(36).slice(2)}`
const wordShortcutStorageKey = 'srs.review.wordShortcut.v1'
const sentenceShortcutStorageKey = 'srs.review.playbackShortcut.v1'
let audioRequest = 0
let cancelPronunciationWait = null
let cancelSentenceReady = null
let cancelTargetSentenceWait = null
let wordResizeObserver = null
let wordFitFrame = 0
let wordFitKey = ''
let sourceReadyPromise = Promise.resolve(null)
let pronunciationReadyPromise = Promise.resolve([])
let meaningAbortController = null
let sequencePlaybackRequest = -1
let playbackStatusRequest = 0
let translationRequest = 0
const sentenceTranslationCache = new Map()
const flowState = reactive({
  answerRevealed: false,
  ratingCommitted: false,
  transitioning: false,
  committedTone: '',
  pendingTone: '',
  advanced: false,
})
const dictionaryState = reactive({
  query: '',
  result: null,
  unavailable: false,
  errorCode: null,
  requestId: 0,
  revealed: false,
  visibleResult: null,
  unavailableVisible: false,
})
const dictionaryAssistance = createSrsReviewDictionaryAssistance({
  client: props.dictionaryClient,
  onChange(snapshot) {
    Object.assign(dictionaryState, snapshot)
  },
})
const flow = createSrsReviewFlow({
  state: flowState,
  submitAction: (action, metadata) => review.submitAction(action, {
    advance: false,
    background: true,
    answerRevealedBeforeRating: metadata?.answerRevealedBeforeRating === true,
  }),
  playTargetSentence,
  playWordAndTargetSentence,
  stopAudio: stopCurrentPlayback,
  advance: advanceReviewCard,
  revealHint(message) {
    flowNotice.value = message
  },
})

const word = computed(() => review.current.value?.word || {})
const viewContext = computed(() => buildReviewContext(review.current.value))
const availableParagraphs = computed(() => (
  audioState.value?.paragraphs?.length
    ? audioState.value.paragraphs
    : (viewContext.value?.paragraphs || [])
))
const displayParagraphs = computed(() => visibleReviewParagraphs(
  availableParagraphs.value,
  review.contextCueLevel.value,
))
const hasTargetContext = computed(() => availableParagraphs.value.some((paragraph) => paragraph?.target))
const hasSurroundingContext = computed(() => hasSurroundingReviewContext(availableParagraphs.value))
const meaning = computed(() => resolveReviewMeaning(word.value, viewContext.value?.raw))
const generalMeaning = computed(() => resolveReviewGeneralMeaning(word.value))
const dictionarySuggestionText = computed(() => formatDictionarySuggestion(
  dictionaryState.visibleResult,
  { includeSource: false },
))
const sessionCompletedCount = computed(() => Object.values(review.sessionRatingCounts.value)
  .reduce((sum, count) => sum + Number(count || 0), 0))
const wordShortcutDisplay = computed(() => wordShortcut.value.toLocaleUpperCase('en-US'))
const sentenceShortcutDisplay = computed(() => sentenceShortcut.value.toLocaleUpperCase('en-US'))
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
  review.contextCueLevel.value !== 'none'
  && review.current.value
  && (sourceLoading.value || audioState.value?.url),
))

onMounted(async () => {
  wordShortcut.value = loadShortcut(wordShortcutStorageKey, 'r', 's')
  sentenceShortcut.value = loadShortcut(sentenceShortcutStorageKey, 's', wordShortcut.value)
  void loadLegacyMigrationStatus()
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
})
function activateReviewPage() {
  window.addEventListener('keydown', handleReviewShortcut, true)
  document.addEventListener('pointerdown', handleHistoryOutsidePointer, true)
  if (!audioState.value && review.current.value) {
    void loadReviewSourceForCurrentCard(++audioRequest)
  }
}

watch(() => props.active, (active) => {
  if (active) activateReviewPage()
  else deactivateReviewPage()
}, { immediate: true })

onBeforeUnmount(() => {
  deactivateReviewPage()
  meaningAbortController?.abort()
  wordResizeObserver?.disconnect()
  if (wordFitFrame) cancelAnimationFrame(wordFitFrame)
  dictionaryAssistance.dispose()
  stopAndReleaseAudio()
})

function deactivateReviewPage() {
  window.removeEventListener('keydown', handleReviewShortcut, true)
  document.removeEventListener('pointerdown', handleHistoryOutsidePointer, true)
  historyOpen.value = false
  shortcutEditingTarget.value = ''
  stopAndReleaseAudio()
}

function handleHistoryOutsidePointer(event) {
  if (!historyOpen.value || historyContainer.value?.contains(event.target)) return
  historyOpen.value = false
  shortcutEditingTarget.value = ''
}

async function loadLegacyMigrationStatus() {
  if (!props.legacyMigration || typeof props.legacyMigration.getStatus !== 'function') return
  try {
    migrationStatus.value = await props.legacyMigration.getStatus()
  } catch (error) {
    migrationMessage.value = error?.message || '无法读取历史词迁移状态'
  }
}

async function startLegacyMigration() {
  if (
    migrationBusy.value
    || !props.legacyMigration
    || typeof props.legacyMigration.migrateAll !== 'function'
  ) return
  migrationBusy.value = true
  migrationFailed.value = false
  migrationMessage.value = '正在保留原记录并创建新版复习状态…'
  try {
    const result = await props.legacyMigration.migrateAll({
      batchSize: 25,
      yieldBetweenCandidates: true,
      yieldBetweenBatches: true,
      onProgress(status) {
        migrationStatus.value = status
        migrationMessage.value = `正在整理复习数据：已处理 ${status.migrated} / ${status.eligible}`
      },
    })
    migrationStatus.value = result
    migrationMessage.value = result.pending_confirmation
      ? `已完成可自动整理的词；还有 ${result.pending_confirmation} 个词需要补充含义。`
      : '复习数据已整理完成；原记录仍保留。'
    if (!review.current.value) {
      await review.load()
      void hydrateReviewGeneralMeanings(review.queue.value, props.service, {
        signal: meaningAbortController?.signal,
      })
    }
  } catch (error) {
    migrationFailed.value = true
    migrationMessage.value = error?.message || '复习数据整理失败，可稍后重试'
  } finally {
    migrationBusy.value = false
  }
}

watch(() => review.current.value?.word?.id, async (nextId, previousId) => {
  const request = ++audioRequest
  sequencePlaybackRequest = -1
  playbackStatusRequest += 1
  playbackPhase.value = ''
  stopAndReleaseAudio()
  flow.resetCard()
  flowNotice.value = ''
  translationRequest += 1
  sentenceTranslationZh.value = ''
  sentenceTranslationParts.value = []
  sentenceTranslationLoading.value = false
  sentenceTranslationUnavailable.value = false
  void dictionaryAssistance.setCard(nextId ? word.value.word : '')
  if (!nextId) return
  void prefetchUpcomingPronunciations()
  const sourcePromise = loadReviewSourceForCurrentCard(request)
  pronunciationLoading.value = true
  const readyPromise = resolveAmericanPronunciationSequence(word.value.word)
  pronunciationReadyPromise = readyPromise
  const resolvedPronunciations = await readyPromise
  if (request !== audioRequest) return
  pronunciationLoading.value = false
  pronunciationUrls.value = resolvedPronunciations
  pronunciationUrl.value = resolvedPronunciations[0] || ''
  await nextTick()
  fitWordHeading()
  if (sequencePlaybackRequest !== request) void playWordWithStatus(request)
  if (!previousId) await sourcePromise
})

watch(() => word.value.word, async () => {
  wordFontSize.value = null
  await nextTick()
  fitWordHeading()
})

watch(() => flowState.answerRevealed, (revealed) => {
  dictionaryAssistance.setRevealed(revealed)
  if (revealed) void hydrateCurrentSentenceTranslation()
})

async function hydrateCurrentSentenceTranslation() {
  if (!flowState.answerRevealed) return
  const request = ++translationRequest
  const cardId = review.current.value?.word?.id
  sentenceTranslationLoading.value = true
  sentenceTranslationUnavailable.value = false
  await sourceReadyPromise.catch(() => null)
  if (
    request !== translationRequest
    || !flowState.answerRevealed
    || review.current.value?.word?.id !== cardId
  ) return
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
  const cached = embedded || sentenceTranslationCache.get(key)
  if (cached) {
    sentenceTranslationZh.value = cached
    sentenceTranslationParts.value = embedded && Array.isArray(audioState.value?.translationParts)
      && audioState.value.translationParts.length
      ? audioState.value.translationParts
      : [{ text: cached, highlighted: false }]
    sentenceTranslationLoading.value = false
    sentenceTranslationUnavailable.value = false
    if (embedded) sentenceTranslationCache.set(key, embedded)
    return
  }
  try {
    const translated = await translateSentenceBatches([{
      id: `srs-review-${review.current.value?.word?.id || 'sentence'}`,
      sentence,
    }])
    const translation = String(translated[0]?.translationZh || '').trim()
    if (
      request !== translationRequest
      || !flowState.answerRevealed
      || sentenceTranslationKey(currentTranslationSentence()) !== key
    ) return
    if (translation) {
      sentenceTranslationCache.set(key, translation)
      sentenceTranslationZh.value = translation
      sentenceTranslationParts.value = [{ text: translation, highlighted: false }]
      sentenceTranslationUnavailable.value = false
    } else {
      sentenceTranslationUnavailable.value = true
    }
  } catch (_error) {
    if (request === translationRequest) sentenceTranslationUnavailable.value = true
  } finally {
    if (request === translationRequest) sentenceTranslationLoading.value = false
  }
}

function currentTranslationSentence() {
  return String(audioState.value?.targetSentence || viewContext.value?.sentence || '').trim()
}

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
  if (shortcutEditingTarget.value) {
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    if (event.key === 'Escape') {
      shortcutEditingTarget.value = ''
      return
    }
    const nextShortcut = normalizeReviewReplayShortcut(event.key)
    const target = shortcutEditingTarget.value
    const conflictingShortcut = target === 'word' ? sentenceShortcut.value : wordShortcut.value
    if (!nextShortcut || nextShortcut === conflictingShortcut) return
    if (target === 'word') {
      wordShortcut.value = nextShortcut
      saveShortcut(wordShortcutStorageKey, nextShortcut)
    } else {
      sentenceShortcut.value = nextShortcut
      saveShortcut(sentenceShortcutStorageKey, nextShortcut)
    }
    shortcutEditingTarget.value = ''
    return
  }
  if (
    event.defaultPrevented
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || isTypingTarget(event.target)
  ) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat || review.pending.value || !review.current.value) return
    if (event.key === 'ArrowLeft') {
      review.goPrevious()
      return
    }
    if (review.canNext.value) {
      review.goNext()
      return
    }
    if (flowState.ratingCommitted) void flow.handleSpace()
    return
  }
  if (event.code === 'Space' || event.key === ' ') {
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) {
      flowNotice.value = ''
      void flow.handleSpace()
    }
    return
  }
  if (isReviewReplayKey(event, wordShortcut.value)) {
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat && canSpeak.value) void speakWord()
    return
  }
  if (isReviewReplayKey(event, sentenceShortcut.value)) {
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat && canPlaySentence.value) void playSentenceOnly()
    return
  }
  if (
    event.repeat
    || event.altKey
    || event.ctrlKey
    || event.metaKey
  ) return
  if (review.pending.value || !review.current.value || review.reviewingPast.value) return
  const action = getReviewActionForShortcut(event.key)
  if (!action) return
  event.preventDefault()
  void handleRating(action)
}

function handleRating(action) {
  flowNotice.value = ''
  return flow.rate(action)
}

function revealAnswer() {
  flowNotice.value = ''
  return flow.revealAnswer()
}

function revealTargetSentence() {
  flowNotice.value = ''
  return review.showTargetSentence()
}

function revealSurroundingContext() {
  flowNotice.value = ''
  return review.showSurroundingContext()
}

function advanceReviewCard() {
  stopAndReleaseAudio()
  return review.advanceCurrent()
}

async function removeCurrentWord() {
  if (review.pending.value || !review.current.value) return
  if (!review.canRemoveCurrent.value) {
    flowNotice.value = review.removeUnavailableReason.value
    return
  }
  const label = String(word.value.word || '').trim()
  if (!window.confirm(`确定从 SRS 中移除“${label}”吗？`)) return
  stopAndReleaseAudio()
  await review.removeCurrent()
}

function isTypingTarget(target) {
  const tagName = String(target?.tagName || '').toLowerCase()
  return target?.isContentEditable || ['input', 'textarea', 'select'].includes(tagName)
}

function beginShortcutEditing(target) {
  shortcutEditingTarget.value = target
}

function loadShortcut(storageKey, fallback, conflictingShortcut = '') {
  try {
    const stored = normalizeReviewReplayShortcut(window.localStorage.getItem(storageKey))
    return stored && stored !== conflictingShortcut ? stored : fallback
  } catch (_error) {
    return fallback
  }
}

function saveShortcut(storageKey, shortcut) {
  try {
    window.localStorage.setItem(storageKey, shortcut)
  } catch (_error) {}
}

function loadReviewSourceForCurrentCard(request = audioRequest) {
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
  return sourcePromise
}

function handleReviewSourceError(error, request = audioRequest) {
  if (request !== audioRequest) return
  sourceAudioNotice.value = describeReviewSourceError(error)
}

async function retrySourceAudio() {
  if (sourceLoading.value) return
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

function stopAndReleaseAudio() {
  sourceReadyPromise = Promise.resolve(null)
  if (cancelSentenceReady) cancelSentenceReady()
  if (cancelTargetSentenceWait) cancelTargetSentenceWait(false)
  if (audioElement.value) {
    audioElement.value.pause()
    audioElement.value.removeAttribute('src')
    audioElement.value.load()
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
    if (cancelTargetSentenceWait) cancelTargetSentenceWait(true)
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
  stopCurrentPlayback()
}

async function speakWord() {
  if (!canSpeak.value) return
  const request = audioRequest
  sequencePlaybackRequest = request
  beginManualPlayback()
  await pronunciationReadyPromise
  if (request !== audioRequest) return
  await playWordWithStatus(request)
}

async function playSentenceOnly({ maxDurationMs = 12000 } = {}) {
  const request = audioRequest
  const statusRequest = ++playbackStatusRequest
  sequencePlaybackRequest = request
  beginManualPlayback()
  playbackPhase.value = 'sentence'
  try {
    return await playTargetSentence({ maxDurationMs })
  } finally {
    if (request === audioRequest && statusRequest === playbackStatusRequest) {
      playbackPhase.value = ''
    }
  }
}

async function playWordAndTargetSentence({ maxDurationMs = 12000 } = {}) {
  const request = audioRequest
  const statusRequest = ++playbackStatusRequest
  sequencePlaybackRequest = request
  beginManualPlayback()
  try {
    playbackPhase.value = 'word'
    await pronunciationReadyPromise
    if (request !== audioRequest) return false
    return await runReviewPlaybackSequence({
      isCurrent: () => request === audioRequest,
      playWord: playWordPronunciation,
      playSentence: async () => {
        playbackPhase.value = 'sentence'
        await playTargetSentence({ maxDurationMs })
      },
    })
  } finally {
    if (statusRequest === playbackStatusRequest) playbackPhase.value = ''
  }
}

async function playWordWithStatus(request = audioRequest) {
  const statusRequest = ++playbackStatusRequest
  playbackPhase.value = 'word'
  try {
    await playWordPronunciation()
  } finally {
    if (request === audioRequest && statusRequest === playbackStatusRequest) {
      playbackPhase.value = ''
    }
  }
}

function prefetchUpcomingPronunciations() {
  const start = Math.max(0, Number(review.viewIndex.value || 0) + 1)
  return prefetchAmericanPronunciations(
    review.queue.value
      .slice(start, start + 20)
      .map((entry) => entry?.word?.word)
      .filter(Boolean),
  )
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
  if (shouldUseSystemPronunciationFallback(word.value.word)) {
    await speakWithSystemVoice()
  }
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

async function playTargetSentence({ maxDurationMs = 12000 } = {}) {
  const request = audioRequest
  await sourceReadyPromise
  await nextTick()
  const element = audioElement.value
  const source = audioState.value
  if (request !== audioRequest || !element || !source?.url) return false
  await waitForSentenceMetadata(element)
  if (request !== audioRequest || element !== audioElement.value || source !== audioState.value) return false
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
  pronunciationUrl.value = ''
}

function handleSourceAudioError() {
  if (!audioState.value) return
  audioState.value = { ...audioState.value, url: '' }
  sourceAudioNotice.value = '原文音频文件加载失败，请重试。'
}
</script>
