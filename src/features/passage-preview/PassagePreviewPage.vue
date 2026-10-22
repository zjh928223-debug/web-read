<template>
  <main
    ref="previewRoot"
    class="srs-review-page passage-preview-page is-overlay"
    data-ui-theme="light"
    :data-preview-entry-state="entryState"
  >
    <header class="srs-review-header">
      <Button variant="outline" size="default" data-ui-owner="learning" class="srs-review-back" type="button" aria-label="返回阅读器" @click="close">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
        返回
      </Button>
      <div class="srs-review-heading passage-preview-source">
        <p>{{ batchTitle }}</p>
      </div>
      <div class="passage-preview-header-meta">
        <p v-if="progressReady && items.length" class="srs-review-progress" aria-live="polite">预习 {{ currentIndex + 1 }} / {{ items.length }}</p>
          <Button
            variant="ghost"
            size="default"
            data-ui-owner="learning"
            class="passage-preview-shortcut-open"
            type="button"
            aria-label="打开首次接触快捷键设置"
            @click="openShortcutSettings"
          >快捷键</Button>
          <Button
            variant="ghost"
            size="default"
            data-ui-owner="learning"
            class="passage-preview-shortcut-open"
            type="button"
            aria-label="打开预习数量设置"
            @click="emit('open-settings')"
          >预习设置</Button>
      </div>
    </header>

    <section class="passage-preview-entry-panel" :class="`is-${entryState}`" aria-live="polite" role="status">
      <div>
        <p class="passage-preview-entry-label">{{ entryCopy.label }}</p>
        <h2>{{ entryCopy.title }}</h2>
        <p>{{ entryCopy.description }}</p>
        <p v-if="entrySourceLabel" class="passage-preview-entry-source">当前读取来源：{{ entrySourceLabel }}</p>
      </div>
      <div class="passage-preview-entry-actions">
        <Button
          variant="outline"
          size="default"
          data-ui-owner="learning"
          type="button"
          :disabled="entryState === ENTRY_STATES.LOADING"
          @click="emit('request-import')"
        >导入新版词包</Button>
        <Button
          variant="default"
          size="default"
          data-ui-owner="learning"
          type="button"
          :disabled="entryState === ENTRY_STATES.LOADING"
          @click="emit('retry')"
        >重新读取</Button>
      </div>
    </section>

    <section v-if="items.length" class="passage-preview-group-summary" aria-labelledby="passage-preview-group-title">
      <header>
        <div>
          <p class="passage-preview-entry-label">实际组摘要</p>
          <h2 id="passage-preview-group-title">{{ groupSummary.count }} 个当前成员</h2>
        </div>
        <p>{{ groupSummary.sourceKnownCount }}/{{ groupSummary.count }} 项有来源，{{ groupSummary.locatorKnownCount }}/{{ groupSummary.count }} 项有定位</p>
        <p class="passage-preview-contact-summary">
          首次接触证据：{{ contactSummary.currentPersisted }}/{{ contactSummary.currentTotal }} 已记录；
          canonical 已登记 {{ contactSummary.currentCommitted }} 项；待恢复 {{ contactSummary.pendingRecovery }} 项。
        </p>
      </header>
      <ul>
        <li v-for="row in groupSummary.rows" :key="row.id">
          <strong>{{ row.word }}</strong>
          <span>来源：{{ row.source }}</span>
          <span>定位：{{ row.locator }}</span>
          <span>选择依据：{{ row.reason }}</span>
        </li>
      </ul>
    </section>

    <p v-if="queueNotice" class="passage-preview-queue-notice" role="status">{{ queueNotice }}</p>

    <section v-if="items.length && !progressReady" class="srs-review-state passage-preview-owner-state" aria-live="polite" role="status">
      <h2>{{ progressLoadError ? '首次接触进度暂不可用' : '正在恢复首次接触进度…' }}</h2>
      <p>{{ progressLoadError || '正在从本机 Host 恢复已保存的首次接触进度。' }}</p>
    </section>

    <section v-else-if="items.length && progress.status === 'completed'" class="srs-review-state passage-preview-complete" aria-live="polite">
      <h2>{{ items.length }}词首次接触完成</h2>
      <p>本轮已经完成。满 24 小时的词会按每日上限逐步进入“今日复习”，不会一次全部压给你。</p>
      <p v-if="pendingPreviewKnown">等待池当前 {{ props.pendingPreviewCount }} 个词；这只是积压提醒，不阻断当前组或下一组入口。</p>
      <p v-else>等待池当前不可读；这不阻断已保存组或候选组进入，恢复 Host 后可重新读取。</p>
      <div class="passage-preview-complete-actions">
        <Button variant="default" size="default" data-ui-owner="learning" type="button" class="srs-review-retry" @click="emit('open-review')">去今日复习</Button>
        <Button variant="outline" size="default" data-ui-owner="learning" type="button" class="srs-review-retry passage-preview-secondary" @click="close">返回阅读器</Button>
      </div>
    </section>

    <template v-else-if="items.length">
      <p v-if="progressWriteError" class="srs-review-inline-notice" role="alert">{{ progressWriteError }}</p>
      <div :key="current.id" class="srs-review-content passage-preview-content">
        <article class="srs-review-word-panel passage-preview-word-panel" aria-label="预习单词">
          <div class="passage-preview-word-content">
            <p class="passage-preview-step-label">首次接触</p>
            <div class="srs-review-word-line passage-preview-word-line">
              <Button
                variant="outline"
                size="icon"
                data-ui-owner="learning"
                class="srs-review-speaker"
                :class="{ 'is-playing': playbackPhase === 'word' }"
                :disabled="!canInteract()"
                type="button"
                :aria-label="`使用 Aria 美式发音朗读 ${current.word}`"
                @click="speakWord"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                  <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" />
                </svg>
              </Button>
              <h2 :class="wordLengthClass" data-preview-current-word>{{ current.word }}</h2>
            </div>
            <div v-if="isRevealed" class="passage-preview-learning-content">
              <p v-if="current.phonetic" class="srs-review-phonetic">{{ current.phonetic }}</p>
              <p v-if="displayedPartOfSpeech" class="passage-preview-pos">{{ displayedPartOfSpeech }}</p>
              <div class="passage-preview-primary-sense">
                <span>{{ displayedPrimarySenseStatus === 'resolved' ? '主要意思' : '主要义建议' }}</span>
                <p class="passage-preview-meaning">{{ displayedPrimaryMeaning }}</p>
                <small v-if="displayedPrimarySenseStatus !== 'resolved'">尚未达到多来源义项共识，不代表固定使用比例。</small>
              </div>
            </div>
            <p v-if="currentContactStatus" class="passage-preview-contact-status" role="status">
              首次接触证据已保存；{{ currentContactStatusLabel }}。
            </p>
            <p v-if="pronunciationNotice" class="srs-review-inline-notice" role="status">{{ pronunciationNotice }}</p>
          </div>
        </article>

        <article class="srs-review-context passage-preview-context" :aria-label="isAiGeneratedSentence ? 'AI 辅助例句' : realSentence ? '简短真实语境' : '当前词对应句子'">
          <h2>{{ isAiGeneratedSentence ? 'AI 辅助例句' : realSentence ? '简短真实语境' : '当前词对应句子' }}</h2>
          <div class="passage-preview-context-body">
            <section v-if="realSentence" class="passage-preview-real-sentence">
              <div class="passage-preview-sentence-line">
                <p data-preview-current-sentence>
                  <template v-for="(part, index) in highlightedSentence" :key="`${part.text}-${index}`">
                    <mark v-if="part.target">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </p>
                <Button
                  variant="outline"
                  size="icon"
                  data-ui-owner="learning"
                  class="srs-review-speaker passage-preview-sentence-speaker"
                  :class="{ 'is-playing': playbackPhase === 'sentence' }"
                  :disabled="!canInteract()"
                  type="button"
                  aria-label="朗读真实短句"
                  @click="speakSentence"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                    <path d="M15 9.5a4 4 0 0 1 0 5" />
                  </svg>
                </Button>
              </div>
              <div
                v-if="isRevealed && sentenceTranslationZh"
                class="passage-preview-translation-control"
              >
                <p
                  v-if="sentenceTranslationVisible"
                  class="passage-preview-sentence-translation"
                >{{ sentenceTranslationZh }}</p>
              </div>
              <p v-if="isAiGeneratedSentence" class="passage-preview-ai-sentence-note" role="note">
                AI 生成辅助例句，仅用于理解、发音和简单用法，不作为真实语境或复习毕业依据。
              </p>
              <p v-if="realSentence.source?.attributionText" class="passage-preview-attribution" role="note">
                {{ realSentence.source.attributionText }}
              </p>
              <p class="passage-preview-audio-note" role="note">当前播放为 Aria 美式 TTS；本轮未提供原文音频。</p>
              <a
                v-if="realSentence.source?.brandingRequired && realSentence.source?.poweredByLogoUrl"
                class="passage-preview-required-branding"
                :href="realSentence.source.url"
                target="_blank"
                rel="noreferrer"
                :aria-label="`查看${realSentence.source.brandingLabel || '例句来源'}`"
              >
                <img
                  :src="realSentence.source.poweredByLogoUrl"
                  :alt="realSentence.source.brandingLabel || '例句来源'"
                  width="50"
                  height="50"
                  referrerpolicy="no-referrer"
                >
              </a>
            </section>
            <p v-else class="passage-preview-sentence-state passage-preview-sentence-state--empty" role="status">
              当前词暂时没有可用对应句子，尚未登记首次接触。
            </p>
          </div>
        </article>
      </div>

      <footer class="srs-review-actions passage-preview-actions" aria-label="预习导航">
        <Button v-if="!isRevealed" variant="default" size="default" data-ui-owner="learning" type="button" class="srs-review-reveal" :disabled="!canInteract()" @click="revealLearningContent">
          <span>看看这个词怎么用</span>
        </Button>
        <template v-else>
          <Button variant="outline" size="default" data-ui-owner="learning" type="button" class="passage-preview-secondary" :disabled="!canInteract() || currentIndex === 0" @click="move(-1)">
            <span>上一个</span>
          </Button>
          <Button variant="default" size="default" data-ui-owner="learning" type="button" class="srs-review-next" :disabled="!canInteract()" @click="moveNext">
            <span>{{ currentIndex === items.length - 1 ? '完成首次接触' : '下一词' }}</span>
          </Button>
        </template>
      </footer>
      <p v-if="navigationNotice" class="passage-preview-navigation-notice" role="status">{{ navigationNotice }}</p>
    </template>

    <div
      v-if="shortcutSettingsOpen"
      class="passage-preview-shortcut-backdrop"
      @pointerdown.self="closeShortcutSettings"
    >
      <section
        ref="shortcutDialogRoot"
        class="passage-preview-shortcut-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="passage-preview-shortcut-title"
      >
        <header>
          <div>
            <p>首次接触</p>
            <h2 id="passage-preview-shortcut-title">快捷键设置</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            data-ui-owner="learning"
            data-shortcut-dialog-initial-focus
            class="passage-preview-shortcut-close"
            type="button"
            aria-label="关闭快捷键设置"
            @click="closeShortcutSettings"
          >×</Button>
        </header>
        <p class="passage-preview-shortcut-intro">点击修改，再按下新的单键。</p>
        <div class="passage-preview-translation-mode-row">
          <div>
            <span>句子中文</span>
            <small>{{ translationDisplayMode === TRANSLATION_DISPLAY_MODES.HOLD ? '按住快捷键时显示，松开即隐藏' : '按一次保持显示，再按一次隐藏' }}</small>
          </div>
          <div class="passage-preview-translation-actions">
            <button
              type="button"
              class="passage-preview-translation-mode-switch"
              role="switch"
              :aria-checked="translationDisplayMode === TRANSLATION_DISPLAY_MODES.PERSISTENT"
              :aria-label="`中文展示方式：${translationDisplayMode === TRANSLATION_DISPLAY_MODES.HOLD ? '按住展示' : '持续展示'}`"
              @click="toggleTranslationDisplayMode"
            >
              <span :class="{ 'is-active': translationDisplayMode === TRANSLATION_DISPLAY_MODES.HOLD }">按住展示</span>
              <span :class="{ 'is-active': translationDisplayMode === TRANSLATION_DISPLAY_MODES.PERSISTENT }">持续展示</span>
            </button>
            <Button
              variant="ghost"
              size="default"
              data-ui-owner="learning"
              type="button"
              class="passage-preview-translation-shortcut passage-preview-shortcut-record"
              :class="{ 'is-editing': shortcutEditingAction === 'translation' }"
              :aria-label="shortcutEditingAction === 'translation' ? '正在设置句子中文快捷键' : '修改句子中文快捷键'"
              @click="beginShortcutCapture('translation')"
            >
              <kbd>{{ shortcutEditingAction === 'translation' ? '…' : formatShortcut(shortcuts.translation) }}</kbd>
              <small>{{ shortcutEditingAction === 'translation' ? '请按键' : '修改' }}</small>
            </Button>
          </div>
        </div>
        <div class="passage-preview-shortcut-list">
          <div v-for="action in shortcutActionsWithoutTranslation" :key="action.id" class="passage-preview-shortcut-row">
            <span>{{ action.label }}</span>
            <Button
              variant="ghost"
              size="default"
              data-ui-owner="learning"
              class="passage-preview-shortcut-record"
              type="button"
              :class="{ 'is-editing': shortcutEditingAction === action.id }"
              :aria-label="shortcutEditingAction === action.id ? `正在设置${action.label}` : `修改${action.label}快捷键`"
              @click="beginShortcutCapture(action.id)"
            >
              <kbd>{{ shortcutEditingAction === action.id ? '…' : formatShortcut(shortcuts[action.id]) }}</kbd>
              <small>{{ shortcutEditingAction === action.id ? '请按键' : '修改' }}</small>
            </Button>
          </div>
        </div>
        <p class="passage-preview-shortcut-notice" aria-live="polite">{{ shortcutNotice }}</p>
        <footer>
          <Button variant="outline" size="default" data-ui-owner="learning" type="button" @click="restoreDefaultShortcuts">恢复默认</Button>
          <Button variant="default" size="default" data-ui-owner="learning" type="button" @click="closeShortcutSettings">完成</Button>
        </footer>
      </section>
    </div>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Button } from '../../components/ui/button/index.js'
