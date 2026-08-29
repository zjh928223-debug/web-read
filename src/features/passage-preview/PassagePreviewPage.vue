<template>
  <main class="srs-review-page passage-preview-page is-overlay">
    <header class="srs-review-header">
      <button class="srs-review-back" type="button" aria-label="返回阅读器" @click="close">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
        返回
      </button>
      <div class="srs-review-heading passage-preview-source">
        <p>{{ batchTitle }}</p>
      </div>
      <div class="passage-preview-header-meta">
        <p class="srs-review-progress" aria-live="polite">预习 {{ currentIndex + 1 }} / {{ items.length }}</p>
        <button
          class="passage-preview-shortcut-open"
          type="button"
          aria-label="打开首次接触快捷键设置"
          @click="openShortcutSettings"
        >快捷键</button>
      </div>
    </header>

    <section v-if="progress.status === 'completed'" class="srs-review-state passage-preview-complete" aria-live="polite">
      <h2>{{ items.length }}词首次接触完成</h2>
      <p>已记录首次接触；满足 24 小时延迟后会进入待考察，考察通过后自动进入复习队列。</p>
      <button type="button" class="srs-review-retry" @click="close">返回阅读器</button>
    </section>

    <template v-else>
      <div :key="current.id" class="srs-review-content passage-preview-content">
        <article class="srs-review-word-panel passage-preview-word-panel" aria-label="预习单词">
          <div class="passage-preview-word-content">
            <p class="passage-preview-step-label">首次接触</p>
            <div class="srs-review-word-line passage-preview-word-line">
              <button
                class="srs-review-speaker"
                :class="{ 'is-playing': playbackPhase === 'word' }"
                type="button"
                :aria-label="`使用 Aria 美式发音朗读 ${current.word}`"
                @click="speakWord"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                  <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" />
                </svg>
              </button>
              <h2 :class="wordLengthClass">{{ current.word }}</h2>
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
            <p v-if="pronunciationNotice" class="srs-review-inline-notice" role="status">{{ pronunciationNotice }}</p>
          </div>
        </article>

        <article class="srs-review-context passage-preview-context" :aria-label="isAiGeneratedSentence ? 'AI 辅助例句' : '简短真实语境'">
          <h2>{{ isAiGeneratedSentence ? 'AI 辅助例句' : '简短真实语境' }}</h2>
          <p v-if="!isRevealed" class="passage-preview-hidden-note">先看一眼词形；点击后只学习一个主要义和一条短句。</p>
          <div v-else class="passage-preview-context-body">
            <div v-if="sentenceLoading" class="passage-preview-sentence-state" role="status">
              正在从本地例句仓库和可追溯语料中筛选短句…
            </div>
            <section v-else-if="realSentence" class="passage-preview-real-sentence">
              <div class="passage-preview-sentence-line">
                <p>
                  <template v-for="(part, index) in highlightedSentence" :key="`${part.text}-${index}`">
                    <mark v-if="part.target">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </p>
                <button
                  class="srs-review-speaker passage-preview-sentence-speaker"
                  :class="{ 'is-playing': playbackPhase === 'sentence' }"
                  type="button"
                  aria-label="朗读真实短句"
                  @click="speakSentence"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                    <path d="M15 9.5a4 4 0 0 1 0 5" />
                  </svg>
                </button>
              </div>
              <p
                v-if="sentenceTranslationZh && sentenceTranslationVisible"
                class="passage-preview-sentence-translation"
              >{{ sentenceTranslationZh }}</p>
              <p v-if="isAiGeneratedSentence" class="passage-preview-ai-sentence-note" role="note">
                AI 生成辅助例句，仅用于理解、发音和简单用法，不作为真实语境或复习毕业依据。
              </p>
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
            <div v-else class="passage-preview-sentence-state passage-preview-sentence-state--empty" role="status">
              <p>{{ sentenceMessage || '暂未找到合格真实短句。' }}</p>
              <small>真实短句不可用时，会尝试生成一条经过规则校验的 AI 辅助例句。</small>
              <button v-if="sentenceStatus === 'error'" type="button" @click="loadSentence">重试例句准备</button>
            </div>
          </div>
        </article>
      </div>

      <footer class="srs-review-actions passage-preview-actions" aria-label="预习导航">
        <button v-if="!isRevealed" type="button" class="srs-review-reveal" @click="revealLearningContent">
          <span>看看这个词怎么用</span>
        </button>
        <template v-else>
          <button type="button" class="passage-preview-secondary" :disabled="currentIndex === 0" @click="move(-1)">
            <span>上一个</span>
          </button>
          <button type="button" class="srs-review-next" @click="moveNext">
            <span>{{ currentIndex === items.length - 1 ? '完成首次接触' : '下一词' }}</span>
          </button>
        </template>
      </footer>
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
          <button ref="shortcutDialogInitialFocus" type="button" aria-label="关闭快捷键设置" @click="closeShortcutSettings">×</button>
        </header>
        <p class="passage-preview-shortcut-intro">点击一个动作，再按下新的按键。每个动作必须使用不同按键。</p>
        <div class="passage-preview-translation-mode-row">
          <div>
            <span>句子中文</span>
            <small>{{ translationDisplayMode === TRANSLATION_DISPLAY_MODES.HOLD ? '按住快捷键时显示，松开即隐藏' : '按一次保持显示，再按一次隐藏' }}</small>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="translationDisplayMode === TRANSLATION_DISPLAY_MODES.PERSISTENT"
            :aria-label="`中文展示方式：${translationDisplayMode === TRANSLATION_DISPLAY_MODES.HOLD ? '按住展示' : '持续展示'}`"
            @click="toggleTranslationDisplayMode"
          >
            <span :class="{ 'is-active': translationDisplayMode === TRANSLATION_DISPLAY_MODES.HOLD }">按住展示</span>
            <span :class="{ 'is-active': translationDisplayMode === TRANSLATION_DISPLAY_MODES.PERSISTENT }">持续展示</span>
          </button>
        </div>
        <div class="passage-preview-shortcut-list">
          <div v-for="action in shortcutActions" :key="action.id" class="passage-preview-shortcut-row">
            <span>{{ action.label }}</span>
            <button
              type="button"
              :class="{ 'is-editing': shortcutEditingAction === action.id }"
              :aria-label="shortcutEditingAction === action.id ? `正在设置${action.label}` : `修改${action.label}快捷键`"
              @click="beginShortcutCapture(action.id)"
            >
              <kbd>{{ shortcutEditingAction === action.id ? '…' : formatShortcut(shortcuts[action.id]) }}</kbd>
              <small>{{ shortcutEditingAction === action.id ? '请按键' : '修改' }}</small>
            </button>
          </div>
        </div>
        <p class="passage-preview-shortcut-notice" aria-live="polite">{{ shortcutNotice }}</p>
        <footer>
          <button type="button" @click="restoreDefaultShortcuts">恢复默认</button>
          <button type="button" class="is-primary" @click="closeShortcutSettings">完成</button>
        </footer>
      </section>
    </div>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { createDialogController } from '../../services/runtime/dialog-controller.js'
