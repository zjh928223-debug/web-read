<template>
  <main class="srs-review-page" data-ui-theme="light" :class="{ 'is-overlay': !standalone }">
    <header class="srs-review-header">
      <Button
        variant="ghost"
        size="default"
        data-ui-owner="learning"
        class="srs-review-back"
        type="button"
        aria-label="返回阅读器"
        @click="close"
      >
        <svg class="rw:size-3.5" aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
        返回
      </Button>
      <div class="srs-review-heading">
        <h1 class="srs-review-title">
          {{ props.standalone ? props.standaloneTitle : '今日复习' }}
        </h1>
        <p v-if="props.standalone && props.standaloneNotice" class="srs-review-standalone-marker">
          {{ props.standaloneNotice }}
        </p>
        <p class="srs-review-progress" aria-live="polite">
          {{ review.progress.value || '今日复习' }}
        </p>
      </div>
      <div ref="historyContainer" class="srs-review-summary">
        <Button variant="ghost" size="default" data-ui-owner="learning" type="button"
          :aria-expanded="infoOpen" aria-controls="srs-review-info"
          @click="infoOpen = !infoOpen; historyOpen = false; shortcutEditingTarget = ''"
        >复习说明</Button>
        <Button
          variant="ghost"
          size="default"
          data-ui-owner="learning"
          class="srs-review-history-toggle"
          type="button"
          :aria-expanded="historyOpen"
          :aria-controls="historyId"
          @click="historyOpen = !historyOpen; infoOpen = false"
        >
          快捷键
        </Button>
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
              <Button
                variant="outline"
                data-ui-owner="learning"
                class="srs-review-shortcut-control rw:h-auto"
                type="button"
                :class="{ 'is-editing': shortcutEditingTarget === 'word' }"
                :aria-label="shortcutEditingTarget === 'word' ? '请按新的单词播放快捷键，按 Escape 取消' : `修改单词播放快捷键，当前为 ${wordShortcutDisplay}`"
                @click="beginShortcutEditing('word')"
              >
                <kbd>{{ shortcutEditingTarget === 'word' ? '…' : wordShortcutDisplay }}</kbd>
                <small>{{ shortcutEditingTarget === 'word' ? '等待按键' : '点击修改' }}</small>
              </Button>
            </div>
            <div class="srs-review-playback-shortcut-setting">
              <span>播放原句</span>
              <Button
                variant="outline"
                data-ui-owner="learning"
                class="srs-review-shortcut-control rw:h-auto"
                type="button"
                :class="{ 'is-editing': shortcutEditingTarget === 'sentence' }"
                :aria-label="shortcutEditingTarget === 'sentence' ? '请按新的原句播放快捷键，按 Escape 取消' : `修改原句播放快捷键，当前为 ${sentenceShortcutDisplay}`"
                @click="beginShortcutEditing('sentence')"
              >
                <kbd>{{ shortcutEditingTarget === 'sentence' ? '…' : sentenceShortcutDisplay }}</kbd>
                <small>{{ shortcutEditingTarget === 'sentence' ? '等待按键' : '点击修改' }}</small>
              </Button>
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
        <section v-if="infoOpen" id="srs-review-info" class="srs-review-history" aria-label="复习说明">
          <h2>复习说明</h2>
          <p>{{ review.queueSummary.value || '复习队列' }}</p>
          <p>{{ review.sourceReasonLabel.value }}<span v-if="review.currentEnqueueReasonLabel.value"> · {{ review.currentEnqueueReasonLabel.value }}</span></p>
          <div class="srs-review-rating-help" aria-label="四档评分说明">
            <p v-for="action in review.actions" :key="action.tone">
              <strong>{{ action.label }}</strong>：{{ ratingExplanation(action) }}
            </p>
          </div>
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
      <Button
        variant="outline"
        size="default"
        data-ui-owner="learning"
        type="button"
        class="srs-review-migration-button"
        :disabled="migrationBusy"
        @click="startLegacyMigration"
      >
        重新整理
      </Button>
      <p v-if="migrationMessage" class="srs-review-migration-message" role="status">
        {{ migrationMessage }}
      </p>
    </section>

    <section
      v-if="review.saveSummary.value.hasActivity"
      class="srs-review-save-status"
      aria-label="评分保存状态"
    >
      <div class="srs-review-save-status-copy" role="status" aria-live="polite">
        <strong>{{ review.saveSummary.value.message }}</strong>
        <p v-if="review.saveError.value" class="srs-review-save-error" role="alert">
          保存错误：{{ review.saveError.value }}
        </p>
        <p v-if="review.ratingBlocked.value">新的评分已暂停；请先处理下面的原评分状态。</p>
        <p v-else-if="review.completionPendingSave.value">所有评分确认后，本批才会显示为完成。</p>
      </div>
      <ul v-if="unresolvedSaveItems.length" class="srs-review-save-status-list">
        <li v-for="item in unresolvedSaveItems" :key="item.itemId">
          <span class="srs-review-save-item-copy">
            <strong>{{ item.wordLabel }} · {{ item.ratingLabel }}</strong>
            <small>{{ item.statusLabel }}</small>
            <small v-if="item.errorMessage" class="srs-review-save-item-error">{{ item.errorMessage }}</small>
          </span>
          <Button
            v-if="item.retryable && ['failed', 'unknown'].includes(item.status)"
            variant="outline"
            size="default"
            data-ui-owner="learning"
            type="button"
            class="srs-review-save-retry"
            @click="review.retryReviewSave(item.itemId)"
          >重试原评分</Button>
        </li>
      </ul>
    </section>

    <section v-if="review.loading.value" class="srs-review-state" aria-live="polite">
      <span class="srs-review-spinner" aria-hidden="true"></span>
      <p>{{ props.standalone ? '正在准备样本演示…' : '正在准备今日复习…' }}</p>
      <p v-if="props.standalone && props.standaloneNotice" class="srs-review-standalone-state-note">
        {{ props.standaloneNotice }}
      </p>
    </section>

    <section v-else-if="review.error.value && !review.current.value" class="srs-review-state" role="alert">
      <h2>{{ props.standalone ? '样本演示加载失败' : '加载失败' }}</h2>
      <p v-if="props.standalone && props.standaloneNotice" class="srs-review-standalone-state-note">
        {{ props.standaloneNotice }}
      </p>
      <p>{{ review.error.value }}</p>
      <Button
        variant="outline"
        size="default"
        data-ui-owner="learning"
        type="button"
        class="srs-review-retry"
        @click="review.load"
      >重试</Button>
    </section>

    <section v-else-if="review.empty.value" class="srs-review-state" aria-live="polite">
      <h2>当前没有可复习项</h2>
      <p>当前批次为空；不代表今日全部待处理已完成。</p>
      <Button
        variant="outline"
        size="default"
        data-ui-owner="learning"
        type="button"
        class="srs-review-retry"
        @click="close"
      >返回阅读器</Button>
    </section>

    <section v-else-if="review.completed.value" class="srs-review-state" aria-live="polite">
      <h2>{{ review.completionPendingSave.value ? '本批已作答，等待保存确认' : '当前复习批已完成' }}</h2>
      <p>本批共作答 {{ sessionCompletedCount }} 张；已确认 {{ review.saveSummary.value.confirmedCount }} 张</p>
      <p v-if="review.deferredRevisit.value">{{ review.currentEligibilityLabel.value }}，稍后回来即可继续。</p>
      <ul class="srs-review-completion-counts">
        <li>Again 忘记：{{ review.sessionRatingCounts.value.again }}</li>
        <li>Hard 困难：{{ review.sessionRatingCounts.value.hard }}</li>
        <li>Good 一般：{{ review.sessionRatingCounts.value.good }}</li>
        <li>Easy 容易：{{ review.sessionRatingCounts.value.easy }}</li>
      </ul>
      <Button
        variant="outline"
        size="default"
        data-ui-owner="learning"
        type="button"
        class="srs-review-retry"
        @click="close"
      >返回阅读器</Button>
    </section>

    <template v-else-if="review.current.value">
      <div :key="review.currentCardKey.value" class="srs-review-content">
        <article class="srs-review-context" aria-label="原文语境">
          <p
            v-if="review.contextNotice.value"
            class="srs-review-context-notice"
            role="status"
          >{{ review.contextNotice.value }}</p>
          <div
            v-if="review.contextCueLevel.value === 'none'"
            class="srs-review-context-gate"
            aria-live="polite"
          >
            <p>当前为仅单词模式，原句尚未显示。</p>
            <Button
              variant="outline"
              size="default"
              data-ui-owner="learning"
              type="button"
              :disabled="!hasTargetContext"
              @click="revealTargetSentence"
            >
              {{ hasTargetContext ? '显示目标句' : '暂无可显示的目标句' }}
            </Button>
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
              v-if="flowState.answerRevealed && sentenceTranslationVisible && sentenceTranslationZh"
              class="srs-review-sentence-translation"
              lang="zh-CN"
            ><span
              v-for="(part, partIndex) in sentenceTranslationParts"
              :key="partIndex"
              :class="{ 'is-review-meaning': part.highlighted }"
            >{{ part.text }}</span></p>
            <p
              v-else-if="flowState.answerRevealed && sentenceTranslationVisible && sentenceTranslationLoading"
              class="srs-review-sentence-translation is-loading"
              role="status"
            >正在生成整句翻译…</p>
            <p
              v-else-if="flowState.answerRevealed && sentenceTranslationVisible && sentenceTranslationUnavailable"
              class="srs-review-sentence-translation is-unavailable"
            >
              <span>整句翻译暂时不可用</span>
              <Button
                variant="outline"
                size="default"
                data-ui-owner="learning"
                type="button"
                @click="hydrateCurrentSentenceTranslation"
              >重试</Button>
            </p>
          </div>
          <div
            v-if="review.contextCueLevel.value === 'target_sentence' && hasSurroundingContext"
            class="srs-review-context-gate is-followup"
          >
            <Button
              variant="outline"
              size="default"
              data-ui-owner="learning"
              type="button"
              @click="revealSurroundingContext"
            >显示周边语境</Button>
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
              <Button
                variant="outline"
                size="default"
                data-ui-owner="learning"
                type="button"
                @click="retrySourceAudio"
              >重试</Button>
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
              <Button
                variant="outline"
                size="icon"
                data-ui-owner="learning"
                class="srs-review-speaker"
                :class="{ 'is-playing': playbackPhase === 'word' }"
                type="button"
                :disabled="!canSpeak"
                :aria-keyshortcuts="wordShortcutDisplay"
                :aria-label="`朗读 ${word.word}`"
                @click="speakWord"
              >
                <svg class="rw:size-[19px]" aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                  <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" />
                </svg>
              </Button>
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
              <p v-if="!flowState.answerRevealed" class="srs-review-recall-prompt">
                先回忆这个词在当前学习单元中的目标义；显示答案后再评价本次回忆。
              </p>
              <div v-if="flowState.answerRevealed" class="srs-review-meanings">
                <section v-if="generalMeaning" class="srs-review-meaning-group is-general">
                  <h3>常用释义</h3>
                  <p>{{ generalMeaning }}</p>
                </section>
                <section v-if="targetSenseLabel" class="srs-review-meaning-group is-target">
                  <h3>目标义</h3>
                  <p>{{ targetSenseLabel }}</p>
                </section>
                <section v-if="meaning && meaning !== targetSenseLabel" class="srs-review-meaning-group is-contextual">
                  <h3>当前句中释义</h3>
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
            <Button
              variant="ghost"
              size="default"
              data-ui-owner="learning"
              class="srs-review-play-sequence"
              type="button"
              :aria-keyshortcuts="wordShortcutDisplay"
              :disabled="!canSpeak || Boolean(playbackPhase)"
              @click="speakWord"
            >
              <svg class="rw:size-3.5" aria-hidden="true" viewBox="0 0 24 24">
                <path class="is-play" d="m8 5 11 7-11 7V5Z" />
              </svg>
              <span>播放单词</span>
              <kbd>{{ wordShortcutDisplay }}</kbd>
            </Button>
            <Button
              variant="ghost"
              size="default"
              data-ui-owner="learning"
              class="srs-review-play-sequence"
              type="button"
              :aria-keyshortcuts="sentenceShortcutDisplay"
              :disabled="!canPlaySentence || Boolean(playbackPhase)"
              @click="playSentenceOnly"
            >
              <svg class="rw:size-3.5" aria-hidden="true" viewBox="0 0 24 24">
                <path class="is-play" d="m8 5 11 7-11 7V5Z" />
              </svg>
              <span>播放原句</span>
              <kbd>{{ sentenceShortcutDisplay }}</kbd>
            </Button>
            </div>
          <Button
            variant="ghost"
            size="default"
            data-ui-owner="learning"
            class="srs-review-remove-word"
            type="button"
            :disabled="review.pending.value || !review.canRemoveCurrent.value"
            :aria-label="`从 SRS 中移除 ${word.word}`"
            :title="review.canRemoveCurrent.value ? '移除误加入的单词' : review.removeUnavailableReason.value"
            @click="removeCurrentWord"
          >
            <svg class="rw:size-[13px]" aria-hidden="true" viewBox="0 0 24 24">
              <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
            </svg>
            <span>移除误收录</span>
          </Button>
          </div>
        </article>
      </div>

      <p v-if="review.error.value" class="srs-review-inline-error" role="alert">{{ review.error.value }}</p>
      <p v-else-if="review.removeError.value" class="srs-review-inline-error" role="alert">
        移出失败：{{ review.removeError.value }}
      </p>
      <p v-else-if="review.ratingBlocked.value" class="srs-review-inline-error" role="alert">
        {{ review.saveSummary.value.message }}
      </p>
      <p
        v-else-if="review.currentEligibilityLabel.value"
        class="srs-review-inline-notice"
        aria-live="polite"
      >{{ review.currentEligibilityLabel.value }}</p>
      <p v-else-if="flowNotice" class="srs-review-inline-notice" aria-live="polite">{{ flowNotice }}</p>

      <footer class="srs-review-actions" aria-label="复习评价">
        <Button
          v-if="!flowState.answerRevealed"
          variant="default"
          size="default"
          data-ui-owner="learning"
          type="button"
          class="srs-review-reveal"
          aria-label="Space 显示答案"
          aria-keyshortcuts="Space"
          @click="revealAnswer"
        >
          <span>显示答案</span>
        </Button>
        <template v-for="action in review.actions" :key="action.shortcut">
          <Button
          v-if="flowState.answerRevealed"
          variant="outline"
          size="default"
          data-ui-owner="learning"
          type="button"
          :class="[`is-${action.tone}`, { 'is-pending': flowState.transitioning && flowState.pendingTone === action.tone }]"
          :aria-keyshortcuts="action.shortcut"
          :aria-label="action.label"
          :disabled="review.pending.value || review.ratingBlocked.value || review.reviewingPast.value || !review.currentEligible.value || flowState.ratingCommitted || flowState.transitioning"
          @click="handleRating(action)"
        >
          <span>{{ action.label }}</span>
          <kbd>{{ action.shortcut }}</kbd>
        </Button>
        </template>
      </footer>
    </template>
  </main>
