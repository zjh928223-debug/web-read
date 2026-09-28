<script setup>
import { computed, nextTick, ref } from 'vue'
import Button from '../../../src/components/ui/button/Button.vue'
import Input from '../../../src/components/ui/input/Input.vue'

const sentences = [
  {
    time: '00:00',
    parts: [
      { text: 'Most days, we move through the world without really noticing it.', chunk: true },
    ],
    translation: '大多数日子里，我们穿行于世界，却并未真正留意它。',
  },
  {
    time: '00:18',
    parts: [
      { text: 'But every so often, something ', chunk: true },
      { text: 'ordinary', chunk: true, marked: true },
      { text: ' asks us to slow down and pay attention.', chunk: true },
    ],
    translation: '但偶尔，一件平常的小事，会让我们慢下来，认真留意。',
  },
  {
    time: '00:39',
    parts: [
      { text: 'A familiar voice. The light across a kitchen table.', chunk: true },
      { text: ' The quiet rhythm of a place we know by heart.', chunk: false },
    ],
    translation: '一个熟悉的声音，洒在厨房桌上的光，还有熟悉之地静静的节奏。',
  },
  {
    time: '01:01',
    parts: [
      { text: 'These moments do not ask us to do more.', chunk: true },
      { text: ' They simply ask us to be here.', chunk: true },
    ],
    translation: '这些瞬间不要求我们多做什么，只希望我们在场。',
  },
  {
    time: '01:22',
    parts: [
      { text: 'Listening is a way of making room for the world,', chunk: true },
      { text: ' one small detail at a time.', chunk: true },
    ],
    translation: '倾听，是为世界留出空间，一次留意一个小小的细节。',
  },
  {
    time: '01:47',
    parts: [
      { text: 'And perhaps that is where understanding begins:', chunk: true },
      { text: ' with the simple decision to notice.', chunk: true },
    ],
    translation: '也许理解正是这样开始的：从决定认真留意的那一刻起。',
  },
]

const theme = ref('light')
const currentIndex = ref(1)
const isPlaying = ref(false)
const selectedSpeed = ref('1×')
const aiMode = ref(true)
const showTranslation = ref(true)
const follow = ref(true)
const focus = ref(false)
const sentenceRefs = ref([])
const toast = ref('')
const toastVisible = ref(false)
const settingsDialog = ref(null)
const settingsTrigger = ref(null)
const appliedKeys = ref({ previous: 'ArrowLeft', next: 'ArrowRight' })
const draftKeys = ref({ previous: 'ArrowLeft', next: 'ArrowRight' })
const appliedNotice = ref('')
let toastTimer

const currentSentence = computed(() => sentences[currentIndex.value])
const progressWidth = computed(() => `${(currentIndex.value / (sentences.length - 1)) * 100}%`)
const themeLabel = computed(() => (theme.value === 'light' ? '切换深色' : '切换浅色'))

function setSentenceRef(element, index) {
  if (element) sentenceRefs.value[index] = element
}

function notify(message) {
  toast.value = message
  toastVisible.value = true
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastVisible.value = false
  }, 3200)
}

function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme.value
}

function togglePlayback() {
  isPlaying.value = !isPlaying.value
  notify(isPlaying.value ? '播放状态演示；样稿没有音频。' : '已暂停演示。')
}

