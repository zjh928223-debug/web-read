<template>
  <main class="srs-review-page passage-preview-page passage-preview-check-page is-overlay">
    <header class="srs-review-header">
      <button class="srs-review-back" type="button" aria-label="返回阅读器" @click="close">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
        返回
      </button>
      <div class="srs-review-heading passage-preview-source">
        <p>剑桥雅思 · 延迟考察</p>
      </div>
      <div class="passage-preview-header-meta">
        <p class="srs-review-progress" aria-live="polite">待考察 {{ completed ? items.length : currentIndex + 1 }} / {{ items.length }}</p>
        <button class="passage-preview-shortcut-open" type="button" aria-label="打开延迟考察快捷键" @click="shortcutHelpOpen = true">快捷键</button>
      </div>
    </header>

    <section v-if="completed" class="srs-review-state passage-preview-complete" aria-live="polite">
      <h2>{{ pendingSaveCount ? '考察完成，正在保存…' : `${graduatedCount} 个词已进入复习队列` }}</h2>
      <p>
        {{ pendingSaveCount ? `还有 ${pendingSaveCount} 条记录在后台保存。` : `本次考察完成；${notGraduatedCount ? `${notGraduatedCount} 个词需要下次再次考察。` : '通过的词现在可以在今日复习中看到。'}` }}
      </p>
      <p v-if="errorMessage" class="srs-review-inline-notice passage-preview-check-error" role="alert">{{ errorMessage }}</p>
      <button type="button" class="srs-review-retry" @click="close">返回阅读器</button>
    </section>

    <template v-else>
      <div :key="current.id || current.lemma" class="srs-review-content passage-preview-content passage-preview-check-content">
        <article class="srs-review-word-panel passage-preview-word-panel" aria-label="待考察单词">
          <div class="passage-preview-word-content">
            <p class="passage-preview-step-label">24 小时后考察</p>
            <div class="srs-review-word-line passage-preview-word-line">
              <button
                class="srs-review-speaker"
                :class="{ 'is-playing': playbackPhase === 'word' }"
                type="button"
                :aria-label="`朗读 ${current.word || current.lemma}`"
                @click="speakWord"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                  <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" />
                </svg>
              </button>
              <h2>{{ current.word || current.lemma }}</h2>
            </div>
            <p v-if="current.pos" class="passage-preview-pos">{{ current.pos }}</p>
            <p class="passage-preview-check-hint">先回忆这个词在原句里的意思，再选择熟悉程度。</p>
          </div>
        </article>

        <article class="srs-review-context passage-preview-context" aria-label="待考察原句">
          <h2>原始语境</h2>
          <div class="passage-preview-context-body">
            <section v-if="sentence" class="passage-preview-real-sentence">
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
                  aria-label="朗读原始语境"
                  @click="speakSentence"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                    <path d="M15 9.5a4 4 0 0 1 0 5" />
                  </svg>
                </button>
              </div>
            </section>
            <p v-else class="passage-preview-sentence-state passage-preview-sentence-state--empty">
              这个词暂时没有可用的原始语境，因此不会进入考察。
            </p>
          </div>
          <div class="passage-preview-check-answer">
            <button v-if="!answerRevealed" type="button" class="passage-preview-secondary" @click="revealAnswer">
              查看答案（本次不计入毕业）
            </button>
            <p v-else class="passage-preview-check-answer-text">
              {{ current.primaryMeaningZh || '暂无中文义项' }}
            </p>
          </div>
        </article>
      </div>

      <p v-if="errorMessage" class="srs-review-inline-notice passage-preview-check-error" role="alert">{{ errorMessage }}</p>
      <footer class="srs-review-actions passage-preview-actions passage-preview-check-actions" aria-label="延迟考察评分">
        <button type="button" class="passage-preview-rating is-again" aria-keyshortcuts="1" :disabled="ratingTransition" @click="rate('again')">忘记</button>
        <button type="button" class="passage-preview-rating is-hard" aria-keyshortcuts="2" :disabled="ratingTransition" @click="rate('hard')">困难</button>
        <button type="button" class="passage-preview-rating is-good" aria-keyshortcuts="3" :disabled="ratingTransition" @click="rate('good')">一般</button>
        <button type="button" class="passage-preview-rating is-easy" aria-keyshortcuts="4" :disabled="ratingTransition" @click="rate('easy')">容易</button>
      </footer>
    </template>

    <div v-if="shortcutHelpOpen" class="passage-preview-shortcut-backdrop" @pointerdown.self="shortcutHelpOpen = false">
      <section class="passage-preview-shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="passage-preview-check-shortcut-title">
        <header>
          <div><p>延迟考察</p><h2 id="passage-preview-check-shortcut-title">快捷键</h2></div>
          <button type="button" aria-label="关闭快捷键" @click="shortcutHelpOpen = false">×</button>
        </header>
        <div class="passage-preview-shortcut-list passage-preview-check-shortcut-list">
          <div v-for="shortcut in shortcutHelpItems" :key="shortcut.key" class="passage-preview-shortcut-row">
            <span>{{ shortcut.label }}</span><kbd>{{ shortcut.key }}</kbd>
          </div>
        </div>
        <footer><button type="button" class="is-primary" @click="shortcutHelpOpen = false">完成</button></footer>
      </section>
    </div>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { createAriaAmericanPronunciationService } from '../../services/pronunciation/aria-american-pronunciation.js'