</template>

<script setup>
import { useSrsReviewMedia } from './use-srs-review-media.js'
import { useSrsReviewAnswerTranslation } from './use-srs-review-answer-translation.js'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Button } from '../../components/ui/button/index.js'
import {
  buildReviewContext,
  resolveReviewGeneralMeaning,
  resolveReviewMeaning,
} from './srs-review-context.js'

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
} from './srs-review-playback.js'

import { getReviewActionForShortcut, useSrsReview } from './useSrsReview.js'

const props = defineProps({
  service: { type: Object, required: true },
  legacyMigration: { type: Object, default: null },
  standalone: { type: Boolean, default: false },
  standaloneTitle: { type: String, default: '复习样本演示（不写正式学习记录）' },
  standaloneNotice: { type: String, default: '' },
  dictionaryClient: { type: Object, default: null },
  active: { type: Boolean, default: true },
})
const emit = defineEmits(['close'])

const review = useSrsReview(props.service, { allowRemove: !props.standalone })
const audioElement = ref(null)

const pronunciationAudio = ref(null)

const historyOpen = ref(false)
const infoOpen = ref(false)
const unresolvedSaveItems = computed(() => review.saveItems.value
  .filter((item) => ['failed', 'unknown'].includes(item.status)).slice().reverse())
const historyContainer = ref(null)
const flowNotice = ref('')