import { createDialogController } from '../../services/runtime/dialog-controller.js'
import { createAriaAmericanPronunciationService } from '../../services/pronunciation/aria-american-pronunciation.js'
import {
  createFallbackAiPreviewSentence,
} from './passage-preview-ai-sentence.js'
import { resolvePreviewContextSentence } from './preview-sentence-source.js'
import {
  createInitialPassagePreviewProgress,
  isPassagePreviewOwnerAuthoritative,
  loadPassagePreviewProgress,
  loadPassagePreviewProgressFromOwner,
  savePassagePreviewProgress,
} from './passage-preview-storage.js'
import { sentenceTranslationKey } from './sentence-translation.js'
import { validatePreviewSentenceResult } from './preview-sentence-target-validation.mjs'
import {
  DEFAULT_PASSAGE_PREVIEW_SHORTCUTS,
  PASSAGE_PREVIEW_SHORTCUT_ACTIONS,
  PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODES,
  formatPassagePreviewShortcut,
  isEditableKeyboardTarget,
  isComposingKeyboardEvent,
  loadPassagePreviewShortcuts,
  loadPassagePreviewTranslationDisplayMode,
  passagePreviewActionForKeyboardEvent,
  savePassagePreviewShortcut,
  savePassagePreviewShortcuts,
  savePassagePreviewTranslationDisplayMode,
  shortcutFromKeyboardEvent,
} from './passage-preview-shortcuts.js'
import {
  PASSAGE_PREVIEW_ENTRY_STATES,
  buildPassagePreviewGroupSummary,
  getPassagePreviewEntryCopy,
} from './passage-preview-entry-state.js'
import {
  clearPendingPassagePreviewContact,
  createPassagePreviewContact,
  getPendingPassagePreviewContact,
  rememberPendingPassagePreviewContact,
} from './passage-preview-contact.js'

