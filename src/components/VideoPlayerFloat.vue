<template>
  <Teleport to="body">
    <section
      v-if="visible"
      class="youtube-video-player"
      :class="{ 'is-minimized': mediaState.window.minimized, 'is-dragging': dragging, 'is-resizing': resizing }"
      :style="playerStyle"
      role="region"
      aria-label="视频播放器"
    >
      <header class="youtube-video-titlebar" @pointerdown="startVideoDrag">
        <strong>{{ mediaTitle }}</strong>
        <span>{{ mediaState.activeKind === 'video' ? '视频播放' : '视频待命' }}</span>
        <div class="youtube-video-actions">
          <button type="button" class="youtube-workflow-icon-btn" :aria-label="mediaState.window.minimized ? '展开视频' : '最小化视频'" @pointerdown.stop @click.stop="minimizeVideo">
            {{ mediaState.window.minimized ? '□' : '-' }}
          </button>
          <button type="button" class="youtube-workflow-icon-btn" aria-label="关闭视频" @pointerdown.stop @click.stop="closeVideo">x</button>
        </div>
      </header>
      <video
        ref="videoRef"
        v-show="!mediaState.window.minimized"
        controls
        preload="metadata"
        playsinline
        @loadedmetadata="handleLoadedMetadata"
      ></video>
      <button
        v-if="!mediaState.window.minimized"
        type="button"
        class="youtube-video-resize-handle"
        aria-label="调整视频大小"
        @pointerdown.stop.prevent="startVideoResize"
      ></button>
    </section>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const DEFAULT_STATE = {
  videoPreferred: false,
  videoAvailable: false,
  videoUrl: '',
  videoTitle: '',
  activeKind: 'audio',
  window: { x: Math.max(24, (typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280) - 384), y: 24, width: 360, aspectRatio: 16 / 9, minimized: false }
}

const videoRef = ref(null)
const mediaState = ref({ ...DEFAULT_STATE, window: { ...DEFAULT_STATE.window } })
const dragging = ref(false)
const resizing = ref(false)
let unsubscribe = null
let dragState = null
let resizeState = null

const visible = computed(() => {
  return mediaState.value.videoAvailable && (mediaState.value.videoPreferred || mediaState.value.activeKind === 'video')
})

const mediaTitle = computed(() => {
  return mediaState.value.videoTitle || '本地视频'
})

const playerStyle = computed(() => {
  const win = mediaState.value.window || DEFAULT_STATE.window
  const width = Math.max(260, Number(win.width) || 360)
  const aspectRatio = Math.max(1, Number(win.aspectRatio) || 16 / 9)
  const videoHeight = Math.round(width / aspectRatio)
  const height = win.minimized ? 44 : videoHeight + 38
  return {
    left: `${Math.max(0, Number(win.x) || 0)}px`,
    top: `${Math.max(0, Number(win.y) || 0)}px`,
    width: `${width}px`,
    height: `${height}px`
  }
})

function getMediaSource() {
  return typeof window !== 'undefined' ? window.__mediaSource : null
}

function syncMediaState(next) {
  mediaState.value = {
    ...DEFAULT_STATE,
    ...(next || {}),
    window: { ...DEFAULT_STATE.window, ...((next && next.window) || {}) }
  }
}

function clampWindowPatch(patch) {
  const width = Math.max(260, Math.min(760, Number(patch.width ?? mediaState.value.window.width) || 360))
  const aspectRatio = Math.max(1, Math.min(2.4, Number(patch.aspectRatio ?? mediaState.value.window.aspectRatio) || 16 / 9))
  const maxX = Math.max(0, window.innerWidth - width)
  const maxY = Math.max(0, window.innerHeight - 44)
  return {
    ...patch,
    width,
    aspectRatio,
    x: Math.max(0, Math.min(maxX, Number(patch.x ?? mediaState.value.window.x) || 0)),
    y: Math.max(0, Math.min(maxY, Number(patch.y ?? mediaState.value.window.y) || 0))
  }
}

function setVideoWindow(patch) {
  const mediaSource = getMediaSource()
  if (mediaSource && typeof mediaSource.setVideoWindow === 'function') {
    mediaSource.setVideoWindow(clampWindowPatch(patch))
  }
}

function minimizeVideo() {
  setVideoWindow({ minimized: !mediaState.value.window.minimized })
}

function closeVideo() {
  const mediaSource = getMediaSource()
  if (mediaSource && typeof mediaSource.closeVideo === 'function') mediaSource.closeVideo()
}

function handleLoadedMetadata() {
  const video = videoRef.value
  if (!video || !video.videoWidth || !video.videoHeight) return
  setVideoWindow({ aspectRatio: video.videoWidth / video.videoHeight })
}

function startVideoDrag(event) {
  if (event.button !== 0) return
  dragging.value = true
  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: mediaState.value.window.x,
    originY: mediaState.value.window.y
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', moveVideoDrag)
  window.addEventListener('pointerup', stopVideoPointer)
  window.addEventListener('pointercancel', stopVideoPointer)
}

function moveVideoDrag(event) {
  if (!dragState) return
  const dx = event.clientX - dragState.startX
  const dy = event.clientY - dragState.startY
  setVideoWindow({ x: dragState.originX + dx, y: dragState.originY + dy })
}

function startVideoResize(event) {
  if (event.button !== 0) return
  resizing.value = true
  resizeState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: mediaState.value.window.width
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', moveVideoResize)
  window.addEventListener('pointerup', stopVideoPointer)
  window.addEventListener('pointercancel', stopVideoPointer)
}

function moveVideoResize(event) {
  if (!resizeState) return
  const nextWidth = resizeState.startWidth + (event.clientX - resizeState.startX)
  setVideoWindow({ width: nextWidth })
}

function stopVideoPointer() {
  dragging.value = false
  resizing.value = false
  dragState = null
  resizeState = null
  window.removeEventListener('pointermove', moveVideoDrag)
  window.removeEventListener('pointermove', moveVideoResize)
  window.removeEventListener('pointerup', stopVideoPointer)
  window.removeEventListener('pointercancel', stopVideoPointer)
}

watch(visible, async (nextVisible) => {
  const mediaSource = getMediaSource()
  if (!nextVisible) {
    if (mediaSource && typeof mediaSource.setVideoElement === 'function') {
      mediaSource.setVideoElement(null)
    }
    return
  }
  await nextTick()
  if (mediaSource && typeof mediaSource.setVideoElement === 'function') {
    mediaSource.setVideoElement(videoRef.value)
  }
})

onMounted(async () => {
  const mediaSource = getMediaSource()
  if (mediaSource && typeof mediaSource.subscribe === 'function') {
    unsubscribe = mediaSource.subscribe(syncMediaState)
  }
  await nextTick()
  if (mediaSource && typeof mediaSource.setVideoElement === 'function') {
    mediaSource.setVideoElement(videoRef.value)
  }
})

onBeforeUnmount(() => {
  if (unsubscribe) unsubscribe()
  stopVideoPointer()
  const mediaSource = getMediaSource()
  if (mediaSource && typeof mediaSource.setVideoElement === 'function') {
    mediaSource.setVideoElement(null)
  }
})
</script>
