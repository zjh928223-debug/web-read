<template>
  <Teleport to="body">
    <div v-if="image" class="reader-page-background" :data-overscan="fit === 'cover' && blur > 0" aria-hidden="true">
      <img :src="image" alt="" draggable="false"
        :style="{ objectFit: fit, filter: `blur(${blur}px)` }" />
    </div>
  </Teleport>
  <Teleport to="#reader-background-settings-root">
    <section class="reader-settings-group rw:flex rw:flex-col rw:gap-4 rw:p-5" aria-labelledby="reader-background-title">
      <h3 id="reader-background-title" class="rw:m-0">阅读背景</h3>
      <div class="rw:flex rw:flex-wrap rw:items-center rw:gap-4">
        <Button type="button" variant="floating" size="reader" data-ui-owner="reader"
          :disabled="busy" @click="fileInput?.click()">{{ busy ? '正在处理图片…' : image ? '替换背景图片' : '选择背景图片' }}</Button>
        <Button type="button" variant="floating" size="reader" data-ui-owner="reader"
          :disabled="!image || busy" @click="removeBackground">移除背景</Button>
        <input id="reader-background-file" ref="fileInput" type="file" hidden
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif" @change="chooseImage" />
      </div>
      <div class="rw:flex rw:flex-wrap rw:items-center rw:gap-4">
        <label for="reader-background-fit">显示方式</label>
        <select id="reader-background-fit" v-model="fit" :disabled="!image || busy" @change="saveFit">
          <option value="scale-down">完整显示（小图不放大）</option>
          <option value="cover">铺满屏幕（可能放大、裁切）</option>
        </select>
      </div>
      <div class="reader-background-blur-control">
        <label for="reader-background-blur">高斯模糊</label>
        <input id="reader-background-blur" v-model.number="blur" type="range" min="0" max="40" step="1"
          :disabled="!image || busy" :aria-valuetext="`${blur} 像素`" @change="saveBlur" />
        <output for="reader-background-blur">{{ blur }} px</output>
      </div>
      <p class="rw:m-0">图片铺在整个白色阅读卡片背后的页面底层。仅模糊背景，文字与卡片保持清晰。自动保存在当前浏览器。</p>
      <p v-if="message" class="rw:m-0" role="status" aria-live="polite">{{ message }}</p>
    </section>
  </Teleport>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { Button } from './ui/button/index.js'

const storageKey = 'st.readerPageBackground.v1'
const image = ref('')
const blur = ref(0)
const fit = ref('scale-down')
const busy = ref(false)
const message = ref('')
const fileInput = ref(null)
let savedBlur = 0
let savedFit = 'scale-down'

function persist(nextImage, nextBlur) {
  localStorage.setItem(storageKey, JSON.stringify({ image: nextImage, blur: nextBlur, fit: fit.value }))
  savedBlur = nextBlur
  savedFit = fit.value
}

function saveFit() {
  try {
    persist(image.value, blur.value)
    message.value = '背景显示方式已保存。'
  } catch {
    fit.value = savedFit
    message.value = '浏览器未能保存设置，已恢复上次的显示方式。'
  }
}

function saveBlur() {
  try {
    persist(image.value, blur.value)
    message.value = '背景设置已保存。'
  } catch {
    blur.value = savedBlur
    message.value = '浏览器未能保存设置，已恢复上次的模糊程度。'
  }
}

async function chooseImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) {
    message.value = '请选择 JPG、PNG、WebP、GIF 或 AVIF 图片。'
    return
  }
  if (file.size > 20 * 1024 * 1024) {
    message.value = '图片超过 20 MB，请选择较小的图片。'
    return
  }
  busy.value = true
  const url = URL.createObjectURL(file)
  try {
    const source = new Image()
    source.src = url
    await source.decode()
    // Keep a browser-local, resized copy; never change the original file.
    const scale = Math.min(1, 3840 / Math.max(source.naturalWidth, source.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    const nextImage = canvas.toDataURL('image/webp', 0.95)
    // Save first so quota failures preserve the previous background.
    persist(nextImage, blur.value)
    image.value = nextImage
    message.value = '背景已保存。完整显示不会放大小图；动图使用静态画面。'
  } catch {
    message.value = '图片无法读取或浏览器存储空间不足，原背景已保留。请尝试其他或更小的图片。'
  } finally {
    URL.revokeObjectURL(url)
    busy.value = false
  }
}

function removeBackground() {
  try {
    localStorage.removeItem(storageKey)
    image.value = ''
    blur.value = savedBlur = 0
    fit.value = savedFit = 'scale-down'
    message.value = '已恢复默认背景。'
  } catch {
    message.value = '浏览器未能移除保存的背景，请重试。'
  }
}

onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (!saved) return
    if (!/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(saved.image)) {
      throw new Error('Invalid background')
    }
    image.value = saved.image
    blur.value = savedBlur = Number.isFinite(saved.blur) ? Math.min(40, Math.max(0, Math.round(saved.blur))) : 0
    fit.value = savedFit = saved.fit === 'cover' ? 'cover' : 'scale-down'
  } catch {
    message.value = '已使用默认背景；保存的背景暂时无法读取，可重新选择图片。'
  }
})
</script>

<style>
/* A separate layer behind all reader cards; filters never affect their children. */
body { isolation: isolate; }
.reader-page-background {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
}
.reader-page-background img {
  display: block;
  width: 100%;
  height: 100%;
  max-width: none;
  object-position: center;
}
.reader-page-background[data-overscan="true"] img {
  width: calc(100% + 240px);
  height: calc(100% + 240px);
  margin: -120px;
}
#reader-background-fit {
  max-width: 100%;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--rw-ui-border);
  border-radius: 8px;
  background: var(--rw-ui-card);
  color: var(--text-main);
}
.reader-background-blur-control {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.reader-background-blur-control input { flex: 1; min-width: 100px; max-width: 280px; }
.reader-background-blur-control output { min-width: 48px; font-variant-numeric: tabular-nums; }
</style>
