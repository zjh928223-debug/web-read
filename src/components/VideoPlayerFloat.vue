<template>
  <Teleport to="body">
    <section
      v-if="visible"
      class="youtube-video-player"
      :class="{ 'is-minimized': mediaState.window.minimized, 'is-dragging': dragging, 'is-resizing': resizing }"
      :style="playerStyle"
      role="region"
      aria-label="视频播放器"
      :data-controls-visible="nativeControlsVisible ? 'true' : 'false'"
      @pointerdown="startVideoDrag"
    >
      <header class="youtube-video-titlebar">
        <strong>{{ mediaTitle }}</strong>
        <span>{{ mediaState.activeKind === 'video' ? '视频播放' : '视频待命' }}</span>
        <div class="youtube-video-actions">
          <button type="button" class="youtube-workflow-icon-btn" :aria-label="mediaState.window.minimized ? '展开视频' : '最小化视频'" @pointerdown.stop @click.stop="minimizeVideo">
            {{ mediaState.window.minimized ? '+' : '-' }}
          </button>
          <button type="button" class="youtube-workflow-icon-btn" aria-label="关闭视频" @pointerdown.stop @click.stop="closeVideo">x</button>
        </div>
      </header>
      <video
        ref="videoRef"
        v-show="!mediaState.window.minimized"
        :controls="nativeControlsVisible"
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
  window: { x: Math.max(24, (typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280) - 384), y: 320, width: 360, aspectRatio: 16 / 9, minimized: false }
}
const TITLEBAR_HEIGHT = 30
const MINIMIZED_HEIGHT = 32
const DRAG_THRESHOLD = 6
const CONTROL_REVEAL_MS = 2200
const READER_CONTROLS_GAP = 12

const videoRef = ref(null)
const mediaState = ref({ ...DEFAULT_STATE, window: { ...DEFAULT_STATE.window } })
const dragging = ref(false)
const resizing = ref(false)
const nativeControlsVisible = ref(false)
let unsubscribe = null
let dragState = null
let resizeState = null
let controlsTimer = null

const visible = computed(() => {
  return mediaState.value.videoAvailable && (mediaState.value.videoPreferred || mediaState.value.activeKind === 'video')
})

const mediaTitle = computed(() => {
  return mediaState.value.videoTitle || '本地视频'
})

function getReaderControlsRect() {
  if (typeof document === 'undefined') return null
  const element = document.querySelector('.transcript-header')
  if (!element || typeof element.getBoundingClientRect !== 'function') return null
  const rect = element.getBoundingClientRect()
  if (!rect || !rect.width || !rect.height) return null
  return rect
}

function avoidReaderControls(windowState, width, height) {
  const next = { ...windowState }
  const rect = getReaderControlsRect()
  if (!rect || typeof window === 'undefined') return next
  const viewportWidth = window.innerWidth || 1280
  const viewportHeight = window.innerHeight || 720
  const left = Math.max(0, Math.min(viewportWidth - width, Number(next.x) || 0))
  const top = Math.max(0, Number(next.y) || 0)
  const overlaps = left < rect.right
    && left + width > rect.left
    && top < rect.bottom
    && top + height > rect.top
  if (!overlaps) return next

  const below = rect.bottom + READER_CONTROLS_GAP
  const above = rect.top - height - READER_CONTROLS_GAP
  if (below + height <= viewportHeight - READER_CONTROLS_GAP) {
    next.y = below
  } else if (above >= READER_CONTROLS_GAP) {
    next.y = above
  } else {
    next.y = Math.max(READER_CONTROLS_GAP, Math.min(viewportHeight - height - READER_CONTROLS_GAP, top))
  }
  return next
}

const playerStyle = computed(() => {
  const win = mediaState.value.window || DEFAULT_STATE.window
  const width = Math.max(260, Number(win.width) || 360)
  const aspectRatio = Math.max(1, Number(win.aspectRatio) || 16 / 9)
  const videoHeight = Math.round(width / aspectRatio)
  const height = win.minimized ? MINIMIZED_HEIGHT : videoHeight + TITLEBAR_HEIGHT
  const safeWindow = avoidReaderControls(win, width, height)
  return {
    left: `${Math.max(0, Number(safeWindow.x) || 0)}px`,
    top: `${Math.max(0, Number(safeWindow.y) || 0)}px`,
    width: `${width}px`,
    height: `${height}px`
  }
})