const TRANSLATION_DISPLAY_MODES = PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODES

const props = defineProps({
  items: { type: Array, required: true },
  pendingPreviewCount: { type: Number, default: null },
  pendingPreviewKnown: { type: Boolean, default: false },
  queueNotice: { type: String, default: '' },
  entryState: { type: String, default: PASSAGE_PREVIEW_ENTRY_STATES.IDLE },
  entryMessage: { type: String, default: '' },
  entrySource: { type: String, default: '' },
  contactSummary: {
    type: Object,
    default: () => ({
      currentTotal: 0,
      currentPersisted: 0,
      currentCommitted: 0,
      currentPending: 0,
      currentFailed: 0,
      pendingRecovery: 0,
    }),
  },
  contactStatuses: { type: Object, default: () => ({}) },
  interactionBlocked: { type: Boolean, default: false },
  preloadedSentences: { type: Object, default: () => ({}) },
  preloadedTranslations: { type: Object, default: () => ({}) },
})
const emit = defineEmits([
  'close',
  'item-enriched',
  'item-revealed',
  'item-visible',
  'preview-completed',
  'open-settings',
  'open-review',
  'request-import',
  'retry',
])
const ownerAuthoritative = isPassagePreviewOwnerAuthoritative()
const progress = reactive(createInitialPassagePreviewProgress())
const progressLoadError = ref('')
const progressReady = ref(!ownerAuthoritative)
const progressWriteError = ref('')
let progressWriteChain = Promise.resolve()
let progressMutationChain = Promise.resolve()
const pronunciation = createAriaAmericanPronunciationService()
const playbackPhase = ref('')
const pronunciationNotice = ref('')
const loadedSentence = ref(null)
const sentenceTranslations = reactive({})
const translationDisplayMode = ref(loadPassagePreviewTranslationDisplayMode())
const sentenceTranslationVisible = ref(false)
const translationHoldActive = ref(false)
const shortcutSettingsOpen = ref(false)
const shortcutDialogRoot = ref(null)
const shortcutDialogController = createDialogController()
const shortcutEditingAction = ref('')
const shortcutNotice = ref('')
const navigationNotice = ref('')
const shortcutActions = PASSAGE_PREVIEW_SHORTCUT_ACTIONS
const shortcutActionsWithoutTranslation = shortcutActions.filter(({ id }) => id !== 'translation')
const shortcuts = reactive(loadPassagePreviewShortcuts())
const ENTRY_STATES = PASSAGE_PREVIEW_ENTRY_STATES
const previewRoot = ref(null)
const entryState = computed(() => props.entryState || ENTRY_STATES.IDLE)
const entryCopy = computed(() => getPassagePreviewEntryCopy(entryState.value, {
  message: props.entryMessage,
  itemCount: props.items.length,
  waitingCount: props.pendingPreviewCount,
  waitingKnown: props.pendingPreviewKnown,
}))
const entrySourceLabel = computed(() => ({
  owner: 'Windows Host 持久记录',
  local: '本机缓存（只读回退）',
  saved: '已保存批次',
  imported: '显式导入',
  generated: '当前候选生成',
  migrated: '旧格式迁移',
}[props.entrySource] || '当前预习数据'))
const groupSummary = computed(() => buildPassagePreviewGroupSummary(props.items))
const contactSummary = computed(() => props.contactSummary || {})
const currentContactStatus = computed(() => props.contactStatuses?.[current.value.id] || '')
const currentContactStatusLabel = computed(() => ({
  pending: 'canonical 登记待完成',
  committed: 'canonical 已登记',
  failed: 'canonical 登记失败，重开后会按原证据重试',
}[currentContactStatus.value] || 'canonical 状态未知'))
let playbackRequestToken = 0
let currentContactToken = 0