function goToSentence(index) {
  if (index < 0 || index >= sentences.length) return
  currentIndex.value = index
  if (follow.value) {
    nextTick(() => sentenceRefs.value[index]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
}

function stepSentence(delta) {
  goToSentence(currentIndex.value + delta)
}

function selectSpeed(speed) {
  selectedSpeed.value = speed
  notify(`倍速已切换为 ${speed}；样稿只更新显示。`)
}

function openSettings() {
  draftKeys.value = { ...appliedKeys.value }
  appliedNotice.value = ''
  settingsDialog.value?.showModal()
}

function closeSettings() {
  settingsDialog.value?.close()
}

function handleSettingsClose() {
  draftKeys.value = { ...appliedKeys.value }
  nextTick(() => settingsTrigger.value?.focus())
}

function applySettings() {
  appliedKeys.value = { ...draftKeys.value }
  appliedNotice.value = '已应用到预览 · 仅在本次页面会话内生效'
  notify(`快捷键已应用：${appliedKeys.value.previous} / ${appliedKeys.value.next}`)
  settingsDialog.value?.close()
}

function showMarkedWord(word) {
  notify(`已标记词：${word} · 只演示视觉状态。`)
}

function displayKey(key) {
  return key === 'ArrowLeft' ? '←' : key === 'ArrowRight' ? '→' : key
}
</script>

<template>
  <div class="rw-preview">
    <header class="rw-topbar">
      <div class="rw-topbar-inner">
        <a class="rw-brand" href="#reading" aria-label="返回阅读正文">
          <span class="rw-brand-mark" aria-hidden="true">R</span>
          <span>Read<span class="rw-brand-dot">.</span></span>
        </a>

        <span class="rw-topbar-divider" aria-hidden="true"></span>

        <div class="rw-article-identity">
          <span class="rw-eyebrow">READ / EXAMPLE</span>
          <strong>The Quiet Art of Noticing</strong>
        </div>

        <span class="rw-preview-stamp">样式预览 · 示例数据</span>

        <div class="rw-topbar-actions" aria-label="页面操作">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class="preview-button preview-button--ghost rw:rounded-full"
            @click="notify('素材入口只展示布局；样稿不读取真实素材。')"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H10l2 2h5.5A2.5 2.5 0 0 1 20 8.5V18H4Z" /></svg>
            素材
          </Button>
          <button ref="settingsTrigger" class="preview-button preview-button--outline" type="button" @click="openSettings">
            设置
          </button>
          <button class="rw-theme-toggle" type="button" :aria-label="themeLabel" :title="themeLabel" @click="toggleTheme">
            <svg v-if="theme === 'light'" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v2m0 14v2M3 12h2m14 0h2m-3.36-6.36-1.42 1.42M6.78 17.22l-1.42 1.42m0-13.42 1.42 1.42m11.86 10.58 1.42 1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" /></svg>
            <svg v-else aria-hidden="true" viewBox="0 0 24 24"><path d="M20.5 14a9 9 0 0 1-10.5-10.5A9 9 0 1 0 20.5 14Z" /></svg>
          </button>
        </div>
      </div>
    </header>

    <main id="reading" class="rw-reader-main" tabindex="-1">
      <section class="rw-control-panel" aria-label="阅读控制区">
        <div class="rw-control-primary">
          <div class="rw-transport-controls" role="group" aria-label="句子播放控制">
            <Button
              variant="outline"
              size="sm"
              type="button"
              class="preview-button preview-button--outline rw:rounded-full"
              :disabled="currentIndex === 0"
              :aria-label="`上一句 · ${appliedKeys.previous}`"
              @click="stepSentence(-1)"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5v14m14-14-10 7 10 7Z" /></svg>
              上一句
            </Button>
            <Button
              variant="default"
              size="sm"
              type="button"
              class="preview-button preview-button--primary rw:rounded-full"
              :aria-label="isPlaying ? '暂停演示' : '播放演示'"
              :aria-pressed="isPlaying"
              @click="togglePlayback"
            >
              <svg v-if="!isPlaying" aria-hidden="true" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z" /></svg>
              <svg v-else aria-hidden="true" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg>
              {{ isPlaying ? '暂停' : '播放' }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              class="preview-button preview-button--outline rw:rounded-full"
              :disabled="currentIndex === sentences.length - 1"
              :aria-label="`下一句 · ${appliedKeys.next}`"
              @click="stepSentence(1)"
            >
              下一句
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 5v14M5 5l10 7-10 7Z" /></svg>
            </Button>
          </div>

          <div class="rw-progress-block" aria-label="示例播放进度">
            <div class="rw-progress-label">
              <span>示例播放 · 第 {{ currentIndex + 1 }} / {{ sentences.length }} 句</span>
              <span>{{ currentSentence.time }} <span class="rw-progress-total">/ 02:12</span></span>
            </div>
            <div class="rw-progress-rail" role="progressbar" :aria-valuenow="currentIndex + 1" :aria-valuemin="1" :aria-valuemax="sentences.length" :aria-valuetext="`${currentSentence.time}，第 ${currentIndex + 1} 句`">
              <span :style="{ width: progressWidth }"></span>
            </div>
          </div>
        </div>

        <div class="rw-control-divider" aria-hidden="true"></div>

        <div class="rw-control-tools">
          <div class="rw-tool-group" role="group" aria-label="播放倍速">
            <span class="rw-group-label">倍速</span>
            <div class="rw-pill-row">
              <button
                v-for="speed in ['0.75×', '1×', '1.25×']"
                :key="speed"
                class="rw-toggle-pill"
                :class="{ 'is-selected': selectedSpeed === speed }"
                type="button"
                :aria-pressed="selectedSpeed === speed"
                @click="selectSpeed(speed)"
              >{{ speed }}</button>
            </div>
          </div>

          <div class="rw-tool-group rw-tool-group--reading" role="group" aria-label="阅读方式">
            <span class="rw-group-label">阅读方式</span>
            <div class="rw-pill-row">
              <button class="rw-toggle-pill" :class="{ 'is-selected': follow }" type="button" :aria-pressed="follow" @click="follow = !follow">跟随</button>
              <button class="rw-toggle-pill" :class="{ 'is-selected': aiMode }" type="button" :aria-pressed="aiMode" @click="aiMode = !aiMode">AI 切分</button>
              <button class="rw-toggle-pill" :class="{ 'is-selected': showTranslation }" type="button" :aria-pressed="showTranslation" @click="showTranslation = !showTranslation">中文</button>
              <button class="rw-toggle-pill" :class="{ 'is-selected': focus }" type="button" :aria-pressed="focus" @click="focus = !focus">聚焦</button>
            </div>
          </div>

          <span class="rw-mode-note">{{ aiMode ? '示例分块' : '逐句阅读' }} · {{ showTranslation ? '译文显示' : '译文隐藏' }}</span>
        </div>
      </section>

      <section class="rw-document-heading" aria-labelledby="document-title">
        <div class="rw-document-meta"><span class="rw-eyebrow">LISTEN &amp; READ</span><span aria-hidden="true">·</span><span>示例文章</span><span aria-hidden="true">·</span><span>02:12</span></div>
        <div class="rw-document-title-row">
          <h1 id="document-title">The Quiet Art of Noticing</h1>
          <span class="rw-mark-summary"><span class="rw-mark-dot" aria-hidden="true"></span>已标记 1</span>
        </div>
        <p>一篇关于放慢脚步、重新听见日常细节的短文。当前页面只使用本地示例数据。</p>
      </section>

      <section class="rw-transcript" aria-label="示例正文">
        <article
          v-for="(sentence, index) in sentences"
          :key="sentence.time"
          :ref="element => setSentenceRef(element, index)"
          class="rw-sentence-row"
          :class="{ 'is-current': currentIndex === index, 'is-muted': focus && currentIndex !== index }"
          :aria-current="currentIndex === index ? 'true' : undefined"
        >
          <button class="rw-timestamp" type="button" :aria-label="`跳到第 ${index + 1} 句，${sentence.time}`" @click="goToSentence(index)">{{ sentence.time }}</button>
          <div class="rw-sentence-content">
            <p class="rw-english-line">
              <template v-for="(part, partIndex) in sentence.parts" :key="`${sentence.time}-${partIndex}`">
                <button
                  v-if="part.marked"
                  class="rw-marked-word"
                  type="button"
                  :aria-label="`查看标记词 ${part.text}`"
                  @click="showMarkedWord(part.text)"
                >{{ part.text }}</button>
                <span v-else :class="{ 'rw-chunk-token': aiMode && part.chunk }">{{ part.text }}</span>
              </template>
            </p>
            <p v-if="showTranslation" class="rw-translation-line">{{ sentence.translation }}</p>
          </div>
        </article>
      </section>

      <footer class="rw-document-footer">
        <span>样式预览 · 示例数据 · 不连接产品运行时</span>
        <span class="rw-current-key-hint"><kbd>{{ displayKey(appliedKeys.previous) }}</kbd><kbd>{{ displayKey(appliedKeys.next) }}</kbd> 跳句</span>
      </footer>
    </main>

    <dialog ref="settingsDialog" class="rw-settings-dialog" aria-labelledby="settings-title" @close="handleSettingsClose">
      <form class="rw-dialog-form" @submit.prevent>
        <div class="rw-dialog-header">
          <div>
            <span class="rw-eyebrow">PREVIEW SETTINGS</span>
            <h2 id="settings-title">阅读设置</h2>
          </div>
          <button class="rw-dialog-close" type="button" aria-label="关闭设置" @click="closeSettings">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </div>

        <div class="rw-dialog-body">
          <p class="rw-dialog-intro">调整快捷键后点击“应用到预览”。修改只存在于当前页面内，刷新会恢复默认值。</p>
          <div class="rw-shortcut-list">
            <label class="rw-shortcut-row">
              <span><strong>上一句</strong><small>向前跳转当前文章</small></span>
              <Input v-model="draftKeys.previous" class="preview-input shortcut-input" aria-label="上一句快捷键" />
            </label>
            <label class="rw-shortcut-row">
              <span><strong>下一句</strong><small>向后跳转当前文章</small></span>
              <Input v-model="draftKeys.next" class="preview-input shortcut-input" aria-label="下一句快捷键" />
            </label>
          </div>
          <p class="rw-dialog-note">完整键名保持可见：<code>{{ draftKeys.previous }}</code> / <code>{{ draftKeys.next }}</code>。样稿不会注册全局快捷键。</p>
          <p v-if="appliedNotice" class="rw-applied-notice" role="status">{{ appliedNotice }}</p>
        </div>

        <div class="rw-dialog-footer">
          <button class="preview-button preview-button--outline" type="button" @click="closeSettings">关闭</button>
          <Button variant="default" size="sm" type="button" class="preview-button preview-button--primary rw:rounded-full" @click="applySettings">应用到预览</Button>
        </div>
      </form>
    </dialog>

    <div v-if="toastVisible" class="rw-toast" role="status" aria-live="polite">{{ toast }}</div>
  </div>
</template>
