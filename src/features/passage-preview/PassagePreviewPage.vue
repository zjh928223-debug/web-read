<template>
  <main class="srs-review-page passage-preview-page is-overlay">
    <header class="srs-review-header">
      <button class="srs-review-back" type="button" aria-label="返回阅读器" @click="close">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
        返回
      </button>
      <div class="srs-review-heading passage-preview-source">
        <p>剑19 · Test 1 · Passage 1</p>
      </div>
      <p class="srs-review-progress" aria-live="polite">预习 {{ currentIndex + 1 }} / {{ items.length }}</p>
    </header>

    <section v-if="progress.status === 'completed'" class="srs-review-state passage-preview-complete" aria-live="polite">
      <h2>5词预习完成</h2>
      <button type="button" class="srs-review-retry" @click="close">返回阅读器</button>
    </section>

    <template v-else>
      <div :key="current.id" class="srs-review-content passage-preview-content">
        <article class="srs-review-word-panel passage-preview-word-panel" aria-label="预习单词">
          <div class="passage-preview-word-content">
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
              <h2>{{ current.word }}</h2>
            </div>
            <div v-if="isRevealed" class="passage-preview-learning-content">
              <p v-if="current.phonetic" class="srs-review-phonetic">{{ current.phonetic }}</p>
              <p v-if="current.pos" class="passage-preview-pos">{{ current.pos }}</p>
              <p class="passage-preview-meaning">{{ current.targetMeaningZh }}</p>
            </div>
            <p v-if="pronunciationNotice" class="srs-review-inline-notice" role="status">{{ pronunciationNotice }}</p>
          </div>
        </article>

        <article class="srs-review-context passage-preview-context" aria-label="核心语境">
          <h2>核心语境</h2>
          <div v-if="isRevealed" class="passage-preview-context-body">
            <section class="passage-preview-phrase-block" aria-label="核心短语">
              <p class="passage-preview-phrase">{{ current.focusPhraseEn }}</p>
              <p v-if="translationsHeld" class="passage-preview-translation">{{ current.focusPhraseZh }}</p>
            </section>

            <div class="passage-preview-reading-toolbar">
              <button
                class="srs-review-play-sequence passage-preview-read-context"
                type="button"
                :disabled="Boolean(playbackPhase)"
                @click="readContext"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24"><path class="is-play" d="m8 5 11 7-11 7V5Z" /></svg>
                <span>朗读语境</span>
              </button>
              <small>AI 美式朗读</small>
            </div>

            <ol class="passage-preview-chunks" aria-label="英文核心语义块">
              <li
                v-for="(chunk, index) in current.focusChunks"
                :key="`focus-${index}`"
                :class="{
                  'contains-target': chunk.containsTarget,
                  'is-reading': readingScope === 'focus' && currentChunkIndex === index,
                }"
              >
                <button type="button" :aria-label="`重播英文块 ${index + 1}`" @click="readSingleChunk(chunk, index, 'focus')">
                  <span>{{ chunk.en }}</span>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                    <path d="M15 9.5a4 4 0 0 1 0 5" />
                  </svg>
                </button>
                <p v-if="translationsHeld" class="passage-preview-translation">{{ chunk.zh }}</p>
              </li>
            </ol>

            <button
              class="srs-review-play-sequence passage-preview-context-toggle"
              type="button"
              :aria-expanded="isContextExpanded"
              :aria-keyshortcuts="contextShortcutDisplay"
              @click="toggleContext"
            >
              <span>{{ isContextExpanded ? '收起完整语境' : '查看完整语境' }}</span>
              <kbd>{{ contextShortcutDisplay }}</kbd>
            </button>

            <ol v-if="isContextExpanded" class="passage-preview-chunks is-paragraph" aria-label="完整英文语境">
              <li
                v-for="(chunk, index) in current.paragraphChunks"
                :key="`paragraph-${index}`"
                :class="{
                  'contains-target': chunk.containsTarget,
                  'is-reading': readingScope === 'paragraph' && currentChunkIndex === index,
                }"
              >
                <button type="button" :aria-label="`重播完整语境英文块 ${index + 1}`" @click="readSingleChunk(chunk, index, 'paragraph')">
                  <span>{{ chunk.en }}</span>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                    <path d="M15 9.5a4 4 0 0 1 0 5" />
                  </svg>
                </button>
                <p v-if="translationsHeld" class="passage-preview-translation">{{ chunk.zh }}</p>
              </li>
            </ol>

            <div class="passage-preview-hold-row">
              <button
                class="passage-preview-hold-button"
                :class="{ 'is-held': translationsHeld }"
                type="button"
                :aria-keyshortcuts="translationShortcutDisplay"
                @pointerdown.prevent="beginTranslationHold"
                @pointerup.prevent="endTranslationHold"
                @pointercancel="endTranslationHold"
                @pointerleave="endTranslationHold"
              >
                按住显示中文
                <kbd>{{ translationShortcutDisplay }}</kbd>
              </button>
              <div class="passage-preview-shortcut-settings" aria-label="预习快捷键设置">
                <button type="button" :class="{ 'is-editing': shortcutEditing === 'translation' }" @click="beginShortcutEditing('translation')">
                  中文：<kbd>{{ shortcutEditing === 'translation' ? '…' : translationShortcutDisplay }}</kbd>
                </button>
                <button type="button" :class="{ 'is-editing': shortcutEditing === 'context' }" @click="beginShortcutEditing('context')">
                  完整语境：<kbd>{{ shortcutEditing === 'context' ? '…' : contextShortcutDisplay }}</kbd>
                </button>
              </div>
            </div>
          </div>
          <p v-else class="passage-preview-hidden-note">点击“显示学习内容”后查看英文核心语境</p>
        </article>
      </div>

      <footer class="srs-review-actions passage-preview-actions" aria-label="预习导航">
        <button v-if="!isRevealed" type="button" class="srs-review-reveal" @click="revealLearningContent">
          <span>显示学习内容</span>
        </button>
        <template v-else>
          <button type="button" class="passage-preview-secondary" :disabled="currentIndex === 0" @click="move(-1)">
            <span>上一个</span>
          </button>
          <button type="button" class="srs-review-next" @click="moveNext">
            <span>{{ currentIndex === items.length - 1 ? '完成预习' : '下一词' }}</span>
          </button>
        </template>
      </footer>
    </template>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { createAriaAmericanPronunciationService } from '../../services/pronunciation/aria-american-pronunciation.js'
