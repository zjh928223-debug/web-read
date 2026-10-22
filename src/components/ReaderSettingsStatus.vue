<template>
  <Teleport to="#reader-mode-status-root">
    <span class="reader-mode-status" role="status">阅读模式：{{ chunk.isChunkMode ? 'AI切分' : '普通文本' }}</span>
  </Teleport>
  <Teleport to="#reader-video-control-root">
    <Button
      type="button"
      variant="outline"
      data-ui-owner="reader"
      :disabled="!media.videoAvailable"
      :aria-pressed="media.videoPreferred"
      :title="media.videoAvailable ? '显示或隐藏视频窗口；保留音频播放' : '当前材料没有可用的视频'"
      @click="toggleVideo"
    >{{ media.videoPreferred ? '隐藏视频' : '显示视频' }}</Button>
  </Teleport>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Button } from './ui/button/index.js'
import { useChunkStore } from '../pinia-stores/chunk.js'

const chunk = useChunkStore()
const media = ref({ videoAvailable: false, videoPreferred: false })
let unsubscribe = null

function toggleVideo() {
  const source = window.__mediaSource
  if (media.value.videoAvailable && typeof source?.setVideoPreferred === 'function') {
    source.setVideoPreferred(!media.value.videoPreferred)
  }
}

onMounted(() => {
  const source = window.__mediaSource
  if (typeof source?.subscribe === 'function') {
    unsubscribe = source.subscribe(next => { media.value = next })
  }
})

onBeforeUnmount(() => {
  if (typeof unsubscribe === 'function') unsubscribe()
  unsubscribe = null
})
</script>