Object.assign(sentenceTranslations, props.preloadedTranslations)

if (!ownerAuthoritative) {
  try {
    Object.assign(progress, loadPassagePreviewProgress())
  } catch (error) {
    progressLoadError.value = error?.message || '首次接触进度格式损坏，原文件未改写。'
    progressReady.value = false
  }
}

if (!ownerAuthoritative && progressReady.value && props.items.length && normalizeInitialProgress()) {
  void persist().catch(() => {})
}

const currentIndex = computed(() => props.items.length
  ? Math.max(0, Math.min(progress.currentIndex, props.items.length - 1))
  : 0)
const current = computed(() => props.items[currentIndex.value] || {})
const batchTitle = computed(() => current.value.batchTitle || `${props.items.length}词首次接触`)
const isRevealed = computed(() => progress.revealed[current.value.id] === true)
const wordLengthClass = computed(() => {
  const length = Array.from(String(current.value.word || '')).length
  if (length >= 24) return 'is-extreme-length'
  if (length >= 18) return 'is-extra-long'
  if (length >= 14) return 'is-very-long'
  if (length >= 8) return 'is-long'
  return ''
})
const persistedSentence = computed(() => validatedStoredSentence(current.value))
const storedSentence = computed(() => persistedSentence.value || resolvePreviewContextSentence(current.value))
const preloadedSentence = computed(() => props.preloadedSentences[current.value.id] || null)
const realSentence = computed(() => loadedSentence.value || preloadedSentence.value || storedSentence.value)
const isAiGeneratedSentence = computed(() => Boolean(
  realSentence.value?.generated
  || realSentence.value?.authentic === false
  || realSentence.value?.source?.kind === 'ai_generated',
))
const displayedPrimaryMeaning = computed(() => loadedSentence.value?.primaryMeaningZh || current.value.primaryMeaningZh)
const displayedPartOfSpeech = computed(() => loadedSentence.value?.primaryPartOfSpeech || current.value.pos)
const displayedPrimarySenseStatus = computed(() => loadedSentence.value?.primarySenseStatus || current.value.primarySenseStatus)
const highlightedSentence = computed(() => splitTarget(
  realSentence.value?.sentence,
  realSentence.value?.matchedForm || current.value.word || current.value.lemma,
))
const sentenceTranslationZh = computed(() => realSentence.value?.translationZh
  || sentenceTranslations[sentenceTranslationKey(realSentence.value?.sentence)]
  || '')