import {
  loadPassagePreviewProgress,
  savePassagePreviewProgress,
} from './passage-preview-storage.js'
import {
  formatPassagePreviewShortcut,
  isEditableKeyboardTarget,
  loadPassagePreviewShortcuts,
  savePassagePreviewShortcut,
  shortcutFromKeyboardEvent,
} from './passage-preview-shortcuts.js'

const props = defineProps({ items: { type: Array, required: true } })
const emit = defineEmits(['close'])
const progress = reactive(loadPassagePreviewProgress())
const pronunciation = createAriaAmericanPronunciationService()
const shortcuts = reactive(loadPassagePreviewShortcuts())
const translationsHeld = ref(false)
const shortcutEditing = ref('')
const playbackPhase = ref('')
const pronunciationNotice = ref('')
const currentChunkIndex = ref(-1)
const readingScope = ref('')
let playbackRequest = 0

if (progress.status === 'not_started') {
  progress.status = 'in_progress'
  progress.startedAt = new Date().toISOString()
  persist()
}

const currentIndex = computed(() => Math.min(progress.currentIndex, props.items.length - 1))
const current = computed(() => props.items[currentIndex.value] || {})
const isRevealed = computed(() => progress.revealed[current.value.id] === true)
const isContextExpanded = computed(() => progress.contextExpanded[current.value.id] === true)
const translationShortcutDisplay = computed(() => formatPassagePreviewShortcut(shortcuts.translation))
const contextShortcutDisplay = computed(() => formatPassagePreviewShortcut(shortcuts.context))

function revealLearningContent() {
  progress.revealed[current.value.id] = true
  progress.contextExpanded[current.value.id] = false
  persist()
}