const migrationStatus = ref(null)
const migrationBusy = ref(false)
const migrationFailed = ref(false)
const migrationMessage = ref('')
const wordShortcut = ref('r')
const sentenceShortcut = ref('s')
const shortcutEditingTarget = ref('')

const wordLine = ref(null)
const wordHeading = ref(null)
const wordFontSize = ref(null)
const audioId = `srs-review-audio-${Math.random().toString(36).slice(2)}`
const historyId = `srs-review-history-${Math.random().toString(36).slice(2)}`
const wordShortcutStorageKey = 'srs.review.wordShortcut.v1'
const sentenceShortcutStorageKey = 'srs.review.playbackShortcut.v1'

let wordResizeObserver = null
let wordFitFrame = 0
let wordFitKey = ''

let meaningAbortController = null

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
const word = computed(() => review.current.value?.word || {})
const viewContext = computed(() => buildReviewContext(review.current.value))
const targetSense = computed(() => review.current.value?.learningUnit?.target_sense || null)
const targetSenseLabel = computed(() => String(
  targetSense.value?.gloss || targetSense.value?.definition || '',
).trim())
const meaning = computed(() => resolveReviewMeaning(
  word.value,
  viewContext.value?.raw,
  targetSense.value,
  { allowWordFallback: !review.current.value?.learningUnit || Boolean(targetSense.value) },
))