import { createAriaAmericanPronunciationService } from '../../services/pronunciation/aria-american-pronunciation.js'
import { findAiPreviewSentence } from './passage-preview-ai-sentence.js'
import { findPreviewSentence, REAL_SENTENCE_STATUS, resolvePreviewContextSentence } from './preview-sentence-source.js'
import {
  isPassagePreviewOwnerAuthoritative,
  loadPassagePreviewProgress,
  loadPassagePreviewProgressFromOwner,
  savePassagePreviewProgress,
} from './passage-preview-storage.js'
import { sentenceTranslationKey, translateSentenceBatches } from './sentence-translation.js'
import { createTranslationGenerationQueue } from './translation-generation-queue.js'
import { validatePreviewSentenceResult } from './preview-sentence-target-validation.mjs'
import {
  DEFAULT_PASSAGE_PREVIEW_SHORTCUTS,
  PASSAGE_PREVIEW_SHORTCUT_ACTIONS,
  PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODES,
  formatPassagePreviewShortcut,
  isEditableKeyboardTarget,
  loadPassagePreviewShortcuts,
  loadPassagePreviewTranslationDisplayMode,
  passagePreviewActionForKeyboardEvent,
  savePassagePreviewShortcut,
  savePassagePreviewShortcuts,
  savePassagePreviewTranslationDisplayMode,
  shortcutFromKeyboardEvent,
} from './passage-preview-shortcuts.js'

const TRANSLATION_DISPLAY_MODES = PASSAGE_PREVIEW_TRANSLATION_DISPLAY_MODES