function toggleContext() {
  if (!isRevealed.value) return
  endTranslationHold()
  stopPlayback()
  progress.contextExpanded[current.value.id] = !isContextExpanded.value
  persist()
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

async function speakWord() {
  const request = beginPlayback('word')
  try {
    await pronunciation.speak(current.value.word)
  } catch (error) {
    if (request === playbackRequest && error?.name !== 'AbortError') {
      pronunciationNotice.value = error?.message || 'Aria美式发音暂不可用'
    }
  } finally {
    finishPlayback(request)
  }
}

async function readContext() {
  const scope = isContextExpanded.value ? 'paragraph' : 'focus'
  const chunks = scope === 'paragraph' ? current.value.paragraphChunks : current.value.focusChunks
  const request = beginPlayback('context')
  readingScope.value = scope
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      if (request !== playbackRequest) return
      currentChunkIndex.value = index
      await pronunciation.speak(chunks[index].en)
    }
  } catch (error) {
    if (request === playbackRequest && error?.name !== 'AbortError') {
      pronunciationNotice.value = error?.message || 'Aria美式发音暂不可用'
    }
  } finally {
    finishPlayback(request)
  }
}

async function readSingleChunk(chunk, index, scope) {
  const request = beginPlayback('context')
  readingScope.value = scope
  currentChunkIndex.value = index
  try {
    await pronunciation.speak(chunk.en)
  } catch (error) {
    if (request === playbackRequest && error?.name !== 'AbortError') {
      pronunciationNotice.value = error?.message || 'Aria美式发音暂不可用'
    }
  } finally {
    finishPlayback(request)
  }
}

function beginPlayback(phase) {
  stopPlayback()
  const request = playbackRequest
  playbackPhase.value = phase
  pronunciationNotice.value = ''
  return request
}

function finishPlayback(request) {
  if (request !== playbackRequest) return
  playbackPhase.value = ''
  currentChunkIndex.value = -1
  readingScope.value = ''
}

function stopPlayback() {
  playbackRequest += 1
  pronunciation.stop()
  playbackPhase.value = ''
  currentChunkIndex.value = -1
  readingScope.value = ''
}

function beginTranslationHold() {
  if (isRevealed.value && !shortcutEditing.value) translationsHeld.value = true
}

function endTranslationHold() {
  translationsHeld.value = false
}

function beginShortcutEditing(kind) {
  endTranslationHold()
  shortcutEditing.value = kind
}

function handleKeyDown(event) {
  if (shortcutEditing.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') {
      shortcutEditing.value = ''
      return
    }
    const shortcut = shortcutFromKeyboardEvent(event)
    if (!shortcut) return
    shortcuts[shortcutEditing.value] = savePassagePreviewShortcut(shortcutEditing.value, shortcut)
    shortcutEditing.value = ''
    return
  }
  if (isEditableKeyboardTarget(event.target)) return
  const shortcut = shortcutFromKeyboardEvent(event)
  if (shortcut === shortcuts.translation) {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!event.repeat) beginTranslationHold()
  } else if (shortcut === shortcuts.context && !event.repeat && isRevealed.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    toggleContext()
  }
}

function handleKeyUp(event) {
  if (isEditableKeyboardTarget(event.target)) return
  if (shortcutFromKeyboardEvent(event) === shortcuts.translation) {
    event.preventDefault()
    event.stopImmediatePropagation()
    endTranslationHold()
  }
}

function handleVisibilityChange() {
  if (document.visibilityState !== 'visible') resetTransientState()
}

function resetTransientState() {
  endTranslationHold()
  shortcutEditing.value = ''
  stopPlayback()
  pronunciationNotice.value = ''
}

function persist() {
  savePassagePreviewProgress({
    status: progress.status,
    currentIndex: progress.currentIndex,
    revealed: { ...progress.revealed },
    contextExpanded: { ...progress.contextExpanded },
    startedAt: progress.startedAt,
    completedAt: progress.completedAt,
  })
}

function close() {
  resetTransientState()
  emit('close')
}

watch(
  () => current.value.id,
  () => {
    if (progress.status !== 'completed' && current.value.word) speakWord()
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown, true)
  window.addEventListener('keyup', handleKeyUp, true)
  window.addEventListener('blur', resetTransientState)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => {
  resetTransientState()
  window.removeEventListener('keydown', handleKeyDown, true)
  window.removeEventListener('keyup', handleKeyUp, true)
  window.removeEventListener('blur', resetTransientState)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>