const media = useSrsReviewMedia({
  currentCard: review.current, word, viewContext, meaning,
  queue: review.queue, viewIndex: review.viewIndex, contextCueLevel: review.contextCueLevel,
  getActive: () => props.active, audioElement, pronunciationAudio, fitWordHeading,
})
const {
  audioState,
  pronunciationUrl,
  sourceLoading,
  sourceAudioNotice,
  playbackPhase,
  canSpeak,
  canPlaySentence,
  prepareCurrentCardMedia,
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
} = media
const translation = useSrsReviewAnswerTranslation({
  currentCard: review.current, getAnswerRevealed: () => flowState.answerRevealed,
  audioState, viewContext, meaning, media,
})
const {
  sentenceTranslationZh,
  sentenceTranslationParts,
  sentenceTranslationVisible,
  sentenceTranslationLoading,
  sentenceTranslationUnavailable,
  hydrateCurrentSentenceTranslation,
} = translation

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

const generalMeaning = computed(() => resolveReviewGeneralMeaning(word.value))
const dictionarySuggestionText = computed(() => formatDictionarySuggestion(
  dictionaryState.visibleResult,
  { includeSource: false },
))
const sessionCompletedCount = computed(() => Object.values(review.sessionRatingCounts.value)
  .reduce((sum, count) => sum + Number(count || 0), 0))