const upcomingSentenceTexts = computed(() => {
  const start = Math.max(0, currentIndex.value)
  return props.items.slice(start, start + 4)
    .map((item, index) => {
      const prepared = index === 0 && loadedSentence.value
        ? loadedSentence.value
        : props.preloadedSentences[item.id]
          || validatedStoredSentence(item)
          || resolvePreviewContextSentence(item)
      return prepared?.sentence || ''
    })
    .filter(Boolean)
})

async function revealLearningContent() {
  const item = current.value
  const revealedAt = new Date().toISOString()
  const saved = await enqueueProgressMutation(() => {
    if (!item.id || progress.revealed[item.id]) return false
    progress.revealed[item.id] = true
    return true
  })
  if (!saved) return
  emit('item-revealed', { item, revealedAt, progress: snapshotProgress() })
  if (current.value.id === item.id) {
    loadSentence()
    sentenceTranslationVisible.value = translationDisplayMode.value === TRANSLATION_DISPLAY_MODES.PERSISTENT
  }
}

function loadSentence() {
  if (
    preloadedSentence.value
    || storedSentence.value
    || (persistedSentence.value && current.value.primarySenseStatus === 'resolved')
  ) return
  loadedSentence.value = createFallbackAiPreviewSentence(current.value)
}

async function speakWord() {
  await speak(current.value.word, 'word')
}

async function speakSentence() {
  if (realSentence.value?.sentence) await speak(realSentence.value.sentence, 'sentence')
}

async function speak(text, phase) {
  if (!canInteract() || document.hidden) {
    stopPlayback()
    return
  }
  stopPlayback()
  if (!text) return
  const requestToken = playbackRequestToken
  playbackPhase.value = phase
  pronunciationNotice.value = ''
  try {
    await pronunciation.speak(text)
  } catch (error) {
    if (requestToken === playbackRequestToken && error?.name !== 'AbortError') {
      pronunciationNotice.value = 'Aria美式发音暂不可用'
    }
  } finally {
    if (requestToken === playbackRequestToken && playbackPhase.value === phase) playbackPhase.value = ''
  }
}

async function move(offset) {
  if (!props.items.length) return false
  const nextIndex = currentIndex.value + offset
  if (nextIndex < 0) {
    navigationNotice.value = '已经是第一词。'
    return false
  }
  if (nextIndex >= props.items.length) {
    navigationNotice.value = '已经是最后一词，请完成当前词后再继续。'
    return false
  }
  return enqueueProgressMutation(() => {
    resetTransientState()
    progress.currentIndex = nextIndex
    return true
  })
}

async function moveNext() {
  if (!props.items.length) return false
  if (!isRevealed.value) {
    navigationNotice.value = '先展开释义和中文后再进入下一词。'
    return false
  }
  const changed = await enqueueProgressMutation(() => {
    resetTransientState()
    if (currentIndex.value === props.items.length - 1) {
      progress.status = 'completed'
      progress.completedAt = new Date().toISOString()
    } else {
      progress.currentIndex = Math.max(0, Math.min(props.items.length - 1, currentIndex.value + 1))
    }
    return true
  })
  if (changed && progress.status === 'completed') {
    emit('preview-completed', { items: props.items, progress: snapshotProgress() })
  }
  return changed
}