import { isEditableKeyboardTarget } from './passage-preview-shortcuts.js'

const props = defineProps({
  items: { type: Array, required: true },
  coordinator: { type: Object, required: true },
})
const emit = defineEmits(['close'])

const currentIndex = ref(0)
const completed = ref(false)
const saving = ref(false)
const pendingSaveCount = ref(0)
const ratingTransition = ref(false)
const answerRevealed = ref(false)
const errorMessage = ref('')
const graduatedCount = ref(0)
const notGraduatedCount = ref(0)
const startedAt = ref(Date.now())
const playbackPhase = ref('')
const shortcutHelpOpen = ref(false)
const pronunciation = createAriaAmericanPronunciationService()
const wordShortcut = loadReviewShortcut('srs.review.wordShortcut.v1', 'r')
const sentenceShortcut = loadReviewShortcut('srs.review.playbackShortcut.v1', 's')
const shortcutHelpItems = [
  { key: 'Space', label: '查看答案' },
  { key: wordShortcut.toUpperCase(), label: '播放单词' },
  { key: sentenceShortcut.toUpperCase(), label: '播放原句' },
  { key: '1', label: '忘记' }, { key: '2', label: '困难' },
  { key: '3', label: '一般' }, { key: '4', label: '容易' },
]
let writeQueue = Promise.resolve()

const currentCheck = computed(() => props.items[currentIndex.value] || {})
const current = computed(() => currentCheck.value.item || currentCheck.value)
const sentence = computed(() => (
  current.value.previewContext?.sentence
  || current.value.realSentence?.sentence
  || ''
))
const highlightedSentence = computed(() => splitTarget(sentence.value, current.value.word || current.value.lemma))

function rate(rating) {
  if (ratingTransition.value || !currentCheck.value) return
  ratingTransition.value = true
  errorMessage.value = ''
  const pendingRating = {
    check: currentCheck.value,
    rating,
    answerRevealedBeforeRating: answerRevealed.value,
    durationMs: Math.max(0, Date.now() - startedAt.value),
  }
  advanceAfterRating(pendingRating)
  queueMicrotask(() => { ratingTransition.value = false })
  pendingSaveCount.value += 1
  saving.value = true
  writeQueue = writeQueue.then(async () => {
    const result = await props.coordinator.recordDelayedCheck(pendingRating.check, {
      rating,
      answerRevealedBeforeRating: pendingRating.answerRevealedBeforeRating,
      durationMs: pendingRating.durationMs,
      activeDurationMs: pendingRating.durationMs,
    })
    if (result.graduated) graduatedCount.value += 1
    else notGraduatedCount.value += 1
  }).catch((error) => {
    errorMessage.value = error?.message || '考察记录失败，请重试。'
  }).finally(() => {
    pendingSaveCount.value = Math.max(0, pendingSaveCount.value - 1)
    saving.value = pendingSaveCount.value > 0
  })
}

function advanceAfterRating(_pendingRating) {
  if (currentIndex.value >= props.items.length - 1) completed.value = true
  else {
    currentIndex.value += 1
    resetCurrent()
  }
}

function revealAnswer() {
  answerRevealed.value = true
}

async function speakWord() {
  await speak(current.value.word || current.value.lemma, 'word')
}

async function speakSentence() {
  if (sentence.value) await speak(sentence.value, 'sentence')
}

async function speak(text, phase) {
  pronunciation.stop()
  playbackPhase.value = phase
  try {
    await pronunciation.speak(text)
  } catch (error) {
    if (error?.name !== 'AbortError') errorMessage.value = '发音服务暂不可用。'
  } finally {
    if (playbackPhase.value === phase) playbackPhase.value = ''
  }
}

function resetCurrent() {
  answerRevealed.value = false
  errorMessage.value = ''
  startedAt.value = Date.now()
  pronunciation.stop()
  playbackPhase.value = ''
}

function close() {
  pronunciation.stop()
  emit('close')
}

function handleShortcutKeydown(event) {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || isEditableKeyboardTarget(event.target)) return
  const key = String(event.key || '').toLowerCase()
  if (event.code === 'Space' || event.key === ' ') { event.preventDefault(); if (!answerRevealed.value) revealAnswer(); return }
  if (key === wordShortcut) { event.preventDefault(); void speakWord(); return }
  if (key === sentenceShortcut) { event.preventDefault(); void speakSentence(); return }
  const rating = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' }[event.key]
  if (rating) { event.preventDefault(); rate(rating) }
}

function loadReviewShortcut(key, fallback) {
  try {
    const value = String(localStorage.getItem(key) || '').trim().toLowerCase()
    return /^[a-z0-9]$/.test(value) ? value : fallback
  } catch (_error) { return fallback }
}

function splitTarget(text, target) {
  const sentenceText = String(text || '')
  const word = String(target || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  if (!sentenceText || !word) return [{ text: sentenceText, target: false }]
  const expression = new RegExp(`(?<![A-Za-z])(${word})(?![A-Za-z])`, 'igu')
  const exactTarget = new RegExp(`^${word}$`, 'iu')
  return sentenceText.split(expression).filter(Boolean).map((part) => ({
    text: part,
    target: exactTarget.test(part),
  }))
}

onMounted(() => window.addEventListener('keydown', handleShortcutKeydown, true))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleShortcutKeydown, true)
  pronunciation.stop()
})
</script>