const props = defineProps({
  items: { type: Array, required: true },
  preloadedSentences: { type: Object, default: () => ({}) },
  preloadedTranslations: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['close', 'item-enriched', 'item-revealed'])
const progress = reactive(loadPassagePreviewProgress())
const pronunciation = createAriaAmericanPronunciationService()
const playbackPhase = ref('')
const pronunciationNotice = ref('')
const sentenceLoading = ref(false)
const sentenceStatus = ref('')
const sentenceMessage = ref('')
const loadedSentence = ref(null)
const sentenceTranslations = reactive({})
const translationDisplayMode = ref(loadPassagePreviewTranslationDisplayMode())
const sentenceTranslationVisible = ref(translationDisplayMode.value === TRANSLATION_DISPLAY_MODES.PERSISTENT)
const translationHoldActive = ref(false)
const shortcutSettingsOpen = ref(false)
const shortcutDialogRoot = ref(null)
const shortcutDialogInitialFocus = ref(null)
const shortcutDialogController = createDialogController()
const shortcutEditingAction = ref('')
const shortcutNotice = ref('')
const shortcutActions = PASSAGE_PREVIEW_SHORTCUT_ACTIONS
const shortcuts = reactive(loadPassagePreviewShortcuts())
let sentenceRequest = 0
let sentenceAbortController = null
const translationQueue = createTranslationGenerationQueue({
  translate: translateSentenceBatches,
  apply(translated) {
    for (const item of translated) sentenceTranslations[sentenceTranslationKey(item.sentence)] = item.translationZh
  },
})

Object.assign(sentenceTranslations, props.preloadedTranslations)

if (progress.status === 'not_started' || progress.currentIndex >= props.items.length) {
  progress.status = 'in_progress'
  progress.currentIndex = Math.min(progress.currentIndex, props.items.length - 1)
  progress.startedAt ||= new Date().toISOString()
  if (!isPassagePreviewOwnerAuthoritative()) persist()
}

const currentIndex = computed(() => Math.min(progress.currentIndex, props.items.length - 1))
const current = computed(() => props.items[currentIndex.value] || {})
const batchTitle = computed(() => current.value.batchTitle || `${props.items.length}词首次接触`)
const isRevealed = computed(() => progress.revealed[current.value.id] === true)
const wordLengthClass = computed(() => {
  const length = Array.from(String(current.value.word || '')).length
  if (length >= 24) return 'is-extreme-length'
  if (length >= 18) return 'is-extra-long'
  if (length >= 14) return 'is-very-long'
  if (length >= 10) return 'is-long'
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

function revealLearningContent() {
  progress.revealed[current.value.id] = true
  persist()
  emit('item-revealed', { item: current.value })
  void loadSentence()
}

async function loadSentence() {
  if (preloadedSentence.value || (persistedSentence.value && current.value.primarySenseStatus === 'resolved')) return
  const request = ++sentenceRequest
  sentenceAbortController?.abort()
  const abortController = new AbortController()
  sentenceAbortController = abortController
  sentenceLoading.value = true
  sentenceMessage.value = ''
  sentenceStatus.value = ''
  let result = await findPreviewSentence(current.value, { signal: abortController.signal })
    .catch((error) => error?.name === 'AbortError' ? null : ({ status: 'error', message: '真实短句加载失败。' }))
  if (result?.status !== REAL_SENTENCE_STATUS.READY) {
    const generated = await findAiPreviewSentence(current.value, { signal: abortController.signal })
      .catch((error) => error?.name === 'AbortError' ? null : null)
    if (generated) result = generated
  }
  if (!result || request !== sentenceRequest) return
  sentenceLoading.value = false
  sentenceStatus.value = result.status
  sentenceMessage.value = result.message || ''
  if (result.status === REAL_SENTENCE_STATUS.READY) {
    loadedSentence.value = result
    if (result.persistence !== 'none' && result.persistence !== 'session-only' && result.generated !== true) emit('item-enriched', {
      id: current.value.id,
      realSentence: result,
      primaryMeaningZh: result.primaryMeaningZh,
      pos: result.primaryPartOfSpeech,
      primarySenseStatus: result.primarySenseStatus,
      primarySenseReason: result.primarySenseReason,
      targetSenseKey: result.targetSenseKey,
    })
    if (!result.translationZh) void translateCurrentAfterPrefetch({ id: current.value.id, sentence: result.sentence })
  }
}

function queueTranslations(items) {
  return translationQueue.enqueue(items)
}

async function translateCurrentAfterPrefetch(item) {
  if (sentenceTranslations[sentenceTranslationKey(item.sentence)]) return
  await queueTranslations([item])
}

async function speakWord() {
  await speak(current.value.word, 'word')
}

async function speakSentence() {
  if (realSentence.value?.sentence) await speak(realSentence.value.sentence, 'sentence')
}

async function speak(text, phase) {
  pronunciation.stop()
  playbackPhase.value = phase
  pronunciationNotice.value = ''
  try {
    await pronunciation.speak(text)
  } catch (error) {
    if (error?.name !== 'AbortError') pronunciationNotice.value = 'Aria美式发音暂不可用'
  } finally {
    if (playbackPhase.value === phase) playbackPhase.value = ''
  }
}

function move(offset) {
  resetTransientState()
  progress.currentIndex = Math.max(0, Math.min(props.items.length - 1, currentIndex.value + offset))
  persist()
}

function moveNext() {
  if (currentIndex.value === props.items.length - 1) {
    resetTransientState()
    progress.status = 'completed'
    progress.completedAt = new Date().toISOString()
    persist()
    return
  }
  move(1)
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
  if (shortcutSettingsOpen.value) {
    if (!shortcutEditingAction.value) {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        closeShortcutSettings()
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
    if (isRevealed.value && realSentence.value?.sentence) void speakSentence()
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
  if (action === 'previousItem' && currentIndex.value > 0) {
    move(-1)
    return
  }
  if (!isRevealed.value) return
  if (action === 'nextItem') moveNext()
}

function handleShortcutKeyup(event) {
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
}

function handlePreviewVisibilityChange() {
  if (document.hidden && translationDisplayMode.value === TRANSLATION_DISPLAY_MODES.HOLD) releaseTranslationHold()
}

function resetTransientState() {
  releaseTranslationHold()
  sentenceTranslationVisible.value = translationDisplayMode.value === TRANSLATION_DISPLAY_MODES.PERSISTENT
  sentenceRequest += 1
  sentenceAbortController?.abort()
  sentenceAbortController = null
  sentenceLoading.value = false
  sentenceStatus.value = ''
  sentenceMessage.value = ''
  loadedSentence.value = null
  pronunciation.stop()
  playbackPhase.value = ''
  pronunciationNotice.value = ''
}

function close() {
  closeShortcutSettings()
  resetTransientState()
  emit('close')
}

function persist() {
  savePassagePreviewProgress({
    status: progress.status,
    currentIndex: progress.currentIndex,
    revealed: { ...progress.revealed },
    contextExpanded: {},
    startedAt: progress.startedAt,
    completedAt: progress.completedAt,
  })
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

onMounted(async () => {
  window.addEventListener('keydown', handleShortcutKeydown, true)
  window.addEventListener('keyup', handleShortcutKeyup, true)
  window.addEventListener('blur', handlePreviewWindowBlur)
  document.addEventListener('visibilitychange', handlePreviewVisibilityChange)
  if (!isPassagePreviewOwnerAuthoritative()) return
  try {
    const ownerProgress = await loadPassagePreviewProgressFromOwner()
    if (ownerProgress) Object.assign(progress, ownerProgress)
  } catch (_error) {
    // The owner path stays fail-closed; the already rendered session remains visible.
  }
})

watch(() => current.value.id, () => {
  resetTransientState()
  void speakWord()
  if (isRevealed.value) void loadSentence()
}, { immediate: true })

watch(shortcutSettingsOpen, async (open) => {
  if (!open) {
    shortcutDialogController.close()
    return
  }
  await nextTick()
  if (!shortcutDialogRoot.value) return
  shortcutDialogController.open(shortcutDialogRoot.value, {
    initialFocus: shortcutDialogInitialFocus.value,
    onRequestClose: closeShortcutSettings,
  })
})

onBeforeUnmount(() => {
  shortcutDialogController.dispose()
  window.removeEventListener('keydown', handleShortcutKeydown, true)
  window.removeEventListener('keyup', handleShortcutKeyup, true)
  window.removeEventListener('blur', handlePreviewWindowBlur)
  document.removeEventListener('visibilitychange', handlePreviewVisibilityChange)
  translationQueue.dispose()
  resetTransientState()
})
</script>