function openShortcutSettings() {
  shortcutSettingsOpen.value = true
  shortcutEditingAction.value = ''
  shortcutNotice.value = ''
}

function closeShortcutSettings() {
  shortcutSettingsOpen.value = false
  shortcutEditingAction.value = ''
  shortcutNotice.value = ''
}

function beginShortcutCapture(action) {
  if (!shortcutActions.some((candidate) => candidate.id === action)) return
  shortcutEditingAction.value = action
  shortcutNotice.value = '请按新的单键；按 Esc 取消。'
}

function formatShortcut(shortcut) {
  return formatPassagePreviewShortcut(shortcut)
}

function restoreDefaultShortcuts() {
  const saved = savePassagePreviewShortcuts(DEFAULT_PASSAGE_PREVIEW_SHORTCUTS)
  if (!saved) return
  Object.assign(shortcuts, saved)
  shortcutEditingAction.value = ''
  shortcutNotice.value = '已恢复默认快捷键。'
}

function toggleTranslationDisplayMode() {
  const nextMode = translationDisplayMode.value === TRANSLATION_DISPLAY_MODES.HOLD
    ? TRANSLATION_DISPLAY_MODES.PERSISTENT
    : TRANSLATION_DISPLAY_MODES.HOLD
  const saved = savePassagePreviewTranslationDisplayMode(nextMode)
  if (!saved) {
    shortcutNotice.value = '中文展示方式保存失败，请重试。'
    return
  }
  releaseTranslationHold()
  translationDisplayMode.value = saved
  sentenceTranslationVisible.value = saved === TRANSLATION_DISPLAY_MODES.PERSISTENT
  shortcutNotice.value = saved === TRANSLATION_DISPLAY_MODES.HOLD
    ? '已切换为按住展示。'
    : '已切换为持续展示。'
}

function handleShortcutKeydown(event) {
  if (isComposingKeyboardEvent(event)) return
  if (shortcutSettingsOpen.value) {
    if (!shortcutEditingAction.value) {
      if (event.key === 'Tab') return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeShortcutSettings()
      } else if (passagePreviewActionForKeyboardEvent(event, shortcuts)) {
        event.stopPropagation()
      }
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    if (event.key === 'Escape') {
      shortcutEditingAction.value = ''
      shortcutNotice.value = '已取消修改。'
      return
    }
    const nextShortcut = shortcutFromKeyboardEvent(event)
    if (!nextShortcut) {
      shortcutNotice.value = '请使用字母、数字、空格或方向键，不要组合 Ctrl / Alt。'
      return
    }
    const conflicting = shortcutActions.find(({ id }) => (
      id !== shortcutEditingAction.value && shortcuts[id] === nextShortcut
    ))
    if (conflicting) {
      shortcutNotice.value = `这个按键已用于“${conflicting.label}”，请换一个。`
      return
    }
    const action = shortcutEditingAction.value
    const saved = savePassagePreviewShortcut(action, nextShortcut)
    if (!saved) {
      shortcutNotice.value = '快捷键保存失败，请换一个按键再试。'
      return
    }
    shortcuts[action] = saved
    shortcutEditingAction.value = ''
    shortcutNotice.value = '已保存，立即生效。'
    return
  }

  if (!canInteract()) return

  if (
    event.defaultPrevented
    || event.repeat
    || event.ctrlKey
    || event.metaKey
    || event.altKey
    || isEditableKeyboardTarget(event.target)
  ) return
  const action = passagePreviewActionForKeyboardEvent(event, shortcuts)
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  if (action === 'revealContent') {
    if (!isRevealed.value) revealLearningContent()
    return
  }
  if (action === 'wordAudio') {
    void speakWord()
    return
  }
  if (action === 'sentenceAudio') {
    if (realSentence.value?.sentence) void speakSentence()
    return
  }
  if (action === 'translation') {
    if (isRevealed.value && sentenceTranslationZh.value) {
      if (translationDisplayMode.value === TRANSLATION_DISPLAY_MODES.HOLD) {
        translationHoldActive.value = true
        sentenceTranslationVisible.value = true
      } else {
        sentenceTranslationVisible.value = !sentenceTranslationVisible.value
      }
    }
    return
  }
  if (action === 'previousItem') {
    if (currentIndex.value === 0) {
      navigationNotice.value = '已经是第一词。'
      return
    }
    void move(-1)
    return
  }
  if (action === 'nextItem') void moveNext()
}

function handleShortcutKeyup(event) {
  if (isComposingKeyboardEvent(event) || !canInteract()) return
  if (
    translationDisplayMode.value !== TRANSLATION_DISPLAY_MODES.HOLD
    || !translationHoldActive.value
    || passagePreviewActionForKeyboardEvent(event, shortcuts) !== 'translation'
  ) return
  event.preventDefault()
  event.stopPropagation()
  releaseTranslationHold()
}

