<template>
  <ReaderBackgroundSettings />
  <Teleport to="#reader-settings-control-root">
    <Button
      id="reader-settings-toggle"
      type="button"
      variant="floating"
      size="reader"
      data-ui-owner="reader"
      aria-controls="reader-settings"
      :aria-expanded="settingsOpen"
      @click="toggleSettings"
    >阅读设置<span aria-hidden="true">{{ settingsOpen ? '▴' : '▾' }}</span></Button>
  </Teleport>
  <Teleport to="#reader-word-effect-control-root">
    <div class="reader-settings-row rw:flex rw:flex-wrap rw:items-center rw:gap-4" role="group" aria-label="单词提示样式">
      <span>单词提示</span>
      <Button
        id="reader-word-effect-magnify"
        type="button"
        variant="floating"
        size="reader"
        data-ui-owner="reader"
        :class="{ active: wordEffect === 'magnify' }"
        :aria-pressed="wordEffect === 'magnify'"
        @click="setWordEffect('magnify')"
      ><span class="reader-word-effect-check" aria-hidden="true">{{ wordEffect === 'magnify' ? '✓' : '' }}</span>悬停微放大</Button>
      <Button
        id="reader-word-effect-underline"
        type="button"
        variant="floating"
        size="reader"
        data-ui-owner="reader"
        :class="{ active: wordEffect === 'underline' }"
        :aria-pressed="wordEffect === 'underline'"
        @click="setWordEffect('underline')"
      ><span class="reader-word-effect-check" aria-hidden="true">{{ wordEffect === 'underline' ? '✓' : '' }}</span>灰色下划线</Button>
    </div>
    <p class="rw:m-0 rw:mt-4">悬停或滑过单词定位，再按“标记词”快捷键标注；自动记住本浏览器的选择。</p>
  </Teleport>
  <Teleport to="#reader-video-control-root">
    <Button
      type="button"
      variant="floating"
      size="reader"
      data-ui-owner="reader"
      :disabled="!media.videoAvailable"
      :aria-pressed="media.videoPreferred"
      :title="media.videoAvailable ? '显示或隐藏视频窗口；保留音频播放' : '当前材料没有可用的视频'"
      @click="toggleVideo"
    >{{ media.videoPreferred ? '隐藏视频' : '显示视频' }}</Button>
  </Teleport>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ReaderBackgroundSettings from './ReaderBackgroundSettings.vue'
import { Button } from './ui/button/index.js'
import { useChunkStore } from '../pinia-stores/chunk.js'
import { useTranscriptStore } from '../pinia-stores/transcript.js'
import { useUiStore } from '../pinia-stores/ui.js'
import { useAudioStore } from '../pinia-stores/audio.js'
import { recordBestEffortFailure } from '../services/runtime/best-effort.js'

const chunk = useChunkStore()
const transcript = useTranscriptStore()
const ui = useUiStore()
const audioStore = useAudioStore()
watch(() => audioStore.currentAudioMeta?.sourceType, (sourceType) => {
  const player = document.getElementById('audio-player')
  if (player) player.dataset.textOnly = String(sourceType === 'text-only')
}, { immediate: true })
watch(() => [chunk.isChunkMode, transcript.segments.length > 0], ([chunkMode, hasArticle]) => {
  if (hasArticle) ui.showNotice('reader-mode', `阅读模式：${chunkMode ? 'AI切分' : '普通文本'}`)
}, { immediate: true })
const media = ref({ videoAvailable: false, videoPreferred: false })
const settingsOpen = ref(false)
const wordEffect = ref('magnify')
const wordEffectStorageKey = 'st.readerWordEffect'
let unsubscribe = null
let settingsElement = null

function syncSettings() {
  settingsOpen.value = Boolean(settingsElement?.open)
}

function toggleSettings() {
  if (!settingsElement) return
  settingsElement.open = !settingsElement.open
  syncSettings()
}

function closeSettingsOnOutsideClick(event) {
  if (!settingsElement?.open) return
  const path = event.composedPath()
  if (path.includes(settingsElement) || path.includes(document.getElementById('reader-settings-toggle'))) return
  settingsElement.open = false
  syncSettings()
}

function toggleVideo() {
  const source = window.__mediaSource
  if (media.value.videoAvailable && typeof source?.setVideoPreferred === 'function') {
    source.setVideoPreferred(!media.value.videoPreferred)
  }
}

function applyWordEffect(value) {
  wordEffect.value = value === 'underline' ? 'underline' : 'magnify'
  document.documentElement.dataset.readerWordEffect = wordEffect.value
}

function reportWordEffectStorageFailure(error) {
  recordBestEffortFailure(error, {
    operationId: 'reader-word-effect-preference',
    reason: 'word effects remain usable when browser preferences are unavailable',
  })
}

function setWordEffect(value) {
  applyWordEffect(value)
  try {
    localStorage.setItem(wordEffectStorageKey, wordEffect.value)
  } catch (error) {
    reportWordEffectStorageFailure(error)
  }
}

onMounted(() => {
  try {
    applyWordEffect(localStorage.getItem(wordEffectStorageKey))
  } catch (error) {
    applyWordEffect('magnify')
    reportWordEffectStorageFailure(error)
  }
  settingsElement = document.getElementById('reader-settings')
  syncSettings()
  settingsElement?.addEventListener('toggle', syncSettings)
  document.addEventListener('click', closeSettingsOnOutsideClick, true)
  const source = window.__mediaSource
  if (typeof source?.subscribe === 'function') {
    unsubscribe = source.subscribe(next => { media.value = next })
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeSettingsOnOutsideClick, true)
  settingsElement?.removeEventListener('toggle', syncSettings)
  settingsElement = null
  if (typeof unsubscribe === 'function') unsubscribe()
  unsubscribe = null
})
</script>