function getMediaSource() {
  return typeof window !== 'undefined' ? window.__mediaSource : null
}

function syncMediaState(next) {
  const merged = {
    ...DEFAULT_STATE,
    ...(next || {}),
    window: { ...DEFAULT_STATE.window, ...((next && next.window) || {}) }
  }
  const width = Math.max(260, Number(merged.window.width) || 360)
  const aspectRatio = Math.max(1, Number(merged.window.aspectRatio) || 16 / 9)
  const height = merged.window.minimized ? MINIMIZED_HEIGHT : Math.round(width / aspectRatio) + TITLEBAR_HEIGHT
  const safeWindow = avoidReaderControls(merged.window, width, height)
  mediaState.value = { ...merged, window: safeWindow }
  if (safeWindow.y !== merged.window.y) {
    const mediaSource = getMediaSource()
    if (mediaSource && typeof mediaSource.setVideoWindow === 'function') {
      mediaSource.setVideoWindow({ y: safeWindow.y })
    }
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
  hideNativeControls()
  setVideoWindow({ minimized: !mediaState.value.window.minimized })
}

function closeVideo() {
  hideNativeControls()
  const mediaSource = getMediaSource()
  if (mediaSource && typeof mediaSource.closeVideo === 'function') mediaSource.closeVideo()
}

function handleLoadedMetadata() {
  const video = videoRef.value
  if (!video || !video.videoWidth || !video.videoHeight) return
  setVideoWindow({ aspectRatio: video.videoWidth / video.videoHeight })
}

function revealNativeControls() {
  nativeControlsVisible.value = true
  if (controlsTimer) window.clearTimeout(controlsTimer)
  controlsTimer = window.setTimeout(() => {
    nativeControlsVisible.value = false
    controlsTimer = null
  }, CONTROL_REVEAL_MS)
}

function hideNativeControls() {
  nativeControlsVisible.value = false
  if (controlsTimer) {
    window.clearTimeout(controlsTimer)
    controlsTimer = null
  }
}

function isBlockedDragTarget(target) {
  if (!target || typeof target.closest !== 'function') return false
  return !!target.closest('button, input, textarea, select, a, .youtube-video-actions, .youtube-video-resize-handle')
}

function isNativeControlsArea(event) {
  if (!nativeControlsVisible.value || !event.currentTarget || typeof event.currentTarget.getBoundingClientRect !== 'function') return false
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY >= rect.bottom - 56
}

function startVideoDrag(event) {
  if (event.button !== 0) return
  if (mediaState.value.window.minimized) return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (isBlockedDragTarget(event.target) || isNativeControlsArea(event)) return
  event.preventDefault()
  revealNativeControls()
  dragState = {
    pointerId: event.pointerId,
    target: event.currentTarget,
    startX: event.clientX,
    startY: event.clientY,
    originX: mediaState.value.window.x,
    originY: mediaState.value.window.y,
    active: false
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
  if (!dragState.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
  dragState.active = true
  dragging.value = true
  setVideoWindow({ x: dragState.originX + dx, y: dragState.originY + dy })
}

function startVideoResize(event) {
  if (event.button !== 0) return
  revealNativeControls()
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
  if (dragState && dragState.target && typeof dragState.target.releasePointerCapture === 'function') {
    try { dragState.target.releasePointerCapture(dragState.pointerId) } catch (_err) {}
  }
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
    hideNativeControls()
    if (mediaSource && typeof mediaSource.setVideoElement === 'function') {
      mediaSource.setVideoElement(null)
    }
    return
  }
  hideNativeControls()
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
  hideNativeControls()
  const mediaSource = getMediaSource()
  if (mediaSource && typeof mediaSource.setVideoElement === 'function') {
    mediaSource.setVideoElement(null)
  }
})
</script>