function releaseTranslationHold() {
  if (!translationHoldActive.value) return
  translationHoldActive.value = false
  sentenceTranslationVisible.value = false
}

function handlePreviewWindowBlur() {
  if (translationDisplayMode.value === TRANSLATION_DISPLAY_MODES.HOLD) releaseTranslationHold()
  stopPlayback()
}

function handlePreviewVisibilityChange() {
  if (document.hidden) {
    if (translationDisplayMode.value === TRANSLATION_DISPLAY_MODES.HOLD) releaseTranslationHold()
    stopPlayback()
    return
  }
  if (canInteract()) prefetchUpcomingPronunciation()
  scheduleVisibleContactCheck()
}

function resetTransientState() {
  currentContactToken += 1
  releaseTranslationHold()
  sentenceTranslationVisible.value = isRevealed.value
    && translationDisplayMode.value === TRANSLATION_DISPLAY_MODES.PERSISTENT
  loadedSentence.value = null
  stopPlayback()
  pronunciationNotice.value = ''
  navigationNotice.value = ''
}

function stopPlayback() {
  playbackRequestToken += 1
  pronunciation.stop()
  playbackPhase.value = ''
}

function close() {
  closeShortcutSettings()
  resetTransientState()
  emit('close')
}

function snapshotProgress() {
  return {
    status: progress.status,
    currentIndex: progress.currentIndex,
    revealed: { ...progress.revealed },
    contextExpanded: {},
    firstContacts: cloneValue(progress.firstContacts || {}),
    startedAt: progress.startedAt,
    completedAt: progress.completedAt,
  }
}

function normalizeInitialProgress() {
  if (ownerAuthoritative && progress.status === 'in_progress') return false
  if (progress.status !== 'not_started' && progress.currentIndex < props.items.length) return false
  const nextIndex = props.items.length
    ? Math.max(0, Math.min(progress.currentIndex, props.items.length - 1))
    : 0
  const nextStartedAt = progress.startedAt || new Date().toISOString()
  const changed = progress.status !== 'in_progress'
    || progress.currentIndex !== nextIndex
    || progress.startedAt !== nextStartedAt
  progress.status = 'in_progress'
  progress.currentIndex = nextIndex
  progress.startedAt = nextStartedAt
  return changed
}

function canNormalizeInitialProgress() {
  return progressReady.value
    && props.items.length > 0
    && (!ownerAuthoritative || entryState.value === ENTRY_STATES.READY)
}

function canInteract() {
  return progressReady.value
    && entryState.value === ENTRY_STATES.READY
    && !progressWriteError.value
    && !props.interactionBlocked
    && !shortcutSettingsOpen.value
    && !document.hidden
}

function enqueueProgressMutation(mutator) {
  const operation = progressMutationChain.then(async () => {
    if (!canInteract()) return false
    const previous = snapshotProgress()
    try {
      if (mutator() === false) return false
      await persist()
      return true
    } catch (_error) {
      Object.assign(progress, previous)
      return false
    }
  })
  progressMutationChain = operation.catch(() => false)
  return operation
}

function persist({ allowBeforeReady = false } = {}) {
  if ((ownerAuthoritative && !progressReady.value && !allowBeforeReady) || progressWriteError.value) {
    return Promise.reject(new Error('passage preview progress is not writable'))
  }
  const write = progressWriteChain.then(() => savePassagePreviewProgress(snapshotProgress()))
  progressWriteChain = write.catch((error) => {
    progressWriteError.value = error?.message || '进度保存失败，请重新打开。'
    return undefined
  })
  return write
}

