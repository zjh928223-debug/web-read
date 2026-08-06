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
      <p class="srs-review-progress" aria-live="polite">预习 {{ currentIndex + 1 }} / {{ items.length }}</p>
    </header>

    <section v-if="progress.status === 'completed'" class="srs-review-state passage-preview-complete" aria-live="polite">
      <h2>{{ items.length }}词首次接触完成</h2>
      <p>今天到这里即可；是否再出现由复习模型根据后续反馈决定。</p>
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
              <h2>{{ current.word }}</h2>
            </div>
            <div v-if="isRevealed" class="passage-preview-learning-content">
              <p v-if="current.phonetic" class="srs-review-phonetic">{{ current.phonetic }}</p>
              <p v-if="current.pos" class="passage-preview-pos">{{ current.pos }}</p>
              <div class="passage-preview-primary-sense">
                <span>{{ current.primarySenseStatus === 'resolved' ? '主要意思' : '主要义建议' }}</span>
                <p class="passage-preview-meaning">{{ current.primaryMeaningZh }}</p>
                <small v-if="current.primarySenseStatus !== 'resolved'">尚未达到多来源义项共识，不代表固定使用比例。</small>
              </div>
            </div>
            <p v-if="pronunciationNotice" class="srs-review-inline-notice" role="status">{{ pronunciationNotice }}</p>
          </div>
        </article>

        <article class="srs-review-context passage-preview-context" aria-label="简短真实语境">
          <h2>简短真实语境</h2>
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
              <p v-if="realSentence.translationZh" class="passage-preview-sentence-translation">{{ realSentence.translationZh }}</p>
              <p v-else class="passage-preview-sentence-translation passage-preview-sentence-translation--missing">
                {{ missingTranslationMessage }}
              </p>
              <p class="passage-preview-attribution">
                {{ sourceKindLabel }} ·
                <a v-if="realSentence.source.url" :href="realSentence.source.url" target="_blank" rel="noreferrer">{{ realSentence.source.name }} #{{ realSentence.source.recordId }}</a>
                <span v-else>{{ realSentence.source.name }} #{{ realSentence.source.recordId }}</span>
                · {{ realSentence.source.license }}
                <template v-if="realSentence.source.ref"> · {{ realSentence.source.ref }}</template>
                <template v-if="realSentence.source.owner"> · {{ realSentence.source.ownerLabel || '作者' }} {{ realSentence.source.owner }}</template>
              </p>
              <a
                v-if="realSentence.source.poweredByLogoUrl"
                class="passage-preview-wordnik-badge"
                :href="realSentence.source.url"
                target="_blank"
                rel="noreferrer"
                aria-label="Powered by Wordnik"
              >
                <img :src="realSentence.source.poweredByLogoUrl" width="132" height="18" alt="Powered by Wordnik">
              </a>
            </section>
            <div v-else class="passage-preview-sentence-state passage-preview-sentence-state--empty" role="status">
              <p>{{ sentenceMessage || '暂未找到合格真实短句。' }}</p>
              <small>不会用 AI 现编句或剑雅长段落自动代替。</small>
              <button v-if="sentenceStatus === 'error'" type="button" @click="loadSentence">重试真实句源</button>
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
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { createAriaAmericanPronunciationService } from '../../services/pronunciation/aria-american-pronunciation.js'
import { findPreviewSentence, REAL_SENTENCE_STATUS } from './preview-sentence-source.js'
import { loadPassagePreviewProgress, savePassagePreviewProgress } from './passage-preview-storage.js'

const props = defineProps({ items: { type: Array, required: true } })
const emit = defineEmits(['close', 'item-enriched'])
const progress = reactive(loadPassagePreviewProgress())
const pronunciation = createAriaAmericanPronunciationService()
const playbackPhase = ref('')
const pronunciationNotice = ref('')
const sentenceLoading = ref(false)
const sentenceStatus = ref('')
const sentenceMessage = ref('')
const loadedSentence = ref(null)
let sentenceRequest = 0
let sentenceAbortController = null

if (progress.status === 'not_started' || progress.currentIndex >= props.items.length) {
  progress.status = 'in_progress'
  progress.currentIndex = Math.min(progress.currentIndex, props.items.length - 1)
  progress.startedAt ||= new Date().toISOString()
  persist()
}

const currentIndex = computed(() => Math.min(progress.currentIndex, props.items.length - 1))
const current = computed(() => props.items[currentIndex.value] || {})
const batchTitle = computed(() => current.value.batchTitle || `${props.items.length}词首次接触`)
const isRevealed = computed(() => progress.revealed[current.value.id] === true)
const realSentence = computed(() => current.value.realSentence || loadedSentence.value)
const highlightedSentence = computed(() => splitTarget(
  realSentence.value?.sentence,
  realSentence.value?.matchedLemma || current.value.lemma || current.value.word,
))
const missingTranslationMessage = computed(() => realSentence.value?.source?.name === 'Wordnik'
  ? 'Wordnik 暂不提供整句中文翻译；当前目标主要义见左侧。'
  : '该本地英文例句暂无整句中文翻译；当前目标主要义见左侧。')
const sourceKindLabel = computed(() => realSentence.value?.source?.kind === 'authentic_excerpt'
  ? '真实出版摘句来源'
  : realSentence.value?.providerId === 'local-warehouse'
    ? '本地词典例句来源'
    : '真实例句来源')

function revealLearningContent() {
  progress.revealed[current.value.id] = true
  persist()
  void loadSentence()
}

async function loadSentence() {
  if (current.value.realSentence) return
  const request = ++sentenceRequest
  sentenceAbortController?.abort()
  sentenceAbortController = new AbortController()
  sentenceLoading.value = true
  sentenceMessage.value = ''
  sentenceStatus.value = ''
  const result = await findPreviewSentence(current.value, { signal: sentenceAbortController.signal })
    .catch((error) => error?.name === 'AbortError' ? null : ({ status: 'error', message: '真实短句加载失败。' }))
  if (!result || request !== sentenceRequest) return
  sentenceLoading.value = false
  sentenceStatus.value = result.status
  sentenceMessage.value = result.message || ''
  if (result.status === REAL_SENTENCE_STATUS.READY) {
    loadedSentence.value = result
    if (result.persistence !== 'none') emit('item-enriched', { id: current.value.id, realSentence: result })
  }
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

function resetTransientState() {
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
  const expression = new RegExp(`(${word}(?:s|es|ed|ing)?)`, 'igu')
  const exactTarget = new RegExp(`^${word}(?:s|es|ed|ing)?$`, 'iu')
  return text.split(expression).filter(Boolean).map((part) => ({
    text: part,
    target: exactTarget.test(part),
  }))
}

watch(() => current.value.id, () => {
  resetTransientState()
  void speakWord()
  if (isRevealed.value) void loadSentence()
}, { immediate: true })

onBeforeUnmount(resetTransientState)
</script>
