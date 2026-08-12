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
      </div>
    </header>

    <section v-if="completed" class="srs-review-state passage-preview-complete" aria-live="polite">
      <h2>{{ graduatedCount }} 个词已进入复习队列</h2>
      <p>
        本次考察完成；{{ notGraduatedCount ? `${notGraduatedCount} 个词需要下次再次考察。` : '通过的词现在可以在今日复习中看到。' }}
      </p>
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
        <button type="button" class="passage-preview-rating is-again" :disabled="saving" @click="rate('again')">忘记了</button>
        <button type="button" class="passage-preview-rating is-hard" :disabled="saving" @click="rate('hard')">有点困难</button>
        <button type="button" class="passage-preview-rating is-good" :disabled="saving" @click="rate('good')">想起来了</button>
        <button type="button" class="passage-preview-rating is-easy" :disabled="saving" @click="rate('easy')">很熟</button>
      </footer>
    </template>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { createAriaAmericanPronunciationService } from '../../services/pronunciation/aria-american-pronunciation.js'

const props = defineProps({
  items: { type: Array, required: true },
  coordinator: { type: Object, required: true },
})
const emit = defineEmits(['close'])

const currentIndex = ref(0)
const completed = ref(false)
const saving = ref(false)
const answerRevealed = ref(false)
const errorMessage = ref('')
const graduatedCount = ref(0)
const notGraduatedCount = ref(0)
const startedAt = ref(Date.now())
const playbackPhase = ref('')
const pronunciation = createAriaAmericanPronunciationService()

const currentCheck = computed(() => props.items[currentIndex.value] || {})
const current = computed(() => currentCheck.value.item || currentCheck.value)
const sentence = computed(() => (
  current.value.previewContext?.sentence
  || current.value.realSentence?.sentence
  || ''
))
const highlightedSentence = computed(() => splitTarget(sentence.value, current.value.word || current.value.lemma))

async function rate(rating) {
  if (saving.value || !currentCheck.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    const result = await props.coordinator.recordDelayedCheck(currentCheck.value, {
      rating,
      answerRevealedBeforeRating: answerRevealed.value,
      durationMs: Math.max(0, Date.now() - startedAt.value),
      activeDurationMs: Math.max(0, Date.now() - startedAt.value),
    })
    if (result.graduated) graduatedCount.value += 1
    else notGraduatedCount.value += 1
    if (currentIndex.value >= props.items.length - 1) {
      completed.value = true
    } else {
      currentIndex.value += 1
      resetCurrent()
    }
  } catch (error) {
    errorMessage.value = error?.message || '考察记录失败，请重试。'
  } finally {
    saving.value = false
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

onBeforeUnmount(() => pronunciation.stop())
</script>