function splitTarget(sentence, target) {
  const text = String(sentence || '')
  const word = String(target || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  if (!text || !word) return [{ text, target: false }]
  const expression = new RegExp(`(?<![A-Za-z])(${word})(?![A-Za-z])`, 'igu')
  const exactTarget = new RegExp(`^${word}$`, 'iu')
  return text.split(expression).filter(Boolean).map((part) => ({
    text: part,
    target: exactTarget.test(part),
  }))
}

function validatedStoredSentence(item) {
  const validation = validatePreviewSentenceResult(item, item?.realSentence)
  return validation.accepted ? validation.result : null
}

function isElementVisible(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return false
  if (!element.getClientRects?.().length) return false
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
  const rect = element.getBoundingClientRect()
  return rect.bottom > 0
    && rect.right > 0
    && rect.top < window.innerHeight
    && rect.left < window.innerWidth
}

function scheduleVisibleContactCheck() {
  void nextTick().then(() => recordVisibleContact())
}

function prefetchUpcomingPronunciation() {
  if (!canInteract() || document.hidden) return
  void pronunciation.prefetch(upcomingSentenceTexts.value).catch(() => {})
}

async function recordVisibleContact() {
  const token = currentContactToken
  await nextTick()
  if (
    token !== currentContactToken
    || !progressReady.value
    || !props.items.length
    || entryState.value !== ENTRY_STATES.READY
    || props.interactionBlocked
    || shortcutSettingsOpen.value
    || progressWriteError.value
    || document.hidden
  ) return
  const item = current.value
  const sentence = realSentence.value
  if (!item.id || !sentence?.sentence) return
  const wordNode = previewRoot.value?.querySelector('[data-preview-current-word]')
  const sentenceNode = previewRoot.value?.querySelector('[data-preview-current-sentence]')
  if (!isElementVisible(wordNode) || !isElementVisible(sentenceNode)) return
  const contact = getPendingPassagePreviewContact(item) || createPassagePreviewContact({
    item,
    seenAt: new Date().toISOString(),
    sentence,
  })
  if (!contact) return
  rememberPendingPassagePreviewContact(contact)
  const saved = await enqueueProgressMutation(() => {
    if (
      token !== currentContactToken
      || shortcutSettingsOpen.value
      || props.interactionBlocked
      || document.hidden
      || progress.firstContacts[item.id]
    ) return false
    progress.firstContacts[item.id] = contact
    return true
  })
  if (!saved) {
    if (progress.firstContacts[item.id]) clearPendingPassagePreviewContact(item)
    return
  }
  clearPendingPassagePreviewContact(item)
  if (token !== currentContactToken || current.value.id !== item.id) return
  emit('item-visible', {
    item: contact.item,
    firstContact: contact,
    introducedAt: contact.seenAt,
    progress: snapshotProgress(),
  })
}

onMounted(async () => {
  window.addEventListener('keydown', handleShortcutKeydown, true)
  window.addEventListener('keyup', handleShortcutKeyup, true)
  window.addEventListener('blur', handlePreviewWindowBlur)
  window.addEventListener('scroll', scheduleVisibleContactCheck, true)
  window.addEventListener('resize', scheduleVisibleContactCheck)
  document.addEventListener('visibilitychange', handlePreviewVisibilityChange)
  if (!ownerAuthoritative) {
    scheduleVisibleContactCheck()
    return
  }
  try {
    const ownerProgress = await loadPassagePreviewProgressFromOwner()
    if (!ownerProgress) throw new Error('passage preview owner progress is unavailable')
    Object.assign(progress, ownerProgress)
    if (canNormalizeInitialProgress() && normalizeInitialProgress()) {
      await persist({ allowBeforeReady: true })
    }
    progressReady.value = true
    scheduleVisibleContactCheck()
  } catch (_error) {
    progressLoadError.value = progressWriteError.value || 'Host 进度查询或保存失败，请重新打开。'
  }
})

watch([() => progressReady.value, () => current.value.id, () => entryState.value], ([ready]) => {
  if (!ready) return
  resetTransientState()
  loadSentence()
  if (canInteract() && !document.hidden) {
    void speakWord()
    prefetchUpcomingPronunciation()
  }
  scheduleVisibleContactCheck()
}, { immediate: true })

watch([() => props.items.length, () => entryState.value], () => {
  if (!canNormalizeInitialProgress() || !normalizeInitialProgress()) return
  void persist({ allowBeforeReady: true }).catch(() => {})
})

watch([
  () => current.value.id,
  () => realSentence.value?.sentence,
  () => progressReady.value,
  () => props.interactionBlocked,
  () => entryState.value,
], () => {
  scheduleVisibleContactCheck()
}, { immediate: true })

watch(() => props.interactionBlocked, (blocked) => {
  currentContactToken += 1
  if (blocked) {
    releaseTranslationHold()
    stopPlayback()
  } else {
    scheduleVisibleContactCheck()
  }
})

watch(entryState, (state) => {
  currentContactToken += 1
  if (state !== ENTRY_STATES.READY) {
    releaseTranslationHold()
    stopPlayback()
  }
})

watch(() => props.preloadedTranslations, (translations) => {
  Object.assign(sentenceTranslations, translations || {})
}, { deep: true })

watch(upcomingSentenceTexts, (texts) => {
  if (!canInteract() || document.hidden) return
  void pronunciation.prefetch(texts).catch(() => {})
}, { immediate: true })

watch(() => props.preloadedSentences, () => {
  scheduleVisibleContactCheck()
}, { deep: true })

watch(shortcutSettingsOpen, async (open) => {
  currentContactToken += 1
  if (open) {
    releaseTranslationHold()
    stopPlayback()
  }
  if (!open) {
    shortcutDialogController.close()
    scheduleVisibleContactCheck()
    return
  }
  await nextTick()
  if (!shortcutDialogRoot.value) return
  shortcutDialogController.open(shortcutDialogRoot.value, {
    initialFocus: shortcutDialogRoot.value.querySelector('[data-shortcut-dialog-initial-focus]'),
    onRequestClose: closeShortcutSettings,
  })
})

onBeforeUnmount(() => {
  shortcutDialogController.dispose()
  window.removeEventListener('keydown', handleShortcutKeydown, true)
  window.removeEventListener('keyup', handleShortcutKeyup, true)
  window.removeEventListener('blur', handlePreviewWindowBlur)
  window.removeEventListener('scroll', scheduleVisibleContactCheck, true)
  window.removeEventListener('resize', scheduleVisibleContactCheck)
  document.removeEventListener('visibilitychange', handlePreviewVisibilityChange)
  resetTransientState()
})

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}
</script>