const wordShortcutDisplay = computed(() => wordShortcut.value.toLocaleUpperCase('en-US'))
const sentenceShortcutDisplay = computed(() => sentenceShortcut.value.toLocaleUpperCase('en-US'))

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
  media.activate()
  review.refreshEligibility()
  window.addEventListener('keydown', handleReviewShortcut, true)
  document.addEventListener('pointerdown', handleHistoryOutsidePointer, true)
  if (review.current.value && !review.deferredRevisit.value) {
    if (!audioState.value) void media.resumeCurrentCardMedia()
    if (flowState.answerRevealed) void hydrateCurrentSentenceTranslation()
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
  media.deactivate()
  translation.deactivate()
  window.removeEventListener('keydown', handleReviewShortcut, true)
  document.removeEventListener('pointerdown', handleHistoryOutsidePointer, true)
  historyOpen.value = false
  infoOpen.value = false
  shortcutEditingTarget.value = ''
  stopAndReleaseAudio()
}

function handleHistoryOutsidePointer(event) {
  if (historyContainer.value?.contains(event.target)) return
  historyOpen.value = false
  infoOpen.value = false
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

watch(() => review.currentCardKey.value, async (cardKey) => {
  const request = media.resetCard()
  flow.resetCard()
  flowNotice.value = ''
  translation.resetCard()
  void dictionaryAssistance.setCard(cardKey ? word.value.word : '')
  if (!cardKey || review.deferredRevisit.value || !media.isCurrentMediaRequest(request)) return
  await prepareCurrentCardMedia(request)
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

function close() {
  deactivateReviewPage()
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
    || event.isComposing
    || isTypingTarget(event.target)
  ) return
  if (historyOpen.value || infoOpen.value) {
    if (event.key === 'Escape') {
      historyOpen.value = false
      infoOpen.value = false
    }
    if (event.key !== 'Tab' && !historyContainer.value?.contains(event.target)) event.preventDefault()
    event.stopPropagation()
    return
  }
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
  if (review.pending.value || review.ratingBlocked.value || !review.current.value || review.reviewingPast.value) return
  if (!flowState.answerRevealed) return
  const action = getReviewActionForShortcut(event.key)
  if (!action) return
  event.preventDefault()
  void handleRating(action)
}

function handleRating(action) {
  if (review.ratingBlocked.value) return false
  flowNotice.value = ''
  return flow.rate(action)
}

function ratingExplanation(action) {
  return {
    again: '本次未回忆出；更新复习状态并进入后续重学调度',
    hard: '回忆费力；更新复习状态并影响后续复习间隔',
    good: '正常回忆出；更新复习状态并按调度安排后续复习',
    easy: '轻松回忆出；更新复习状态并按调度安排更晚复习',
  }[action?.tone] || ''
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
  stopCurrentPlayback()
  return review.advanceCurrent()
}

async function removeCurrentWord() {
  if (!review.current.value) return
  if (!review.canRemoveCurrent.value) {
    flowNotice.value = review.removeUnavailableReason.value
    return
  }
  const removed = await review.removeCurrent()
  flowNotice.value = removed
    ? '已从复习队列移出；词条、语境、学习单元和历史记录均保留。'
    : ''
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

</script>
